import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { auditUserChange } from '@/features/audit/audit';

export const PRODUCT_CATEGORIES = ['Beer', 'Soft Drinks', 'Water', 'Food', 'Other'] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export const productFormSchema = z.object({
  name: z.string().min(2, 'Name required'),
  category: z.enum(PRODUCT_CATEGORIES),
  buying_price: z.coerce.number().min(0, 'Must be 0 or more'),
  selling_price: z.coerce.number().min(0, 'Must be 0 or more'),
  unit: z.string().min(1, 'Unit required'),
  opening_stock: z.coerce.number().int().min(0),
  minimum_stock: z.coerce.number().int().min(0),
  barcode: z.string().optional(),
  status: z.enum(['active', 'inactive']),
});
export type ProductFormValues = z.infer<typeof productFormSchema>;

export interface ProductRow {
  id: string;
  name: string;
  category: ProductCategory;
  buying_price: number;
  selling_price: number;
  unit: string;
  opening_stock: number;
  minimum_stock: number;
  barcode: string | null;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
}

export const productKeys = {
  all: ['products'] as const,
  list: () => [...productKeys.all, 'list'] as const,
};

export function useProducts() {
  return useQuery({
    queryKey: productKeys.list(),
    queryFn: async (): Promise<ProductRow[]> => {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .is('deleted_at', null)
        .order('category', { ascending: true })
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as ProductRow[];
    },
  });
}

export function useCreateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: ProductFormValues) => {
      const { data, error } = await supabase
        .from('products')
        .insert(values)
        .select('id')
        .single();
      if (error) throw error;
      await auditUserChange('product.create' as never, data.id, undefined, values as never);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: productKeys.list() }),
  });
}

export function useUpdateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id: string; values: ProductFormValues }) => {
      const { data, error } = await supabase
        .from('products')
        .update(values)
        .eq('id', id)
        .select('id')
        .single();
      if (error) throw error;
      await auditUserChange('product.update' as never, id, undefined, values as never);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: productKeys.list() }),
  });
}

export function useDeactivateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from('products')
        .update({ status: 'inactive', deleted_at: new Date().toISOString() })
        .eq('id', id)
        .select('id')
        .single();
      if (error) throw error;
      await auditUserChange('product.deactivate' as never, id);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: productKeys.list() }),
  });
}
