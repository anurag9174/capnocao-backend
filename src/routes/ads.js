const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { verifyToken } = require('../middleware/auth');

// Ad serve karo (brand ad ya AdMob decide)
router.get('/serve', verifyToken, async (req, res) => {
  try {
    const { segment, state } = req.query;
    const today = new Date().toISOString().split('T')[0];

    // Active brand campaign hai kya?
    let query = supabase
      .from('ads')
      .select('*')
      .eq('status', 'active')
      .lte('start_date', today)
      .gte('end_date', today);

    // State targeting
    if (state) {
      query = query.or(`target_states.cs.{"${state}"},target_states.eq.{}`);
    }

    const { data: brandAds, error } = await query.limit(1);

    if (error || !brandAds?.length) {
      // Koi brand ad nahi — AdMob use karo
      return res.json({ type: 'admob', ad: null });
    }

    // Brand ad mila!
    res.json({ type: 'brand', ad: brandAds[0] });
  } catch (error) {
    console.error('Ad serve error:', error);
    res.json({ type: 'admob', ad: null }); // Fallback to AdMob
  }
});

// Ad impression track karo
router.post('/impression/:adId', verifyToken, async (req, res) => {
  try {
    const { adId } = req.params;
    const firebaseUid = req.user.uid;

    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('firebase_uid', firebaseUid)
      .single();

    await supabase.from('ad_events').insert([{
      ad_id: adId,
      user_id: user?.id,
      type: 'impression'
    }]);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Impression track nahi hua' });
  }
});

// Ad click track karo
router.post('/click/:adId', verifyToken, async (req, res) => {
  try {
    const { adId } = req.params;
    const firebaseUid = req.user.uid;

    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('firebase_uid', firebaseUid)
      .single();

    await supabase.from('ad_events').insert([{
      ad_id: adId,
      user_id: user?.id,
      type: 'click'
    }]);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Click track nahi hua' });
  }
});

module.exports = router;
