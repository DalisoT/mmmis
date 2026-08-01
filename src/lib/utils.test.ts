import { describe, expect, it } from 'vitest';
import { cn, formatCurrency, formatDateTime, genStrongPassword } from './utils';

describe('cn', () => {
  it('merges tailwind classes with later values winning', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
    expect(cn('text-red-500', false && 'text-blue-500', 'text-green-500')).toBe('text-green-500');
  });

  it('handles empty inputs', () => {
    expect(cn()).toBe('');
    expect(cn('px-2')).toBe('px-2');
  });
});

describe('formatCurrency', () => {
  it('formats a number as ZMW by default', () => {
    // en-ZM locale uses "K" suffix (e.g. K123.45)
    const out = formatCurrency(123.45);
    expect(out).toMatch(/123\.45/);
    // Either "K123.45" or "ZMW 123.45" depending on Node Intl data; assert
    // a currency symbol/code is present.
    expect(out).toMatch(/K|ZMW/);
  });

  it('honors an explicit currency code', () => {
    const out = formatCurrency(9.99, 'USD');
    expect(out).toContain('9.99');
    expect(out).toMatch(/\$|USD/);
  });

  it('handles zero and negative values', () => {
    expect(formatCurrency(0)).toMatch(/0\.00/);
    expect(formatCurrency(-50)).toMatch(/50\.00/);
  });
});

describe('formatDateTime', () => {
  it('returns an em-dash for null/undefined/invalid', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime(undefined)).toBe('—');
    expect(formatDateTime('')).toBe('—');
    expect(formatDateTime('not-a-date')).toBe('—');
  });

  it('formats an ISO string as a readable datetime', () => {
    // 2026-07-31 14:30 UTC. Locale en-GB is fixed; the year + month + time
    // are stable. We just assert it contains "2026" and a 2-digit time.
    const out = formatDateTime('2026-07-31T14:30:00Z');
    expect(out).toContain('2026');
    expect(out).toMatch(/\d{2}:\d{2}/);
  });

  it('accepts a Date instance', () => {
    const out = formatDateTime(new Date('2026-01-15T09:00:00Z'));
    expect(out).toContain('2026');
    expect(out).toContain('Jan');
  });
});

describe('genStrongPassword', () => {
  it('returns a string of the requested length', () => {
    expect(genStrongPassword(16)).toHaveLength(16);
    expect(genStrongPassword(24)).toHaveLength(24);
  });

  it('clamps to a minimum length of 8', () => {
    expect(genStrongPassword(4)).toHaveLength(8);
  });

  it('includes at least one uppercase, one digit, and one symbol', () => {
    const pw = genStrongPassword();
    expect(pw).toMatch(/[A-Z]/);
    expect(pw).toMatch(/[0-9]/);
    expect(pw).toMatch(/[!@#$%^&*]/);
  });

  it('never uses ambiguous characters (no 0/O/1/l/I)', () => {
    // The alphabet excludes 0/O/1/l/I — confirm by repeated sampling.
    for (let i = 0; i < 50; i++) {
      const pw = genStrongPassword();
      expect(pw).not.toMatch(/[0O1lI]/);
    }
  });

  it('produces different values across calls', () => {
    const a = genStrongPassword();
    const b = genStrongPassword();
    expect(a).not.toBe(b);
  });
});
