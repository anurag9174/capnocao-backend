const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');

// Simple admin auth middleware
const adminAuth = (req, res, next) => {
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_SECRET_KEY) {
    return res.status(403).json({ error: 'Admin access denied' });
  }
  next();
};

// Naya question add karo
router.post('/questions/create', adminAuth, async (req, res) => {
  try {
    const { quote, neta_name, is_cap, category, source_url } = req.body;

    if (!quote || !neta_name || is_cap === undefined) {
      return res.status(400).json({ error: 'quote, neta_name, is_cap required hai' });
    }

    const { data, error } = await supabase
      .from('questions')
      .insert([{ quote, neta_name, is_cap, category, source_url, approved: false }])
      .select()
      .single();

    if (error) throw error;
    res.json({ question: data, message: 'Question add ho gaya — approve karna baaki hai' });
  } catch (error) {
    console.error('Question create error:', error);
    res.status(500).json({ error: 'Question add nahi hua' });
  }
});

// Question approve karo
router.put('/questions/:id/approve', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('questions')
      .update({ approved: true })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json({ question: data, message: 'Question approve ho gaya!' });
  } catch (error) {
    res.status(500).json({ error: 'Approve nahi hua' });
  }
});

// Saare questions list karo (pending approval)
router.get('/questions', adminAuth, async (req, res) => {
  try {
    const { approved } = req.query;
    let query = supabase.from('questions').select('*').order('created_at', { ascending: false });
    
    if (approved !== undefined) {
      query = query.eq('approved', approved === 'true');
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json({ questions: data });
  } catch (error) {
    res.status(500).json({ error: 'Questions nahi mile' });
  }
});

// Ad campaign banao
router.post('/campaigns', adminAuth, async (req, res) => {
  try {
    const { advertiser_id, image_url, target_states, budget, start_date, end_date } = req.body;

    const { data, error } = await supabase
      .from('ads')
      .insert([{
        advertiser_id,
        image_url,
        target_states: target_states || [],
        budget,
        start_date,
        end_date,
        status: 'pending'
      }])
      .select()
      .single();

    if (error) throw error;
    res.json({ campaign: data });
  } catch (error) {
    res.status(500).json({ error: 'Campaign nahi bana' });
  }
});

// Campaign stats
router.get('/campaigns/:id/stats', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: impressions } = await supabase
      .from('ad_events')
      .select('id', { count: 'exact' })
      .eq('ad_id', id)
      .eq('type', 'impression');

    const { data: clicks } = await supabase
      .from('ad_events')
      .select('id', { count: 'exact' })
      .eq('ad_id', id)
      .eq('type', 'click');

    res.json({
      ad_id: id,
      impressions: impressions?.length || 0,
      clicks: clicks?.length || 0,
      ctr: impressions?.length ? ((clicks?.length / impressions?.length) * 100).toFixed(2) + '%' : '0%'
    });
  } catch (error) {
    res.status(500).json({ error: 'Stats nahi mile' });
  }
});

// Revenue dashboard
router.get('/revenue-dashboard', adminAuth, async (req, res) => {
  try {
    const { data: users } = await supabase
      .from('users')
      .select('id', { count: 'exact' });

    const { data: sessions } = await supabase
      .from('game_sessions')
      .select('id', { count: 'exact' });

    const { data: activeAds } = await supabase
      .from('ads')
      .select('id, budget')
      .eq('status', 'active');

    const totalBudget = activeAds?.reduce((sum, ad) => sum + (ad.budget || 0), 0) || 0;

    res.json({
      total_users: users?.length || 0,
      total_games_played: sessions?.length || 0,
      active_campaigns: activeAds?.length || 0,
      total_ad_budget: totalBudget
    });
  } catch (error) {
    res.status(500).json({ error: 'Dashboard data nahi mila' });
  }
});

module.exports = router;
