const { createClient } = require('@supabase/supabase-js');

const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;

let supabase = null;
if (SUPABASE_URL && SUPABASE_SECRET_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
} else {
  // Don't crash the whole server (online battles still work); database routes will answer 503.
  console.error('⚠️ SUPABASE_URL / SUPABASE_SECRET_KEY set nahi hai — database wale routes kaam nahi karenge.');
}

module.exports = supabase;
