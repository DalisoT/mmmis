import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Loader2, ShoppingCart, X, Plus, Minus, DollarSign, Receipt, ShieldCheck,
  User as UserIcon, Trash2, FileSignature,
} from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchInput, MoneyInput } from '@/components/ui/number-input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useProducts } from '@/features/products/products.service';
import { formatCurrency } from '@/lib/utils';
import {
  useMemberSearch, useCreateSale, useCreateExpense, verifyMemberPassword,
  expenseFormSchema, type CartItem, type ExpenseFormValues, type MemberLookup,
} from './sales.service';

type SaleMode = 'cash' | 'chit';

export function PointOfSalePage() {
  const { data: products } = useProducts();
  const activeProducts = (products ?? []).filter((p) => p.status === 'active');

  const [mode, setMode] = useState<SaleMode>('cash');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedMember, setSelectedMember] = useState<MemberLookup | null>(null);
  const [showPin, setShowPin] = useState(false);
  const [showExpense, setShowExpense] = useState(false);
  const [confirmed, setConfirmed] = useState<{ saleId: string; total: number } | null>(null);

  const createSale = useCreateSale();

  const addToCart = (productId: string) => {
    const p = activeProducts.find((x) => x.id === productId);
    if (!p) return;
    setCart((cur) => {
      const existing = cur.find((i) => i.product_id === p.id);
      if (existing) {
        return cur.map((i) => i.product_id === p.id ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...cur, {
        product_id: p.id,
        name: p.name,
        unit: p.unit,
        unit_price: p.selling_price,
        quantity: 1,
      }];
    });
  };

  const updateQuantity = (productId: string, qty: number) => {
    if (qty <= 0) return removeFromCart(productId);
    setCart((cur) => cur.map((i) => i.product_id === productId ? { ...i, quantity: qty } : i));
  };

  const removeFromCart = (productId: string) => {
    setCart((cur) => cur.filter((i) => i.product_id !== productId));
  };

  const total = useMemo(
    () => cart.reduce((acc, i) => acc + i.quantity * i.unit_price, 0),
    [cart]
  );

  const beginCheckout = () => {
    if (cart.length === 0) return;
    if (mode === 'chit' && !selectedMember) return;
    setShowPin(true);
  };

  const finalizeSale = async () => {
    try {
      const result = await createSale.mutateAsync({
        sale_type: mode,
        member_id: mode === 'chit' ? selectedMember?.user_id : null,
        items: cart,
      });
      setConfirmed({ saleId: result.saleId, total: result.total_amount ?? 0 });
      setCart([]);
      setSelectedMember(null);
      setShowPin(false);
    } catch (e: any) {
      alert(`Sale failed: ${e.message ?? String(e)}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Point of Sale</h1>
          <p className="text-sm text-muted-foreground">
            Cash and CHIT sales. Closing stock is recorded on the Daily Stock Sheet.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border bg-background p-1">
            <Button
              variant={mode === 'cash' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => { setMode('cash'); setSelectedMember(null); }}
            >
              <DollarSign className="mr-1 h-4 w-4" /> Cash
            </Button>
            <Button
              variant={mode === 'chit' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setMode('chit')}
            >
              <Receipt className="mr-1 h-4 w-4" /> CHIT
            </Button>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowExpense(true)}>
            <FileSignature className="mr-1 h-4 w-4" /> Expense
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Products */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Products</CardTitle>
            <CardDescription>Tap to add to the cart.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {activeProducts.map((p) => (
                <button
                  key={p.id}
                  onClick={() => addToCart(p.id)}
                  className="flex min-h-[88px] flex-col items-start justify-between rounded-md border bg-card p-3 text-left transition hover:border-primary hover:bg-accent active:scale-[0.98]"
                >
                  <div>
                    <div className="line-clamp-2 text-sm font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{p.category} · {p.unit}</div>
                  </div>
                  <div className="mt-1 font-mono text-sm font-semibold">{formatCurrency(p.selling_price)}</div>
                </button>
              ))}
              {activeProducts.length === 0 && (
                <p className="col-span-full text-center text-sm text-muted-foreground">
                  No active products. Add some under Products.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Cart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <ShoppingCart className="mr-2 inline h-4 w-4" />
              Cart ({cart.length})
            </CardTitle>
            <CardDescription>
              {mode === 'chit' && (
                <span className="text-amber-600">
                  <UserIcon className="mr-1 inline h-3 w-3" />
                  {selectedMember ? `${selectedMember.service_number} · ${selectedMember.full_name}` : 'Select a member below'}
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {cart.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Cart is empty.</p>
            ) : (
              <div className="divide-y rounded-md border">
                {cart.map((i) => (
                  <div key={i.product_id} className="flex items-center gap-2 p-2">
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-sm font-medium">{i.name}</div>
                      <div className="text-xs text-muted-foreground">{formatCurrency(i.unit_price)} × {i.quantity}</div>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => updateQuantity(i.product_id, i.quantity - 1)}
                      aria-label={`Decrease quantity of ${i.name}`}
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <div className="w-6 text-center text-sm" aria-live="polite">{i.quantity}</div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => updateQuantity(i.product_id, i.quantity + 1)}
                      aria-label={`Increase quantity of ${i.name}`}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => removeFromCart(i.product_id)}
                      aria-label={`Remove ${i.name} from cart`}
                    >
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {/* Member selection (CHIT only) */}
            {mode === 'chit' && (
              <MemberPicker
                selected={selectedMember}
                onSelect={setSelectedMember}
              />
            )}

            <div className="flex items-center justify-between border-t pt-3">
              <div className="text-sm text-muted-foreground">Total</div>
              <div className="text-2xl font-bold font-mono">{formatCurrency(total)}</div>
            </div>

            <Button
              className="w-full"
              size="lg"
              onClick={beginCheckout}
              disabled={cart.length === 0 || (mode === 'chit' && !selectedMember) || createSale.isPending}
            >
              {createSale.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mode === 'cash' ? 'Complete Cash Sale' : 'Confirm CHIT Sale'}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Member PIN confirmation */}
      <Dialog open={showPin} onOpenChange={setShowPin}>
        {selectedMember && (
          <PinDialog
            member={selectedMember}
            total={total}
            onConfirm={finalizeSale}
            onCancel={() => setShowPin(false)}
            submitting={createSale.isPending}
          />
        )}
        {!selectedMember && mode === 'cash' && (
          <CashConfirmDialog
            total={total}
            onConfirm={finalizeSale}
            onCancel={() => setShowPin(false)}
            submitting={createSale.isPending}
          />
        )}
      </Dialog>

      {/* Expense dialog */}
      <Dialog open={showExpense} onOpenChange={setShowExpense}>
        <ExpenseDialog
          onSubmit={async (vals) => {
            await useCreateExpense().mutateAsync(vals);
            setShowExpense(false);
          }}
          onCancel={() => setShowExpense(false)}
        />
      </Dialog>

      {/* Success */}
      <Dialog open={!!confirmed} onOpenChange={(o) => !o && setConfirmed(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-600" />
              Sale Recorded
            </DialogTitle>
            <DialogDescription>
              Sale ID: <span className="font-mono">{confirmed?.saleId.slice(0, 8)}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border p-4 text-center">
            <div className="text-sm text-muted-foreground">Total</div>
            <div className="text-3xl font-bold font-mono">{formatCurrency(confirmed?.total ?? 0)}</div>
          </div>
          <DialogFooter>
            <Button onClick={() => setConfirmed(null)}>New Sale</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------- Member picker (CHIT only) ----------

function MemberPicker({
  selected, onSelect,
}: { selected: MemberLookup | null; onSelect: (m: MemberLookup | null) => void }) {
  const [q, setQ] = useState('');
  const { data: matches, isLoading } = useMemberSearch(q);

  return (
    <div className="space-y-2">
      <Label className="text-xs">Member (service number)</Label>
      <SearchInput
        placeholder="Type at least 2 characters…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {isLoading && (
        <p className="text-xs text-muted-foreground"><Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> Searching…</p>
      )}
      {selected && (
        <div className="flex items-center justify-between rounded-md border bg-accent/40 p-2 text-sm">
          <div>
            <div className="font-medium">{selected.full_name}</div>
            <div className="text-xs text-muted-foreground">
              {selected.service_number} · {selected.rank ?? '—'} ·{' '}
              Balance: <span className="font-mono">{formatCurrency(selected.chit_balance)}</span>
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={() => onSelect(null)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}
      {!selected && (matches ?? []).length > 0 && (
        <div className="max-h-40 overflow-auto rounded-md border">
          {matches!.map((m) => (
            <button
              key={m.user_id}
              onClick={() => onSelect(m)}
              className="flex w-full items-center justify-between p-2 text-left text-sm hover:bg-accent"
            >
              <div>
                <div className="font-medium">{m.full_name}</div>
                <div className="text-xs text-muted-foreground">
                  {m.service_number} · {m.rank ?? '—'}
                </div>
              </div>
              <Badge variant={m.is_blacklisted ? 'destructive' : 'outline'}>
                {formatCurrency(m.chit_balance)}
              </Badge>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- PIN / Cash confirm ----------

function CashConfirmDialog({
  total, onConfirm, onCancel, submitting,
}: { total: number; onConfirm: () => void; onCancel: () => void; submitting: boolean }) {
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Confirm Cash Sale</DialogTitle>
        <DialogDescription>Press Confirm to record this cash sale.</DialogDescription>
      </DialogHeader>
      <div className="rounded-md border p-4 text-center">
        <div className="text-sm text-muted-foreground">Amount due</div>
        <div className="text-3xl font-bold font-mono">{formatCurrency(total)}</div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={onConfirm} disabled={submitting}>
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Confirm
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function PinDialog({
  member, total, onConfirm, onCancel, submitting,
}: {
  member: MemberLookup;
  total: number;
  onConfirm: () => void;
  onCancel: () => void;
  submitting: boolean;
}) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const handleConfirm = async () => {
    setError(null);
    setVerifying(true);
    const result = await verifyMemberPassword(member.service_number, pin);
    setVerifying(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onConfirm();
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Member Authorization</DialogTitle>
        <DialogDescription>
          {member.full_name} ({member.service_number}) must enter their password to authorize this CHIT purchase.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="rounded-md border p-3 text-center">
          <div className="text-sm text-muted-foreground">CHIT amount</div>
          <div className="text-2xl font-bold font-mono">{formatCurrency(total)}</div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="pin">Password</Label>
          <Input
            id="pin"
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleConfirm();
            }}
          />
        </div>
        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={handleConfirm} disabled={submitting || verifying || !pin}>
          {(submitting || verifying) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Authorize & Record
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ---------- Expense dialog ----------

function ExpenseDialog({
  onSubmit, onCancel,
}: { onSubmit: (v: ExpenseFormValues) => Promise<void>; onCancel: () => void }) {
  const { register, handleSubmit, formState: { errors } } = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseFormSchema),
    defaultValues: { expense_date: format(new Date(), 'yyyy-MM-dd') },
  });
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Record Expense</DialogTitle>
        <DialogDescription>Expenses do not affect stock.</DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Date" error={errors.expense_date?.message} className="sm:col-span-2">
          <Input type="date" {...register('expense_date')} />
        </Field>
        <Field label="Description" error={errors.description?.message} className="sm:col-span-2">
          <Input {...register('description')} placeholder="e.g. Cleaning supplies" />
        </Field>
        <Field label="Amount" error={errors.amount?.message}>
          <MoneyInput step="0.01" {...register('amount')} />
        </Field>
        <Field label="Purpose" error={errors.purpose?.message}>
          <Input {...register('purpose')} placeholder="e.g. Unit admin" />
        </Field>
        <Field label="Remarks" error={errors.remarks?.message} className="sm:col-span-2">
          <Input {...register('remarks')} />
        </Field>
        <DialogFooter className="sm:col-span-2 mt-2 flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={onCancel} className="w-full sm:w-auto">Cancel</Button>
          <Button type="submit" className="w-full sm:w-auto">Record Expense</Button>
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
