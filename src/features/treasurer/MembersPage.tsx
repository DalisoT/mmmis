import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Edit2, Loader2, Search, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ResponsiveTable } from '@/components/ui/responsive-table';
import { MoneyInput } from '@/components/ui/number-input';
import { formatCurrency } from '@/lib/utils';
import { memberUpdateSchema, useMembers, useUpdateMember, type MemberRow, type MemberUpdateValues } from './treasurer.service';

export function MembersPage() {
  const { data: members, isLoading } = useMembers();
  const update = useUpdateMember();
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<MemberRow | null>(null);
  const [form, setForm] = useState<MemberUpdateValues>({});

  const filtered = useMemo(
    () =>
      (members ?? []).filter((m) => {
        const q = filter.trim().toLowerCase();
        if (!q) return true;
        return [m.service_number, m.full_name, m.rank ?? '', m.unit ?? ''].some((s) =>
          s.toLowerCase().includes(q)
        );
      }),
    [members, filter]
  );

  const openEdit = (m: MemberRow) => {
    setEditing(m);
    setForm({
      first_name: m.first_name,
      last_name: m.last_name,
      rank: m.rank ?? '',
      unit: m.unit ?? '',
      credit_limit: m.credit_limit,
      is_blacklisted: m.is_blacklisted,
    });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const parsed = memberUpdateSchema.safeParse(form);
    if (!parsed.success) return;
    await update.mutateAsync({ id: editing.user_id, values: parsed.data });
    setEditing(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Members</h1>
        <p className="text-sm text-muted-foreground">
          Manage member CHIT limits and account status.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Member register</CardTitle>
          <CardDescription>
            Accounts are never deleted; blacklist is used to restrict CHIT eligibility.
          </CardDescription>
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search service no / name / unit"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <ResponsiveTable
              rows={filtered}
              rowKey={(m) => m.user_id}
              headers={['Service No', 'Name', 'Rank / Unit', 'Limit', 'Balance', 'Status', 'Actions']}
              headerClassNames={['', '', '', 'text-right', 'text-right', '', 'text-right']}
              cells={[
                (m) => <span className="font-mono">{m.service_number}</span>,
                (m) => <span className="font-medium">{m.full_name}</span>,
                (m) => (
                  <div>
                    <div>{m.rank ?? '—'}</div>
                    <div className="text-xs text-muted-foreground">{m.unit ?? '—'}</div>
                  </div>
                ),
                (m) => <span className="font-mono tabular-nums">{formatCurrency(m.credit_limit)}</span>,
                (m) => <span className="font-mono tabular-nums">{formatCurrency(m.chit_balance)}</span>,
                (m) =>
                  m.is_blacklisted ? (
                    <Badge variant="destructive">Blacklisted</Badge>
                  ) : (
                    <Badge variant="success">Active</Badge>
                  ),
                (m) => (
                  <div className="flex justify-end gap-2">
                    <Button asChild size="sm" variant="ghost">
                      <Link to={`/members/${m.user_id}/statement`}>
                        <UserRound className="mr-1 h-3 w-3" />Profile
                      </Link>
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openEdit(m)}>
                      <Edit2 className="mr-1 h-3 w-3" />Edit
                    </Button>
                  </div>
                ),
              ]}
              cardTitle={(m) => m.full_name}
              cardSubtitle={(m) => `${m.service_number} · ${m.rank ?? '—'}`}
              cardBadge={(m) =>
                m.is_blacklisted ? (
                  <Badge variant="destructive">Blacklisted</Badge>
                ) : (
                  <Badge variant="success">Active</Badge>
                )
              }
              cardFields={[
                { label: 'Credit limit', value: (m: any) => <span className="font-mono tabular-nums">{formatCurrency(m.credit_limit)}</span> },
                { label: 'CHIT balance', value: (m: any) => <span className="font-mono tabular-nums">{formatCurrency(m.chit_balance)}</span>, emphasis: true },
                {
                  label: 'Actions',
                  value: (m: any) => (
                    <div className="flex flex-wrap gap-2">
                      <Button asChild size="sm" variant="outline">
                        <Link to={`/members/${m.user_id}/statement`}>
                          <UserRound className="mr-1 h-3 w-3" />Profile
                        </Link>
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => openEdit(m)}>
                        <Edit2 className="mr-1 h-3 w-3" />Edit
                      </Button>
                    </div>
                  ),
                  fullWidth: true,
                },
              ]}
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit member</DialogTitle>
            <DialogDescription>
              {editing?.service_number} · {editing?.full_name}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>First name</Label>
                <Input value={form.first_name ?? ''} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Last name</Label>
                <Input value={form.last_name ?? ''} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Rank</Label>
                <Input value={form.rank ?? ''} onChange={(e) => setForm({ ...form, rank: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Unit</Label>
                <Input value={form.unit ?? ''} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Credit limit</Label>
              <MoneyInput
                min="0"
                step="0.01"
                value={form.credit_limit ?? ''}
                onChange={(e) => setForm({ ...form, credit_limit: Number(e.target.value) })}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!form.is_blacklisted}
                onChange={(e) => setForm({ ...form, is_blacklisted: e.target.checked })}
              />
              Blacklist member
            </label>
            <DialogFooter>
              <Button type="submit" disabled={update.isPending}>
                {update.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}