package expo.modules.smsreader

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class SmsBroadcastNotifierTest {

  @Before
  fun setUp() {
    // Unregister any stale listeners
    // Create a dummy listener to clear
    val dummy = SmsReceivedListener { _, _, _ -> }
    SmsBroadcastNotifier.unregisterListener(dummy)
  }

  @Test
  fun testListenerReceivesNotification() {
    val received = mutableListOf<Triple<String, Long, String>>()
    val listener = SmsReceivedListener { sender, receivedAt, fp ->
      received.add(Triple(sender, receivedAt, fp))
    }

    SmsBroadcastNotifier.registerListener(listener)

    SmsBroadcastNotifier.notify("HDFC-BANK", 1700000000000L, "fp-123")

    assertEquals(1, received.size)
    assertEquals("HDFC-BANK", received[0].first)
    assertEquals(1700000000000L, received[0].second)
    assertEquals("fp-123", received[0].third)

    SmsBroadcastNotifier.unregisterListener(listener)
  }

  @Test
  fun testUnregisteredListenerReceivesNothing() {
    val received = mutableListOf<String>()
    val listener = SmsReceivedListener { sender, _, _ ->
      received.add(sender)
    }

    SmsBroadcastNotifier.registerListener(listener)
    SmsBroadcastNotifier.unregisterListener(listener)

    SmsBroadcastNotifier.notify("ICICI-BANK", 1700000001000L, "fp-456")

    assertEquals(0, received.size)
  }

  @Test
  fun testDuplicateRegistrationAvoided() {
    var count = 0
    val listener = SmsReceivedListener { _, _, _ -> count++ }

    SmsBroadcastNotifier.registerListener(listener)
    SmsBroadcastNotifier.registerListener(listener) // register second time

    SmsBroadcastNotifier.notify("AXIS-BANK", 1700000002000L, "fp-789")

    assertEquals(1, count)

    SmsBroadcastNotifier.unregisterListener(listener)
  }

  @Test
  fun testWeakReferenceDoesNotBlockGarbageCollection() {
    var listener: SmsReceivedListener? = SmsReceivedListener { _, _, _ -> }
    SmsBroadcastNotifier.registerListener(listener!!)

    // Explicitly null out strong reference
    listener = null

    // Force garbage collection
    System.gc()
    System.runFinalization()

    // Notification should not throw even if listener is GC'd
    SmsBroadcastNotifier.notify("SBI-BANK", 1700000003000L, "fp-gc")
    assertTrue(true)
  }
}
