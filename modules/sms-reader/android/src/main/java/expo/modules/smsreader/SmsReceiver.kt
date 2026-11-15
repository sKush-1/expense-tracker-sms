package expo.modules.smsreader

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.util.Log

/**
 * BroadcastReceiver for automatically capturing incoming SMS messages.
 *
 * Registered in AndroidManifest.xml for android.provider.Telephony.SMS_RECEIVED.
 *
 * This receiver executes even when the React Native application process has been killed.
 * It persists messages directly into the local SQLite database used by Expo SQLite,
 * falling back to a durable native queue if SQLite access is temporarily unavailable.
 */
class SmsReceiver : BroadcastReceiver() {

  companion object {
    private const val TAG = "SmsReceiver"
  }

  override fun onReceive(context: Context, intent: Intent?) {
    if (intent == null || intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) {
      return
    }

    try {
      val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
      if (messages.isNullOrEmpty()) {
        Log.w(TAG, "SMS_RECEIVED intent contained no message parts (PDUs were null or empty)")
        return
      }

      // Group multipart message segments by sender and timestamp.
      // Multipart messages share the same originating address and timestamp.
      val grouped = messages.groupBy { sms ->
        val sender = sms.displayOriginatingAddress ?: sms.originatingAddress ?: "Unknown"
        val rawTimestamp = sms.timestampMillis
        val timestamp = if (rawTimestamp > 0L) rawTimestamp else System.currentTimeMillis()
        Pair(sender, timestamp)
      }

      for ((key, parts) in grouped) {
        val (sender, timestamp) = key

        // Concatenate all parts to reconstruct the complete message body
        val bodyBuilder = StringBuilder()
        for (part in parts) {
          val bodyPart = part.displayMessageBody ?: part.messageBody ?: ""
          bodyBuilder.append(bodyPart)
        }
        val fullBody = bodyBuilder.toString()
        val fingerprint = SmsFingerprint.compute(sender, fullBody, timestamp)

        Log.i(TAG, "Received incoming SMS from $sender (length: ${fullBody.length}, timestamp: $timestamp)")

        // 1. Attempt direct persistence into SQLite
        val persistedDirectly = SmsDatabaseHelper.insertIncomingSms(
          context = context,
          sender = sender,
          message = fullBody,
          receivedAt = timestamp
        )

        // 2. If direct write failed (e.g. SQLite locked), save to durable pending queue
        if (!persistedDirectly) {
          Log.w(TAG, "Direct SQLite insert failed; saving to durable pending queue")
          SmsPendingQueue.enqueue(
            context = context,
            sender = sender,
            message = fullBody,
            receivedAt = timestamp,
            fingerprint = fingerprint
          )
        }
      }
    } catch (e: Exception) {
      // Log error safely without exposing message content
      Log.e(TAG, "Error processing incoming SMS broadcast: ${e.javaClass.simpleName}: ${e.message}")
    }
  }
}
