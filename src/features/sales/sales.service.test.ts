import { describe, expect, it } from 'vitest';
import { cartItemSchema, expenseFormSchema } from './sales.service';

// The POS and the Expenses page submit values that flow directly into the
// create_sale() / expense insert RPCs. Catching bad shapes client-side
// saves a round-trip and gives the barman a clearer error message.

describe('cartItemSchema', () => {
  const validItem = {
    product_id: '00000000-0000-0000-0000-000000000001',
    name: 'Coca-Cola 500ml',
    unit: 'bottle',
    unit_price: 8.5,
    quantity: 2,
  };

  it('accepts a well-formed cart line', () => {
    expect(cartItemSchema.parse(validItem)).toEqual(validItem);
  });

  it('rejects non-UUID product_id', () => {
    const result = cartItemSchema.safeParse({ ...validItem, product_id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('rejects zero or negative quantity', () => {
    expect(cartItemSchema.safeParse({ ...validItem, quantity: 0 }).success).toBe(false);
    expect(cartItemSchema.safeParse({ ...validItem, quantity: -1 }).success).toBe(false);
  });

  it('rejects non-integer quantity', () => {
    expect(cartItemSchema.safeParse({ ...validItem, quantity: 1.5 }).success).toBe(false);
  });

  it('rejects negative unit_price (free items must be 0, not negative)', () => {
    expect(cartItemSchema.safeParse({ ...validItem, unit_price: -0.01 }).success).toBe(false);
    // Zero IS allowed (comp / free issue).
    expect(cartItemSchema.safeParse({ ...validItem, unit_price: 0 }).success).toBe(true);
  });

  it('coerces numeric strings from the form', () => {
    const parsed = cartItemSchema.parse({
      ...validItem,
      unit_price: '8.50',
      quantity: '3',
    });
    expect(parsed.unit_price).toBe(8.5);
    expect(parsed.quantity).toBe(3);
  });
});

describe('expenseFormSchema', () => {
  const validExpense = {
    expense_date: '2026-07-31',
    description: 'Cleaning supplies',
    amount: 250,
    purpose: 'Restock',
    remarks: '',
  };

  it('accepts a well-formed expense', () => {
    expect(expenseFormSchema.parse(validExpense)).toEqual(validExpense);
  });

  it('requires a description of at least 2 characters', () => {
    expect(expenseFormSchema.safeParse({ ...validExpense, description: '' }).success).toBe(false);
    expect(expenseFormSchema.safeParse({ ...validExpense, description: 'x' }).success).toBe(false);
    expect(expenseFormSchema.safeParse({ ...validExpense, description: 'ab' }).success).toBe(true);
  });

  it('requires a purpose of at least 2 characters', () => {
    expect(expenseFormSchema.safeParse({ ...validExpense, purpose: '' }).success).toBe(false);
    expect(expenseFormSchema.safeParse({ ...validExpense, purpose: 'p' }).success).toBe(false);
  });

  it('requires a non-empty expense_date', () => {
    expect(expenseFormSchema.safeParse({ ...validExpense, expense_date: '' }).success).toBe(false);
  });

  it('rejects zero or negative amounts', () => {
    expect(expenseFormSchema.safeParse({ ...validExpense, amount: 0 }).success).toBe(false);
    expect(expenseFormSchema.safeParse({ ...validExpense, amount: -1 }).success).toBe(false);
  });

  it('coerces numeric amount strings', () => {
    const parsed = expenseFormSchema.parse({ ...validExpense, amount: '99.99' });
    expect(parsed.amount).toBe(99.99);
  });

  it('makes remarks optional', () => {
    const { remarks: _omit, ...without } = validExpense;
    expect(expenseFormSchema.parse(without).remarks).toBeUndefined();
  });
});
