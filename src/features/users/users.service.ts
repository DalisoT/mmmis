import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import type { AppRoleCode, AppUserProfile } from '@/types/database.placeholder';
import { auditUserChange } from '@/features/audit/audit';

export const ROLE_CODES: AppRoleCode[] = ['administrator', 'treasurer', 'barman', 'member'];

/** Fields the admin fills in for a new user. Password is optional — the
 *  Edge Function will auto-generate one (and email it) if blank. */
export const userFormSchema = z.object({
  service_number: z.string().min(2, 'Service number required'),
  full_name: z.string().min(2, 'Full name required'),
  email: z.string().email('Valid email required'),
  phone: z.string().optional(),
  role_code: z.enum(['administrator', 'treasurer', 'barman', 'member']),
  rank: z.string().optional(),
  unit: z.string().optional(),
  /** Optional. If empty, the server generates a 16-char temp password. */
  password: z
    .string()
    .min(8, 'Min 8 characters, or leave blank to auto-generate')
    .optional()
    .or(z.literal('')),
  must_reset_pw: z.boolean().default(true),
  is_active: z.boolean().default(true),
});
export type UserFormValues = z.infer<typeof userFormSchema>;

export const userUpdateSchema = z.object({
  full_name: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  rank: z.string().optional(),
  unit: z.string().optional(),
  role_code: z.enum(['administrator', 'treasurer', 'barman', 'member']).optional(),
  is_active: z.boolean().optional(),
  must_reset_pw: z.boolean().optional(),
});
export type UserUpdateValues = z.infer<typeof userUpdateSchema>;

export interface RoleRow {
  id: number;
  code: AppRoleCode;
  name: string;
}

export interface CreateUserResult {
  user_id: string;
  auth_id: string;
  mailed: boolean;
  mail_error: string | null;
  temp_password: string;
}

export interface ResetPasswordResult {
  mailed: boolean;
  temp_password: string;
}

export const userKeys = {
  all: ['users'] as const,
  list: () => [...userKeys.all, 'list'] as const,
  roles: () => [...userKeys.all, 'roles'] as const,
};

export function useUsers() {
  return useQuery({
    queryKey: userKeys.list(),
    queryFn: async (): Promise<AppUserProfile[]> => {
      const { data, error } = await supabase
        .from('users')
        .select(`
          id, auth_id, service_number, full_name, email, phone, role_id,
          rank, unit, is_active, must_reset_pw, last_login_at,
          created_at, updated_at,
          role:roles ( id, code, name )
        `)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (error) throw error;

      return (data ?? []).map((row) => {
        const r = row.role as unknown as { id: number; code: AppRoleCode; name: string } | Array<{ id: number; code: AppRoleCode; name: string }> | null;
        const roleObj = Array.isArray(r) ? r[0] : r;
        return {
          id: row.id,
          auth_id: row.auth_id,
          service_number: row.service_number,
          full_name: row.full_name,
          email: row.email,
          phone: row.phone,
          role_id: row.role_id,
          role_code: roleObj?.code ?? 'member',
          role_name: roleObj?.name ?? 'Member',
          rank: row.rank,
          unit: row.unit,
          is_active: row.is_active,
          must_reset_pw: row.must_reset_pw,
          last_login_at: row.last_login_at,
          created_at: row.created_at,
          updated_at: row.updated_at,
        } satisfies AppUserProfile;
      });
    },
  });
}

export function useRoles() {
  return useQuery({
    queryKey: userKeys.roles(),
    queryFn: async (): Promise<RoleRow[]> => {
      const { data, error } = await supabase
        .from('roles')
        .select('id, code, name')
        .order('id');
      if (error) throw error;
      return (data ?? []) as RoleRow[];
    },
    staleTime: Infinity,
  });
}

/**
 * Create a user via the create-user Edge Function. The function runs with
 * the service role, materialises both auth.users and public.users in one
 * round trip, generates (or accepts) a temp password, and emails the
 * credentials. We always return the temp password so the admin can hand it
 * over manually if SMTP is not configured.
 */
export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: UserFormValues): Promise<CreateUserResult> => {
      const { data, error } = await supabase.functions.invoke<CreateUserResult>(
        'create-user',
        {
          body: {
            service_number: values.service_number,
            email: values.email,
            full_name: values.full_name,
            phone: values.phone ?? null,
            rank: values.rank ?? null,
            unit: values.unit ?? null,
            role_code: values.role_code,
            password: values.password && values.password.length >= 8 ? values.password : undefined,
            must_reset_pw: values.must_reset_pw,
            is_active: values.is_active,
          },
        }
      );
      if (error) throw error;
      if (!data) throw new Error('create-user: no response');
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: userKeys.list() }),
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id: string; values: UserUpdateValues }) => {
      const patch: Record<string, unknown> = {};
      if (values.full_name !== undefined) patch.full_name = values.full_name;
      if (values.email !== undefined) patch.email = values.email;
      if (values.phone !== undefined) patch.phone = values.phone;
      if (values.rank !== undefined) patch.rank = values.rank;
      if (values.unit !== undefined) patch.unit = values.unit;
      if (values.is_active !== undefined) patch.is_active = values.is_active;
      if (values.must_reset_pw !== undefined) patch.must_reset_pw = values.must_reset_pw;

      if (values.role_code !== undefined) {
        const { data: role, error: roleErr } = await supabase
          .from('roles').select('id').eq('code', values.role_code).single();
        if (roleErr || !role) throw new Error('Invalid role');
        patch.role_id = role.id;
      }

      const { data, error } = await supabase
        .from('users').update(patch).eq('id', id).select('id').single();
      if (error) throw error;

      await auditUserChange('user.update', id, undefined, patch);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: userKeys.list() }),
  });
}

/** Admin-only: reset a user's password and email them a new temp password. */
export function useResetUserPassword() {
  return useMutation({
    mutationFn: async (userId: string): Promise<ResetPasswordResult> => {
      const { data, error } = await supabase.functions.invoke<ResetPasswordResult>(
        'admin-reset-password',
        { body: { user_id: userId, send_email: true } }
      );
      if (error) throw error;
      if (!data) throw new Error('admin-reset-password: no response');
      return data;
    },
  });
}

export function useDeactivateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from('users')
        .update({ is_active: false, deleted_at: new Date().toISOString() })
        .eq('id', id)
        .select('id')
        .single();
      if (error) throw error;
      await auditUserChange('user.deactivate', id);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: userKeys.list() }),
  });
}
