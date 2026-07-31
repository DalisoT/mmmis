import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Progressive Web App — gives us a real service worker so the barman
    // keeps selling when the bar's WiFi drops, and lets members install
    // the app to their home screen. Strategy:
    //   - precache the app shell so first paint works offline
    //   - runtime cache for static assets (JS/CSS/icons) and Supabase
    //     images/CDN with a stale-while-revalidate fallback
    //   - network-first for navigation so deploys roll out cleanly
    //     and we never serve a stale index.html
    //   - auto-update so users always have the latest version
    //     without having to clear app data
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      injectManifest: {
        // Cap precache size so a typo'd CSS bundle doesn't bloat the
        // first-install payload. Workbox still emits all entries; we
        // just refuse to precache anything heavier than this.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      includeAssets: [
        'favicon.svg',
        'favicon.ico',
        'favicon-96x96.png',
        'apple-touch-icon.png',
        'web-app-manifest-192x192.png',
        'web-app-manifest-512x512.png',
        'logo-mark.png',
        'logo-full.png',
      ],
      manifest: {
        name: 'MMMIS - Military Mess Management',
        short_name: 'MMMIS',
        description:
          'Military Mess Management Information System. POS, stock, CHIT ledger, expenses, and audit for mess staff and members.',
        theme_color: '#0b1220',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: 'web-app-manifest-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'web-app-manifest-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'web-app-manifest-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Always serve the latest HTML when online so deploys are picked up
        // immediately; fall back to the cached shell when offline.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/, /^\/auth/, /^\/supabase/],
        runtimeCaching: [
          {
            // Supabase storage — product images, member photos, etc.
            urlPattern: /^https:\/\/gkegnmshivmgqhenqkzr\.supabase\.co\/storage\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'supabase-storage',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Google Fonts CSS — used by the app shell.
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-css' },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        // Don't enable the SW in `vite dev` — it pollutes HMR with a stale
        // shell and confuses developers. Production builds register it.
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: {
          // Big framework runtime — split so it caches independently of app code.
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // Radix UI primitives used across the app — keep together.
          'vendor-radix': [
            '@radix-ui/react-avatar',
            '@radix-ui/react-checkbox',
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-label',
            '@radix-ui/react-select',
            '@radix-ui/react-separator',
            '@radix-ui/react-slot',
            '@radix-ui/react-switch',
            '@radix-ui/react-tabs',
            '@radix-ui/react-toast',
          ],
          // Supabase + auth — heavy and rarely changes.
          'vendor-supabase': ['@supabase/supabase-js', '@tanstack/react-query'],
          // Forms + validation + utilities.
          'vendor-forms': ['react-hook-form', '@hookform/resolvers', 'zod'],
          // Charts + PDF + Excel — only loaded by report/POS pages.
          'vendor-reports': ['recharts', '@react-pdf/renderer', 'xlsx', 'date-fns'],
          // Icon set — surprisingly heavy in raw form.
          'vendor-icons': ['lucide-react'],
        },
      },
    },
  },
});