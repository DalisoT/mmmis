import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ResponsiveTable, type ResponsiveCardField } from '@/components/ui/responsive-table';
import { formatCurrency } from '@/lib/utils';
import { useMemberOwnPurchases, type MemberPurchase } from './member.service';

const PURCHASE_HEADERS = ['Date', 'Type', 'Items', 'Amount'];

function purchaseTitle(r: MemberPurchase) {
  return new Date(r.sold_at).toLocaleDateString();
}
function purchaseSubtitle(r: MemberPurchase) {
  return r.items.map((i) => `${i.quantity} × ${i.product?.name ?? 'item'}`).join(', ');
}
function purchaseBadge(r: MemberPurchase) {
  return (
    <Badge variant={r.sale_type === 'cash' ? 'success' : 'warning'}>{r.sale_type}</Badge>
  );
}

const PURCHASE_FIELDS: ResponsiveCardField<MemberPurchase>[] = [
  { label: 'Amount', emphasis: true, value: (r) => formatCurrency(Number(r.total_amount)) },
];

export function MemberPurchasesPage() {
  const [days, setDays] = useState(30);
  const purchases = useMemberOwnPurchases(days);
  const rows = (purchases.data ?? []) as MemberPurchase[];
  const total = rows.reduce((a, s) => a + Number(s.total_amount), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Purchases</h1>
        <p className="text-sm text-muted-foreground">
          All your mess purchases and items.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Range</CardTitle>
          <CardDescription>Show recent purchases over a selectable window.</CardDescription>
          <select
            className="h-10 w-full max-w-xs rounded-md border bg-background px-3 text-sm"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value={30}>Last 30 days</option>
            <option value={60}>Last 60 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </CardHeader>
        <CardContent>
          {purchases.isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <>
              <ResponsiveTable<MemberPurchase>
                rows={rows}
                rowKey={(r) => r.id}
                headers={PURCHASE_HEADERS}
                cells={[
                  (r) => new Date(r.sold_at).toLocaleString(),
                  (r) => (
                    <Badge variant={r.sale_type === 'cash' ? 'success' : 'warning'}>
                      {r.sale_type}
                    </Badge>
                  ),
                  (r) => (
                    <div className="text-sm">
                      {r.items.map((i) => `${i.quantity} × ${i.product?.name ?? 'item'}`).join(', ')}
                    </div>
                  ),
                  (r) => <span className="font-mono">{formatCurrency(Number(r.total_amount))}</span>,
                ]}
                headerClassNames={['', '', '', 'text-right']}
                cardFields={PURCHASE_FIELDS}
                cardTitle={purchaseTitle}
                cardSubtitle={purchaseSubtitle}
                cardBadge={purchaseBadge}
                empty="No purchases in this range."
              />
              <div className="mt-3 flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm sm:px-4">
                <span className="font-medium">Total</span>
                <span className="font-mono font-semibold">{formatCurrency(total)}</span>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
