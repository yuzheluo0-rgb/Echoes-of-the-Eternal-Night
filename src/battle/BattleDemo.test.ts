/**
 * The battle demo's contract with the engine, and its contract with itself.
 *
 * The page itself cannot be imported here — it is `.tsx` behind a stylesheet, and node's type
 * stripping neither parses JSX nor resolves CSS. So this file tests the two things that *can* be
 * checked without a browser:
 *
 *   1. everything the demo leans on in `engine.ts` — the opening hand, the full-round loop, the
 *      intent text that the enemy cards print, and the fact that a hand is always renderable;
 *   2. the tour, by reading `BattleDemo.tsx` as text. `TOUR_TARGETS` is exported for exactly this:
 *      a spotlight aimed at a class that does not exist dims the whole screen and explains nothing,
 *      and that is a failure no type checker can catch.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canPlay, endTurn, intentFor, intentText, isValidBattle, livingEnemies, playCard, startBattle, type BattleCard, type BattleState } from './engine.ts';
import { ENCOUNTERS, ENEMY_BY_ID } from './enemies.ts';
import { starterDeck } from './chapter.ts';
import { CARD_BY_ID, DECK_IDS, type DeckId } from '../cards/index.ts';

/** The two decks chapter I hands out. */
const DECKS: DeckId[] = ['blade', 'bone'];
/** Every pile a card can be in, exhaust included — the demo shows all three of them. */
const pile = (s: BattleState): BattleCard[] => [...s.hand, ...s.draw, ...s.discard, ...s.exhaust];
const count = (s: BattleState): number => pile(s).length;
/** The engine never uses `Math.random`, and neither do the tests. */
function lcg(seed: number) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

// ------------------------------------------------------------- 1. the opening

test('荒野巡夜开局：合法、五张手牌、两只影狼', () => {
  const s = startBattle('ch1-1', 'blade', 7);
  assert.ok(isValidBattle(s), '开局状态必须是合法的存档');
  assert.equal(s.encounterId, 'ch1-1');
  assert.equal(s.deck, 'blade');
  assert.equal(s.phase, 'player');
  assert.equal(s.turn, 1);
  assert.equal(s.hand.length, 5, '开局抽 5 张');
  assert.equal(s.player.energy, 3, '开局 3 点能量');
  assert.equal(s.player.hp, s.player.maxHp);
  assert.equal(s.enemies.length, 2);
  assert.deepEqual(s.enemies.map(enemy => enemy.id), ['shadewolf', 'shadewolf']);
  assert.equal(s.targetUid, s.enemies[0].uid, '第一个敌人默认是目标');
  // 影狼是聚群的：头顶写的数字必须比脚本里的 5 大。存下来的 intent 是脚本原文，页面不能直接读它。
  const raw = s.enemies[0].intent[0];
  const shown = intentFor(s, s.enemies[0])[0];
  assert.equal(raw.kind, 'attack');
  assert.equal(shown.kind, 'attack');
  assert.equal(raw.kind === 'attack' ? raw.amount : -1, 5, '存下来的是脚本原文');
  assert.equal(shown.kind === 'attack' ? shown.amount : -1, 7, '展示的是加上同伴之后的数字');
  assert.equal(intentText(shown), '攻击 7');
});

// --------------------------------------------------- 2. a whole battle, played

test('用 starterDeck 打完整局：牌数守恒、生命不越界、必然分出胜负', () => {
  for (const seed of [1, 3, 7, 11, 19, 23, 42, 97]) {
    const roll = lcg(seed);
    let s = startBattle('ch1-1', 'blade', seed);
    const total = count(s);
    assert.equal(total, starterDeck('blade').length, '开局时全副牌都在场上');

    for (let guard = 0; guard < 600 && s.phase === 'player'; guard++) {
      const playable = s.hand.filter(card => canPlay(s, card.uid));
      if (!playable.length) {
        s = endTurn(s);
      } else {
        const card = playable[Math.floor(roll() * playable.length)];
        const alive = livingEnemies(s);
        const target = alive[Math.floor(roll() * alive.length)];
        s = playCard(s, card.uid, target?.uid);
      }
      assert.equal(count(s), total, `种子 ${seed}：牌总数必须守恒`);
      assert.ok(isValidBattle(s), `种子 ${seed}：每一步之后状态都得是合法的`);
      assert.ok(s.player.hp >= 0 && s.player.hp <= s.player.maxHp, `种子 ${seed}：生命越界`);
      assert.ok(s.player.block >= 0 && s.player.energy >= 0);
      for (const enemy of s.enemies) {
        assert.ok(enemy.hp >= 0 && enemy.hp <= enemy.maxHp, `种子 ${seed}：敌人生命越界`);
        assert.ok(enemy.block >= 0);
      }
    }
    assert.ok(s.phase === 'won' || s.phase === 'lost', `种子 ${seed}：打不完（${s.phase}）`);
    assert.equal(count(s), total, '战斗结束时牌一张不多一张不少');
  }
});

// ------------------------------------------------------ 3. the whole chapter

test('第一章五场遭遇战都能开起来', () => {
  assert.equal(ENCOUNTERS.length, 5);
  for (const deck of DECKS) {
    for (const encounter of ENCOUNTERS) {
      const s = startBattle(encounter.id, deck, 5);
      assert.ok(isValidBattle(s), `${encounter.id} / ${deck} 开局不合法`);
      assert.equal(s.encounterId, encounter.id);
      assert.equal(s.enemies.length, encounter.units.length, `${encounter.id} 的敌人数量对不上`);
      assert.deepEqual(s.enemies.map(enemy => enemy.id), encounter.units);
      assert.equal(s.hand.length, 5);
      assert.ok(s.turn >= 1);
      assert.ok(livingEnemies(s).length === s.enemies.length, '开局不该有人躺着');
      for (const enemy of s.enemies) {
        assert.ok(ENEMY_BY_ID.has(enemy.id), `${enemy.id} 不在图鉴里`);
        assert.ok(intentFor(s, enemy).every(intent => intentText(intent).length > 0), '意图必须有字');
      }
    }
  }
});

// ---------------------------------------------------------------- 4. the tour

const SOURCE = readFileSync(new URL('./BattleDemo.tsx', import.meta.url), 'utf8');
const TARGET_BLOCK = /export const TOUR_TARGETS: string\[\] = \[([\s\S]*?)\];/.exec(SOURCE);
/** The page without its own selector list — so a class found below is found in the *page*. */
const PAGE = TARGET_BLOCK ? SOURCE.replace(TARGET_BLOCK[0], '') : SOURCE;

test('引导的每个选择器都指向页面里真实存在的 class', () => {
  assert.ok(TARGET_BLOCK, 'BattleDemo.tsx 里必须有 TOUR_TARGETS 字面量');
  const targets = [...TARGET_BLOCK[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
  assert.ok(targets.length >= 6, `引导至少要指向六处，现在只有 ${targets.length} 处`);
  for (const target of targets) {
    assert.ok(typeof target === 'string' && target.trim().length > 0, '选择器不能是空串');
  }
  assert.equal(new Set(targets).size, targets.length, '选择器不能重复（重复说明有一步白指了）');

  const classes = [...new Set(targets.flatMap(target => target.split(',').map(part => part.trim())))];
  for (const selector of classes) {
    assert.match(selector, /^\.[a-z][a-z0-9-]*$/, `${selector} 必须是一个单纯的 class 选择器`);
    const name = selector.slice(1);
    assert.ok(PAGE.includes(name), `${selector} 在页面里根本不存在`);
    const line = PAGE.split('\n').find(text => text.includes(name) && text.includes('className'));
    assert.ok(line, `${selector} 出现在页面里，但不是任何 className —— 聚光灯会照空`);
  }
});

test('引导是八步，每步都指着 TOUR_TARGETS 里的东西', () => {
  const targets = [...(TARGET_BLOCK?.[1] ?? '').matchAll(/'([^']+)'/g)].map(match => match[1]);
  const steps = SOURCE.split('export const TOUR_STEPS').pop()!.split('export const TOUR_TARGETS')[0];
  assert.equal((steps.match(/\bid: '/g) ?? []).length, 8, '引导必须是八步');
  assert.equal((steps.match(/\btitle: '/g) ?? []).length, 8);
  assert.equal((steps.match(/\bbody: '/g) ?? []).length, 8);
  const used = [...steps.matchAll(/target: '([^']+)'/g)].map(match => match[1]);
  assert.ok(used.length >= 5, '有目标的步骤至少要五步');
  for (const target of used) assert.ok(targets.includes(target), `${target} 不在 TOUR_TARGETS 里`);
  assert.equal(new Set(used).size, used.length, '两步指着同一处，读起来会像是卡住了');
});

// ------------------------------------------------------- 5. what the page shows

test('手牌永远渲染得出来：能抽到的牌都有卡面，异物另算', () => {
  for (const deck of DECKS) {
    for (const cardId of starterDeck(deck)) {
      const card = CARD_BY_ID.get(cardId);
      assert.ok(card, `${deck} 里的 ${cardId} 没有卡面，手牌会渲染成空白`);
      assert.ok(card.name.length > 0 && card.text.length > 0);
      assert.ok(card.cost >= 0, `${cardId} 打不出来，却能被抽到`);
    }
  }
});

test('同种子同操作给出同一场战斗（demo 的重新开始只换种子）', () => {
  const run = (seed: number) => {
    let s = startBattle('ch1-1', 'blade', seed);
    const roll = lcg(seed);
    for (let i = 0; i < 24 && s.phase === 'player'; i++) {
      const playable = s.hand.filter(card => canPlay(s, card.uid));
      if (!playable.length) { s = endTurn(s); continue; }
      const card = playable[Math.floor(roll() * playable.length)];
      s = playCard(s, card.uid, livingEnemies(s)[0]?.uid);
    }
    return s;
  };
  const a = run(7), b = run(7);
  assert.deepEqual(a, b, '同样的种子必须走出同样的一局');
  assert.notDeepEqual(a.draw, run(8).draw, '换种子就该换洗牌');
  assert.ok(DECK_IDS.includes('blade'));
});
