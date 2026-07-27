import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Plus, PackagePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { useProducts } from '@/features/products/products.service';
import { useStockReceipts, useCreateReceipt, receiptFormSchema } from './receipts.service';
import type { ReceiptFormValues } from './receipts.service';

export function ReceiptsPage() {
  const { data: receipts, isLoading } = useStockReceipts();
  const createReceipt = useCreateReceipt();
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Stock Receipts</h1>
          <p className="text-sm text-muted-foreground">
            Record deliveries received from suppliers (Stock RCV).
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" /> New Receipt
            </Button>
          </DialogTrigger>
          <NewReceiptDialog
            onSubmit={async (values) => {
              await createReceipt.mutateAsync(values);
              setOpen(false);
            }}
            submitting={createReceipt.isPending}
          />
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Receipts</CardTitle>
          <CardDescription>Last 200 deliveries recorded.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading receipts…
            </div>
          ) : (receipts ?? []).length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No receipts recorded yet.
            </p>
          ) : (
            <ResponsiveTable
              rows={receipts ?? []}
              rowKey={(r) => r.id}
              headers={['Date', 'Product', 'Quantity', 'Supplier', 'Invoice', 'Unit Cost']}
              headerClassNames={['', '', 'text-right', '', '', 'text-right']}
              cells={[
                (r) => <span className="text-sm text-muted-foreground">{formatDateTime(r.received_at)}</span>,
                (r) => (
                  <div>
                    <div className="font-medium">{r.product?.name ?? '—'}</div>
                    <div className="text-xs text-muted-foreground">{r.product?.category}</div>
                  </div>
                ),
                (r) => <span className="font-mono tabular-nums">{r.quantity}</span>,
                (r) => r.supplier ?? '—',
                (r) => <span className="font-mono text-xs">{r.invoice_number ?? '—'}</span>,
                (r) => (
                  <span className="font-mono tabular-nums">
                    {r.unit_cost != null ? formatCurrency(r.unit_cost) : '—'}
                  </span>
                ),
              ]}
              cardTitle={(r) => r.product?.name ?? 'Receipt'}
              cardSubtitle={(r) => `${formatDateTime(r.received_at)}${r.supplier ? ' · ' + r.supplier : ''}`}
              cardBadge={(r) => (
                <span className="font-mono tabular-nums text-sm font-semibold">
                  {r.unit_cost != null ? formatCurrency(Number(r.unit_cost) * Number(r.quantity)) : '—'}
                </span>
              )}
              cardFields={[
                { label: 'Quantity', value: (r: any) => <span className="font-mono tabular-nums">{r.quantity}</span> },
                { label: 'Unit cost', value: (r: any) => (
                  <span className="font-mono tabular-nums">
                    {r.unit_cost != null ? formatCurrency(r.unit_cost) : '—'}
                  </span>
                ) },
                { label: 'Invoice #', value: (r: any) => <span className="font-mono text-xs">{r.invoice_number ?? '—'}</span>, fullWidth: true },
              ]}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function NewReceiptDialog({
  onSubmit, submitting,
}: { onSubmit: (v: ReceiptFormValues) => Promise<void> | void; submitting: boolean }) {
  const { data: products } = useProducts();
  const {
    register, handleSubmit, setValue, watch, reset,
    formState: { errors },
  } = useForm<ReceiptFormValues>({
    resolver: zodResolver(receiptFormSchema),
    defaultValues: { quantity: 1, unit_cost: 0 },
  });
  const productId = watch('product_id');

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>New Stock Receipt</DialogTitle>
        <DialogDescription>Record incoming stock from a supplier.</DialogDescription>
      </DialogHeader>
      <form
        onSubmit={handleSubmit(async (values) => { await onSubmit(values); reset(); })}
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      >
        <div className="sm:col-span-2">
          <Label className="text-xs">Product</Label>
          <div className="mt-1">
            <Select value={productId} onValueChange={(v) => setValue('product_id', v)}>
              <SelectTrigger><SelectValue placeholder="Choose a product" /></SelectTrigger>
              <SelectContent>
                {(products ?? []).filter((p) => p.status === 'active').map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name} <span className="text-xs text-muted-foreground">({p.category})</span></SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {errors.product_id && (
            <p className="mt-1 text-[11px] text-destructive">{errors.product_id.message}</p>
          )}
        </div>

        <Field label="Quantity" error={errors.quantity?.message}>
          <NumberInput min={1} {...register('quantity')} />
        </Field>
        <Field label="Unit Cost" error={errors.unit_cost?.message}>
          <MoneyInput step="0.01" {...register('unit_cost')} />
        </Field>
        <Field label="Supplier" error={errors.supplier?.message}>
          <Input {...register('supplier')} placeholder="Optional" />
        </Field>
        <Field label="Invoice #" error={errors.invoice_number?.message}>
          <Input {...register('invoice_number')} placeholder="Optional" />
        </Field>
        <Field label="Remarks" error={errors.remarks?.message} className="sm:col-span-2">
          <Input {...register('remarks')} />
        </Field>

        <DialogFooter className="sm:col-span-2 mt-2">
          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <PackagePlus className="mr-1 h-4 w-4" /> Record Receipt
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
