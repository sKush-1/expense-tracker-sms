/**
 * SQL DDL for the sms_messages table and its indexes.
 *
 * Notes:
 * - `android_sms_id` has a UNIQUE constraint to prevent duplicate records
 *   when the same SMS is imported more than once from Android inbox.
 * - `fingerprint` is a deterministic SHA-256 hash (sender|received_at|message)
 *   with a UNIQUE index to prevent duplicates between BroadcastReceiver and ContentProvider.
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
    created_at     INTEGER DEFAULT (strftime('%s', 'now')),
    fingerprint    TEXT
  );
`;

export const CREATE_FINGERPRINT_INDEX = `
  CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_fingerprint
  ON sms_messages (fingerprint);
`;

export const CREATE_SENDER_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_sms_sender
  ON sms_messages (sender);
`;

export const CREATE_RECEIVED_AT_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_sms_received_at
  ON sms_messages (received_at DESC);
`;

/**
 * SQL DDL for the transactions table and its indexes (Phase 4).
 */
export const CREATE_TRANSACTIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS transactions (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    source_sms_id      INTEGER NOT NULL UNIQUE,
    transaction_type   TEXT NOT NULL CHECK(transaction_type IN ('debit', 'credit', 'refund')),
    amount_paise       INTEGER NOT NULL,
    currency           TEXT DEFAULT 'INR',
    merchant           TEXT,
    bank_name          TEXT,
    account_identifier TEXT,
    reference_number   TEXT,
    transaction_date   INTEGER NOT NULL,
    balance_paise      INTEGER,
    parser_name        TEXT NOT NULL,
    parser_version     TEXT NOT NULL,
    created_at         INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (source_sms_id) REFERENCES sms_messages(id) ON DELETE CASCADE
  );
`;

export const CREATE_TX_DATE_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_transactions_date
  ON transactions (transaction_date DESC);
`;

export const CREATE_TX_TYPE_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_transactions_type
  ON transactions (transaction_type);
`;

export const CREATE_TX_SOURCE_SMS_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_transactions_source_sms
  ON transactions (source_sms_id);
`;

/**
 * SQL DDL for tracking SMS processing status (Phase 4).
 * Prevents reprocessing non-transaction SMS repeatedly while allowing retries.
 */
export const CREATE_PROCESSING_STATUS_TABLE = `
  CREATE TABLE IF NOT EXISTS sms_processing_status (
    sms_id       INTEGER PRIMARY KEY,
    status       TEXT NOT NULL CHECK(status IN ('transaction', 'ignored', 'failed')),
    reason       TEXT,
    processed_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (sms_id) REFERENCES sms_messages(id) ON DELETE CASCADE
  );
`;

/** All DDL statements executed during schema initialisation. */
export const SCHEMA_STATEMENTS = [
  CREATE_SMS_TABLE,
  CREATE_FINGERPRINT_INDEX,
  CREATE_SENDER_INDEX,
  CREATE_RECEIVED_AT_INDEX,
  CREATE_TRANSACTIONS_TABLE,
  CREATE_TX_DATE_INDEX,
  CREATE_TX_TYPE_INDEX,
  CREATE_TX_SOURCE_SMS_INDEX,
  CREATE_PROCESSING_STATUS_TABLE,
] as const;
