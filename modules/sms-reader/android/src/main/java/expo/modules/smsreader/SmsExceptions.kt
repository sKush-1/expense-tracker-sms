package expo.modules.smsreader

import expo.modules.kotlin.exception.CodedException

/**
 * Thrown when READ_SMS permission has not been granted by the user.
 */
class SmsPermissionDeniedException :
  CodedException("SMS_PERMISSION_DENIED", "READ_SMS permission is not granted.", null)

/**
 * Thrown when the ContentResolver query fails for any reason other than
 * a missing permission (e.g., the SMS content provider is unavailable).
 */
class SmsQueryException(reason: String) :
  CodedException("SMS_QUERY_ERROR", "SMS ContentResolver query failed: $reason", null)
