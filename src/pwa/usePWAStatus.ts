/**
 * PWA status hook.
 *
 * Surfaces the bits of the PWA lifecycle that the UI cares about:
 *
 *  - Whether the service worker has just installed a new build (we toast
 *    "Update available — refresh" so users know to reload).
 *  - Whether the app is installable (i.e. the browser has fired
 *    `beforeinstallprompt`). Captured once and replayed via the helper
 *    `promptInstall()`.
 *  - Whether the app is currently running in installed (standalone) mode.
 *    Useful for hiding the install banner.
 *
 * Uses `workbox-window`'s `Workbox` because it handles the update /
 * waiting / controlling SW lifecycle correctly (including waiting SKs to
 * activate on first navigation), which the raw `navigator.serviceWorker`
 * API gets wrong more often than not.
 */
import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export interface PWAStatus {
  /** True once a new SW is installed and waiting to take over. */
  updateReady: boolean;
  /** Tell the waiting SW to skip waiting and reload the page. */
  applyUpdate: () => void;
  /** True when the browser has offered (or could offer) the install prompt. */
  canInstall: boolean;
  /** Fire the native install prompt. Resolves true if the user accepted. */
  promptInstall: () => Promise<boolean>;
  /** True when the app is already installed (display-mode: standalone). */
  isInstalled: boolean;
  /** True while we have network connectivity (navigator.onLine). */
  online: boolean;
}

let capturedPrompt: BeforeInstallPromptEvent | null = null;

export function usePWAStatus(): PWAStatus {
  const [updateReady, setUpdateReady] = useState(false);
  const [canInstall, setCanInstall] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [online, setOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [applyUpdateFn, setApplyUpdateFn] = useState<() => void>(() => () => undefined);

  useEffect(() => {
    // "Installed" detection — works for A2HS on iOS Safari (window.navigator
    // .standalone) and the Chrome/Android standalone display-mode.
    const standaloneMQ = window.matchMedia('(display-mode: standalone)');
    const computeInstalled = () =>
      standaloneMQ.matches ||
      // @ts-expect-error iOS Safari-only property
      window.navigator.standalone === true;
    setIsInstalled(computeInstalled());
    const onDisplayChange = () => setIsInstalled(computeInstalled());
    standaloneMQ.addEventListener?.('change', onDisplayChange);

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      capturedPrompt = e as BeforeInstallPromptEvent;
      setCanInstall(true);
    };
    const onAppInstalled = () => {
      capturedPrompt = null;
      setCanInstall(false);
      setIsInstalled(true);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onAppInstalled);

    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    // Wire up the Workbox lifecycle if the plugin registered `window.workbox`.
    // `vite-plugin-pwa` exposes it via the workbox-window helper we import
    // for type-safety only — it sets `workbox` on the global at runtime.
    const w = (window as unknown as { workbox?: { addEventListener: (e: string, fn: (data: unknown) => void) => void; messageSkipWaiting: () => void; register: () => Promise<void> } }).workbox;
    let cleanupWorkbox: (() => void) | undefined;
    if (w) {
      const onWaiting = () => {
        setUpdateReady(true);
        setApplyUpdateFn(() => () => {
          w.messageSkipWaiting();
          // Reload once the new SW takes control so the user sees the
          // fresh shell without a manual refresh.
          navigator.serviceWorker.addEventListener(
            'controllerchange',
            () => window.location.reload(),
            { once: true }
          );
        });
      };
      const onControlling = () => {
        setUpdateReady(false);
      };
      w.addEventListener('waiting', onWaiting);
      w.addEventListener('controlling', onControlling);
      // If the SW is already waiting by the time we load (common after
      // a fast refresh during dev where HMR didn't run), reflect it now.
      w.register().catch(() => undefined);
      cleanupWorkbox = () => {
        // Workbox doesn't expose removeEventListener on the instance in
        // the same shape; we just rely on the singleton living for the
        // app lifetime and accept that on full reload it re-binds.
      };
    }

    return () => {
      standaloneMQ.removeEventListener?.('change', onDisplayChange);
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onAppInstalled);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      cleanupWorkbox?.();
    };
  }, []);

  return {
    updateReady,
    applyUpdate: applyUpdateFn,
    canInstall,
    promptInstall: async () => {
      if (!capturedPrompt) return false;
      await capturedPrompt.prompt();
      const choice = await capturedPrompt.userChoice;
      // After prompting once the event is consumed — never reuse.
      capturedPrompt = null;
      setCanInstall(false);
      return choice.outcome === 'accepted';
    },
    isInstalled,
    online,
  };
}