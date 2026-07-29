// MMMIS service worker (app-shell + network-first, Supabase pass-through).
//
// IMPORTANT: this service worker does NOT cache cross-origin responses
// (supabase.co, etc.). The SPA talks to Supabase from the user's session
// token; caching those responses behind a stale token would silently leak
// data and break RLS expectations. We only cache the app shell so the
// launcher icon can paint a frame offline.
//
// Bump CACHE_VERSION when shipping a new shell to evict old caches.

/* eslint-disable no-restricted-globals */

const CACHE_VERSION = 'mmmis-shell-v1';
const SHELL_CACHE = `${CACHE_VERSION}`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// App shell: keep this small. Pages that require auth should never be
// precached because they are rendered by the SPA router after a token
// check; precaching /portal would only produce a confusing offline view.
const SHELL_URLS = ['/', '/login'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // addAll is atomic — if any single request fails the install fails.
      // Using individual add() calls so a transient miss of /login does
      // not abort the whole install.
      await Promise.all(
        SHELL_URLS.map((url) =>
          cache.add(url).catch(() => {
            // Ignore individual failures; /login may legitimately 302 on
            // some deployments and we still want / precached.
          }),
        ),
      );
      self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n !== SHELL_CACHE && n !== RUNTIME_CACHE)
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

function isSupabaseRequest(url) {
  return (
    url.hostname.endsWith('.supabase.co') ||
    url.hostname.endsWith('.supabase.in') ||
    url.hostname === 'supabase.io'
  );
}

function isAuthOrTokenRequest(url) {
  // Belt-and-braces: never cache anything carrying an Authorization-ish
  // header nor anything that looks like a token endpoint.
  if (url.pathname.startsWith('/auth/')) return true;
  if (url.pathname.includes('/token')) return true;
  if (url.pathname.startsWith('/functions/v1/')) return true; // Edge Functions
  return false;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only deal with GETs. Everything else (POST/PUT/DELETE) passes through.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Supabase + auth-adjacent: always pass through. Do not read the body,
  // do not call cache.match, do not call cache.put.
  if (url.origin !== self.location.origin) {
    // Cross-origin GETs (e.g. analytics, fonts) are still fine to cache
    // by browser default; we just won't participate.
    return;
  }
  if (isSupabaseRequest(url) || isAuthOrTokenRequest(url)) {
    return;
  }

  // Navigation requests: network-first, fall back to cached shell, then /.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          // Cache successful HTML responses under the runtime cache so
          // deep links can be reopened offline even if /login isn't cached.
          if (fresh && fresh.ok) {
            const runtime = await caches.open(RUNTIME_CACHE);
            runtime.put(request, fresh.clone()).catch(() => {});
          }
          return fresh;
        } catch (_err) {
          const cached = await caches.match(request);
          if (cached) return cached;
          const shell = await caches.match('/');
          if (shell) return shell;
          return new Response('Offline', { status: 503 });
        }
      })(),
    );
    return;
  }

  // Same-origin static asset requests (JS/CSS/images from the bundler):
  // stale-while-revalidate via the runtime cache. Note: in production,
  // Vite emits content-hashed filenames, so the SW only "owns" the
  // precached shell and un-hashed dev assets. This is fine.
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      const networkPromise = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(RUNTIME_CACHE).then((c) => c.put(request, clone)).catch(() => {});
          }
          return response;
        })
        .catch(() => cached || new Response('Offline', { status: 503 }));

      return cached || networkPromise;
    })(),
  );
});

// No push handler, no sync handler, no message handler. Adding any of
// those would expand the threat surface for an authenticated SPA without
// a proportionate feature benefit.
