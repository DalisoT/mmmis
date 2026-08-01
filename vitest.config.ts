import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Vitest config — separate from vite.config.ts so the PWA plugin and
// production build settings don't leak into the test runner.
//
// Test discovery: any file matching `**/*.{test,spec}.{ts,tsx}` inside src/.
// Setup file (vitest.setup.ts) wires @testing-library/jest-dom matchers.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      // Pure-logic coverage targets first; UI components opt in later.
      include: [
        'src/features/**/settings.service.ts',
        'src/features/**/sales.service.ts',
        'src/features/**/audit.ts',
        'src/lib/utils.ts',
      ],
    },
  },
});
