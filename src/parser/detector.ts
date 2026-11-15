import type { DetectionResult } from './types';

/**
 * Disqualification patterns that immediately disqualify a message from being a transaction:
 * - OTPs / verification codes
 * - Failed, declined, cancelled payments
 * - Pending / processing payments
 * - Payment reminders / bills due
 * - Promotional / marketing spam
 * - Login alerts
 */
const DISQUALIFICATION_RULES: { pattern: RegExp; reason: string }[] = [
  // OTP and security codes
  {
    pattern: /\b(?:otp|one\s+time\s+password|verification\s+code|login\s+code|security\s+code|auth\s+code|secret\s+code)\b/i,
    reason: 'Contains OTP/verification code',
  },
  {
    pattern: /\b(?:valid\s+for\s+\d+|do\s+not\s+share\s+(?:this\s+)?(?:otp|code|password)|is\s+your\s+code)\b/i,
    reason: 'Contains OTP security instructions',
  },

  // Failed, declined, rejected, cancelled
  {
    pattern: /\b(?:failed|declined|unsuccessful|rejected|cancelled|canceled|returned)\b/i,
    reason: 'Payment status is failed, declined, or cancelled',
  },

  // Pending, processing, initiated, future conditional
  {
    pattern: /\b(?:is\s+pending|txn\s+pending|status\s+pending|payment\s+pending|initiated|processing|in\s+process|awaiting)\b/i,
    reason: 'Payment is pending or initiated rather than completed',
  },
  {
    pattern: /\b(?:will\s+be|shall\s+be|to\s+be)\s+(?:debited|credited|refunded)\b/i,
    reason: 'Future conditional notification rather than completed transaction',
  },

  // Payment reminders / bills due
  {
    pattern: /\b(?:payment\s+due|bill\s+due|due\s+date|is\s+due\s+on|please\s+pay|minimum\s+amount\s+due|outstanding\s+due)\b/i,
    reason: 'Payment reminder or bill due notification',
  },

  // Promotional and marketing
  {
    pattern: /\b(?:pre-approved|apply\s+now|congratulations|exclusive\s+offer|hurry|claim\s+now|use\s+code|cashback\s+up\s+to|discount\s+of)\b/i,
    reason: 'Promotional or marketing message',
  },

  // Login alerts
  {
    pattern: /\b(?:logged\s+in|login\s+alert|sign-in\s+alert|signed\s+in|new\s+device\s+login)\b/i,
    reason: 'Account security or login alert',
  },
];

/**
 * Debit direction keywords:
 * - debited
 * - withdrawn
 * - spent
 * - paid
 * - transferred (when context indicates outgoing money)
 */
const DEBIT_PATTERNS = [
  /\bdebited\b/i,
  /\bwithdrawn\b/i,
  /\bspent\b/i,
  /\bpaid\b/i,
  /\btransferred\s+(?:to|rs\.?|inr|₹)/i,
  /\bsent\s+(?:to|rs\.?|inr|₹)/i,
];

/**
 * Credit direction keywords:
 * - credited
 * - received (when context clearly indicates money received)
 * - deposited
 */
const CREDIT_PATTERNS = [
  /\bcredited\b/i,
  /\bdeposited\b/i,
  /\breceived\s+(?:rs\.?|inr|₹|from)/i,
];

/**
 * Refund / reversal keywords:
 * - refunded
 * - reversal
 */
const REFUND_PATTERNS = [
  /\brefunded\b/i,
  /\breversal\b/i,
  /\brefund\s+of\b/i,
];

/**
 * Evaluates whether an SMS message is a candidate financial transaction.
 *
 * @param text Cleaned SMS text
 * @returns DetectionResult with candidate status, determined direction, and rejection reason if any.
 */
export function detectTransaction(text: string): DetectionResult {
  if (!text) {
    return {
      isCandidate: false,
      transactionType: null,
      rejectionReason: 'Empty message text',
      keywordsFound: [],
    };
  }

  // Step 1: Check disqualification rules
  for (const { pattern, reason } of DISQUALIFICATION_RULES) {
    if (pattern.test(text)) {
      return {
        isCandidate: false,
        transactionType: null,
        rejectionReason: reason,
        keywordsFound: [],
      };
    }
  }

  const keywordsFound: string[] = [];

  // Step 2: Check Refund
  const isRefund = REFUND_PATTERNS.some((pat) => {
    const match = pat.test(text);
    if (match) keywordsFound.push('refund');
    return match;
  });

  if (isRefund) {
    return {
      isCandidate: true,
      transactionType: 'refund',
      keywordsFound,
    };
  }

  // Step 3: Check Debit
  const isDebit = DEBIT_PATTERNS.some((pat) => {
    const match = pat.test(text);
    if (match) keywordsFound.push('debit');
    return match;
  });

  // Step 4: Check Credit
  const isCredit = CREDIT_PATTERNS.some((pat) => {
    const match = pat.test(text);
    if (match) keywordsFound.push('credit');
    return match;
  });

  // Ambiguity check: If both or neither match, reject
  if (isDebit && isCredit) {
    return {
      isCandidate: false,
      transactionType: null,
      rejectionReason: 'Ambiguous transaction direction (both debit and credit keywords present)',
      keywordsFound,
    };
  }

  if (!isDebit && !isCredit) {
    return {
      isCandidate: false,
      transactionType: null,
      rejectionReason: 'No explicit debit or credit transaction keyword found',
      keywordsFound: [],
    };
  }

  return {
    isCandidate: true,
    transactionType: isDebit ? 'debit' : 'credit',
    keywordsFound,
  };
}
