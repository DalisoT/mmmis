// Register the service worker shipped at /sw.js (see public/sw.js).
//
// We only register in production builds:
//   * in dev, Vite's HMR fights with any SW caching the bundles;
//   * this keeps the dependency on `serviceWorker` leniently typed
//     without ever crashing the dev console.
//
// On first install, the SW will precache the app shell on its own.

export function registerServiceWorker(): void {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  // Vite injects this constant; it's `true` only for `vite build` output.
  if (!import.meta.env.PROD) return;

  // Defer until the window has finished loading so we don't compete with
  // the initial JS bundle for bandwidth on first paint.
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        // Listen for an updated SW and ask users to refresh.
        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (
              installing.state === 'installed' &&
              navigator.serviceWorker.controller
            ) {
              // A new SW is ready; the next nav will pick it up. We log
              // but do not auto-prompt to avoid surprise UI re-renders.
              // eslint-disable-next-line no-console
              console.info('[mmmis] new service worker installed');
            }
          });
        });
      })
      .catch((err) => {
        // Surface but don't break the app — SW is non-essential.
        // eslint-disable-next-line no-console
        console.warn('[mmmis] service worker registration failed', err);
      });
  });
}
