import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Plus, Search, Tag, Pencil, PowerOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { ResponsiveTable } from '@/components/ui/responsive-table';
import { MoneyInput, NumberInput } from '@/components/ui/number-input';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { formatCurrency } from '@/lib/utils';
import { useConfirm } from '@/hooks/useConfirm';
import {
  useProducts, useCreateProduct, useUpdateProduct, useDeactivateProduct,
  productFormSchema, PRODUCT_CATEGORIES,
} from './products.service';
import type { ProductFormValues, ProductRow } from './products.service';

export function ProductsPage() {
  const { data: products, isLoading } = useProducts();
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const deactivateProduct = useDeactivateProduct();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [filter, setFilter] = useState('');

  const filtered = (products ?? []).filter((p) => {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    return [p.name, p.category, p.barcode ?? ''].some((s) => s.toLowerCase().includes(q));
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Products</h1>
          <p className="text-sm text-muted-foreground">
            Manage your mess bar catalog. Set buying and selling prices.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" /> New Product
            </Button>
          </DialogTrigger>
          <ProductDialog
            onSubmit={async (values) => { await createProduct.mutateAsync(values); setOpen(false); }}
            submitting={createProduct.isPending}
          />
        </Dialog>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 space-y-0 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle className="text-base">Catalog</CardTitle>
            <CardDescription>
              {(products ?? []).length} items ·{' '}
              {(products ?? []).filter((p) => p.status === 'active').length} active
            </CardDescription>
          </div>
          <div className="relative w-full md:max-w-xs">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search name / category / barcode" className="pl-8"
              value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading products…
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No products found.</p>
          ) : (
            <ResponsiveTable
              rows={filtered}
              rowKey={(p) => p.id}
              headers={['Name', 'Category', 'Buying', 'Selling', 'Margin', 'Unit', 'Opening', 'Min', 'Status', 'Actions']}
              headerClassNames={['', '', 'text-right', 'text-right', 'text-right', '', 'text-right', 'text-right', '', 'text-right']}
              cells={[
                (p) => <span className="font-medium">{p.name}</span>,
                (p) => <Badge variant="outline">{p.category}</Badge>,
                (p) => <span className="font-mono tabular-nums">{formatCurrency(p.buying_price)}</span>,
                (p) => <span className="font-mono tabular-nums">{formatCurrency(p.selling_price)}</span>,
                (p) => {
                  const margin = p.selling_price - p.buying_price;
                  return (
                    <span className={`font-mono tabular-nums ${margin >= 0 ? 'text-emerald-600' : 'text-destructive'}`}>
                      {formatCurrency(margin)}
                    </span>
                  );
                },
                (p) => p.unit,
                (p) => <span className="font-mono tabular-nums">{p.opening_stock}</span>,
                (p) => <span className="font-mono tabular-nums">{p.minimum_stock}</span>,
                (p) => p.status === 'active' ? <Badge variant="success">Active</Badge> : <Badge variant="secondary">Inactive</Badge>,
                (p) => (
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditing(p)}>
                      <Pencil className="mr-1 h-3 w-3" /> Edit
                    </Button>
                    {p.status === 'active' && (
                      <Button
                        size="sm" variant="destructive"
                        onClick={async () => {
                          const ok = await confirm({
                            title: `Deactivate ${p.name}?`,
                            description: 'The product will be hidden from the POS and any new sales, but historic records stay intact.',
                            confirmLabel: 'Deactivate',
                            destructive: true,
                          });
                          if (ok) {
                            void deactivateProduct.mutate(p.id);
                          }
                        }}
                      >
                        <PowerOff className="mr-1 h-3 w-3" /> Off
                      </Button>
                    )}
                  </div>
                ),
              ]}
              cardTitle={(p) => p.name}
              cardSubtitle={(p) => `${p.category} · ${p.unit}`}
              cardBadge={(p) => p.status === 'active' ? <Badge variant="success">Active</Badge> : <Badge variant="secondary">Inactive</Badge>}
              cardFields={[
                { label: 'Buying', value: (p: any) => <span className="font-mono tabular-nums">{formatCurrency(p.buying_price)}</span> },
                { label: 'Selling', value: (p: any) => <span className="font-mono tabular-nums">{formatCurrency(p.selling_price)}</span> },
                {
                  label: 'Margin',
                  value: (p: any) => {
                    const margin = p.selling_price - p.buying_price;
                    return (
                      <span className={`font-mono tabular-nums ${margin >= 0 ? 'text-emerald-600' : 'text-destructive'}`}>
                        {formatCurrency(margin)}
                      </span>
                    );
                  },
                  emphasis: true,
                },
                { label: 'Opening stock', value: (p: any) => <span className="font-mono tabular-nums">{p.opening_stock}</span> },
                { label: 'Min stock', value: (p: any) => <span className="font-mono tabular-nums">{p.minimum_stock}</span> },
                {
                  label: 'Actions',
                  value: (p: any) => (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => setEditing(p)}>
                        <Pencil className="mr-1 h-3 w-3" /> Edit
                      </Button>
                      {p.status === 'active' && (
                        <Button
                          size="sm" variant="destructive"
                          onClick={async () => {
                            const ok = await confirm({
                              title: `Deactivate ${p.name}?`,
                              description: 'The product will be hidden from the POS and any new sales, but historic records stay intact.',
                              confirmLabel: 'Deactivate',
                              destructive: true,
                            });
                            if (ok) {
                              void deactivateProduct.mutate(p.id);
                            }
                          }}
                        >
                          <PowerOff className="mr-1 h-3 w-3" /> Off
                        </Button>
                      )}
                    </div>
                  ),
                  fullWidth: true,
                },
              ]}
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && (
          <ProductDialog
            initial={editing}
            onSubmit={async (values) => {
              await updateProduct.mutateAsync({ id: editing.id, values });
              setEditing(null);
            }}
            submitting={updateProduct.isPending}
          />
        )}
      </Dialog>
    </div>
  );
}

interface ProductDialogProps {
  initial?: ProductRow;
  onSubmit: (values: ProductFormValues) => Promise<void> | void;
  submitting: boolean;
}

function ProductDialog({ initial, onSubmit, submitting }: ProductDialogProps) {
  const {
    register, handleSubmit, setValue, watch, reset,
    formState: { errors },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues: initial
      ? { ...initial, barcode: initial.barcode ?? '' }
      : { category: 'Beer', status: 'active', unit: 'bottle', buying_price: 0, selling_price: 0, opening_stock: 0, minimum_stock: 0 },
  });
  const category = watch('category');
  const status = watch('status');

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{initial ? `Edit ${initial.name}` : 'New Product'}</DialogTitle>
        <DialogDescription>
          Buying price is for cost / valuation. Selling price is what the barman charges.
        </DialogDescription>
      </DialogHeader>
      <form
        onSubmit={handleSubmit(async (values) => { await onSubmit(values); reset(); })}
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      >
        <Field label="Name" error={errors.name?.message} className="sm:col-span-2">
          <Input {...register('name')} placeholder="e.g. Castle Lager 375ml" />
        </Field>
        <Field label="Category" error={errors.category?.message}>
          <Select value={category} onValueChange={(v) => setValue('category', v as ProductFormValues['category'])}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {PRODUCT_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Unit" error={errors.unit?.message}>
          <Input {...register('unit')} placeholder="bottle / can / crate" />
        </Field>
        <Field label="Buying Price" error={errors.buying_price?.message}>
          <MoneyInput step="0.01" {...register('buying_price')} />
        </Field>
        <Field label="Selling Price" error={errors.selling_price?.message}>
          <MoneyInput step="0.01" {...register('selling_price')} />
        </Field>
        <Field label="Opening Stock" error={errors.opening_stock?.message}>
          <NumberInput {...register('opening_stock')} />
        </Field>
        <Field label="Minimum Stock" error={errors.minimum_stock?.message}>
          <NumberInput {...register('minimum_stock')} />
        </Field>
        <Field label="Barcode (optional)" error={errors.barcode?.message} className="sm:col-span-2">
          <Input {...register('barcode')} />
        </Field>
        <Field label="Status">
          <Select value={status} onValueChange={(v) => setValue('status', v as ProductFormValues['status'])}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <DialogFooter className="sm:col-span-2 mt-2">
          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <Tag className="mr-1 h-3 w-3" />
            {initial ? 'Save Changes' : 'Create Product'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function Field({
  label, error, children, className,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label className="text-xs">{label}</Label>
      <div className="mt-1">{children}</div>
      {error && <p className="mt-1 text-[11px] text-destructive">{error}</p>}
    </div>
  );
}