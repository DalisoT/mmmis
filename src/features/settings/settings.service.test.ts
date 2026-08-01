import { describe, expect, it } from 'vitest';
import { settingsFormSchema } from './settings.service';

// The Settings page guards the Save button on form dirtiness and then
// hands the form values to useUpdateMessSettings. If the Zod schema is
// wrong, either the form fails client-side (UX bug) or bad values reach
// the database (data bug). These tests pin the contract.

describe('settingsFormSchema', () => {
  const validInput = {
    mess_name: 'Officers Mess',
    currency_code: 'ZMW',
    opening_float: 1000,
    recovery_target_pct: 30,
    vat_pct: 0,
    holiday_mode: false,
  };

  it('accepts the canonical settings shape', () => {
    const parsed = settingsFormSchema.parse(validInput);
    expect(parsed).toEqual(validInput);
  });

  it('coerces numeric strings from <input type="number">', () => {
    // The form uses RHF's register() which produces strings for number
    // inputs; the schema must coerce them.
    const parsed = settingsFormSchema.parse({
      ...validInput,
      opening_float: '1500.50',
      recovery_target_pct: '25',
      vat_pct: '17.5',
    });
    expect(parsed.opening_float).toBe(1500.5);
    expect(parsed.recovery_target_pct).toBe(25);
    expect(parsed.vat_pct).toBe(17.5);
  });

  it('rejects empty mess names', () => {
    const result = settingsFormSchema.safeParse({ ...validInput, mess_name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects currency codes that are not exactly 3 characters', () => {
    expect(settingsFormSchema.safeParse({ ...validInput, currency_code: 'ZM' }).success).toBe(false);
    expect(settingsFormSchema.safeParse({ ...validInput, currency_code: 'ZMWX' }).success).toBe(false);
    expect(settingsFormSchema.safeParse({ ...validInput, currency_code: 'zmw' }).success).toBe(true); // case not enforced
  });

  it('rejects negative opening_float', () => {
    const result = settingsFormSchema.safeParse({ ...validInput, opening_float: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects recovery_target_pct outside 0–100', () => {
    expect(settingsFormSchema.safeParse({ ...validInput, recovery_target_pct: -1 }).success).toBe(false);
    expect(settingsFormSchema.safeParse({ ...validInput, recovery_target_pct: 101 }).success).toBe(false);
    expect(settingsFormSchema.safeParse({ ...validInput, recovery_target_pct: 0 }).success).toBe(true);
    expect(settingsFormSchema.safeParse({ ...validInput, recovery_target_pct: 100 }).success).toBe(true);
  });

  it('rejects vat_pct outside 0–100', () => {
    expect(settingsFormSchema.safeParse({ ...validInput, vat_pct: -0.01 }).success).toBe(false);
    expect(settingsFormSchema.safeParse({ ...validInput, vat_pct: 100.01 }).success).toBe(false);
  });

  it('preserves holiday_mode as a boolean', () => {
    expect(settingsFormSchema.parse({ ...validInput, holiday_mode: true }).holiday_mode).toBe(true);
    expect(settingsFormSchema.parse({ ...validInput, holiday_mode: false }).holiday_mode).toBe(false);
  });
});
