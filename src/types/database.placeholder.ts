/**
 * Placeholder Database types.
 *
 * After your Supabase project is provisioned and the migration in
 * `supabase/migrations/0001_init.sql` has been applied, regenerate this
 * file with the official Supabase CLI command:
 *
 *   npx supabase gen types typescript --linked > src/types/database.generated.ts
 *
 * and replace this placeholder. Until then, the manual `AppRole` union below
 * keeps the app buildable and correctly typed at the boundary we touch in
 * Phase 1 (auth + user management).
 */

export type AppRoleCode = 'administrator' | 'treasurer' | 'barman' | 'member';

export interface AppUserProfile {
  id: string;
  auth_id: string | null;
  service_number: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role_id: number;
  role_code: AppRoleCode;
  role_name: string;
  rank: string | null;
  unit: string | null;
  is_active: boolean;
  must_reset_pw: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}
