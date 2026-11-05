// Battle rules, same as the Android app's BattleEngine.kt, so online and offline matches feel identical.
// Pure functions: no timers, no sockets.

const RULES = Object.freeze({
  MAX_HP: 100,
  ROUND_MS: 6000,
  REVEAL_MS: 2200,
  BASE_DAMAGE: 14,
  MAX_SPEED_BONUS: 8,
  SPECIAL_DAMAGE: 30,
  BLUNDER_DAMAGE: 8,
  COMBO_FOR_SPECIAL: 3,
  FAST_MS: 2000,
});

const other = (side) => (side === 'P1' ? 'P2' : 'P1');

const newFighter = () => ({ hp: RULES.MAX_HP, combo: 0, hits: 0 });

const newState = () => ({ P1: newFighter(), P2: newFighter(), round: 0, winner: null });

function finishRound(state) {
  let winner = null;
  if (state.P2.hp <= 0) winner = 'P1';
  else if (state.P1.hp <= 0) winner = 'P2';
  return { ...state, round: state.round + 1, winner };
}

/** First answer of a round. Right = hit the other fighter (faster = harder). Wrong = blunder damage to yourself. */
function resolve(state, side, correct, answeredAfterMs) {
  if (state.winner) return { state, outcome: { kind: 'timeup' } };
  const me = state[side];
  if (correct) {
    const combo = me.combo + 1;
    const special = combo % RULES.COMBO_FOR_SPECIAL === 0;
    const ms = Math.min(Math.max(answeredAfterMs, 0), RULES.ROUND_MS);
    const fast = ms < RULES.FAST_MS;
    const speedShare = 1 - ms / RULES.ROUND_MS;
    const damage = special
      ? RULES.SPECIAL_DAMAGE
      : RULES.BASE_DAMAGE + Math.round(RULES.MAX_SPEED_BONUS * speedShare);
    const them = state[other(side)];
    const next = {
      ...state,
      [side]: { ...me, combo, hits: me.hits + 1 },
      [other(side)]: { ...them, hp: Math.max(them.hp - damage, 0), combo: 0 },
    };
    return { state: finishRound(next), outcome: { kind: 'hit', side, damage, special, fast } };
  }
  const next = {
    ...state,
    [side]: { ...me, hp: Math.max(me.hp - RULES.BLUNDER_DAMAGE, 0), combo: 0 },
  };
  return { state: finishRound(next), outcome: { kind: 'blunder', side, damage: RULES.BLUNDER_DAMAGE } };
}

function timeUp(state) {
  return { state: { ...state, round: state.round + 1 }, outcome: { kind: 'timeup' } };
}

/** When the questions run out: more HP wins, equal HP is a draw. */
function decideOnPoints(state) {
  if (state.P1.hp === state.P2.hp) return { ...state, winner: 'DRAW' };
  return { ...state, winner: state.P1.hp > state.P2.hp ? 'P1' : 'P2' };
}

module.exports = { RULES, other, newState, resolve, timeUp, decideOnPoints };
