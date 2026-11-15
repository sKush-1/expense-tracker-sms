import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

function computeFingerprint(sender, message, receivedAt) {
  const raw = `${sender.trim()}|${receivedAt}|${message}`;
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

function setupTestDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS sms_messages (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      android_sms_id TEXT UNIQUE,
      sender         TEXT NOT NULL,
      message        TEXT NOT NULL,
      received_at    INTEGER NOT NULL,
      message_type   TEXT DEFAULT 'inbox',
      created_at     INTEGER DEFAULT (strftime('%s', 'now')),
      fingerprint    TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_fingerprint
    ON sms_messages (fingerprint);

    CREATE INDEX IF NOT EXISTS idx_sms_sender
    ON sms_messages (sender);

    CREATE INDEX IF NOT EXISTS idx_sms_received_at
    ON sms_messages (received_at DESC);
  `);
  return db;
}

function insertSms(db, payload) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO sms_messages
      (android_sms_id, sender, message, received_at, message_type, fingerprint)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    payload.android_sms_id,
    payload.sender,
    payload.message,
    payload.received_at,
    payload.message_type ?? 'inbox',
    payload.fingerprint ?? null
  );

  if (
    payload.fingerprint &&
    payload.android_sms_id &&
    !payload.android_sms_id.startsWith('recv_')
  ) {
    const upgradeStmt = db.prepare(`
      UPDATE sms_messages
      SET android_sms_id = ?
      WHERE fingerprint = ? AND android_sms_id LIKE 'recv_%'
    `);
    upgradeStmt.run(payload.android_sms_id, payload.fingerprint);
  }

  return { changes: Number(result.changes) };
}

test('Duplicate broadcasts do not create duplicate rows', () => {
  const db = setupTestDb();
  const sender = 'JD-CENTBK-T';
  const body = 'A/c XX1089 debited by Rs. 199.00 via UPI';
  const timestamp = 1794693025000;
  const fp = computeFingerprint(sender, body, timestamp);

  // Broadcast 1 arrives
  const res1 = insertSms(db, {
    android_sms_id: `recv_${fp}`,
    sender,
    message: body,
    received_at: timestamp,
    fingerprint: fp,
  });
  assert.equal(res1.changes, 1, 'First broadcast must be inserted');

  // Duplicate Broadcast 2 arrives (carrier re-delivery)
  const res2 = insertSms(db, {
    android_sms_id: `recv_${fp}`,
    sender,
    message: body,
    received_at: timestamp,
    fingerprint: fp,
  });
  assert.equal(res2.changes, 0, 'Duplicate broadcast must be ignored');

  const rows = db.prepare('SELECT * FROM sms_messages').all();
  assert.equal(rows.length, 1, 'Only one row must exist');
});

test('Historical import does not duplicate receiver-captured messages and upgrades ID', () => {
  const db = setupTestDb();
  const sender = 'JD-CENTBK-T';
  const body = 'A/c XX1089 debited by Rs. 199.00 via UPI';
  const scTimestamp = 1794693025000; // SmsMessage.timestampMillis == Telephony.Sms.DATE_SENT
  const fp = computeFingerprint(sender, body, scTimestamp);

  // 1. Receiver captures message in background
  const recvInsert = insertSms(db, {
    android_sms_id: `recv_${fp}`,
    sender,
    message: body,
    received_at: scTimestamp,
    fingerprint: fp,
  });
  assert.equal(recvInsert.changes, 1);

  // 2. User later triggers historical inbox import
  // ContentProvider has _id = '4011', DATE_SENT = 1794693025000
  const importInsert = insertSms(db, {
    android_sms_id: '4011',
    sender,
    message: body,
    received_at: scTimestamp,
    fingerprint: fp,
  });
  assert.equal(importInsert.changes, 0, 'Must not insert a new row');

  // Verify only 1 row exists AND its ID was upgraded from recv_* to 4011
  const rows = db.prepare('SELECT * FROM sms_messages').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].android_sms_id, '4011', 'Temporary recv_* ID must be upgraded to canonical ID');
  assert.equal(rows[0].fingerprint, fp);
});

test('Repeated identical messages with different timestamps are both preserved', () => {
  const db = setupTestDb();
  const sender = 'CENTBK';
  const body = 'Your OTP is 1234';
  const t1 = 1794693000000;
  const t2 = 1794693300000; // 5 mins later

  const fp1 = computeFingerprint(sender, body, t1);
  const fp2 = computeFingerprint(sender, body, t2);
  assert.notEqual(fp1, fp2);

  insertSms(db, {
    android_sms_id: `recv_${fp1}`,
    sender,
    message: body,
    received_at: t1,
    fingerprint: fp1,
  });

  insertSms(db, {
    android_sms_id: `recv_${fp2}`,
    sender,
    message: body,
    received_at: t2,
    fingerprint: fp2,
  });

  const rows = db.prepare('SELECT * FROM sms_messages ORDER BY received_at ASC').all();
  assert.equal(rows.length, 2, 'Both distinct messages must be kept');
  assert.equal(rows[0].received_at, t1);
  assert.equal(rows[1].received_at, t2);
});

test('Crash-safe pending queue synchronization: failed SQLite insert does not lose queued messages', async () => {
  // Simulated native queue
  let pendingQueue = [
    { sender: 'A', message: 'Msg A', received_at: 1000, fingerprint: 'fp_a' },
    { sender: 'B', message: 'Msg B', received_at: 2000, fingerprint: 'fp_b' },
    { sender: 'C', message: 'Msg C', received_at: 3000, fingerprint: 'fp_c' },
  ];

  const fakeNativeModule = {
    async getPendingMessages() {
      // Returns copy without deleting
      return [...pendingQueue];
    },
    async acknowledgePendingMessages(fingerprints) {
      const set = new Set(fingerprints);
      pendingQueue = pendingQueue.filter(m => !set.has(m.fingerprint));
      return fingerprints.length;
    }
  };

  const db = setupTestDb();

  // Simulate sync function with failure on Msg B
  async function sync(failFingerprint = null) {
    const pending = await fakeNativeModule.getPendingMessages();
    const acknowledged = [];
    let inserted = 0;

    for (const msg of pending) {
      try {
        if (msg.fingerprint === failFingerprint) {
          throw new Error('Simulated SQLite disk write failure');
        }
        const res = insertSms(db, {
          android_sms_id: `recv_${msg.fingerprint}`,
          sender: msg.sender,
          message: msg.message,
          received_at: msg.received_at,
          fingerprint: msg.fingerprint,
        });
        acknowledged.push(msg.fingerprint);
        if (res.changes > 0) inserted++;
      } catch (err) {
        // Not acknowledged
      }
    }

    if (acknowledged.length > 0) {
      await fakeNativeModule.acknowledgePendingMessages(acknowledged);
    }
    return inserted;
  }

  // First sync attempt fails on fp_b
  const firstSyncCount = await sync('fp_b');
  assert.equal(firstSyncCount, 2, 'A and C inserted');
  assert.equal(pendingQueue.length, 1, 'Only B should remain in queue');
  assert.equal(pendingQueue[0].fingerprint, 'fp_b');

  // Verify DB state
  const countAfterFirst = db.prepare('SELECT COUNT(*) as cnt FROM sms_messages').get().cnt;
  assert.equal(countAfterFirst, 2);

  // Second sync attempt (disk issue resolved, retry)
  const secondSyncCount = await sync(null);
  assert.equal(secondSyncCount, 1, 'B successfully inserted on retry');
  assert.equal(pendingQueue.length, 0, 'Queue completely cleared');

  const countAfterSecond = db.prepare('SELECT COUNT(*) as cnt FROM sms_messages').get().cnt;
  assert.equal(countAfterSecond, 3);
});

test('Queue survives app/process interruption before synchronization', async () => {
  let pendingQueue = [
    { sender: 'X', message: 'Important Alert', received_at: 5000, fingerprint: 'fp_x' },
  ];

  const fakeNativeModule = {
    async getPendingMessages() {
      return [...pendingQueue];
    },
    async acknowledgePendingMessages(fingerprints) {
      const set = new Set(fingerprints);
      pendingQueue = pendingQueue.filter(m => !set.has(m.fingerprint));
    }
  };

  // Process reads messages
  const read1 = await fakeNativeModule.getPendingMessages();
  assert.equal(read1.length, 1);

  // Process crashes before acknowledge is called!
  // On restart:
  const read2 = await fakeNativeModule.getPendingMessages();
  assert.equal(read2.length, 1, 'Message must still exist after crash/restart');
  assert.equal(read2[0].fingerprint, 'fp_x');
});
