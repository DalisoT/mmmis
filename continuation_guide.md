# MMMIS — Continuation Guide

> **Read this file at the start of every fresh Claude Code session** to bring
> the assistant fully up to speed on the project without losing context.
>
> Source of truth: this file. Source of original vision: `guide.txt`.
> Source of code: `src/`, `supabase/migrations/`.

---

## 1. Project identity

| Field   | Value                                                                |
| ------- | -------------------------------------------------------------------- |
| Name    | **MMMIS** — Military Mess Management Information System             |
| Owner   | Patricia (ZM-0001 / 106759, Administrator)                          |
| Goal    | Digitize a military mess bar while preserving paper-form terminology |
| Repo    | `C:\Users\PATRICIA\Desktop\Projects\mmmis`                          |
| Stack   | React 18 + TypeScript + Vite + Tailwind + Radix UI + Supabase       |
| Mode    | Build incrementally in numbered phases (per the guide's recommendation) |

### Tech stack (locked in)

- React 18 + TypeScript + Vite 5
- TailwindCSS + shadcn-style primitives (Radix UI)
- React Router v6, React Query v5, React Hook Form + Zod
- Supabase (Auth + PostgreSQL + RLS)
- `@react-pdf/renderer` (PDF output)
- `xlsx` (Excel export)
- `lucide-react` (icons), `date-fns` (dates), `clsx` + `tailwind-merge` (cn)

---

## 2. Supabase project (live)

| Param          | Value                                       |
| -------------- | ------------------------------------------- |
| URL            | `https://gkegnmshivmgqhenqkzr.supabase.co`  |
| Project ref    | `gkegnmshivmgqhenqkzr`                      |
| Anon key       | stored in `.env` (gitignored)               |
| Service role   | NOT stored in `.env`; never expose to client |

`.env` contents (URL + anon key only — service role MUST stay server-side):

```
VITE_SUPABASE_URL=https://gkegnmshivmgqhenqkzr.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdrZWdubXNoaXZtZ3FoZW5xa3pyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUwMDEwNTksImV4cCI6MjEwMDU3NzA1OX0.X7uzLGX6yqj8nggzhQFnJGj7hXa6hGc7UCYUlwdaVcw
```

---

## 3. Database migrations

| File                                | Purpose                                                       | Status                |
| ----------------------------------- | ------------------------------------------------------------- | --------------------- |
| `supabase/migrations/0001_init.sql` | Full schema (15 tables), RLS, helper functions, soft deletes  | ✅ Applied            |
| `supabase/migrations/0002_seed_default_catalog.sql` | 8 starter products (Castle, Black Label, Coke, Sprite, Fanta, Water 500ml/1L, Soda 1L) | ✅ Ready (idempotent) |
| `supabase/migrations/0004_anon_login_lookup.sql` | RLS policy fix that lets the anon role resolve `service_number` → email at login time | ✅ Applied            |
| `supabase/migrations/0005_products_name_unique.sql` | (Not committed yet) — run `alter table public.products add constraint products_name_unique unique (name);` if seeding on a fresh DB | ⚠️ Was added in-place; if you wipe the DB, also re-add this constraint before `0002_seed_default_catalog.sql` |

> Migration file numbers skip 0003 on purpose — leave it, never use it, to avoid
> renaming existing files. New migrations should be `0005_*`, `0006_*`, etc.

### Schema table reference

```
roles        (id 1..4, code/name/description)
users        (id, auth_id→auth.users, service_number UNIQUE, role_id→roles, soft delete)
members      (user_id→users, service_number, chit_balance, credit_limit, is_blacklisted)
products     (name, category, buying_price, selling_price, unit, opening_stock, minimum_stock, barcode, status)
stock_receipts       (product_id, received_by, quantity, supplier, invoice_number, unit_cost, received_at)
stock_sheet          (sheet_date, product_id, stock_bf, stock_rcv, total_stock GENERATED, allergy, sold, stock_cf, price, total GENERATED)
sales                (sale_date, sale_type∈{cash,chit}, barman_id, member_id, total_amount, payment_status)
sale_items           (sale_id, product_id, quantity, unit_price, line_total GENERATED)
chit_payments        (member_id, amount, payment_method∈{cash,payslip_deduction,manual_recovery}, received_by, paid_at, reference)
expenses             (expense_date, description, amount, released_by, purpose, remarks)
ledger               (member_id, txn_date, debit, payment, balance, source_type)
daily_summary        (cash_sales, chit_sales, chit_recovery, expenses, cash_at_hand_open/close, stock_value_close)
audit_logs           (actor, action, target_table, target_id, old_values, new_values, ip, user_agent, device)
settings             (key/value jsonb)
```

### Roles (seeded)

| id | code              | name           |
| -- | ----------------- | -------------- |
| 1  | administrator     | Administrator  |
| 2  | treasurer         | Treasurer      |
| 3  | barman            | Barman         |
| 4  | member            | Member         |

### RLS helper functions

- `public.current_role_code()` — returns the code of the current user.
- `public.is_administrator()`, `is_treasurer()`, `is_barman()`, `is_member()`.
- `public.is_staff()` — true for admin/treasurer/barman.

### Soft-delete convention

Every business table has `deleted_at timestamptz`. No `DELETE` statements —
all "deactivations" are `UPDATE … SET deleted_at = now()`. RLS policies and
queries filter with `is('deleted_at', null)`.

### Ledger trigger

```sql
create trigger trg_ledger_balance
before insert on public.ledger
for each row execute function public.apply_member_ledger();
```

Updates `balance` and propagates latest value to `members.chit_balance`. Wired
ready for Phase 4.

---

## 4. The first admin (working)

| Field          | Value                       |
| -------------- | --------------------------- |
| auth.users.id  | `d9b9702c-ece5-4088-8464-873703fa13d2` |
| service_number | `106759`                    |
| full_name      | `SGT TEMBO RICHARD`         |
| email          | `ritemda@gmail.com`         |
| role_id        | 1 (administrator)           |
| is_active      | true                        |
| public.users.id| `209dce67-9edd-4297-a97f-b37c53586778` |

**Login flow:** Service Number `106759` + password = the password set when
the auth user was created. Resolves to `ritemda@gmail.com` via the
`users_anon_login_lookup` RLS policy.

> If a future admin signing in fails: check `email_confirmed_at` on
> `auth.users`. If null, either click the confirmation email or turn off
> "Confirm email" in Auth → Providers → Email.

---

## 5. Project structure

```
mmmis/
├─ guide.txt                            ← original spec
├─ continuation_guide.md                ← THIS FILE
├─ README.md                            ← setup docs
├─ .env / .env.example                  ← Supabase URL + anon key
├─ package.json                         ← deps + scripts
├─ supabase/migrations/
│   ├─ 0001_init.sql
│   ├─ 0002_seed_default_catalog.sql
│   └─ 0004_anon_login_lookup.sql
└─ src/
   ├─ main.tsx, App.tsx, index.css
   ├─ components/
   │   ├─ layout/  AppShell.tsx, ThemeToggle.tsx
   │   └─ ui/      button, card, dialog, input, label, select, table, badge
   ├─ features/
   │   ├─ auth/      AuthContext.tsx, LoginPage.tsx, ForbiddenPage.tsx, guards.tsx
   │   ├─ users/     UsersPage.tsx, users.service.ts
   │   ├─ products/  ProductsPage.tsx, products.service.ts
   │   ├─ stock/     ReceiptsPage.tsx, receipts.service.ts,
   │   │             StockSheetPage.tsx, stockSheet.service.ts, StockSheetPDF.tsx,
   │   │             StockValuationPage.tsx, valuation.service.ts
   │   ├─ audit/     audit.ts (stub, server-side writes come in Phase 7)
   │   └─ dashboard/ DashboardPage.tsx (role-aware cards)
   ├─ lib/        supabase.ts, utils.ts (cn, formatCurrency, formatDateTime)
   └─ types/      database.placeholder.ts (regenerate later via `npm run db:types`)
```

### Commands

| Command            | What it does                              |
| ------------------ | ----------------------------------------- |
| `npm run dev`      | Vite dev server on `:5173`                |
| `npm run build`    | `tsc -b` + production build               |
| `npm run typecheck`| Type-check only (use this often)          |
| `npm run lint`     | ESLint                                    |
| `npm run db:types` | Regenerate `database.generated.ts`        |

After every code change, run `npm run typecheck` before claiming a phase done.

---

## 6. Phases

### ✅ Phase 1 — Auth + User Management (complete)

- Vite + React + TS + Tailwind + Radix scaffold.
- Login by Service Number + Password.
- Supabase Auth + typed AuthContext.
- `<ProtectedRoute allow={[...]}>` RBAC.
- Role-aware AppShell.
- User CRUD with create / edit / role / deactivate / password reset.
- Soft delete on `users`.
- All 15 tables, RLS, soft-delete, ledger trigger.

### ✅ Phase 2 — Stock Module + Products (complete)

- Products UI: list/search/create/edit/deactivate.
- Stock Receipts (Stock RCV) page.
- Daily Stock Sheet page with the EXACT paper-field names:
  `Stock BF`, `Stock RCV`, `Total Stock`, `Allergy`, `Sold`, `Stock CF`, `Price`, `Total`.
- Total Stock = BF + RCV (auto).
- Total = Sold × Price (auto).
- "Pull BF from yesterday" auto-fill.
- PDF export of stock sheet via `@react-pdf/renderer`.
- Stock Valuation report (latest Stock CF × buying price) + Excel export.
- 8 starter products seeded.

### ⏳ Phase 3 — Sales & CHIT (next)

- Barman Quick Sale (cash) — multi-line cart, decrement Stock CF, generate `sales` + `sale_items`.
- Barman Quick CHIT — search member by service number, multi-line cart, append `ledger` entry.
- Barman Closing Stock — link to the daily stock sheet's `stock_cf`.
- Barman Expense Entry (chair releases money).
- Barman Daily Summary (printable).
- Pin pad for member confirmation (service number + password).
- Audit log calls (client-side stub for now — server-side in Phase 7).

### ⏳ Phase 4 — Treasurer

- Daily Cash at Hand computation.
- CHIT Recovery (cash / payslip / manual) — reduces `members.chit_balance`.
- Expense management (full visibility + approval).
- Member management (extend profiles, set credit limits, blacklist).
- Statements.
- Outstanding CHIT report.

### ⏳ Phase 5 — Member Portal

- Member dashboard with own balance, recent purchases, recent payments.
- Statement view.
- Change password.

### ⏳ Phase 6 — Reporting

- Daily Sales, Daily Stock Sheet, CHIT, CHIT Recovery, Member Statement,
  Expense, Cash at Hand, P&L, Outstanding CHIT, Top Selling Products,
  Stock Valuation, Audit Log — all printable to PDF + Excel export.
- Recharts charts on dashboard.

### ⏳ Phase 7 — Administration

- Settings page.
- Real audit log endpoint (server-side) — `audit_logs` writes bypass RLS.
- Backup / restore.
- Database migration runner.

---

## 7. Important conventions

1. **Field naming is sacred.** The paper form's terms (Stock BF, Allergy, Sold, etc.) MUST NOT be renamed. UI labels show them exactly.
2. **Auto-calc columns** (`total_stock`, `total`) are GENERATED ALWAYS in the DB — never write them from the client.
3. **No delete.** Soft-delete via `deleted_at`. RLS always filters `is('deleted_at', null)`.
4. **Type everything.** Never `any`. Use `AppUserProfile`, `ProductRow`, `StockSheetRow`, etc. from each feature's `.service.ts`.
5. **Service files only.** Components render UI; business logic lives in `*.service.ts`.
6. **Reusable primitives.** Add to `src/components/ui/` rather than rolling your own.
7. **Audit every write.** Call `auditUserChange` (Phase 1) or the future `logAudit` helper in `src/features/audit/audit.ts`. Console.log until Phase 7.
8. **Migrations are versioned.** Use `0005_*`, `0006_*`, etc. Never rename existing files.
9. **Never store the service-role JWT in `.env` with the `VITE_` prefix.** It would be inlined into the browser bundle and bypass RLS for anyone.

---

## 8. Decisions log

- **Two-package separation chosen for service-role**: `.env` holds URL + anon; service-role stays only in server-side scripts reachable via `npm run` (not via Vite). Phase 7 will introduce a tiny Node helper for service-role operations.
- **PDF library**: `@react-pdf/renderer` (chosen for ergonomic layout of the paper-form-matching stock sheet).
- **Excel export**: `xlsx` (chosen for minimal bundle + good support for the reports use case).
- **Login flow**: Service Number → email lookup → `supabase.auth.signInWithPassword`. Required the `users_anon_login_lookup` RLS policy.
- **Stock Sheet UX**: Local edit state keyed by `product_id`; "Pull BF from yesterday" auto-fills `Stock BF` from the most recent `Stock CF`. PDF uses persisted rows when available, otherwise the in-memory draft.
- **Money**: `Intl.NumberFormat('en-ZM', { currency: 'ZMW' })` — Zambia Kwacha default. Currency comes from `settings.currency` in Phase 7.

---

## 9. Known gotchas

- **PostgREST 406 on `.single()`** means 0 rows matched. Always check the filter carefully (RLS hiding the row is the silent cause).
- **`useCreateUser` in `users.service.ts` calls `supabase.auth.signUp` from the client.** This requires email-confirmation to be off (or auto-confirm on) in the Supabase Dashboard, otherwise the follow-up insert into `public.users` will hit a half-logged-in state. Currently the recommended bootstrap path is to create the auth user via the Dashboard and then run the `insert into public.users` SQL shown in the README.
- **Supabase types not yet regenerated.** `src/types/database.placeholder.ts` is a hand-rolled type used at the auth/users boundary. Run `npm run db:types` after `supabase link` to replace with the official generated types.
- **The `last_login_at` self-update is silently dropped by RLS** for non-admin users. Cosmetic — login itself still works. Add `users_self_lastlogin` policy (a 0005 migration) when convenient.
- **`CREATE POLICY IF NOT EXISTS` is PG 15+.** On older Postgres (your Supabase project appears to be on PG 14) use `DROP POLICY IF EXISTS …` then `CREATE POLICY …`. See `0004_anon_login_lookup.sql`.
- **`products.name` must be unique** for the seed's `on conflict (name)` to work. The constraint is now part of `0001_init.sql` so fresh installs pick it up automatically — but on the live DB it was added in-place via `alter table`. If you wipe the DB, re-add before re-running the seed.

---

## 10. When you start a new session, paste this line to Claude:

> "Read `continuation_guide.md` in the project root to get full context,
> then continue from Phase X."

Then immediately say which phase you want to do next (or which bug to fix).
