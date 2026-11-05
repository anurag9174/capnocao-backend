const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { verifyToken, needDb } = require('../middleware/auth');

const cleanText = (v, max) =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max) : undefined;

const gamesPlayed = async (userId) => {
  const { count, error } = await supabase
    .from('game_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  return error ? 0 : count || 0;
};

// User profile
router.get('/profile', verifyToken, needDb, async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, name, state, xp, level, streak, last_played, created_at')
      .eq('firebase_uid', req.user.uid)
      .maybeSingle();

    if (error) throw error;
    if (!user) return res.status(404).json({ error: 'User nahi mila' });

    res.json({ user: { ...user, games_played: await gamesPlayed(user.id) } });
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ error: 'Profile nahi mila' });
  }
});

// Profile update (name, state only; everything else is ignored)
router.put('/profile', verifyToken, needDb, async (req, res) => {
  try {
    const updates = {};
    const name = cleanText(req.body?.name, 30);
    const state = cleanText(req.body?.state, 40);
    if (name) updates.name = name;
    if (state !== undefined) updates.state = state || null;

    let query;
    if (Object.keys(updates).length) {
      query = supabase.from('users').update(updates).eq('firebase_uid', req.user.uid).select().maybeSingle();
    } else {
      query = supabase.from('users').select('*').eq('firebase_uid', req.user.uid).maybeSingle();
    }
    const { data, error } = await query;
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'User nahi mila' });
    delete data.firebase_uid;
    delete data.phone;
    res.json({ user: data });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Profile update nahi hua' });
  }
});

// National leaderboard (top 50, or ?limit= up to 100)
router.get('/leaderboard', verifyToken, needDb, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const state = cleanText(req.query.state, 40);

    let query = supabase
      .from('users')
      .select('id, name, state, xp, level, streak')
      .order('xp', { ascending: false })
      .order('created_at', { ascending: true }) // ties: whoever got there first
      .limit(limit);

    if (state) query = query.eq('state', state);

    const { data, error } = await query;
    if (error) throw error;

    res.json({ leaderboard: (data || []).map((user, index) => ({ ...user, rank: index + 1 })) });
  } catch (error) {
    console.error('Leaderboard error:', error);
    res.status(500).json({ error: 'Leaderboard nahi mila' });
  }
});

// The signed-in player's national rank (the app's profile screen asks for this).
router.get(['/leaderboard/rank', '/leaderboard/rank/:firebaseUid'], verifyToken, needDb, async (req, res) => {
  try {
    const { data: me, error } = await supabase
      .from('users')
      .select('id, name, state, xp, level, streak')
      .eq('firebase_uid', req.user.uid)
      .maybeSingle();
    if (error) throw error;
    if (!me) return res.status(404).json({ error: 'User nahi mila' });

    const { count, error: countError } = await supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .gt('xp', me.xp || 0);
    if (countError) throw countError;

    const entry = { ...me, rank: (count || 0) + 1 };
    res.json({ leaderboard: [entry], rank: entry.rank });
  } catch (error) {
    console.error('Rank error:', error);
    res.status(500).json({ error: 'Rank nahi mila' });
  }
});

module.exports = router;
