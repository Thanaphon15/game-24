// admin-delete-user — Supabase Edge Function
// Permanently deletes a player's auth account (profiles/scores rows cascade
// via FK). Requires the service_role key, so this must run server-side —
// it CANNOT be called directly from the browser with the anon key.
//
// Deploy:
//   supabase functions deploy admin-delete-user
//
// The caller must send their own session's access token; this function
// re-verifies that caller is an admin (via profiles.is_admin) before it
// will delete anyone, so a stolen anon key alone can't be used to delete
// accounts — only a logged-in admin's session can.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type'
  };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) {
      return new Response(JSON.stringify({ error: 'missing bearer token' }), {
        status: 401,
        headers: cors
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Client scoped to the caller's own token — used only to verify identity + admin role.
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    });

    const { data: { user }, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: cors });
    }

    const { data: profile, error: profileErr } = await callerClient
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single();

    if (profileErr || !profile || !profile.is_admin) {
      return new Response(JSON.stringify({ error: 'forbidden — admin only' }), { status: 403, headers: cors });
    }

    const { userId } = await req.json();
    if (!userId) {
      return new Response(JSON.stringify({ error: 'userId is required' }), { status: 400, headers: cors });
    }
    if (userId === user.id) {
      return new Response(JSON.stringify({ error: 'cannot delete your own admin account' }), {
        status: 400,
        headers: cors
      });
    }

    // Elevated client — service_role bypasses RLS, only used for the delete itself.
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { error: deleteErr } = await adminClient.auth.admin.deleteUser(userId);
    if (deleteErr) {
      return new Response(JSON.stringify({ error: deleteErr.message }), { status: 500, headers: cors });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
});
