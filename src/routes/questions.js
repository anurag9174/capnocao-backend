const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { verifyToken } = require('../middleware/auth');

// 10 random questions lao (Classic mode)
router.get('/random', verifyToken, async (req, res) => {
  try {
    const count = parseInt(req.query.count) || 10;

    const { data, error } = await supabase
      .from('questions')
      .select('id, quote, neta_name, is_cap, category, audio_clip_url')
      .eq('approved', true)
      .limit(count * 3); // Extra fetch karke shuffle karenge

    if (error) throw error;

    // Shuffle karo aur count jitne lo
    const shuffled = data.sort(() => Math.random() - 0.5).slice(0, count);
    res.json({ questions: shuffled });
  } catch (error) {
    console.error('Questions fetch error:', error);
    res.status(500).json({ error: 'Questions nahi mile' });
  }
});

// Aaj ka daily question
router.get('/daily', verifyToken, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Simple: aaj ki date ke hisaab se ek fixed question
    const { data, error } = await supabase
      .from('questions')
      .select('id, quote, neta_name, is_cap, category, audio_clip_url')
      .eq('approved', true)
      .limit(1);

    if (error) throw error;
    if (!data.length) return res.status(404).json({ error: 'Aaj ka question nahi mila' });

    res.json({ question: data[0], date: today });
  } catch (error) {
    console.error('Daily question error:', error);
    res.status(500).json({ error: 'Daily question nahi mila' });
  }
});

module.exports = router;
