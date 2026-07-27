import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Loader2, Save, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { NumberInput } from '@/components/ui/number-input';
import { useAuth } from '@/features/auth/AuthContext';
import { formatCurrency } from '@/lib/utils';
import { useProducts } from '@/features/products/products.service';
import {
  useStockSheet, useUpsertStockSheet, fetchPreviousDayClosing,
  type StockSheetRowInput,
} from './stockSheet.service';

// Lazy-loaded so the ~1.9 MB @react-pdf/renderer bundle is only fetched
// when a barman/treasurer actually visits this page.
const PdfDownloadButton = lazy(() =>
  import('./StockSheetPDFDownload').then((m) => ({ default: m.PdfDownloadButton }))
);

function todayISO(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

export function StockSheetPage() {
  const { user } = useAuth();
  const [date, setDate] = useState<string>(todayISO());
  const { data: products } = useProducts();
  const { data: sheet, isLoading: sheetLoading } = useStockSheet(date);
  const upsert = useUpsertStockSheet();

  // Local edit state. Keyed by product_id.
  const [rows, setRows] = useState<Record<string, StockSheetRowInput>>({});
  const [pulled, setPulled] = useState(false);

  // When products or date change, seed rows once.
  useEffect(() => {
    if (!products) return;
    setRows((prev) => {
      const next: Record<string, StockSheetRowInput> = {};
      for (const p of products.filter((p) => p.status === 'active')) {
        const existing = sheet?.find((s) => s.product_id === p.id);
        if (existing) {
          next[p.id] = {
            product_id: p.id,
            stock_bf: existing.stock_bf,
            stock_rcv: existing.stock_rcv,
            allergy: existing.allergy,
            sold: existing.sold,
            stock_cf: existing.stock_cf,
            price: existing.price,
          };
        } else if (prev[p.id]) {
          next[p.id] = prev[p.id];
        } else {
          next[p.id] = {
            product_id: p.id,
            stock_bf: 0,
            stock_rcv: 0,
            allergy: 0,
            sold: 0,
            stock_cf: 0,
            price: p.selling_price,
          };
        }
      }
      return next;
    });
  }, [products, sheet]);

  const pullFromPrevious = async () => {
    if (!products) return;
    const ids = products.filter((p) => p.status === 'active').map((p) => p.id);
    const prev = await fetchPreviousDayClosing(date, ids);
    setRows((cur) => {
      const next = { ...cur };
      for (const p of products.filter((p) => p.status === 'active')) {
        if (next[p.id] && (next[p.id].stock_bf === 0)) {
          next[p.id] = { ...next[p.id], stock_bf: prev[p.id] ?? p.opening_stock };
        }
      }
      return next;
    });
    setPulled(true);
  };

  const handleSave = async () => {
    const productIds = (products ?? []).filter((p) => p.status === 'active').map((p) => p.id);
    const out: StockSheetRowInput[] = productIds.map((id) => ({
      ...rows[id],
      product_id: id,
    }));
    await upsert.mutateAsync({ sheet_date: date, rows: out });
  };

  // Derive totals for live display.
  const derivedRows = useMemo(() => {
    const productIds = (products ?? []).filter((p) => p.status === 'active').map((p) => p.id);
    return productIds.map((id) => {
      const r = rows[id];
      const product = products!.find((p) => p.id === id);
      const total_stock = (r?.stock_bf ?? 0) + (r?.stock_rcv ?? 0);
      const total = (r?.sold ?? 0) * Number(r?.price ?? 0);
      return {
        product_id: id,
        product,
        stock_bf: r?.stock_bf ?? 0,
        stock_rcv: r?.stock_rcv ?? 0,
        total_stock,
        allergy: r?.allergy ?? 0,
        sold: r?.sold ?? 0,
        stock_cf: r?.stock_cf ?? 0,
        price: Number(r?.price ?? 0),
        total,
      };
    });
  }, [products, rows]);

  const grandTotal = derivedRows.reduce((acc, r) => acc + r.total, 0);
  const grandSold = derivedRows.reduce((acc, r) => acc + r.sold, 0);

  // For the PDF, use the persisted rows if available (so `stock_cf` reflected), else local.
  const pdfRows = (sheet && sheet.length > 0) ? sheet : derivedRows.map((r) => ({
    id: r.product_id,
    sheet_date: date,
    product_id: r.product_id,
    stock_bf: r.stock_bf,
    stock_rcv: r.stock_rcv,
    total_stock: r.total_stock,
    allergy: r.allergy,
    sold: r.sold,
    stock_cf: r.stock_cf,
    price: r.price,
    total: r.total,
    product: r.product ? {
      id: r.product.id, name: r.product.name,
      category: r.product.category, unit: r.product.unit, buying_price: r.product.buying_price ?? 0,
    } : null,
  }));

  const onCell = (id: string, key: keyof StockSheetRowInput, val: number) => {
    setRows((cur) => ({ ...cur, [id]: { ...cur[id], [key]: val } }));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Daily Stock Sheet</h1>
          <p className="text-sm text-muted-foreground">
            Field names match the original paper form exactly.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-auto"
          />
          <Button variant="outline" size="sm" onClick={pullFromPrevious}>
            <RefreshCw className="mr-1 h-4 w-4" /> Pull BF from yesterday
          </Button>
          <Button size="sm" onClick={handleSave} disabled={upsert.isPending}>
            {upsert.isPending
              ? <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              : <Save className="mr-1 h-4 w-4" />}
            Save sheet
          </Button>
          <Suspense fallback={<Button size="sm" variant="secondary" disabled><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Loading…</Button>}>
            <PdfDownloadButton date={date} rows={pdfRows as any} recordedBy={user?.full_name ?? '—'} />
          </Suspense>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sheet for {date}</CardTitle>
          <CardDescription>
            {pulled ? 'Stock BF prefilled from previous day.' : 'Stock BF defaults to 0; click "Pull BF from yesterday" to autofill.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sheetLoading ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : derivedRows.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No products yet. Add some under <Badge variant="outline">Products</Badge> first.
            </p>
          ) : (
            <>
              {/* Phone: stacked editable cards (one per product). */}
              <div className="space-y-3 md:hidden">
                {derivedRows.map((r) => (
                  <div key={r.product_id} className="rounded-lg border bg-card p-3 shadow-sm">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{r.product?.name}</div>
                        <div className="truncate text-xs text-muted-foreground">{r.product?.category}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Total</div>
                        <div className="font-mono font-semibold">{formatCurrency(r.total)}</div>
                      </div>
                    </div>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                      <NumField label="Stock BF"  value={r.stock_bf}  onChange={(v) => onCell(r.product_id, 'stock_bf', v)} />
                      <NumField label="Stock RCV" value={r.stock_rcv} onChange={(v) => onCell(r.product_id, 'stock_rcv', v)} />
                      <div>
                        <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Total Stock</dt>
                        <dd className="font-mono"><Badge variant="outline">{r.total_stock}</Badge></dd>
                      </div>
                      <NumField label="Allergy"   value={r.allergy}   onChange={(v) => onCell(r.product_id, 'allergy', v)} />
                      <NumField label="Sold"      value={r.sold}      onChange={(v) => onCell(r.product_id, 'sold', v)} />
                      <NumField label="Stock CF"  value={r.stock_cf}  onChange={(v) => onCell(r.product_id, 'stock_cf', v)} />
                      <NumField label="Price"     value={r.price}     onChange={(v) => onCell(r.product_id, 'price', v)} step="0.01" className="col-span-2" />
                    </dl>
                  </div>
                ))}
                <div className="rounded-lg border bg-muted/50 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">Totals</span>
                    <span className="text-right">
                      <span className="font-mono">{grandSold}</span>
                      <span className="mx-2 text-muted-foreground">·</span>
                      <span className="font-mono font-semibold">{formatCurrency(grandTotal)}</span>
                    </span>
                  </div>
                </div>
              </div>

              {/* Tablet+ desktop: original editable grid. */}
              <div className="hidden md:block">
                <div className="overflow-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-[160px]">Product</TableHead>
                        <TableHead className="text-right">Stock BF</TableHead>
                        <TableHead className="text-right">Stock RCV</TableHead>
                        <TableHead className="text-right">Total Stock</TableHead>
                        <TableHead className="text-right">Allergy</TableHead>
                        <TableHead className="text-right">Sold</TableHead>
                        <TableHead className="text-right">Stock CF</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {derivedRows.map((r) => (
                        <TableRow key={r.product_id}>
                          <TableCell>
                            <div className="font-medium">{r.product?.name}</div>
                            <div className="text-xs text-muted-foreground">{r.product?.category}</div>
                          </TableCell>
                          <TableCell className="text-right">
                            <NumberCell value={r.stock_bf} onChange={(v) => onCell(r.product_id, 'stock_bf', v)} />
                          </TableCell>
                          <TableCell className="text-right">
                            <NumberCell value={r.stock_rcv} onChange={(v) => onCell(r.product_id, 'stock_rcv', v)} />
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            <Badge variant="outline">{r.total_stock}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <NumberCell value={r.allergy} onChange={(v) => onCell(r.product_id, 'allergy', v)} />
                          </TableCell>
                          <TableCell className="text-right">
                            <NumberCell value={r.sold} onChange={(v) => onCell(r.product_id, 'sold', v)} />
                          </TableCell>
                          <TableCell className="text-right">
                            <NumberCell value={r.stock_cf} onChange={(v) => onCell(r.product_id, 'stock_cf', v)} />
                          </TableCell>
                          <TableCell className="text-right">
                            <NumberCell value={r.price} step="0.01" onChange={(v) => onCell(r.product_id, 'price', v)} />
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(r.total)}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-muted/50 font-semibold">
                        <TableCell colSpan={5}>Totals</TableCell>
                        <TableCell className="text-right font-mono">{grandSold}</TableCell>
                        <TableCell />
                        <TableCell />
                        <TableCell className="text-right font-mono">{formatCurrency(grandTotal)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function NumberCell({
  value, onChange, step = '1',
}: { value: number; onChange: (v: number) => void; step?: string }) {
  return (
    <NumberInput
      step={step}
      min={0}
      className="ml-auto h-8 w-20 text-right"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

/** Number input used inside phone-card layout. */
function NumField({
  label, value, onChange, step = '1', className,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd>
        <NumberInput
          step={step}
          min={0}
          className="h-9 w-full"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </dd>
    </div>
  );
}
