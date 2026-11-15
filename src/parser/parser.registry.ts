import { detectTransaction } from './detector';
import { extractAccount } from './extractors/account';
import { extractAmount } from './extractors/amount';
import { extractBalance } from './extractors/balance';
import { extractMerchant } from './extractors/merchant';
import { extractReference } from './extractors/reference';
import { normalizeCurrencySpacing, normalizeSmsText } from './normalizer';
import type { ISmsParser } from './parser.interface';
import { lookupSender } from './sender-registry';
import type { ParsedTransaction } from './types';
import { validateTransaction } from './validators/transaction.validator';

/**
 * Standard rule-based parser for Indian banking SMS messages.
 */
export class RuleBasedBankParser implements ISmsParser {
  readonly name = 'indian_bank_rule_parser';
  readonly version = '1.0.0';

  canParse(_sender: string, text: string): boolean {
    if (!text || text.length < 10) return false;
    return true;
  }

  parse(sender: string, text: string, receivedAt: number): ParsedTransaction | null {
    if (!this.canParse(sender, text)) return null;

    // 1. Text normalization
    const cleanText = normalizeSmsText(text);
    const normalizedText = normalizeCurrencySpacing(cleanText);

    // 2. Identify sender via TRAI registry
    const senderInfo = lookupSender(sender);

    // 3. Keyword and disqualifier detection
    const detection = detectTransaction(normalizedText);
    if (!detection.isCandidate || !detection.transactionType) {
      return null;
    }

    // 4. Extract monetary transaction amount
    const amount = extractAmount(normalizedText);
    if (!amount || amount.paise <= 0) {
      return null;
    }

    // 5. Extract account balance (if present)
    const balance = extractBalance(normalizedText);

    // 6. Extract account or card identifier (if present)
    const account = extractAccount(normalizedText);

    // 7. Extract transaction reference number (if present)
    const reference = extractReference(normalizedText);

    // 8. Extract merchant or beneficiary (if present)
    const merchant = extractMerchant(normalizedText, senderInfo.entityName);

    // 9. Transaction date: fallback to SMS received timestamp
    const transactionDate = receivedAt || Date.now();

    // 10. Construct candidate
    const candidate: ParsedTransaction = {
      transactionType: detection.transactionType,
      amountPaise: amount.paise,
      currency: 'INR',
      merchant: merchant?.merchant ?? null,
      bankName: senderInfo.entityName ?? null,
      accountIdentifier: account?.accountIdentifier ?? null,
      referenceNumber: reference?.referenceNumber ?? null,
      transactionDate,
      balancePaise: balance?.paise ?? null,
      parserName: this.name,
      parserVersion: this.version,
    };

    // 11. Validate against strict rules
    const validation = validateTransaction(candidate);
    if (!validation.isValid) {
      return null;
    }

    return candidate;
  }
}

/**
 * Central registry holding all active SMS parsers.
 */
class ParserRegistry {
  private parsers: ISmsParser[] = [];

  constructor() {
    // Register the standard rule-based parser
    this.register(new RuleBasedBankParser());
  }

  register(parser: ISmsParser): void {
    this.parsers.push(parser);
  }

  parse(sender: string, text: string, receivedAt: number): ParsedTransaction | null {
    for (const parser of this.parsers) {
      try {
        const result = parser.parse(sender, text, receivedAt);
        if (result) {
          return result;
        }
      } catch {
        // Safe fallback: a parser error should never crash the engine
      }
    }
    return null;
  }
}

export const defaultParserRegistry = new ParserRegistry();
