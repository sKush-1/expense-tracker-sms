package expo.modules.smsreader

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.nio.file.Files

class SmsPendingQueueTest {

  private lateinit var tempDir: File

  @Before
  fun setUp() {
    tempDir = Files.createTempDirectory("sms_queue_test").toFile()
  }

  @After
  fun tearDown() {
    tempDir.deleteRecursively()
  }

  @Test
  fun testQueueSurvivesAppInterruptionBeforeSync() {
    val fp1 = SmsFingerprint.compute("HDFC-BANK", "A/c debited by Rs 500", 1700000000000L)
    val fp2 = SmsFingerprint.compute("ICICI-BANK", "A/c credited by Rs 1000", 1700000001000L)

    SmsPendingQueue.enqueue(tempDir, "HDFC-BANK", "A/c debited by Rs 500", 1700000000000L, fp1)
    SmsPendingQueue.enqueue(tempDir, "ICICI-BANK", "A/c credited by Rs 1000", 1700000001000L, fp2)

    // Simulate process reading the queue without acknowledging (interrupted/killed before SQLite insert)
    val readFirstPass = SmsPendingQueue.getPendingMessages(tempDir)
    assertEquals(2, readFirstPass.size)

    // Verify queue file still exists on disk
    assertTrue("Queue file must still exist after reading", SmsPendingQueue.getQueueFile(tempDir).exists())

    // Simulate next app launch: queue is still intact
    val readSecondPass = SmsPendingQueue.getPendingMessages(tempDir)
    assertEquals(2, readSecondPass.size)
    assertEquals(fp1, readSecondPass[0].fingerprint)
    assertEquals(fp2, readSecondPass[1].fingerprint)
  }

  @Test
  fun testPartialFailureKeepsFailedMessagesInQueue() {
    val fp1 = SmsFingerprint.compute("SENDER-A", "Message 1", 1700000000000L)
    val fp2 = SmsFingerprint.compute("SENDER-B", "Message 2 (failed)", 1700000001000L)
    val fp3 = SmsFingerprint.compute("SENDER-C", "Message 3", 1700000002000L)

    SmsPendingQueue.enqueue(tempDir, "SENDER-A", "Message 1", 1700000000000L, fp1)
    SmsPendingQueue.enqueue(tempDir, "SENDER-B", "Message 2 (failed)", 1700000001000L, fp2)
    SmsPendingQueue.enqueue(tempDir, "SENDER-C", "Message 3", 1700000002000L, fp3)

    // Simulate SQLite persisting fp1 and fp3, but fp2 fails
    val acknowledged = listOf(fp1, fp3)
    val removed = SmsPendingQueue.acknowledge(tempDir, acknowledged)

    assertEquals(2, removed)

    // The unacknowledged message (fp2) MUST remain in the queue
    val remaining = SmsPendingQueue.getPendingMessages(tempDir)
    assertEquals(1, remaining.size)
    assertEquals(fp2, remaining[0].fingerprint)
    assertEquals("Message 2 (failed)", remaining[0].message)
  }

  @Test
  fun testSuccessfulSyncRemovesAcknowledgedMessages() {
    val fp1 = SmsFingerprint.compute("SENDER-1", "Msg 1", 1700000000000L)
    SmsPendingQueue.enqueue(tempDir, "SENDER-1", "Msg 1", 1700000000000L, fp1)

    assertEquals(1, SmsPendingQueue.getPendingCount(tempDir))

    // Acknowledge the message
    val removed = SmsPendingQueue.acknowledge(tempDir, listOf(fp1))
    assertEquals(1, removed)
    assertEquals(0, SmsPendingQueue.getPendingCount(tempDir))
    assertFalse("Queue file must be deleted when all messages are acknowledged", SmsPendingQueue.getQueueFile(tempDir).exists())
  }

  @Test
  fun testDuplicateEnqueueDoesNotCreateDuplicatePendingEntries() {
    val fp = SmsFingerprint.compute("SENDER-X", "Duplicate Broadcast", 1700000000000L)

    // Broadcast receiver receives duplicate intent
    SmsPendingQueue.enqueue(tempDir, "SENDER-X", "Duplicate Broadcast", 1700000000000L, fp)
    SmsPendingQueue.enqueue(tempDir, "SENDER-X", "Duplicate Broadcast", 1700000000000L, fp)

    val list = SmsPendingQueue.getPendingMessages(tempDir)
    assertEquals(1, list.size)
  }

  @Test
  fun testTimestampBasedFingerprintConsistency() {
    val sender = "CENTBK"
    val body = "A/c debited by Rs 200"
    val scTimestamp = 1794693025000L // Service Center timestamp (date_sent)

    // Receiver computes fingerprint using SmsMessage.timestampMillis
    val receiverFp = SmsFingerprint.compute(sender, body, scTimestamp)

    // Historical import computes fingerprint using Telephony.Sms.DATE_SENT
    val historicalImportFp = SmsFingerprint.compute(sender, body, scTimestamp)

    assertEquals("Receiver and ContentProvider fingerprints MUST be identical when using date_sent", receiverFp, historicalImportFp)
  }

  @Test
  fun testRepeatedIdenticalMessagesWithDifferentTimestampsNotDiscarded() {
    val sender = "CENTBK"
    val body = "Your OTP is 4920"

    // First OTP sent at 10:00:00
    val t1 = 1794693000000L
    val fp1 = SmsFingerprint.compute(sender, body, t1)

    // Second identical OTP sent 5 minutes later at 10:05:00
    val t2 = 1794693300000L
    val fp2 = SmsFingerprint.compute(sender, body, t2)

    assertNotEquals("Identical message content with different timestamps MUST produce different fingerprints", fp1, fp2)

    // Both can be enqueued into pending queue without collision
    SmsPendingQueue.enqueue(tempDir, sender, body, t1, fp1)
    SmsPendingQueue.enqueue(tempDir, sender, body, t2, fp2)

    val pending = SmsPendingQueue.getPendingMessages(tempDir)
    assertEquals(2, pending.size)
  }
}
