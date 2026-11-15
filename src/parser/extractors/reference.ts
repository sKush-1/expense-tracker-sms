import type { ExtractedReference } from '../types';

/**
 * Patterns matching financial transaction reference numbers in Indian SMS:
 * - "Ref No. 104479862167"
 * - "Txn ID 224400498783"
 * - "UPI Ref: 123456789012"
 * - "UPI Ref no 123456789012"
 * - "UTR: 123456789012"
 * - "RRN: 123456789012"
 * - "IMPS Ref No 12345678"
 */
const REFERENCE_PATTERNS = [
  // UPI Ref / UPI Ref no
  /(?:upi\s+ref(?:erence)?(?:\s+no)?)\s*[:#-]?\s*([A-Za-z0-9]{6,22})/i,
  // Txn ID / Transaction ID / Txn#
  /(?:txn\s*id|transaction\s*id|txn\s*no\.?)\s*[:#-]?\s*([A-Za-z0-9]{6,22})/i,
  // UTR / RRN
  /(?:utr(?:\s*no\.?)?|rrn(?:\s*no\.?)?)\s*[:#-]?\s*([A-Za-z0-9]{6,22})/i,
  // Ref No. / Reference No
  /(?:ref(?:\s*no\.?|\s+number|\s*#)?)\s*[:#-]?\s*([A-Za-z0-9]{6,22})/i,
];

export function extractReference(text: string): ExtractedReference | null {
  if (!text) return null;

  for (const regex of REFERENCE_PATTERNS) {
    const match = regex.exec(text);
    if (match && match[1]) {
      const refNum = match[1].trim();
      let refType: ExtractedReference['referenceType'] = 'txn_id';

      if (/upi/i.test(match[0])) {
        refType = 'upi_ref';
      } else if (/utr/i.test(match[0])) {
        refType = 'utr';
      } else if (/rrn/i.test(match[0])) {
        refType = 'rrn';
      }

      return {
        referenceNumber: refNum,
        referenceType: refType,
      };
    }
  }

  return null;
}
