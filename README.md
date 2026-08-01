# MMMIS — Military Mess Management Information System

A modern web app that digitises a military mess bar's daily operations —
**Point of Sale, Stock, CHIT (mess credit), CHIT Recovery, Ledger, Expenses,
Reports, Member Portal, Audit, Backup Health** — while preserving the
existing paper workflow and terminology.

- **Live**: <https://mmmis.vercel.app>
- **Stack**: React 18 + TypeScript + Vite, Supabase (Postgres + Auth + Edge
  Functions + Realtime + pg_cron), PWA via `vite-plugin-pwa` + Workbox,
  Tailwind + shadcn-style Radix primitives, TanStack Query, React Hook Form
  + Zod, Recharts, `@react-pdf/renderer`, `xlsx`.

---

## Status

**Production pilot.** All seven originally-planned phases are implemented and
shipping. The CHIT two-phase buyer-approval flow, atomic `create_sale()`,
`create_chit_authorization()` / `finalize_chit_authorization()`, audit triggers,
RLS on every table, PWA install + offline indicator, and Web Push
notifications are all live. See `CONTINUE_HERE.md` for the most recent run
notes.

Roles supported: `administrator`, `treasurer`, `barman`, `member`.

---

## Features

| Module | Routes | Notes |
| --- | --- | --- |
| Auth & users | `/login`, `/register`, `/forgot`, `/reset`, `/users` | Service-number + password login, 4-role RBAC, soft-delete |
| Dashboard | `/` | Role-aware (admin/treasurer/barman/member) |
| Point of Sale | `/pos` | Cash + CHIT, atomic sale RPC, low-stock aware |
| Daily summary | `/daily-summary` | PDF download, exports |
| Products | `/products`, `/products/low-stock` | Soft-delete + active/inactive status |
| Stock | `/stock-sheet`, `/stock-receipts`, `/stock-valuation` | Daily sheet, receipts, valuation |
| CHIT | `/outstanding-chit`, `/chit-payments` | Outstanding list, payment recording, recovery tracking |
| Expenses | `/expenses-admin` | Release / approve workflow |
| Cash | `/cash-at-hand`, `/reports/cash-closing` | Daily closing with variance |
| Members | `/members`, `/members-directory`, `/portal/*` | Self-service portal: statement, purchases, payments, profile |
| Reports | `/reports/pnl`, `/reports/cash-closing` | P&L, cash closing, export |
| Audit | `/admin/audit`, `/admin/audit/summary`, `/admin/audit/export` | Trigger-stamped rows, summary aggregates, export |
| Settings | `/admin/settings` | Mess-wide config (name, currency, float, CHIT target, VAT, holiday mode) |
| Security | `/security`, `/admin/sessions` | Rate-limited login attempts, sessions, lockout |
| Backup health | `/admin/backups` | Verify + manual trigger |
| PWA | (no route) | Install, offline indicator, update banner, push notifications |

---

## Folder structure

```
mmmis/
├─ src/
│  ├─ components/
│  │  ├─ layout/        AppShell, BottomTabBar, NavDrawer, ThemeToggle
│  │  └─ ui/            button, card, dialog, input, table, toast, ...
│  ├─ features/
│  │  ├─ admin/         AuditLogPage, BackupHealthPage, audit export
│  │  ├─ audit/         audit helpers, export, summary
│  │  ├─ auth/          Login, Register, Forgot/Reset password, guards
│  │  ├─ dashboard/     role-aware dashboard
│  │  ├─ member/        MemberPortalPage, statement, purchases, payments
│  │  ├─ products/      ProductsPage, low-stock
│  │  ├─ reports/       P&L, cash closing, reports service
│  │  ├─ sales/         POS, DailySummaryPage, DailySummaryPDF
│  │  ├─ security/      SecurityPage, SessionsListPage
│  │  ├─ settings/      SettingsPage + service
│  │  ├─ stock/         StockSheetPage, receipts, valuation, PDF
│  │  ├─ treasurer/     ChitPayments, Expenses, Members, Cash at Hand, etc.
│  │  └─ users/         UsersPage + service
│  ├─ pwa/              InstallBanner, UpdateBanner, push subscription
│  ├─ hooks/            useBreakpoint, ...
│  ├─ lib/              supabase client, utils, toast
│  └─ types/            database placeholder types
├─ supabase/
│  ├─ migrations/       0001_init.sql through 0035_push_notifications.sql
│  └─ functions/        bootstrap-admin, create-user, chit-authorize,
│                       password-reset, admin-reset-password,
│                       set-member-email, bulk-seed-members,
│                       expire-chit-authorizations, admin-wipe-auth-users,
│                       push-dispatch
├─ tools/               Operator scripts (destructive ops live here)
├─ scripts/             Build-time helpers (backup-verify.ts, ...)
├─ tests/
│  ├─ e2e/              Playwright (chit-flow.spec.ts)
│  ├─ edge/             curl smoke (run.sh)
│  └─ sql/              hardening smoke, diagnostic
├─ public/              PWA manifest, icons
├─ docs/                BACKUP_RESTORE.md
└─ vercel.json          SPA fallback rewrite
```

---

## Getting started

### 1. Provision a Supabase project

1. Create a project at <https://supabase.com/dashboard>.
2. Copy the **Project URL** and **anon public key** from Project Settings → API.
3. In the SQL editor, run every migration in `supabase/migrations/` **in
   filename order**. They are idempotent. If you also want pg_cron + the
   product validation in `create_sale()`, run `tools/apply_pending_migrations.sql`
   (or run `0028_chit_expiry_cron.sql` + `0029_create_sale_product_validation.sql`
   directly).
4. In _Authentication → Providers_, ensure **Email** is enabled.

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key

# Required for Web Push
VITE_VAPID_PUBLIC_KEY=...
```

The matching private VAPID key + a contact email go in Supabase Edge
Function secrets (`VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`) so `push-dispatch`
can sign messages.

### 3. Install + run

```bash
npm install
npm run dev          # http://localhost:5173
```

### 4. Deploy Edge Functions

```bash
# using tools/supabase.ps1 (wrapper around the cached npx CLI)
pwsh tools/supabase.ps1 functions deploy bootstrap-admin --no-verify-jwt
pwsh tools/supabase.ps1 functions deploy create-user --no-verify-jwt
pwsh tools/supabase.ps1 functions deploy chit-authorize --no-verify-jwt
pwsh tools/supabase.ps1 functions deploy password-reset --no-verify-jwt
pwsh tools/supabase.ps1 functions deploy admin-reset-password --no-verify-jwt
pwsh tools/supabase.ps1 functions deploy set-member-email --no-verify-jwt
pwsh tools/supabase.ps1 functions deploy bulk-seed-members --no-verify-jwt
pwsh tools/supabase.ps1 functions deploy expire-chit-authorizations --no-verify-jwt
pwsh tools/supabase.ps1 functions deploy push-dispatch --no-verify-jwt
```

### 5. Create the first administrator

Use `tools/run_bootstrap.ps1` after a fresh wipe, or manually via the
Supabase dashboard (Authentication → Users → Add user) and then linking
with SQL:

```sql
insert into public.users (auth_id, service_number, full_name, email, role_id, is_active)
values (
  '<paste auth.users.id here>',
  'ZM-00001',
  'Initial Administrator',
  'admin@example.com',
  1,        -- administrator role_id
  true
);
```

---

## Conventions

- **Strong typing**: no `any`. Boundary types live in `src/types/`.
- **Feature folders**: each feature owns its UI, service hooks, and types.
- **No business logic in components** — service files only.
- **Auditable writes**: any user-management mutation calls `logAudit`
  (`src/features/audit/audit.ts`).
- **Atomic database writes**: sales, CHIT authorisations, and ledger entries
  happen in single Postgres transactions inside `SECURITY DEFINER` RPCs.

---

## Scripts

| Command             | Description                                       |
| ------------------- | ------------------------------------------------- |
| `npm run dev`       | Start Vite dev server                             |
| `npm run build`     | Type-check (`tsc -b`) + production build          |
| `npm run preview`   | Preview the production build                      |
| `npm run typecheck` | Type-check only                                   |
| `npm run lint`      | ESLint                                            |
| `npm run db:types`  | Regenerate `database.generated.ts` from Supabase  |

---

## Operations

- **Run notes** — `CONTINUE_HERE.md` (most recent session notes)
- **Backup + restore** — `docs/BACKUP_RESTORE.md`
- **Operator scripts** — `tools/README.md` (severity-tagged, do not run
  destructive scripts without reading the header)

---

## Status of automated tests

| Layer | Coverage |
| --- | --- |
| Database (smoke) | `tests/sql/00_hardening_smoke.sql` |
| Edge Functions (curl) | `tests/edge/run.sh` |
| E2E (Playwright) | `tests/e2e/chit-flow.spec.ts` |
| Unit / component | **None yet** — see production-readiness plan, item P2.1 |
