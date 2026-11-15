import { describe, expect, test } from 'bun:test';
import { detectTransaction } from '../detector';

describe('Transaction Detector Rules', () => {
  describe('Debit Direction', () => {
    test('detects "debited"', () => {
      const res = detectTransaction('A/c XX1089 debited by Rs. 199.00 via UPI');
      expect(res.isCandidate).toBe(true);
      expect(res.transactionType).toBe('debit');
    });

    test('detects "withdrawn"', () => {
      const res = detectTransaction('Rs 2,000 withdrawn from ATM A/c XX1234');
      expect(res.isCandidate).toBe(true);
      expect(res.transactionType).toBe('debit');
    });

    test('detects "spent"', () => {
      const res = detectTransaction('You have spent Rs. 450 at Starbucks on Credit Card 1234');
      expect(res.isCandidate).toBe(true);
      expect(res.transactionType).toBe('debit');
    });

    test('detects "paid"', () => {
      const res = detectTransaction('Paid Rs. 150 to Swiggy using UPI');
      expect(res.isCandidate).toBe(true);
      expect(res.transactionType).toBe('debit');
    });

    test('detects "transferred to"', () => {
      const res = detectTransaction('INR 5,000 transferred to John Doe A/c 5678');
      expect(res.isCandidate).toBe(true);
      expect(res.transactionType).toBe('debit');
    });
  });

  describe('Credit Direction', () => {
    test('detects "credited"', () => {
      const res = detectTransaction('A/c 3XXXXX1089 credited by Rs. 50,000');
      expect(res.isCandidate).toBe(true);
      expect(res.transactionType).toBe('credit');
    });

    test('detects "deposited"', () => {
      const res = detectTransaction('Rs. 10,000 deposited in your account 1234');
      expect(res.isCandidate).toBe(true);
      expect(res.transactionType).toBe('credit');
    });

    test('detects "received from"', () => {
      const res = detectTransaction('Received Rs. 1,500 from Alice via UPI');
      expect(res.isCandidate).toBe(true);
      expect(res.transactionType).toBe('credit');
    });
  });

  describe('Refund Direction', () => {
    test('detects "refunded"', () => {
      const res = detectTransaction('Rs. 499 refunded for order 12345 to your A/c XX1089');
      expect(res.isCandidate).toBe(true);
      expect(res.transactionType).toBe('refund');
    });

    test('detects "reversal"', () => {
      const res = detectTransaction('Reversal of Rs. 200 credited to A/c XX1089');
      expect(res.isCandidate).toBe(true);
      expect(res.transactionType).toBe('refund');
    });
  });

  describe('Disqualification & Rejection Rules', () => {
    test('rejects OTP and verification codes', () => {
      const otp1 = 'Your Delhivery login code is 257659. Do not share this with anyone. Valid for 60 seconds.';
      const res1 = detectTransaction(otp1);
      expect(res1.isCandidate).toBe(false);
      expect(res1.rejectionReason).toContain('OTP');

      const otp2 = '578847 is your Flipkart verification code. Code valid for 10 minutes.';
      const res2 = detectTransaction(otp2);
      expect(res2.isCandidate).toBe(false);

      const otp3 = '960969 is your one time password (OTP). Do not share.';
      const res3 = detectTransaction(otp3);
      expect(res3.isCandidate).toBe(false);
    });

    test('rejects failed or declined transactions', () => {
      const failed = 'Transaction of Rs. 500 at Swiggy has failed due to bank timeout.';
      const res = detectTransaction(failed);
      expect(res.isCandidate).toBe(false);
      expect(res.rejectionReason).toContain('failed');

      const declined = 'Payment of Rs. 1,000 was declined by your bank.';
      const res2 = detectTransaction(declined);
      expect(res2.isCandidate).toBe(false);
    });

    test('rejects pending transactions and future conditional alerts', () => {
      const pending = 'Payment of Rs. 500 is pending with beneficiary bank.';
      const res = detectTransaction(pending);
      expect(res.isCandidate).toBe(false);

      const future = 'Initial funding successful. On A/c activation, INR 5590.00 will be credited to your A/c.';
      const res2 = detectTransaction(future);
      expect(res2.isCandidate).toBe(false);
    });

    test('rejects payment reminders and bills due', () => {
      const reminder = 'Electricity bill of Rs. 1,450 is due on 20-Nov. Please pay immediately.';
      const res = detectTransaction(reminder);
      expect(res.isCandidate).toBe(false);
    });

    test('rejects promotional and marketing messages', () => {
      const promo = 'Congratulations! You have a pre-approved loan of Rs. 5,00,000. Apply now!';
      const res = detectTransaction(promo);
      expect(res.isCandidate).toBe(false);
    });

    test('rejects balance-only alerts without action keywords', () => {
      const balOnly = 'Your total account balance for A/c XX1089 is Rs. 61,757.32.';
      const res = detectTransaction(balOnly);
      expect(res.isCandidate).toBe(false);
      expect(res.rejectionReason).toContain('No explicit debit or credit');
    });

    test('rejects ambiguous messages having conflicting keywords', () => {
      const ambig = 'Amount debited Rs. 500 then credited back Rs. 500 in one line';
      const res = detectTransaction(ambig);
      expect(res.isCandidate).toBe(false);
      expect(res.rejectionReason).toContain('Ambiguous');
    });
  });
});
