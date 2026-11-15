import { describe, expect, test } from 'bun:test';
import { defaultParserRegistry } from '../parser.registry';

describe('End-to-End SMS Transaction Parser Fixtures', () => {
  test('1. Bank debit fixture', () => {
    const sender = 'JD-CENTBK-T';
    const message = 'A/c XX1089 debited by Rs. 199.00 via UPI with Ref No. 104479862167 Total Bal Rs. 61757.32 Clr Bal Rs. 61757.32. -CBoI';
    const receivedAt = 1731650000000;

    const tx = defaultParserRegistry.parse(sender, message, receivedAt);
    expect(tx).not.toBeNull();
    expect(tx?.transactionType).toBe('debit');
    expect(tx?.amountPaise).toBe(19900);
    expect(tx?.bankName).toContain('Central Bank of India');
    expect(tx?.accountIdentifier).toBe('XX1089');
    expect(tx?.referenceNumber).toBe('104479862167');
    expect(tx?.balancePaise).toBe(6175732);
    expect(tx?.currency).toBe('INR');
  });

  test('2. Bank credit fixture', () => {
    const sender = 'JK-CENTBK-S';
    const message = 'A/c 3XXXXX1089 credited by Rs. 50,000 Total Bal: Rs. 1,12,086.59 CR Clr Bal: Rs. 1,12,086.59 CR-CBoI';
    const receivedAt = 1731650000000;

    const tx = defaultParserRegistry.parse(sender, message, receivedAt);
    expect(tx).not.toBeNull();
    expect(tx?.transactionType).toBe('credit');
    expect(tx?.amountPaise).toBe(5000000);
    expect(tx?.bankName).toContain('Central Bank of India');
    expect(tx?.accountIdentifier).toBe('3XXXXX1089');
    expect(tx?.balancePaise).toBe(11208659);
  });

  test('3. UPI debit fixture with merchant and ref', () => {
    const sender = 'AX-HDFCBK-S';
    const message = 'Paid Rs. 249.00 to Swiggy via UPI with Ref 432109876543 on 15-Nov-26 from HDFC Bank A/c XX4321. Bal: Rs. 12500.00';
    const receivedAt = 1731650000000;

    const tx = defaultParserRegistry.parse(sender, message, receivedAt);
    expect(tx).not.toBeNull();
    expect(tx?.transactionType).toBe('debit');
    expect(tx?.amountPaise).toBe(24900);
    expect(tx?.merchant).toBe('Swiggy');
    expect(tx?.referenceNumber).toBe('432109876543');
    expect(tx?.accountIdentifier).toBe('XX4321');
    expect(tx?.balancePaise).toBe(1250000);
  });

  test('4. UPI credit fixture from sender', () => {
    const sender = 'AX-CENTBK-T';
    const message = 'A/c XX1089 credited by Rs. 1.00 on 25092026 via UPI from GOOGLE INDIA DIGITAL SERV via Ref No. 982875752686';
    const receivedAt = 1731650000000;

    const tx = defaultParserRegistry.parse(sender, message, receivedAt);
    expect(tx).not.toBeNull();
    expect(tx?.transactionType).toBe('credit');
    expect(tx?.amountPaise).toBe(100);
    expect(tx?.merchant).toBe('GOOGLE INDIA DIGITAL SERV');
    expect(tx?.referenceNumber).toBe('982875752686');
  });

  test('5. ATM cash withdrawal fixture', () => {
    const sender = 'VK-SBIINB-S';
    const message = 'Rs 4000.00 withdrawn at SBI ATM S1NA001428014 from A/C ...9876 on 14Nov26. Avail Bal Rs 15430.50';
    const receivedAt = 1731650000000;

    const tx = defaultParserRegistry.parse(sender, message, receivedAt);
    expect(tx).not.toBeNull();
    expect(tx?.transactionType).toBe('debit');
    expect(tx?.amountPaise).toBe(400000);
    expect(tx?.bankName).toContain('STATE BANK OF INDIA');
    expect(tx?.accountIdentifier).toBe('...9876');
    expect(tx?.balancePaise).toBe(1543050);
  });

  test('6. Credit card payment / spend fixture', () => {
    const sender = 'AD-AXISBK-S';
    const message = 'Spent Rs. 1,299.00 on Axis Bank Credit Card ending 7654 at ZOMATO on 15-Nov-26. Avail limit: Rs. 45,000';
    const receivedAt = 1731650000000;

    const tx = defaultParserRegistry.parse(sender, message, receivedAt);
    expect(tx).not.toBeNull();
    expect(tx?.transactionType).toBe('debit');
    expect(tx?.amountPaise).toBe(129900);
    expect(tx?.accountIdentifier).toBe('7654');
    expect(tx?.merchant).toBe('ZOMATO');
  });

  test('7. NEFT / IMPS transfer fixture', () => {
    const sender = 'JD-CENTBK-S';
    const message = 'Rs. 7300.00 credited to your A/c 3XXXXX1089 on 25/09/2025 through NEFT vide Ref No. NEFT12345678.';
    const receivedAt = 1731650000000;

    const tx = defaultParserRegistry.parse(sender, message, receivedAt);
    expect(tx).not.toBeNull();
    expect(tx?.transactionType).toBe('credit');
    expect(tx?.amountPaise).toBe(730000);
    expect(tx?.accountIdentifier).toBe('3XXXXX1089');
    expect(tx?.referenceNumber).toBe('NEFT12345678');
  });

  test('8. Refund fixture', () => {
    const sender = 'AX-AIRBNK-S';
    const message = 'Rs. 350.00 refunded to your Airtel Payments Bank a/c Txn ID 998877665544. Bal: Rs. 1200.00';
    const receivedAt = 1731650000000;

    const tx = defaultParserRegistry.parse(sender, message, receivedAt);
    expect(tx).not.toBeNull();
    expect(tx?.transactionType).toBe('refund');
    expect(tx?.amountPaise).toBe(35000);
    expect(tx?.referenceNumber).toBe('998877665544');
    expect(tx?.balancePaise).toBe(120000);
  });

  test('9. OTP containing numeric codes (must return null)', () => {
    const sender = 'JD-DLHVRY-S';
    const message = '<#> Hi, your Delhivery login code is 257659. Do not share this with anyone. Valid for 60 seconds. i/5XkxXrol - Delhivery';
    expect(defaultParserRegistry.parse(sender, message, Date.now())).toBeNull();
  });

  test('10. Promotional SMS (must return null)', () => {
    const sender = 'AD-HDFCBK';
    const message = 'Congratulations! Pre-approved personal loan of Rs 5,00,000 at zero processing fee. Apply now!';
    expect(defaultParserRegistry.parse(sender, message, Date.now())).toBeNull();
  });

  test('11. Failed transaction (must return null)', () => {
    const sender = 'JD-CENTBK-T';
    const message = 'Transaction of Rs. 199.00 on A/c XX1089 has failed due to incorrect PIN. Ref: 104479862167';
    expect(defaultParserRegistry.parse(sender, message, Date.now())).toBeNull();
  });

  test('12. Pending transaction (must return null)', () => {
    const sender = 'AX-AIRBNK-S';
    const message = 'Payment of Rs. 500.00 is pending. You will receive an SMS once completed. Txn ID: 123456';
    expect(defaultParserRegistry.parse(sender, message, Date.now())).toBeNull();
  });

  test('13. Balance-only notification (must return null)', () => {
    const sender = 'JD-CENTBK-S';
    const message = 'Dear Customer, your total account balance for A/c XX1089 is Rs. 61757.32 as of 15-Nov.';
    expect(defaultParserRegistry.parse(sender, message, Date.now())).toBeNull();
  });

  test('14. Unknown sender with valid format still parses financial data correctly', () => {
    const sender = 'UNKNOWN_SENDER';
    const message = 'A/c XX9999 debited by Rs. 850.00 for grocery. Ref No. 9876543210. Total Bal Rs. 5000.00';
    const tx = defaultParserRegistry.parse(sender, message, Date.now());
    expect(tx).not.toBeNull();
    expect(tx?.bankName).toBeNull();
    expect(tx?.amountPaise).toBe(85000);
    expect(tx?.accountIdentifier).toBe('XX9999');
    expect(tx?.referenceNumber).toBe('9876543210');
  });

  test('15. Unknown/Gibberish SMS format (must return null without crashing)', () => {
    expect(defaultParserRegistry.parse('UNKNOWN', 'Hello friend how are you?', Date.now())).toBeNull();
    expect(defaultParserRegistry.parse('UNKNOWN', '12345 67890 !!!! ???', Date.now())).toBeNull();
    expect(defaultParserRegistry.parse('', '', 0)).toBeNull();
  });

  test('16. Multiple monetary amounts in one message (must pick transaction amount)', () => {
    const sender = 'AX-AIRBNK-S';
    // Rs 15.00 is txn amount, 337.68 is balance, 180023400 is phone number
    const message = 'Rs. 15.00 debited from Airtel Payments Bank a/c Txn ID 224400498783 Bal:337.68 Call 180023400 for help';
    const tx = defaultParserRegistry.parse(sender, message, Date.now());
    expect(tx).not.toBeNull();
    expect(tx?.amountPaise).toBe(1500); // Rs 15.00
    expect(tx?.balancePaise).toBe(33768); // Rs 337.68
  });
});
