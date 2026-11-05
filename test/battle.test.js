// Run: npm test
// Two fake phones connect to a local server and play online battles end to end.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');

process.env.PORT = '0';
const { server } = require('../src/index');
const rooms = require('../src/battle/rooms');
const engine = require('../src/battle/engine');

let url;
before(() => new Promise((r) => server.listen(0, () => { url = `ws://127.0.0.1:${server.address().port}/ws/battle`; r(); })));
after(() => { rooms._reset(); server.closeAllConnections?.(); server.close(); setTimeout(() => process.exit(process.exitCode || 0), 300).unref(); });

const QUESTIONS = Array.from({ length: 12 }, (_, i) => ({
  id: `q${i}`, quote: `Quote number ${i}`, by: 'Neta Ji', isReal: i % 2 === 0, explanation: `Why ${i}`,
}));

function phone(name, fighter = 'voter') {
  const ws = new WebSocket(url);
  const inbox = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    const i = waiters.findIndex((w) => w.pred(m));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(m);
    else inbox.push(m);
  });
  const api = {
    ws,
    send: (m) => ws.send(JSON.stringify(m)),
    next(pred, ms = 9000) {
      const p = typeof pred === 'string' ? (m) => m.t === pred : pred;
      const i = inbox.findIndex(p);
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const w = { pred: p, resolve };
        waiters.push(w);
        setTimeout(() => { const k = waiters.indexOf(w); if (k >= 0) { waiters.splice(k, 1); reject(new Error(`${name}: timed out waiting`)); } }, ms);
      });
    },
    open: () => new Promise((r) => (ws.readyState === 1 ? r() : ws.once('open', r))),
    close: () => ws.close(),
  };
  return api;
}

async function hello(p, extra = {}) {
  await p.open();
  p.send({ t: 'hello', name: 'Tester', fighter: 'anchor', ...extra });
  return p.next('welcome');
}

test('engine: right answer hits, wrong answer blunders, KO ends it', () => {
  let s = engine.newState();
  let r = engine.resolve(s, 'P1', true, 0);
  assert.equal(r.outcome.kind, 'hit');
  assert.equal(r.state.P2.hp, 100 - 22);
  r = engine.resolve(r.state, 'P2', false, 1000);
  assert.equal(r.outcome.kind, 'blunder');
  assert.equal(r.state.P2.hp, 100 - 22 - 8);
  s = { ...r.state, P2: { ...r.state.P2, hp: 5 } };
  r = engine.resolve(s, 'P1', true, 5000);
  assert.equal(r.state.winner, 'P1');
  assert.equal(engine.decideOnPoints({ ...engine.newState() }).winner, 'DRAW');
});

test('friend room: create, join with code, play, server decides first answer', async () => {
  const a = phone('A'); const b = phone('B');
  await hello(a); await hello(b, { name: 'Dost', fighter: 'uncle' });

  a.send({ t: 'create', questions: QUESTIONS });
  const waiting = await a.next('waiting');
  assert.match(waiting.code, /^[A-Z2-9]{4}$/);

  b.send({ t: 'join', code: waiting.code.toLowerCase() });
  const syncA = await a.next('sync');
  const syncB = await b.next('sync');
  assert.equal(syncA.you, 'P1');
  assert.equal(syncB.you, 'P2');
  assert.equal(syncA.opponent.name, 'Dost');
  assert.equal(syncB.opponent.fighter, 'anchor');

  const round = await a.next('round');
  await b.next('round');
  assert.equal(round.round, 0);
  assert.equal(round.quote, 'Quote number 0');
  assert.equal(round.isReal, undefined, 'answer must not leak before the round ends');

  // Question 0 is real => NO CAP is right. B answers first, A's late tap must be ignored.
  b.send({ t: 'answer', round: 0, noCap: true });
  a.send({ t: 'answer', round: 0, noCap: false });
  const res = await a.next('result');
  await b.next('result');
  assert.equal(res.outcome.kind, 'hit');
  assert.equal(res.outcome.side, 'P2');
  assert.equal(res.isReal, true);
  assert.ok(res.state.P1.hp < 100);
  assert.equal(res.state.P2.hp, 100, 'second tap in the same round changed nothing');

  // Next round arrives after the reveal.
  const r1 = await b.next('round');
  assert.equal(r1.round, 1);

  // A leaves mid-match: B wins by forfeit.
  a.send({ t: 'leave' });
  const over = await b.next('over');
  assert.equal(over.winner, 'P2');
  assert.equal(over.reason, 'left');
  a.close(); b.close();
});

test('bad codes and full rooms give clear errors', async () => {
  const a = phone('A'); const b = phone('B'); const c = phone('C');
  await hello(a); await hello(b); await hello(c);
  b.send({ t: 'join', code: 'ZZZZ' });
  assert.equal((await b.next('error')).code, 'no_room');

  a.send({ t: 'create', questions: QUESTIONS });
  const { code } = await a.next('waiting');
  a.send({ t: 'join', code });
  assert.equal((await a.next('error')).code, 'own_room');
  b.send({ t: 'join', code });
  await b.next('sync');
  c.send({ t: 'join', code });
  assert.equal((await c.next('error')).code, 'room_full');

  a.send({ t: 'create', questions: [] }); // no valid questions, no DB in tests
  assert.equal((await a.next((m) => m.t === 'error')).code, 'no_questions');
  [a, b, c].forEach((p) => p.close());
});

test('quick match pairs two strangers', async () => {
  const a = phone('A'); const b = phone('B');
  await hello(a); await hello(b);
  a.send({ t: 'quick', questions: QUESTIONS });
  await a.next('searching');
  b.send({ t: 'quick', questions: QUESTIONS });
  const sa = await a.next('sync'); const sb = await b.next('sync');
  assert.equal(sa.code, sb.code);
  assert.notEqual(sa.you, sb.you);
  a.close(); b.close();
});

test('reconnect within the grace period resumes the same match', async () => {
  const a = phone('A'); const b = phone('B');
  const welcomeA = await hello(a); await hello(b);
  a.send({ t: 'create', questions: QUESTIONS });
  const { code } = await a.next('waiting');
  b.send({ t: 'join', code });
  await a.next('sync');
  await b.next('round');

  a.ws.terminate(); // phone A loses network
  await b.next('opponent_away');

  const a2 = phone('A2');
  await a2.open();
  a2.send({ t: 'hello', playerId: welcomeA.playerId, secret: welcomeA.secret });
  const w = await a2.next('welcome');
  assert.equal(w.resumed, true);
  const sync = await a2.next('sync');
  assert.equal(sync.code, code);
  assert.equal(sync.you, 'P1');
  await b.next('opponent_back');

  // Wrong secret can't steal the seat.
  const thief = phone('T');
  await thief.open();
  thief.send({ t: 'hello', playerId: welcomeA.playerId, secret: 'nope' });
  assert.equal((await thief.next('welcome')).resumed, false);
  [a2, b, thief].forEach((p) => p.close());
});

test('full match to KO, then rematch', { timeout: 120000 }, async () => {
  const a = phone('A'); const b = phone('B');
  await hello(a); await hello(b);
  a.send({ t: 'create', questions: QUESTIONS });
  const { code } = await a.next('waiting');
  b.send({ t: 'join', code });

  let over = null;
  while (!over) {
    const m = await a.next((x) => x.t === 'round' || x.t === 'over', 15000);
    if (m.t === 'over') { over = m; break; }
    const isReal = QUESTIONS[m.round].isReal;
    a.send({ t: 'answer', round: m.round, noCap: isReal }); // A always right, instantly
    const r = await a.next((x) => x.t === 'result' || x.t === 'over', 15000);
    if (r.t === 'over') over = r;
  }
  if (over.t !== 'over') over = await a.next('over');
  assert.equal(over.winner, 'P1');
  assert.equal(over.reason, 'ko');
  assert.equal(over.state.P2.hp, 0);

  a.send({ t: 'rematch' });
  await b.next('rematch_wanted');
  b.send({ t: 'rematch' });
  const s = await b.next((m) => m.t === 'sync' && m.phase === 'countdown');
  assert.equal(s.state.P1.hp, 100);
  a.close(); b.close();
});
