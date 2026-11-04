const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { verifyToken } = require('../middleware/auth');

// User profile
router.get('/profile', verifyToken, async (req, res) => {
  try {
    const firebaseUid = req.user.uid;

    const { data: user, error } = await supabase
      .from('users')
      .select('id, name, state, xp, level, streak, last_played, created_at')
      .eq('firebase_uid', firebaseUid)
      .single();

    if (error || !user) return res.status(404).json({ error: 'User nahi mila' });

    res.json({ user });
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ error: 'Profile nahi mila' });
  }
});

// Profile update (name, state)
router.put('/profile', verifyToken, async (req, res) => {
  try {
    const firebaseUid = req.user.uid;
    const { name, state } = req.body;

    const { data, error } = await supabase
      .from('users')
      .update({ name, state })
      .eq('firebase_uid', firebaseUid)
      .select()
      .single();

    if (error) throw error;
    res.json({ user: data });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Profile update nahi hua' });
  }
});

// National leaderboard (top 50)
router.get('/leaderboard', verifyToken, async (req, res) => {
  try {
    const { state } = req.query;

    let query = supabase
      .from('users')
      .select('id, name, state, xp, level, streak')
      .order('xp', { ascending: false })
      .limit(50);

    // State filter
    if (state) query = query.eq('state', state);

    const { data, error } = await query;
    if (error) throw error;

    // Rank add karo
    const ranked = data.map((user, index) => ({
      ...user,
      rank: index + 1
    }));

    res.json({ leaderboard: ranked });
  } catch (error) {
    console.error('Leaderboard error:', error);
    res.status(500).json({ error: 'Leaderboard nahi mila' });
  }
});

module.exports = router;
