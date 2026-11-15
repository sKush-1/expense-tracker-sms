import type { InsertResult, InsertSmsPayload, SmsMessage } from '@/types/sms';

import { getDatabase } from './db';

// ---------------------------------------------------------------------------
// INSERT
// ---------------------------------------------------------------------------

/**
 * Inserts a single SMS message.
 *
 * Uses INSERT OR IGNORE so that a duplicate `android_sms_id` or `fingerprint`
 * is silently discarded rather than causing an error.
 *
 * Also upgrades any temporary `recv_*` ID to the canonical Android SMS ID
 * if this message was previously captured by the BroadcastReceiver.
 *
 * @returns `InsertResult` with `changes === 0` when the row was ignored.
 */
export function insertSms(payload: InsertSmsPayload): InsertResult {
  const db = getDatabase();

  const result = db.runSync(
    `INSERT OR IGNORE INTO sms_messages
       (android_sms_id, sender, message, received_at, message_type, fingerprint)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      payload.android_sms_id,
      payload.sender,
      payload.message,
      payload.received_at,
      payload.message_type,
      payload.fingerprint ?? null,
    ],
  );

  // If this is a historical import with a real Android ID, upgrade any temporary recv_* ID
  if (
    payload.fingerprint &&
    payload.android_sms_id &&
    !payload.android_sms_id.startsWith('recv_')
  ) {
    db.runSync(
      `UPDATE sms_messages
       SET android_sms_id = ?
       WHERE fingerprint = ? AND android_sms_id LIKE 'recv_%'`,
      [payload.android_sms_id, payload.fingerprint],
    );
  }

  return {
    lastInsertRowId: result.lastInsertRowId,
    changes: result.changes,
  };
}

/**
 * Inserts a batch of SMS messages inside a single transaction.
 *
 * Duplicate rows (matching `android_sms_id` or `fingerprint`) are silently ignored.
 * Temporary `recv_*` IDs are upgraded when canonical Android SMS IDs are provided.
 *
 * @returns Total number of rows actually inserted (duplicates excluded).
 */
export function insertSmsBatch(payloads: InsertSmsPayload[]): number {
  if (payloads.length === 0) return 0;

  const db = getDatabase();
  let insertedCount = 0;

  db.withTransactionSync(() => {
    const insertStmt = db.prepareSync(
      `INSERT OR IGNORE INTO sms_messages
         (android_sms_id, sender, message, received_at, message_type, fingerprint)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );

    const upgradeStmt = db.prepareSync(
      `UPDATE sms_messages
       SET android_sms_id = ?
       WHERE fingerprint = ? AND android_sms_id LIKE 'recv_%'`,
    );

    try {
      for (const payload of payloads) {
        const result = insertStmt.executeSync([
          payload.android_sms_id,
          payload.sender,
          payload.message,
          payload.received_at,
          payload.message_type,
          payload.fingerprint ?? null,
        ]);
        insertedCount += result.changes;

        if (
          payload.fingerprint &&
          payload.android_sms_id &&
          !payload.android_sms_id.startsWith('recv_')
        ) {
          upgradeStmt.executeSync([payload.android_sms_id, payload.fingerprint]);
        }
      }
    } finally {
      insertStmt.finalizeSync();
      upgradeStmt.finalizeSync();
    }
  });

  return insertedCount;
}

// ---------------------------------------------------------------------------
// READ
// ---------------------------------------------------------------------------

/**
 * Retrieves a single SMS message by its internal `id`.
 * Returns `null` when no matching row exists.
 */
export function getSmsById(id: number): SmsMessage | null {
  const db = getDatabase();
  const row = db.getFirstSync<SmsMessage>(
    'SELECT * FROM sms_messages WHERE id = ?',
    [id],
  );
  return row ?? null;
}

/**
 * Returns all stored SMS messages ordered by newest first.
 *
 * @param limit  Optional row cap (default: no limit).
 * @param offset Optional offset for pagination (default: 0).
 */
export function getAllSms(limit?: number, offset: number = 0): SmsMessage[] {
  const db = getDatabase();

  if (limit !== undefined) {
    return db.getAllSync<SmsMessage>(
      'SELECT * FROM sms_messages ORDER BY received_at DESC LIMIT ? OFFSET ?',
      [limit, offset],
    );
  }

  return db.getAllSync<SmsMessage>(
    'SELECT * FROM sms_messages ORDER BY received_at DESC',
  );
}

/**
 * Returns the total number of SMS records stored in the database.
 */
export function getSmsCount(): number {
  const db = getDatabase();
  const row = db.getFirstSync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM sms_messages',
  );
  return row?.count ?? 0;
}

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------

/**
 * Deletes a single SMS message by its internal `id`.
 *
 * @returns `true` when the row was found and deleted.
 */
export function deleteSms(id: number): boolean {
  const db = getDatabase();
  const result = db.runSync('DELETE FROM sms_messages WHERE id = ?', [id]);
  return result.changes > 0;
}
