import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getAllSms, getSmsCount } from '@/database/sms.repository';
import { importExistingSms } from '@/sms/sms-importer';
import { checkSmsPermission, requestSmsPermission } from '@/sms/sms-reader';
import type { DbStatus, SmsMessage } from '@/types/sms';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(unixMs: number): string {
  return new Date(unixMs).toLocaleString();
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
  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<SmsMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  // Ref-based refresh counter: incrementing it triggers the data-load effect.
  const [refreshTick, setRefreshTick] = useState(0);

  // Load data whenever refreshTick changes (mount + explicit refresh).
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

    // Check permission status
    checkSmsPermission()
      .then((granted) => setPermissionGranted(granted))
      .catch(() => setPermissionGranted(false));
  }, [refreshTick]);

  const refresh = useCallback(() => {
    setLoading(true);
    setStatusBanner(null);
    setRefreshTick((t) => t + 1);
  }, []);

  const handleImportExistingSms = useCallback(async () => {
    if (Platform.OS !== 'android') {
      setStatusBanner('⚠️ SMS reading is only supported on Android devices.');
      return;
    }

    setImporting(true);
    setStatusBanner('⏳ Requesting SMS permission and reading inbox...');

    try {
      const result = await importExistingSms({
        batchSize: 100,
        onProgress: (p) => {
          setStatusBanner(
            `⏳ Reading SMS... ${p.read} read (${p.inserted} new, ${p.duplicates} skipped)`,
          );
        },
      });

      setPermissionGranted(true);
      setStatusBanner(
        `✅ Import complete: ${result.totalRead} read, ${result.inserted} newly imported, ${result.duplicates} duplicates skipped.`,
      );
      refresh();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (errorMsg.includes('denied')) {
        setPermissionGranted(false);
        setStatusBanner('❌ READ_SMS permission was denied. Please grant permission in settings.');
      } else {
        setStatusBanner(`❌ Import failed: ${errorMsg}`);
      }
    } finally {
      setImporting(false);
    }
  }, [refresh]);

  const handleRequestPermission = useCallback(async () => {
    const granted = await requestSmsPermission();
    setPermissionGranted(granted);
    setStatusBanner(
      granted
        ? '✅ READ_SMS permission granted.'
        : '❌ READ_SMS permission denied.',
    );
  }, []);

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
        <Text style={styles.statusTitle}>Application Status</Text>

        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Database Initialized:</Text>
          <Text style={[styles.statusValue, dbStatus.initialized ? styles.ok : styles.error]}>
            {dbStatus.initialized ? '✅ Yes' : '❌ No'}
          </Text>
        </View>

        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Total SMS stored:</Text>
          <Text style={styles.statusValue}>{dbStatus.smsCount}</Text>
        </View>

        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>READ_SMS Permission:</Text>
          <Text
            style={[
              styles.statusValue,
              permissionGranted ? styles.ok : permissionGranted === false ? styles.error : styles.pending,
            ]}>
            {permissionGranted === null
              ? 'Checking…'
              : permissionGranted
                ? '✅ Granted'
                : '⚠️ Not Granted'}
          </Text>
        </View>

        {dbStatus.error !== null && (
          <Text style={styles.errorText}>Error: {dbStatus.error}</Text>
        )}
      </View>

      {/* ── Action buttons ── */}
      <View style={styles.actionContainer}>
        <Pressable
          style={[styles.importButton, importing && styles.buttonDisabled]}
          onPress={handleImportExistingSms}
          disabled={importing}>
          {importing ? (
            <View style={styles.importingRow}>
              <ActivityIndicator size="small" color="#ffffff" />
              <Text style={styles.importButtonText}>Importing Messages…</Text>
            </View>
          ) : (
            <Text style={styles.importButtonText}>📥 Import Existing SMS</Text>
          )}
        </Pressable>

        <View style={styles.buttonRow}>
          {permissionGranted === false && (
            <Pressable
              style={[styles.button, styles.permButton]}
              onPress={handleRequestPermission}>
              <Text style={styles.buttonText}>Grant Permission</Text>
            </Pressable>
          )}
          <Pressable style={[styles.button, styles.secondaryButton]} onPress={refresh}>
            <Text style={styles.buttonText}>Refresh</Text>
          </Pressable>
        </View>
      </View>

      {/* ── Feedback Banner ── */}
      {statusBanner !== null && (
        <View style={styles.bannerContainer}>
          <Text style={styles.bannerText}>{statusBanner}</Text>
        </View>
      )}

      {/* ── Message list ── */}
      <View style={styles.listHeaderRow}>
        <Text style={styles.listHeader}>Latest Messages</Text>
        <Text style={styles.listSubtitle}>Showing latest {Math.min(messages.length, 20)}</Text>
      </View>

      {messages.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No messages stored yet.</Text>
          <Text style={styles.emptySubtext}>
            Tap &quot;Import Existing SMS&quot; to read messages from your Android inbox.
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
  pending: { color: '#e37400' },
  errorText: {
    fontSize: 13,
    color: '#d93025',
    marginTop: 4,
  },

  // Action buttons
  actionContainer: {
    paddingHorizontal: 16,
    gap: 10,
    marginBottom: 8,
  },
  importButton: {
    backgroundColor: '#137333',
    minHeight: 48,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  importButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 15,
    textAlign: 'center',
  },
  importingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  permButton: {
    backgroundColor: '#e37400',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
  },
  button: {
    flex: 1,
    backgroundColor: '#208AEF',
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButton: {
    backgroundColor: '#6c757d',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },

  // Banner
  bannerContainer: {
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 12,
    backgroundColor: '#e8f0fe',
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#208AEF',
  },
  bannerText: {
    fontSize: 13,
    color: '#1a73e8',
    lineHeight: 18,
  },

  // List
  listHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 8,
  },
  listHeader: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111',
  },
  listSubtitle: {
    fontSize: 12,
    color: '#888',
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
