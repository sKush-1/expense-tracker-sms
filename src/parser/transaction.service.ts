import {
  getTransactionBySourceSmsId,
  getUnprocessedSms,
  insertTransaction,
  recordProcessingStatus,
  recordProcessingStatusBatch,
  resetProcessingStatus,
} from '../database/transaction.repository';
import type { SmsMessage } from '../types/sms';
import { defaultParserRegistry } from './parser.registry';
import type { InsertTransactionPayload, TransactionRecord } from './types';

export interface BatchProcessingResult {
  processed: number;
  transactionsCreated: number;
  hasMore: boolean;
}

export interface ProcessingSummary {
  totalProcessed: number;
  totalTransactions: number;
}

/**
 * Processes a single SMS message.
 *
 * Safe and idempotent:
 * - A single SMS will never produce more than one transaction.
 * - Non-financial SMS (e.g. OTPs) are safely marked as 'ignored'.
 * - Parsing exceptions are caught and marked as 'failed' without disrupting SMS storage.
 */
export function processSmsMessage(sms: SmsMessage): TransactionRecord | null {
  try {
    const parsed = defaultParserRegistry.parse(sms.sender, sms.message, sms.received_at);

    if (parsed) {
      const payload: InsertTransactionPayload = {
        ...parsed,
        sourceSmsId: sms.id,
      };

      const insertedId = insertTransaction(payload);
      recordProcessingStatus(sms.id, 'transaction');

      if (insertedId !== null) {
        return {
          ...payload,
          id: insertedId,
          createdAt: Math.floor(Date.now() / 1000),
        };
      }
      return getTransactionBySourceSmsId(sms.id);
    } else {
      recordProcessingStatus(sms.id, 'ignored');
      return null;
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    recordProcessingStatus(sms.id, 'failed', errorMsg);
    return null;
  }
}

/**
 * Processes one batch of unprocessed SMS messages.
 */
export function processUnprocessedBatch(batchSize = 100): BatchProcessingResult {
  const unprocessed = getUnprocessedSms(batchSize);
  if (unprocessed.length === 0) {
    return { processed: 0, transactionsCreated: 0, hasMore: false };
  }

  let transactionsCreated = 0;
  const statusRecords: {
    smsId: number;
    status: 'transaction' | 'ignored' | 'failed';
    reason?: string;
  }[] = [];

  for (const sms of unprocessed) {
    try {
      const parsed = defaultParserRegistry.parse(sms.sender, sms.message, sms.received_at);

      if (parsed) {
        const payload: InsertTransactionPayload = {
          ...parsed,
          sourceSmsId: sms.id,
        };

        const insertedId = insertTransaction(payload);
        if (insertedId !== null) {
          transactionsCreated++;
        }
        statusRecords.push({ smsId: sms.id, status: 'transaction' });
      } else {
        statusRecords.push({ smsId: sms.id, status: 'ignored' });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      statusRecords.push({ smsId: sms.id, status: 'failed', reason: msg });
    }
  }

  // Record batch processing status
  recordProcessingStatusBatch(statusRecords);

  return {
    processed: unprocessed.length,
    transactionsCreated,
    hasMore: unprocessed.length === batchSize,
  };
}

/**
 * Processes all unprocessed SMS records in background chunks.
 * Yields periodically to keep the JS event loop responsive.
 */
export async function processAllUnprocessed(
  onProgress?: (processed: number, transactions: number) => void,
): Promise<ProcessingSummary> {
  let totalProcessed = 0;
  let totalTransactions = 0;
  let hasMore = true;

  while (hasMore) {
    const result = processUnprocessedBatch(150);
    totalProcessed += result.processed;
    totalTransactions += result.transactionsCreated;
    hasMore = result.hasMore;

    if (onProgress) {
      onProgress(totalProcessed, totalTransactions);
    }

    if (hasMore) {
      // Yield to event loop to avoid UI stutter
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  return { totalProcessed, totalTransactions };
}

/**
 * Resets processing status and re-evaluates all SMS records.
 */
export async function retryAllSms(
  onProgress?: (processed: number, transactions: number) => void,
): Promise<ProcessingSummary> {
  resetProcessingStatus();
  return processAllUnprocessed(onProgress);
}
