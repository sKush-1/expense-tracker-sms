import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import {
  CREATE_FINGERPRINT_INDEX,
  CREATE_PROCESSING_STATUS_TABLE,
  CREATE_RECEIVED_AT_INDEX,
  CREATE_SENDER_INDEX,
  CREATE_SMS_TABLE,
  CREATE_TRANSACTIONS_TABLE,
  CREATE_TX_DATE_INDEX,
  CREATE_TX_SOURCE_SMS_INDEX,
  CREATE_TX_TYPE_INDEX,
} from '../../database/schema';
import { defaultParserRegistry } from '../parser.registry';

describe('Database Migration & Transaction Idempotency', () => {
  test('creates tables and indexes cleanly', () => {
    const db = new Database(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');

    db.exec(CREATE_SMS_TABLE);
    db.exec(CREATE_FINGERPRINT_INDEX);
    db.exec(CREATE_SENDER_INDEX);
    db.exec(CREATE_RECEIVED_AT_INDEX);
    db.exec(CREATE_TRANSACTIONS_TABLE);
    db.exec(CREATE_TX_DATE_INDEX);
    db.exec(CREATE_TX_TYPE_INDEX);
    db.exec(CREATE_TX_SOURCE_SMS_INDEX);
    db.exec(CREATE_PROCESSING_STATUS_TABLE);

    const tables = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table';")
      .all()
      .map((t: { name: string }) => t.name);

    expect(tables).toContain('sms_messages');
    expect(tables).toContain('transactions');
    expect(tables).toContain('sms_processing_status');
    db.close();
  });

  test('prevents duplicate transactions for the same SMS (idempotency)', () => {
    const db = new Database(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(CREATE_SMS_TABLE);
    db.exec(CREATE_TRANSACTIONS_TABLE);
    db.exec(CREATE_PROCESSING_STATUS_TABLE);

    // Insert test SMS
    db.run(
      `INSERT INTO sms_messages (id, sender, message, received_at) VALUES (1, 'JD-CENTBK-T', 'A/c XX1089 debited by Rs. 199.00 via UPI with Ref No. 104479862167', 1731650000000)`
    );

    const sms = db.query<{ id: number; sender: string; message: string; received_at: number }, []>(
      'SELECT * FROM sms_messages WHERE id = 1'
    ).get();
    expect(sms).not.toBeNull();

    const parsed = defaultParserRegistry.parse(sms!.sender, sms!.message, sms!.received_at);
    expect(parsed).not.toBeNull();

    // First insert
    const insertStmt = db.prepare(
      `INSERT OR IGNORE INTO transactions (
         source_sms_id, transaction_type, amount_paise, currency, merchant, bank_name,
         account_identifier, reference_number, transaction_date, balance_paise,
         parser_name, parser_version
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const res1 = insertStmt.run(
      sms!.id,
      parsed!.transactionType,
      parsed!.amountPaise,
      parsed!.currency,
      parsed!.merchant,
      parsed!.bankName,
      parsed!.accountIdentifier,
      parsed!.referenceNumber,
      parsed!.transactionDate,
      parsed!.balancePaise,
      parsed!.parserName,
      parsed!.parserVersion
    );
    expect(res1.changes).toBe(1);

    // Second insert with the SAME source_sms_id (simulating repeated processing)
    const res2 = insertStmt.run(
      sms!.id,
      parsed!.transactionType,
      parsed!.amountPaise,
      parsed!.currency,
      parsed!.merchant,
      parsed!.bankName,
      parsed!.accountIdentifier,
      parsed!.referenceNumber,
      parsed!.transactionDate,
      parsed!.balancePaise,
      parsed!.parserName,
      parsed!.parserVersion
    );
    expect(res2.changes).toBe(0); // Ignored due to UNIQUE(source_sms_id)

    const totalTx = db.query<{ count: number }, []>('SELECT COUNT(*) as count FROM transactions').get();
    expect(totalTx?.count).toBe(1);

    db.close();
  });

  test('cascades deletion of transactions when source SMS is deleted', () => {
    const db = new Database(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(CREATE_SMS_TABLE);
    db.exec(CREATE_TRANSACTIONS_TABLE);

    db.run(
      `INSERT INTO sms_messages (id, sender, message, received_at) VALUES (42, 'JD-CENTBK-T', 'A/c XX1089 debited by Rs. 100.00', 1731650000000)`
    );

    db.run(
      `INSERT INTO transactions (source_sms_id, transaction_type, amount_paise, transaction_date, parser_name, parser_version)
       VALUES (42, 'debit', 10000, 1731650000000, 'test', '1.0')`
    );

    expect(db.query<{ count: number }, []>('SELECT COUNT(*) as count FROM transactions').get()?.count).toBe(1);

    // Delete source SMS
    db.run('DELETE FROM sms_messages WHERE id = 42');

    // Foreign key CASCADE should remove linked transaction
    expect(db.query<{ count: number }, []>('SELECT COUNT(*) as count FROM transactions').get()?.count).toBe(0);

    db.close();
  });
});
