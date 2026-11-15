/**
 * Normalizes SMS text content for consistent token matching and regex extraction.
 */

/**
 * Strips zero-width unicode characters, non-breaking spaces, and excessive whitespace.
 * Preserves casing for entity/merchant extraction while creating a clean string.
 */
export function normalizeSmsText(text: string): string {
  if (!text) return '';

  return (
    text
      // Replace zero-width spaces, joiners, and byte order marks
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      // Replace non-breaking spaces and other unicode spaces with standard space
      .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
      // Normalize line breaks and tabs to single spaces
      .replace(/[\r\n\t]+/g, ' ')
      // Replace multiple consecutive spaces with a single space
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Standardizes common Indian currency expressions for easier regex parsing:
 * e.g., "Rs . 500" -> "Rs. 500", "INR. 500" -> "INR 500"
 */
export function normalizeCurrencySpacing(text: string): string {
  return text
    .replace(/(?:Rs|RS|rs)\s*\.\s*/g, 'Rs. ')
    .replace(/(?:Rs|RS|rs)\s+/g, 'Rs. ')
    .replace(/(?:INR|inr|Inr)\s*\.?\s*/g, 'INR ')
    .replace(/₹\s*/g, '₹');
}
