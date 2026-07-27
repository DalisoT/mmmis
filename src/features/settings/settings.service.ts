import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { logAudit } from '@/features/audit/audit';

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

export const settingsKeys = {
  all: ['mess-settings'] as const,
  current: () => [...settingsKeys.all, 'current'] as const,
};

export function useMessSettings() {
  return useQuery({
    queryKey: settingsKeys.current(),
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
      const { data: prev } = await supabase
        .from('mess_settings')
        .select('opening_float, recovery_target_pct, vat_pct, holiday_mode, mess_name, currency_code')
        .eq('id', 1)
        .single();
      const { data, error } = await supabase
        .from('mess_settings')
        .update({
          opening_float: values.opening_float,
          recovery_target_pct: values.recovery_target_pct,
          vat_pct: values.vat_pct,
          holiday_mode: values.holiday_mode,
          mess_name: values.mess_name,
          currency_code: values.currency_code,
        })
        .eq('id', 1)
        .select()
        .single();
      if (error) throw error;
      await logAudit({
        action: 'settings.update',
        target_table: 'mess_settings',
        target_id: '1',
        old_values: prev ?? undefined,
        new_values: values,
      });
      // Phase 8: the RPC path replaces the direct insert; nothing else to do.
      return data as MessSettings;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: settingsKeys.all });
    },
  });
}