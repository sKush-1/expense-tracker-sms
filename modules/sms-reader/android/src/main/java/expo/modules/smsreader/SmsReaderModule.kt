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
 * Expo native module that provides:
 *   - Reading historical SMS messages from Android Content Provider
 *   - Checking READ_SMS and RECEIVE_SMS permissions
 *   - Draining durable pending queue messages captured by SmsReceiver
 *   - Computing deterministic SHA-256 SMS fingerprints
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
    // hasReceiveSmsPermission
    // Synchronously checks whether RECEIVE_SMS has been granted.
    // -----------------------------------------------------------------------
    Function("hasReceiveSmsPermission") {
      val context = appContext.reactContext
        ?: throw Exceptions.AppContextLost()

      ContextCompat.checkSelfPermission(
        context,
        android.Manifest.permission.RECEIVE_SMS,
      ) == PackageManager.PERMISSION_GRANTED
    }

    // -----------------------------------------------------------------------
    // computeFingerprint(sender, message, receivedAt)
    // Synchronously computes the SHA-256 deduplication fingerprint.
    // -----------------------------------------------------------------------
    Function("computeFingerprint") { sender: String, message: String, receivedAt: Long ->
      SmsFingerprint.compute(sender, message, receivedAt)
    }

    // -----------------------------------------------------------------------
    // drainPendingMessages()
    // Returns any messages that were queued by the SmsReceiver (when SQLite
    // was temporarily locked) and removes them from the pending queue.
    // -----------------------------------------------------------------------
    AsyncFunction("drainPendingMessages") {
      val context = appContext.reactContext
        ?: throw Exceptions.AppContextLost()

      val pending = SmsPendingQueue.drain(context)
      pending.map { msg ->
        mapOf(
          "sender" to msg.sender,
          "message" to msg.message,
          "received_at" to msg.receivedAt,
          "fingerprint" to msg.fingerprint
        )
      }
    }

    // -----------------------------------------------------------------------
    // getPendingMessagesCount()
    // Returns the count of pending messages in the queue.
    // -----------------------------------------------------------------------
    Function("getPendingMessagesCount") {
      val context = appContext.reactContext
        ?: throw Exceptions.AppContextLost()

      SmsPendingQueue.getPendingCount(context)
    }

    // -----------------------------------------------------------------------
    // readInboxPage(offset, pageSize)
    // Reads a single page of inbox messages from the SMS Content Provider.
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
            val address = if (addressIdx >= 0) cursor.getString(addressIdx) ?: "" else ""
            val body = if (bodyIdx >= 0) cursor.getString(bodyIdx) ?: "" else ""
            val date = if (dateIdx >= 0) cursor.getLong(dateIdx) else 0L
            val fingerprint = SmsFingerprint.compute(address, body, date)

            results.add(
              mapOf(
                "id"          to if (idIdx >= 0) cursor.getString(idIdx) else null,
                "address"     to address,
                "body"        to body,
                "date"        to date,
                "type"        to if (typeIdx >= 0) cursor.getInt(typeIdx) else 1,
                "fingerprint" to fingerprint,
              ),
            )
          }
        }
      } catch (e: SecurityException) {
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
