import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import type { AppRoleCode } from '@/types/database.placeholder';

interface ProtectedRouteProps {
  children: ReactNode;
  /** Allowed roles. If omitted, any authenticated user passes. */
  allow?: AppRoleCode[];
}

/**
 * Route guard.
 *  - Unauthenticated users → /login.
 *  - Authenticated users whose `must_reset_pw` flag is set → /reset-password
 *    (the only place that lets them set a password without typing the
 *    current one, which they may have just received as a temp from an
 *    admin or a recovery email).
 *  - Authenticated but unauthorized role → /forbidden.
 */
export function ProtectedRoute({ children, allow }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // Force a password change before granting access to anything else.
  // The /reset-password route itself sits OUTSIDE this ProtectedRoute,
  // so the user can land there and submit a new password.
  if (user.must_reset_pw) {
    return <Navigate to="/reset-password" replace />;
  }

  if (allow && !allow.includes(user.role_code)) {
    return <Navigate to="/forbidden" replace />;
  }

  return <>{children}</>;
}
