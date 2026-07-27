import { supabase } from '@/lib/supabase';

export type AuditAction =
  // Trigger-derived (do NOT call from client — the DB writes these)
  | 'user.create' | 'user.update' | 'user.deactivate' | 'user.role_change' | 'user.password_reset'
  | 'sale.create' | 'sale.update' | 'sale.delete'
  | 'sale_item.create' | 'sale_item.update' | 'sale_item.delete'
  | 'chit_payment.create' | 'chit_payment.update' | 'chit_payment.delete'
  | 'expense.create' | 'expense.update' | 'expense.delete'
  | 'ledger.create' | 'ledger.update' | 'ledger.delete'
  | 'stock_receipt.create' | 'stock_receipt.update' | 'stock_receipt.delete'
  | 'stock_sheet.create' | 'stock_sheet.update' | 'stock_sheet.delete'
  | 'daily_summary.create' | 'daily_summary.update' | 'daily_summary.delete'
  // App-level (use logAudit)
  | 'auth.login_success' | 'auth.login_failed' | 'auth.signout'
  | 'auth.password_reset'
  | 'settings.update'
  | 'cash_closing.count' | 'cash_closing.approve'
  | 'chit.verify_password';

export interface AuditEntry {
  action: AuditAction;
  target_table?: string;
  target_id?: string;
  old_values?: Record<string, unknown>;
  new_values?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

/**
 * Phase 8: client-side audit writes go through the public.log_audit_event()
 * SECURITY DEFINER RPC. Direct inserts to public.audit_log are no longer
 * permitted by RLS — every sensitive-table mutation is captured by an
 * AFTER trigger, and this helper is the only sanctioned way to log
 * app-level events (login, settings, sign-out).
 */
export async function logAudit(entry: AuditEntry): Promise<void> {
  const { error } = await supabase.rpc('log_audit_event', {
    p_action: entry.action,
    p_meta: {
      target_table: entry.target_table ?? null,
      target_id: entry.target_id ?? null,
      old_values: entry.old_values ?? null,
      new_values: entry.new_values ?? null,
      ...(entry.meta ?? {}),
    },
  });
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('[audit] rpc failed', error.message);
  }
}

/** Back-compat helper for users.service and other call sites. */
export async function auditUserChange(
  action: AuditAction,
  targetId: string,
  oldValues?: Record<string, unknown>,
  newValues?: Record<string, unknown>
) {
  return logAudit({
    action,
    target_table: 'users',
    target_id: targetId,
    old_values: oldValues,
    new_values: newValues,
  });
}