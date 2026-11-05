// Online Bahas Battle: rooms, matchmaking and the server-side match loop.
// The server owns the clock and the answers, so both phones always agree on who hit first,
// and nobody can peek at the answer before the round is over.

const engine = require('./engine');
const { RULES, other } = engine;
const { shuffle, token } = require('../lib/random');

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
const CODE_LENGTH = 4;
const COUNTDOWN_STEPS = 3;
const COUNTDOWN_STEP_MS = 800;
const RECONNECT_GRACE_MS = 20000;
const WAITING_ROOM_TTL_MS = 10 * 60 * 1000;
const FINISHED_ROOM_TTL_MS = 2 * 60 * 1000;

const rooms = new Map(); // code -> Room
const players = new Map(); // playerId -> Player
let quickQueue = null; // a Player waiting for a random opponent (only one can wait at a time)

class Player {
  constructor({ name, fighter, uid }) {
    this.id = token(9);
    this.secret = token(18);
    this.name = name;
    this.fighter = fighter;
    this.uid = uid || null;
    this.socket = null;
    this.room = null;
    this.side = null;
    this.queuedQuestions = null;
    this.awayTimer = null;
    this.lastSeen = Date.now();
  }

  get online() {
    return !!this.socket && this.socket.readyState === 1;
  }

  send(msg) {
    if (!this.online) return;
    try {
      this.socket.send(JSON.stringify(msg));
    } catch (e) {
      // Socket died between the check and the send; the close handler deals with it.
    }
  }

  publicInfo() {
    return { name: this.name, fighter: this.fighter };
  }
}

class Room {
  constructor(code, questions, kind) {
    this.code = code;
    this.kind = kind; // 'code' (friend joins with the code) | 'quick' (random opponent)
    this.questions = questions;
    this.players = { P1: null, P2: null };
    this.phase = 'waiting'; // waiting | countdown | round | reveal | over
    this.state = engine.newState();
    this.timers = new Set();
    this.roundStartedAt = 0;
    this.current = null; // question being played
    this.lastResult = null;
    this.overReason = null;
    this.rematch = { P1: false, P2: false };
    this.rematchQuestions = null;
    this.createdAt = Date.now();
    this.expiry = null;
    this.setExpiry(WAITING_ROOM_TTL_MS);
  }

  later(ms, fn) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
    return t;
  }

  clearTimers() {
    this.timers.forEach(clearTimeout);
    this.timers.clear();
  }

  setExpiry(ms) {
    if (this.expiry) clearTimeout(this.expiry);
    this.expiry = setTimeout(() => destroyRoom(this, 'expired'), ms);
    this.expiry.unref();
  }

  both() {
    return [this.players.P1, this.players.P2].filter(Boolean);
  }

  broadcast(msg) {
    this.both().forEach((p) => p.send(msg));
  }

  /** Everything a phone needs to draw the match right now (sent on join and after a reconnect). */
  snapshot(forSide) {
    const opp = this.players[other(forSide)];
    return {
      t: 'sync',
      code: this.code,
      you: forSide,
      me: this.players[forSide]?.publicInfo() || null,
      opponent: opp ? { ...opp.publicInfo(), online: opp.online } : null,
      phase: this.phase,
      state: this.state,
      round: this.phase === 'round' ? this.roundMessage() : null,
      result: this.phase === 'reveal' || this.phase === 'over' ? this.lastResult : null,
      winner: this.state.winner,
      reason: this.overReason,
      maxRounds: this.questions.length,
    };
  }

  roundMessage() {
    return {
      t: 'round',
      round: this.state.round,
      quote: this.current.quote,
      by: this.current.by,
      msLeft: Math.max(RULES.ROUND_MS - (Date.now() - this.roundStartedAt), 0),
      roundMs: RULES.ROUND_MS,
      state: this.state,
    };
  }

  start() {
    this.clearTimers();
    this.setExpiry(60 * 60 * 1000); // a running match can't outlive an hour
    this.state = engine.newState();
    this.lastResult = null;
    this.overReason = null;
    this.rematch = { P1: false, P2: false };
    this.phase = 'countdown';
    ['P1', 'P2'].forEach((side) => this.players[side].send(this.snapshot(side)));
    let n = COUNTDOWN_STEPS;
    const tick = () => {
      if (n === 0) return this.nextRound();
      this.broadcast({ t: 'countdown', n });
      n -= 1;
      this.later(COUNTDOWN_STEP_MS, tick);
    };
    tick();
  }

  nextRound() {
    if (this.state.winner) return;
    if (this.state.round >= this.questions.length) {
      this.state = engine.decideOnPoints(this.state);
      return this.finish('rounds');
    }
    this.current = this.questions[this.state.round];
    this.phase = 'round';
    this.roundStartedAt = Date.now();
    this.broadcast(this.roundMessage());
    this.later(RULES.ROUND_MS, () => this.settle(engine.timeUp(this.state)));
  }

  answer(side, round, saidNoCap) {
    // Late taps for an old round (network lag) are ignored, as are taps while the result shows.
    if (this.phase !== 'round' || round !== this.state.round || typeof saidNoCap !== 'boolean') return;
    const elapsed = Date.now() - this.roundStartedAt;
    this.settle(engine.resolve(this.state, side, saidNoCap === this.current.isReal, elapsed));
  }

  settle({ state, outcome }) {
    if (this.phase !== 'round') return;
    this.clearTimers();
    this.state = state;
    this.phase = 'reveal';
    this.lastResult = {
      t: 'result',
      round: state.round - 1,
      outcome,
      isReal: this.current.isReal,
      explanation: this.current.explanation,
      state,
    };
    this.broadcast(this.lastResult);
    if (state.winner) return this.finish('ko');
    this.later(RULES.REVEAL_MS, () => this.nextRound());
  }

  finish(reason) {
    this.clearTimers();
    this.phase = 'over';
    this.overReason = reason;
    this.broadcast({ t: 'over', winner: this.state.winner, reason, state: this.state });
    this.setExpiry(FINISHED_ROOM_TTL_MS);
  }

  /** A player left for good (or never came back): the one still here wins. */
  forfeit(side) {
    if (this.phase === 'waiting' || this.phase === 'over') return;
    this.state = { ...this.state, winner: other(side) };
    this.finish('left');
  }
}

function newCode() {
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    if (!rooms.has(code)) return code;
  }
  throw new Error('No free room code');
}

function destroyRoom(room, why) {
  if (!rooms.has(room.code)) return;
  room.clearTimers();
  if (room.expiry) clearTimeout(room.expiry);
  rooms.delete(room.code);
  room.both().forEach((p) => {
    if (why === 'expired' && room.phase === 'waiting') p.send({ t: 'error', code: 'expired', message: 'Room band ho gaya, koi nahi aaya' });
    if (p.room === room) {
      p.room = null;
      p.side = null;
    }
    if (!p.online) forgetPlayer(p);
  });
}

function forgetPlayer(p) {
  if (p.awayTimer) clearTimeout(p.awayTimer);
  if (quickQueue === p) quickQueue = null;
  players.delete(p.id);
}

function seat(room, p, side) {
  room.players[side] = p;
  p.room = room;
  p.side = side;
}

/** Takes a player out of whatever they were in (queue, waiting room, match). */
function leave(p) {
  if (quickQueue === p) quickQueue = null;
  const room = p.room;
  if (!room) return;
  const side = p.side;
  if (room.phase === 'waiting') {
    destroyRoom(room, 'left');
    return;
  }
  room.forfeit(side);
  room.players[side] = null;
  p.room = null;
  p.side = null;
  const opp = room.players[other(side)];
  if (opp) opp.send({ t: 'opponent_left' });
  if (!room.both().length) destroyRoom(room, 'empty');
}

function createRoom(p, questions) {
  leave(p);
  const room = new Room(newCode(), questions, 'code');
  rooms.set(room.code, room);
  seat(room, p, 'P1');
  p.send({ t: 'waiting', code: room.code, kind: 'code' });
}

function joinRoom(p, rawCode) {
  const code = String(rawCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const room = rooms.get(code);
  if (!room) return p.send({ t: 'error', code: 'no_room', message: 'Is code ka koi room nahi mila' });
  if (room.players.P1 === p) return p.send({ t: 'error', code: 'own_room', message: 'Ye aapka hi room hai — code dost ko bhejo' });
  if (room.phase !== 'waiting' || room.players.P2) return p.send({ t: 'error', code: 'room_full', message: 'Is room mein ladai pehle se chal rahi hai' });
  leave(p);
  seat(room, p, 'P2');
  room.start();
}

function quickMatch(p, questions) {
  leave(p);
  const waiting = quickQueue;
  if (waiting && waiting !== p && waiting.online && !waiting.room) {
    quickQueue = null;
    const room = new Room(newCode(), waiting.queuedQuestions || questions, 'quick');
    rooms.set(room.code, room);
    seat(room, waiting, 'P1');
    seat(room, p, 'P2');
    waiting.queuedQuestions = null;
    room.start();
    return;
  }
  p.queuedQuestions = questions;
  quickQueue = p;
  p.send({ t: 'searching' });
}

function requestRematch(p, questions) {
  const room = p.room;
  if (!room) return p.send({ t: 'error', code: 'opponent_gone', message: 'Match khatam ho chuka, naya room banao' });
  if (room.phase !== 'over') return;
  const opp = room.players[other(p.side)];
  if (!opp) return p.send({ t: 'error', code: 'opponent_gone', message: 'Saamne wala chala gaya' });
  room.rematch[p.side] = true;
  if (questions && questions.length) room.rematchQuestions = questions;
  if (room.rematch.P1 && room.rematch.P2) {
    room.questions = room.rematchQuestions || shuffle(room.questions);
    room.rematchQuestions = null;
    room.start();
  } else {
    opp.send({ t: 'rematch_wanted' });
    p.send({ t: 'rematch_waiting' });
  }
}

/** The socket dropped. Give the player a short window to come back before they lose. */
function disconnected(p) {
  p.socket = null;
  if (quickQueue === p) quickQueue = null;
  const room = p.room;
  if (!room) return forgetPlayer(p);
  if (room.phase === 'waiting') {
    // The creator's phone blinked; keep the room for the grace period.
    p.awayTimer = setTimeout(() => {
      if (!p.online) {
        destroyRoom(room, 'left');
        forgetPlayer(p);
      }
    }, RECONNECT_GRACE_MS);
    return;
  }
  const opp = room.players[other(p.side)];
  if (opp) opp.send({ t: 'opponent_away', graceMs: RECONNECT_GRACE_MS });
  p.awayTimer = setTimeout(() => {
    if (p.online) return;
    if (p.room === room) leave(p);
    forgetPlayer(p);
  }, RECONNECT_GRACE_MS);
}

/** Same player, new socket (app came back from background, network switched...). */
function reconnected(p, socket) {
  if (p.socket && p.socket !== socket) {
    try { p.socket.close(4000, 'replaced'); } catch (e) { /* already closed */ }
  }
  p.socket = socket;
  p.lastSeen = Date.now();
  if (p.awayTimer) {
    clearTimeout(p.awayTimer);
    p.awayTimer = null;
  }
  const room = p.room;
  if (!room) return;
  if (room.phase === 'waiting') return p.send({ t: 'waiting', code: room.code, kind: room.kind });
  p.send(room.snapshot(p.side));
  const opp = room.players[other(p.side)];
  if (opp) opp.send({ t: 'opponent_back' });
}

function newPlayer(info) {
  const p = new Player(info);
  players.set(p.id, p);
  return p;
}

function findPlayer(id, secret) {
  const p = players.get(String(id || ''));
  return p && p.secret === secret ? p : null;
}

function stats() {
  let playing = 0;
  rooms.forEach((r) => { if (r.phase !== 'waiting' && r.phase !== 'over') playing += 1; });
  return { online: [...players.values()].filter((p) => p.online).length, matches: playing, searching: quickQueue ? 1 : 0 };
}

// Test hook: wipe everything (used by the local test script only).
function _reset() {
  rooms.forEach((r) => destroyRoom(r, 'reset'));
  players.forEach((p) => forgetPlayer(p));
  quickQueue = null;
}

module.exports = {
  newPlayer, findPlayer, createRoom, joinRoom, quickMatch, requestRematch, leave,
  disconnected, reconnected, stats, forgetPlayer, _reset,
  RECONNECT_GRACE_MS,
};
