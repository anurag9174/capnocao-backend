require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const questionsRoutes = require('./routes/questions');
const gameRoutes = require('./routes/game');
const userRoutes = require('./routes/user');
const adsRoutes = require('./routes/ads');
const adminRoutes = require('./routes/admin');
const battleSocket = require('./battle/socket');
const battleRooms = require('./battle/rooms');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1); // behind Railway's proxy
app.disable('x-powered-by');

// Middleware
app.use(cors());
app.use(express.json({ limit: '100kb' }));

// Health check
app.get('/', (req, res) => {
  res.json({
    message: '🇮🇳 Cap or No Cap — Neta Edition Backend',
    status: 'Server chal raha hai!',
    version: '1.1.0',
    battle: battleRooms.stats(),
  });
});

// Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/questions', questionsRoutes);
app.use('/api/v1/game', gameRoutes);
app.use('/api/v1/user', userRoutes);
app.use('/api/v1/ads', adsRoutes);
app.use('/api/v1/admin', adminRoutes);
app.get('/api/v1/battle/stats', (req, res) => res.json(battleRooms.stats()));

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Yeh route nahi mila bhai' });
});

// Error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON theek nahi hai' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request bahut badi hai' });
  console.error('Server error:', err);
  res.status(500).json({ error: 'Server mein kuch gadbad ho gayi' });
});

const server = http.createServer(app);
battleSocket.attach(server);

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`🚀 Server start ho gaya port ${PORT} pe!`);
    console.log(`🌐 Health check: http://localhost:${PORT}`);
    console.log(`⚔️  Online battle: ws://localhost:${PORT}/ws/battle`);
  });
}

process.on('unhandledRejection', (e) => console.error('Unhandled rejection:', e));

module.exports = { app, server };
