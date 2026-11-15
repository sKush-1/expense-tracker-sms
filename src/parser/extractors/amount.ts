import type { ExtractedAmount } from '../types';
import { extractBalance, parseToPaise } from './balance';

/**
 * Currency prefix / suffix regex:
 * Matches:
 * - "Rs. 500", "Rs 500.00", "Rs.500", "rs. 500"
 * - "INR 500", "INR 1,250.50", "inr 500"
 * - "₹500", "₹ 1,250.50"
 * - "500 rupees", "1,250.50 Rupees"
 */
const AMOUNT_PATTERNS = [
  // Prefix: Rs., INR, ₹
  /(?:Rs\.?|INR|₹)\s*([0-9]+(?:,[0-9]+)*(?:\.[0-9]{1,2})?)/gi,
  // Suffix: rupees
  /([0-9]+(?:,[0-9]+)*(?:\.[0-9]{1,2})?)\s*(?:rupees)/gi,
];

/**
 * Transaction action keywords used to calculate contextual proximity.
 */
const ACTION_KEYWORDS = [
  'debited',
  'credited',
  'spent',
  'withdrawn',
  'paid',
  'deposited',
  'transferred',
  'refunded',
  'reversal',
  'sent',
  'received',
];

/**
 * Indicators that an amount belongs to an account balance, limit, or loan rather than transaction.
 */
const BALANCE_OR_LIMIT_PREFIXES = [
  'bal',
  'balance',
  'total bal',
  'clr bal',
  'avl bal',
  'avail bal',
  'available bal',
  'remaining bal',
  'limit',
  'credit limit',
  'avail limit',
  'od limit',
];

export interface CandidateAmount {
  raw: string;
  numStr: string;
  paise: number;
  startIndex: number;
  endIndex: number;
  score: number;
}

/**
 * Extracts all monetary candidates matching explicit currency markers.
 */
export function findAmountCandidates(text: string): CandidateAmount[] {
  const candidates: CandidateAmount[] = [];
  const lowerText = text.toLowerCase();

  for (const regex of AMOUNT_PATTERNS) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const numStr = match[1];
      if (!numStr) continue;

      // Exclude lone 0 or non-positive amounts
      const paise = parseToPaise(numStr);
      if (paise <= 0) continue;

      const startIndex = match.index;
      const endIndex = startIndex + match[0].length;

      // Check context before the amount (up to 30 chars prior)
      const preContext = lowerText.slice(Math.max(0, startIndex - 30), startIndex);

      // Check if preceded by balance or limit words
      const isBalanceWord = BALANCE_OR_LIMIT_PREFIXES.some((prefix) => {
        const regexPrefix = new RegExp(`\\b${prefix}[\\s:=-]*$`, 'i');
        return regexPrefix.test(preContext);
      });

      if (isBalanceWord) {
        // Skip balance candidates
        continue;
      }

      // Check if followed by "bal" or "balance" (e.g., "Rs. 500 balance remaining")
      const postContext = lowerText.slice(endIndex, Math.min(lowerText.length, endIndex + 20));
      if (/^\s*(?:is\s+)?bal(?:ance)?/i.test(postContext)) {
        continue;
      }

      // Calculate contextual score based on proximity to action keywords
      let score = 10;

      for (const keyword of ACTION_KEYWORDS) {
        const keywordIdx = lowerText.indexOf(keyword);
        if (keywordIdx !== -1) {
          // Distance in characters
          const dist = Math.min(
            Math.abs(startIndex - (keywordIdx + keyword.length)),
            Math.abs(endIndex - keywordIdx),
          );

          if (dist < 15) {
            // Immediately adjacent (e.g. "debited by Rs. 500" or "Rs. 500 debited")
            score += 100;
          } else if (dist < 35) {
            score += 50;
          } else if (dist < 60) {
            score += 20;
          }
        }
      }

      // Boost for "debited by / for / of", "credited by / with / of"
      if (/(?:debited|credited|paid|spent|withdrawn)\s+(?:by|for|of|with)?\s*$/i.test(preContext)) {
        score += 150;
      }

      // Boost if amount appears at the very beginning of the SMS (common in Airtel, HDFC)
      if (startIndex < 5) {
        score += 30;
      }

      candidates.push({
        raw: match[0],
        numStr,
        paise,
        startIndex,
        endIndex,
        score,
      });
    }
  }

  // Deduplicate overlapping candidate spans
  const uniqueCandidates: CandidateAmount[] = [];
  for (const cand of candidates) {
    const isOverlapping = uniqueCandidates.some(
      (uc) =>
        (cand.startIndex >= uc.startIndex && cand.startIndex < uc.endIndex) ||
        (cand.endIndex > uc.startIndex && cand.endIndex <= uc.endIndex),
    );
    if (!isOverlapping) {
      uniqueCandidates.push(cand);
    }
  }

  return uniqueCandidates;
}

/**
 * Extracts the primary transaction amount from an SMS message.
 *
 * Distinguishes between:
 * - Transaction amount
 * - Balance amounts (e.g. "Total Bal Rs. 61757.32")
 * - Phone numbers, OTPs, reference numbers, account digits
 *
 * @param text SMS body
 * @returns ExtractedAmount or null if no valid monetary amount is detected
 */
export function extractAmount(text: string): ExtractedAmount | null {
  if (!text) return null;

  // First detect if there is a known balance span to ensure we don't pick it as txn amount
  const balance = extractBalance(text);

  const candidates = findAmountCandidates(text);
  if (candidates.length === 0) return null;

  // Filter out any candidate that overlaps with the balance span
  const nonBalanceCandidates = candidates.filter((cand) => {
    if (!balance) return true;
    const overlaps =
      (cand.startIndex >= balance.startIndex && cand.startIndex < balance.endIndex) ||
      (cand.endIndex > balance.startIndex && cand.endIndex <= balance.endIndex);
    return !overlaps;
  });

  const validPool = nonBalanceCandidates.length > 0 ? nonBalanceCandidates : candidates;

  // Sort by score descending; if tied, earlier in string or higher score wins
  validPool.sort((a, b) => b.score - a.score);

  const best = validPool[0];
  if (!best || best.paise <= 0) return null;

  return {
    raw: best.raw,
    paise: best.paise,
    currency: 'INR',
    startIndex: best.startIndex,
    endIndex: best.endIndex,
  };
}
