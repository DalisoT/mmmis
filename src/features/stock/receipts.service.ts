import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthContext';
import { auditUserChange } from '@/features/audit/audit';

export const receiptFormSchema = z.object({
  product_id: z.string().uuid('Select a product'),
  quantity: z.coerce.number().int().positive('Must be > 0'),
  supplier: z.string().optional(),
  invoice_number: z.string().optional(),
  unit_cost: z.coerce.number().min(0).optional(),
  remarks: z.string().optional(),
});
export type ReceiptFormValues = z.infer<typeof receiptFormSchema>;

export interface StockReceiptRow {
  id: string;
  product_id: string;
  received_by: string;
  quantity: number;
  supplier: string | null;
  invoice_number: string | null;
  unit_cost: number | null;
  received_at: string;
  remarks: string | null;
  product: { id: string; name: string; category: string; unit: string } | null;
}

export const receiptKeys = {
  all: ['stock-receipts'] as const,
  list: () => [...receiptKeys.all, 'list'] as const,
};

export function useStockReceipts() {
  return useQuery({
    queryKey: receiptKeys.list(),
    queryFn: async (): Promise<StockReceiptRow[]> => {
      const { data, error } = await supabase
        .from('stock_receipts')
        .select(`
          id, product_id, received_by, quantity, supplier, invoice_number,
          unit_cost, received_at, remarks,
          product:products ( id, name, category, unit )
        `)
        .is('deleted_at', null)
        .order('received_at', { ascending: false })
        .limit(200);
      if (error) throw error;

      return (data ?? []).map((row) => {
        const p = row.product as unknown as StockReceiptRow['product'];
        return { ...row, product: Array.isArray(p) ? p[0] ?? null : p } as StockReceiptRow;
      });
    },
  });
}

export function useCreateReceipt() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (values: ReceiptFormValues) => {
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('stock_receipts')
        .insert({
          ...values,
          received_by: user.id,
        })
        .select('id')
        .single();
      if (error) throw error;
      await auditUserChange('stock.receipt.create' as never, data.id, undefined, values as never);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: receiptKeys.list() }),
  });
}
