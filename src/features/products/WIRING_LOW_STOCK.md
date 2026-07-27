# Phase 14 — Low-stock report wiring

## Files created
- `supabase/migrations/0014_phase14_low_stock.sql` — `public.get_low_stock(p_only_active bool, p_limit int)` RPC
- `src/features/products/products.lowstock.service.ts` — `useLowStock(onlyActive)` hook
- `src/features/products/ProductsLowStockPage.tsx` — UI page

## Files NOT modified
- `src/App.tsx`
- `src/components/layout/AppShell.tsx`

---

## Step 1 — register the route in `src/App.tsx`

After the `ProductsPage` import line (around line 9), add:

```ts
import { ProductsLowStockPage } from '@/features/products/ProductsLowStockPage';
```

After the `/products` route (around line 56), add a parallel one:

```tsx
<Route path="/products/low-stock" element={<ProtectedRoute allow={['administrator','treasurer','barman']}><ProductsLowStockPage /></ProtectedRoute>} />
```

## Step 2 — add a nav entry in `src/components/layout/AppShell.tsx`

The existing `Products` entry is at line 25. Add a parallel one nearby:

```ts
{ to: '/products/low-stock', label: 'Low stock', roles: ['administrator','treasurer','barman'], icon: TrendingDown },
```

`TrendingDown` is from `lucide-react` — add it to the existing import line at the top of the file. The current import is:

```ts
import {
  LogOut, ShieldCheck, Users, Package, Truck, ClipboardList, BarChart3,
  ShoppingCart, Activity, Wallet, Receipt, UserRound, Banknote, AlertTriangle,
  Calendar, ShoppingBag, IdCard, ScrollText, Settings as Cog,
} from 'lucide-react';
```

Extend it to:

```ts
import {
  LogOut, ShieldCheck, Users, Package, Truck, ClipboardList, BarChart3,
  ShoppingCart, Activity, Wallet, Receipt, UserRound, Banknote, AlertTriangle,
  Calendar, ShoppingBag, IdCard, ScrollText, Settings as Cog, TrendingDown,
} from 'lucide-react';
```

---

## Step 3 — apply the migration

```bash
supabase db push
```

or paste `0014_phase14_low_stock.sql` into the Supabase SQL editor.

## Step 4 — smoke test

1. Sign in as barman, treasurer, or administrator
2. Navigate to `/products/low-stock`
3. You should see:
   - A summary banner if anything is out or critical
   - Five tiles: Out / Critical / Low / Healthy / No min
   - A table sorted by severity, with status pills and per-row messages
4. Toggle "Active only" off to include inactive products

## Why the wiring was left manual

`App.tsx` and `AppShell.tsx` are on the no-augment list. Both edits are
single-line additions and are intentionally left as manual steps.
