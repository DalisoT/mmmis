import { useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LogOut, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BrandMark } from '@/components/brand/BrandMark';
import { cn } from '@/lib/utils';
import { ThemeToggle } from './ThemeToggle';
import type { TabBarItem } from './BottomTabBar';
import { useAuth } from '@/features/auth/AuthContext';

interface NavDrawerProps {
  open: boolean;
  onClose: () => void;
  items: TabBarItem[];
}

/**
 * Slide-in drawer used for tablet (and phone "More").
 *
 * - Slides from the left, dimmed backdrop, traps focus while open.
 * - ESC closes it; the backdrop click also closes.
 * - Pinned to the left edge on phone, top of the layout on tablet.
 */
export function NavDrawer({ open, onClose, items }: NavDrawerProps) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    // Lock body scroll while open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  if (!user) return null;

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 transition-opacity',
        open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
      )}
      aria-hidden={!open}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <aside
        className={cn(
          'absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r bg-background shadow-xl transition-transform',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
      >
        <header className="flex h-14 items-center justify-between border-b px-4">
          <div className="flex items-center gap-2 font-semibold">
            <BrandMark size="sm" />
            <span>MMMIS</span>
            <Badge variant="outline" className="ml-1 hidden md:inline">Military Mess MIS</Badge>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close menu">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <div className="border-b px-4 py-3 text-sm">
          <div className="font-medium leading-tight">{user.full_name}</div>
          <div className="text-xs text-muted-foreground">{user.role_name}</div>
        </div>

        <nav className="flex-1 overflow-y-auto py-2">
          <ul className="space-y-0.5 px-2">
            {items.map((i) => (
              <li key={i.to}>
                <NavLink
                  to={i.to}
                  end={i.to === '/'}
                  onClick={onClose}
                  className={({ isActive }) =>
                    cn(
                      'flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                    )
                  }
                >
                  <i.icon className="h-4 w-4" />
                  <span>{i.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <footer className="border-t p-3">
          <Button variant="outline" className="w-full" onClick={handleSignOut}>
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
        </footer>
      </aside>
    </div>
  );
}
