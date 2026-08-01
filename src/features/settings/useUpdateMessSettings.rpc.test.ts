import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { MessSettings, SettingsFormValues } from './settings.service';
import { settingsFormSchema, useUpdateMessSettings } from './settings.service';

// P5.1 — confirm `useUpdateMessSettings` now hits the
// `upsert_mess_settings` RPC exactly once per submit and that it no
// longer touches mess_settings directly. The previous shape was a
// 3-round-trip path (select prev / update / logAudit); this test pins
// the 1-RPC contract so a regression fails fast.
//
// We use createElement() rather than JSX to keep this file compatible
// with the in-tree test transformer (vite:esbuild), which has been
// observed to choke on certain JSX attribute names in this module.

const { mockRpc } = vi.hoisted(() => ({ mockRpc: vi.fn() }));

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: mockRpc },
}));

const baseValues: SettingsFormValues = settingsFormSchema.parse({
  mess_name: 'Officers Mess',
  currency_code: 'ZMW',
  opening_float: 1000,
  recovery_target_pct: 30,
  vat_pct: 0,
  holiday_mode: false,
});

const rpcRow: MessSettings = {
  ...baseValues,
  id: 1,
  updated_by: null,
  updated_at: '2026-07-31T12:00:00Z',
};

const queryClient = new QueryClient();
function Wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useUpdateMessSettings RPC contract', () => {
  it('calls upsert_mess_settings exactly once with the form values', async () => {
    mockRpc.mockResolvedValue({ data: rpcRow, error: null });

    const { result } = renderHook(() => useUpdateMessSettings(), { wrapper: Wrapper });

    await result.current.mutateAsync(baseValues);

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledTimes(1);
    });

    const [fnName, params] = mockRpc.mock.calls[0];
    expect(fnName).toBe('upsert_mess_settings');
    expect(params).toEqual({
      p_mess_name: 'Officers Mess',
      p_currency_code: 'ZMW',
      p_opening_float: 1000,
      p_recovery_target_pct: 30,
      p_vat_pct: 0,
      p_holiday_mode: false,
    });
  });

  it('returns the row returned by the RPC', async () => {
    mockRpc.mockReset();
    mockRpc.mockResolvedValue({ data: rpcRow, error: null });

    const { result } = renderHook(() => useUpdateMessSettings(), { wrapper: Wrapper });

    const returned = await result.current.mutateAsync(baseValues);

    expect(returned).toEqual(rpcRow);
  });

  it('propagates RPC errors as thrown rejections', async () => {
    mockRpc.mockReset();
    const rpcError = { message: '42501: forbidden' };
    mockRpc.mockResolvedValue({ data: null, error: rpcError });

    const { result } = renderHook(() => useUpdateMessSettings(), { wrapper: Wrapper });

    await expect(result.current.mutateAsync(baseValues)).rejects.toBe(rpcError);

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });

  it('uses the upsert_mess_settings RPC and no longer calls logAudit from the client', () => {
    // Static source check — guards against regressions to the
    // 3-round-trip path that left audit_log writes client-side.
    const source = require('node:fs').readFileSync(
      require('node:path').join(__dirname, 'settings.service.ts'),
      'utf8',
    );
    expect(source).toMatch(/supabase\.rpc\(\s*'upsert_mess_settings'/);
    expect(source).toMatch(/p_mess_name:\s*values\.mess_name/);
    expect(source).toMatch(/p_currency_code:\s*values\.currency_code/);
    expect(source).toMatch(/p_opening_float:\s*values\.opening_float/);
    expect(source).toMatch(/p_recovery_target_pct:\s*values\.recovery_target_pct/);
    expect(source).toMatch(/p_vat_pct:\s*values\.vat_pct/);
    expect(source).toMatch(/p_holiday_mode:\s*values\.holiday_mode/);
    expect(source).not.toMatch(/logAudit\(\{[^}]*action:\s*'settings\.update'/);
    expect(source).not.toMatch(/\.from\('mess_settings'\)\s*\.update\(/);
  });
});