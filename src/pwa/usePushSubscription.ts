/**
 * Push subscription hook.
 *
 * Reads the VAPID public key from `import.meta.env.VITE_VAPID_PUBLIC_KEY`
 * (configure via .env / Vercel env vars) and subscribes the current
 * device's service-worker registration to push. Persists the resulting
 * PushSubscription to public.push_subscriptions so the server-side
 * dispatcher can find it.
 *
 * Idempotent: if the user has already subscribed this device/browser,
 * we update the existing row in place instead of inserting a duplicate.
 *
 * Auto-runs once on mount (after sign-in) so members who install the
 * PWA don't have to dig into a settings page to enable notifications.
 */
import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthContext';

const STORAGE_KEY = 'mmmis:push-subscribed';

/**
 * Convert a URL-safe base64 string (VAPID spec) to a Uint8Array the
 * PushManager.subscribe() call expects.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function subscribeAndPersist(vapidPublicKey: string, userId: string): Promise<void> {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    // Service worker / push not supported in this browser.
    return;
  }
  if (Notification.permission === 'denied') {
    // User explicitly said no — don't keep nagging.
    return;
  }

  const reg = await navigator.serviceWorker.ready;

  // Already subscribed on this device? Reuse the subscription.
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    if (Notification.permission === 'default') {
      const result = await Notification.requestPermission();
      if (result !== 'granted') return;
    }
    const key = urlBase64ToUint8Array(vapidPublicKey);
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer,
    });
  }

  const j = sub.toJSON();
  const endpoint = j.endpoint ?? '';
  const p256dh = j.keys?.p256dh ?? '';
  const auth = j.keys?.auth ?? '';
  if (!endpoint || !p256dh || !auth) return;

  // Upsert into push_subscriptions. The unique partial index on
  // (endpoint) WHERE revoked_at IS NULL means we re-claim a row that
  // was previously revoked (e.g. user re-opts-in on the same device).
  // We do this with a SELECT + UPDATE/INSERT pair rather than .upsert()
  // because the unique constraint is partial — a regular upsert would
  // conflict with the soft-deleted row.
  const { data: existing } = await supabase
    .from('push_subscriptions')
    .select('id, revoked_at')
    .eq('endpoint', endpoint)
    .maybeSingle();

  if (existing?.id && !existing.revoked_at) {
    // Already live — just refresh last_seen.
    await supabase
      .from('push_subscriptions')
      .update({ last_seen_at: new Date().toISOString(), user_agent: navigator.userAgent })
      .eq('id', existing.id);
  } else if (existing?.id && existing.revoked_at) {
    // Soft-revoked previously — re-claim by clearing revoked_at.
    await supabase
      .from('push_subscriptions')
      .update({
        user_id: userId,
        p256dh,
        auth,
        user_agent: navigator.userAgent,
        last_seen_at: new Date().toISOString(),
        revoked_at: null,
      })
      .eq('id', existing.id);
  } else {
    // Fresh insert. RLS lets the user write their own row.
    await supabase.from('push_subscriptions').insert({
      user_id: userId,
      endpoint,
      p256dh,
      auth,
      user_agent: navigator.userAgent,
    });
  }

  try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* ignore */ }
}

/**
 * Best-effort auto-subscribe. Mount once, near the top of the app
 * shell. Failures are silent — push is a nice-to-have, not a blocker.
 */
export function useAutoPushSubscribe(): void {
  const { user } = useAuth();
  const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

  useEffect(() => {
    if (!user || !vapidKey) return;
    // Skip if the user already opted out this session.
    let optedOut = false;
    try { optedOut = localStorage.getItem(STORAGE_KEY) === 'opted-out'; } catch { /* ignore */ }
    if (optedOut) return;

    void subscribeAndPersist(vapidKey, user.id).catch(() => {
      // Don't surface to the user; the Settings page can retry manually.
    });
  }, [user, vapidKey]);
}

/**
 * Manual subscribe — exposed so the Settings page can show a button.
 */
export async function subscribeToPush(vapidKey: string, userId: string): Promise<boolean> {
  try {
    await subscribeAndPersist(vapidKey, userId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Manual unsubscribe — for the Settings page.
 */
export async function unsubscribeFromPush(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (!('serviceWorker' in navigator)) return false;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return true;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  // Mark revoked on the server so we don't try to deliver to it again.
  await supabase
    .from('push_subscriptions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('endpoint', endpoint);
  try { localStorage.setItem(STORAGE_KEY, 'opted-out'); } catch { /* ignore */ }
  return true;
}