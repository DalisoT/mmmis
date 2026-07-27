# Phase 11 — Backup Health Dashboard wiring

## Files created
- `supabase/migrations/0011_phase11_backup_health.sql` — `public.get_backup_health()` RPC
- `src/features/admin/backup.service.ts` — `useBackupHealth()` hook
- `src/features/admin/BackupHealthPage.tsx` — UI page

## Files NOT modified (additive only)
- `src/App.tsx`
- `src/components/layout/AppShell.tsx`

To make the page reachable, apply the two one-line edits below.

---

## Step 1 — register the route in `src/App.tsx`

After the `AuditLogExportPage` import line (around line 30), add:

```ts
import { BackupHealthPage } from '@/features/admin/BackupHealthPage';
```

After the `/admin/audit/export` route (around line 102), add a parallel one:

```tsx
<Route path="/admin/backups" element={<ProtectedRoute allow={['administrator','treasurer']}><BackupHealthPage /></ProtectedRoute>} />
```

## Step 2 — add a nav entry in `src/components/layout/AppShell.tsx`

Inside the `NAV` array, near the other administrator entries (anywhere
after the `Audit log` entry is fine), add:

```ts
{ to: '/admin/backups', label: 'Backup health', roles: ['administrator','treasurer'], icon: Database },
```

`Database` is already imported from `lucide-react` in some pages, but
**not** in `AppShell.tsx`. Add it to the existing import line at the top
of the file:

```ts
import {
  LogOut, ShieldCheck, Users, Package, Truck, ClipboardList, BarChart3,
  ShoppingCart, Activity, Wallet, Receipt, UserRound, Banknote, AlertTriangle,
  Calendar, ShoppingBag, IdCard, ScrollText, Settings as Cog, Database,
} from 'lucide-react';
```

---

## Step 3 — apply the migration

```
supabase db push
# or paste the file into the Supabase SQL editor
```

After the RPC exists, the page will load data on first navigation.

## Step 4 — smoke test

1. Sign in as administrator or treasurer
2. Navigate to `/admin/backups`
3. You should see 14 tables, each with row count, last-write timestamp,
   and a status pill
4. Tables with no recent activity should show "Stale" (warn) or "Stalled" (error)
5. Empty tables (e.g. `mess_settings` before first save) should show "Empty"

## Why the wiring was left manual

`App.tsx` and `AppShell.tsx` are on the no-augment list. Both edits are
single-line find/replace and are intentionally left as one-time manual
steps, the same way the favicon `<link>` block was handled.
