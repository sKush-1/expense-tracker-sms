import { describe, expect, test } from 'bun:test';
import {
  extractHeader,
  getRegisteredHeaderCount,
  isRegisteredHeader,
  lookupSender,
} from '../sender-registry';

describe('Sender Registry & Normalization', () => {
  test('loads registered TRAI headers dataset', () => {
    const count = getRegisteredHeaderCount();
    expect(count).toBeGreaterThan(1500);
  });

  test('normalizes 3-part TRAI senders (Prefix-Header-Suffix)', () => {
    expect(extractHeader('JD-CENTBK-T')).toBe('CENTBK');
    expect(extractHeader('AX-HDFCBK-S')).toBe('HDFCBK');
    expect(extractHeader('VK-SBIINB-S')).toBe('SBIINB');
    expect(extractHeader('AD-650018-P')).toBe('650018');
    expect(extractHeader('AX-AIRBNK-S')).toBe('AIRBNK');
  });

  test('normalizes 2-part TRAI senders (Prefix-Header)', () => {
    expect(extractHeader('AD-CENTBK')).toBe('CENTBK');
    expect(extractHeader('AX-HDFCBK')).toBe('HDFCBK');
    expect(extractHeader('AD-650025')).toBe('650025');
  });

  test('normalizes Header-Suffix format', () => {
    expect(extractHeader('CENTBK-T')).toBe('CENTBK');
    expect(extractHeader('HDFCBK-S')).toBe('HDFCBK');
  });

  test('handles bare headers without prefix or suffix', () => {
    expect(extractHeader('CENTBK')).toBe('CENTBK');
    expect(extractHeader('HDFCBK')).toBe('HDFCBK');
    expect(extractHeader('111000')).toBe('111000');
    expect(extractHeader('AXISB')).toBe('AXISB');
    expect(extractHeader('CITI')).toBe('CITI');
  });

  test('handles personal numbers without corrupting them', () => {
    expect(extractHeader('+919876543210')).toBe('+919876543210');
    expect(extractHeader('9876543210')).toBe('9876543210');
  });

  test('looks up known bank senders correctly', () => {
    const cboi = lookupSender('JD-CENTBK-T');
    expect(cboi.isRegistered).toBe(true);
    expect(cboi.header).toBe('CENTBK');
    expect(cboi.entityName).toContain('Central Bank of India');

    const airtel = lookupSender('AX-AIRBNK-S');
    expect(airtel.isRegistered).toBe(true);
    expect(airtel.header).toBe('AIRBNK');
    expect(airtel.entityName).toContain('Airtel Payments Bank');

    const hdfc = lookupSender('AD-HDFCBK');
    expect(hdfc.isRegistered).toBe(true);
    expect(hdfc.header).toBe('HDFCBK');
    expect(hdfc.entityName).toContain('HDFC BANK');

    const sbi = lookupSender('VK-SBIINB-S');
    expect(sbi.isRegistered).toBe(true);
    expect(sbi.header).toBe('SBIINB');
    expect(sbi.entityName).toContain('STATE BANK OF INDIA');
  });

  test('handles unknown or non-bank senders gracefully', () => {
    const unknown = lookupSender('JD-DLHVRY-S');
    expect(unknown.isRegistered).toBe(false);
    expect(unknown.header).toBe('DLHVRY');
    expect(unknown.entityName).toBeNull();

    const personal = lookupSender('+91-9876543210');
    expect(personal.isRegistered).toBe(false);
    expect(personal.entityName).toBeNull();
  });

  test('isRegisteredHeader helper works as expected', () => {
    expect(isRegisteredHeader('JD-CENTBK-T')).toBe(true);
    expect(isRegisteredHeader('AX-AIRBNK-S')).toBe(true);
    expect(isRegisteredHeader('RANDOM_XYZ')).toBe(false);
  });
});
