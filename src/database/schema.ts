/**
 * SQL DDL for the sms_messages table and its indexes.
 *
 * Notes:
 * - `android_sms_id` has a UNIQUE constraint to prevent duplicate records
 *   when the same SMS is imported more than once.
 * - Timestamps from Android are stored as Unix milliseconds in `received_at`.
 * - `created_at` is auto-populated by SQLite in Unix seconds via strftime.
 * - Indexes on `sender` and `received_at` support filtering and sorting.
 */
export const CREATE_SMS_TABLE = `
  CREATE TABLE IF NOT EXISTS sms_messages (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    android_sms_id TEXT UNIQUE,
    sender         TEXT NOT NULL,
    message        TEXT NOT NULL,
    received_at    INTEGER NOT NULL,
    message_type   TEXT DEFAULT 'inbox',
    created_at     INTEGER DEFAULT (strftime('%s', 'now'))
  );
`;

export const CREATE_SENDER_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_sms_sender
  ON sms_messages (sender);
`;

export const CREATE_RECEIVED_AT_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_sms_received_at
  ON sms_messages (received_at DESC);
`;

/** All DDL statements executed during schema initialisation. */
export const SCHEMA_STATEMENTS = [
  CREATE_SMS_TABLE,
  CREATE_SENDER_INDEX,
  CREATE_RECEIVED_AT_INDEX,
] as const;
