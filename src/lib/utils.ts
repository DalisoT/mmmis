import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Combine class names with Tailwind merge support.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a number as currency (Zambian Kwacha by default).
 */
export function formatCurrency(amount: number, currency = 'ZMW'): string {
  return new Intl.NumberFormat('en-ZM', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

/**
 * Format an ISO date string as a human-readable datetime.
 */
export function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Generate a cryptographically-strong 16-char password.
 * Guarantees at least one uppercase, one lowercase, one digit, and one symbol.
 * Used by the admin "Generate" button on the Create User dialog so the
 * suggested value matches what the Edge Function would have generated itself.
 */
export function genStrongPassword(length = 16): string {
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const sym = '!@#$%^&*';
  const all = alpha + digits + sym;
  const len = Math.max(8, length);
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  const out: string[] = new Array(len);
  out[0] = alpha[bytes[0] % alpha.length];
  out[1] = digits[bytes[1] % digits.length];
  out[2] = sym[bytes[2] % sym.length];
  for (let i = 3; i < len; i++) out[i] = all[bytes[i] % all.length];
  // Fisher–Yates shuffle using the same RNG buffer.
  for (let i = out.length - 1; i > 0; i--) {
    const j = bytes[i % bytes.length] % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join('');
}
