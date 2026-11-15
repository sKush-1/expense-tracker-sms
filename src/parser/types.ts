/**
 * Core types for transaction detection and extraction engine.
 */

export type TransactionType = 'debit' | 'credit' | 'refund';

export interface ExtractedAmount {
  raw: string;
  paise: number; // Integer paise, e.g. 50000 for ₹500.00
  currency: string;
  startIndex: number;
  endIndex: number;
}

export interface ExtractedBalance {
  raw: string;
  paise: number; // Integer paise
  startIndex: number;
  endIndex: number;
}

export interface ExtractedAccount {
  accountIdentifier: string; // e.g. "XX1089" or "Card ending 1234"
  accountType?: 'account' | 'card' | 'wallet';
}

export interface ExtractedReference {
  referenceNumber: string; // e.g. UPI ref, UTR, RRN
  referenceType?: 'upi_ref' | 'utr' | 'rrn' | 'txn_id';
}

export interface ExtractedMerchant {
  merchant: string; // e.g. "Swiggy", "Amazon", "John Doe", "vpa@upi"
}

export interface SenderRegistryResult {
  header: string;
  entityName: string | null;
  isRegistered: boolean;
}

export interface DetectionResult {
  isCandidate: boolean;
  transactionType: TransactionType | null;
  rejectionReason?: string;
  keywordsFound: string[];
}

export interface ParsedTransaction {
  transactionType: TransactionType;
  amountPaise: number;
  currency: string;
  merchant: string | null;
  bankName: string | null;
  accountIdentifier: string | null;
  referenceNumber: string | null;
  transactionDate: number; // Unix ms
  balancePaise: number | null;
  parserName: string;
  parserVersion: string;
}

export interface TransactionRecord extends ParsedTransaction {
  id: number;
  sourceSmsId: number;
  createdAt: number;
}

export type InsertTransactionPayload = Omit<TransactionRecord, 'id' | 'createdAt'>;
