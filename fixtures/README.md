# fixtures/

Reference data that is safe to commit. These files contain no credentials and
no personally identifying information beyond the rank/name pairs the unit
publishes on its roster.

## bulk_members_template.csv

A blank template for the bulk-seed Edge Function (`bulk-seed-members`).

| Column          | Required | Notes                                              |
|-----------------|----------|----------------------------------------------------|
| `service_number`| Yes      | Numeric or hyphenated string. Unique.             |
| `rank`          | Yes      | Free text — any value the unit recognises.         |
| `name`          | Yes      | Member's surname + initials, in any format.        |
| `salutation`    | No       | Optional. `MR`, `MRS`, etc. — used in receipts.    |
| `email`         | No       | Optional. Empty = `<service-number>@mess.zm.local` |

Regenerate this template when the column schema of `bulk-seed-members`
changes (see `supabase/functions/bulk-seed-members/index.ts`).

## What is NOT in fixtures/

These artefacts contain plaintext temp passwords and must never be committed:

- `__seed_realrun.json` — last output of `bulk-seed-members` (ignored via
  `.gitignore`).
- `bulk_member_passwords.md` — credentials list given to members on first
  sign-in (ignored via `.gitignore`).
- Any `*.dump`, `*.dump.tmp`, `*.dump.sha256` — logical backups created by
  `docs/BACKUP_RESTORE.md` (ignored via `.gitignore`).