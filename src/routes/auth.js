const express = require('express');
const router = express.Router();
const admin = require('../config/firebase');
const supabase = require('../config/supabase');

// Google Sign-In ke baad user register/login
router.post('/google', async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ error: 'idToken required' });

    // Firebase token verify karo
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const { uid, name, email } = decodedToken;

    // User already hai kya database mein?
    let { data: existingUser } = await supabase
      .from('users')
      .select('*')
      .eq('firebase_uid', uid)
      .single();

    if (!existingUser) {
      // Naya user banao
      const { data: newUser, error } = await supabase
        .from('users')
        .insert([{ firebase_uid: uid, name: name || 'Neta Fan' }])
        .select()
        .single();

      if (error) throw error;
      return res.json({ user: newUser, isNew: true });
    }

    res.json({ user: existingUser, isNew: false });
  } catch (error) {
    console.error('Google auth error:', error);
    res.status(500).json({ error: 'Auth fail ho gaya' });
  }
});

// Phone OTP verify karo
router.post('/phone/verify', async (req, res) => {
  try {
    const { idToken, phone, state } = req.body;
    if (!idToken) return res.status(400).json({ error: 'idToken required' });

    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const { uid } = decodedToken;

    let { data: existingUser } = await supabase
      .from('users')
      .select('*')
      .eq('firebase_uid', uid)
      .single();

    if (!existingUser) {
      const { data: newUser, error } = await supabase
        .from('users')
        .insert([{
          firebase_uid: uid,
          phone: phone || null,
          state: state || null,
          name: 'Neta Fan'
        }])
        .select()
        .single();

      if (error) throw error;
      return res.json({ user: newUser, isNew: true });
    }

    res.json({ user: existingUser, isNew: false });
  } catch (error) {
    console.error('Phone auth error:', error);
    res.status(500).json({ error: 'Phone auth fail ho gaya' });
  }
});

module.exports = router;
