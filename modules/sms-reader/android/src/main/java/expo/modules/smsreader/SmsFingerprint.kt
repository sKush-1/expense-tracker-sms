package expo.modules.smsreader

import java.security.MessageDigest

/**
 * Computes a deterministic SHA-256 fingerprint for an SMS message.
 *
 * Combines:
 * - sender address (trimmed)
 * - received timestamp in milliseconds
 * - complete message body
 *
 * This fingerprint is identical whether the message is captured via
 * BroadcastReceiver or imported from the Android Content Provider.
 */
object SmsFingerprint {
  fun compute(sender: String, message: String, receivedAt: Long): String {
    val raw = "${sender.trim()}|$receivedAt|$message"
    val digest = MessageDigest.getInstance("SHA-256")
    val hashBytes = digest.digest(raw.toByteArray(Charsets.UTF_8))
    return hashBytes.joinToString("") { "%02x".format(it) }
  }
}
