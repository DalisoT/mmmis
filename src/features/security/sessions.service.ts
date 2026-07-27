import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface ActiveSession {
  session_id: string;
  user_id: string;
  service_number: string | null;
  full_name: string | null;
  role_code: string | null;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  is_revoked: boolean;
  user_agent: string | null;
}

export const sessionsKeys = {
  all: ['sessions'] as const,
  active: () => [...sessionsKeys.all, 'active'] as const,
};

export function useActiveSessions() {
  return useQuery({
    queryKey: sessionsKeys.active(),
    queryFn: async (): Promise<ActiveSession[]> => {
      const { data, error } = await supabase.rpc('list_active_sessions');
      if (error) throw error;
      return (data ?? []) as ActiveSession[];
    },
    staleTime: 5_000,
  });
}

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sessionId: string) => {
      const { error } = await supabase.rpc('revoke_session', { p_session_id: sessionId });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: sessionsKeys.all });
    },
  });
}