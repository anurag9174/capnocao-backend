const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { needDb } = require('../middleware/auth');

// Admin auth: the x-admin-key header must match ADMIN_SECRET_KEY. If the key isn't configured on
// the server, admin is switched OFF (before this fix, a missing key let everyone in).
const adminAuth = (req, res, next) => {
  const expected = process.env.ADMIN_SECRET_KEY || '';
  const given = String(req.headers['x-admin-key'] || '');
  const ok =
    expected.length >= 16 &&
    given.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) return res.status(403).json({ error: 'Admin access denied' });
  next();
};

router.use(adminAuth, needDb);

const count = async (table, filter) => {
  let q = supabase.from(table).select('id', { count: 'exact', head: true });
  if (filter) q = filter(q);
  const { count: n, error } = await q;
  if (error) throw error;
  return n || 0;
};

// Naya question add karo
router.post('/questions/create', async (req, res) => {
  try {
    const { quote, neta_name, is_cap, category, source_url } = req.body || {};

    if (typeof quote !== 'string' || !quote.trim() || typeof neta_name !== 'string' || !neta_name.trim() || typeof is_cap !== 'boolean') {
      return res.status(400).json({ error: 'quote, neta_name (text) aur is_cap (true/false) required hai' });
    }

    const { data, error } = await supabase
      .from('questions')
      .insert([{
        quote: quote.trim().slice(0, 300),
        neta_name: neta_name.trim().slice(0, 80),
        is_cap,
        category: typeof category === 'string' ? category.slice(0, 40) : null,
        source_url: typeof source_url === 'string' ? source_url.slice(0, 500) : null,
        approved: false,
      }])
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
router.put('/questions/:id/approve', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('questions')
      .update({ approved: true })
      .eq('id', req.params.id)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Question nahi mila' });
    res.json({ question: data, message: 'Question approve ho gaya!' });
  } catch (error) {
    console.error('Approve error:', error);
    res.status(500).json({ error: 'Approve nahi hua' });
  }
});

// Saare questions list karo (pending approval)
router.get('/questions', async (req, res) => {
  try {
    const { approved } = req.query;
    let query = supabase.from('questions').select('*').order('created_at', { ascending: false }).limit(500);
    if (approved === 'true' || approved === 'false') query = query.eq('approved', approved === 'true');

    const { data, error } = await query;
    if (error) throw error;
    res.json({ questions: data });
  } catch (error) {
    res.status(500).json({ error: 'Questions nahi mile' });
  }
});

// Ad campaign banao
router.post('/campaigns', async (req, res) => {
  try {
    const { advertiser_id, image_url, target_states, budget, start_date, end_date } = req.body || {};
    if (!image_url || !start_date || !end_date) {
      return res.status(400).json({ error: 'image_url, start_date, end_date required hai' });
    }

    const { data, error } = await supabase
      .from('ads')
      .insert([{
        advertiser_id,
        image_url,
        target_states: Array.isArray(target_states) ? target_states : [],
        budget: Number(budget) || 0,
        start_date,
        end_date,
        status: 'pending',
      }])
      .select()
      .single();

    if (error) throw error;
    res.json({ campaign: data });
  } catch (error) {
    console.error('Campaign error:', error);
    res.status(500).json({ error: 'Campaign nahi bana' });
  }
});

// Campaign stats
router.get('/campaigns/:id/stats', async (req, res) => {
  try {
    const { id } = req.params;
    const impressions = await count('ad_events', (q) => q.eq('ad_id', id).eq('type', 'impression'));
    const clicks = await count('ad_events', (q) => q.eq('ad_id', id).eq('type', 'click'));

    res.json({
      ad_id: id,
      impressions,
      clicks,
      ctr: impressions ? ((clicks / impressions) * 100).toFixed(2) + '%' : '0%',
    });
  } catch (error) {
    res.status(500).json({ error: 'Stats nahi mile' });
  }
});

// Revenue dashboard
router.get('/revenue-dashboard', async (req, res) => {
  try {
    // Real counts (the old version counted fetched rows, which stops at 1000).
    const totalUsers = await count('users');
    const totalGames = await count('game_sessions');

    const { data: activeAds, error } = await supabase.from('ads').select('id, budget').eq('status', 'active');
    if (error) throw error;
    const totalBudget = (activeAds || []).reduce((sum, ad) => sum + (Number(ad.budget) || 0), 0);

    res.json({
      total_users: totalUsers,
      total_games_played: totalGames,
      active_campaigns: activeAds?.length || 0,
      total_ad_budget: totalBudget,
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: 'Dashboard data nahi mila' });
  }
});

module.exports = router;
