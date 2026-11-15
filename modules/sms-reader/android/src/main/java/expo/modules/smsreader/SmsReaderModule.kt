package expo.modules.smsreader

import android.content.pm.PackageManager
import android.provider.Telephony
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * SmsReaderModule
 *
 * Expo native module that reads historical SMS messages from the Android inbox
 * using ContentResolver + Telephony.Sms.Inbox.CONTENT_URI.
 *
 * Exposed JS functions:
 *   - hasReadSmsPermission(): Boolean
 *   - readInboxPage(offset: Int, pageSize: Int): List<Map<String, Any?>>
 *
 * Permission management (runtime PermissionsAndroid.request) is handled on the
 * TypeScript side so the UI can show appropriate rationale dialogs.
 */
class SmsReaderModule : Module() {

  override fun definition() = ModuleDefinition {

    Name("SmsReader")

    // -----------------------------------------------------------------------
    // hasReadSmsPermission
    // Synchronously checks whether READ_SMS has been granted.
    // -----------------------------------------------------------------------
    Function("hasReadSmsPermission") {
      val context = appContext.reactContext
        ?: throw Exceptions.AppContextLost()

      ContextCompat.checkSelfPermission(
        context,
        android.Manifest.permission.READ_SMS,
      ) == PackageManager.PERMISSION_GRANTED
    }

    // -----------------------------------------------------------------------
    // readInboxPage(offset, pageSize)
    // Reads a single page of inbox messages from the SMS Content Provider.
    //
    // Returns a list of maps, each with:
    //   id        – Android's internal SMS _ID (String)
    //   address   – sender phone number / address (String)
    //   body      – message body (String)
    //   date      – received timestamp in Unix milliseconds (Long)
    //   type      – message type constant (Int, always 1 = inbox)
    //
    // Ordering: newest messages first (DATE DESC).
    //
    // Throws:
    //   - SmsPermissionDeniedException if READ_SMS is not granted.
    //   - SmsQueryException on ContentResolver failure.
    // -----------------------------------------------------------------------
    AsyncFunction("readInboxPage") { offset: Int, pageSize: Int ->
      val context = appContext.reactContext
        ?: throw Exceptions.AppContextLost()

      // Guard: permission must be granted before querying.
      if (ContextCompat.checkSelfPermission(
          context,
          android.Manifest.permission.READ_SMS,
        ) != PackageManager.PERMISSION_GRANTED
      ) {
        throw SmsPermissionDeniedException()
      }

      val results = mutableListOf<Map<String, Any?>>()

      val projection = arrayOf(
        Telephony.Sms._ID,
        Telephony.Sms.ADDRESS,
        Telephony.Sms.BODY,
        Telephony.Sms.DATE,
        Telephony.Sms.TYPE,
      )

      // Sort by DATE descending so the newest messages come first.
      // Pagination is done via LIMIT/OFFSET appended to the sort order —
      // this is supported by the standard Android SMS Content Provider.
      val sortOrder = "${Telephony.Sms.DATE} DESC LIMIT $pageSize OFFSET $offset"

      try {
        context.contentResolver.query(
          Telephony.Sms.Inbox.CONTENT_URI,
          projection,
          null,  // selection — inbox type is implied by the URI
          null,  // selectionArgs
          sortOrder,
        )?.use { cursor ->
          val idIdx      = cursor.getColumnIndex(Telephony.Sms._ID)
          val addressIdx = cursor.getColumnIndex(Telephony.Sms.ADDRESS)
          val bodyIdx    = cursor.getColumnIndex(Telephony.Sms.BODY)
          val dateIdx    = cursor.getColumnIndex(Telephony.Sms.DATE)
          val typeIdx    = cursor.getColumnIndex(Telephony.Sms.TYPE)

          while (cursor.moveToNext()) {
            results.add(
              mapOf(
                "id"      to if (idIdx >= 0) cursor.getString(idIdx) else null,
                "address" to if (addressIdx >= 0) cursor.getString(addressIdx) else "",
                "body"    to if (bodyIdx >= 0) cursor.getString(bodyIdx) else "",
                "date"    to if (dateIdx >= 0) cursor.getLong(dateIdx) else 0L,
                "type"    to if (typeIdx >= 0) cursor.getInt(typeIdx) else 1,
              ),
            )
          }
        }
      } catch (e: SecurityException) {
        // Should not happen after our guard, but handle defensively.
        throw SmsPermissionDeniedException()
      } catch (e: Exception) {
        throw SmsQueryException(e.message ?: "Unknown query error")
      }

      results
    }

    // -----------------------------------------------------------------------
    // getTotalInboxCount()
    // Returns the total number of messages in the inbox (for progress UI).
    // -----------------------------------------------------------------------
    AsyncFunction("getTotalInboxCount") {
      val context = appContext.reactContext
        ?: throw Exceptions.AppContextLost()

      if (ContextCompat.checkSelfPermission(
          context,
          android.Manifest.permission.READ_SMS,
        ) != PackageManager.PERMISSION_GRANTED
      ) {
        throw SmsPermissionDeniedException()
      }

      var count = 0

      try {
        context.contentResolver.query(
          Telephony.Sms.Inbox.CONTENT_URI,
          arrayOf(Telephony.Sms._ID),
          null,
          null,
          null,
        )?.use { cursor ->
          count = cursor.count
        }
      } catch (e: Exception) {
        throw SmsQueryException(e.message ?: "Count query failed")
      }

      count
    }
  }
}
