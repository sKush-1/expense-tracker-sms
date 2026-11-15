import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type AppStateStatus,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { reloadDatabase } from '@/database/db';
import { getAllSms, getSmsCount } from '@/database/sms.repository';
import {
  getAllTransactions,
  getTransactionCount,
} from '@/database/transaction.repository';
import type { TransactionRecord } from '@/parser/types';
import { processAllUnprocessed } from '@/parser/transaction.service';
import { importExistingSms } from '@/sms/sms-importer';
import {
  addSmsReceivedListener,
  checkSmsPermissions,
  requestSmsPermissions,
  syncPendingMessages,
  type SmsPermissionsStatus,
} from '@/sms/sms-reader';
import type { DbStatus, SmsMessage } from '@/types/sms';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(unixMs: number): string {
  return new Date(unixMs).toLocaleString();
}

function formatCurrency(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
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
  const [permissions, setPermissions] = useState<SmsPermissionsStatus | null>(null);
  const [messages, setMessages] = useState<SmsMessage[]>([]);
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [transactionCount, setTransactionCount] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<'transactions' | 'sms'>('transactions');
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  const appStateRef = useRef<AppStateStatus>((AppState.currentState as AppStateStatus) ?? 'active');
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  /**
   * Runs the offline transaction extraction pipeline on any unprocessed SMS records.
   */
  const runTransactionPipeline = useCallback(async () => {
    try {
      setDetecting(true);
      const summary = await processAllUnprocessed();
      if (isMountedRef.current) {
        const count = getTransactionCount();
        const latestTx = getAllTransactions(50);
        setTransactionCount(count);
        setTransactions(latestTx);
        if (summary.totalTransactions > 0) {
          setStatusBanner(`💳 Extracted ${summary.totalTransactions} new transaction(s).`);
        }
      }
    } catch {
      // Safe fallback
    } finally {
      if (isMountedRef.current) {
        setDetecting(false);
      }
    }
  }, []);

  /**
   * Loads SQLite data, drains pending queue, and checks permissions.
   *
   * @param isSilent When true, avoids showing full screen loading spinner (used for live events).
   */
  const loadData = useCallback(async (isSilent = false) => {
    if (!isSilent) {
      setLoading(true);
    }

    try {
      // 1. Drain and synchronize any pending native messages
      const synced = await syncPendingMessages();
      if (synced > 0 && isMountedRef.current) {
        setStatusBanner(`📥 Synchronized ${synced} incoming message(s).`);
      }

      // 2. Re-open SQLite connection so external receiver writes in WAL mode are immediately fresh
      reloadDatabase();

      // 3. Fetch current counts and latest records from SQLite
      const smsCount = getSmsCount();
      const latestSms = getAllSms(20);
      const txCount = getTransactionCount();
      const latestTx = getAllTransactions(50);

      if (isMountedRef.current) {
        setDbStatus({ initialized: true, smsCount, error: null });
        setMessages(latestSms);
        setTransactionCount(txCount);
        setTransactions(latestTx);
      }

      // 4. Run background transaction extraction for any unprocessed messages
      runTransactionPipeline();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isMountedRef.current) {
        setDbStatus((prev) => ({ ...prev, error: message }));
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }

    // 5. Check runtime permissions
    try {
      const perms = await checkSmsPermissions();
      if (isMountedRef.current) {
        setPermissions(perms);
      }
    } catch {
      if (isMountedRef.current) {
        setPermissions({ read: false, receive: false });
      }
    }
  }, [runTransactionPipeline]);

  // Initial load on mount
  useEffect(() => {
    let isMounted = true;
    const timer = setTimeout(() => {
      if (isMounted) {
        loadData(false);
      }
    }, 0);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [loadData]);

  // AppState change listener: reload when returning from background/inactive to active
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (
        appStateRef.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        loadData(true);
      }
      appStateRef.current = nextAppState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      subscription.remove();
    };
  }, [loadData]);

  // Live native-to-JS SMS event listener
  useEffect(() => {
    const subscription = addSmsReceivedListener((event) => {
      if (isMountedRef.current) {
        setStatusBanner(`📥 New SMS received from ${event.sender}`);
      }
      loadData(true);
    });

    return () => {
      subscription?.remove();
    };
  }, [loadData]);

  const refresh = useCallback(() => {
    setStatusBanner(null);
    loadData(false);
  }, [loadData]);

  const handleImportExistingSms = useCallback(async () => {
    if (Platform.OS !== 'android') {
      setStatusBanner('⚠️ SMS reading is only supported on Android devices.');
      return;
    }

    setImporting(true);
    setStatusBanner('⏳ Reading Android inbox...');

    try {
      const result = await importExistingSms({
        batchSize: 100,
        onProgress: (p) => {
          setStatusBanner(
            `⏳ Reading SMS... ${p.read} read (${p.inserted} new, ${p.duplicates} skipped)`,
          );
        },
      });

      setPermissions((prev) => (prev ? { ...prev, read: true } : { read: true, receive: false }));
      setStatusBanner(
        `✅ Import complete: ${result.totalRead} read, ${result.inserted} newly imported. Extracting transactions...`,
      );
      await loadData(true);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (errorMsg.includes('denied')) {
        setPermissions((prev) => (prev ? { ...prev, read: false } : { read: false, receive: false }));
        setStatusBanner('❌ READ_SMS permission was denied. Please grant permission to import messages.');
      } else {
        setStatusBanner(`❌ Import failed: ${errorMsg}`);
      }
    } finally {
      setImporting(false);
    }
  }, [loadData]);

  const handleRequestPermissions = useCallback(async () => {
    const perms = await requestSmsPermissions();
    setPermissions(perms);
    if (perms.read && perms.receive) {
      setStatusBanner('✅ Both SMS permissions granted. Automatic capture is active.');
    } else if (perms.receive && !perms.read) {
      setStatusBanner('⚠️ RECEIVE_SMS granted (auto-capture active), but READ_SMS was denied.');
    } else if (perms.read && !perms.receive) {
      setStatusBanner('⚠️ READ_SMS granted (import active), but RECEIVE_SMS was denied.');
    } else {
      setStatusBanner('❌ Permissions denied. SMS capture and historical import are unavailable.');
    }
  }, []);

  // ---- Render ----

  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color="#208AEF" />
        <Text style={styles.loadingText}>Initialising database & transactions…</Text>
      </SafeAreaView>
    );
  }

  const allPermissionsGranted = permissions?.read === true && permissions?.receive === true;

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
          <Text style={styles.statusLabel}>Detected Transactions:</Text>
          <Text style={[styles.statusValue, styles.txHighlight]}>
            💳 {transactionCount} {detecting ? '(extracting…)' : ''}
          </Text>
        </View>

        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Auto-Capture (RECEIVE_SMS):</Text>
          <Text
            style={[
              styles.statusValue,
              permissions?.receive ? styles.ok : permissions?.receive === false ? styles.error : styles.pending,
            ]}>
            {permissions === null
              ? 'Checking…'
              : permissions.receive
                ? '✅ Active'
                : '⚠️ Missing Permission'}
          </Text>
        </View>

        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Historical Import (READ_SMS):</Text>
          <Text
            style={[
              styles.statusValue,
              permissions?.read ? styles.ok : permissions?.read === false ? styles.error : styles.pending,
            ]}>
            {permissions === null
              ? 'Checking…'
              : permissions.read
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
          {!allPermissionsGranted && (
            <Pressable
              style={[styles.button, styles.permButton]}
              onPress={handleRequestPermissions}>
              <Text style={styles.buttonText}>Grant Permissions</Text>
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

      {/* ── Tabs: Transactions vs SMS ── */}
      <View style={styles.tabContainer}>
        <Pressable
          style={[styles.tab, activeTab === 'transactions' && styles.activeTab]}
          onPress={() => setActiveTab('transactions')}>
          <Text style={[styles.tabText, activeTab === 'transactions' && styles.activeTabText]}>
            💳 Transactions ({transactionCount})
          </Text>
        </Pressable>
        <Pressable
          style={[styles.tab, activeTab === 'sms' && styles.activeTab]}
          onPress={() => setActiveTab('sms')}>
          <Text style={[styles.tabText, activeTab === 'sms' && styles.activeTabText]}>
            💬 All SMS ({dbStatus.smsCount})
          </Text>
        </Pressable>
      </View>

      {/* ── Active Tab Content ── */}
      {activeTab === 'transactions' ? (
        transactions.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No transactions detected yet.</Text>
            <Text style={styles.emptySubtext}>
              Banking transaction SMS will automatically be parsed and displayed here.
            </Text>
          </View>
        ) : (
          <FlatList
            data={transactions}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <View style={styles.txCard}>
                <View style={styles.txHeaderRow}>
                  <View style={styles.txBadgeRow}>
                    <View
                      style={[
                        styles.badge,
                        item.transactionType === 'debit'
                          ? styles.badgeDebit
                          : item.transactionType === 'credit'
                            ? styles.badgeCredit
                            : styles.badgeRefund,
                      ]}>
                      <Text style={styles.badgeText}>{item.transactionType.toUpperCase()}</Text>
                    </View>
                    <Text style={styles.bankName} numberOfLines={1}>
                      {item.bankName || 'Bank'}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.amountText,
                      item.transactionType === 'debit'
                        ? styles.amountDebit
                        : item.transactionType === 'credit'
                          ? styles.amountCredit
                          : styles.amountRefund,
                    ]}>
                    {item.transactionType === 'debit' ? '-' : '+'}
                    {formatCurrency(item.amountPaise)}
                  </Text>
                </View>

                {item.merchant && (
                  <Text style={styles.merchantText} numberOfLines={1}>
                    🏪 {item.merchant}
                  </Text>
                )}

                <View style={styles.txDetailRow}>
                  {item.accountIdentifier && (
                    <Text style={styles.detailItem}>A/c: {item.accountIdentifier}</Text>
                  )}
                  {item.referenceNumber && (
                    <Text style={styles.detailItem}>Ref: {item.referenceNumber}</Text>
                  )}
                  {item.balancePaise !== null && (
                    <Text style={styles.detailItem}>Bal: {formatCurrency(item.balancePaise)}</Text>
                  )}
                </View>

                <Text style={styles.txDate}>{formatDate(item.transactionDate)}</Text>
              </View>
            )}
          />
        )
      ) : messages.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No messages stored yet.</Text>
          <Text style={styles.emptySubtext}>
            Tap &quot;Import Existing SMS&quot; or receive a new SMS on this device.
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
                {item.fingerprint ? ` · FP: ${item.fingerprint.slice(0, 8)}…` : ''}
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
  txHighlight: {
    color: '#1a73e8',
    fontWeight: '700',
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
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  importingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  importButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  button: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  permButton: {
    backgroundColor: '#1a73e8',
  },
  secondaryButton: {
    backgroundColor: '#e0e0e0',
  },
  buttonText: {
    color: '#111',
    fontSize: 14,
    fontWeight: '600',
  },

  // Feedback banner
  bannerContainer: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 10,
    backgroundColor: '#e8f0fe',
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#1a73e8',
  },
  bannerText: {
    fontSize: 13,
    color: '#1a73e8',
  },

  // Tabs
  tabContainer: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: '#e8eaed',
    borderRadius: 8,
    padding: 3,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 6,
  },
  activeTab: {
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#5f6368',
  },
  activeTabText: {
    color: '#1a73e8',
    fontWeight: '700',
  },

  // Empty state
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 8,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#555',
  },
  emptySubtext: {
    fontSize: 13,
    color: '#888',
    textAlign: 'center',
  },

  // List & Cards
  list: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 10,
  },
  messageCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
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
    color: '#202124',
    flex: 1,
    marginRight: 8,
  },
  timestamp: {
    fontSize: 11,
    color: '#888',
  },
  messageBody: {
    fontSize: 13,
    color: '#3c4043',
    lineHeight: 18,
  },
  metaText: {
    fontSize: 11,
    color: '#9aa0a6',
    marginTop: 2,
  },

  // Transaction Cards
  txCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    gap: 6,
    borderLeftWidth: 4,
    borderLeftColor: '#1a73e8',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  txHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  txBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeDebit: { backgroundColor: '#fce8e6' },
  badgeCredit: { backgroundColor: '#e6f4ea' },
  badgeRefund: { backgroundColor: '#e8f0fe' },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#202124',
  },
  bankName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#202124',
    flex: 1,
  },
  amountText: {
    fontSize: 16,
    fontWeight: '700',
  },
  amountDebit: { color: '#d93025' },
  amountCredit: { color: '#137333' },
  amountRefund: { color: '#1a73e8' },
  merchantText: {
    fontSize: 13,
    color: '#202124',
    fontWeight: '500',
  },
  txDetailRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  detailItem: {
    fontSize: 11,
    color: '#5f6368',
    backgroundColor: '#f1f3f4',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  txDate: {
    fontSize: 11,
    color: '#888',
    marginTop: 2,
  },
});
