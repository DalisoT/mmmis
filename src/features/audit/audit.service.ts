import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface AuditLogRow {
  id: string;
  occurred_at: string;
  actor_id: string | null;
  actor_role: string | null;
  action: string;
  target_table: string | null;
  target_id: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  meta: Record<string, unknown> | null;
}

export const auditKeys = {
  all: ['audit'] as const,
  list: (limit: number) => [...auditKeys.all, 'list', limit] as const,
};

/**
 * Administrator-only audit log reader. RLS enforces the visibility.
 */
export function useAuditLog(limit = 200) {
  return useQuery({
    queryKey: auditKeys.list(limit),
    queryFn: async (): Promise<AuditLogRow[]> => {
      const { data, error } = await supabase
        .from('audit_log')
        .select('id, occurred_at, actor_id, actor_role, action, target_table, target_id, old_values, new_values, meta')
        .order('occurred_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as AuditLogRow[];
    },
    staleTime: 10_000,
  });
}