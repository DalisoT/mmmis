# Supabase Edge Functions

Phase 8 ships two Edge Functions that replace the default Supabase email
templates with MMMIS-branded ones.

## `invite-email`
Sends an invite to a new staff member (administrator only).

- **Trigger:** POST from the Users page (`/users`) on row creation.
- **Auth:** the caller's JWT must resolve to a `public.users.role.code = 'administrator'`.
- **Side effect:** calls `auth.admin.inviteUserByEmail` and writes a `user.create`
  audit row via the `log_audit_event` RPC.

## `password-reset`
Generates a recovery link for a member who forgot their password.

- **Trigger:** POST from a future "Forgot password" form (Phase 9+).
- **Auth:** none — anonymous by design, but always returns 200 to avoid
  leaking whether the service_number exists.
- **Side effect:** calls `auth.admin.generateLink({ type: 'recovery' })`
  and writes an `auth.password_reset` audit row.

## Deploy

```bash
# One-time
supabase login
supabase link --project-ref <your-project-ref>

# Deploy both
supabase functions deploy invite-email --no-verify-jwt
supabase functions deploy password-reset --no-verify-jwt

# Required secrets
supabase secrets set \
  APP_URL=https://mmmis.example.com
# invite-email also needs MAIL_* secrets if you route the mail through
# an SMTP provider rather than Supabase's built-in SMTP.
```

## Local development

```bash
supabase functions serve invite-email --no-verify-jwt --env-file ./supabase/.env.local
```

The Deno entry point (`index.ts`) is intentionally type-annotated with
`// @ts-nocheck` so the Node-side `tsc --noEmit` does not fail on
`Deno`-only globals. The Vite build ignores everything under
`supabase/functions/`.