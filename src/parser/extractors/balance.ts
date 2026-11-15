import type { ExtractedBalance } from '../types';

/**
 * Converts a rupee string (e.g. "61,757.32" or "500") to integer paise
 * without floating-point arithmetic.
 */
export function parseToPaise(cleanAmountStr: string): number {
  const sanitized = cleanAmountStr.replace(/,/g, '').trim();
  const parts = sanitized.split('.');
  const rupeePart = parseInt(parts[0], 10) || 0;
  let paisePart = 0;

  if (parts.length > 1 && parts[1]) {
    const rawPaise = parts[1].padEnd(2, '0').slice(0, 2);
    paisePart = parseInt(rawPaise, 10) || 0;
  }

  return rupeePart * 100 + paisePart;
}

/**
 * Regex for balance patterns commonly found in Indian banking SMS.
 * Examples:
 * - "Total Bal Rs. 61757.32"
 * - "Total Bal: Rs. 1,12,086.59"
 * - "Clr Bal Rs. 61757.32"
 * - "Bal:337.68"
 * - "Bal Rs 500"
 * - "Avl Bal: INR 10,000.50"
 * - "Available Balance: Rs. 5,000"
 * - "Remaining Bal: Rs. 1,200"
 */
const BALANCE_REGEXES = [
  // Total Bal / Clr Bal / Avl Bal / Available Bal / Remaining Bal / Bal:
  /(?:total\s+bal(?:ance)?|clr\s+bal(?:ance)?|avl\s+bal(?:ance)?|available\s+bal(?:ance)?|remaining\s+bal(?:ance)?|bal(?:ance)?)\s*(?::|is|\s|-)?\s*(?:(?:Rs\.?|INR|₹)\s*)?([0-9]+(?:,[0-9]+)*(?:\.[0-9]{1,2})?)/gi,
  // "Balance is Rs. 500"
  /(?:bal(?:ance)?\s+is\s+)(?:(?:Rs\.?|INR|₹)\s*)?([0-9]+(?:,[0-9]+)*(?:\.[0-9]{1,2})?)/gi,
  // "Rs. 500 Available Balance"
  /(?:(?:Rs\.?|INR|₹)\s*)?([0-9]+(?:,[0-9]+)*(?:\.[0-9]{1,2})?)\s*(?:available\s+balance|total\s+balance)/gi,
];

/**
 * Extracts account balance from the SMS message.
 * Returns null if no clearly labelled balance is found.
 */
export function extractBalance(text: string): ExtractedBalance | null {
  if (!text) return null;

  for (const regex of BALANCE_REGEXES) {
    regex.lastIndex = 0;
    const match = regex.exec(text);
    if (match && match[1]) {
      const rawNumber = match[1];
      const paise = parseToPaise(rawNumber);
      return {
        raw: match[0],
        paise,
        startIndex: match.index,
        endIndex: match.index + match[0].length,
      };
    }
  }

  return null;
}
