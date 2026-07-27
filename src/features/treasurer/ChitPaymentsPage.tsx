import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Loader2, Plus, Search, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ResponsiveTable } from '@/components/ui/responsive-table';
import { MoneyInput } from '@/components/ui/number-input';
import { formatCurrency } from '@/lib/utils';
import { chitPaymentSchema, useChitPayments, useCreateChitPayment, useMembers, type ChitPaymentValues } from './treasurer.service';

const methods: ChitPaymentValues['payment_method'][] = ['cash', 'payslip_deduction', 'manual_recovery'];

export function ChitPaymentsPage() {
  const [params] = useSearchParams();
  const initialMember = params.get('member') ?? '';
  const [memberId, setMemberId] = useState(initialMember);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState(false);
  const { data: payments, isLoading } = useChitPayments({ from: from || undefined, to: to || undefined, member_id: memberId || undefined });
  const { data: members } = useMembers();
  const createPayment = useCreateChitPayment();
  const [form, setForm] = useState<ChitPaymentValues>({ member_id: initialMember, amount: 0, payment_method: 'cash', paid_at: new Date().toISOString().slice(0, 16), reference: '', receipt_number: '', remarks: '' });

  const selected = useMemo(() => (payments ?? []).filter((p) => {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    return [p.member?.service_number ?? '', `${p.member?.first_name ?? ''} ${p.member?.last_name ?? ''}`, p.payment_method, p.receipt_number ?? '', p.reference ?? ''].some((s) => s.toLowerCase().includes(q));
  }), [payments, filter]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = chitPaymentSchema.safeParse({ ...form, amount: Number(form.amount) });
    if (!parsed.success) return;
    await createPayment.mutateAsync(parsed.data);
    setOpen(false);
    setForm((v) => ({ ...v, amount: 0, reference: '', receipt_number: '', remarks: '' }));
  };

  return <div className="space-y-6">
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div><h1 className="text-2xl font-bold tracking-tight">CHIT Payments</h1><p className="text-sm text-muted-foreground">Record and review CHIT recoveries.</p></div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild><Button><Plus className="mr-2 h-4 w-4" />Record payment</Button></DialogTrigger>
        <DialogContent><DialogHeader><DialogTitle>Record CHIT payment</DialogTitle><DialogDescription>Enter the recovery details. A ledger entry will be created automatically.</DialogDescription></DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2"><Label>Member</Label><select className="flex h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.member_id} onChange={(e) => setForm({ ...form, member_id: e.target.value })} required><option value="">Select member</option>{(members ?? []).map((m) => <option key={m.user_id} value={m.user_id}>{m.service_number} · {m.full_name} ({formatCurrency(m.chit_balance)})</option>)}</select></div>
            <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label>Amount</Label><MoneyInput min="0.01" step="0.01" value={form.amount || ''} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} required /></div><div className="space-y-2"><Label>Paid at</Label><Input type="datetime-local" value={form.paid_at} onChange={(e) => setForm({ ...form, paid_at: e.target.value })} required /></div></div>
            <div className="space-y-2"><Label>Payment method</Label><select className="flex h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value as ChitPaymentValues['payment_method'] })}>{methods.map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}</select></div>
            <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label>Receipt number</Label><Input value={form.receipt_number ?? ''} onChange={(e) => setForm({ ...form, receipt_number: e.target.value })} /></div><div className="space-y-2"><Label>Reference</Label><Input value={form.reference ?? ''} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></div></div>
            <div className="space-y-2"><Label>Remarks</Label><Input value={form.remarks ?? ''} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></div>
            <DialogFooter><Button type="submit" disabled={createPayment.isPending}>{createPayment.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save payment</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
    <Card><CardHeader><CardTitle className="text-base">Payment history</CardTitle><CardDescription>Filter recoveries by date, member, method, or reference.</CardDescription><div className="grid gap-2 sm:grid-cols-4"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /><select className="h-10 rounded-md border bg-background px-3 text-sm" value={memberId} onChange={(e) => setMemberId(e.target.value)}><option value="">All members</option>{(members ?? []).map((m) => <option key={m.user_id} value={m.user_id}>{m.service_number} · {m.full_name}</option>)}</select><div className="relative"><Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-8" placeholder="Search payments" value={filter} onChange={(e) => setFilter(e.target.value)} /></div></div></CardHeader><CardContent>{isLoading ? <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" /></div> : selected.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">No CHIT payments found.</p> : <ResponsiveTable rows={selected} rowKey={(p) => p.id} headers={['Date', 'Member', 'Method', 'Reference', 'Amount', 'Receiver', '']} headerClassNames={['', '', '', '', 'text-right', '', 'text-right']} cells={[(p) => new Date(p.paid_at).toLocaleString(), (p) => <div><div className="font-medium">{p.member?.first_name} {p.member?.last_name}</div><div className="text-xs text-muted-foreground">{p.member?.service_number}</div></div>, (p) => <Badge variant="outline">{p.payment_method.replace('_', ' ')}</Badge>, (p) => p.receipt_number || p.reference || '—', (p) => <span className="font-mono tabular-nums">{formatCurrency(Number(p.amount))}</span>, (p) => p.receiver?.full_name ?? '—', (p) => <Button asChild size="sm" variant="ghost"><Link to={`/members/${p.member_id}/statement`}><Wallet className="mr-1 h-3 w-3" />Statement</Link></Button>]} cardTitle={(p) => `${p.member?.first_name ?? ''} ${p.member?.last_name ?? ''}`.trim() || 'Payment'} cardSubtitle={(p) => `${p.member?.service_number ?? ''} · ${new Date(p.paid_at).toLocaleString()}`} cardBadge={(p) => <Badge variant="outline">{p.payment_method.replace('_', ' ')}</Badge>} cardFields={[{ label: 'Reference', value: (p: any) => p.receipt_number || p.reference || '—' }, { label: 'Amount', value: (p: any) => <span className="font-mono tabular-nums">{formatCurrency(Number(p.amount))}</span>, emphasis: true }, { label: 'Receiver', value: (p: any) => p.receiver?.full_name ?? '—' }, { label: 'Actions', value: (p: any) => <Button asChild size="sm" variant="outline"><Link to={`/members/${p.member_id}/statement`}><Wallet className="mr-1 h-3 w-3" />Statement</Link></Button>, fullWidth: true }]} />}</CardContent></Card>
  </div>;
}
