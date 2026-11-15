import bankHeadersJson from '../database/bank-sms-headers.json';
import type { SenderRegistryResult } from './types';

/**
 * Normalized dictionary of TRAI registered headers to entity names.
 * Keys are normalized to uppercase for case-insensitive lookup.
 */
const headerMap: Map<string, string> = new Map();

for (const [key, value] of Object.entries(bankHeadersJson)) {
  headerMap.set(key.trim().toUpperCase(), value);
}

/**
 * Normalizes an SMS sender string and extracts the core registered header.
 *
 * TRAI sender formats:
 * - Prefix-Header-Suffix: `JD-CENTBK-T`, `AD-650018-P`, `AX-HDFCBK-S`
 * - Prefix-Header: `AD-CENTBK`, `AX-AIRBNK`, `AD-650025`
 * - Header-Suffix: `CENTBK-T`, `HDFCBK-S`
 * - Bare Header: `CENTBK`, `HDFCBK`, `111000`, `CITI`
 *
 * @param sender Raw sender string from SMS (e.g. "JD-CENTBK-T", "+919876543210")
 * @returns Extracted canonical header or the cleaned sender string.
 */
export function extractHeader(sender: string): string {
  if (!sender) return '';

  const clean = sender.trim().toUpperCase();

  // If it is a personal phone number (+91... or pure digits of 10+ length), return as-is
  if (clean.startsWith('+') || /^\d{10,}$/.test(clean)) {
    return clean;
  }

  // Handle hyphen-separated formats
  if (clean.includes('-')) {
    const parts = clean.split('-').filter(Boolean);

    // Case 1: Prefix-Header-Suffix (e.g., ["JD", "CENTBK", "T"])
    if (parts.length === 3) {
      return parts[1];
    }

    // Case 2: 2 parts
    if (parts.length === 2) {
      const [part0, part1] = parts;

      // Subcase 2a: Prefix-Header (e.g., "AD-AIRBNK" or "AX-650025")
      // Prefix is usually 2 letters (telecom operator + circle code)
      if (part0.length === 2 && part1.length >= 4) {
        return part1;
      }

      // Subcase 2b: Header-Suffix (e.g., "AIRBNK-S", "CENTBK-T")
      if (part1.length === 1 && part0.length >= 4) {
        return part0;
      }

      // Subcase 2c: Fallback check against known registry
      if (headerMap.has(part1)) return part1;
      if (headerMap.has(part0)) return part0;

      // Default to the second part (after telecom prefix)
      return part1;
    }

    // If more than 3 parts, look for any part matching the registry or return second part
    for (const part of parts) {
      if (headerMap.has(part)) return part;
    }
    return parts[1] || parts[0];
  }

  return clean;
}

/**
 * Looks up an SMS sender in the TRAI registered header dataset.
 *
 * @param sender Raw sender ID
 * @returns SenderRegistryResult with header, entityName, and isRegistered flag.
 */
export function lookupSender(sender: string): SenderRegistryResult {
  const header = extractHeader(sender);
  const entityName = headerMap.get(header) || null;

  return {
    header,
    entityName,
    isRegistered: entityName !== null,
  };
}

/**
 * Returns total count of registered TRAI headers loaded in the registry.
 */
export function getRegisteredHeaderCount(): number {
  return headerMap.size;
}

/**
 * Checks if a specific header or sender is in the registry.
 */
export function isRegisteredHeader(headerOrSender: string): boolean {
  const header = extractHeader(headerOrSender);
  return headerMap.has(header);
}
