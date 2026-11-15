/**
 * Raw SMS record returned by the native Android ContentResolver query.
 * Field names intentionally match the native Map keys.
 */
export interface NativeSmsRecord {
  /** Android's internal SMS _ID (string representation of a Long). */
  id: string | null;
  /** Sender phone number / alphanumeric address. */
  address: string;
  /** Full message body text. */
  body: string;
  /** Received timestamp in Unix milliseconds. */
  date: number;
  /** Android SMS type constant (1 = inbox). */
  type: number;
  /** Deterministic SHA-256 fingerprint for deduplication. */
  fingerprint?: string;
}

/**
 * Message record drained from the durable native pending queue.
 */
export interface PendingSmsRecord {
  sender: string;
  message: string;
  received_at: number;
  fingerprint: string;
}

/**
 * Result of a full inbox import operation.
 */
export interface ImportResult {
  /** Total messages read from the inbox. */
  totalRead: number;
  /** Number of records newly inserted into SQLite. */
  inserted: number;
  /** Number of records skipped because they were already in SQLite. */
  duplicates: number;
}
