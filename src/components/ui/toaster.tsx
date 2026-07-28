import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from '@/components/ui/toast';
import { subscribeToasts } from '@/lib/toast';

export type ToastVariant = 'default' | 'success' | 'error' | 'info' | 'destructive';

interface ToastItem {
  id: number;
  title?: string;
  description?: string;
  variant: ToastVariant;
  duration: number;
}

interface ToastApi {
  show: (opts: { title?: string; description?: string; variant?: ToastVariant; duration?: number }) => void;
}

interface ToasterContextValue {
  toasts: ToastItem[];
  show: ToastApi['show'];
  dismiss: (id: number) => void;
}

const ToasterContext = createContext<ToasterContextValue | null>(null);

export function useToaster(): ToasterContextValue {
  const ctx = useContext(ToasterContext);
  if (!ctx) throw new Error('useToaster must be used inside <Toaster />');
  return ctx;
}

/**
 * Global Radix-backed Toaster. Mount once at the top of the React tree.
 * The `toast` helper in `@/lib/toast` proxies to `useToaster().show` so
 * call sites can stay simple.
 */
export function Toaster({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const show = useCallback<ToastApi['show']>((opts) => {
    const id = ++idRef.current;
    const item: ToastItem = {
      id,
      title: opts.title,
      description: opts.description,
      variant: opts.variant ?? 'default',
      duration: opts.duration ?? 4000,
    };
    setToasts((cur) => [...cur, item]);
  }, []);

  const value = useMemo<ToasterContextValue>(() => ({ toasts, show, dismiss }), [toasts, show, dismiss]);

  // Bridge the module-level @/lib/toast helper into this provider. The
  // helper cannot call useContext directly because callers (e.g. mutation
  // .catch handlers) run outside any React render — that was the source
  // of React error #321 ("useContext called outside a <Provider>").
  useEffect(() => subscribeToasts((opts) => show(opts)), [show]);

  return (
    <ToasterContext.Provider value={value}>
      <ToastProvider swipeDirection="right" duration={4000}>
        {children}
        {toasts.map((t) => (
          <Toast
            key={t.id}
            variant={t.variant === 'error' ? 'destructive' : t.variant === 'success' ? 'success' : t.variant === 'info' ? 'info' : 'default'}
            duration={t.duration}
            onOpenChange={(open) => {
              if (!open) dismiss(t.id);
            }}
          >
            <div className="grid gap-1">
              {t.title && <ToastTitle>{t.title}</ToastTitle>}
              {t.description && <ToastDescription>{t.description}</ToastDescription>}
            </div>
            <ToastClose />
          </Toast>
        ))}
        <ToastViewport />
      </ToastProvider>
    </ToasterContext.Provider>
  );
}