const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { verifyToken, needDb } = require('../middleware/auth');
const { istDate } = require('../lib/dates');

const MAX_QUESTIONS_PER_GAME = 50;

// XP calculate karne ka logic
const calculateXP = (score, total) => {
  const percentage = (score / total) * 100;
  if (percentage === 100) return 100;
  if (percentage >= 80) return 70;
  if (percentage >= 60) return 50;
  if (percentage >= 40) return 30;
  return 10;
};

// Level determine karo XP se
const getLevel = (totalXP) => {
  if (totalXP >= 2000) return 'Neta Baap';
  if (totalXP >= 1000) return 'Andolan Jeevi';
  if (totalXP >= 500) return 'Desh Bhakt';
  if (totalXP >= 200) return 'Jagruk';
  return 'Bhakt';
};

const asInt = (v) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') ? Number(v) : NaN);

// Game submit karo
router.post('/submit', verifyToken, needDb, async (req, res) => {
  try {
    const body = req.body || {};
    // The app sends both camelCase and snake_case names.
    const score = asInt(body.score);
    const totalQuestions = asInt(body.totalQuestions ?? body.total_questions);

    if (!Number.isInteger(score) || !Number.isInteger(totalQuestions) ||
        totalQuestions < 1 || totalQuestions > MAX_QUESTIONS_PER_GAME || score < 0 || score > totalQuestions) {
      return res.status(400).json({ error: 'Score aur totalQuestions sahi number chahiye (0 ≤ score ≤ totalQuestions)' });
    }

    const firebaseUid = req.user.uid;
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('firebase_uid', firebaseUid)
      .maybeSingle();

    if (userError) throw userError;
    if (!user) return res.status(404).json({ error: 'User nahi mila' });

    const xpEarned = calculateXP(score, totalQuestions);
    const newTotalXP = (user.xp || 0) + xpEarned;
    const newLevel = getLevel(newTotalXP);

    // Streak, by the Indian calendar day.
    const today = istDate();
    const yesterday = istDate(1);
    const lastPlayed = user.last_played ? String(user.last_played).slice(0, 10) : null;

    let newStreak = user.streak || 0;
    if (lastPlayed === yesterday) newStreak += 1; // streak continues
    else if (lastPlayed !== today) newStreak = 1; // streak broken (same day: unchanged)
    else if (newStreak < 1) newStreak = 1;

    const { error: updateError } = await supabase
      .from('users')
      .update({ xp: newTotalXP, level: newLevel, streak: newStreak, last_played: today })
      .eq('id', user.id);
    if (updateError) throw updateError;

    const { error: sessionError } = await supabase.from('game_sessions').insert([{
      user_id: user.id,
      score,
      xp_earned: xpEarned,
      total_questions: totalQuestions,
    }]);
    // XP is already saved; a missing history row shouldn't fail the whole submit.
    if (sessionError) console.error('Game session save error:', sessionError);

    const leveledUp = newLevel !== user.level;

    res.json({
      xpEarned,
      totalXP: newTotalXP,
      level: newLevel,
      streak: newStreak,
      leveledUp,
      message: leveledUp ? `Badhai ho! Ab tum ${newLevel} ho!` : 'Game complete!',
    });
  } catch (error) {
    console.error('Game submit error:', error);
    res.status(500).json({ error: 'Game submit nahi ho saka' });
  }
});

// Apni game history. (Earlier anyone could read anyone's history by changing the id in the URL;
// now it always returns the signed-in player's own games. The :userId part is kept for old apps.)
router.get(['/history', '/history/:userId'], verifyToken, needDb, async (req, res) => {
  try {
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id')
      .eq('firebase_uid', req.user.uid)
      .maybeSingle();
    if (userError) throw userError;
    if (!user) return res.json({ history: [] });

    const { data, error } = await supabase
      .from('game_sessions')
      .select('*')
      .eq('user_id', user.id)
      .order('completed_at', { ascending: false })
      .limit(20);

    if (error) throw error;
    res.json({ history: data || [] });
  } catch (error) {
    console.error('History fetch error:', error);
    res.status(500).json({ error: 'History nahi mili' });
  }
});

module.exports = router;
