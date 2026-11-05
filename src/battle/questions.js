// Questions for an online battle. The room creator's phone sends a ready-made set (it already
// avoids quotes the player has seen); if that is missing or broken, the server picks from Supabase.
// The answers stay on the server and are only revealed after each round.

const supabase = require('../config/supabase');
const { shuffle } = require('../lib/random');

const MIN = 5;
const MAX = 40;

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function clean(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const q of list.slice(0, MAX * 2)) {
    if (!q || typeof q !== 'object' || typeof q.isReal !== 'boolean') continue;
    const quote = str(q.quote, 300);
    if (!quote) continue;
    const key = quote.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: str(q.id, 64),
      quote,
      by: str(q.by, 80) || 'Neta Ji',
      isReal: q.isReal,
      explanation: str(q.explanation, 400) || null,
    });
    if (out.length >= MAX) break;
  }
  return out;
}

async function fromDatabase(count) {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('questions')
      .select('id, quote, neta_name, is_cap')
      .eq('approved', true)
      .limit(500);
    if (error || !data) return [];
    return clean(
      shuffle(data).map((r) => ({ id: String(r.id), quote: r.quote, by: r.neta_name, isReal: !r.is_cap }))
    ).slice(0, count);
  } catch (e) {
    console.error('Battle questions DB error:', e.message);
    return [];
  }
}

/** Returns a usable set, or [] if there is nothing at all. */
async function questionSet(supplied, count = 30) {
  const fromPhone = clean(supplied);
  if (fromPhone.length >= MIN) return fromPhone;
  const fromDb = await fromDatabase(count);
  return fromDb.length >= MIN ? fromDb : [];
}

module.exports = { questionSet, clean, MIN, MAX };
