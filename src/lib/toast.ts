/**
 * Tiny toast helper. Delegates to the global <Toaster /> provider (Radix UI).
 * The previous Phase 6 implementation was a console stub; Phase 7 wires it
 * to the Radix toast portal so the user actually sees feedback.
 */
import { useToaster } from '@/components/ui/toaster';

export const toast = {
  success(message: string) {
    useToaster().show({ title: message, variant: 'success' });
  },
  error(message: string) {
    useToaster().show({ title: message, variant: 'error' });
  },
  info(message: string) {
    useToaster().show({ title: message, variant: 'info' });
  },
  show(opts: { title?: string; description?: string; variant?: 'default' | 'success' | 'error' | 'info' | 'destructive'; duration?: number }) {
    useToaster().show(opts);
  },
};