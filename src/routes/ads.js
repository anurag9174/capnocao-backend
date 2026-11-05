const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { verifyToken, needDb } = require('../middleware/auth');
const { istDate } = require('../lib/dates');

// Only letters/spaces in a state name, so it can't break out of the filter string below.
const cleanState = (v) => (typeof v === 'string' ? v.replace(/[^A-Za-z ]/g, '').trim().slice(0, 40) : '');

// Ad serve karo (brand ad ya AdMob decide)
router.get('/serve', verifyToken, async (req, res) => {
  if (!supabase) return res.json({ type: 'admob', ad: null });
  try {
    const state = cleanState(req.query.state);
    const today = istDate();

    let query = supabase
      .from('ads')
      .select('*')
      .eq('status', 'active')
      .lte('start_date', today)
      .gte('end_date', today);

    if (state) query = query.or(`target_states.cs.{"${state}"},target_states.eq.{}`);

    const { data: brandAds, error } = await query.limit(1);

    if (error || !brandAds?.length) return res.json({ type: 'admob', ad: null });
    res.json({ type: 'brand', ad: brandAds[0] });
  } catch (error) {
    console.error('Ad serve error:', error);
    res.json({ type: 'admob', ad: null }); // Fallback to AdMob
  }
});

async function track(req, res, type) {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('firebase_uid', req.user.uid)
      .maybeSingle();

    const { error } = await supabase.from('ad_events').insert([{ ad_id: req.params.adId, user_id: user?.id || null, type }]);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error(`Ad ${type} error:`, error);
    res.status(500).json({ error: type === 'click' ? 'Click track nahi hua' : 'Impression track nahi hua' });
  }
}

router.post('/impression/:adId', verifyToken, needDb, (req, res) => track(req, res, 'impression'));
router.post('/click/:adId', verifyToken, needDb, (req, res) => track(req, res, 'click'));

module.exports = router;
