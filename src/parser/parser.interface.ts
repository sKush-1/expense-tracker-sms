import type { ParsedTransaction } from './types';

/**
 * Interface that all SMS transaction parsers must implement.
 */
export interface ISmsParser {
  /** Identifier name of the parser */
  readonly name: string;

  /** Version string for auditing */
  readonly version: string;

  /**
   * Quick filter to check if this parser should attempt parsing the SMS.
   */
  canParse(sender: string, text: string): boolean;

  /**
   * Parses an SMS message into a validated transaction or returns null if not a transaction.
   */
  parse(sender: string, text: string, receivedAt: number): ParsedTransaction | null;
}
