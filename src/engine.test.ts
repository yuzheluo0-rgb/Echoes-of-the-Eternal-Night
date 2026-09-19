import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, beginNextRound, createCombat, exchangeCards, getFormation, isValidSave, legalTargets, living, resolveRound, ringBell } from './engine.ts';
import type { CardId, CombatState } from './engine.ts';

function training(ids: CardId[] = ['C01', 'C07', 'C13']): CombatState {
  const s = createCombat();
  s.enemies = [{ uid: 'training', id: 'E01', lane: 1, hp: 999, maxHp: 999, armor: 0, attack: 14, burn: 0, dead: false }];
  s.intentIds = ['training']; s.waves.forEach(w => { w.entered = true; });
  s.hand = ids.map((id, i) => ({ uid: `test-${i}`, id }));
  return s;
}
test('document section 19: 48 life damage, 60 life, 10 shield, 4 echo; next round clears shield', () => {
  const s = training(); const before = structuredClone(s);
  const { state, frames } = resolveRound(s, { cards: s.hand.map(c => c.uid), lane: 1, frenzy: false });
  assert.equal(state.enemies[0].hp, 951);
  assert.equal(state.hp, 60); assert.equal(state.shield, 10); assert.equal(state.echo, 4);
  assert.equal(beginNextRound(state).shield, 0);
  assert.equal(frames.filter(f => f.kind === 'weapon').length, 4);
  assert.deepEqual(s, before, 'resolution never mutates its input');
});
test('formation combines number and suit structures; whetstone applies after base', () => {
  assert.deepEqual(getFormation([CARDS.C01, CARDS.C07, CARDS.C13]), { name: '对子', base: 1.2, multiplier: 1.2, pattern: '三不同印', shield: 8, sameSuit: undefined, whetstone: false });
  const straight = getFormation([CARDS.C01, CARDS.C02, CARDS.C13]);
  assert.equal(straight.name, '顺阶'); assert.equal(straight.multiplier, 1.8);
  assert.equal(getFormation([CARDS.C01, CARDS.C01, CARDS.C01]).multiplier, 2.1);
  assert.equal(getFormation([CARDS.C01, CARDS.C02]).name, '散牌');
});
test('mulligan cannot draw a returned instance, even at reshuffle; same seed replays', () => {
  const s = createCombat(); s.discard.push(...s.draw); s.draw = [];
  const ids = s.hand.slice(0, 2).map(c => c.uid);
  const a = exchangeCards(s, ids); const b = exchangeCards(s, ids);
  assert.deepEqual(a, b); assert.ok(a.hand.every(c => !ids.includes(c.uid)));
  assert.equal(new Set([...a.hand, ...a.draw, ...a.discard].map(c => c.uid)).size, 12);
  assert.throws(() => exchangeCards(a, [a.hand[0].uid]));
});
test('bell consumes the next wave once and republishes only legal intentions', () => {
  const a = ringBell(createCombat());
  assert.equal(living(a).length, 6); assert.equal(a.rung, true);
  assert.equal(a.intentIds.length, 5, 'rear melee guardian cannot attack this round');
  assert.throws(() => ringBell(a));
  a.rung = false; a.waves.forEach(w => { w.entered = true; }); assert.throws(() => ringBell(a));
});
test('rear melee cannot act after front dies; a guard protects single-target selection', () => {
  const s = training(['C01']);
  s.enemies = [{ uid: 'front', id: 'E02', lane: 1, hp: 1, maxHp: 20, armor: 0, attack: 4, burn: 0, dead: false }, { uid: 'back', id: 'E01', lane: 1, hp: 100, maxHp: 100, armor: 0, attack: 50, burn: 0, dead: false }];
  s.intentIds = ['front'];
  assert.deepEqual(legalTargets(s).map(e => e.uid), ['front']);
  assert.throws(() => resolveRound(s, { cards: ['test-0'], lane: 1, target: 'back', frenzy: false }));
  const out = resolveRound(s, { cards: ['test-0'], lane: 1, target: 'front', frenzy: false });
  assert.equal(out.state.hp, 60); assert.equal(out.frames.filter(f => f.kind === 'enemy').length, 0);
});
test('burn is not applied after a direct lethal hit; deaths award experience once', () => {
  const s = training(['C07']); s.enemies[0].hp = 4;
  const out = resolveRound(s, { cards: ['test-0'], lane: 1, frenzy: false });
  assert.equal(out.state.enemies[0].burn, 0); assert.equal(out.state.xp, 1);
  assert.equal(out.frames.filter(f => f.kind === 'death').length, 1);
});
test('echo is a damage copy and does not gain shield or echo; frenzy is opt-in', () => {
  const s = training(['C13', 'C13', 'C13']); s.enemies[0].attack = 0;
  const ordinary = resolveRound(s, { cards: s.hand.map(c => c.uid), lane: 1, frenzy: false });
  assert.equal(ordinary.state.shield, 40); assert.equal(ordinary.state.echo, 5);
  assert.equal(ordinary.frames.filter(f => f.kind === 'echo').length, 1);
  s.echo = 12;
  const frenzy = resolveRound(s, { cards: [], lane: 1, frenzy: true });
  assert.equal(frenzy.state.echo, 2); assert.equal(frenzy.state.shield, 13);
  assert.equal(frenzy.frames.filter(f => f.kind === 'echo' && f.suit).length, 2);
  s.echo = 11; assert.throws(() => resolveRound(s, { cards: [], lane: 1, frenzy: true }));
});
test('new-game save validates; malformed storage safely rejected', () => {
  assert.ok(isValidSave(createCombat()));
  for (const invalid of [null, {}, { ...createCombat(), hp: -1 }, { ...createCombat(), hand: null }, { ...createCombat(), waves: [null, null, null] }]) assert.equal(isValidSave(invalid), false);
});
test('many fixed-seed expeditions preserve deck, integer, resource and terminal invariants', () => {
  for (let seed = 1; seed <= 40; seed++) {
    let s = createCombat(seed);
    while (s.status === 'playing' && s.round < 20) {
      const out = resolveRound(s, { cards: s.hand.slice(0, 3).map(c => c.uid), lane: (s.round % 3) as 0 | 1 | 2, frenzy: s.echo === 12 });
      s = beginNextRound(out.state);
      assert.ok(isValidSave(s), `seed ${seed} round ${s.round}`);
      assert.equal(new Set([...s.hand, ...s.draw, ...s.discard].map(c => c.uid)).size, 12);
      assert.ok(s.hp >= 0 && s.echo <= 12 && s.shield <= 40);
      assert.ok(s.enemies.every(e => Number.isInteger(e.hp) && e.hp >= 0));
    }
    assert.notEqual(s.status, 'playing');
  }
});
