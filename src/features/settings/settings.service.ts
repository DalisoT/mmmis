import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { createQueryKeys } from '@/lib/queryKeys';

export interface MessSettings {
  id: number;
  opening_float: number;
  recovery_target_pct: number;
  vat_pct: number;
  holiday_mode: boolean;
  mess_name: string;
  currency_code: string;
  updated_by: string | null;
  updated_at: string;
}

export const settingsFormSchema = z.object({
  opening_float: z.coerce.number().min(0, 'Must be ≥ 0'),
  recovery_target_pct: z.coerce.number().min(0).max(100),
  vat_pct: z.coerce.number().min(0).max(100),
  holiday_mode: z.boolean(),
  mess_name: z.string().min(1).max(120),
  currency_code: z.string().length(3),
});
export type SettingsFormValues = z.infer<typeof settingsFormSchema>;

export const settingsKeys = createQueryKeys('mess-settings', {
  all: null,
  current: 'current',
});

export function useMessSettings() {
  return useQuery({
    queryKey: settingsKeys.current,
    queryFn: async (): Promise<MessSettings> => {
      const { data, error } = await supabase
        .from('mess_settings')
        .select('id, opening_float, recovery_target_pct, vat_pct, holiday_mode, mess_name, currency_code, updated_by, updated_at')
        .eq('id', 1)
        .single();
      if (error) throw error;
      return data as MessSettings;
    },
    staleTime: 30_000,
  });
}

export function useUpdateMessSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: SettingsFormValues) => {
      // Atomic path (Phase 36): a single SECURITY DEFINER RPC that upserts
      // the singleton row, writes the audit_log row, and returns the new
      // state in the same transaction. Replaces the previous 3-round-trip
      // (select prev / update / logAudit) which could lose the audit row on
      // failure and which 406'd when the singleton row was missing.
      const { data, error } = await supabase.rpc('upsert_mess_settings', {
        p_mess_name: values.mess_name,
        p_currency_code: values.currency_code,
        p_opening_float: values.opening_float,
        p_recovery_target_pct: values.recovery_target_pct,
        p_vat_pct: values.vat_pct,
        p_holiday_mode: values.holiday_mode,
      });
      if (error) throw error;
      return data as MessSettings;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: settingsKeys.all });
    },
  });
}