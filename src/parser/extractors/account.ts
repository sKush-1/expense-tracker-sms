import type { ExtractedAccount } from '../types';

/**
 * Patterns matching bank account or card identifiers:
 * Examples:
 * - "A/c XX1089"
 * - "A/c 3XXXXX1089"
 * - "A/C *1234"
 * - "a/c ending 1234"
 * - "account ending in 1234"
 * - "Card ending with 1234"
 * - "Credit Card ending 5678"
 * - "Card XX1234"
 * - "Account ...1234"
 */
const ACCOUNT_PATTERNS = [
  // A/c XX1089, A/c *1234, A/c 3XXXXX1089, A/c ...1089
  /(?:a\/c|acct|account)\s*(?:no\.?|number)?\s*[:#-]?\s*([X*.\d]*\d{3,4})\b/i,
  // Card XX1234, Card ending 1234, Card ending with 1234
  /(?:credit\s+card|debit\s+card|card)\s*(?:ending\s+(?:in|with)?\s*[:#-]?\s*|no\.?\s*[:#-]?\s*)?([X*.\d]*\d{3,4})\b/i,
  // Account ending 1234
  /(?:account|a\/c)\s+ending\s+(?:in|with)?\s*([X*.\d]*\d{3,4})\b/i,
  // Ending in 1234
  /ending\s+(?:in|with)\s+([X*.\d]*\d{3,4})\b/i,
];

export function extractAccount(text: string): ExtractedAccount | null {
  if (!text) return null;

  for (const regex of ACCOUNT_PATTERNS) {
    const match = regex.exec(text);
    if (match && match[1]) {
      const rawIdent = match[1].trim();
      // Ensure it's not a generic word or too long (e.g. not a 12-digit UPI ref or phone number)
      if (rawIdent.length >= 3 && rawIdent.length <= 16) {
        const isCard = /card/i.test(match[0]);
        return {
          accountIdentifier: rawIdent,
          accountType: isCard ? 'card' : 'account',
        };
      }
    }
  }

  return null;
}
