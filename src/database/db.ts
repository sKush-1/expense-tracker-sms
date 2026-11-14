import * as SQLite from 'expo-sqlite';

import { SCHEMA_STATEMENTS } from './schema';

const DB_NAME = 'sms_tracker.db';

/**
 * Singleton database instance.
 * Lazily opened on first access via `getDatabase()`.
 */
let _db: SQLite.SQLiteDatabase | null = null;

/**
 * Opens (or returns the cached) SQLite database connection.
 * The database file lives in the app's private storage directory.
 */
export function getDatabase(): SQLite.SQLiteDatabase {
  if (_db === null) {
    _db = SQLite.openDatabaseSync(DB_NAME);
  }
  return _db;
}

/**
 * Initialises the database schema.
 * Safe to call multiple times — all DDL statements use IF NOT EXISTS.
 *
 * @throws Will re-throw any SQLite error so the caller can surface it.
 */
export async function initDatabase(): Promise<void> {
  const db = getDatabase();

  // Enable WAL mode for better concurrent-read performance.
  db.execSync('PRAGMA journal_mode = WAL;');

  // Run all DDL statements inside a single transaction.
  db.withTransactionSync(() => {
    for (const sql of SCHEMA_STATEMENTS) {
      db.execSync(sql);
    }
  });
}

/**
 * Closes the database connection and clears the singleton cache.
 * Useful for testing; not normally needed in production.
 */
export function closeDatabase(): void {
  if (_db !== null) {
    _db.closeSync();
    _db = null;
  }
}
