import { PermissionsAndroid, Platform } from 'react-native';

import { insertSms } from '@/database/sms.repository';

import { SmsReaderModule } from '../../modules/sms-reader';
import type { NativeSmsRecord } from '../../modules/sms-reader';

export interface SmsPermissionsStatus {
  read: boolean;
  receive: boolean;
}

/**
 * Checks whether READ_SMS permission is granted.
 */
export async function checkReadSmsPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;

  try {
    if (SmsReaderModule?.hasReadSmsPermission) {
      return SmsReaderModule.hasReadSmsPermission();
    }
    return await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS);
  } catch (err) {
    console.warn('[sms-reader] Failed to check READ_SMS permission:', err);
    return false;
  }
}

/**
 * Checks whether RECEIVE_SMS permission is granted.
 */
export async function checkReceiveSmsPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;

  try {
    if (SmsReaderModule?.hasReceiveSmsPermission) {
      return SmsReaderModule.hasReceiveSmsPermission();
    }
    return await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS);
  } catch (err) {
    console.warn('[sms-reader] Failed to check RECEIVE_SMS permission:', err);
    return false;
  }
}

/**
 * Checks both READ_SMS and RECEIVE_SMS permissions.
 */
export async function checkSmsPermissions(): Promise<SmsPermissionsStatus> {
  const [read, receive] = await Promise.all([
    checkReadSmsPermission(),
    checkReceiveSmsPermission(),
  ]);
  return { read, receive };
}

/**
 * Backward compatibility alias for checking READ_SMS.
 */
export async function checkSmsPermission(): Promise<boolean> {
  return checkReadSmsPermission();
}

/**
 * Requests both READ_SMS and RECEIVE_SMS runtime permissions.
 */
export async function requestSmsPermissions(): Promise<SmsPermissionsStatus> {
  if (Platform.OS !== 'android') {
    return { read: false, receive: false };
  }

  try {
    const results = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.READ_SMS,
      PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
    ]);

    const read = results[PermissionsAndroid.PERMISSIONS.READ_SMS] === PermissionsAndroid.RESULTS.GRANTED;
    const receive = results[PermissionsAndroid.PERMISSIONS.RECEIVE_SMS] === PermissionsAndroid.RESULTS.GRANTED;

    return { read, receive };
  } catch (err) {
    console.error('[sms-reader] Failed to request SMS permissions:', err);
    return { read: false, receive: false };
  }
}

/**
 * Backward compatibility alias for requesting permissions.
 */
export async function requestSmsPermission(): Promise<boolean> {
  const result = await requestSmsPermissions();
  return result.read;
}

/**
 * Computes deterministic SHA-256 fingerprint for an SMS message.
 */
export function computeSmsFingerprint(
  sender: string,
  message: string,
  receivedAt: number,
): string {
  if (SmsReaderModule?.computeFingerprint) {
    return SmsReaderModule.computeFingerprint(sender, message, receivedAt);
  }
  return `${sender.trim()}_${receivedAt}_${message.length}`;
}

/**
 * Synchronizes any pending SMS messages queued by SmsReceiver.
 *
 * Implements a crash-safe read/acknowledge pattern:
 * 1. Reads pending messages without deleting them from disk.
 * 2. Attempts to persist each message into SQLite.
 * 3. Acknowledges only messages that were successfully inserted or already
 *    confirmed as existing duplicates in SQLite.
 * 4. Failed messages remain in the queue for future retry.
 *
 * @returns Number of newly inserted messages from the pending queue.
 */
export async function syncPendingMessages(): Promise<number> {
  if (Platform.OS !== 'android') {
    return 0;
  }

  try {
    // 1. Read pending messages without deleting them from disk
    const pending = SmsReaderModule?.getPendingMessages
      ? await SmsReaderModule.getPendingMessages()
      : SmsReaderModule?.drainPendingMessages
        ? await SmsReaderModule.drainPendingMessages()
        : [];

    if (!pending || pending.length === 0) {
      return 0;
    }

    const acknowledgedFingerprints: string[] = [];
    let newlyInsertedCount = 0;

    // 2. Persist each message into SQLite with isolation
    for (const msg of pending) {
      try {
        const result = insertSms({
          android_sms_id: `recv_${msg.fingerprint}`,
          sender: msg.sender,
          message: msg.message,
          received_at: msg.received_at,
          message_type: 'inbox',
          fingerprint: msg.fingerprint,
        });

        // result.changes === 1 -> newly inserted
        // result.changes === 0 -> already existed in SQLite (duplicate)
        // In both cases, the message is durable in SQLite
        acknowledgedFingerprints.push(msg.fingerprint);
        if (result.changes > 0) {
          newlyInsertedCount++;
        }
      } catch (insertErr) {
        // Do NOT acknowledge this message so it remains in the queue for retry
        console.error(
          `[sms-reader] Failed to persist pending message (fingerprint: ${msg.fingerprint.slice(0, 8)}...):`,
          insertErr,
        );
      }
    }

    // 3. Atomically acknowledge ONLY the successfully persisted/duplicate messages
    if (acknowledgedFingerprints.length > 0 && SmsReaderModule?.acknowledgePendingMessages) {
      await SmsReaderModule.acknowledgePendingMessages(acknowledgedFingerprints);
    }

    return newlyInsertedCount;
  } catch (err) {
    console.error('[sms-reader] Failed to sync pending messages:', err);
    return 0;
  }
}

/**
 * Reads a single page of inbox messages via the native Android ContentResolver.
 */
export async function readInboxPage(
  offset: number,
  pageSize: number,
): Promise<NativeSmsRecord[]> {
  if (Platform.OS !== 'android') {
    throw new Error('Reading SMS is only supported on Android devices.');
  }

  if (!SmsReaderModule) {
    throw new Error(
      'SmsReader native module is not available. Please ensure you are running a custom development build (not Expo Go).',
    );
  }

  return await SmsReaderModule.readInboxPage(offset, pageSize);
}

/**
 * Retrieves the total count of messages currently in the Android inbox.
 */
export async function getInboxCount(): Promise<number> {
  if (Platform.OS !== 'android') {
    return 0;
  }

  if (!SmsReaderModule) {
    throw new Error(
      'SmsReader native module is not available. Please ensure you are running a custom development build (not Expo Go).',
    );
  }

  return await SmsReaderModule.getTotalInboxCount();
}
