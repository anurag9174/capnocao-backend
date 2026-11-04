require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const questionsRoutes = require('./routes/questions');
const gameRoutes = require('./routes/game');
const userRoutes = require('./routes/user');
const adsRoutes = require('./routes/ads');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({
    message: '🇮🇳 Cap or No Cap — Neta Edition Backend',
    status: 'Server chal raha hai!',
    version: '1.0.0'
  });
});

// Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/questions', questionsRoutes);
app.use('/api/v1/game', gameRoutes);
app.use('/api/v1/user', userRoutes);
app.use('/api/v1/ads', adsRoutes);
app.use('/api/v1/admin', adminRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Yeh route nahi mila bhai' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Server mein kuch gadbad ho gayi' });
});

app.listen(PORT, () => {
  console.log(`🚀 Server start ho gaya port ${PORT} pe!`);
  console.log(`🌐 Health check: http://localhost:${PORT}`);
});
