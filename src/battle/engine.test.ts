import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENERGY_PER_TURN, FIELD_LIMIT, canPlay, cardCost, cardCostNow, cardName, cardRules, endTurn, enemyName,
  intentFor, intentText, isValidBattle, livingEnemies, playCard, startBattle,
  type BattleCard, type BattleState,
} from './engine.ts';
import { CARD_EFFECTS } from './effects.ts';
import { ENCOUNTERS, ENEMY_BY_ID, MUTATIONS, MUTATION_BY_ID, MUTABLE_RANKS, OATH, POOLS } from './enemies.ts';
import { CHAPTER_1, starterDeck } from './chapter.ts';
import type { DeckId } from '../cards/index.ts';

/** The decks chapter I hands out — three, since 燎原余烬 joined. */
const DECKS: DeckId[] = ['blade', 'flame', 'bone'];
/** Piled everywhere a card can be, hand included. */
const pile = (s: BattleState): BattleCard[] => [...s.hand, ...s.draw, ...s.discard, ...s.exhaust];
const count = (s: BattleState): number => pile(s).length;

/** A state whose hand is exactly these cards, with a full tank of energy. */
function withHand(state: BattleState, cardIds: string[], energy = 3): BattleState {
  const s = structuredClone(state);
  s.hand = cardIds.map((cardId, index) => ({ uid: `rig-${index}`, cardId }));
  s.player.energy = energy;
  return s;
}
function endTurns(s: BattleState, times: number): BattleState {
  let out = s;
  for (let i = 0; i < times; i++) out = endTurn(out);
  return out;
}
/**
 * Damage an enemy has taken. Enemy HP is rolled from a band now (see `ENEMIES`), so asserting an
 * absolute number would be asserting the dice rather than the mechanic — and the mechanic is the
 * only thing these tests are about.
 */
const lost = (enemy: { hp: number; maxHp: number }): number => enemy.maxHp - enemy.hp;

/**
 * Strip whatever 异变 the seed happened to roll. Call it immediately after `startBattle`, before the
 * test sets any statuses of its own.
 *
 * A mutation is not noise to be tolerated, it is a real enemy — a 肿胀的 wolf genuinely keeps its
 * block, which is exactly why the 吞光 test's "clear my own block first" premise stopped holding.
 * But that test is about 吞光, not about 肿胀的, so it takes the plain wolf.
 */
function unmutated(state: BattleState): BattleState {
  const out = structuredClone(state);
  for (const enemy of out.enemies) {
    enemy.mutation = undefined;
    enemy.statuses = {};
  }
  return out;
}

/** The engine never uses Math.random, and neither do the tests. */
function lcg(seed: number) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

// --------------------------------------------------------------- 1. determinism

test('同种子同操作序列产生完全相同的结果', () => {
  const play = (seed: number) => {
    let s = startBattle('ch1-3', 'bone', seed);
    let steps = 0;
    while (s.phase === 'player' && steps < 24) {
      steps += 1;
      const playable = s.hand.filter(card => canPlay(s, card.uid));
      if (playable.length) s = playCard(s, playable[0].uid, livingEnemies(s)[0]?.uid);
      else s = endTurn(s);
    }
    return s;
  };
  const a = play(4242);
  const b = play(4242);
  assert.deepEqual(structuredClone(a), structuredClone(b));
  assert.equal(a.rng, b.rng);
  assert.deepEqual(a.log.map(line => line.text), b.log.map(line => line.text));
  const other = play(4243);
  assert.notDeepEqual(other.log.map(line => line.text), a.log.map(line => line.text));
});

// ------------------------------------------------------------------ 2. purity

test('playCard / endTurn 绝不修改输入', () => {
  const s = startBattle('ch1-2', 'blade', 11);
  const before = structuredClone(s);
  const card = s.hand.find(entry => canPlay(s, entry.uid))!;
  const played = playCard(s, card.uid, livingEnemies(s)[0].uid);
  assert.deepEqual(s, before, 'playCard 动了输入');
  assert.notDeepEqual(played, before);

  const beforeTurn = structuredClone(played);
  const ended = endTurn(played);
  assert.deepEqual(played, beforeTurn, 'endTurn 动了输入');
  assert.notDeepEqual(ended, played);

  assert.throws(() => playCard(s, 'nope'), /手牌里没有这张牌/);
  assert.throws(() => playCard(s, card.uid, 'ghost'), /目标无效/);
  assert.deepEqual(s, before, '抛错也要先掷回不修改输入的承诺');
});

// --------------------------------------------------------------- 3. the shuffle

test('抽牌堆耗尽时弃牌堆洗回抽牌堆，牌的总数守恒', () => {
  const base = startBattle('ch1-1', 'blade', 5);
  const size = count(base);
  assert.equal(size, starterDeck('blade').length);

  // 把抽牌堆掏空到只剩 1 张，其余塞进弃牌堆，逼出一次洗回
  const drained = structuredClone(base);
  drained.draw = base.draw.slice(0, 1);
  drained.discard = [...base.discard, ...base.draw.slice(1)];
  assert.equal(count(drained), size, '搬家不改牌数');

  const next = endTurn(drained);
  assert.equal(next.hand.length, 5, '抽满 5 张：先抽走仅剩的 1 张，洗回后再抽 4 张');
  assert.equal(next.draw.length, size - 5, '洗完的牌堆扣掉抽走的 5 张');
  assert.equal(count(next), size);
  assert.ok(next.log.some(line => line.text.includes('洗回')), '洗牌要有日志');
});

// ------------------------------------------------------------------ 4. energy

test('能量不足时 canPlay 为 false，playCard 抛错', () => {
  // `playedThisTurn: 1` takes 引火 out of the picture, so this stays a test about energy alone.
  // The opening discount has its own test below.
  const s = { ...withHand(startBattle('ch1-1', 'blade', 3), ['blade-01', 'blade-02'], 0), playedThisTurn: 1 };
  assert.equal(cardCost('blade-01'), 1);
  assert.equal(cardCost('blade-02'), 0);
  assert.equal(canPlay(s, 'rig-0'), false);
  assert.equal(canPlay(s, 'rig-1'), true, '0 费牌没有能量也能打');
  assert.throws(() => playCard(s, 'rig-0'), /能量不足/);
  assert.equal(canPlay(s, 'missing'), false);

  const funded = { ...s, player: { ...s.player, energy: 1 } };
  assert.equal(canPlay(funded, 'rig-0'), true);
  assert.equal(playCard(funded, 'rig-0').player.energy, 0);

  const over = { ...s, phase: 'won' as const };
  assert.equal(canPlay(over, 'rig-1'), false);
  assert.throws(() => playCard(over, 'rig-1'), /战斗已经结束/);
});

test('引火：每回合第一张牌 −1 费，最低 0，之后恢复原价', () => {
  const s = withHand(startBattle('ch1-1', 'blade', 210), ['blade-01', 'blade-01', 'blade-01'], 3); // 割线 1 费 ×3
  assert.equal(cardCostNow(s, 'blade-01'), 0, '开局第一张 1 费牌打折到 0');
  const first = playCard(s, 'rig-0');
  assert.equal(first.player.energy, 3, '第一张没花能量');
  assert.equal(cardCostNow(first, 'blade-01'), 1, '第二张恢复原价');
  const second = playCard(first, 'rig-1');
  assert.equal(second.player.energy, 2);
  assert.equal(cardCostNow(second, 'blade-01'), 1, '第三张也是原价');
  assert.equal(playCard(second, 'rig-2').player.energy, 1, '折扣一回合只给一次');

  // 0 费牌减到 0 就停住，不会变成负数、更不会倒找能量。
  const zero = withHand(startBattle('ch1-1', 'blade', 211), ['blade-02'], 3);
  assert.equal(cardCostNow(zero, 'blade-02'), 0);
  assert.equal(playCard(zero, 'rig-0').player.energy, 3, '0 费牌不吃也不给能量');

  // 不能直接打出的牌（-1）不会被折成可打出。
  assert.equal(cardCostNow(zero, 'nope'), -1, '未知的牌仍然是 -1');

  // 2 费牌减到 1 —— 这是这条规则真正的价值所在。
  const big = withHand(startBattle('ch1-1', 'blade', 212), ['blade-25'], 3); // 敛刃 2 费
  assert.equal(cardCostNow(big, 'blade-25'), 1);
  assert.equal(playCard(big, 'rig-0').player.energy, 2);

  // 新回合折扣回来。
  assert.equal(cardCostNow(endTurn(s), 'blade-01'), 0, '回合刷新后折扣重置');
});

// ------------------------------------------------------- 5. block absorbs first

test('伤害先扣格挡再扣血', () => {
  const s = withHand(startBattle('ch1-1', 'blade', 8), ['blade-04']); // 掩刃：6 点格挡
  const shielded = playCard(s, 'rig-0');
  assert.equal(shielded.player.block, 6);
  const after = endTurn(shielded);
  // 两只影狼各 5 + 聚群 2 = 7，共 14：6 点被格挡吃下，生命 −8
  assert.equal(after.player.hp, 60 - 8);
  assert.equal(after.player.block, 0);
});

test('聚群按出手时的存活数结算：杀掉一只，另一只就咬得轻', () => {
  const rig = withHand(startBattle('ch1-1', 'blade', 12), ['blade-01']);
  rig.enemies[0].hp = 1;
  const killed = playCard(rig, 'rig-0', rig.enemies[0].uid);
  assert.equal(killed.enemies[0].dead, true);
  assert.equal(intentText(intentFor(killed, killed.enemies[1])[0]), '攻击 5');
  const after = endTurn(killed);
  assert.equal(after.player.hp, 60 - 5, '没有同伴的影狼只咬 5');
});

test('intentFor 把聚群与力量算进显示的攻击力，原始 intent 保持脚本数值', () => {
  const s = startBattle('ch1-1', 'blade', 13);
  const wolf = s.enemies[0];
  assert.equal(intentText(wolf.intent[0]), '攻击 5');
  assert.equal(intentText(intentFor(s, wolf)[0]), '攻击 7', '两只影狼，聚群 +2');
  const alone = { ...s, enemies: [s.enemies[0]] };
  assert.equal(intentText(intentFor(alone, alone.enemies[0])[0]), '攻击 5');
});

// --------------------------------------------------- 6. edge / mark / first hit

test('锋锐与烙印每次命中都加伤，多段牌按次数乘', () => {
  const rig = withHand(startBattle('ch1-5', 'blade', 21), ['blade-02']); // 双刃 3 伤害 2 次
  rig.player.statuses.edge = 2;
  rig.enemies[0].statuses.mark = 1;
  const hit = playCard(rig, 'rig-0', rig.enemies[0].uid);
  assert.equal(lost(hit.enemies[0]), (3 + 2 + 3) * 2, '每次命中 +2 锋锐 +3 烙印');
  assert.equal(hit.enemies[0].statuses.mark, 1, '烙印不会因为挨打而消耗');

  const plain = structuredClone(rig);
  delete plain.enemies[0].statuses.mark;
  assert.equal(lost(playCard(plain, 'rig-0', plain.enemies[0].uid).enemies[0]), (3 + 2) * 2);
});

test('淬刃只强化本回合第一张攻击牌', () => {
  const rig = withHand(startBattle('ch1-5', 'blade', 22), ['blade-01', 'blade-01', 'blade-04']);
  rig.powers.firstAttackBonus = 3;
  const first = playCard(rig, 'rig-0', rig.enemies[0].uid);
  assert.equal(lost(first.enemies[0]), 10, '7 + 3');
  const second = playCard(first, 'rig-1', first.enemies[0].uid);
  assert.equal(lost(second.enemies[0]), 10 + 7, '第二张攻击牌不再加成');
  const skill = playCard(second, 'rig-2');
  assert.equal(lost(skill.enemies[0]), 17);
  assert.equal(skill.player.block, 6);
});

test('攒烬每次命中给余烬，并在下个回合开始时清零', () => {
  const rig = withHand(startBattle('ch1-5', 'blade', 23), ['blade-08', 'blade-02']);
  const powered = playCard(rig, 'rig-0'); // 攒烬
  assert.equal(powered.powers.emberPerHit, 1);
  const hit = playCard(powered, 'rig-1', powered.enemies[0].uid); // 双刃 2 次命中
  assert.equal(hit.player.statuses.ember, 2);
  const after = endTurn(hit);
  assert.equal(after.powers.emberPerHit, 0);
  assert.equal(after.player.statuses.ember, 2, '余烬本身不会消退');
});

// ------------------------------------------------- 明焰阶 · 击破守望者后解锁

/** The eight cards 击破守望者 promises. They are not in the chapter's starting pool, so every test
 *  below hands the battle an explicit pile instead of naming a deck and hoping. */
const BLAZE = ['blade-16', 'blade-17', 'blade-19', 'blade-20', 'bone-16', 'bone-17', 'bone-19', 'bone-21'];

/** Just this card in hand, full energy, and one enemy with a known, unblocked body. */
function rigged(cardId: string, seed: number, hp = 40, maxHp = 40): BattleState {
  const deck = cardId.startsWith('blade') ? 'blade' : cardId.startsWith('flame') ? 'flame' : 'bone';
  const state = withHand(startBattle('ch1-1', deck, seed, { cards: [{ cardId }] }), [cardId], 9);
  const target = state.enemies[0];
  target.hp = hp;
  target.maxHp = maxHp;
  target.block = 0;
  target.statuses = {};
  return state;
}
/**
 * Damage one play of `rig-0` did to the first enemy, read as a difference rather than as a total.
 *
 * ⚠️ **This measures HP lost, which stops at the target's remaining HP** — a hit that kills reports
 * only the sliver that was left, because `dealToEnemy` floors the body at zero. So a test using this
 * has to keep its target alive; to assert a big number on a small body, give it a big body.
 */
function dealt(state: BattleState): { damage: number; after: BattleState } {
  const before = state.enemies[0].hp;
  const after = playCard(state, 'rig-0', state.enemies[0].uid);
  return { damage: before - after.enemies[0].hp, after };
}

test('凡是第一章发到手的牌，必有实现 —— 一张白板都不许进玩家的牌组', () => {
  // ⚠️ **This check used to cover only `BLAZE`** — the eight cards the boss unlocks. Everything the
  // chapter hands out from the start was assumed to be fine, and it was not: **砺石 and 殉道 sat in
  // `CHAPTER_1.unlocked.bone` for a whole round with no behaviour at all**, drawable, dealable into the
  // opening hand, and playable into a log line reading 「还没有实装效果」. They were put into the deck to
  // fix 长明壁垒 having no 0-cost cards, and the effect was never written beside them.
  //
  // The criterion is now the unlock list itself rather than a hand-kept group, so the next card added
  // to `chapter.ts` without an implementation fails here on the same commit.
  const unlocked = [...new Set(Object.values(CHAPTER_1.unlocked).flat())];
  assert.ok(unlocked.length > 20, '第一章的解锁名单不该这么小');
  const blank = unlocked.filter(id => !CARD_EFFECTS[id]);
  assert.deepEqual(blank, [], '这些牌在解锁名单里却没有实现，玩家拿到的是白板');
});

test('明焰阶八张牌都真的实现了，一张白板都没有', () => {
  // The whole reason this set was left locked. `nextUnlock` promised them for a chapter that could
  // not deliver them, and handing a player eight cards that log 「还没有实装效果」 is worse than
  // handing them nothing at all.
  for (const id of BLAZE) {
    assert.ok(CARD_EFFECTS[id], `${id} 没有效果 —— 解锁出去就是一张白板`);
    const { after } = dealt(rigged(id, 41));
    const said = after.log.map(line => line.text).join('\n');
    assert.ok(!said.includes('还没有实装效果'), `${id} 打出来是空的`);
  }
});

test('断罪按目标已失去的整十个百分点加伤，边界不因浮点走样', () => {
  // `1 - hp/maxHp` at exactly 10% lost is 0.09999999999999998, and `× 10` floors to 0 — the card
  // would print 8 and deal 6 on the one value a player is most likely to check. Counted in whole
  // tenths, by subtraction.
  assert.equal(dealt(rigged('blade-16', 42, 40, 40)).damage, 6, '满血：只有基础伤害');
  assert.equal(dealt(rigged('blade-16', 42, 36, 40)).damage, 8, '正好失去 10% → 6 + 2');
  assert.equal(dealt(rigged('blade-16', 42, 32, 40)).damage, 10, '失去 20% → 6 + 2×2');
  assert.equal(dealt(rigged('blade-16', 42, 20, 40)).damage, 16, '失去 50% → 6 + 5×2');
  // Nine tenths needs a body big enough to survive the answer — see the note on `dealt`.
  assert.equal(dealt(rigged('blade-16', 42, 30, 300)).damage, 6 + 9 * 2, '失去 90% → 6 + 9×2');
});

test('照壁的回声只响一次：复制品不带回响，链子必然收得住', () => {
  // The constraint the token exists for. If 回响 put a copy of 照壁 *itself* into the hand, playing
  // that copy would put another one there and the battle would never end — so 残壁 is a named card
  // with no 回响 on it, and this test is what stops a future edit from "simplifying" it back.
  const rig = rigged('bone-17', 43);
  const played = playCard(rig, 'rig-0');
  assert.equal(played.player.block, 5, '照壁给 5 点格挡');
  assert.equal(played.player.statuses.reflection, 1, '外加 1 层映照');
  assert.equal(played.hand.length, 1, '手里多了一张');

  const echo = played.hand[0];
  assert.equal(echo.cardId, 'echo-01', '回声是残壁');
  assert.notEqual(echo.cardId, 'bone-17', '绝不能是照壁本身 —— 那就是无限循环');
  assert.equal(cardName('echo-01'), '残壁');

  // And the echo is a real card: it blocks, and it adds nothing behind itself.
  const after = playCard(played, echo.uid);
  assert.equal(after.hand.length, 0, '残壁不再生成任何东西');
  assert.equal(after.player.block, 8, '5 + 3');
});

test('借焰先吃掉灼烧再结算伤害，击杀也不会烧错人', () => {
  // Read-then-hit would let a lethal 5 move `currentTarget` between the halves and burn the scorch
  // off whichever enemy stepped up instead.
  const rig = rigged('blade-20', 44);
  rig.enemies[0].statuses.scorch = 4;
  const { damage, after } = dealt(rig);
  assert.equal(damage, 5, '牌面伤害');
  assert.equal(after.player.statuses.ember, 4, '每层灼烧转 1 层余烬');
  assert.equal(after.enemies[0].statuses.scorch, undefined, '灼烧被吃干净');
});

test('刃雨按每一次挥击真的碰到几个敌人给余烬', () => {
  // Two swings, and 「每命中一个敌人」 counts per swing — an enemy killed by the first is not hit by
  // the second and must not be paid for twice.
  const rig = rigged('blade-17', 45);
  rig.enemies.forEach(enemy => { enemy.hp = 40; enemy.maxHp = 40; enemy.block = 0; });
  const { damage } = dealt(rig);
  assert.equal(damage, 8, '4 点两次');
  const two = rig.enemies.length;
  assert.equal(rigged('blade-17', 45).enemies.length, two, '这场固定两只');
});

test('炭墙与回震读的是已经存在的数字', () => {
  const burnt = rigged('bone-19', 46);
  burnt.enemies[0].statuses.scorch = 3;
  const wall = playCard(burnt, 'rig-0');
  assert.equal(wall.player.block, 6 + 3, '6 点，加上目标身上的灼烧');

  const plain = playCard(rigged('bone-19', 46), 'rig-0');
  assert.equal(plain.player.block, 6, '没有灼烧就是 6');

  const walled = rigged('bone-16', 47);
  walled.player.block = 9;
  const { damage, after } = dealt(walled);
  assert.equal(damage, 9, '回震的伤害等于格挡');
  assert.equal(after.player.block, 9, '读格挡，不消耗它');
});

test('裂甲最多吃掉 3 层锋锐，封炉蓄火并给壁垒', () => {
  const withEdge = rigged('blade-19', 48);
  withEdge.player.statuses.edge = 5;
  const { damage, after } = dealt(withEdge);
  // 7, plus 4 for each of the three layers it eats, **plus the 1-per-layer that the two layers it did
  // not eat still contribute** — 锋锐 is applied to every attack hit inside `strike`, and 裂甲 only
  // spends three of them. The two rules stack; they are not alternatives, and this assertion is what
  // says so out loud.
  assert.equal(damage, 7 + 3 * 4 + 2, '7 + 3×4 + 剩下 2 层锋锐各 +1');
  assert.equal(after.player.statuses.edge, 2, '只吃掉 3 层');

  assert.equal(dealt(rigged('blade-19', 48)).damage, 7, '没有锋锐就是一张普通的 7');

  const banked = playCard(rigged('bone-21', 49), 'rig-0');
  assert.equal(banked.banking, true, '封炉开了蓄火');
  assert.equal(banked.player.statuses.rampart, 1);
});

// ---------------------------------------------------------------- 燎原余烬

test('灼烧终于有了施加端：火种点着了目标', () => {
  // Until 燎原余烬 arrived **nothing in the engine could apply 灼烧**. `ctx.gain` writes the player's
  // own statuses and `mark` is hardcoded to 烙印, so the half that ticks (enemy turn start, falling
  // off by one) had been in the engine since the beginning while the half that lights it had no door
  // at all. This is the test that says the door exists.
  const rig = rigged('flame-01', 51);
  const { damage, after } = dealt(rig);
  assert.equal(damage, 4, '牌面伤害');
  assert.equal(after.enemies[0].statuses.scorch, 2, '两回合后会自己掉血');
});

test('舔焰只对已经被点着的目标多打 4 点', () => {
  assert.equal(dealt(rigged('flame-04', 52)).damage, 3, '没点着就是一张 3');
  const lit = rigged('flame-04', 52);
  lit.enemies[0].statuses.scorch = 1;
  assert.equal(dealt(lit).damage, 7);
});

test('裂焰把灼烧吃干净，每层 3 点；打磨后是每层 4 点，不是整张 +1', () => {
  const rig = rigged('flame-09', 53, 60, 60);
  rig.enemies[0].statuses.scorch = 5;
  const { damage, after } = dealt(rig);
  assert.equal(damage, 15, '5 层 × 3');
  assert.equal(after.enemies[0].statuses.scorch, undefined, '灼烧被吃干净');

  // 「每层造成 3 点伤害」 is five separate swings, so the polish delta has to land five times. Written
  // as a single `hit(layers * 3)` the polished card would deal 16 where it prints 20 — the card face
  // would be lying, which is the one thing `upgrades.ts` is not allowed to do.
  const polished = rigged('flame-09', 53, 60, 60);
  polished.enemies[0].statuses.scorch = 5;
  polished.hand[0] = { ...polished.hand[0], upgraded: true };
  assert.equal(dealt(polished).damage, 20, '5 层 × 4');
});

test('引信当场给能量，下一回合连本带利扣回去', () => {
  const rig = rigged('flame-03', 54);
  const played = playCard(rig, 'rig-0');
  assert.equal(played.player.energy, 10, '0 费，还多 1 点');
  assert.equal(played.player.statuses.drained, 1, '记在下回合的账上 — 爆燃不自造能量，它只是预支');
  assert.equal(endTurn(played).player.energy, ENERGY_PER_TURN - 1, '下回合正好少 1 点');
});

test('炭衣把目标身上的灼烧换成格挡，至多吃 4 层', () => {
  const rig = rigged('flame-15', 55);
  rig.enemies[0].statuses.scorch = 6;
  const played = playCard(rig, 'rig-0');
  assert.equal(played.player.block, 12, '4 层 × 3');
  assert.equal(played.enemies[0].statuses.scorch, 2, '只吃掉 4 层，还剩 2');
});

test('扬灰把攒下的余烬烧成全场灼烧', () => {
  const rig = rigged('flame-08', 56);
  for (const enemy of rig.enemies) { enemy.hp = 40; enemy.maxHp = 40; enemy.block = 0; enemy.statuses = {}; }
  rig.player.statuses.ember = 3;
  const played = playCard(rig, 'rig-0');
  assert.equal(played.player.statuses.ember, undefined, '3 层余烬全花掉');
  for (const enemy of played.enemies) assert.equal(enemy.statuses.scorch, 2, '场上每一只都被点着');
});

// -------------------------------------------- 燎原余烬的四块补丁（flame-29..40）

/** A flame battle with this exact hand, player already hurt, so a heal has somewhere to go. */
function hurtRig(cardIds: string[], seed: number, hp = 30): BattleState {
  const s = withHand(startBattle('ch1-1', 'flame', seed, { cards: [{ cardId: cardIds[0] }] }), cardIds, 9);
  s.player.hp = hp;
  return s;
}

test('回血是真的：引擎原本没有任何一张牌能回血', () => {
  // The deck pays for three of its own cards in 生命, and until now the *only* healing in the game
  // was the between-fights roll — so 燎原余烬 was a deck that slowly killed itself with no answer.
  const crowded = hurtRig(['flame-29', 'flame-29', 'flame-29'], 61);
  assert.equal(playCard(crowded, 'rig-0').player.hp, 36, '手里还有牌，回 6');

  // 空明 reads the hand the card was played *from*, and the card is already out of it by the time the
  // effect runs — which is why every 空明 card in the library behaves this way.
  const alone = hurtRig(['flame-29'], 61);
  assert.equal(playCard(alone, 'rig-0').player.hp, 41, '手牌空了，回 11');

  // And it cannot go over the ceiling.
  const nearlyFull = hurtRig(['flame-29'], 61, 58);
  assert.equal(playCard(nearlyFull, 'rig-0').player.hp, 60, '回血不会溢出上限');
});

test('取暖与炭火把余烬和火场换成生命', () => {
  const warm = hurtRig(['flame-30'], 62);
  warm.player.statuses.ember = 3;
  assert.equal(playCard(warm, 'rig-0').player.hp, 42, '3 层余烬 × 4 点');
  assert.equal(hurtRig(['flame-30'], 62).player.hp, 30, '没有余烬就什么也回不了');

  // 炭火 counts the enemies the burn *landed on* — measured before `burnAll`, so a kill cannot shrink
  // the number the player was promised.
  const coals = hurtRig(['flame-31'], 63);
  const lit = coals.enemies.length;
  const after = playCard(coals, 'rig-0');
  assert.equal(after.player.hp, 30 + lit * 4, `场上一共 ${lit} 只，每只回 4 点`);
  for (const enemy of after.enemies) assert.equal(enemy.statuses.scorch, 2);
});

test('余温炸裂一次吃掉全场的灼烧，然后砸全场', () => {
  const rig = hurtRig(['flame-34'], 64);
  for (const enemy of rig.enemies) { enemy.hp = 40; enemy.maxHp = 40; enemy.block = 0; enemy.statuses = { scorch: 2 }; }
  const before = rig.enemies.map(enemy => enemy.hp);
  const after = playCard(rig, 'rig-0');
  // 2 enemies × 2 layers = 4 layers total → 4 separate hitAll(2) passes → 8 to each.
  after.enemies.forEach((enemy, i) => assert.equal(before[i] - enemy.hp, 8, '每层对所有敌人 2 点'));
  for (const enemy of after.enemies) assert.equal(enemy.statuses.scorch, undefined, '灼烧被吃干净');
});

test('消耗余烬的三张：格挡、直伤、抽牌', () => {
  const feed = hurtRig(['flame-37'], 65);
  feed.player.statuses.ember = 3;
  const walled = playCard(feed, 'rig-0');
  assert.equal(walled.player.block, 15, '3 层 × 5 点格挡');
  assert.equal(walled.player.statuses.ember, undefined, '余烬花光了');
  assert.equal(playCard(hurtRig(['flame-37'], 65), 'rig-0').player.block, 0, '没有余烬就没有墙');

  const white = hurtRig(['flame-38'], 66);
  white.player.statuses.ember = 4;
  white.enemies[0].hp = 40; white.enemies[0].maxHp = 40; white.enemies[0].block = 0;
  const before = white.enemies[0].hp;
  assert.equal(before - playCard(white, 'rig-0').enemies[0].hp, 12, '4 层 × 3 点');

  // Stocked by hand: the pile a `startBattle` is handed is already drawn into the opening hand, so
  // there is nothing left to draw from unless the test puts it there.
  const draw = hurtRig(['flame-39'], 67);
  draw.player.statuses.ember = 2;
  draw.draw = [{ uid: 'd0', cardId: 'flame-01' }, { uid: 'd1', cardId: 'flame-01' }];
  const drawn = playCard(draw, 'rig-0');
  assert.equal(drawn.player.statuses.ember, undefined, '花掉 2 层');
  assert.equal(drawn.hand.length, 2, '抽 2 张');

  const broke = hurtRig(['flame-39'], 67);
  broke.draw = [{ uid: 'd0', cardId: 'flame-01' }, { uid: 'd1', cardId: 'flame-01' }];
  assert.equal(playCard(broke, 'rig-0').hand.length, 0, '没余烬就抽不动');
});

test('焦土与白热是每层结算，打磨后每层都变大', () => {
  const scorched = hurtRig(['flame-35'], 68);
  scorched.enemies[0].hp = 60; scorched.enemies[0].maxHp = 60; scorched.enemies[0].block = 0;
  scorched.enemies[0].statuses = { scorch: 4 };
  const before = scorched.enemies[0].hp;
  const hit = playCard(scorched, 'rig-0');
  assert.equal(before - hit.enemies[0].hp, 20, '4 层 × 5 点');
  assert.equal(hit.player.hp, 28, '自己的 2 点也照扣');

  const polished = hurtRig(['flame-35'], 68);
  polished.enemies[0].hp = 60; polished.enemies[0].maxHp = 60; polished.enemies[0].block = 0;
  polished.enemies[0].statuses = { scorch: 4 };
  polished.hand[0] = { ...polished.hand[0], upgraded: true };
  const beforeP = polished.enemies[0].hp;
  assert.equal(beforeP - playCard(polished, 'rig-0').enemies[0].hp, 28, '打磨后每层 7 点，不是整张 +2');
});

test('多段牌的目标中途死亡时，剩下的命中转给下一个敌人', () => {
  const rig = withHand(startBattle('ch1-1', 'blade', 24), ['blade-02']);
  rig.enemies[0].hp = 2;
  const after = playCard(rig, 'rig-0', rig.enemies[0].uid);
  assert.equal(after.enemies[0].dead, true);
  assert.equal(after.enemies[1].hp, 11 - 3, '第二下落在另一只影狼身上');
});

// ------------------------------------------------------------------- 7. scorch

test('灼烧在敌人回合开始时结算并递减，归零移除', () => {
  const rig = withHand(startBattle('ch1-1', 'blade', 31), []);
  rig.enemies[0].statuses.scorch = 3;
  const one = endTurn(rig);
  assert.equal(lost(one.enemies[0]), 3);
  assert.equal(one.enemies[0].statuses.scorch, 2);
  const two = endTurn(one);
  assert.equal(lost(two.enemies[0]), 3 + 2);
  assert.equal(two.enemies[0].statuses.scorch, 1);
  const three = endTurn(two);
  assert.equal(lost(three.enemies[0]), 3 + 2 + 1);
  assert.equal(three.enemies[0].statuses.scorch, undefined, '归零就移除');
});

// ---------------------------------------------- 8. keepBlock, shatter (patched)

test('潜草者的格挡跨回合保留，其它敌人的格挡在自己回合开始时清空', () => {
  // 草甸上的头狼 is the 头狼's floor alone now, so the 潜草者 case is taken from a fight that is
  // actually about it.
  let s = startBattle('s-ambush', 'blade', 41);
  const stalker = () => s.enemies.find(enemy => enemy.id === 'stalker')!;
  assert.equal(intentText(stalker().intent[0]), '潜伏 · 格挡 4');
  s = endTurn(s);
  assert.equal(stalker().block, 4);
  s = endTurn(s);
  assert.equal(stalker().block, 8, '上个回合的 4 点没有消失，新的 4 点叠上去');

  let c = startBattle('ch1-3', 'blade', 42);
  const guard = () => c.enemies.find(enemy => enemy.id === 'caravanguard')!;
  assert.equal(intentText(guard().intent[0]), '攻击 9');
  c = endTurn(c);
  assert.equal(intentText(guard().intent[0]), '清点货物 · 格挡 10');
  c = endTurn(c);
  assert.equal(guard().block, 10);
  c = endTurn(c);
  assert.equal(guard().block, 0, '寻常敌人回合开始时会清空自己的格挡');
});

test('shatter：单次打穿格挡时自身受伤，磨穿不算', () => {
  const def = ENEMY_BY_ID.get('shadewolf')!;
  ENEMY_BY_ID.set('shadewolf', { ...def, traits: [...(def.traits ?? []), { id: 'shatter', amount: 5 }] });
  try {
    const rig = withHand(startBattle('ch1-1', 'blade', 51), ['blade-01']); // 割线 7
    rig.enemies[0].block = 4;
    const broken = playCard(rig, 'rig-0', rig.enemies[0].uid);
    assert.equal(broken.enemies[0].block, 0);
    assert.equal(lost(broken.enemies[0]), 3 + 5, '3 点溢出 + 5 点碎裂');

    const chip = withHand(startBattle('ch1-1', 'blade', 52), ['blade-02']); // 3 伤害 2 次
    chip.enemies[0].block = 10;
    const chipped = playCard(chip, 'rig-0', chip.enemies[0].uid);
    assert.equal(chipped.enemies[0].block, 4);
    assert.equal(lost(chipped.enemies[0]), 0, '两次都没打穿，不碎');
  } finally {
    ENEMY_BY_ID.set('shadewolf', def);
  }
});

// ------------------------------------------------------- 9. deathBurst chains

test('deathBurst 死亡时炸到其它单位（含玩家），并且能连锁', () => {
  const def = ENEMY_BY_ID.get('shadewolf')!;
  ENEMY_BY_ID.set('shadewolf', { ...def, traits: [{ id: 'deathBurst', amount: 4 }] });
  try {
    const rig = withHand(startBattle('ch1-1', 'blade', 61), ['blade-01']);
    rig.enemies[0].hp = 1;
    rig.enemies[1].hp = 2;
    const after = playCard(rig, 'rig-0', rig.enemies[0].uid);
    assert.equal(after.enemies[0].dead, true);
    assert.equal(after.enemies[1].dead, true, '第一只炸死了第二只');
    assert.equal(after.enemies[1].hp, 0);
    assert.equal(after.player.hp, 60 - 4 - 4, '两轮爆炸都打到玩家');
    assert.equal(after.phase, 'won');
  } finally {
    ENEMY_BY_ID.set('shadewolf', def);
  }
});

// ------------------------------------------------------ 10. devour, steal, ward

test('吞光：吃下玩家的余烬与锋锐，变成自己的格挡', () => {
  // Plain wolves: a 肿胀的 one keeps its block between turns, which is the mutation working rather
  // than 吞光 failing, and this test is about 吞光.
  const rig = withHand(unmutated(startBattle('ch1-1', 'blade', 71)), []);
  rig.player.statuses.ember = 4;
  rig.player.statuses.edge = 2;
  rig.enemies[0].block = 3;
  rig.enemies[0].intent = [{ kind: 'devour' }];
  const after = endTurn(rig);
  assert.equal(after.enemies[0].block, 12, '先清空自己的 3 点，再把 6 层换成 12 点');
  assert.equal(after.player.statuses.ember, undefined);
  assert.equal(after.player.statuses.edge, undefined);
});

test('落灰、枯竭、翻找、窃取、守御、special 都能跑', () => {
  const rig = withHand(startBattle('ch1-1', 'blade', 81), ['blade-01']);
  rig.player.statuses.ember = 5;
  rig.enemies[1].hp = 999;
  rig.enemies[1].maxHp = 999;
  rig.enemies[1].intent = [
    { kind: 'pollute', amount: 2 },
    { kind: 'drain', amount: 1 },
    { kind: 'bury', amount: 1 },
    { kind: 'steal', status: 'ember' },
    { kind: 'ward', amount: 3 },
    { kind: 'special', note: '什么也没有发生' },
  ];
  const after = endTurn(rig);
  assert.equal(pile(after).filter(card => card.cardId === 'ash').length, 2, '落灰塞了两张灰烬');
  assert.equal(after.exhaust.length, 1, '翻找把一张牌埋出了本场战斗');
  assert.equal(after.exhaust[0].cardId, 'blade-01', '埋掉的是回合结束弃下来的那张');
  assert.equal(after.discard.length, 0, '弃牌堆里那张被吃掉了');
  assert.equal(after.player.energy, 2, '枯竭在下个回合扣掉 1 点能量');
  assert.equal(after.player.statuses.drained, undefined, '扣完就清掉');
  assert.equal(after.player.statuses.ember, undefined, '余烬被偷光');
  assert.equal(after.enemies[1].statuses.strength, 2, '5 层换 2 点力量');
  assert.equal(after.enemies[0].block, 3, '守御加在同僚身上');
  assert.ok(after.log.some(line => line.text.includes('什么也没有发生')));
  assert.equal(count(after), count(rig) + 2, '只有落灰会加牌');
});

// ------------------------------------------------------ 11. encounters and decks

test('第一章五场遭遇战都能开局，牌数守恒', () => {
  for (const encounter of ENCOUNTERS) {
    for (const deck of DECKS) {
      const s = startBattle(encounter.id, deck, 2026);
      assert.equal(s.turn, 1);
      assert.equal(s.phase, 'player');
      assert.equal(s.player.hp, 60);
      assert.equal(s.player.energy, 3);
      assert.equal(s.hand.length, 5);
      // Counts roll now, so what is asserted is the *kinds* and their bounds rather than a fixed list.
      const spawned = s.enemies.map(enemy => enemy.id);
      assert.ok(spawned.length >= 1 && spawned.length <= FIELD_LIMIT, `${encounter.id} 场上 ${spawned.length} 只`);
      for (const id of spawned) {
        assert.ok(encounter.units.some(unit => unit.id === id), `${encounter.id} 里不该有 ${id}`);
      }
      for (const unit of encounter.units) {
        const n = spawned.filter(id => id === unit.id).length;
        assert.ok(n <= unit.count[1], `${encounter.id}：${unit.id} 出了 ${n} 只，超过上限 ${unit.count[1]}`);
        // 战场上限会截断掷点，只有没被截断时才查下限
        if (spawned.length < FIELD_LIMIT) {
          assert.ok(n >= unit.count[0], `${encounter.id}：${unit.id} 只出了 ${n} 只，低于下限 ${unit.count[0]}`);
        }
      }
      assert.ok(s.enemies.every(enemy => enemy.hp === enemy.maxHp && !enemy.dead && enemy.intent.length > 0));
      assert.equal(count(s), starterDeck(deck).length, `${encounter.id}/${deck} 牌数不对`);
      assert.equal(new Set(pile(s).map(card => card.uid)).size, count(s));
      assert.equal(s.targetUid, s.enemies[0].uid);
      assert.ok(isValidBattle(s));
      // 残烬是三张一叠，牌组里一定有重复
      assert.ok(starterDeck(deck).length > new Set(starterDeck(deck)).size);
    }
  }
  assert.throws(() => startBattle('nope', 'blade'), /没有这场战斗/);
  // 燎原余烬 is a chapter-I deck now; 千面回廊 is the one still locked away.
  assert.throws(() => startBattle('ch1-1', 'mirror'), /不能携带/);
});

// --------------------------------------------- 11b. encounter generation

test('怪物血量在区间内掷点，区间里每个值都真的会出现', () => {
  const [min, max] = ENEMY_BY_ID.get('shadewolf')!.hp;
  const seen = new Set<number>();
  for (let seed = 1; seed <= 200; seed++) {
    for (const wolf of startBattle('w-shadepack', 'blade', seed).enemies) {
      // A 异变 scales HP on purpose — 强健的 is meant to leave the band, not to stay inside it.
      if (wolf.mutation) continue;
      assert.ok(wolf.hp >= min && wolf.hp <= max, `种子 ${seed}：影狼 ${wolf.hp} 不在 ${min}–${max}`);
      assert.equal(wolf.hp, wolf.maxHp, '开局满血');
      seen.add(wolf.hp);
    }
  }
  assert.deepEqual([...seen].sort((a, b) => a - b), Array.from({ length: max - min + 1 }, (_, i) => min + i),
    '区间里每个整数都该抽得到，否则区间是假的');
});

test('遭遇战只掷数量，不掷种类', () => {
  const encounter = POOLS.weak.find(entry => entry.id === 'w-shadepack')!;
  const counts = new Set<number>();
  for (let seed = 1; seed <= 60; seed++) {
    const s = startBattle(encounter.id, 'blade', seed);
    for (const enemy of s.enemies) assert.equal(enemy.id, 'shadewolf', '种类不能变');
    counts.add(s.enemies.length);
  }
  assert.deepEqual([...counts].sort((a, b) => a - b), [2, 3], '2–3 只都应该出现过');
});

test('数量与血量都由种子决定：同种子同牌面，异种子会变', () => {
  const board = (seed: number) => startBattle('w-shadepack', 'blade', seed)
    .enemies.map(enemy => `${enemy.id}:${enemy.hp}:${enemy.mutation ?? '-'}`);
  assert.deepEqual(board(9), board(9), '同一个种子必须给出同一块场地');
  const boards = new Set(Array.from({ length: 40 }, (_, i) => board(i + 1).join('|')));
  assert.ok(boards.size > 1, '不同种子应该掷出不同的场地');
});

test('异变只落在小兵和寻常怪身上，且真的改数值', () => {
  const mutated = new Map<string, number>();
  for (let seed = 1; seed <= 400; seed++) {
    for (const enemy of startBattle('s-lanternround', 'blade', seed).enemies) {
      if (!enemy.mutation) continue;
      const def = ENEMY_BY_ID.get(enemy.id)!;
      assert.ok(MUTABLE_RANKS.includes(def.rank), `${def.rank} 不该异变`);
      mutated.set(enemy.mutation, (mutated.get(enemy.mutation) ?? 0) + 1);
    }
  }
  assert.ok(mutated.size > 0, '400 局里总该掷出几次异变');
  for (const [id, times] of mutated) {
    assert.ok(MUTATION_BY_ID.has(id), `${id} 不在异变表里`);
    assert.ok(times < 400, `${id} 每次都出现，说明它其实不是随机的`);
  }
  // 精英与首领永远不异变
  for (let seed = 1; seed <= 60; seed++) {
    for (const enemy of startBattle('ch1-5', 'blade', seed).enemies) assert.equal(enemy.mutation, undefined);
  }
});

test('「披甲的」的每回合格挡真的生效，不是只改了个名字', () => {
  const armored = MUTATIONS.find(m => m.regenBlock !== undefined)!;
  const s = unmutated(startBattle('ch1-1', 'blade', 7));
  for (const enemy of s.enemies) enemy.mutation = armored.id;
  assert.equal(enemyName(s.enemies[0]), `${armored.prefix}影狼`, '名字要带上前缀');
  const after = endTurn(s);
  assert.ok(after.enemies[0].block >= armored.regenBlock!,
    `披甲的应该每回合把格挡顶到 ${armored.regenBlock}，实际 ${after.enemies[0].block}`);
});

test('异变改的是实际数值，不只是显示', () => {
  const frenzied = MUTATIONS.find(m => m.statuses?.strength)!;
  // The statuses are handed out *at spawn*, so the roll has to actually land on 狂躁的 — retrofitting
  // `mutation` onto an enemy that already spawned gives it the name but not the strength, which is
  // precisely the failure mode this test exists to catch.
  let board: BattleState | undefined;
  for (let seed = 1; seed <= 500 && !board; seed++) {
    const s = startBattle('w-shadepack', 'blade', seed);
    if (s.enemies.some(enemy => enemy.mutation === frenzied.id)) board = s;
  }
  assert.ok(board, '500 个种子里总该掷出一次狂躁的');
  const enemy = board.enemies.find(entry => entry.mutation === frenzied.id)!;
  assert.equal(enemy.statuses.strength, frenzied.statuses!.strength, '开局就带着力量');
  assert.match(enemyName(enemy), new RegExp(frenzied.prefix), '名字要带上前缀');

  const attack = intentFor(board, enemy).find(intent => intent.kind === 'attack');
  const bare = intentFor(board, { ...enemy, mutation: undefined, statuses: {} }).find(intent => intent.kind === 'attack');
  assert.ok(attack?.kind === 'attack' && bare?.kind === 'attack');
  assert.equal(attack.amount - bare.amount, frenzied.statuses!.strength, '力量要算进意图里');
});

test('生成走独立的一条流：换遭遇战不会打乱洗牌', () => {
  // Same deck, same seed, different encounters — the encounter rolls differ but the card order must
  // not. This is the whole reason `spawnRng` exists apart from `rng`.
  const deckOf = (id: string) => startBattle(id, 'blade', 77).draw.map(card => card.cardId);
  assert.deepEqual(deckOf('ch1-1'), deckOf('w-hollowrim'), '遭遇战不该影响抽牌顺序');
  assert.deepEqual(deckOf('ch1-1'), deckOf('s-deepgrass'));
});

test('战场上最多四只，掷得再多也不会超', () => {
  // 潜草者巢穴 rolls up to 3 + 2 = 5 bodies against a cap of 4.
  for (let seed = 1; seed <= 80; seed++) {
    const s = startBattle('e-brood', 'blade', seed);
    assert.ok(s.enemies.length >= 1 && s.enemies.length <= FIELD_LIMIT,
      `种子 ${seed}：场上 ${s.enemies.length} 只，超过上限 ${FIELD_LIMIT}`);
    assert.ok(isValidBattle(s));
  }
});

test('池子里的每一场遭遇战都开得起来，且意图有字', () => {
  for (const [pool, entries] of Object.entries(POOLS)) {
    assert.ok(entries.length > 0, `${pool} 池是空的`);
    for (const encounter of entries) {
      assert.equal(encounter.pool, pool, `${encounter.id} 的 pool 字段和它所在的池对不上`);
      for (const deck of DECKS) {
        const s = startBattle(encounter.id, deck, 3);
        assert.ok(isValidBattle(s), `${encounter.id}/${deck} 开局不合法`);
        assert.ok(s.hand.length === 5);
        for (const enemy of s.enemies) {
          assert.ok(intentFor(s, enemy).every(intent => intentText(intent).length > 0), `${encounter.id} 意图没字`);
        }
      }
    }
  }
  assert.equal(POOLS.boss.length, 1, '一章只有一个首领');
  assert.deepEqual(POOLS.boss.map(e => e.id), ['ch1-5']);
});

test('未知的遭遇战 id 直接抛错，池子之外也开不了', () => {
  assert.throws(() => startBattle('nope', 'blade'), /没有这场战斗/);
  assert.throws(() => startBattle('ch1-9', 'blade'), /没有这场战斗/);
});

// ------------------------------------------------------------- 12. random play

test('每一场遭遇战 × 每一副牌组 × 4 个种子：不变量恒成立，且必然分出胜负', () => {
  const check = (s: BattleState, size: number) => {
    assert.ok(isValidBattle(s), '存档必须始终合法');
    assert.ok(s.player.hp >= 0 && s.player.hp <= s.player.maxHp, `生命越界：${s.player.hp}`);
    assert.ok(s.hand.length <= 10, '手牌不能超过 10 张');
    for (const [id, value] of Object.entries(s.player.statuses)) {
      assert.ok(Number.isInteger(value) && (value as number) >= 0, `玩家 ${id} 层数非法`);
    }
    for (const enemy of s.enemies) {
      assert.ok(enemy.hp >= 0 && enemy.hp <= enemy.maxHp, `${enemy.id} 生命越界`);
      assert.ok(enemy.block >= 0, `${enemy.id} 格挡为负`);
      if (enemy.dead) assert.equal(enemy.hp, 0);
      for (const [id, value] of Object.entries(enemy.statuses)) {
        assert.ok(Number.isInteger(value) && (value as number) >= 0, `${enemy.id} 的 ${id} 层数非法`);
      }
    }
    const cards = pile(s);
    assert.equal(cards.length, size + cards.filter(card => card.cardId === 'oath').length, '只有换岗会加牌');
    assert.equal(new Set(cards.map(card => card.uid)).size, cards.length, 'uid 不能重复');
    if (s.phase === 'won') assert.equal(livingEnemies(s).length, 0);
  };

  let wins = 0;
  let losses = 0;
  let longest = 0;
  for (const encounter of ENCOUNTERS) {
    for (const deck of DECKS) {
      for (let round = 0; round < 4; round++) {
        const seed = 900 + round * 137 + encounter.units.length * 7;
        const roll = lcg(seed);
        let s = startBattle(encounter.id, deck, seed);
        const size = count(s);
        check(s, size);
        let steps = 0;
        while (s.phase === 'player' && steps < 400) {
          steps += 1;
          const playable = s.hand.filter(card => canPlay(s, card.uid));
          if (playable.length && roll() < 0.85) {
            const card = playable[Math.floor(roll() * playable.length)];
            const targets = livingEnemies(s);
            s = playCard(s, card.uid, targets[Math.floor(roll() * targets.length)]?.uid);
          } else {
            s = endTurn(s);
          }
          check(s, size);
        }
        longest = Math.max(longest, steps);
        assert.ok(s.phase === 'won' || s.phase === 'lost', `${encounter.id}/${deck}/${seed} 打不完（${steps} 步）`);
        if (s.phase === 'won') wins += 1; else losses += 1;
      }
    }
  }
  // Derived rather than written down: this read `40` when the chapter had two decks, and adding a
  // third silently made the count 60. The number is a property of the loops above, so it should be
  // spelled as one.
  assert.equal(wins + losses, DECKS.length * ENCOUNTERS.length * 4);
  assert.ok(longest < 400, '没有一局是靠步数上限停下来的');
});

// ------------------------------------------------------------ optional systems

test('蓄火把没用完的能量带到下回合，枯竭扣能量', () => {
  // 引火 is held off with `playedThisTurn: 1` — this test is about 蓄火, and the discount would
  // otherwise shave a point off the energy it is counting.
  const rig = { ...withHand(startBattle('ch1-1', 'blade', 121), ['blade-25']), playedThisTurn: 1 }; // 敛刃 2 费：8 伤害 + 蓄火
  const banked = playCard(rig, 'rig-0', rig.enemies[0].uid);
  assert.equal(banked.player.energy, 1);
  const next = endTurn(banked);
  assert.equal(next.player.energy, 3 + 1);
  assert.equal(next.player.statuses.bank, undefined, '蓄火转成能量后就用掉了');

  const drained = structuredClone(next);
  drained.player.statuses.drained = 2;
  assert.equal(endTurn(drained).player.energy, 1);
});

test('缠布让下回合少抽牌，最少抽 1 张', () => {
  const rig = withHand(startBattle('ch1-1', 'blade', 131), []);
  rig.player.statuses.shrouded = 2;
  const after = endTurn(rig);
  assert.equal(after.hand.length, 3);
  assert.equal(after.player.statuses.shrouded, undefined);

  const smothered = withHand(startBattle('ch1-1', 'blade', 132), []);
  smothered.player.statuses.shrouded = 9;
  assert.equal(endTurn(smothered).hand.length, 1);
});

test('回合结束弃掉整手牌，下回合重新抽 5 张（缠布则更少）', () => {
  const rig = withHand(startBattle('ch1-1', 'blade', 301), ['blade-25', 'blade-25', 'blade-25']);
  const after = endTurn(rig);
  assert.equal(after.hand.some(card => card.uid.startsWith('rig-')), false, '手牌不会跨回合留下');
  assert.equal(after.discard.filter(card => card.uid.startsWith('rig-')).length, 3, '弃进弃牌堆');
  assert.equal(after.hand.length, 5, '下回合抽满 5 张');
  assert.equal(count(after), count(rig), '只是换个堆待着，牌数不变');
  assert.ok(after.log.some(line => line.text.includes('弃掉 3 张手牌')));

  const shrouded = withHand(startBattle('ch1-1', 'blade', 302), ['blade-25']);
  shrouded.player.statuses.shrouded = 2;
  assert.equal(endTurn(shrouded).hand.length, 3, '缠布 2 层就只抽 3 张');
});

test('拾荒犬的翻找把弃牌堆里的一张牌埋进 exhaust，牌数守恒', () => {
  let s = startBattle('ch1-2', 'blade', 311);
  const size = count(s);
  s = endTurns(s, 2); // 萤火 3/拾荒犬 6、再一轮，第三拍才是翻找
  assert.equal(s.exhaust.length, 0);
  assert.ok(s.discard.length >= 5, '每回合弃下来的手牌就是它的食物');
  // 这一手在下个回合结束时也会进弃牌堆，被埋的只可能出自这些牌里
  const edible = new Set([...s.hand, ...s.discard].map(card => card.uid));
  const after = endTurn(s);
  assert.equal(after.exhaust.length, 1);
  const buried = after.exhaust[0];
  assert.ok(edible.has(buried.uid), '埋的是弃牌堆里的牌');
  assert.equal([...after.hand, ...after.draw, ...after.discard].some(card => card.uid === buried.uid), false,
    '埋掉的牌不在任何还能抽到的地方');
  assert.equal(count(after), size, '牌数守恒');
  assert.ok(after.log.some(line => line.text.includes('翻找')));
});

test('壁垒每层保留 1 点格挡，不动每回合补上格挡与壁垒', () => {
  const rig = withHand(startBattle('ch1-1', 'blade', 141), []);
  rig.player.block = 30; // 14 点伤害吃不完，回合开始时还剩 16
  rig.player.statuses.rampart = 2;
  assert.equal(endTurn(rig).player.block, 2);

  const still = withHand(startBattle('ch1-1', 'blade', 142), []);
  still.powers.turnBlock = 2;
  still.powers.turnRampart = 1;
  const after = endTurn(still);
  assert.equal(after.player.block, 2, '不动之力在抽牌之后结算');
  assert.equal(after.player.statuses.rampart, 1);
});

test('反震每次被命中都反击，多段攻击按次数算，攻击者会被打死', () => {
  const rig = withHand(startBattle('ch1-1', 'blade', 151), []);
  rig.player.statuses.retaliate = 4;
  rig.enemies[0].hp = 5;
  rig.enemies[0].intent = [{ kind: 'attack', amount: 2, times: 3 }];
  rig.enemies[1].intent = [];
  const after = endTurn(rig);
  assert.equal(after.enemies[0].dead, true, '5 点生命吃不住两次反震');
  // 每次 2 + 聚群 2 = 4；第二段之后攻击者就死了，所以第三段没有打出来
  assert.equal(after.player.hp, 60 - 4 * 2);
  assert.equal(after.player.statuses.retaliate, undefined, '反震在整轮结束后清零');
});

test('萤火的馈赠在它回合开始时发放，然后才动手', () => {
  // 萤火树洞 rolls how many 萤火 turn up; this test is about the gift, so the board is pinned to one
  // of each rather than to whatever the dice said.
  const rolled = startBattle('ch1-2', 'blade', 161);
  const s = unmutated(rolled);
  s.enemies = [s.enemies.find(enemy => enemy.id === 'emberfly')!, s.enemies.find(enemy => enemy.id === 'scavenger')!];
  assert.equal(s.player.statuses.ember, undefined);
  const after = endTurn(s);
  assert.equal(after.player.statuses.ember, 1);
  assert.equal(after.player.hp, 60 - 3 - 6, '萤火 3 点 + 拾荒犬 6 点');
  assert.equal(after.player.statuses.drained, undefined);
});

test('换岗把「未熄的誓言」洗进抽牌堆；打出它会给守望者回血与力量', () => {
  const rig = structuredClone(startBattle('ch1-5', 'blade', 171));
  rig.enemies[0].intent = [{ kind: 'special', note: '换岗 · 将一张「未熄的誓言」放入你的牌堆' }];
  const shuffledIn = endTurn(rig);
  assert.equal(shuffledIn.draw.filter(card => card.cardId === 'oath').length, 1);
  assert.equal(shuffledIn.enemies[0].hp, shuffledIn.enemies[0].maxHp, '这一拍不打人');

  const oath = structuredClone(shuffledIn);
  oath.enemies[0].hp = 100;
  oath.hand = [{ uid: 'rig-oath', cardId: 'oath' }];
  oath.player.energy = 3;
  const played = playCard(oath, 'rig-oath', oath.enemies[0].uid);
  assert.equal(played.player.statuses.ember, 3);
  assert.equal(played.enemies[0].hp, 106, '回复 6 点，不超过生命上限');
  assert.equal(played.enemies[0].statuses.strength, 1);
  assert.equal(played.discard.filter(card => card.cardId === 'oath').length, 1);
  assert.equal(cardCost(OATH.id), 0);
  assert.equal(cardName(OATH.id), '未熄的誓言');
  assert.ok(cardRules(OATH.id).includes('余烬'));
});

test('played() 数的是这张牌之前的张数，handSize() 不含正在打出的这张', () => {
  const rig = withHand(startBattle('ch1-5', 'blade', 181), ['blade-09', 'blade-09']); // 三叠 2×3，连缀时 2×4
  const first = playCard(rig, 'rig-0', rig.enemies[0].uid);
  assert.equal(lost(first.enemies[0]), 6);
  const second = playCard(first, 'rig-1', first.enemies[0].uid);
  assert.equal(lost(second.enemies[0]), 12, '第二张时 played() 只有 1，还没到连缀');

  const empty = withHand(startBattle('ch1-5', 'bone', 182), ['bone-08']); // 白骨墙：空明 14 点
  assert.equal(playCard(empty, 'rig-0').player.block, 14);
  const stocked = withHand(startBattle('ch1-5', 'bone', 183), ['bone-08', 'bone-08']);
  assert.equal(playCard(stocked, 'rig-0').player.block, 9, '手里还有牌就不算空明');
});

test('不在玩家回合时，endTurn / playCard 抛中文错误', () => {
  const base = startBattle('ch1-1', 'blade', 191);
  const won = { ...base, phase: 'won' as const };
  assert.throws(() => endTurn(won), /战斗已经结束/);
  assert.throws(() => playCard(won, base.hand[0].uid), /战斗已经结束/);
  const enemy = { ...base, phase: 'enemy' as const };
  assert.throws(() => endTurn(enemy), /敌人正在行动/);
  assert.throws(() => playCard(enemy, base.hand[0].uid), /敌人正在行动/);
});

test('intentText 覆盖每一种意图', () => {
  assert.equal(intentText({ kind: 'attack', amount: 6 }), '攻击 6');
  assert.equal(intentText({ kind: 'attack', amount: 5, times: 2 }), '攻击 5×2');
  assert.equal(intentText({ kind: 'attack', amount: 15, note: '冲撞' }), '冲撞 · 攻击 15');
  assert.equal(intentText({ kind: 'block', amount: 6 }), '格挡 6');
  assert.equal(intentText({ kind: 'buff', status: 'strength', amount: 2 }), '力量 +2');
  assert.equal(intentText({ kind: 'debuff', status: 'drained', amount: 2, note: '巡视' }), '巡视 · 你 +2 枯竭');
  assert.equal(intentText({ kind: 'pollute', amount: 1 }), '落灰');
  assert.equal(intentText({ kind: 'pollute', amount: 3 }), '落灰 ×3');
  assert.equal(intentText({ kind: 'drain', amount: 2 }), '枯竭 2');
  assert.equal(intentText({ kind: 'ward', amount: 3 }), '同僚格挡 3');
  assert.equal(intentText({ kind: 'bury', amount: 1, note: '翻找' }), '翻找 · 掩埋 1');
  assert.equal(intentText({ kind: 'summon', id: 'shadewolf', note: '嚎叫' }), '嚎叫 · 召唤 影狼');
  assert.equal(intentText({ kind: 'devour', note: '吞光 · 吃下 4 层' }), '吞光 · 吃下 4 层');
  assert.equal(intentText({ kind: 'devour' }), '吞光');
  assert.equal(intentText({ kind: 'steal', status: 'ember', note: '窃火' }), '窃火 · 窃取 余烬');
  assert.equal(intentText({ kind: 'special', note: '换岗' }), '换岗');
});

test('isValidBattle 拒绝损坏的存档', () => {
  const s = startBattle('ch1-1', 'blade', 201);
  assert.equal(isValidBattle(s), true);
  for (const broken of [
    null, undefined, 42, 'battle', {},
    { ...s, version: 2 },
    { ...s, encounterId: 'ch9-9' },
    { ...s, deck: 'lantern' },
    { ...s, phase: 'drawing' },
    { ...s, turn: 0 },
    { ...s, seed: 1.5 },
    { ...s, player: { ...s.player, hp: 61 } },
    { ...s, player: { ...s.player, hp: -1 } },
    // 守望者之誓 raises the ceiling, so above 60 is legal now — but *below* it is not, and neither is
    // health that has climbed past whatever the ceiling currently is.
    { ...s, player: { ...s.player, maxHp: 59 } },
    { ...s, player: { ...s.player, maxHp: 60.5 } },
    { ...s, player: { ...s.player, maxHp: 75, hp: 80 } },
    { ...s, relics: { main: 'not-a-relic' } },
    { ...s, relics: { sub: 42 } },
    { ...s, hits: -1 },
    { ...s, costMarks: { c0: 99 } },
    { ...s, player: { ...s.player, energyPerTurn: 4 } },
    { ...s, player: { ...s.player, statuses: { ember: -2 } } },
    { ...s, player: { ...s.player, statuses: { nope: 1 } } },
    { ...s, enemies: [] },
    { ...s, enemies: [{ ...s.enemies[0], id: 'nosuchwolf' }] },
    { ...s, enemies: [{ ...s.enemies[0], hp: 99 }] },
    { ...s, hand: [...s.hand, ...Array.from({ length: 6 }, (_, i) => ({ uid: `extra-${i}`, cardId: 'ash' }))] },
    { ...s, draw: [...s.draw, { ...s.draw[0] }] },
    { ...s, hand: [{ uid: 'x', cardId: 'not-a-card' }] },
    { ...s, log: [{ id: 1, text: 'x', tone: 'silly' }] },
    { ...s, powers: { ...s.powers, turnBlock: -1 } },
  ]) {
    assert.equal(isValidBattle(broken), false, `本该拒绝：${JSON.stringify(broken)?.slice(0, 60)}`);
  }
});
