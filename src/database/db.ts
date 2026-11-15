import * as SQLite from 'expo-sqlite';

import { SmsReaderModule } from '../../modules/sms-reader';
import { SCHEMA_STATEMENTS } from './schema';

const DB_NAME = 'sms_tracker.db';

/**
 * Singleton database instance.
 * Lazily opened on first access via `getDatabase()`.
 */
let _db: SQLite.SQLiteDatabase | null = null;

/**
 * Opens (or returns the cached) SQLite database connection.
 * The database file lives in the app's private storage directory:
 *   [context.filesDir]/SQLite/sms_tracker.db
 */
export function getDatabase(): SQLite.SQLiteDatabase {
  if (_db === null) {
    _db = SQLite.openDatabaseSync(DB_NAME);
  }
  return _db;
}

/**
 * Initialises the database schema and performs migrations if required.
 * Safe to call multiple times.
 *
 * @throws Will re-throw any SQLite error so the caller can surface it.
 */
export async function initDatabase(): Promise<void> {
  const db = getDatabase();

  // Enable WAL mode for better concurrent multi-process access (React Native + SmsReceiver).
  db.execSync('PRAGMA journal_mode = WAL;');

  // Step 1: Ensure base table exists
  db.execSync(SCHEMA_STATEMENTS[0]); // CREATE_SMS_TABLE

  // Step 2: Check if 'fingerprint' column exists (migration for Phase 3)
  const columns = db.getAllSync<{ name: string }>('PRAGMA table_info(sms_messages);');
  const hasFingerprint = columns.some((col) => col.name === 'fingerprint');

  if (!hasFingerprint) {
    db.execSync('ALTER TABLE sms_messages ADD COLUMN fingerprint TEXT;');
  }

  // Step 3: Backfill fingerprints for any existing rows that lack one
  const unhashedRows = db.getAllSync<{
    id: number;
    sender: string;
    message: string;
    received_at: number;
  }>('SELECT id, sender, message, received_at FROM sms_messages WHERE fingerprint IS NULL;');

  if (unhashedRows.length > 0) {
    db.withTransactionSync(() => {
      const updateStmt = db.prepareSync('UPDATE sms_messages SET fingerprint = ? WHERE id = ?;');
      try {
        for (const row of unhashedRows) {
          let fp: string;
          if (SmsReaderModule?.computeFingerprint) {
            fp = SmsReaderModule.computeFingerprint(row.sender, row.message, row.received_at);
          } else {
            fp = `${row.sender.trim()}_${row.received_at}_${row.id}`;
          }
          updateStmt.executeSync([fp, row.id]);
        }
      } finally {
        updateStmt.finalizeSync();
      }
    });
  }

  // Step 4: Remove any duplicate rows by fingerprint before creating unique index
  db.execSync(`
    DELETE FROM sms_messages
    WHERE id NOT IN (
      SELECT MIN(id)
      FROM sms_messages
      GROUP BY fingerprint
    )
    AND fingerprint IS NOT NULL;
  `);

  // Step 5: Create remaining indexes (including UNIQUE index on fingerprint)
  db.withTransactionSync(() => {
    for (let i = 1; i < SCHEMA_STATEMENTS.length; i++) {
      db.execSync(SCHEMA_STATEMENTS[i]);
    }
  });
}

/**
 * Closes the database connection and clears the singleton cache.
 */
export function closeDatabase(): void {
  if (_db !== null) {
    _db.closeSync();
    _db = null;
  }
}
