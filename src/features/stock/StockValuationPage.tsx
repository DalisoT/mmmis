import { useState } from 'react';
import { format } from 'date-fns';
import { FileSpreadsheet, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ResponsiveTable } from '@/components/ui/responsive-table';
import { formatCurrency } from '@/lib/utils';
import {
  useStockValuation, exportValuationToExcel, defaultValuationFilename,
} from './valuation.service';

export function StockValuationPage() {
  const [asOfDate, setAsOfDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const { data: rows, isLoading } = useStockValuation(asOfDate);

  const totalValue = (rows ?? []).reduce((acc, r) => acc + r.value, 0);
  const totalUnits = (rows ?? []).reduce((acc, r) => acc + (r.stock_cf ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Stock Valuation</h1>
          <p className="text-sm text-muted-foreground">
            Current stock value at buying price, as of the selected date.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
            className="w-auto"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={!rows?.length}
            onClick={() => exportValuationToExcel(rows!, defaultValuationFilename(asOfDate))}
          >
            <FileSpreadsheet className="mr-1 h-4 w-4" /> Export Excel
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-sm font-medium">Total Stock Value</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{formatCurrency(totalValue)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-sm font-medium">Total Units in Stock</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{totalUnits}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-sm font-medium">Items Valued</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{(rows ?? []).filter((r) => r.stock_cf !== null).length}</p></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Valuation as of {asOfDate}</CardTitle>
          <CardDescription>
            Items with no recorded Stock CF yet show as —.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <>
              <ResponsiveTable
                rows={rows ?? []}
                rowKey={(r) => r.product_id}
                headers={['Product', 'Category', 'Unit', 'Stock CF', 'Buying Price', 'Stock Value']}
                headerClassNames={['', '', '', 'text-right', 'text-right', 'text-right']}
                cells={[
                  (r) => <span className="font-medium">{r.name}</span>,
                  (r) => <Badge variant="outline">{r.category}</Badge>,
                  (r) => r.unit,
                  (r) => (
                    <span className="font-mono tabular-nums">
                      {r.stock_cf ?? <span className="text-muted-foreground">—</span>}
                    </span>
                  ),
                  (r) => <span className="font-mono tabular-nums">{formatCurrency(r.buying_price)}</span>,
                  (r) => (
                    <span className="font-mono tabular-nums">
                      {r.stock_cf !== null ? formatCurrency(r.value) : '—'}
                    </span>
                  ),
                ]}
                cardTitle={(r) => r.name}
                cardSubtitle={(r) => `${r.category} · ${r.unit}`}
                cardFields={[
                  { label: 'Stock CF', value: (r: any) => (
                    <span className="font-mono tabular-nums">
                      {r.stock_cf ?? <span className="text-muted-foreground">—</span>}
                    </span>
                  ) },
                  { label: 'Buying price', value: (r: any) => <span className="font-mono tabular-nums">{formatCurrency(r.buying_price)}</span> },
                  { label: 'Stock value', value: (r: any) => (
                    <span className="font-mono tabular-nums font-semibold">
                      {r.stock_cf !== null ? formatCurrency(r.value) : '—'}
                    </span>
                  ), emphasis: true, fullWidth: true },
                ]}
              />
              <div className="mt-3 rounded-md border bg-muted/50 p-3 text-sm font-semibold sm:hidden">
                <div className="flex items-center justify-between">
                  <span>Totals</span>
                  <span className="text-right">
                    <span className="font-mono">{totalUnits}</span>
                    <span className="mx-2 text-muted-foreground">·</span>
                    <span className="font-mono">{formatCurrency(totalValue)}</span>
                  </span>
                </div>
              </div>
              {/* Desktop totals row mirror */}
              <div className="mt-3 hidden items-center justify-between rounded-md border bg-muted/50 p-3 text-sm font-semibold sm:flex">
                <span>Totals</span>
                <span className="text-right">
                  <span className="font-mono">{totalUnits} units</span>
                  <span className="mx-2 text-muted-foreground">·</span>
                  <span className="font-mono">{formatCurrency(totalValue)}</span>
                </span>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
