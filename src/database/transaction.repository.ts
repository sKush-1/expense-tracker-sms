import type {
  InsertTransactionPayload,
  TransactionRecord,
} from '../parser/types';
import type { SmsMessage } from '../types/sms';
import { getDatabase } from './db';

// ---------------------------------------------------------------------------
// INSERT
// ---------------------------------------------------------------------------

/**
 * Inserts a single transaction record linked to a source SMS.
 * Uses INSERT OR IGNORE to prevent duplicate transactions for the same SMS.
 *
 * @returns Row ID of inserted transaction, or null if ignored as duplicate.
 */
export function insertTransaction(payload: InsertTransactionPayload): number | null {
  const db = getDatabase();

  const result = db.runSync(
    `INSERT OR IGNORE INTO transactions (
       source_sms_id,
       transaction_type,
       amount_paise,
       currency,
       merchant,
       bank_name,
       account_identifier,
       reference_number,
       transaction_date,
       balance_paise,
       parser_name,
       parser_version
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.sourceSmsId,
      payload.transactionType,
      payload.amountPaise,
      payload.currency || 'INR',
      payload.merchant ?? null,
      payload.bankName ?? null,
      payload.accountIdentifier ?? null,
      payload.referenceNumber ?? null,
      payload.transactionDate,
      payload.balancePaise ?? null,
      payload.parserName,
      payload.parserVersion,
    ],
  );

  return result.changes > 0 ? result.lastInsertRowId : null;
}

// ---------------------------------------------------------------------------
// READ
// ---------------------------------------------------------------------------

/**
 * Retrieves a single transaction by internal ID.
 */
export function getTransactionById(id: number): TransactionRecord | null {
  const db = getDatabase();
  const row = db.getFirstSync<any>(
    'SELECT * FROM transactions WHERE id = ?',
    [id],
  );
  if (!row) return null;

  return mapRowToTransaction(row);
}

/**
 * Retrieves a transaction by its source SMS message ID.
 */
export function getTransactionBySourceSmsId(sourceSmsId: number): TransactionRecord | null {
  const db = getDatabase();
  const row = db.getFirstSync<any>(
    'SELECT * FROM transactions WHERE source_sms_id = ?',
    [sourceSmsId],
  );
  if (!row) return null;

  return mapRowToTransaction(row);
}

/**
 * Returns all transactions ordered by transaction_date descending.
 */
export function getAllTransactions(limit?: number, offset: number = 0): TransactionRecord[] {
  const db = getDatabase();

  let rows: any[];
  if (limit !== undefined) {
    rows = db.getAllSync<any>(
      'SELECT * FROM transactions ORDER BY transaction_date DESC, id DESC LIMIT ? OFFSET ?',
      [limit, offset],
    );
  } else {
    rows = db.getAllSync<any>(
      'SELECT * FROM transactions ORDER BY transaction_date DESC, id DESC',
    );
  }

  return rows.map(mapRowToTransaction);
}

/**
 * Returns total count of transactions.
 */
export function getTransactionCount(): number {
  const db = getDatabase();
  const row = db.getFirstSync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM transactions',
  );
  return row?.count ?? 0;
}

// ---------------------------------------------------------------------------
// PROCESSING STATUS & UNPROCESSED RETRIEVAL
// ---------------------------------------------------------------------------

/**
 * Retrieves SMS messages that have not yet been evaluated by the parser.
 */
export function getUnprocessedSms(limit = 100): SmsMessage[] {
  const db = getDatabase();
  return db.getAllSync<SmsMessage>(
    `SELECT s.*
     FROM sms_messages s
     LEFT JOIN sms_processing_status p ON s.id = p.sms_id
     WHERE p.sms_id IS NULL
     ORDER BY s.id ASC
     LIMIT ?`,
    [limit],
  );
}

/**
 * Records processing status for a single SMS message.
 */
export function recordProcessingStatus(
  smsId: number,
  status: 'transaction' | 'ignored' | 'failed',
  reason?: string,
): void {
  const db = getDatabase();
  db.runSync(
    `INSERT OR REPLACE INTO sms_processing_status (sms_id, status, reason)
     VALUES (?, ?, ?)`,
    [smsId, status, reason ?? null],
  );
}

/**
 * Records processing status in batch inside a transaction.
 */
export function recordProcessingStatusBatch(
  records: {
    smsId: number;
    status: 'transaction' | 'ignored' | 'failed';
    reason?: string;
  }[],
): void {
  if (records.length === 0) return;

  const db = getDatabase();
  db.withTransactionSync(() => {
    const stmt = db.prepareSync(
      `INSERT OR REPLACE INTO sms_processing_status (sms_id, status, reason)
       VALUES (?, ?, ?)`,
    );
    try {
      for (const rec of records) {
        stmt.executeSync([rec.smsId, rec.status, rec.reason ?? null]);
      }
    } finally {
      stmt.finalizeSync();
    }
  });
}

/**
 * Clears processing status table so unprocessed or ignored messages can be re-evaluated.
 * Does not delete any valid transactions in the transactions table.
 */
export function resetProcessingStatus(): number {
  const db = getDatabase();
  const result = db.runSync('DELETE FROM sms_processing_status');
  return result.changes;
}

// ---------------------------------------------------------------------------
// HELPER
// ---------------------------------------------------------------------------

function mapRowToTransaction(row: any): TransactionRecord {
  return {
    id: row.id,
    sourceSmsId: row.source_sms_id,
    transactionType: row.transaction_type,
    amountPaise: row.amount_paise,
    currency: row.currency,
    merchant: row.merchant ?? null,
    bankName: row.bank_name ?? null,
    accountIdentifier: row.account_identifier ?? null,
    referenceNumber: row.reference_number ?? null,
    transactionDate: row.transaction_date,
    balancePaise: row.balance_paise ?? null,
    parserName: row.parser_name,
    parserVersion: row.parser_version,
    createdAt: row.created_at,
  };
}
