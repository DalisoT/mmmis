import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface AuditSummaryDaily {
  day: string;        // ISO date (yyyy-mm-dd)
  events: number;
}

export interface AuditSummaryCount {
  /** For top_actions: the action label. For top_tables: the table name. */
  [key: string]: string | number;
  events: number;
}

export interface AuditSummaryActor {
  service_number: string;
  full_name: string;
  role_code: string | null;
  events: number;
}

export interface AuditSummary {
  from: string;
  to: string;
  total: number;
  daily: AuditSummaryDaily[];
  top_actions: AuditSummaryCount[];
  top_tables: AuditSummaryCount[];
  top_actors: AuditSummaryActor[];
  generated_at: string;
}

export const auditSummaryKeys = {
  all: ['audit-summary'] as const,
  range: (fromIso: string, toIso: string) => [...auditSummaryKeys.all, fromIso, toIso] as const,
};

async function fetchAuditSummary(fromIso: string, toIso: string): Promise<AuditSummary> {
  const { data, error } = await supabase.rpc('get_audit_summary', {
    p_from: fromIso,
    p_to: toIso,
  });
  if (error) throw error;
  // RPC returns jsonb; cast defensively.
  return data as unknown as AuditSummary;
}

export function useAuditSummary(fromIso: string, toIso: string) {
  return useQuery({
    queryKey: auditSummaryKeys.range(fromIso, toIso),
    queryFn: () => fetchAuditSummary(fromIso, toIso),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}
