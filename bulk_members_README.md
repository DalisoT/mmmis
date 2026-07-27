# Bulk Member Seeding

One-shot admin path to onboard many mess members at once. Two pieces:

- `supabase/migrations/0023_bulk_member_seed.sql` — staging table + name-parsing
  helper + admin-only clear RPC. **Extends** the existing
  `fn_handle_new_auth_user()` trigger (from migration 0015) so it also fires
  on `raw_user_meta_data->>'bulk_seed' = '1'` and materialises
  `public.users` + `public.members` for admin-driven onboarding.
- `supabase/functions/bulk-seed-members/index.ts` — Edge Function that uses
  the service-role key to create `auth.users` rows in a loop, then the
  trigger does the rest.

## Workflow

### 1. Apply the migration

In the Supabase SQL Editor:

```sql
-- paste contents of supabase/migrations/0023_bulk_member_seed.sql
```

### 2. Deploy the Edge Function

```bash
supabase functions deploy bulk-seed-members --no-verify-jwt
```

### 3. (Optional) Set the placeholder email domain

By default, rows with a blank `email` get the placeholder `<service_no>@mess.zm.local`.
To change the domain set a secret before deploying:

```bash
supabase secrets set PLACEHOLDER_EMAIL_DOMAIN=mess.yourunit.mil
```

### 4. Fill the CSV

`bulk_members_template.csv` has the 45 service numbers, ranks, and names
pre-filled. The columns you may fill before running:

| column        | required | meaning                                              | example           |
| ------------- | -------- | ---------------------------------------------------- | ----------------- |
| `salutation`  | no       | `MR` / `MRS` / `MS` / `DR` — controls name preview   | `MR`              |
| `email`       | no       | real email (must be unique); blank = placeholder used | `lt.kabonde@zm.mil`|

**You can leave both blank for every row.** Members can sign in with the
service number and the temp password you hand out, then set their real email
from `/portal/profile` on first login.

### 5. Load the staging table

In the SQL Editor:

```sql
truncate table public.bulk_member_seed;

copy public.bulk_member_seed (service_number, rank, name, salutation, email)
from 'C:/Users/.../bulk_members_filled.csv'
with (format csv, header true);
```

Or, if you have the CSV inline:

```sql
insert into public.bulk_member_seed (service_number, rank, name, salutation, email) values
  ('5083', 'LT',     'H M KABONDE', '',  ''),
  ('5337', '2ND LT', 'R CHANNAH',   '',  ''),
  -- ... etc
;
```

### 6. Dry-run

```bash
curl -X POST \
  'https://<project-ref>.supabase.co/functions/v1/bulk-seed-members' \
  -H "Authorization: Bearer <ADMIN_JWT>" \
  -H 'Content-Type: application/json' \
  -d '{"dry_run": true}'
```

Returns a JSON report. Each preview entry shows the parsed first/last name,
the email that *would* be used (`email_to_use`), and whether that email is
a placeholder (`email_was_placeholder: true`). No writes happen.

### 7. Real run

When the dry-run is clean:

```bash
curl -X POST \
  'https://<project-ref>.supabase.co/functions/v1/bulk-seed-members' \
  -H "Authorization: Bearer <ADMIN_JWT>" \
  -H 'Content-Type: application/json' \
  -d '{"dry_run": false, "send_email": false}'
```

Returns:

```json
{
  "ok": true,
  "dry_run": false,
  "total": 45,
  "seeded": 45,
  "skipped": 0,
  "failed": 0,
  "credentials": [
    { "service_number": "5083", "email": "5083@mess.zm.local", "temp_password": "...", "placeholder_email": true },
    ...
  ],
  "errors": []
}
```

`send_email: true` sends the temp password through Mailgun if
`MAILGUN_API_KEY` / `MAILGUN_DOMAIN` are configured as Edge Function secrets.
The function **skips** email for placeholder rows — there's nothing to
deliver to a fake domain.

For the 45-member seed run, plan to read the temp passwords from the
`credentials` array and hand each member a slip with:

```
Service number : 5083
Temporary PIN  : Ab3$...Zx9!
Sign in at     : https://<app>/login
Then go to     : Profile  ->  set your real email + new password
```

### 8. Members sign in

Each member signs in at `/login` with:

- **Service number** — what they type is the same `service_number` they
  appear under in the members directory; the client calls
  `lookup_email_by_service_number` (RPC from migration 0016) to resolve to
  their email internally. If their account was created with a placeholder
  email, that placeholder is what `auth.signInWithPassword` actually uses;
  the member never has to know the placeholder.
- **Temp password** — from the slip.
- They are forced to set a new password on first sign-in
  (`must_reset_pw=true`).

### 9. Members set their real email (later)

Once a member has signed in and changed their password, they can post
their real email to the `set-member-email` Edge Function:

```bash
curl -X POST \
  'https://<project-ref>.supabase.co/functions/v1/set-member-email' \
  -H "Authorization: Bearer <MEMBER_JWT>" \
  -H 'Content-Type: application/json' \
  -d '{"email": "lt.kabonde@zm.mil"}'
```

Deploy it with:

```bash
supabase functions deploy set-member-email --no-verify-jwt
```

The function uses the service-role key to write both `auth.users.email`
(without sending a confirmation link — `email_confirm: true`) and
`public.users.email`, plus an audit row. Members can only target their
own account; administrators can target any account (recovery path).

## Idempotency and edge cases

- A duplicate active `service_number` is reported as `failed` (the partial
  unique index from migration 0020 still blocks re-seeding an active row).
- A deactivated/soft-deleted `service_number` is **not** in the unique
  index, so it can be re-seeded.
- An email already present in `auth.users` is reported as `failed` with
  the underlying error (`A user with this email address has already been
  registered`). Either reuse the existing account or use a different
  email. Placeholder emails never collide because they are derived from
  the unique service_number.
- The staging table is wiped (`bulk_member_seed_clear`) after a successful
  run; on a failed run the rows are stamped `status='failed'` and left in
  place for inspection.

## Reverting

The migration is reversible by deleting the function bodies and dropping the
staging table. Note that the `fn_handle_new_auth_user()`
change keeps self-registration (`self_register='1'`) working exactly as
before, so reverting the staging table does not affect member sign-up.
