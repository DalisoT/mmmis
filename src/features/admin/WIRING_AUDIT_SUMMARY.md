# Phase 12 — Audit summary wiring

## Files created
- `supabase/migrations/0012_phase12_audit_summary.sql` — `public.get_audit_summary(p_from, p_to)` RPC
- `src/features/audit/audit.summary.service.ts` — `useAuditSummary(fromIso, toIso)` hook
- `src/features/admin/AuditSummaryPage.tsx` — UI page

## Files NOT modified
- `src/App.tsx`
- `src/components/layout/AppShell.tsx`

---

## Step 1 — register the route in `src/App.tsx`

After the `AuditLogExportPage` import line (around line 30), add:

```ts
import { AuditSummaryPage } from '@/features/admin/AuditSummaryPage';
```

After the `/admin/audit/export` route (around line 102), add a parallel one:

```tsx
<Route path="/admin/audit/summary" element={<ProtectedRoute allow={['administrator']}><AuditSummaryPage /></ProtectedRoute>} />
```

## Step 2 — add a nav entry in `src/components/layout/AppShell.tsx`

The existing `Audit export` entry is already at line 43. Add a parallel one nearby:

```ts
{ to: '/admin/audit/summary', label: 'Audit summary', roles: ['administrator'], icon: BarChart3 },
```

`BarChart3` is **already** imported in `AppShell.tsx` (it's used for "Stock Valuation" and "Profit & Loss"), so no import change is needed.

---

## Step 3 — apply the migration

```bash
supabase db push
```

or paste `0012_phase12_audit_summary.sql` into the Supabase SQL editor.

## Step 4 — smoke test

1. Sign in as administrator
2. Navigate to `/admin/audit/summary`
3. You should see:
   - Total event count for the default 7-day window
   - A bar chart of daily event counts
   - Three top-10 lists: actions, tables, actors
4. Try the preset buttons (24h / 7d / 30d / 90d) and the custom datetime pickers

## Why the wiring was left manual

`App.tsx` and `AppShell.tsx` are on the no-augment list. Both edits are
single-line additions and are intentionally left as manual steps.
