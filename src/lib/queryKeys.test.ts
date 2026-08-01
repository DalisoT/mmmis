import { describe, expect, it } from 'vitest';
import { createQueryKeys } from './queryKeys';

describe('createQueryKeys', () => {
  it('returns the root tuple for null entries', () => {
    const keys = createQueryKeys('sales', {
      all: null,
    });
    expect(keys.all).toEqual(['sales']);
  });

  it('tags sub-keys with a name string', () => {
    const keys = createQueryKeys('sales', {
      all: null,
      byDate: 'day',
    });
    expect(keys.all).toEqual(['sales']);
    expect(keys.byDate).toEqual(['sales', 'day']);
  });

  it('appends the function result to the root tuple', () => {
    const keys = createQueryKeys('mess-settings', {
      all: null,
      current: 'current',
    });
    expect(keys.current).toEqual(['mess-settings', 'current']);
  });

  it('exposes parameterised keys as callable functions', () => {
    const keys = createQueryKeys('sales', {
      all: null,
      byDate: (date: string) => ({ date }),
    });
    expect(keys.byDate('2026-08-01')).toEqual(['sales', { date: '2026-08-01' }]);
  });

  it('treats different root tuples as different namespaces', () => {
    const a = createQueryKeys('foo', { all: null });
    const b = createQueryKeys('bar', { all: null });
    expect(a.all).not.toEqual(b.all);
  });

  it('uses the same root prefix for every key in the shape', () => {
    const keys = createQueryKeys('audit', {
      all: null,
      list: 'list',
      recent: (n: number) => ({ n }),
    });
    expect(keys.all[0]).toBe('audit');
    expect(keys.list[0]).toBe('audit');
    expect(keys.recent(5)[0]).toBe('audit');
  });

  it('passes runtime arguments through to the factory entry', () => {
    const keys = createQueryKeys('dashboard', {
      topSelling: (days: number, limit: number) => ({ days, limit }),
    });
    expect(keys.topSelling(7, 5)).toEqual(['dashboard', { days: 7, limit: 5 }]);
  });

  it('throws on unsupported entry types', () => {
    expect(() =>
      createQueryKeys('broken', {
        // @ts-expect-error -- runtime test for the throw branch
        bad: 42,
      })
    ).toThrow(/must be null, a string, or a function/);
  });
});
