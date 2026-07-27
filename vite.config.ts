import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
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