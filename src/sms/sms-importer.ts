import { insertSmsBatch } from '@/database/sms.repository';
import type { InsertSmsPayload } from '@/types/sms';
import type { ImportResult } from '../../modules/sms-reader';

import { checkSmsPermission, readInboxPage, requestSmsPermission } from './sms-reader';

export interface ImportOptions {
  /** Number of messages to query and insert in each batch. Defaults to 100. */
  batchSize?: number;
  /** Callback fired as batches are processed. */
  onProgress?: (progress: { read: number; inserted: number; duplicates: number }) => void;
}

/**
 * Imports all historical SMS messages from the Android inbox into the local SQLite database.
 *
 * Messages are fetched in paginated batches to keep memory usage low even with
 * thousands of messages in the inbox.
 *
 * Each batch is inserted using `insertSmsBatch()` inside a transaction, which
 * uses `INSERT OR IGNORE` on the unique `android_sms_id`.
 *
 * Returns detailed stats on total read, new inserts, and duplicates skipped.
 */
export async function importExistingSms(options: ImportOptions = {}): Promise<ImportResult> {
  const batchSize = options.batchSize ?? 100;

  // 1. Check or request permission
  let hasPermission = await checkSmsPermission();
  if (!hasPermission) {
    hasPermission = await requestSmsPermission();
    if (!hasPermission) {
      throw new Error('READ_SMS permission was denied. Cannot import messages.');
    }
  }

  let offset = 0;
  let totalRead = 0;
  let totalInserted = 0;
  let hasMore = true;

  // 2. Fetch and persist in batches
  while (hasMore) {
    const rawBatch = await readInboxPage(offset, batchSize);

    if (!rawBatch || rawBatch.length === 0) {
      break;
    }

    totalRead += rawBatch.length;

    // Convert raw native records to repository payloads
    const payloads: InsertSmsPayload[] = rawBatch.map((item) => ({
      android_sms_id: item.id != null ? String(item.id) : null,
      sender: item.address || 'Unknown',
      message: item.body || '',
      received_at: item.date || Date.now(),
      message_type: 'inbox',
    }));

    // Batch insert into SQLite (INSERT OR IGNORE)
    const insertedInBatch = insertSmsBatch(payloads);
    totalInserted += insertedInBatch;

    options.onProgress?.({
      read: totalRead,
      inserted: totalInserted,
      duplicates: totalRead - totalInserted,
    });

    if (rawBatch.length < batchSize) {
      hasMore = false;
    } else {
      offset += batchSize;
    }
  }

  const duplicates = totalRead - totalInserted;

  return {
    totalRead,
    inserted: totalInserted,
    duplicates,
  };
}
