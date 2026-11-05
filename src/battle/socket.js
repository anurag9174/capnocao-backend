// WebSocket endpoint for online battles: wss://<host>/ws/battle
//
// Every message is JSON with a "t" (type) field.
// Phone -> server:
//   hello    { name, fighter, token?, playerId?, secret? }   first message; playerId+secret resumes a match
//   create   { questions }      make a room, get a 4-letter code to share
//   join     { code }           join a friend's room
//   quick    { questions }      play a random online opponent
//   answer   { round, noCap }   CAP = noCap:false, NO CAP = noCap:true
//   rematch  { questions? }
//   leave    {}
//   ping     {}
// Server -> phone: welcome, waiting, searching, sync, countdown, round, result, over,
//   opponent_away, opponent_back, opponent_left, rematch_wanted, rematch_waiting, pong, error

const { WebSocketServer } = require('ws');
const admin = require('../config/firebase');
const rooms = require('./rooms');
const { questionSet } = require('./questions');

const HELLO_TIMEOUT_MS = 10000;
const HEARTBEAT_MS = 15000;
const MAX_MSGS_PER_10S = 60;
const FIGHTER_IDS = new Set(['factcheck', 'anchor', 'itcell', 'hashtag', 'rally', 'uncle', 'spokesperson', 'voter']);

const cleanName = (v) => {
  const s = typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24) : '';
  return s || 'Neta Fan';
};

async function uidFrom(token) {
  if (!token || typeof token !== 'string' || !admin.isReady()) return null;
  try {
    return (await admin.auth().verifyIdToken(token)).uid;
  } catch (e) {
    return null; // Online battles don't give XP, so an expired token shouldn't block play.
  }
}

function attach(server) {
  const wss = new WebSocketServer({ server, path: '/ws/battle', maxPayload: 64 * 1024 });

  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      try { ws.ping(); } catch (e) { /* closing */ }
    });
  }, HEARTBEAT_MS);
  heartbeat.unref();
  wss.on("close", () => clearInterval(heartbeat));

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    let player = null;
    let busy = Promise.resolve();
    let msgCount = 0;
    const rateWindow = setInterval(() => { msgCount = 0; }, 10000);
    const helloTimer = setTimeout(() => { if (!player) ws.close(4001, 'no hello'); }, HELLO_TIMEOUT_MS);

    const send = (msg) => {
      if (ws.readyState === 1) ws.send(JSON.stringify(msg));
    };
    const fail = (code, message) => send({ t: 'error', code, message });

    async function handle(msg) {
      if (!player) {
        if (msg.t !== 'hello') return fail('need_hello', 'Pehle hello bhejo');
        clearTimeout(helloTimer);
        const resumed = rooms.findPlayer(msg.playerId, msg.secret);
        if (resumed) {
          player = resumed;
          send({ t: 'welcome', playerId: player.id, secret: player.secret, resumed: true });
          rooms.reconnected(player, ws);
          return;
        }
        player = rooms.newPlayer({
          name: cleanName(msg.name),
          fighter: FIGHTER_IDS.has(msg.fighter) ? msg.fighter : 'voter',
          uid: await uidFrom(msg.token),
        });
        if (ws.readyState !== 1) return rooms.forgetPlayer(player);
        rooms.reconnected(player, ws);
        send({ t: 'welcome', playerId: player.id, secret: player.secret, resumed: false });
        return;
      }

      player.lastSeen = Date.now();
      switch (msg.t) {
        case 'ping':
          return send({ t: 'pong', at: Date.now() });
        case 'profile':
          // Change name / fighter between matches.
          if (!player.room) {
            player.name = cleanName(msg.name);
            if (FIGHTER_IDS.has(msg.fighter)) player.fighter = msg.fighter;
          }
          return;
        case 'create': {
          const qs = await questionSet(msg.questions);
          if (!qs.length) return fail('no_questions', 'Sawaal load nahi hue, dobara try karo');
          return rooms.createRoom(player, qs);
        }
        case 'join':
          return rooms.joinRoom(player, msg.code);
        case 'quick': {
          const qs = await questionSet(msg.questions);
          if (!qs.length) return fail('no_questions', 'Sawaal load nahi hue, dobara try karo');
          return rooms.quickMatch(player, qs);
        }
        case 'answer':
          if (player.room) player.room.answer(player.side, msg.round, msg.noCap);
          return;
        case 'rematch': {
          const qs = msg.questions ? await questionSet(msg.questions) : [];
          return rooms.requestRematch(player, qs);
        }
        case 'leave':
          rooms.leave(player);
          return send({ t: 'left' });
        default:
          return fail('unknown', 'Ye message samajh nahi aaya');
      }
    }

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      msgCount += 1;
      if (msgCount > MAX_MSGS_PER_10S) return; // flood: ignore quietly
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch (e) {
        return fail('bad_json', 'Message theek nahi tha');
      }
      if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return fail('bad_msg', 'Message theek nahi tha');
      // One message at a time per phone, in order (some steps wait for the database).
      busy = busy.then(() => handle(msg)).catch((e) => {
        console.error('Battle socket error:', e);
        fail('server', 'Server mein gadbad, dobara try karo');
      });
    });

    ws.on('close', () => {
      clearTimeout(helloTimer);
      clearInterval(rateWindow);
      // Only if this socket is still the player's current one (a resume may have replaced it).
      if (player && player.socket === ws) rooms.disconnected(player);
    });
    ws.on('error', () => { /* 'close' follows */ });
  });

  return wss;
}

module.exports = { attach };
