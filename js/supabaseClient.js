/* supabaseClient.js — Supabase project connection.
   REQUIRED SETUP: paste your project's URL and anon (public) key below,
   from Supabase Dashboard → Settings → API. The anon key is safe to expose
   client-side; it only grants what Row Level Security policies allow
   (see supabase/schema.sql). Never put the service_role key here. */
(function (global) {
  const SUPABASE_URL = 'https://mmgsonaibdpzxqvymewf.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_zqZTwin6TSkriACDXKx0qQ_tWA4AZHY';

  const configured =
    SUPABASE_URL.startsWith('http') && SUPABASE_ANON_KEY && SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY';

  global.SUPABASE_URL = SUPABASE_URL;
  global.SUPABASE_CONFIGURED = configured;

  if (!configured) {
    console.warn(
      '[GAME24] Supabase ยังไม่ได้ตั้งค่า — แก้ไข SUPABASE_URL / SUPABASE_ANON_KEY ใน js/supabaseClient.js'
    );
    global.sb = null;
    return;
  }

  if (!global.supabase) {
    console.error('[GAME24] ไม่พบ Supabase SDK — ตรวจสอบว่าโหลด <script> ของ supabase-js ก่อน supabaseClient.js');
    global.sb = null;
    return;
  }

  global.sb = global.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
})(window);
