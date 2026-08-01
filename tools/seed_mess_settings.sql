-- tools/seed_mess_settings.sql
-- One-off seed for the singleton mess_settings row the app assumes exists.
-- The Settings page queries WHERE id = 1 and .single()s, which fails with
-- PGRST116 (406 Not Acceptable) when the row is missing.
--
-- Run in Supabase SQL editor on project gkegnmshivmgqhenqkzr.
-- Safe to re-run (ON CONFLICT DO NOTHING).

INSERT INTO mess_settings (
  id,
  opening_float,
  recovery_target_pct,
  vat_pct,
  holiday_mode,
  mess_name,
  currency_code
)
VALUES (
  1,
  0,
  30,
  0,
  false,
  'Officers Mess',
  'ZMW'
)
ON CONFLICT (id) DO NOTHING;
