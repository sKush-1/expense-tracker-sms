package expo.modules.smsreader

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Durable native queue for incoming SMS messages that could not be written
 * directly to SQLite (e.g. if database was locked or unavailable).
 *
 * Persists messages in a local JSON file inside the app's private filesDir.
 * Synchronized into SQLite on app startup.
 */
object SmsPendingQueue {
  private const val TAG = "SmsPendingQueue"
  private const val QUEUE_FILE_NAME = "sms_pending_queue.json"
  private val lock = Any()

  data class PendingMessage(
    val sender: String,
    val message: String,
    val receivedAt: Long,
    val fingerprint: String
  )

  private fun getQueueFile(context: Context): File {
    return File(context.filesDir, QUEUE_FILE_NAME)
  }

  fun enqueue(
    context: Context,
    sender: String,
    message: String,
    receivedAt: Long,
    fingerprint: String
  ) {
    synchronized(lock) {
      try {
        val file = getQueueFile(context)
        val jsonArray = if (file.exists()) {
          val content = file.readText()
          if (content.isNotBlank()) JSONArray(content) else JSONArray()
        } else {
          JSONArray()
        }

        // Avoid adding duplicate fingerprints to the queue
        for (i in 0 until jsonArray.length()) {
          val item = jsonArray.getJSONObject(i)
          if (item.optString("fingerprint") == fingerprint) {
            Log.d(TAG, "Message already in pending queue; skipping duplicate enqueue")
            return
          }
        }

        val obj = JSONObject().apply {
          put("sender", sender)
          put("message", message)
          put("receivedAt", receivedAt)
          put("fingerprint", fingerprint)
        }
        jsonArray.put(obj)

        // Write atomically
        val tempFile = File(context.filesDir, "$QUEUE_FILE_NAME.tmp")
        tempFile.writeText(jsonArray.toString())
        tempFile.renameTo(file)

        Log.d(TAG, "Enqueued pending message (total in queue: ${jsonArray.length()})")
      } catch (e: Exception) {
        Log.e(TAG, "Failed to enqueue pending SMS", e)
      }
    }
  }

  fun drain(context: Context): List<PendingMessage> {
    synchronized(lock) {
      val file = getQueueFile(context)
      if (!file.exists()) return emptyList()

      val list = mutableListOf<PendingMessage>()
      try {
        val content = file.readText()
        if (content.isNotBlank()) {
          val jsonArray = JSONArray(content)
          for (i in 0 until jsonArray.length()) {
            val obj = jsonArray.getJSONObject(i)
            list.add(
              PendingMessage(
                sender = obj.getString("sender"),
                message = obj.getString("message"),
                receivedAt = obj.getLong("receivedAt"),
                fingerprint = obj.getString("fingerprint")
              )
            )
          }
        }
        // Delete queue file once read
        file.delete()
      } catch (e: Exception) {
        Log.e(TAG, "Failed to drain pending SMS queue", e)
      }
      return list
    }
  }

  fun getPendingCount(context: Context): Int {
    synchronized(lock) {
      val file = getQueueFile(context)
      if (!file.exists()) return 0
      return try {
        val content = file.readText()
        if (content.isNotBlank()) JSONArray(content).length() else 0
      } catch (e: Exception) {
        0
      }
    }
  }
}
