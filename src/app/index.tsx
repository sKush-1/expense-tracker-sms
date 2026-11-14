import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getAllSms, getSmsCount, insertSms } from '@/database/sms.repository';
import type { DbStatus, SmsMessage } from '@/types/sms';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(unixMs: number): string {
  return new Date(unixMs).toLocaleString();
}

/** Seed one sample record so Phase 1 verification can be run without SMS. */
function seedSampleSms(): void {
  insertSms({
    android_sms_id: 'sample-001',
    sender: '+91-9876543210',
    message: 'Your account was debited INR 500 on 14-Nov. Available balance: INR 10,000.',
    received_at: Date.now() - 60_000, // 1 minute ago
    message_type: 'inbox',
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function HomeScreen() {
  const [dbStatus, setDbStatus] = useState<DbStatus>({
    initialized: false,
    smsCount: 0,
    error: null,
  });
  const [messages, setMessages] = useState<SmsMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [seedMessage, setSeedMessage] = useState<string | null>(null);

  // Ref-based refresh counter: incrementing it triggers the data-load effect.
  const [refreshTick, setRefreshTick] = useState(0);

  // Load data whenever refreshTick changes (mount + explicit refresh).
  // setState is called synchronously because we're reading from a local
  // SQLite database — a fully synchronous native call. This is an intentional
  // pattern for initialising UI state from an offline local store.
  useEffect(() => {
    try {
      const count = getSmsCount();
      const latest = getAllSms(20);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDbStatus({ initialized: true, smsCount: count, error: null });
      setMessages(latest);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setDbStatus((prev) => ({ ...prev, error: message }));
    } finally {
      setLoading(false);
    }
  }, [refreshTick]);

  const refresh = useCallback(() => {
    setLoading(true);
    setSeedMessage(null);
    setRefreshTick((t) => t + 1);
  }, []);

  const loadData = refresh;

  const handleSeedSample = useCallback(() => {
    try {
      const before = getSmsCount();
      seedSampleSms();
      const after = getSmsCount();
      const inserted = after - before;
      setSeedMessage(
        inserted > 0
          ? '✅ Sample SMS inserted successfully.'
          : '⚠️ Sample SMS already exists (duplicate ignored).',
      );
      loadData();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSeedMessage(`❌ Error: ${message}`);
    }
  }, [loadData]);

  const handleRefresh = useCallback(() => {
    refresh();
  }, [refresh]);

  // ---- Render ----

  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color="#208AEF" />
        <Text style={styles.loadingText}>Initialising database…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* ── Status card ── */}
      <View style={styles.statusCard}>
        <Text style={styles.statusTitle}>Database Status</Text>

        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Initialized:</Text>
          <Text style={[styles.statusValue, dbStatus.initialized ? styles.ok : styles.error]}>
            {dbStatus.initialized ? '✅ Yes' : '❌ No'}
          </Text>
        </View>

        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Total SMS stored:</Text>
          <Text style={styles.statusValue}>{dbStatus.smsCount}</Text>
        </View>

        {dbStatus.error !== null && (
          <Text style={styles.errorText}>Error: {dbStatus.error}</Text>
        )}
      </View>

      {/* ── Action buttons ── */}
      <View style={styles.buttonRow}>
        <Pressable style={styles.button} onPress={handleSeedSample}>
          <Text style={styles.buttonText}>Insert Sample SMS</Text>
        </Pressable>
        <Pressable style={[styles.button, styles.secondaryButton]} onPress={handleRefresh}>
          <Text style={styles.buttonText}>Refresh</Text>
        </Pressable>
      </View>

      {/* ── Seed feedback ── */}
      {seedMessage !== null && (
        <Text style={styles.seedMessage}>{seedMessage}</Text>
      )}

      {/* ── Message list ── */}
      <Text style={styles.listHeader}>Latest Messages</Text>

      {messages.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No messages stored yet.</Text>
          <Text style={styles.emptySubtext}>
            Tap &quot;Insert Sample SMS&quot; to seed a test record.
          </Text>
        </View>
      ) : (
        <FlatList
          data={messages}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.messageCard}>
              <View style={styles.messageHeader}>
                <Text style={styles.sender} numberOfLines={1}>
                  {item.sender}
                </Text>
                <Text style={styles.timestamp}>{formatDate(item.received_at)}</Text>
              </View>
              <Text style={styles.messageBody} numberOfLines={3}>
                {item.message}
              </Text>
              <Text style={styles.metaText}>
                Type: {item.message_type} · ID: {item.android_sms_id ?? 'n/a'}
              </Text>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#f5f5f5',
  },
  loadingText: {
    fontSize: 15,
    color: '#555',
  },

  // Status card
  statusCard: {
    margin: 16,
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  statusTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111',
    marginBottom: 4,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusLabel: {
    fontSize: 14,
    color: '#555',
  },
  statusValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111',
  },
  ok: { color: '#22a85a' },
  error: { color: '#d93025' },
  errorText: {
    fontSize: 13,
    color: '#d93025',
    marginTop: 4,
  },

  // Buttons
  buttonRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 12,
    marginBottom: 8,
  },
  button: {
    flex: 1,
    backgroundColor: '#208AEF',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  secondaryButton: {
    backgroundColor: '#6c757d',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },

  // Seed feedback
  seedMessage: {
    marginHorizontal: 16,
    marginBottom: 8,
    fontSize: 13,
    color: '#333',
  },

  // List
  listHeader: {
    marginHorizontal: 16,
    marginBottom: 8,
    fontSize: 16,
    fontWeight: '700',
    color: '#111',
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 10,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 8,
  },
  emptyText: {
    fontSize: 16,
    color: '#555',
    fontWeight: '600',
  },
  emptySubtext: {
    fontSize: 13,
    color: '#888',
    textAlign: 'center',
  },

  // Message card
  messageCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    gap: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  messageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sender: {
    fontSize: 14,
    fontWeight: '700',
    color: '#208AEF',
    flex: 1,
    marginRight: 8,
  },
  timestamp: {
    fontSize: 11,
    color: '#888',
  },
  messageBody: {
    fontSize: 13,
    color: '#333',
    lineHeight: 18,
  },
  metaText: {
    fontSize: 11,
    color: '#aaa',
  },
});
