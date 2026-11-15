import { PermissionsAndroid, Platform } from 'react-native';

import { SmsReaderModule } from '../../modules/sms-reader';
import type { NativeSmsRecord } from '../../modules/sms-reader';

/**
 * Checks whether the application has been granted READ_SMS permission.
 */
export async function checkSmsPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return false;
  }

  try {
    // Check via native module if available
    if (SmsReaderModule?.hasReadSmsPermission) {
      return SmsReaderModule.hasReadSmsPermission();
    }
    // Fallback to React Native PermissionsAndroid
    return await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS);
  } catch (err) {
    console.warn('[sms-reader] Failed to check SMS permission:', err);
    return false;
  }
}

/**
 * Requests the Android READ_SMS runtime permission with rationale dialog.
 */
export async function requestSmsPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return false;
  }

  try {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.READ_SMS,
      {
        title: 'SMS Permission Required',
        message:
          'This app needs permission to read SMS messages to import your financial transactions.',
        buttonPositive: 'Grant Permission',
        buttonNegative: 'Deny',
      },
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } catch (err) {
    console.error('[sms-reader] Failed to request SMS permission:', err);
    return false;
  }
}

/**
 * Reads a single page of inbox messages via the native Android ContentResolver.
 *
 * @param offset   Starting row index
 * @param pageSize Maximum number of messages to fetch in this page
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
