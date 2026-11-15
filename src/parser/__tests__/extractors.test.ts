import { describe, expect, test } from 'bun:test';
import { extractAccount } from '../extractors/account';
import { extractAmount } from '../extractors/amount';
import { extractBalance, parseToPaise } from '../extractors/balance';
import { extractMerchant } from '../extractors/merchant';
import { extractReference } from '../extractors/reference';

describe('Amount Extractor & Paise Conversion', () => {
  test('converts strings to integer paise without floating point issues', () => {
    expect(parseToPaise('500')).toBe(50000);
    expect(parseToPaise('500.00')).toBe(50000);
    expect(parseToPaise('1,250.50')).toBe(125050);
    expect(parseToPaise('0.05')).toBe(5);
    expect(parseToPaise('199.99')).toBe(19999);
    expect(parseToPaise('61757.32')).toBe(6175732);
  });

  test('extracts various currency formats', () => {
    expect(extractAmount('Your account debited by Rs. 500 on 14-Nov')?.paise).toBe(50000);
    expect(extractAmount('Your account debited by Rs 500.00 on 14-Nov')?.paise).toBe(50000);
    expect(extractAmount('Your account debited by INR 500 on 14-Nov')?.paise).toBe(50000);
    expect(extractAmount('Your account debited by INR 1,250.50 on 14-Nov')?.paise).toBe(125050);
    expect(extractAmount('Your account debited by ₹500 on 14-Nov')?.paise).toBe(50000);
    expect(extractAmount('Your account debited by ₹1,250.50 on 14-Nov')?.paise).toBe(125050);
    expect(extractAmount('Paid 500 rupees to vendor')?.paise).toBe(50000);
  });

  test('prioritizes transaction amount over balance when multiple amounts appear', () => {
    const text = 'A/c XX1089 debited by Rs. 199.00 via UPI with Ref No. 104479862167 Total Bal Rs. 61757.32 Clr Bal Rs. 61757.32';
    const amount = extractAmount(text);
    expect(amount?.paise).toBe(19900); // Rs 199.00, NOT the balance of 61757.32
  });

  test('extracts amount when placed at the start of SMS', () => {
    const text = 'Rs. 15.00 debited from Airtel Payments Bank a/c Txn ID 224400498783 Bal:337.68 Call 180023400 for help';
    const amount = extractAmount(text);
    expect(amount?.paise).toBe(1500); // Rs 15.00, NOT the balance 337.68 or phone 180023400
  });

  test('does not extract OTP numbers, dates, or reference numbers as amounts', () => {
    const otpText = 'Your Delhivery login code is 257659. Valid for 60 seconds.';
    expect(extractAmount(otpText)).toBeNull();

    const dateText = 'Appointment booked on 15/11/2026. Ref No: 9876543210.';
    expect(extractAmount(dateText)).toBeNull();
  });
});

describe('Balance Extractor', () => {
  test('extracts Total Bal, Clr Bal, and Bal formats in paise', () => {
    const text1 = 'A/c XX1089 debited by Rs. 199.00 Total Bal Rs. 61757.32 Clr Bal Rs. 61757.32';
    expect(extractBalance(text1)?.paise).toBe(6175732);

    const text2 = 'Rs. 15.00 debited. Bal:337.68';
    expect(extractBalance(text2)?.paise).toBe(33768);

    const text3 = 'A/c credited. Avl Bal: INR 10,000.50';
    expect(extractBalance(text3)?.paise).toBe(1000050);

    const text4 = 'Available Balance: Rs. 5,000';
    expect(extractBalance(text4)?.paise).toBe(500000);
  });

  test('returns null when no balance is mentioned', () => {
    expect(extractBalance('Rs. 500 debited for dinner.')).toBeNull();
  });
});

describe('Account Extractor', () => {
  test('extracts bank account formats', () => {
    expect(extractAccount('A/c XX1089 debited by Rs. 500')?.accountIdentifier).toBe('XX1089');
    expect(extractAccount('A/c 3XXXXX1089 credited by Rs. 1000')?.accountIdentifier).toBe('3XXXXX1089');
    expect(extractAccount('A/C *1234 debited by INR 250')?.accountIdentifier).toBe('*1234');
    expect(extractAccount('Account ending 5678 debited')?.accountIdentifier).toBe('5678');
  });

  test('extracts card identifiers', () => {
    const cardRes = extractAccount('Credit Card ending with 4321 spent Rs. 1200');
    expect(cardRes?.accountIdentifier).toBe('4321');
    expect(cardRes?.accountType).toBe('card');
  });
});

describe('Reference Extractor', () => {
  test('extracts UPI Ref, Txn ID, UTR, and RRN', () => {
    expect(extractReference('UPI Ref: 104479862167')?.referenceNumber).toBe('104479862167');
    expect(extractReference('Ref No. 630189912489')?.referenceNumber).toBe('630189912489');
    expect(extractReference('Txn ID 224400498783')?.referenceNumber).toBe('224400498783');
    expect(extractReference('UTR: 123456789012')?.referenceNumber).toBe('123456789012');
    expect(extractReference('RRN 987654321012')?.referenceNumber).toBe('987654321012');
  });
});

describe('Merchant Extractor', () => {
  test('extracts merchant names from UPI and card patterns', () => {
    expect(extractMerchant('Paid to Swiggy on 14-Nov', 'HDFC Bank')?.merchant).toBe('Swiggy');
    expect(extractMerchant('Spent at Starbucks on 14-Nov', 'HDFC Bank')?.merchant).toBe('Starbucks');
    expect(extractMerchant('via UPI from GOOGLE INDIA DIGITAL SERV via Ref No. 98287', 'Central Bank of India')?.merchant).toBe('GOOGLE INDIA DIGITAL SERV');
    expect(extractMerchant('Transferred to user@okaxis on 14-Nov', 'SBI')?.merchant).toBe('user@okaxis');
    expect(extractMerchant('towards Electricity Bill ref 123', 'SBI')?.merchant).toBe('Electricity Bill');
  });

  test('does not set bank name as merchant', () => {
    const res = extractMerchant('Transferred to Central Bank of India ref 123', 'Central Bank of India');
    expect(res).toBeNull();
  });
});
