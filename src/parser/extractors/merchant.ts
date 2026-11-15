import type { ExtractedMerchant } from '../types';

/**
 * Words that indicate the end of a merchant/beneficiary clause.
 */
const TERMINATOR_WORDS = [
  'on',
  'ref',
  'txn',
  'bal',
  'balance',
  'total',
  'avail',
  'avl',
  'via',
  'with',
  'call',
  'help',
  'using',
  'not',
  'if',
  'query',
  'dated',
  'clr',
];

/**
 * Clean up extracted merchant strings:
 * - Strip punctuation, quotes, trailing dots/hyphens
 * - Ignore if it is just a numeric reference or common bank suffix
 */
function cleanMerchant(raw: string): string | null {
  if (!raw) return null;

  let cleaned = raw
    .replace(/^[:\s\-*]+/, '')
    .replace(/[.\s\-*]+$/, '')
    .trim();

  // If the string starts with terminator words, cut it off
  const words = cleaned.split(/\s+/);
  const validWords: string[] = [];

  for (const word of words) {
    const lower = word.toLowerCase().replace(/[^a-z]/g, '');
    if (TERMINATOR_WORDS.includes(lower)) {
      break;
    }
    validWords.push(word);
  }

  cleaned = validWords.join(' ').trim();

  // If too short or too long or purely numeric/date, discard
  if (cleaned.length < 2 || cleaned.length > 50) return null;
  if (/^\d+$/.test(cleaned)) return null;
  if (/^\d{1,2}[-/]\d{1,2}(?:[-/]\d{2,4})?$/.test(cleaned)) return null;

  return cleaned;
}

export function extractMerchant(text: string, bankName?: string | null): ExtractedMerchant | null {
  if (!text) return null;

  // Patterns in order of precision:
  const patterns = [
    // VPA / UPI ID: "VPA swiggy@icici" or "to VPA abc@oksbi"
    /(?:vpa|upi\s+id)\s*[:=]?\s*([a-zA-Z0-9.\-_]+@[a-zA-Z0-9]+)/i,
    // "Paid [Rs. 500] to <party>" / "transferred [Rs. 500] to <party>" / "via UPI to/from <party>"
    /(?:via\s+upi\s+(?:to|from)|(?:paid|transferred|sent)\s+(?:(?:rs\.?|inr|₹)\s*[0-9,.]+\s+)?to|(?:received|credited)\s+(?:(?:rs\.?|inr|₹)\s*[0-9,.]+\s+)?from)\s+([A-Za-z0-9&.@\-_ ]+?)(?=\s+(?:on|ref|txn|bal|total|clr|with|using|dated|via|\.|\n|$))/i,
    // "at <merchant>" e.g. "spent at Starbucks on 14-Nov"
    /\bat\s+([A-Za-z0-9&.\-_ ]+?)(?=\s+(?:on|ref|txn|bal|total|clr|with|using|dated|\.|\n|$))/i,
    // "towards <purpose>" e.g. "towards Electricity Bill"
    /\btowards\s+([A-Za-z0-9&.\-_ ]+?)(?=\s+(?:on|ref|txn|bal|total|clr|with|using|dated|\.|\n|$))/i,
    // "Info: <info>" e.g. "Info: BIL*NETFLIX"
    /\binfo[:\s]+([A-Za-z0-9*.\-_ ]+?)(?=\s+(?:on|ref|txn|bal|total|clr|\.|\n|$))/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match && match[1]) {
      const cleaned = cleanMerchant(match[1]);
      if (cleaned) {
        // Do not assign bank name as merchant
        if (bankName && cleaned.toLowerCase().includes(bankName.toLowerCase())) {
          continue;
        }
        return { merchant: cleaned };
      }
    }
  }

  return null;
}
