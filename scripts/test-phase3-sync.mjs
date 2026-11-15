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

    if (Number(result.changes) === 0) {
      try {
        const updateCanonicalStmt = db.prepare(`
          UPDATE sms_messages
          SET fingerprint = ?, received_at = ?
          WHERE android_sms_id = ? AND (fingerprint != ? OR received_at != ?)
        `);
        updateCanonicalStmt.run(
          payload.fingerprint,
          payload.received_at,
          payload.android_sms_id,
          payload.fingerprint,
          payload.received_at
        );
      } catch {
        // Safe fallback
      }
    }
  }

  return { changes: Number(result.changes) };
}

function insertSmsBatch(db, payloads) {
  let inserted = 0;
  for (const p of payloads) {
    const res = insertSms(db, p);
    inserted += res.changes;
  }
  return inserted;
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

  // Duplicate Broadcast 3, 4, 5
  for (let i = 0; i < 3; i++) {
    const res = insertSms(db, {
      android_sms_id: `recv_${fp}`,
      sender,
      message: body,
      received_at: timestamp,
      fingerprint: fp,
    });
    assert.equal(res.changes, 0);
  }

  const rows = db.prepare('SELECT * FROM sms_messages').all();
  assert.equal(rows.length, 1, 'Only one row must exist after repeated broadcasts');
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

test('Repeated historical imports do not create duplicate rows', () => {
  const db = setupTestDb();
  const sampleBatch = [
    { android_sms_id: '101', sender: 'BANK-A', message: 'Alert 1', received_at: 1000, fingerprint: computeFingerprint('BANK-A', 'Alert 1', 1000) },
    { android_sms_id: '102', sender: 'BANK-B', message: 'Alert 2', received_at: 2000, fingerprint: computeFingerprint('BANK-B', 'Alert 2', 2000) },
    { android_sms_id: '103', sender: 'BANK-C', message: 'Alert 3', received_at: 3000, fingerprint: computeFingerprint('BANK-C', 'Alert 3', 3000) },
  ];

  // First import
  const inserted1 = insertSmsBatch(db, sampleBatch);
  assert.equal(inserted1, 3, 'First import inserts 3 records');

  // Second import (exact same inbox content)
  const inserted2 = insertSmsBatch(db, sampleBatch);
  assert.equal(inserted2, 0, 'Second import must insert 0 new records');

  // Third import
  const inserted3 = insertSmsBatch(db, sampleBatch);
  assert.equal(inserted3, 0, 'Third import must insert 0 new records');

  const count = db.prepare('SELECT COUNT(*) as count FROM sms_messages').get().count;
  assert.equal(count, 3, 'Total records must remain exactly 3');
});

test('Timestamp source migration updates existing row to canonical date_sent and fingerprint without duplicates', () => {
  const db = setupTestDb();
  const sender = 'JD-CENTBK-T';
  const body = 'A/c XX1089 debited by Rs. 199.00 via UPI';

  // Old import used local device DATE (e.g. with extra 655ms) and old fingerprint
  const oldDate = 1794693024655;
  const oldFp = `JD-CENTBK-T_${oldDate}_1`;

  insertSms(db, {
    android_sms_id: '4011',
    sender,
    message: body,
    received_at: oldDate,
    fingerprint: oldFp,
  });

  const rowBefore = db.prepare('SELECT * FROM sms_messages WHERE android_sms_id = ?').get('4011');
  assert.equal(rowBefore.received_at, oldDate);
  assert.equal(rowBefore.fingerprint, oldFp);

  // Now historical import runs with canonical DATE_SENT (1794693025000) and canonical SHA-256 fingerprint
  const canonicalDateSent = 1794693025000;
  const canonicalFp = computeFingerprint(sender, body, canonicalDateSent);

  const res = insertSms(db, {
    android_sms_id: '4011',
    sender,
    message: body,
    received_at: canonicalDateSent,
    fingerprint: canonicalFp,
  });

  assert.equal(res.changes, 0, 'Must not insert a duplicate row');

  // Verify row was updated in-place to canonical date_sent and SHA-256 fingerprint
  const rowAfter = db.prepare('SELECT * FROM sms_messages WHERE android_sms_id = ?').get('4011');
  assert.equal(rowAfter.received_at, canonicalDateSent, 'received_at must be updated to canonical date_sent');
  assert.equal(rowAfter.fingerprint, canonicalFp, 'fingerprint must be updated to canonical SHA-256');

  // Total rows still 1
  const count = db.prepare('SELECT COUNT(*) as count FROM sms_messages').get().count;
  assert.equal(count, 1);
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

test('Queue acknowledgement failure handling: SQLite insert succeeds, ack fails, retry is idempotent', async () => {
  let pendingQueue = [
    { sender: 'SENDER-A', message: 'Transaction A', received_at: 1000, fingerprint: 'fp_a' },
    { sender: 'SENDER-B', message: 'Transaction B', received_at: 2000, fingerprint: 'fp_b' },
  ];

  let shouldAckFail = true;

  const fakeNativeModule = {
    async getPendingMessages() {
      return [...pendingQueue];
    },
    async acknowledgePendingMessages(fingerprints) {
      if (shouldAckFail) {
        throw new Error('Native acknowledgement IPC failure or disk error');
      }
      const set = new Set(fingerprints);
      pendingQueue = pendingQueue.filter(m => !set.has(m.fingerprint));
      return fingerprints.length;
    }
  };

  const db = setupTestDb();

  async function sync() {
    const pending = await fakeNativeModule.getPendingMessages();
    const acknowledged = [];
    let inserted = 0;

    for (const msg of pending) {
      try {
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

  // Attempt 1: SQLite inserts rows, but ack fails
  let syncFailed = false;
  try {
    await sync();
  } catch (e) {
    syncFailed = true;
  }
  assert.equal(syncFailed, true, 'Sync should throw on ack failure');

  // Both messages MUST still exist in queue because acknowledgement failed
  assert.equal(pendingQueue.length, 2, 'Queue must retain unacknowledged messages');

  // Both messages ARE in SQLite
  const countInDb = db.prepare('SELECT COUNT(*) as cnt FROM sms_messages').get().cnt;
  assert.equal(countInDb, 2, 'SQLite has the rows');

  // Attempt 2: Ack failure resolved, second sync runs
  shouldAckFail = false;
  const secondInserted = await sync();

  // Second sync inserts 0 new rows (INSERT OR IGNORE handles existing rows cleanly)
  assert.equal(secondInserted, 0, 'No duplicates inserted on retry');

  // Queue is now cleanly cleared
  assert.equal(pendingQueue.length, 0, 'Queue is cleanly cleared after successful acknowledgement');

  // Total DB count is still 2
  const finalCount = db.prepare('SELECT COUNT(*) as cnt FROM sms_messages').get().cnt;
  assert.equal(finalCount, 2, 'No duplicates created');
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

  // Process crashes before acknowledge is called
  // On restart:
  const read2 = await fakeNativeModule.getPendingMessages();
  assert.equal(read2.length, 1, 'Message must still exist after crash/restart');
  assert.equal(read2[0].fingerprint, 'fp_x');
});

test('SQLite WAL multi-connection visibility without closing/reopening connection', async () => {
  const { unlinkSync } = await import('node:fs');
  const tempDbPath = `/tmp/test_wal_multiconn_${Date.now()}.db`;
  try { unlinkSync(tempDbPath); } catch {}
  try { unlinkSync(tempDbPath + '-wal'); } catch {}
  try { unlinkSync(tempDbPath + '-shm'); } catch {}

  try {
    // 1. Connection 1 (simulating Expo SQLite singleton in React Native)
    const expoDb = new DatabaseSync(tempDbPath);
    expoDb.exec('PRAGMA journal_mode = WAL;');
    expoDb.exec(`
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
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_fingerprint ON sms_messages (fingerprint);
    `);

    // Verify initial count
    const countBefore = expoDb.prepare('SELECT COUNT(*) as cnt FROM sms_messages;').get().cnt;
    assert.equal(countBefore, 0, 'Initial count must be 0');

    // 2. Connection 2 (simulating native SmsDatabaseHelper in Kotlin)
    const nativeDb = new DatabaseSync(tempDbPath);
    const fp = computeFingerprint('HDFC-ALERT', 'Rs 200 debited', 1794700000000);
    const insertStmt = nativeDb.prepare(`
      INSERT OR IGNORE INTO sms_messages
        (android_sms_id, sender, message, received_at, message_type, fingerprint)
      VALUES (?, ?, ?, ?, ?, ?);
    `);
    insertStmt.run(`recv_${fp}`, 'HDFC-ALERT', 'Rs 200 debited', 1794700000000, 'inbox', fp);
    nativeDb.close();

    // 3. Connection 1 queries again WITHOUT closing or reopening
    const countAfter = expoDb.prepare('SELECT COUNT(*) as cnt FROM sms_messages;').get().cnt;
    assert.equal(countAfter, 1, 'Expo SQLite connection must immediately see native write in WAL mode');

    const latestRow = expoDb.prepare('SELECT * FROM sms_messages ORDER BY received_at DESC LIMIT 1;').get();
    assert.equal(latestRow.sender, 'HDFC-ALERT');
    assert.equal(latestRow.fingerprint, fp);
    assert.equal(latestRow.android_sms_id, `recv_${fp}`);

    expoDb.close();
  } finally {
    try { unlinkSync(tempDbPath); } catch {}
    try { unlinkSync(tempDbPath + '-wal'); } catch {}
    try { unlinkSync(tempDbPath + '-shm'); } catch {}
  }
});
