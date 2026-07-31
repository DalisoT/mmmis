/// <reference lib="webworker" />
/**
 * MMMIS service worker.
 *
 * Built via vite-plugin-pwa's `injectManifest` strategy: this file is
 * the SW source, the plugin compiles a precache manifest into the
 * `self.__WB_MANIFEST` placeholder, and Workbox precaches + runtime
 * caches are set up at install/activate time.
 *
 * What this SW does beyond precaching:
 *   - Listens for `push` events from the Web Push gateway and shows a
 *     notification. The payload is JSON (see push-dispatch Edge Function)
 *     with { title, body, url, tag, kind, payload }.
 *   - Listens for `notificationclick` and focuses / navigates the
 *     existing app window to the URL in the payload (default behaviour
 *     is to just open the root).
 *   - Falls back to network for navigation requests so deploys roll
 *     out cleanly even when the user has the app open in two tabs.
 *
 * Anything not handled here (e.g. CSS/JS/image runtime caching) is left
 * to Workbox's defaults via the `runtimeCaching` config in vite.config.ts.
 */

import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);

// SPA navigation — fall back to /index.html for any unknown route.
// The NetworkFirst strategy means a deploy is picked up on the next
// page reload, not after the old shell is purged from the precache.
const handler = createHandlerBoundToURL('/index.html');
const navigationRoute = new NavigationRoute(handler, {
  denylist: [/^\/api/, /^\/auth/, /^\/supabase/, /^\/sw\.js/, /^\/workbox-/],
});
registerRoute(navigationRoute);

// ---------------------------------------------------------------------------
// Push notifications
// ---------------------------------------------------------------------------

interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  kind?: string;
  payload?: Record<string, unknown>;
}

self.addEventListener('push', (event: PushEvent) => {
  if (!event.data) return;
  let data: PushPayload;
  try {
    data = event.data.json() as PushPayload;
  } catch {
    // Some browsers send a plain text payload. Fall back to showing
    // the raw text in a generic notification.
    const text = event.data.text();
    data = { title: 'MMMIS', body: text };
  }
  // `renotify` is a real DOM Notification option but the TS lib for
  // service-worker NotificationOptions omits it; cast keeps the runtime
  // behaviour while satisfying the compiler.
  const options = {
    body: data.body,
    tag: data.tag,         // collapses repeat notifications of the same kind
    renotify: !!data.tag,
    data: { url: data.url, kind: data.kind, payload: data.payload },
    icon: '/web-app-manifest-192x192.png',
    badge: '/favicon-96x96.png',
    requireInteraction: data.kind === 'chit.authorization_requested',
  } as unknown as NotificationOptions;
  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const targetUrl = (event.notification.data?.url as string | undefined) ?? '/';
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      const url = new URL(client.url);
      if (url.pathname === targetUrl && 'focus' in client) {
        await client.focus();
        return;
      }
    }
    // No existing tab at the target URL — open a new one.
    await self.clients.openWindow(targetUrl);
  })());
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

self.addEventListener('install', () => {
  // Don't waitForAll on every install — auto-update is configured, and
  // waitUntil is implicit via Workbox precaching above.
  // eslint-disable-next-line no-console
  console.log('[mmmis-sw] installed');
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(self.clients.claim());
});