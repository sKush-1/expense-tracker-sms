package expo.modules.smsreader

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Durable native queue for incoming SMS messages that could not be written
 * directly to SQLite (e.g. if database was locked, busy, or unavailable).
 *
 * Persists messages in a local JSON file inside the app's private filesDir.
 *
 * Uses a Crash-Safe Read/Acknowledge pattern:
 * 1. JavaScript reads pending messages via getPendingMessages() - file is NOT deleted.
 * 2. JavaScript attempts to persist each message into SQLite.
 * 3. JavaScript calls acknowledge() ONLY with the fingerprints that were successfully persisted
 *    or were confirmed to already exist in SQLite as duplicates.
 * 4. acknowledge() atomically updates the queue file to remove only acknowledged messages.
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

  fun getQueueFile(filesDir: File): File {
    return File(filesDir, QUEUE_FILE_NAME)
  }

  fun getQueueFile(context: Context): File {
    return getQueueFile(context.filesDir)
  }

  /**
   * Enqueues an incoming SMS message atomically into the pending queue.
   */
  fun enqueue(
    filesDir: File,
    sender: String,
    message: String,
    receivedAt: Long,
    fingerprint: String
  ) {
    synchronized(lock) {
      try {
        val file = getQueueFile(filesDir)
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

        // Write atomically via temporary file replacement
        val tempFile = File(filesDir, "$QUEUE_FILE_NAME.tmp")
        tempFile.writeText(jsonArray.toString())
        tempFile.renameTo(file)
      } catch (e: Exception) {
        Log.e(TAG, "Failed to enqueue pending SMS", e)
      }
    }
  }

  fun enqueue(
    context: Context,
    sender: String,
    message: String,
    receivedAt: Long,
    fingerprint: String
  ) {
    enqueue(context.filesDir, sender, message, receivedAt, fingerprint)
  }

  /**
   * Reads all pending messages from the queue WITHOUT deleting them.
   * Crash-safe: Messages remain on disk until explicitly acknowledged.
   */
  fun getPendingMessages(filesDir: File): List<PendingMessage> {
    synchronized(lock) {
      val file = getQueueFile(filesDir)
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
      } catch (e: Exception) {
        Log.e(TAG, "Failed to read pending SMS queue", e)
      }
      return list
    }
  }

  fun getPendingMessages(context: Context): List<PendingMessage> {
    return getPendingMessages(context.filesDir)
  }

  /**
   * Atomically removes only the acknowledged fingerprints from the pending queue.
   * Any unacknowledged messages (e.g. from partial failure or crash) remain in the queue.
   *
   * @param filesDir App private files directory.
   * @param fingerprints List of fingerprints to remove.
   * @return Count of messages successfully removed from the queue.
   */
  fun acknowledge(filesDir: File, fingerprints: List<String>): Int {
    if (fingerprints.isEmpty()) return 0

    synchronized(lock) {
      val file = getQueueFile(filesDir)
      if (!file.exists()) return 0

      val toRemove = fingerprints.toSet()
      var removedCount = 0

      try {
        val content = file.readText()
        if (content.isBlank()) {
          file.delete()
          return 0
        }

        val jsonArray = JSONArray(content)
        val remainingArray = JSONArray()

        for (i in 0 until jsonArray.length()) {
          val obj = jsonArray.getJSONObject(i)
          val fp = obj.optString("fingerprint")
          if (toRemove.contains(fp)) {
            removedCount++
          } else {
            remainingArray.put(obj)
          }
        }

        if (remainingArray.length() == 0) {
          file.delete()
          val tempFile = File(filesDir, "$QUEUE_FILE_NAME.tmp")
          if (tempFile.exists()) tempFile.delete()
        } else {
          // Atomically write back remaining unacknowledged messages
          val tempFile = File(filesDir, "$QUEUE_FILE_NAME.tmp")
          tempFile.writeText(remainingArray.toString())
          tempFile.renameTo(file)
        }
      } catch (e: Exception) {
        Log.e(TAG, "Failed to acknowledge pending messages", e)
      }

      return removedCount
    }
  }

  fun acknowledge(context: Context, fingerprints: List<String>): Int {
    return acknowledge(context.filesDir, fingerprints)
  }

  fun drain(filesDir: File): List<PendingMessage> {
    val messages = getPendingMessages(filesDir)
    if (messages.isNotEmpty()) {
      acknowledge(filesDir, messages.map { it.fingerprint })
    }
    return messages
  }

  fun drain(context: Context): List<PendingMessage> {
    return drain(context.filesDir)
  }

  fun getPendingCount(filesDir: File): Int {
    synchronized(lock) {
      val file = getQueueFile(filesDir)
      if (!file.exists()) return 0
      return try {
        val content = file.readText()
        if (content.isNotBlank()) JSONArray(content).length() else 0
      } catch (e: Exception) {
        0
      }
    }
  }

  fun getPendingCount(context: Context): Int {
    return getPendingCount(context.filesDir)
  }
}
