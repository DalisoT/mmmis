// Supabase Edge Function: push-dispatch
//
// Reads rows from public.push_outbox (one per web-push notification
// that needs to be delivered) and fans them out via the Web Push
// protocol to every active push_subscriptions row for the target user.
//
// Wired up by a Supabase Database Webhook on `public.push_outbox`
// (INSERT events). The webhook calls this function once per inserted
// row. The body is the webhook payload; we extract `record.id` and
// look the row up server-side so we trust nothing from the caller.
//
// Required secrets (configure with `supabase secrets set`):
//   VAPID_PUBLIC_KEY     — VAPID public key (URL-safe base64, no padding)
//   VAPID_PRIVATE_KEY    — VAPID private key (URL-safe base64, no padding)
//   VAPID_SUBJECT        — mailto:admin@... or https://... contact URL
//
// Deploy:
//   supabase functions deploy push-dispatch --no-verify-jwt
// The function trusts the service_role key in the Authorization header.
//
// @ts-nocheck  -- Deno-side; not type-checked by the Vite pipeline.
// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { webpush } from './webpushClient.ts';

interface WebhookRecord {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string;
  url?: string;
  tag?: string;
  payload?: Record<string, unknown>;
}

interface WebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  record?: WebhookRecord;
  schema: string;
  old_record?: unknown;
}

const corsHeaders: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // The webhook always sends a service_role JWT. We re-create the admin
  // client and then look up the outbox row ourselves.
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    return json({ error: 'Missing Supabase env' }, 500);
  }

  const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY');
  const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY');
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com';
  if (!vapidPublic || !vapidPrivate) {
    return json({ error: 'Missing VAPID env (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)' }, 500);
  }

  let body: WebhookPayload;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  if (body.type !== 'INSERT' || !body.record) {
    return json({ ok: true, skipped: 'not an INSERT' });
  }

  const outboxId = body.record.id;
  const admin = createClient(supabaseUrl, serviceKey);

  // Re-fetch the outbox row so we trust the database, not the webhook payload.
  const { data: outbox, error: outboxErr } = await admin
    .from('push_outbox')
    .select('id, user_id, kind, title, body, url, tag, payload')
    .eq('id', outboxId)
    .single();
  if (outboxErr || !outbox) {
    return json({ error: `outbox lookup failed: ${outboxErr?.message ?? 'not found'}` }, 404);
  }

  // Don't re-deliver a row that has already been sent. Webhooks can
  // occasionally retry — idempotency matters here so we don't double-notify.
  const { data: existing } = await admin
    .from('push_outbox')
    .select('sent_at')
    .eq('id', outboxId)
    .single();
  if (existing?.sent_at) {
    return json({ ok: true, skipped: 'already sent' });
  }

  // Look up every active subscription for this user.
  const { data: subs, error: subsErr } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', outbox.user_id)
    .is('revoked_at', null);
  if (subsErr) {
    return json({ error: `subscription lookup failed: ${subsErr.message}` }, 500);
  }
  if (!subs || subs.length === 0) {
    // No subscriptions yet — mark dispatched so the webhook stops retrying.
    // (The member hasn't granted push permission on any device.)
    await admin.rpc('mark_push_outbox_dispatched', {
      p_results: [{ id: outboxId, ok: true, error: 'no_subscriptions' }],
    });
    return json({ ok: true, delivered: 0 });
  }

  // Configure VAPID once per request.
  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        JSON.stringify({
          title: outbox.title,
          body: outbox.body,
          url: outbox.url,
          tag: outbox.tag,
          kind: outbox.kind,
          payload: outbox.payload,
        }),
        { TTL: 60 * 60 },  // 1 hour; the dispatcher is fast
      );
      results.push({ id: outboxId, ok: true });
    } catch (e) {
      const err = e as { statusCode?: number; message?: string };
      // 404 / 410 means the subscription is dead — soft-revoke it so we
      // don't keep hitting it.
      if (err.statusCode === 404 || err.statusCode === 410) {
        await admin
          .from('push_subscriptions')
          .update({ revoked_at: new Date().toISOString() })
          .eq('id', sub.id);
        results.push({ id: outboxId, ok: true, error: `revoked (${err.statusCode})` });
      } else {
        results.push({ id: outboxId, ok: false, error: err.message ?? String(e) });
      }
    }
  }

  // Mark dispatched (or record last_error if every delivery failed). If
  // any delivery succeeded we treat the row as successfully sent.
  const anyOk = results.some((r) => r.ok);
  await admin.rpc('mark_push_outbox_dispatched', {
    p_results: anyOk
      ? [{ id: outboxId, ok: true }]
      : [{ id: outboxId, ok: false, error: results.map((r) => r.error).filter(Boolean).join('; ') }],
  });

  return json({ ok: true, delivered: results.filter((r) => r.ok).length, total: results.length });
});