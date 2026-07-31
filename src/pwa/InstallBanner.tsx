/**
 * Install + update banners.
 *
 * Two small floating cards rendered at the bottom of the app shell:
 *
 *  - <InstallBanner /> — appears when the browser fires `beforeinstallprompt`
 *    and the app is NOT already installed. The user can install with one
 *    tap, or dismiss. The "dismissed" flag is remembered for 14 days so
 *    we don't pester.
 *
 *  - <UpdateBanner /> — appears when a new service worker is waiting to
 *    take over. The "update" action triggers `skipWaiting()` + reload so
 *    the user gets the fresh shell immediately.
 *
 * Both banners sit above the phone bottom-tab bar (z-50) and below the
 * modal layer. They are role-agnostic — every user benefits from
 * installing the app or updating to the latest build.
 */
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, RefreshCw, X, WifiOff } from 'lucide-react';
import { toast } from '@/lib/toast';
import { usePWAStatus } from './usePWAStatus';

const INSTALL_DISMISS_KEY = 'mmmis:pwa-install-dismissed-at';
const DISMISS_DAYS = 14;

function dismissedRecently(): boolean {
  try {
    const raw = localStorage.getItem(INSTALL_DISMISS_KEY);
    if (!raw) return false;
    const at = Number(raw);
    if (!Number.isFinite(at)) return false;
    return Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

function markDismissed() {
  try {
    localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now()));
  } catch {
    // ignore — private mode, quota, etc.
  }
}

export function InstallBanner() {
  const { canInstall, promptInstall, isInstalled } = usePWAStatus();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (canInstall && !isInstalled && !dismissedRecently()) setVisible(true);
    else setVisible(false);
  }, [canInstall, isInstalled]);

  if (!visible) return null;

  const dismiss = () => {
    markDismissed();
    setVisible(false);
  };

  const install = async () => {
    const accepted = await promptInstall();
    if (accepted) {
      toast.success('Installing MMMIS…');
      setVisible(false);
    } else {
      // User said no — still mark dismissed so we don't ask again immediately.
      dismiss();
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Install MMMIS"
      className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 mx-auto max-w-md rounded-lg border bg-background/95 p-3 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:bottom-4"
    >
      <div className="flex items-start gap-3">
        <Download className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Install MMMIS</p>
          <p className="text-xs text-muted-foreground">
            Add to your home screen for one-tap access, offline POS, and full-screen use.
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={dismiss} aria-label="Dismiss">
          <X className="mr-1 h-3 w-3" /> Not now
        </Button>
        <Button size="sm" onClick={install}>
          <Download className="mr-1 h-3 w-3" /> Install
        </Button>
      </div>
    </div>
  );
}

export function UpdateBanner() {
  const { updateReady, applyUpdate } = usePWAStatus();
  if (!updateReady) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 mx-auto max-w-md rounded-lg border bg-background/95 p-3 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:bottom-4"
    >
      <div className="flex items-start gap-3">
        <RefreshCw className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Update available</p>
          <p className="text-xs text-muted-foreground">
            A new version of MMMIS is ready. Refresh to apply.
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <Button size="sm" onClick={() => applyUpdate()}>
          <RefreshCw className="mr-1 h-3 w-3" /> Refresh
        </Button>
      </div>
    </div>
  );
}

/**
 * Offline indicator. Tiny pill at the top of the viewport that appears
 * whenever the browser reports `navigator.onLine === false`. Stays out
 * of the way on desktop but is impossible to miss on phone.
 */
export function OfflineIndicator() {
  const { online } = usePWAStatus();
  if (online) return null;
  return (
    <div
      role="status"
      aria-live="assertive"
      className="sticky top-14 z-30 flex items-center justify-center gap-2 border-b bg-amber-500/95 px-3 py-1.5 text-xs font-medium text-amber-950 backdrop-blur"
      style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 0px)' }}
    >
      <WifiOff className="h-3 w-3" />
      You're offline — sales will be queued and synced when connection returns.
    </div>
  );
}