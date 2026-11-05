const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { verifyToken, needDb } = require('../middleware/auth');
const { shuffle, seededShuffle } = require('../lib/random');
const { istDate } = require('../lib/dates');

const FIELDS = 'id, quote, neta_name, is_cap, category, audio_clip_url';
const POOL_LIMIT = 1000;
const DAILY_COUNT = 5;

async function approvedPool() {
  const { data, error } = await supabase
    .from('questions')
    .select(FIELDS)
    .eq('approved', true)
    .order('id', { ascending: true }) // stable order, so the daily pick is the same for everyone
    .limit(POOL_LIMIT);
  if (error) throw error;
  return data || [];
}

// Random questions (Classic mode). The old version always returned the first rows of the table,
// so players kept getting the same quotes; now it shuffles the whole approved pool.
router.get('/random', verifyToken, needDb, async (req, res) => {
  try {
    const count = Math.min(Math.max(parseInt(req.query.count, 10) || 10, 1), 100);
    const pool = await approvedPool();
    res.json({ questions: shuffle(pool).slice(0, count) });
  } catch (error) {
    console.error('Questions fetch error:', error);
    res.status(500).json({ error: 'Questions nahi mile' });
  }
});

// Aaj ke daily questions: same set for everyone today (IST), changes every day.
// Returns "questions" (what the app reads) and "question" (the first one, for older clients).
router.get('/daily', verifyToken, needDb, async (req, res) => {
  try {
    const today = istDate();
    const pool = await approvedPool();
    if (!pool.length) return res.status(404).json({ error: 'Aaj ka question nahi mila' });

    const seed = Number(today.replace(/-/g, ''));
    const questions = seededShuffle(pool, seed).slice(0, DAILY_COUNT);
    res.json({ questions, question: questions[0], date: today });
  } catch (error) {
    console.error('Daily question error:', error);
    res.status(500).json({ error: 'Daily question nahi mila' });
  }
});

module.exports = router;
