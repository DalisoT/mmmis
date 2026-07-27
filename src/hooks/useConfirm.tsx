import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface ConfirmState extends ConfirmOptions {
  open: boolean;
  resolve: ((ok: boolean) => void) | null;
}

const defaultState: ConfirmState = {
  open: false,
  title: '',
  resolve: null,
};

interface ConfirmContextValue {
  confirm: (opts: ConfirmOptions | string) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue | undefined>(undefined);

/**
 * Wraps a section of the tree with a single AlertDialog instance and exposes
 * a `confirm({title, description, ...})` function that returns a Promise<boolean>.
 * This is a drop-in replacement for the browser's blocking `confirm()` but is
 * keyboard-accessible, themeable, and animates.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState>(defaultState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const confirm = useCallback<ConfirmContextValue['confirm']>((opts) => {
    const normalized: ConfirmOptions =
      typeof opts === 'string' ? { title: opts } : opts;
    return new Promise<boolean>((resolve) => {
      setState({ ...normalized, open: true, resolve });
    });
  }, []);

  const handleCancel = useCallback(() => {
    stateRef.current.resolve?.(false);
    setState(defaultState);
  }, []);

  const handleConfirm = useCallback(() => {
    stateRef.current.resolve?.(true);
    setState(defaultState);
  }, []);

  const value = useMemo(() => ({ confirm }), [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <AlertDialog
        open={state.open}
        onOpenChange={(open) => {
          if (!open) handleCancel();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{state.title}</AlertDialogTitle>
            {state.description ? (
              <AlertDialogDescription>{state.description}</AlertDialogDescription>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{state.cancelLabel ?? 'Cancel'}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirm}
              className={state.destructive ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : undefined}
            >
              {state.confirmLabel ?? 'Confirm'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmContextValue['confirm'] {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    // No provider mounted — fall back to the native confirm so the call site
    // still works. (The native path is only hit during development or in
    // a test that renders components in isolation.)
    return (opts) => {
      const text = typeof opts === 'string' ? opts : opts.title;
      return Promise.resolve(window.confirm(text));
    };
  }
  return ctx.confirm;
}
