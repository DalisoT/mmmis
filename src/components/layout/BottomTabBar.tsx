import { NavLink, useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIsPhone } from '@/hooks/useBreakpoint';

export interface TabBarItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface BottomTabBarProps {
  primary: TabBarItem[];   // 1-5 items shown as tabs
  overflow: TabBarItem[];  // shown inside the "More" drawer
  onOpenMenu: () => void;
}

/**
 * Phone-only bottom tab bar.
 *
 * - Up to 5 primary items render as fixed tabs.
 * - If `overflow` is non-empty, the last visible slot becomes a "More"
 *   tab that opens a drawer (parent owns the open state).
 * - Hidden on tablet+ (the drawer / side nav takes over).
 */
export function BottomTabBar({ primary, overflow, onOpenMenu }: BottomTabBarProps) {
  const isPhone = useIsPhone();
  const location = useLocation();
  if (!isPhone) return null;

  // Determine if the current route is an overflow route — if so, the
  // "More" tab is active.
  const isOnOverflow = overflow.some((o) => location.pathname === o.to || location.pathname.startsWith(o.to + '/'));

  // Slice to 4 if we have overflow (so the last tab is "More").
  const visible = overflow.length > 0 ? primary.slice(0, 4) : primary.slice(0, 5);

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label="Primary"
    >
      <ul className="grid grid-flow-col auto-cols-fr">
        {visible.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex h-14 min-h-[44px] flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium transition-colors',
                  isActive
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                )
              }
            >
              <item.icon className="h-5 w-5" />
              <span className="truncate max-w-full">{item.label}</span>
            </NavLink>
          </li>
        ))}
        {overflow.length > 0 && (
          <li>
            <button
              type="button"
              onClick={onOpenMenu}
              className={cn(
                'flex h-14 min-h-[44px] w-full flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium transition-colors',
                isOnOverflow
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              aria-label="More navigation items"
            >
              <Menu className="h-5 w-5" />
              <span>More</span>
            </button>
          </li>
        )}
      </ul>
    </nav>
  );
}
