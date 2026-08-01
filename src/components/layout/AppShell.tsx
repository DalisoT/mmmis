import { useMemo, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LogOut, ShieldCheck, Users, Package, Truck, ClipboardList, BarChart3,
  ShoppingCart, Activity, Wallet, Receipt, UserRound, Banknote, AlertTriangle,
  Calendar, ShoppingBag, IdCard, ScrollText, Settings as Cog, Menu, Search, TrendingDown, Database,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BrandMark } from '@/components/brand/BrandMark';
import { useAuth } from '@/features/auth/AuthContext';
import { ThemeToggle } from './ThemeToggle';
import { BottomTabBar, type TabBarItem } from './BottomTabBar';
import { NavDrawer } from './NavDrawer';
import { InstallBanner, UpdateBanner, OfflineIndicator } from '@/pwa/InstallBanner';
import { QueuePill } from '@/pwa/QueuePill';
import { useAutoPushSubscribe } from '@/pwa/usePushSubscription';
import { cn } from '@/lib/utils';
import { useIsBelow } from '@/hooks/useBreakpoint';
import type { AppRoleCode } from '@/types/database.placeholder';

interface NavItem {
  to: string;
  label: string;
  roles: AppRoleCode[];
  icon: React.ComponentType<{ className?: string }>;
}

const NAV: NavItem[] = [
  { to: '/',                       label: 'Dashboard',       roles: ['administrator','treasurer','barman','member'], icon: ShieldCheck },
  { to: '/pos',                    label: 'Point of Sale',   roles: ['administrator','treasurer','barman'],         icon: ShoppingCart },
  { to: '/daily-summary',          label: 'Daily Summary',   roles: ['administrator','treasurer','barman'],         icon: Activity },
  { to: '/products',               label: 'Products',        roles: ['administrator','treasurer','barman'],         icon: Package },
  { to: '/products/low-stock',     label: 'Low stock',       roles: ['administrator','treasurer','barman'],         icon: TrendingDown },
  { to: '/stock-receipts',         label: 'Stock Receipts',  roles: ['administrator','treasurer','barman'],         icon: Truck },
  { to: '/stock-sheet',            label: 'Daily Stock',     roles: ['administrator','treasurer','barman'],         icon: ClipboardList },
  { to: '/stock-valuation',        label: 'Stock Valuation', roles: ['administrator','treasurer'],                  icon: BarChart3 },
  { to: '/users',                  label: 'Users',           roles: ['administrator'],                              icon: Users },
  { to: '/outstanding-chit',       label: 'Outstanding CHIT',roles: ['administrator','treasurer'],                  icon: AlertTriangle },
  { to: '/chit-payments',          label: 'CHIT Payments',   roles: ['administrator','treasurer'],                  icon: Wallet },
  { to: '/expenses-admin',         label: 'Expenses',        roles: ['administrator','treasurer'],                  icon: Receipt },
  { to: '/members',                label: 'Members',         roles: ['administrator','treasurer'],                  icon: UserRound },
  { to: '/members-directory',      label: 'Directory',       roles: ['administrator','treasurer'],                  icon: Search },
  { to: '/cash-at-hand',           label: 'Cash at Hand',    roles: ['administrator','treasurer'],                  icon: Banknote },
  { to: '/reports/pnl',            label: 'Profit & Loss',   roles: ['administrator','treasurer'],                  icon: BarChart3 },
  { to: '/reports/cash-closing',   label: 'Cash Closing',    roles: ['administrator','treasurer','barman'],         icon: ClipboardList },
  { to: '/portal',                 label: 'My Mess',         roles: ['member'],                                     icon: IdCard },
  { to: '/portal/statement',       label: 'Statement',       roles: ['member'],                                     icon: Calendar },
  { to: '/portal/purchases',       label: 'Purchases',       roles: ['member'],                                     icon: ShoppingBag },
  { to: '/portal/payments',        label: 'Payments',        roles: ['member'],                                     icon: Wallet },
  { to: '/portal/profile',         label: 'Profile',         roles: ['member'],                                     icon: UserRound },
  { to: '/admin/audit',            label: 'Audit log',       roles: ['administrator'],                              icon: ScrollText },
  { to: '/admin/audit/summary',    label: 'Audit summary',   roles: ['administrator'],                              icon: BarChart3 },
  { to: '/admin/audit/export',     label: 'Audit export',    roles: ['administrator'],                              icon: ScrollText },
  { to: '/admin/backups',          label: 'Backup health',   roles: ['administrator','treasurer'],                  icon: Database },
  { to: '/admin/sessions',         label: 'Sessions',        roles: ['administrator'],                              icon: ShieldCheck },
  { to: '/admin/settings',         label: 'Settings',        roles: ['administrator'],                              icon: Cog },
  { to: '/security',               label: 'Security',        roles: ['administrator','treasurer','barman','member'], icon: ShieldCheck },
];

/**
 * Build the phone tab bar items.
 * The first 4 go directly on the bar; the rest become "More" overflow.
 */
function buildPhoneTabs(items: NavItem[], role: AppRoleCode): { primary: TabBarItem[]; overflow: TabBarItem[] } {
  const roleItems = items.filter((i) => i.roles.includes(role));
  // Curated order — surfaces the most-used ops routes first.
  const preferred = ['/', '/pos', '/daily-summary', '/products', '/products/low-stock', '/stock-sheet', '/outstanding-chit', '/chit-payments', '/members', '/members-directory', '/cash-at-hand', '/reports/pnl', '/reports/cash-closing', '/portal', '/portal/purchases', '/security', '/admin/audit'];
  const sorted = [...roleItems].sort((a, b) => {
    const ai = preferred.indexOf(a.to);
    const bi = preferred.indexOf(b.to);
    if (ai === -1 && bi === -1) return a.label.localeCompare(b.label);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  return { primary: sorted.slice(0, 4), overflow: sorted.slice(4) };
}

export function AppShell() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const isPhoneOrTablet = useIsBelow('lg');
  // Best-effort auto-subscribe to web push. Silent on failure — push
  // is a nice-to-have, not a blocker for the rest of the app.
  useAutoPushSubscribe();

  if (!user) return null;
  const items = NAV.filter((i) => i.roles.includes(user.role_code));
  const phoneTabs = useMemo(() => buildPhoneTabs(NAV, user.role_code), [user.role_code]);
  const tabItems: TabBarItem[] = items.map(({ to, label, icon }) => ({ to, label, icon }));

  const handleSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  // Desktop layout strategy (≥1024px): always use a vertical sidebar so the
  // 20+ nav items have room without overlapping the user block in the
  // header. The header stays clean (brand + theme + user + sign-out) at
  // every viewport — no horizontal nav bar to crowd or overflow.
  const showSidebar = !isPhoneOrTablet;
  const sidebarW = sidebarCollapsed ? 'lg:w-16' : 'lg:w-60';

  return (
    <div className="flex min-h-screen w-full flex-col bg-background">
      {/* Header — visible on all form factors. pt-[env(safe-area-inset-top)]
          keeps the bar below the iPhone notch / Dynamic Island when
          viewport-fit=cover is active. On desktop the header just shows
          brand + user block; the sidebar carries the navigation. */}
      <header
        className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/60 sm:gap-4 sm:px-4"
        style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 0px)' }}
      >
        {/* Hamburger (phone + tablet only) */}
        {isPhoneOrTablet && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation menu"
            className="h-11 w-11"
          >
            <Menu className="h-5 w-5" />
          </Button>
        )}

        {/* Sidebar collapse toggle (desktop only) — sits where the
            hamburger would on phone so layout stays consistent. */}
        {showSidebar && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarCollapsed((v) => !v)}
            aria-label={sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            aria-pressed={sidebarCollapsed}
            className="h-11 w-11 sm:h-10 sm:w-10"
          >
            <Menu className="h-5 w-5" />
          </Button>
        )}

        <div className="flex min-w-0 items-center gap-2 font-semibold">
          <BrandMark size="sm" />
          <span className="hidden sm:inline">MMMIS</span>
          <Badge variant="outline" className="ml-1 hidden md:inline">Military Mess MIS</Badge>
        </div>

        {/* Right-side: theme + user + sign-out */}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <ThemeToggle />
          <div className="hidden sm:block"><QueuePill /></div>
          <span className="hidden text-right text-xs sm:block">
            <div className="font-medium leading-tight">{user.full_name}</div>
            <div className="text-muted-foreground">{user.role_name}</div>
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleSignOut}
            aria-label="Sign out"
            className="h-11 w-11 sm:h-10 sm:w-10"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Body row: sidebar (≥lg) sits on the left, main content on the right.
          On phone/tablet the sidebar is hidden and the drawer + bottom bar
          are used. */}
      <div className="flex flex-1">
        {showSidebar && (
          <aside
            className={cn(
              'sticky top-14 z-20 hidden h-[calc(100vh-3.5rem)] shrink-0 flex-col border-r bg-background transition-[width] lg:flex',
              sidebarW
            )}
            aria-label="Section navigation"
          >
            <SidebarContent
              items={tabItems}
              collapsed={sidebarCollapsed}
            />
          </aside>
        )}

        {/* Main content — pb-20 on phone to clear the bottom tab bar.
            lg+: leave room for the sidebar. */}
        <main className={cn(
          'container flex-1 py-4 sm:py-6',
          'pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-6'
        )}>
          <Outlet />
        </main>
      </div>

      {/* Footer (desktop only) */}
      <footer className="hidden border-t px-4 py-3 text-center text-xs text-muted-foreground sm:block">
        MMMIS · {new Date().getFullYear()}
      </footer>

      {/* Phone bottom tab bar */}
      <BottomTabBar
        primary={phoneTabs.primary}
        overflow={phoneTabs.overflow}
        onOpenMenu={() => setDrawerOpen(true)}
      />

      {/* Phone + tablet drawer */}
      <NavDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        items={tabItems}
      />

      {/* PWA: offline indicator under the header, install/update banners
          floating above the bottom tab bar. */}
      <OfflineIndicator />
      <InstallBanner />
      <UpdateBanner />
    </div>
  );
}

// ---- Sidebar content (lg: 1024px+) ---------------------------------------

interface SidebarContentProps {
  items: TabBarItem[];
  collapsed: boolean;
}

function SidebarContent({ items, collapsed }: SidebarContentProps) {
  return (
    <nav className="flex-1 overflow-y-auto py-2">
      <ul className="space-y-0.5 px-2">
        {items.map((i) => (
          <li key={i.to}>
            <NavLink
              to={i.to}
              end={i.to === '/'}
              title={collapsed ? i.label : undefined}
              className={({ isActive }) =>
                cn(
                  'flex min-h-[40px] items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  collapsed && 'justify-center px-0',
                  isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )
              }
            >
              <i.icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span className="truncate">{i.label}</span>}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}