import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type LowStockStatus = 'ok' | 'low' | 'critical' | 'out' | 'no_min';

export interface LowStockRow {
  product_id: string;
  name: string;
  category: string;
  unit: string;
  minimum_stock: number;
  on_hand: number;
  last_sheet_date: string | null;
  last_recorded_by: string | null;
  status: LowStockStatus;
  status_message: string;
}

export const lowStockKeys = {
  all: ['low-stock'] as const,
  list: (onlyActive: boolean) => [...lowStockKeys.all, onlyActive] as const,
};

async function fetchLowStock(onlyActive: boolean): Promise<LowStockRow[]> {
  const { data, error } = await supabase.rpc('get_low_stock', {
    p_only_active: onlyActive,
    p_limit: 500,
  });
  if (error) throw error;
  return (data ?? []) as LowStockRow[];
}

export function useLowStock(onlyActive = true) {
  return useQuery({
    queryKey: lowStockKeys.list(onlyActive),
    queryFn: () => fetchLowStock(onlyActive),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}
