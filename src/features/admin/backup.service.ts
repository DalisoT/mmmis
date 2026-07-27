import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type BackupStatus = 'ok' | 'warn' | 'error' | 'empty';

export interface BackupHealthRow {
  table_name: string;
  row_count: number;
  last_write_at: string | null;
  status: BackupStatus;
  status_message: string;
}

export interface BackupHealth {
  rows: BackupHealthRow[];
  stale_hours: number;
  dead_hours: number;
  generated_at: string;
  counts: {
    ok: number;
    warn: number;
    error: number;
    empty: number;
  };
  overall: BackupStatus;
}

export const backupKeys = {
  all: ['backup-health'] as const,
  health: (staleHours: number, deadHours: number) =>
    [...backupKeys.all, 'health', staleHours, deadHours] as const,
};

async function fetchBackupHealth(
  staleHours: number,
  deadHours: number,
): Promise<BackupHealth> {
  const { data, error } = await supabase.rpc('get_backup_health', {
    p_stale_hours: staleHours,
    p_dead_hours: deadHours,
  });
  if (error) throw error;
  const raw = (data ?? []) as BackupHealthRow[];
  const counts = { ok: 0, warn: 0, error: 0, empty: 0 };
  for (const r of raw) counts[r.status] += 1;
  const overall: BackupStatus =
    counts.error > 0 ? 'error' : counts.empty > 0 ? 'empty' : counts.warn > 0 ? 'warn' : 'ok';
  return {
    rows: raw,
    stale_hours: staleHours,
    dead_hours: deadHours,
    generated_at: new Date().toISOString(),
    counts,
    overall,
  };
}

export function useBackupHealth(staleHours = 36, deadHours = 72) {
  return useQuery({
    queryKey: backupKeys.health(staleHours, deadHours),
    queryFn: () => fetchBackupHealth(staleHours, deadHours),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}
