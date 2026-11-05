const admin = require('../config/firebase');
const supabase = require('../config/supabase');

const verifyToken = async (req, res, next) => {
  if (!admin.isReady()) return res.status(503).json({ error: 'Login service abhi band hai' });
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token nahi mila' });
  }
  try {
    req.user = await admin.auth().verifyIdToken(authHeader.slice('Bearer '.length).trim());
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

/** Routes that talk to the database answer 503 (not a crash) when it isn't configured. */
const needDb = (req, res, next) => {
  if (!supabase) return res.status(503).json({ error: 'Database abhi available nahi hai' });
  next();
};

module.exports = { verifyToken, needDb };
