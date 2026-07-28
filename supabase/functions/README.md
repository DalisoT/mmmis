# Supabase Edge Functions

This directory contains the deployed Edge Functions for MMMIS. The SPA
(`mmmis.vercel.app`) talks to these exclusively via
`supabase.functions.invoke('<name>')`.

## Functions

| Function | Purpose | Verify-JWT |
|---|---|---|
| `chit-authorize` | Buyer's phone authorizes a CHIT purchase (verifies the buyer's password, then calls `approve_chit_authorization()`). | off |
| `password-reset` | Generates a `recovery` link by service_number. Anonymous by design; always returns 200. Audits via service-role. | off |
| `create-user` | Admin-driven create-user. Resolves role, calls `auth.admin.createUser(email_confirm:true)`, inserts the `public.users` row, emails credentials via Mailgun, audits. | off |
| `admin-reset-password` | Admin-driven password reset. Generates 16-char temp, calls `updateUserById`, flips `must_reset_pw`, optionally emails via Mailgun. | off |
| `bulk-seed-members` | Bulk insert of member rows from an admin CSV upload. | — |
| `set-member-email` | Set a member's email on their auth.user (service-only). | — |

> **Note:** the standalone `invite-email` function that previously shipped
> here has been retired. New-user creation now flows exclusively through
> `create-user`. Branded Mailgun invite emails can be added to
> `create-user` later if/when you want to drop Supabase's default
> `supabase.io` invite template.

## Deploy

```bash
# One-time
supabase login
supabase link --project-ref <your-project-ref>

# Per-function
supabase functions deploy chit-authorize     --no-verify-jwt
supabase functions deploy password-reset     --no-verify-jwt
supabase functions deploy create-user        --no-verify-jwt
supabase functions deploy admin-reset-password --no-verify-jwt
supabase functions deploy bulk-seed-members
supabase functions deploy set-member-email

# Secrets (Mailgun, used by create-user / admin-reset-password).
# Without these the functions still deploy and respond, but the email
# step is skipped and create-user returns `temp_password` in its JSON.
supabase secrets set \
  APP_URL=https://mmmis.example.com \
  MAILGUN_API_KEY=key-xxxxxxxx \
  MAILGUN_DOMAIN=mg.example.com \
  MAIL_FROM="MMMIS <noreply@example.com>"
```

## Why `--no-verify-jwt` on auth-bearing functions

Each of `chit-authorize`, `password-reset`, `create-user`, and
`admin-reset-password` reads the caller's JWT itself (`auth.getUser()`
or by extracting it from `Authorization`) and then performs its own
authorization check (admin role, password ownership, etc.). Leaving
the gateway-level verify-JWT on would either reject legitimate calls
whose JWT is needed inside the handler (`chit-authorize` for the buyer)
or duplicate the admin check that's already inline. Toggling it OFF
matches what the gateway would have done, minus the duplication.

## Local development

```bash
# Any one of them, e.g.:
supabase functions serve chit-authorize --no-verify-jwt --env-file ./supabase/.env.local
```

The Deno entry points (`index.ts`) are intentionally annotated with
`// @ts-nocheck` so the Node-side `tsc --noEmit` does not fail on
`Deno`-only globals. The Vite build ignores everything under
`supabase/functions/`.
