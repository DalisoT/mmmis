import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ResponsiveTable, type ResponsiveCardField } from '@/components/ui/responsive-table';
import { formatCurrency } from '@/lib/utils';
import { useMemberOwnPayments, type MemberPayment } from './member.service';

const PAYMENT_HEADERS = ['Date', 'Method', 'Reference', 'Received by', 'Amount'];

function paymentTitle(r: MemberPayment) {
  return new Date(r.paid_at).toLocaleDateString();
}
function paymentSubtitle(r: MemberPayment) {
  return r.receipt_number || r.reference || '—';
}
function paymentBadge(r: MemberPayment) {
  return (
    <Badge variant="outline" className="capitalize">
      {r.payment_method.replace('_', ' ')}
    </Badge>
  );
}
const PAYMENT_FIELDS: ResponsiveCardField<MemberPayment>[] = [
  {
    label: 'Received by',
    fullWidth: true,
    value: (r) => r.receiver?.full_name ?? '—',
  },
  {
    label: 'Amount',
    emphasis: true,
    value: (r) => formatCurrency(Number(r.amount)),
  },
];

export function MemberPaymentsPage() {
  const payments = useMemberOwnPayments();
  const rows = (payments.data ?? []) as MemberPayment[];
  const total = rows.reduce((a, p) => a + Number(p.amount), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Payments</h1>
        <p className="text-sm text-muted-foreground">All CHIT payments you have made.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payment history</CardTitle>
          <CardDescription>
            Recorded cash, payslip, and manual recovery payments.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {payments.isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <>
              <ResponsiveTable<MemberPayment>
                rows={rows}
                rowKey={(r) => r.id}
                headers={PAYMENT_HEADERS}
                cells={[
                  (r) => new Date(r.paid_at).toLocaleString(),
                  (r) => (
                    <Badge variant="outline" className="capitalize">
                      {r.payment_method.replace('_', ' ')}
                    </Badge>
                  ),
                  (r) => r.receipt_number || r.reference || '—',
                  (r) => r.receiver?.full_name ?? '—',
                  (r) => (
                    <span className="font-mono">{formatCurrency(Number(r.amount))}</span>
                  ),
                ]}
                headerClassNames={['', '', '', '', 'text-right']}
                cardFields={PAYMENT_FIELDS}
                cardTitle={paymentTitle}
                cardSubtitle={paymentSubtitle}
                cardBadge={paymentBadge}
                empty="No payments recorded yet."
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
