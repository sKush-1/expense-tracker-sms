import type { ParsedTransaction } from '../types';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Validates a parsed transaction object against strict integrity rules.
 */
export function validateTransaction(tx: ParsedTransaction): ValidationResult {
  const errors: string[] = [];

  // Rule 1: Valid transaction type
  if (!['debit', 'credit', 'refund'].includes(tx.transactionType)) {
    errors.push(`Invalid transaction type: ${tx.transactionType}`);
  }

  // Rule 2: Amount in paise must be positive integer
  if (
    typeof tx.amountPaise !== 'number' ||
    !Number.isInteger(tx.amountPaise) ||
    tx.amountPaise <= 0 ||
    Number.isNaN(tx.amountPaise)
  ) {
    errors.push(`Invalid amount in paise: ${tx.amountPaise}`);
  }

  // Rule 3: Valid date
  if (
    typeof tx.transactionDate !== 'number' ||
    tx.transactionDate <= 0 ||
    Number.isNaN(tx.transactionDate)
  ) {
    errors.push(`Invalid transaction date: ${tx.transactionDate}`);
  }

  // Rule 4: Currency
  if (!tx.currency || tx.currency !== 'INR') {
    errors.push(`Unsupported currency: ${tx.currency}`);
  }

  // Rule 5: Balance check if present
  if (
    tx.balancePaise !== null &&
    (typeof tx.balancePaise !== 'number' ||
      !Number.isInteger(tx.balancePaise) ||
      tx.balancePaise < 0 ||
      Number.isNaN(tx.balancePaise))
  ) {
    errors.push(`Invalid balance in paise: ${tx.balancePaise}`);
  }

  // Rule 6: Contextual credibility
  // A genuine banking SMS must provide at least one financial context marker:
  // bank_name, account_identifier, reference_number, or merchant
  const hasContext = Boolean(
    tx.bankName || tx.accountIdentifier || tx.referenceNumber || tx.merchant,
  );

  if (!hasContext) {
    errors.push('Transaction lacks financial context (no bank, account, ref, or merchant identified)');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
