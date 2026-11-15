package expo.modules.smsreader

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.util.Log
import java.io.File

/**
 * Native SQLite helper for direct database writes from the Android BroadcastReceiver.
 *
 * Points directly to the existing Expo SQLite database file:
 *   [context.filesDir]/SQLite/sms_tracker.db
 *
 * Direct native access allows incoming SMS messages to be persisted even when
 * the React Native JavaScript runtime is not active.
 */
object SmsDatabaseHelper {
  private const val TAG = "SmsDatabaseHelper"
  private const val DB_DIR_NAME = "SQLite"
  private const val DB_FILE_NAME = "sms_tracker.db"
  private const val TABLE_NAME = "sms_messages"

  fun getDatabaseFile(context: Context): File {
    val dir = File(context.filesDir, DB_DIR_NAME)
    if (!dir.exists()) {
      dir.mkdirs()
    }
    return File(dir, DB_FILE_NAME)
  }

  /**
   * Persists an incoming SMS message directly into SQLite.
   *
   * @return true if successfully persisted (or duplicate ignored), false on error.
   */
  fun insertIncomingSms(
    context: Context,
    sender: String,
    message: String,
    receivedAt: Long
  ): Boolean {
    val dbFile = getDatabaseFile(context)
    val fingerprint = SmsFingerprint.compute(sender, message, receivedAt)

    var db: SQLiteDatabase? = null
    return try {
      db = SQLiteDatabase.openDatabase(
        dbFile.path,
        null,
        SQLiteDatabase.OPEN_READWRITE or SQLiteDatabase.CREATE_IF_NECESSARY
      )

      // Ensure WAL mode is active for safe concurrent multi-process access
      db.enableWriteAheadLogging()

      // Ensure schema exists in case app hasn't been opened yet
      ensureSchema(db)

      val values = ContentValues().apply {
        put("android_sms_id", "recv_$fingerprint")
        put("sender", sender)
        put("message", message)
        put("received_at", receivedAt)
        put("message_type", "inbox")
        put("fingerprint", fingerprint)
      }

      // SQLiteDatabase.CONFLICT_IGNORE corresponds to INSERT OR IGNORE
      val rowId = db.insertWithOnConflict(
        TABLE_NAME,
        null,
        values,
        SQLiteDatabase.CONFLICT_IGNORE
      )

      Log.i(TAG, "Persisted incoming SMS (rowId: $rowId, fingerprint: ${fingerprint.take(12)}...)")
      true
    } catch (e: Exception) {
      Log.e(TAG, "Failed to persist incoming SMS directly to SQLite", e)
      false
    } finally {
      try {
        db?.close()
      } catch (ignored: Exception) {}
    }
  }

  private fun ensureSchema(db: SQLiteDatabase) {
    db.execSQL("""
      CREATE TABLE IF NOT EXISTS sms_messages (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        android_sms_id TEXT UNIQUE,
        sender         TEXT NOT NULL,
        message        TEXT NOT NULL,
        received_at    INTEGER NOT NULL,
        message_type   TEXT DEFAULT 'inbox',
        created_at     INTEGER DEFAULT (strftime('%s', 'now')),
        fingerprint    TEXT
      );
    """.trimIndent())

    db.execSQL("""
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_fingerprint
      ON sms_messages (fingerprint);
    """.trimIndent())

    db.execSQL("""
      CREATE INDEX IF NOT EXISTS idx_sms_sender
      ON sms_messages (sender);
    """.trimIndent())

    db.execSQL("""
      CREATE INDEX IF NOT EXISTS idx_sms_received_at
      ON sms_messages (received_at DESC);
    """.trimIndent())
  }
}
