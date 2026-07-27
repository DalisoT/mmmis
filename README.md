# MMMIS — Military Mess Management Information System

A modern web application that digitizes a military mess bar's daily operations
(Stock Sheet, CHIT, CHIT Recovery, Ledger, Expenses, Reports, Audit) while
preserving the existing paper workflow and terminology.

> **Status:** **Phase 1 — Authentication + User Management.**
> Phases 2–7 (Stock, Sales & CHIT, Treasurer, Member Portal, Reporting, Admin)
> will follow the same approach. See `guide.txt` for the full spec.

---

## Tech stack

| Layer            | Choice                                                    |
| ---------------- | --------------------------------------------------------- |
| Frontend         | React 18 + TypeScript + Vite                              |
| Styling          | TailwindCSS + shadcn-style primitives (Radix UI)          |
| Forms / schema   | React Hook Form + Zod                                     |
| Data fetching    | TanStack Query                                            |
| Auth / DB / RLS  | Supabase Auth + PostgreSQL                                |
| Charts           | Recharts                                                  |
| PDF / Excel      | Added in Phase 6                                          |

---

## Folder structure

```
mmmis/
├─ supabase/
│  └─ migrations/
│     └─ 0001_init.sql          ← initial schema, roles, RLS
├─ src/
│  ├─ components/
│  │  ├─ layout/                ← AppShell, ThemeToggle
│  │  └─ ui/                    ← button, card, dialog, input, ...
│  ├─ features/
│  │  ├─ auth/                  ← LoginPage, AuthContext, guards
│  │  ├─ users/                 ← UsersPage + users.service
│  │  ├─ dashboard/             ← DashboardPage (role-aware)
│  │  └─ audit/                 ← audit log helpers
│  ├─ lib/                      ← supabase client, utils
│  └─ types/                    ← app types (DB types regenerated later)
├─ index.html
└─ package.json
```

---

## Getting started

### 1. Provision a Supabase project

1. Go to <https://supabase.com/dashboard> and create a project.
2. Note your **Project URL** and **anon public key** from
   _Project Settings → API_.
3. Open the **SQL Editor** in the dashboard, paste the contents of
   [`supabase/migrations/0001_init.sql`](./supabase/migrations/0001_init.sql),
   and click **Run**. This creates all tables, RLS policies, helper
   functions, and seeds the four roles.
4. In _Authentication → Providers_, ensure **Email** is enabled.

### 2. Configure environment variables

```bash
cp .env.example .env
```

Fill in your values:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

### 3. Install + run

```bash
npm install
npm run dev
```

Visit <http://localhost:5173>.

### 4. Create the first administrator

Because signup is closed by default, use the SQL Editor to provision your
first admin user:

```sql
-- 1) Create the auth account via Supabase Dashboard:
--    Authentication → Users → Add user (email + password)
--    Copy the generated UUID ("auth.users.id")

-- 2) Link it to public.users with the administrator role
insert into public.users (auth_id, service_number, full_name, email, role_id, is_active)
values (
  '00000000-0000-0000-0000-000000000000', -- replace with auth.users.id
  'ZM-00001',
  'Initial Administrator',
  'admin@example.com',
  1,                                       -- administrator role_id
  true
);
```

Sign in at `/login` using `ZM-00001` + the password you created.

After that, normal user creation is done from **Dashboard → Users → New User**,
which provisions both an `auth.users` row (via Supabase Auth) and a
`public.users` profile.

---

## What's implemented in Phase 1

- [x] Vite + React 18 + TypeScript + Tailwind + Radix UI
- [x] Dark / light theme toggle with persistence
- [x] Supabase client + typed AuthContext
- [x] Login with **Service Number + Password**
- [x] JWT-based session, persisted, auto-refreshed
- [x] Role-based `<ProtectedRoute>` guards
- [x] Role-aware shell (Admin sees "Users"; Treasurer/Barman/Member do not)
- [x] User Management UI (list, search, create, edit, deactivate, role change)
- [x] Soft-delete flag on `users` (deleted rows are never removed)
- [x] RLS policies for all four roles on every table
- [x] Generated `roles` table and seed data
- [x] Stubbed audit helpers (real server-side writes land in Phase 7)
- [x] README and `.env.example`

## What's deliberately NOT yet implemented (later phases)

| Phase | Module                                         |
| ----- | ---------------------------------------------- |
| 2     | Stock Module + products                        |
| 3     | Sales & CHIT (barman workflow)                 |
| 4     | Treasurer: CHIT recovery, expenses, ledger     |
| 5     | Member Portal                                  |
| 6     | Reports (PDF + Excel export)                   |
| 7     | Admin settings, real audit server endpoint     |

---

## Conventions

- **Strong typing**: no `any`. Boundary types live in `src/types/`.
- **Feature folders**: each feature owns its UI, service hooks, and types.
- **No business logic in components** — service files only.
- **Auditable writes**: any user-management mutation calls
  `auditUserChange` so that user actions are observable from day one.
  A real server-side append to `audit_logs` ships in Phase 7.

---

## Scripts

| Command            | Description                                       |
| ------------------ | ------------------------------------------------- |
| `npm run dev`      | Start Vite dev server                             |
| `npm run build`    | Type-check (`tsc -b`) + production build           |
| `npm run preview`  | Preview the production build                      |
| `npm run typecheck`| Type-check only                                   |
| `npm run lint`     | ESLint                                            |
| `npm run db:types` | Regenerate `database.generated.ts` from Supabase  |
