# Phase 13 — Member directory wiring

## Files created
- `supabase/migrations/0013_phase13_member_directory.sql` — `public.search_members(p_query, p_limit, p_only_active)` RPC
- `src/features/treasurer/members.directory.service.ts` — `useMemberDirectory(q, onlyActive)` hook
- `src/features/treasurer/MembersDirectoryPage.tsx` — UI page

## Files NOT modified
- `src/App.tsx`
- `src/components/layout/AppShell.tsx`

---

## Step 1 — register the route in `src/App.tsx`

After the `MembersPage` import line (around line 18), add:

```ts
import { MembersDirectoryPage } from '@/features/treasurer/MembersDirectoryPage';
```

After the `/members` route (around line 94), add a parallel one:

```tsx
<Route path="/members-directory" element={<ProtectedRoute allow={['administrator','treasurer']}><MembersDirectoryPage /></ProtectedRoute>} />
```

## Step 2 — add a nav entry in `src/components/layout/AppShell.tsx`

The existing `Members` entry is at line 33. Add a parallel one nearby:

```ts
{ to: '/members-directory', label: 'Directory', roles: ['administrator','treasurer'], icon: Search },
```

`Search` is from `lucide-react` — add it to the existing import line at the top of the file. The current import is:

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
  Calendar, ShoppingBag, IdCard, ScrollText, Settings as Cog, Search,
} from 'lucide-react';
```

---

## Step 3 — apply the migration

```bash
supabase db push
```

or paste `0013_phase13_member_directory.sql` into the Supabase SQL editor.

## Step 4 — smoke test

1. Sign in as administrator or treasurer
2. Navigate to `/members-directory`
3. You should see:
   - The full member list
   - A search box that filters by service number, name, rank, or unit
   - A toggle for "active members only"
   - Totals: count, CHIT owed, members over credit limit
   - A CSV export button
4. Try typing a partial name in the search box — results should narrow as the RPC re-queries

## Why the wiring was left manual

`App.tsx` and `AppShell.tsx` are on the no-augment list. Both edits are
single-line additions and are intentionally left as manual steps.
