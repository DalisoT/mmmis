/**
 * Tiny toast helper. Delegates to the global <Toaster /> provider (Radix UI).
 *
 * Important: the previous implementation called `useToaster()` (a React
 * `useContext` hook) directly from this module's exported functions. That
 * worked when call sites were inside React render, but failed with
 * "Minified React error #321; useContext called outside a <Provider>"
 * whenever the helper was invoked from an async `.catch` / rejected-promise
 * handler — there is no current React fiber at that point.
 *
 * The fix is a tiny pub/sub: the <Toaster /> provider subscribes once on
 * mount, and these helpers publish to it. Safe to call from any code path
 * (top-level handlers, .catch, async event listeners, microtasks).
 */
import type { ToastVariant } from '@/components/ui/toaster';

type Listener = (opts: {
  title?: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
}) => void;

const listeners = new Set<Listener>();

export function subscribeToasts(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(opts: {
  title?: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
}) {
  for (const l of listeners) {
    try {
      l(opts);
    } catch {
      // Listener errors must not break the publisher.
    }
  }
}

export const toast = {
  success(message: string) {
    emit({ title: message, variant: 'success' });
  },
  error(message: string) {
    emit({ title: message, variant: 'error' });
  },
  info(message: string) {
    emit({ title: message, variant: 'info' });
  },
  show(opts: {
    title?: string;
    description?: string;
    variant?: ToastVariant;
    duration?: number;
  }) {
    emit(opts);
  },
};