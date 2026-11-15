package expo.modules.smsreader

import android.util.Log
import java.lang.ref.WeakReference
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Interface implemented by listeners wanting notifications when new SMS messages are received.
 */
fun interface SmsReceivedListener {
  fun onSmsReceived(sender: String, receivedAt: Long, fingerprint: String)
}

/**
 * Thread-safe, leak-free broadcast notifier connecting [SmsReceiver] with [SmsReaderModule].
 *
 * Uses [WeakReference] to ensure no static reference prevents the garbage collection
 * of destroyed React Native module instances.
 */
object SmsBroadcastNotifier {
  private const val TAG = "SmsBroadcastNotifier"
  private val listeners = CopyOnWriteArrayList<WeakReference<SmsReceivedListener>>()

  /**
   * Registers a listener with a weak reference.
   */
  fun registerListener(listener: SmsReceivedListener) {
    // Purge dead references first
    listeners.removeAll { it.get() == null }
    // Avoid duplicate registration
    if (listeners.none { it.get() === listener }) {
      listeners.add(WeakReference(listener))
      Log.i(TAG, "Registered SMS listener. Active count: ${listeners.size}")
    }
  }

  fun unregisterListener(listener: SmsReceivedListener) {
    listeners.removeAll { it.get() == null || it.get() === listener }
    Log.i(TAG, "Unregistered SMS listener. Remaining count: ${listeners.size}")
  }

  fun getActiveListenerCount(): Int {
    listeners.removeAll { it.get() == null }
    return listeners.size
  }

  fun notify(sender: String, receivedAt: Long, fingerprint: String) {
    listeners.removeAll { it.get() == null }
    Log.i(TAG, "Notifying listeners of SMS from $sender. Active listeners: ${listeners.size}")
    for (ref in listeners) {
      val listener = ref.get() ?: continue
      try {
        listener.onSmsReceived(sender, receivedAt, fingerprint)
      } catch (e: Exception) {
        Log.w(TAG, "Failed to deliver onSmsReceived event to listener: ${e.message}")
      }
    }
  }
}
