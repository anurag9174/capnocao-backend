const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { verifyToken } = require('../middleware/auth');

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

// Game submit karo
router.post('/submit', verifyToken, async (req, res) => {
  try {
    const { score, totalQuestions, questionIds } = req.body;
    const firebaseUid = req.user.uid;

    if (score === undefined || !totalQuestions) {
      return res.status(400).json({ error: 'Score aur totalQuestions chahiye' });
    }

    // User dhundo
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('firebase_uid', firebaseUid)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'User nahi mila' });
    }

    const xpEarned = calculateXP(score, totalQuestions);
    const newTotalXP = (user.xp || 0) + xpEarned;
    const newLevel = getLevel(newTotalXP);

    // Streak update karo
    const today = new Date().toISOString().split('T')[0];
    const lastPlayed = user.last_played;
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    
    let newStreak = user.streak || 0;
    if (lastPlayed === yesterday) {
      newStreak += 1; // Streak continue
    } else if (lastPlayed !== today) {
      newStreak = 1; // Streak reset
    }

    // User update karo
    await supabase
      .from('users')
      .update({
        xp: newTotalXP,
        level: newLevel,
        streak: newStreak,
        last_played: today
      })
      .eq('firebase_uid', firebaseUid);

    // Game session save karo
    await supabase
      .from('game_sessions')
      .insert([{
        user_id: user.id,
        score,
        xp_earned: xpEarned,
        total_questions: totalQuestions
      }]);

    const leveledUp = newLevel !== user.level;

    res.json({
      xpEarned,
      totalXP: newTotalXP,
      level: newLevel,
      streak: newStreak,
      leveledUp,
      message: leveledUp ? `Badhai ho! Ab tum ${newLevel} ho!` : 'Game complete!'
    });
  } catch (error) {
    console.error('Game submit error:', error);
    res.status(500).json({ error: 'Game submit nahi ho saka' });
  }
});

// User ki game history
router.get('/history/:userId', verifyToken, async (req, res) => {
  try {
    const { userId } = req.params;

    const { data, error } = await supabase
      .from('game_sessions')
      .select('*')
      .eq('user_id', userId)
      .order('completed_at', { ascending: false })
      .limit(20);

    if (error) throw error;
    res.json({ history: data });
  } catch (error) {
    console.error('History fetch error:', error);
    res.status(500).json({ error: 'History nahi mili' });
  }
});

module.exports = router;
