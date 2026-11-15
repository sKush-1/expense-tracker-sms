import { NativeModule, requireOptionalNativeModule } from 'expo';

import type { NativeSmsRecord, PendingSmsRecord } from './SmsReader.types';

/**
 * Type-safe interface for the native SmsReaderModule.
 *
 * All AsyncFunctions return Promises on the JS side.
 */
export declare class SmsReaderNativeModule extends NativeModule {
  /**
   * Synchronously checks whether READ_SMS permission is currently granted.
   * Does not trigger a permission dialog.
   */
  hasReadSmsPermission(): boolean;

  /**
   * Synchronously checks whether RECEIVE_SMS permission is currently granted.
   * Does not trigger a permission dialog.
   */
  hasReceiveSmsPermission(): boolean;

  /**
   * Synchronously computes the SHA-256 deduplication fingerprint
   * using sender, message, and receivedAt timestamp.
   */
  computeFingerprint(sender: string, message: string, receivedAt: number): string;

  /**
   * Reads one page of inbox messages.
   *
   * @param offset   Number of rows to skip (for pagination).
   * @param pageSize Maximum rows to return in this call.
   * @returns        Array of raw SMS records (newest first).
   * @throws         SMS_PERMISSION_DENIED if permission is not granted.
   * @throws         SMS_QUERY_ERROR on ContentResolver failure.
   */
  readInboxPage(offset: number, pageSize: number): Promise<NativeSmsRecord[]>;

  /**
   * Returns the total number of messages currently in the Android inbox.
   * Useful for showing progress during a large import.
   *
   * @throws SMS_PERMISSION_DENIED if permission is not granted.
   */
  getTotalInboxCount(): Promise<number>;

  /**
   * Drains messages from the durable native pending queue.
   * These are messages captured by SmsReceiver when direct SQLite write was locked.
   */
  drainPendingMessages(): Promise<PendingSmsRecord[]>;

  /**
   * Returns the count of messages currently waiting in the pending queue.
   */
  getPendingMessagesCount(): number;
}

export default requireOptionalNativeModule<SmsReaderNativeModule>('SmsReader');
