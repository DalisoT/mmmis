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
 * Route guard. Unauthenticated users are redirected to /login.
 * Authenticated-but-unauthorized users are redirected to /forbidden.
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

  if (allow && !allow.includes(user.role_code)) {
    return <Navigate to="/forbidden" replace />;
  }

  return <>{children}</>;
}
