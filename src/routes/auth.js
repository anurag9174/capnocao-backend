const express = require('express');
const router = express.Router();
const admin = require('../config/firebase');
const supabase = require('../config/supabase');
const { needDb } = require('../middleware/auth');

const cleanName = (v) =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 30) : '';

const verify = async (idToken) => {
  if (!admin.isReady()) {
    const e = new Error('firebase not configured');
    e.status = 503;
    throw e;
  }
  try {
    return await admin.auth().verifyIdToken(idToken);
  } catch (err) {
    const e = new Error('invalid token');
    e.status = 401;
    throw e;
  }
};

/**
 * Finds the player's row, or creates it. If two sign-ins race (double tap, retry), the second
 * insert hits the unique firebase_uid and we simply read the row the first one made.
 */
async function findOrCreate(uid, fields) {
  const { data: existing, error: findError } = await supabase
    .from('users')
    .select('*')
    .eq('firebase_uid', uid)
    .maybeSingle();
  if (findError) throw findError;
  if (existing) return { user: existing, isNew: false };

  const { data: created, error } = await supabase
    .from('users')
    .insert([{ firebase_uid: uid, ...fields }])
    .select()
    .single();
  if (!error) return { user: created, isNew: true };

  const { data: again } = await supabase.from('users').select('*').eq('firebase_uid', uid).maybeSingle();
  if (again) return { user: again, isNew: false };
  throw error;
}

const fail = (res, error, label) => {
  if (error.status === 401) return res.status(401).json({ error: 'Invalid token' });
  if (error.status === 503) return res.status(503).json({ error: 'Login service abhi band hai' });
  console.error(label, error);
  return res.status(500).json({ error: 'Auth fail ho gaya' });
};

// Sign-in ke baad user register/login. Works for any Firebase sign-in (Google, phone, guest).
router.post('/google', needDb, async (req, res) => {
  try {
    const { idToken } = req.body || {};
    if (typeof idToken !== 'string' || !idToken) return res.status(400).json({ error: 'idToken required' });

    const { uid, name } = await verify(idToken);
    const result = await findOrCreate(uid, { name: cleanName(name) || cleanName(req.body.name) || 'Neta Fan' });
    res.json(result);
  } catch (error) {
    fail(res, error, 'Google auth error:');
  }
});

// Phone OTP verify karo
router.post('/phone/verify', needDb, async (req, res) => {
  try {
    const { idToken, state } = req.body || {};
    if (typeof idToken !== 'string' || !idToken) return res.status(400).json({ error: 'idToken required' });

    const decoded = await verify(idToken);
    // Trust the phone number Firebase verified, not whatever the request says.
    const result = await findOrCreate(decoded.uid, {
      phone: decoded.phone_number || null,
      state: typeof state === 'string' ? state.slice(0, 40) : null,
      name: 'Neta Fan',
    });
    res.json(result);
  } catch (error) {
    fail(res, error, 'Phone auth error:');
  }
});

module.exports = router;
