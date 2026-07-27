import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface MemberDirectoryRow {
  user_id: string;
  service_number: string;
  full_name: string;
  first_name: string;
  last_name: string;
  email: string | null;
  rank: string | null;
  unit: string | null;
  is_active: boolean;
  chit_balance: number;
  credit_limit: number;
  last_login_at: string | null;
  ledger_count: number;
}

export const membersDirectoryKeys = {
  all: ['members-directory'] as const,
  search: (q: string, onlyActive: boolean) =>
    [...membersDirectoryKeys.all, q, onlyActive] as const,
};

async function searchMembers(q: string, onlyActive: boolean): Promise<MemberDirectoryRow[]> {
  const { data, error } = await supabase.rpc('search_members', {
    p_query: q.trim() || null,
    p_limit: 500,
    p_only_active: onlyActive,
  });
  if (error) throw error;
  return (data ?? []) as MemberDirectoryRow[];
}

export function useMemberDirectory(q: string, onlyActive = true) {
  return useQuery({
    queryKey: membersDirectoryKeys.search(q, onlyActive),
    queryFn: () => searchMembers(q, onlyActive),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}
