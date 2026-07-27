import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Loader2, ShoppingCart, X, Plus, Minus, DollarSign, Receipt, ShieldCheck,
  User as UserIcon, Trash2, FileSignature, Smartphone, KeyRound, QrCode,
  Clock, Wifi, AlertTriangle,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchInput, MoneyInput } from '@/components/ui/number-input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from '@/components/ui/tabs';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useProducts } from '@/features/products/products.service';
import { formatCurrency } from '@/lib/utils';
import { toast } from '@/lib/toast';
import { useCountdown, formatCountdown } from '@/hooks/useCountdown';
import {
  useMemberSearch, useCreateSale, useCreateExpense, verifyMemberPassword,
  useCreateChitAuthorization, useManualOverrideAuthorization,
  useCancelChitAuthorization, useFinalizeChitAuthorization,
  useChitAuthorizationLive,
  expenseFormSchema, type CartItem, type ExpenseFormValues, type MemberLookup,
} from './sales.service';

type SaleMode = 'cash' | 'chit';

export function PointOfSalePage() {
  const { data: products } = useProducts();
  const activeProducts = (products ?? []).filter((p) => p.status === 'active');

  const [mode, setMode] = useState<SaleMode>('cash');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedMember, setSelectedMember] = useState<MemberLookup | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [authRequest, setAuthRequest] = useState<{ id: string; expires_at: string } | null>(null);
  const [showExpense, setShowExpense] = useState(false);
  const [confirmed, setConfirmed] = useState<{ saleId: string; total: number } | null>(null);

  const createSale = useCreateSale();
  const createAuth = useCreateChitAuthorization();
  const manualOverride = useManualOverrideAuthorization();
  const cancelAuth = useCancelChitAuthorization();
  const finalizeAuth = useFinalizeChitAuthorization();

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

  /**
   * Kick off the checkout.
   *
   * - Cash: open the existing cash-confirm dialog.
   * - CHIT: insert a pending authorization request first, then open the
   *   two-tab dialog (buyer-phone OR barman manual override).
   */
  const beginCheckout = () => {
    if (cart.length === 0) return;
    if (mode === 'chit' && !selectedMember) return;

    if (mode === 'cash') {
      setShowAuth(true);
      return;
    }

    // CHIT: create the authorization request server-side first so the row
    // exists before the dialog opens (otherwise the Realtime subscription
    // mounted when the dialog opens can race against the INSERT).
    void (async () => {
      try {
        const r = await createAuth.mutateAsync({
          member_id: selectedMember!.user_id,
          items: cart,
          total_amount: total,
        });
        setAuthRequest({ id: r.request_id, expires_at: r.expires_at });
        setShowAuth(true);
      } catch (e: any) {
        toast.error(`Could not begin CHIT checkout: ${e.message ?? String(e)}`);
      }
    })();
  };

  /**
   * Apply the response from one of the authorization paths.
   *
   * - 'cash'        — no authorization, just run create_sale().
   * - 'authorized'  — buyer approved on their phone; run finalize_chit.
   * - 'manual'      — barman typed the password; stamp manual_override
   *                   then run finalize_chit.
   *
   * All three end up creating the underlying sale row.
   */
  const applyFinalizedSale = async (saleId: string, total: number) => {
    setConfirmed({ saleId, total });
    setCart([]);
    setSelectedMember(null);
    setShowAuth(false);
    setAuthRequest(null);
  };

  /** Cash branch only — no auth row needed. */
  const finalizeCashSale = async () => {
    try {
      const result = await createSale.mutateAsync({
        sale_type: 'cash',
        member_id: null,
        items: cart,
      });
      await applyFinalizedSale(result.saleId, Number(result.total_amount ?? 0));
    } catch (e: any) {
      toast.error(`Sale failed: ${e.message ?? String(e)}`);
    }
  };

  /** CHIT branch — already have a request id; just need to run create_sale
   *  through finalize_chit__authorization. */
  const finalizeChitSale = async (requestId: string) => {
    try {
      const result = await finalizeAuth.mutateAsync(requestId);
      await applyFinalizedSale(result.saleId, Number(result.total_amount ?? 0));
    } catch (e: any) {
      toast.error(`Finalize failed: ${e.message ?? String(e)}`);
    }
  };

  /** Barman override path — stamp override then finalize in one go. */
  const applyManualOverride = async (requestId: string) => {
    try {
      await manualOverride.mutateAsync(requestId);
      const result = await finalizeAuth.mutateAsync(requestId);
      await applyFinalizedSale(result.saleId, Number(result.total_amount ?? 0));
    } catch (e: any) {
      toast.error(`Override failed: ${e.message ?? String(e)}`);
    }
  };

  /** Barman changes mind — mark the request cancelled. */
  const cancelAuthRequest = async (requestId: string) => {
    try {
      await cancelAuth.mutateAsync(requestId);
    } catch {
      // Best-effort. Row will auto-expire 5 minutes after creation anyway.
    }
    setShowAuth(false);
    setAuthRequest(null);
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
              disabled={
                cart.length === 0
                || (mode === 'chit' && !selectedMember)
                || createAuth.isPending
                || createSale.isPending
                || finalizeAuth.isPending
              }
            >
              {(createAuth.isPending || createSale.isPending || finalizeAuth.isPending) && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {mode === 'cash' ? 'Complete Cash Sale' : 'Send to Member for Approval'}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Authorization / cash-confirm dialog */}
      <Dialog open={showAuth} onOpenChange={(o) => {
        if (!o && authRequest) void cancelAuthRequest(authRequest.id);
        else if (!o) setShowAuth(false);
      }}>
        {mode === 'cash' && (
          <CashConfirmDialog
            total={total}
            onConfirm={finalizeCashSale}
            onCancel={() => setShowAuth(false)}
            submitting={createSale.isPending}
          />
        )}
        {mode === 'chit' && authRequest && selectedMember && (
          <ChitAuthorizationDialog
            requestId={authRequest.id}
            expiresAt={authRequest.expires_at}
            member={selectedMember}
            total={total}
            items={cart}
            onManualOverride={(pw) => verifyMemberPassword(selectedMember.service_number, pw)
              .then((r) => r.ok
                ? (applyManualOverride(authRequest.id), { ok: true as const })
                : { ok: false as const, error: r.error })}
            onCancel={() => void cancelAuthRequest(authRequest.id)}
            onApproved={() => void finalizeChitSale(authRequest.id)}
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

/**
 * Two-tab CHIT authorization dialog.
 *
 * Tab 1 "Member's phone": shows the buyer a QR code + URL pointing to
 * /portal/authorize/<id>, displays a live countdown, and reacts to Realtime
 * updates on the request row.
 *
 * Tab 2 "Barman manual entry": the existing fallback. Barman types the
 * buyer's password; on success, stamps `manual_override` and finalizes.
 *
 * The Realtime subscription is mounted while the dialog is open. As soon
 * as the buyer approves from their phone, status flips to 'authorized' via
 * the chit-authorize Edge Function and we automatically call finalize.
 */
function ChitAuthorizationDialog({
  requestId,
  expiresAt,
  member,
  total,
  items,
  onManualOverride,
  onCancel,
  onApproved,
}: {
  requestId: string;
  expiresAt: string;
  member: MemberLookup;
  total: number;
  items: CartItem[];
  onManualOverride: (password: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  onCancel: () => void;
  onApproved: () => void;
}) {
  const { row, connectionState } = useChitAuthorizationLive(requestId);
  const expiresMs = useMemo(() => new Date(expiresAt).getTime(), [expiresAt]);
  const secondsLeft = useCountdown(expiresMs);

  // Auto-finalize the moment status flips to authorized or manual_override.
  // Avoid running twice: useEffect-once per (status, requestId) pair.
  const [autoFinalized, setAutoFinalized] = useState(false);
  useEffect(() => {
    if (autoFinalized) return;
    if (row?.status === 'authorized' || row?.status === 'manual_override') {
      setAutoFinalized(true);
      onApproved();
    }
  }, [row?.status, autoFinalized, onApproved]);

  // Terminal-state labels.
  if (row?.status === 'rejected') {
    return (
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" /> Member declined
          </DialogTitle>
          <DialogDescription>
            {member.full_name} declined this CHIT purchase from their phone.
            {row.rejection_reason ? ` Reason: ${row.rejection_reason}` : ''}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Close</Button>
        </DialogFooter>
      </DialogContent>
    );
  }
  if (row?.status === 'expired') {
    return (
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-600">
            <Clock className="h-5 w-5" /> Timed out
          </DialogTitle>
          <DialogDescription>
            The 5-minute window elapsed with no response. Close and try again, or
            use Manual Entry below if the buyer is present.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Close</Button>
        </DialogFooter>
      </DialogContent>
    );
  }

  const portalUrl =
    (typeof window !== 'undefined' ? window.location.origin : '') +
    `/portal/authorize/${requestId}`;

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-emerald-600" /> CHIT Authorization
        </DialogTitle>
        <DialogDescription>
          Waiting for <strong>{member.full_name}</strong> ({member.service_number}) to
          approve this purchase on their phone, or use Manual Entry below.
        </DialogDescription>
      </DialogHeader>

      <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 p-3 text-sm">
        <div className="flex items-center gap-2">
          {connectionState === 'connected' && <Wifi className="h-4 w-4 text-emerald-600" />}
          {connectionState === 'polling' && <Wifi className="h-4 w-4 text-amber-600" />}
          {(connectionState === 'connecting' || connectionState === 'unsubscribed') && (
            <Loader2 className="h-4 w-4 animate-spin" />
          )}
          <span className="text-xs text-muted-foreground">
            {connectionState === 'connected' && 'Live: listening for buyer response'}
            {connectionState === 'polling' && 'Polling: realtime dropped, checking every 5s'}
            {connectionState === 'connecting' && 'Connecting…'}
            {connectionState === 'unsubscribed' && 'Idle'}
          </span>
        </div>
        <div className={`flex items-center gap-1 font-mono text-lg font-semibold ${secondsLeft <= 30 ? 'text-destructive' : ''}`}>
          <Clock className="h-4 w-4" /> {formatCountdown(secondsLeft)}
        </div>
      </div>

      <Tabs defaultValue="buyer">
        <TabsList className="w-full">
          <TabsTrigger value="buyer" className="flex-1">
            <Smartphone className="mr-1 h-3 w-3" /> Member's phone
          </TabsTrigger>
          <TabsTrigger value="manual" className="flex-1">
            <KeyRound className="mr-1 h-3 w-3" /> Barman override
          </TabsTrigger>
        </TabsList>

        <TabsContent value="buyer" className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col items-center justify-center rounded-md border bg-white p-3">
              <div className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
                <QrCode className="h-3 w-3" /> Scan with the member's phone
              </div>
              <QRCodeSVG value={portalUrl} size={156} level="M" includeMargin={false} />
            </div>
            <div className="space-y-2 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">Request id</div>
                <code className="break-all rounded bg-muted px-1 py-0.5 text-xs">
                  {requestId.slice(0, 8)}…{requestId.slice(-4)}
                </code>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">CHIT amount</div>
                <div className="font-mono text-2xl font-bold">{formatCurrency(total)}</div>
              </div>
              <div className="rounded-md border p-2 text-xs">
                <div className="font-medium">Items</div>
                <ul className="mt-1 space-y-0.5 text-muted-foreground">
                  {items.map((i) => (
                    <li key={i.product_id} className="flex justify-between">
                      <span className="truncate">{i.name}</span>
                      <span className="ml-2 font-mono">×{i.quantity}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="break-all rounded-md bg-muted p-2 text-[11px] text-muted-foreground">
                {portalUrl}
              </div>
            </div>
          </div>
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-200">
            <Smartphone className="mt-0.5 h-3.5 w-3.5" />
            <div>
              The member must be signed in to <strong>/portal</strong> and re-enter
              their password on their own phone. The barman never sees the
              password this way.
            </div>
          </div>
        </TabsContent>

        <TabsContent value="manual" className="space-y-3">
          <ManualOverrideForm
            submitting={false}
            onCancel={onCancel}
            onSubmit={onManualOverride}
          />
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <AlertTriangle className="h-3 w-3" />
            Manual override will be recorded in the audit log with your service
            number. Use only when the buyer's phone is unavailable.
          </p>
        </TabsContent>
      </Tabs>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
      </DialogFooter>
    </DialogContent>
  );
}

function ManualOverrideForm({
  onSubmit,
  onCancel,
  submitting,
}: {
  onSubmit: (pw: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  onCancel: () => void;
  submitting: boolean;
}) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handle = async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await onSubmit(pw);
      if (!r.ok) setError(r.error);
      // On success the parent closes the dialog.
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="manual-pw">Member password (typed by barman)</Label>
      <Input
        id="manual-pw"
        type="password"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        autoFocus
        onKeyDown={(e) => { if (e.key === 'Enter') void handle(); }}
      />
      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button variant="outline" onClick={onCancel} className="flex-1">Cancel</Button>
        <Button
          variant="destructive"
          onClick={handle}
          disabled={submitting || busy || !pw}
          className="flex-1"
        >
          {(submitting || busy) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Authorize & Record
        </Button>
      </div>
    </div>
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
