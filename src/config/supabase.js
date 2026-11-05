const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');

const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;

let supabase = null;
if (SUPABASE_URL && SUPABASE_SECRET_KEY) {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
      auth: { persistSession: false },
      // Older Node versions have no built-in WebSocket; give Supabase the "ws" one so it never crashes.
      realtime: { transport: WebSocket },
    });
  } catch (e) {
    console.error('⚠️ Supabase client nahi bana:', e.message);
  }
} else {
  // Don't crash the whole server (online battles still work); database routes will answer 503.
  console.error('⚠️ SUPABASE_URL / SUPABASE_SECRET_KEY set nahi hai — database wale routes kaam nahi karenge.');
}

module.exports = supabase;
