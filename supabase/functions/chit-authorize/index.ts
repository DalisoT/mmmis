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

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const auth = req.headers.get('authorization') ?? '';
  if (!auth) {
    return new Response('Unauthorized', { status: 401 });
  }

  // 1. Verify the buyer is signed in. We do NOT trust the email here —
  //    `auth.uid()` is the source of truth for "who is the buyer".
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: auth } } }
  );

  const { data: buyerData, error: buyerErr } = await userClient.auth.getUser();
  if (buyerErr || !buyerData.user) {
    return new Response(
      JSON.stringify({ error: 'Not signed in' }),
      { status: 401, headers: { 'content-type': 'application/json' } }
    );
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body' }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    );
  }
  if (!body?.request_id || typeof body.password !== 'string' || body.password.length === 0) {
    return new Response(
      JSON.stringify({ error: 'request_id and password are required' }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    );
  }

  // 2. Load the request, confirm the buyer IS the member, and learn the
  //    email to verify the password against.
  const { data: reqRow, error: reqErr } = await userClient
    .from('chit_authorization_requests')
    .select('id, member_id, status, expires_at, member:users(email)')
    .eq('id', body.request_id)
    .single();
  if (reqErr || !reqRow) {
    return new Response(
      JSON.stringify({ error: 'Authorization request not found' }),
      { status: 404, headers: { 'content-type': 'application/json' } }
    );
  }
  if (reqRow.status !== 'pending') {
    return new Response(
      JSON.stringify({ error: `Authorization already ${reqRow.status}` }),
      { status: 409, headers: { 'content-type': 'application/json' } }
    );
  }
  if (new Date(reqRow.expires_at).getTime() < Date.now()) {
    return new Response(
      JSON.stringify({ error: 'Authorization expired' }),
      { status: 410, headers: { 'content-type': 'application/json' } }
    );
  }

  const memberEmail = (reqRow as any)?.member?.email;
  if (!memberEmail) {
    return new Response(
      JSON.stringify({ error: 'Member has no email on file' }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    );
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
    return new Response(
      JSON.stringify({ error: 'Password is incorrect' }),
      { status: 401, headers: { 'content-type': 'application/json' } }
    );
  }

  // 4. Password is correct — stamp the authorization request. Run as the
  //    buyer (their JWT is forwarded) so approve_chit_authorization()'s
  //    "buyer must own this row" check passes.
  const { error: approveErr } = await userClient.rpc('approve_chit_authorization', {
    p_request_id: body.request_id,
  });
  if (approveErr) {
    return new Response(
      JSON.stringify({ error: approveErr.message }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    );
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'content-type': 'application/json' },
  });
});
