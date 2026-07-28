// Supabase Edge Function: chit-authorize
//
// The buyer's /portal/authorize/<id> page calls this with the buyer's
// password. We verify the password against Supabase Auth (bcrypt is not
// accessible from plpgsql), then if it matches we call the
// `approve_chit_authorization()` RPC which stamps the request row.
//
// Deploy:
//   supabase functions deploy chit-authorize --no-verify-jwt
// The function trusts the buyer-supplied JWT in the Authorization header;
// password is verified via a one-shot, throwaway headless Supabase client
// so the buyer's session is never replaced.
//
// Mirror endpoint `reject-chit` is intentionally NOT a separate function —
// the buyer can reject without a password (we only require auth.uid() to be
// the buyer), so the SPA calls `reject_chit_authorization()` directly via RPC.

// @ts-nocheck  -- Edge Functions run on Deno; the Node/Vite side does not
//                 need to type-check this file.
// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface RequestBody {
  request_id: string;
  password: string;
}

// CORS — the buyer's /portal/authorize page is served from the SPA origin
// (mmmis.vercel.app) and POSTs to the Edge Function gateway. Without these
// headers the browser's preflight OPTIONS gets a 405 with no
// Access-Control-Allow-Origin and `fetch` rejects with "Failed to fetch".
const corsHeaders: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
  'access-control-max-age': '86400',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders },
  });
}

Deno.serve(async (req) => {
  // CORS preflight — short-circuit before the POST handler.
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const auth = req.headers.get('authorization') ?? '';
  if (!auth) {
    return json({ error: 'Missing Authorization header' }, 401);
  }

  // Extract the bearer token. We do NOT rely on the userClient's session
  // cache here — passing it explicitly to getUser() bypasses the JS
  // client's in-memory session state, which is empty in an Edge Function
  // (we never signed in from this runtime) and previously caused
  // "Auth session is missing!" even though the JWT was structurally
  // valid and accepted by the PostgREST layer.
  const token = auth.toLowerCase().startsWith('bearer ')
    ? auth.slice(7).trim()
    : auth.trim();
  if (!token) {
    return json({ error: 'Missing Authorization header' }, 401);
  }

  // Verify the buyer is signed in by calling GoTrue's /auth/v1/user
  // endpoint directly. We do not use `userClient.auth.getUser(token)`
  // because that path first consults the JS client's in-memory session
  // cache and short-circuits with "Auth session missing!" when the
  // cache is empty (which it always is in a fresh Edge Function runtime)
  // even though the token is structurally valid and GoTrue would accept
  // it. Going straight to fetch guarantees the token is actually
  // verified against the auth backend.
  const goTrueUrl = `${Deno.env.get('SUPABASE_URL')}/auth/v1/user`;
  const goTrueRes = await fetch(goTrueUrl, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'apikey': Deno.env.get('SUPABASE_ANON_KEY')!,
    },
  });
  if (!goTrueRes.ok) {
    const detail = await goTrueRes.text().catch(() => '');
    return json(
      { error: `Invalid session: GoTrue ${goTrueRes.status}${detail ? `: ${detail.slice(0, 200)}` : ''}` },
      401,
    );
  }
  const buyerData = await goTrueRes.json() as { id?: string; user_id?: string };
  if (!buyerData.id && !buyerData.user_id) {
    return json({ error: 'Invalid session: empty user payload from GoTrue' }, 401);
  }
  // `buyerId` is intentionally unused below — the userClient (PostgREST)
  // will resolve auth.uid() from the same JWT we just verified, and the
  // approve_chit_authorization() RPC uses that for its ownership check.
  // We only need to know the token was accepted, not extract the id here.

  // 1. Verify the buyer is signed in. We do NOT trust the email here —
  //    `auth.uid()` is the source of truth for "who is the buyer".
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!body?.request_id || typeof body.password !== 'string' || body.password.length === 0) {
    return json({ error: 'request_id and password are required' }, 400);
  }

  // 2. Load the request, confirm the buyer IS the member, and learn the
  //    email to verify the password against.
  const { data: reqRow, error: reqErr } = await userClient
    .from('chit_authorization_requests')
    .select('id, member_id, status, expires_at, member:users(email)')
    .eq('id', body.request_id)
    .single();
  if (reqErr || !reqRow) {
    return json({ error: 'Authorization request not found' }, 404);
  }
  if (reqRow.status !== 'pending') {
    return json({ error: `Authorization already ${reqRow.status}` }, 409);
  }
  if (new Date(reqRow.expires_at).getTime() < Date.now()) {
    return json({ error: 'Authorization expired' }, 410);
  }

  const memberEmail = (reqRow as any)?.member?.email;
  if (!memberEmail) {
    return json({ error: 'Member has no email on file' }, 400);
  }

  // 3. Verify password against Supabase Auth using a throwaway headless
  //    client so the buyer's session is not disturbed.
  const headless = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { error: pwErr } = await headless.auth.signInWithPassword({
    email: memberEmail,
    password: body.password,
  });
  await headless.auth.signOut();
  if (pwErr) {
    return json({ error: 'Password is incorrect' }, 401);
  }

  // 4. Password is correct — stamp the authorization request. Run as the
  //    buyer (their JWT is forwarded) so approve_chit_authorization()'s
  //    "buyer must own this row" check passes.
  const { error: approveErr } = await userClient.rpc('approve_chit_authorization', {
    p_request_id: body.request_id,
  });
  if (approveErr) {
    return json({ error: approveErr.message }, 400);
  }

  return json({ ok: true });
});
