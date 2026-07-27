import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { AppUserProfile, AppRoleCode } from '@/types/database.placeholder';

interface AuthContextValue {
  session: Session | null;
  user: AppUserProfile | null;
  role: AppRoleCode | null;
  loading: boolean;
  signIn: (serviceNumber: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function fetchProfile(authId: string): Promise<AppUserProfile | null> {
  const { data, error } = await supabase
    .from('users')
    .select(`
      id, auth_id, service_number, full_name, email, phone, role_id,
      rank, unit, is_active, must_reset_pw, last_login_at,
      created_at, updated_at,
      role:roles ( code, name )
    `)
    .eq('auth_id', authId)
    .is('deleted_at', null)
    .single();

  if (error || !data) return null;

  // Supabase returns joined relation as either an object or array depending on cardinality.
  const roleRel = data.role as unknown as { code: AppRoleCode; name: string } | Array<{ code: AppRoleCode; name: string }> | null;
  const roleObj = Array.isArray(roleRel) ? roleRel[0] : roleRel;

  return {
    id: data.id,
    auth_id: data.auth_id,
    service_number: data.service_number,
    full_name: data.full_name,
    email: data.email,
    phone: data.phone,
    role_id: data.role_id,
    role_code: roleObj?.code ?? 'member',
    role_name: roleObj?.name ?? 'Member',
    rank: data.rank,
    unit: data.unit,
    is_active: data.is_active,
    must_reset_pw: data.must_reset_pw,
    last_login_at: data.last_login_at,
    created_at: data.created_at,
    updated_at: data.updated_at,
  } satisfies AppUserProfile;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<AppUserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    if (!session?.user.id) {
      setUser(null);
      return;
    }
    const profile = await fetchProfile(session.user.id);
    setUser(profile);
  }, [session?.user.id]);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      if (data.session?.user.id) {
        const profile = await fetchProfile(data.session.user.id);
        if (mounted) setUser(profile);
      }
      if (mounted) setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession?.user.id) {
        void fetchProfile(newSession.user.id).then(setUser);
      } else {
        setUser(null);
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback<AuthContextValue['signIn']>(async (serviceNumber, password) => {
    const trimmed = serviceNumber.trim();
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : null;

    // 1. Lockout check via SECURITY DEFINER RPC (5 fails / 15 min).
    const { data: locked, error: lockErr } = await supabase.rpc('is_service_locked', {
      p_service_number: trimmed,
    });
    if (!lockErr && locked === true) {
      await supabase.from('login_attempts').insert({
        service_number: trimmed,
        success: false,
        failure_reason: 'locked_out',
        user_agent: userAgent,
      });
      return { error: 'Too many failed attempts. Try again in 15 minutes or contact the administrator.' };
    }

    // 2. The login identifier is the service_number, but Supabase Auth signs
    //    users in by email. We resolve service_number -> email first via
    //    the SECURITY DEFINER RPC introduced by migration 0016. This RPC
    //    is the only anon-callable path after the lockdown; the public
    //    `users` table no longer has an anon SELECT policy.
    const { data: lookupEmail, error: lookupErr } = await supabase.rpc(
      'lookup_email_by_service_number',
      { p_service_number: trimmed }
    );

    if (lookupErr || !lookupEmail) {
      await supabase.from('login_attempts').insert({
        service_number: trimmed,
        success: false,
        failure_reason: 'unknown_user',
        user_agent: userAgent,
      });
      return { error: 'Invalid service number or password.' };
    }

    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: lookupEmail,
      password,
    });

    if (signInErr) {
      await supabase.from('login_attempts').insert({
        service_number: trimmed,
        success: false,
        failure_reason: signInErr.message,
        user_agent: userAgent,
      });
      return { error: signInErr.message };
    }

    await supabase.from('login_attempts').insert({
      service_number: trimmed,
      success: true,
      user_agent: userAgent,
    });

    // Best-effort stamp the last_login_at (no RLS issue since users table
    // allows self-read; admin-only writes are also allowed).
    await supabase
      .from('users')
      .update({ last_login_at: new Date().toISOString() })
      .eq('service_number', trimmed);

    return { error: null };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
    setUser(null);
  }, []);

  const value: AuthContextValue = {
    session,
    user,
    role: user?.role_code ?? null,
    loading,
    signIn,
    signOut,
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
