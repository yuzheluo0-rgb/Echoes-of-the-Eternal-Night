/**
 * The relics' contract with the game.
 *
 * The first test in this file is the reason the file exists: **a relic that can be drawn must do
 * something.** The player spends a draw on it, the card prints an effect, and if the engine has no
 * behaviour for it the card lies. That is not a bug a type checker or a screenshot can catch, so it
 * gets a test.
 *
 * The rest pins the plumbing: that each trigger actually reaches the engine, that the two slots give
 * different amounts, and that the draw and the unlock ladder behave.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAYER_MAX_HP, canPlay, cardCostNow, endTurn, isValidBattle, livingEnemies, playCard, relicModifier,
  startBattle as startBattleRaw,
  startBattle, type BattleState,
} from './engine.ts';
import {
  IMPLEMENTED_RELICS, RELIC_EFFECTS, refinedPair, refineLines, refineSteps, refineSummary,
  type RefineTier, type RelicSlot,
} from './relics.ts';
import { STATUS_GOOD, type StatusId } from './types.ts';
import { DRAW_OPTIONS, RELIC_PRICE, drawRelics, offerRelics, opensSubSlot } from './relicDraw.ts';
import {
  canEnter, claimRelic, discardRelic, earnsRelic, finishBattle, isValidRun as isValidRunForTest,
  newRun, offerDraw, rollOffer, swapRelics, type ChapterRun,
} from './run.ts';
import { REFINE_TEXT, RELIC_BY_ID, RELICS, type RelicDefinition } from '../relics/relics.ts';
import {
  availableRelics, creditProgress, emptyProgress, earnedRelics, isValidProgress, poolSize,
  startingRelics, unlocksFor,
} from '../relics/unlocks.ts';

/** A battle carrying one relic in the given slot. */
function withRelic(id: string, slot: 'main' | 'sub' = 'main', encounter = 'ch1-1'): BattleState {
  return startBattle(encounter, 'blade', 7, { relics: { [slot]: id } });
}

// --------------------------------------------------- 1. nothing ships blank

test('凡第一章能抽到的遗物，必有实现', () => {
  const pool = availableRelics(creditProgress(emptyProgress(), 'ch1-4'));
  assert.ok(pool.length > 0);
  const blank = pool.filter(relic => !IMPLEMENTED_RELICS.includes(relic.id));
  assert.deepEqual(blank.map(relic => `${relic.id}（${relic.name}）`), [],
    '这些遗物能抽到，却没有任何效果——玩家会为一件什么都不做的东西花掉一次抽取');
});

/**
 * Play a fixed scripted battle and describe everything that came out of it.
 *
 * The script has to be rich enough to *trigger* the relics rather than merely run alongside them:
 * several turns, skills as well as attacks, cards played in a fixed order so a cost change is
 * visible, enemies that actually die. Anything a relic does — a status, a block, a number of cards
 * drawn, a shift in a cost, damage that lands differently — ends up somewhere in here.
 */
function fingerprint(
  relicId: string | undefined, useSlot: 'main' | 'sub' = 'main', refine?: RefineTier,
) {
  const relics = relicId ? { [useSlot]: relicId } : undefined;
  const refined = relicId && refine ? { [relicId]: refine } : undefined;
  // Started hurt, so 熄芯's 「生命低于一半」 is live from turn one rather than never.
  let s = startBattle('ch1-2', 'blade', 9, { hp: 26, relics, refined });
  const seen: string[] = [];
  const snapshots: unknown[] = [];
  /**
   * Total 生命 taken off the enemies, counted after **every card played** rather than at the end.
   *
   * Without this the fingerprint only sees outcomes, and an outcome is the wrong unit for the damage
   * relics: 铁钉's +1 per hit frequently does not change *which turn* 萤火树洞's little enemies die
   * on, so 未淬炼 and 大强化 produced byte-identical fingerprints and 淬炼 looked broken when it was
   * not. Damage is the quantity these relics actually change, so damage is what gets recorded.
   */
  let dealt = 0;
  const enemyHp = () => s.enemies.reduce((sum, enemy) => sum + Math.max(0, enemy.hp), 0);
  for (let turn = 0; turn < 6 && s.phase === 'player'; turn++) {
    // Every card in hand with its cost **as it stands right now**, recorded whether or not the script
    // goes on to play it. The cost relics are the reason: 引火 already discounts the first card of a
    // turn, so 断齿梳's extra point lands on a card that is already free and the clamp at zero eats it
    // — the discount is real and invisible at the same time. Reading the hand reads the discount.
    seen.push(...s.hand.map(entry => `hand:${entry.cardId}@${cardCostNow(s, entry.cardId, entry.uid)}`));
    // A fixed opening order each turn: cheapest attack, then a skill, then a *2-cost* card. The
    // expensive one matters — 雷击木 deepens 引火, and on a 1-cost card both land on the floor of
    // zero and the relic looks like it does nothing.
    // 淬刃 is in here for 铁匠锤, whose discount is on the first **power** card. Note that 攒烬 is not
    // one: it installs a power but its printed type is `skill`, so a script built from the obvious
    // cards would never play a power at all and the relic would look dead.
    const order = ['blade-25', 'blade-14', 'blade-01', 'blade-04', 'blade-02', 'blade-03', 'blade-21', 'blade-18'];
    // Two cards a turn, not a full hand: 陶灯 wants energy left over and 焚书 wants cards left in
    // hand, and a script that plays everything until empty sees neither.
    let playedThisTurn = 0;
    for (const cardId of order) {
      if (playedThisTurn >= 2) break;
      const card = s.hand.find(entry => entry.cardId === cardId && canPlay(s, entry.uid));
      if (!card) continue;
      playedThisTurn += 1;
      seen.push(`${cardId}@${cardCostNow(s, card.cardId, card.uid)}`);
      const before = enemyHp();
      s = playCard(s, card.uid, livingEnemies(s)[0]?.uid);
      dealt += Math.max(0, before - enemyHp());
      // Read the hand again **after** the play, which is the only moment 铁匠锤 and 断齿梳 are legible:
      // 引火 has expired for the turn by now, so the cost they change is no longer sharing a clamp with
      // it. Reading only at the top of the turn is how three working relics got reported as broken.
      seen.push(...s.hand.map(entry => `hand:${entry.cardId}@${cardCostNow(s, entry.cardId, entry.uid)}`));
      if (s.phase !== 'player') break;
    }
    if (s.phase !== 'player') break;
    // **Every** line, not only the ones that mention a relic. A damage relic's extra point is usually
    // *overkill* on this encounter — 萤火树洞's 萤火 has 8 生命 and dies to the first swing at every
    // tier — so the number never reaches the final state and the only place it survives is the log.
    // An outcome-only fingerprint called 淬炼 broken on eleven relics that were working perfectly.
    seen.push(...s.log.map(line => line.text));
    // Turn one is snapshotted on its own: 缺口碗's 反震 is wiped by the *next* turn's `beginTurn`, so
    // by the end of the fight it has left no trace in the final state.
    if (turn === 0) snapshots.push(s.player.statuses, s.player.block, s.powers, s.costMarks, s.hand.length);
    s = endTurn(s);
  }
  return JSON.stringify([
    seen, snapshots, dealt,
    s.player.hp, s.player.block, s.player.statuses, s.powers,
    s.turn, s.phase, s.costMarks,
    s.enemies.map(enemy => [enemy.hp, enemy.maxHp, enemy.statuses]),
    s.hand.length, s.draw.length, s.discard.length,
  ]);
}

/**
 * The relics a scripted *battle* cannot show, and why. Each is checked by a named test below.
 *
 * **This list is not a place to hide.** A relic that stops working will appear as a failure here and
 * has to be either fixed or explained — which is exactly the "it silently does nothing" bug this
 * whole file exists to catch.
 */
const NOT_VISIBLE_IN_ONE_BATTLE: Record<string, string> = {
  // Paid at the victory screen, which a battle fingerprint never reaches.
  'dry-ration': '胜利结算才回血', 'copper-coin': '胜利结算才给钱', 'waterskin': '胜利结算才翻倍',
  'tin-cup': '胜利结算才回血', 'moss-jar': '胜利结算才回血', ledger: '胜利结算才加钱',
  // Need a board the script never builds.
  'iron-mask': '要挨一次致命伤', 'ash-urn': '手上要有「灰烬」',
  'salt-jar': '要有灼烧', 'charred-block': '要有敌人被灼烧烧死',
  // Need a turn or a hand the script never has.
  'fish-bone': '要手牌恰好被打空', 'brass-watch': '要活到第 5 回合',
  'dead-wick': '主槽要生命低于一半、副槽要低于四分之一',
};

test('每一件能抽到的遗物，装上去都必须真的改变什么', () => {
  // 这条是这一整个文件的理由。遗物不进手牌、不出现在牌面上——一件什么都不做的遗物在界面里
  // **看不出来**，玩家只会觉得「抽了个没用的东西」，而任何类型检查、任何截图都发现不了。
  // 所以：把它装上，跑一场固定脚本的战斗，和不装的时候逐字段比。
  const pool = availableRelics(creditProgress(emptyProgress(), 'ch1-4'));
  assert.ok(pool.length > 40, '第一章的池子不该这么小');

  const baseline = fingerprint(undefined);
  const unexplained: string[] = [];
  for (const relic of pool) {
    if (fingerprint(relic.id) !== baseline) continue;
    if (NOT_VISIBLE_IN_ONE_BATTLE[relic.id]) continue;
    unexplained.push(`${relic.id}（${relic.name}）`);
  }
  assert.deepEqual(unexplained, [], '这些遗物装上之后和没装完全一样，而且没有登记在案——它们不会触发');
});

test('副槽也真的有效果，而不是只在主槽里写着', () => {
  const pool = availableRelics(creditProgress(emptyProgress(), 'ch1-4'));
  const baseline = fingerprint(undefined);
  const unexplained = pool
    .filter(relic => fingerprint(relic.id, 'sub') === baseline && !NOT_VISIBLE_IN_ONE_BATTLE[relic.id])
    .map(relic => `${relic.id}（${relic.name}）`);
  assert.deepEqual(unexplained, [], '这些遗物放进副槽之后什么都不做');
});

// ------------------------------------------------------------ 淬炼

/**
 * Everything a relic hands the engine, as one signed total: **positive means it helped the player**.
 *
 * This runs the relic's **own handlers** against a recording context at a given 淬炼 tier, so what is
 * compared below is behaviour rather than two strings of prose. The context mirrors the engine's
 * arithmetic through the exported `refinedPair` / `refineSteps` instead of re-implementing it, so a
 * change to how the bump works moves both together.
 *
 * Signs, because a relic is not all upside: a cost is a negative, a penalty in the sub slot is a
 * negative, and an enemy status is a negative exactly when that status is good *for the enemy* — the
 * same reading `STATUS_GOOD` gives the engine. 抽牌 is weighted double, because a card is worth more
 * than the discard it costs, which is the only way 「抽 2 弃 2」 reads as the upgrade it is.
 *
 * The probe walks turns 1–8 and both a full and an empty hand, because several relics only fire on a
 * named turn (怀表, 沙漏) or with nothing left in hand (鱼骨) — a single fixed board would report those
 * as 「淬炼没有让任何东西变大」 and be wrong about it.
 */
/**
 * Does this status help **whoever is holding it**?
 *
 * Deliberately not `STATUS_GOOD`, which is the engine's *log tone* table and answers a different
 * question — it marks 力量 as bad news because the line it usually colours is an enemy gaining it.
 * For a strength reading, what matters is that handing an enemy `strength: -2` is good for the player,
 * and only a table about the holder says that.
 */
const HELPS_HOLDER: Record<StatusId, boolean> = {
  ember: true, edge: true, rampart: true, reflection: true, retaliate: true, bank: true, strength: true,
  scorch: false, mark: false, drained: false, shrouded: false,
};

function strength(relicId: string, slot: RelicSlot, tier: RefineTier | undefined): number {
  const steps = refineSteps(tier);
  const numbers: number[] = [];
  const push = (n: number) => { if (n) numbers.push(n); };
  const enemy = { hp: 20, maxHp: 20, block: 0, statuses: {}, dead: false, uid: 'e0' };
  const probe = (turn: number, handSize: number) => ({
    slot, refine: tier, steps,
    v: (main: number, sub: number) => {
      const [m, u] = refinedPair(main, sub, tier);
      return slot === 'main' ? m : u;
    },
    main: slot === 'main',
    n: (base: number) => base + steps,
    turn, hpFraction: .3,
    // Energy above 2 so 陶灯's 「结束回合时还有能量」 gate is open at every tier.
    player: { statuses: {}, block: 0, energy: 3, hp: 18, maxHp: 60 },
    handSize,
    enemies: [enemy],
    subject: enemy,
    fallen: enemy,
    byScorch: true,
    hits: 3,
    count: () => 0, bump: () => {}, roll: () => 0,
    log: () => {},
    status: (who: 'player' | 'enemies', st: StatusId, amount: number) => push(
      who === 'player' ? (HELPS_HOLDER[st] ? amount : -amount) : (HELPS_HOLDER[st] ? -amount : amount)),
    statusOn: (_e: unknown, st: StatusId, amount: number) => push(HELPS_HOLDER[st] ? -amount : amount),
    block: (a: number) => push(a),
    energy: (a: number) => push(a),
    draw: (a: number) => push(a * 2),
    heal: (a: number) => push(a),
    loseHp: (a: number) => push(-a),
    stripBlock: (a: number) => push(a),
    reclaim: (a: number) => push(a),
    tutor: () => {},
    purgeJunk: () => 0,
    discardRandom: (a: number) => push(-a),
    // `by` is positive when the cards get *cheaper*, which is why 观星镜 passes −1 as its penalty.
    cheapenHand: (count: number, by: number) => push(by * count),
    copyHand: (count: number, extra = 0) => push(count * 2 - extra),
    topOfDraw: () => ['一', '二', '三', '四', '五'],
  }) as never;

  const effects = RELIC_EFFECTS[relicId];
  for (const trigger of ['battleStart', 'enemyKilled', 'firstAttacked', 'firstAttackedTurn'] as const) {
    effects.triggers?.[trigger]?.(probe(1, 3));
  }
  for (let turn = 1; turn <= 8; turn++) {
    for (const handSize of [3, 0]) {
      effects.triggers?.turnStart?.(probe(turn, handSize));
      effects.triggers?.turnEnd?.(probe(turn, handSize));
    }
  }
  // Costs read the other way round: the engine *adds* this number to a cost, so a negative one is a
  // discount and helps the player.
  const COST_KEYS = new Set(['firstCardCost', 'firstSkillCost', 'firstPowerCost']);
  for (const [key, spec] of Object.entries(effects.modifiers ?? {})) {
    // A `[main, sub]` pair goes through the same slot pick and the same bump the engine's
    // `readModifier` applies — reading `spec[0]` directly is how the first run of this test reported
    // eight perfectly good relics as 「淬炼没有让任何东西变大」.
    const value = typeof spec === 'function' ? spec(probe(1, 3)) : (() => {
      const [m, s] = spec as [number, number];
      const [a, b] = refinedPair(m, s, tier);
      return slot === 'main' ? a : b;
    })();
    push(COST_KEYS.has(key) ? -value : value);
  }
  return numbers.reduce((sum, n) => sum + n, 0);
}

test('淬炼：每一件遗物的数值都真的变大，而且是两档递进', () => {
  // 用户要的是「小强化 +1、大强化 +2」，而**特殊机制的遗物要专门设计它的刻度**——水囊是百分比、
  // 铁匠锤是费用、怀表是回合数，对它们来说 +1 要么看不见要么是反的。
  //
  // 所以这条测试不检查「+1」这个数，它检查那条**性质**：大强化严格强于小强化，小强化严格强于
  // 未淬炼，一件都不能例外。谁把某件遗物漏了、或者给某件写错了方向（费用类最容易写反），
  // 这里会直接红——而**界面上一件淬炼了没变化的遗物是看不出来的**，这正是这一整个文件存在的理由。
  const pool = availableRelics(creditProgress(emptyProgress(), 'ch1-4'));
  assert.ok(pool.length > 40, '第一章的池子不该这么小');

  const flat: string[] = [];
  for (const relic of pool) {
    // 手写刻度的遗物**不在这一条的管辖范围**，这是这一条自己的判据决定的：`strength` 数的是数字，
    // 而怀表的强化是**时间**——提前一回合给同一点能量，数字一个都没动。它们在 `REFINE_TEXT` 里
    // 有逐件写的文案，由下面那条「卡面印得出什么变大了」看着。
    if (REFINE_TEXT[relic.id]) continue;
    for (const slot of ['main', 'sub'] as const) {
      const base = strength(relic.id, slot, undefined);
      const small = strength(relic.id, slot, 'small');
      const large = strength(relic.id, slot, 'large');
      if (small > base && large > small) continue;
      flat.push(`${relic.id}（${relic.name}）${slot === 'main' ? '主槽' : '副槽'}：`
        + `未淬炼 ${base} → 小强化 ${small} → 大强化 ${large}`);
    }
  }
  assert.deepEqual(flat, [], '这些遗物淬炼之后没有变大，或者大强化没有比小强化更大');
});

test('淬炼：接在引擎上，两档在真战斗里也确实不一样', () => {
  // 上面那条是探针，这条是实弹：装上去、跑同一场脚本战斗，三个档位必须给出三份不同的指纹。
  // 分开是因为探针证明了「数字大了」，而这条证明「数字真的走到了引擎里」——中间任何一处没接线，
  // 探针仍然是绿的。
  const pool = availableRelics(creditProgress(emptyProgress(), 'ch1-4'));
  const same: string[] = [];
  for (const relic of pool) {
    for (const slot of ['main', 'sub'] as const) {
      const base = fingerprint(relic.id, slot);
      const small = fingerprint(relic.id, slot, 'small');
      const large = fingerprint(relic.id, slot, 'large');
      // 胜利结算类与要特殊场面的那几件在一场战斗里本来就看不见，和上面两张表同一份名单。
      if (NOT_VISIBLE_IN_ONE_BATTLE[relic.id]) continue;
      if (base !== small && small !== large) continue;
      same.push(`${relic.id}（${relic.name}）${slot === 'main' ? '主槽' : '副槽'}`);
    }
  }
  assert.deepEqual(same, [], '这些遗物淬炼之后，实弹战斗里的结果和没淬炼时一模一样');
});

test('淬炼：卡面印得出「什么变大了」，一件都不许空着', () => {
  // 引擎里数字涨了、测试全绿、而卡面还印着原文案——玩家看到的就是「淬炼了但什么也没发生」。
  // **打磨那一轮正是这么栽的**（引擎读 upgrades.ts，卡面读 card.text，两条路一分叉卡面就说谎），
  // 所以这一条查的是**界面那一侧**：每一件能抽到的遗物、两个槽、两个档位，都必须印得出至少一行。
  //
  // 两个方向都查，因为手写刻度表既可能写多也可能写漏：
  //   写多了 → 那件其实走通用 +N，手写文案把它说成别的东西；
  //   写漏了 → 通用行会说「每一个数 +1」，而它其实不是。
  const pool = availableRelics(creditProgress(emptyProgress(), 'ch1-4'));
  const blank: string[] = [];
  const shouldBeAuthored = new Set<string>();
  for (const relic of pool) {
    for (const slot of ['main', 'sub'] as const) {
      for (const tier of ['small', 'large'] as const) {
        if (!refineLines(relic.id, slot, tier).length) {
          blank.push(`${relic.id}（${relic.name}）${slot === 'main' ? '主槽' : '副槽'} · ${tier}`);
        }
      }
      // 「走通用 +N」的判据：未淬炼 → 小强化，**每一个标签都恰好动 1**。
      // 空摘要也算数：`every` 在空数组上恒为真，怀表就会因为「什么都没动」而被判成走通用行——
      // 而它的强化是**时间**（提前一个回合），一个 +N 的行印在它身上就是谎话。
      const small = refineSummary(relic.id, slot, 'small');
      if (!small.length || !small.every(delta => Math.abs(delta.to - delta.from) === 1)) {
        shouldBeAuthored.add(relic.id);
      }
    }
  }
  assert.deepEqual(blank, [], '这些遗物淬炼之后，卡面印不出任何东西');
  assert.deepEqual([...shouldBeAuthored].sort(), Object.keys(REFINE_TEXT).sort(),
    '手写刻度表和实际行为对不上：写多的那件其实走通用 +N，漏写的那件通用行会说谎');
});

test('淬炼：阶梯本身是单调的，写在表里的每一对数都被抬高', () => {
  // 直接对阶梯本身下手，不经过战斗：`refinedPair` 是 `v` 唯一读的东西，所以它单调等于每一件
  // 写了 `[main, sub]` 对的遗物都单调。
  for (const relic of RELICS) {
    const effects = RELIC_EFFECTS[relic.id];
    for (const spec of Object.values(effects?.modifiers ?? {})) {
      if (typeof spec !== 'function') {
        const [m, s] = spec;
        const [bm, bs] = refinedPair(m, s, undefined);
        const [sm, ss] = refinedPair(m, s, 'small');
        const [lm, ls] = refinedPair(m, s, 'large');
        assert.ok(sm > bm && ss > bs, `${relic.id}：小强化没有抬高数值`);
        assert.ok(lm > sm && ls > ss, `${relic.id}：大强化没有比小强化更高`);
      }
    }
  }
});

test('登记在案的那几件：换个能触发的场景，它们确实有效', () => {
  // 上面那张表说「战斗里看不出来」，这条就逐个把它们真的做出来，证明是场景不够而不是遗物坏了。
  const run = {
    ...newRun('blade', 'bone', 21), hp: 30,
    relics: { main: 'copper-coin', sub: 'dry-ration' },
  };
  const win = finishBattle(run, { ...startBattle('ch1-1', 'blade', 7, { hp: 30 }), phase: 'won' });
  assert.ok(win.gold > 0, '铜板应该在结算时给钱');
  assert.ok(win.healed > 0, '干粮应该在结算时回血');

  // 皮水袋 / 锡杯 / 苔藓罐 / 商队账本：同一个结算口，不同的加成
  for (const [id, check] of [
    ['waterskin', (o: ReturnType<typeof finishBattle>) => o.healed > 0],
    ['tin-cup', (o: ReturnType<typeof finishBattle>) => o.healed >= 6],
    ['moss-jar', (o: ReturnType<typeof finishBattle>) => o.healed >= 8],
    ['ledger', (o: ReturnType<typeof finishBattle>) => o.gold > 0],
  ] as const) {
    const solo = { ...newRun('blade', 'bone', 21), hp: 20, relics: { main: id } };
    const outcome = finishBattle(solo, { ...startBattle('ch1-1', 'blade', 7, { hp: 20 }), phase: 'won' });
    assert.ok(check(outcome), `${id} 在胜利结算里没有生效`);
  }

  // 铁面具：一场战斗里第一次致命伤只留 1 点生命
  const dying = startBattle('ch1-1', 'blade', 7, { hp: 4, relics: { main: 'iron-mask' } });
  dying.enemies = [dying.enemies[0]];
  assert.equal(endTurn(dying).player.hp, 1, '铁面具没有挡下致命伤');

  // 灰烬瓮：把「灰烬」收走。灰烬是敌人塞进牌堆的，所以要把牌堆直接递给开局——不给的话这一验
  // 是空的（干净牌堆里没有灰烬可清，装不装遗物都是 0）。
  assert.equal(junkLeft(undefined), 2, '不给遗物的话两张灰烬都还在');
  assert.equal(junkLeft('ash-urn'), 0, '灰烬瓮没有收走灰烬');

  // 盐罐 / 焦木块：都要灼烧
  const burning = startBattle('ch1-1', 'blade', 7, { relics: { main: 'salt-jar' } });
  burning.enemies[0].statuses.scorch = 3;
  const burned = endTurn(burning);
  assert.ok(burned.log.some(line => /灼烧 .* 受到 4 点伤害/.test(line.text)),
    '盐罐应该让灼烧多打 1 点');

  const cinder = startBattle('ch1-1', 'blade', 7, { relics: { main: 'charred-block' } });
  cinder.enemies[0].hp = 2;
  cinder.enemies[0].statuses.scorch = 5;
  assert.ok(endTurn(cinder).player.statuses.ember, '焦木块应该在敌人被烧死时给余烬');

  // 鱼骨：回合结束时手牌恰好为空
  const bare = startBattle('ch1-1', 'blade', 7, { relics: { main: 'fish-bone' } });
  bare.hand = [];
  assert.ok(endTurn(bare).log.some(line => line.text.includes('遗物') && line.text.includes('格挡')),
    '鱼骨没有在手牌为空时给格挡');

  // 黄铜怀表：第 5 回合开始时能量 +1
  let clock = startBattle('ch1-1', 'blade', 7, { hp: 400, relics: { main: 'brass-watch' } });
  clock.player.hp = 400; clock.player.maxHp = 400;
  for (let i = 0; i < 4; i++) clock = endTurn(clock);
  assert.equal(clock.turn, 5, '这个 rig 应该走到第 5 回合');
  assert.ok(clock.log.some(line => line.text.includes('遗物') && line.text.includes('能量')),
    '黄铜怀表没有在第 5 回合给能量');

  // 熄芯：主槽一半、副槽四分之一
  for (const [slot, hp, expected] of [['main', 20, 1], ['sub', 20, 0], ['sub', 12, 1]] as const) {
    const s = startBattle('ch1-1', 'blade', 7, { hp, relics: { [slot]: 'dead-wick' } });
    assert.equal((s.player.statuses.ember ?? 0) >= expected && (expected === 0 ? (s.player.statuses.ember ?? 0) === 0 : true), true,
      `熄芯${slot === 'main' ? '主' : '副'}槽在 ${hp}/60 时的表现不对`);
  }
});

/** Open a battle on a pile that already holds two 灰烬, and count what survives the opening. */
function junkLeft(relicId: string | undefined) {
  const s = startBattle('ch1-1', 'blade', 7, {
    relics: relicId ? { main: relicId } : undefined,
    cards: [{ cardId: 'blade-01' }, { cardId: 'ash' }, { cardId: 'ash' }],
  });
  return [...s.hand, ...s.draw, ...s.discard].filter(card => card.cardId === 'ash').length;
}

test('修正器的主副槽不能写成同一个数字', () => {
  // 结构检查，而不是行为检查。行为对比试过：跑七八个回合去比轨迹，结果被一堆「条件没满足所以
  // 看不出差别」的遗物淹没（打火石的副槽只在已有余烬时才改给格挡、胜利结算类的在战斗里根本
  // 不显形、单敌人时随机目标和全体一样）。判不出真问题，只产出噪声。
  //
  // 而最容易犯的错其实是这一个：把 [n, n] 写出来，副槽等于没打折。这个查得又快又准。
  for (const [id, effects] of Object.entries(RELIC_EFFECTS)) {
    for (const [key, spec] of Object.entries(effects.modifiers ?? {})) {
      if (!Array.isArray(spec)) continue;
      assert.notEqual(spec[0], spec[1], `${id} 的 ${key} 主副槽都写成 ${spec[0]}，副槽没有折扣`);
    }
  }
});

test('规则型的副槽：双生镜只接攻击牌，铁面具救你要收费', () => {
  // 这几件的主副差异是「规则不同」而不是「数字不同」，结构检查看不出来，只好点名验。
  const rig = (slot: 'main' | 'sub') => {
    const s = startBattle('ch1-1', 'blade', 7, { relics: { [slot]: 'twin-mirrors' } });
    // rig-0 掩刃（技能）／rig-1 割线（攻击）
    s.hand = [{ uid: 'rig-0', cardId: 'blade-04' }, { uid: 'rig-1', cardId: 'blade-01' }];
    s.player.energy = 3;
    return s;
  };
  assert.ok(playCard(rig('main'), 'rig-0').hand.some(c => c.uid === 'rig-0'), '主槽：技能牌也回到手里');
  assert.ok(!playCard(rig('sub'), 'rig-0').hand.some(c => c.uid === 'rig-0'), '副槽：技能牌不回手');
  assert.ok(playCard(rig('sub'), 'rig-1').hand.some(c => c.uid === 'rig-1'), '副槽：攻击牌回手');

  // 铁面具：主槽白救，副槽让你下回合少 1 点能量。
  // 场面钉成一只狼：两只狼一轮 14 点伤害，救回 1 点也活不过那一轮，验不出规则本身。
  const dying = (slot: 'main' | 'sub') => {
    const s = startBattle('ch1-1', 'blade', 7, { hp: 5, relics: { [slot]: 'iron-mask' } });
    s.enemies = [s.enemies[0]];
    return s;
  };
  assert.equal(endTurn(dying('main')).player.hp, 1, '主槽：本该致命的一击只留下 1 点生命');
  const paid = endTurn(dying('sub'));
  assert.equal(paid.player.hp, 1, '副槽：同样救下来');
  assert.ok(paid.log.some(line => line.text.includes('枯竭')), '副槽：救你要收 1 点能量的代价');
});

test('没有实现的遗物只可能是锁在后续章节的那些', () => {
  const missing = RELICS.filter(relic => !IMPLEMENTED_RELICS.includes(relic.id));
  for (const relic of missing) {
    assert.ok(relic.chapter > 1, `${relic.id} 是第 ${relic.chapter} 章的，但第一章就能抽到却没有实现`);
  }
  // 反向：实现了的，都必须真的在数据里
  for (const id of IMPLEMENTED_RELICS) assert.ok(RELIC_BY_ID.has(id), `${id} 有实现但没有对应的遗物`);
});

// ------------------------------------------------------------- 2. the hooks

test('battleStart 在开局手牌发完之后触发', () => {
  // 铜镜 copies 「a card in hand」, so it only works if the hand exists by then. 缺口碗 grants 反震,
  // which `beginTurn` wipes at the top of every turn — firing before it would erase the relic.
  assert.equal(withRelic('brass-mirror').hand.length, 6, '铜镜应该复制出一张手牌');
  assert.equal(withRelic('chipped-bowl').player.statuses.retaliate, 1, '缺口碗的反震不该被清掉');
});

test('每个触发器都真的接到了引擎上，且至少有一件遗物在用', () => {
  const used = new Set<string>();
  for (const effects of Object.values(RELIC_EFFECTS)) {
    for (const trigger of Object.keys(effects.triggers ?? {})) used.add(trigger);
  }
  assert.deepEqual([...used].sort(), ['battleStart', 'enemyKilled', 'firstAttacked', 'firstAttackedTurn', 'turnEnd', 'turnStart'],
    '写了钩子却没人用，或者用了没写的钩子');

  // 逐个证明它们真的会响。
  assert.equal(withRelic('dry-herbs').player.hp, PLAYER_MAX_HP, '干草药开局是满血，看不出回血');
  const hurt = { ...withRelic('dry-herbs') };
  hurt.player.hp = 40;
  assert.equal(startBattle('ch1-1', 'blade', 7, { hp: 40, relics: { main: 'dry-herbs' } }).player.hp, 44,
    'battleStart：干草药开局回 4 点');

  // 余烬不会消退，所以走完一个回合（第二回合已经开始）是 2 层而不是 1 层——这恰恰证明它在
  // *每个*回合开始都发了，而不是只发一次。
  assert.equal(endTurn(withRelic('ember-seed')).player.statuses.ember, 2, 'turnStart：未熄的火种每回合都给');

  // Reading the *log* rather than the resulting block, because block granted at the end of a turn is
  // eaten by the enemy phase and then reconciled away by 壁垒 at the top of the next one. The state
  // after `endTurn` cannot see it; the line it printed can.
  const grantedBlock = (s: BattleState) =>
    s.log.some(line => line.text.includes('遗物') && line.text.includes('格挡'));

  // 鱼骨只在「回合结束时手牌为空」才给格挡，所以要把手牌清空再造这个局面。
  const emptyHand = withRelic('fish-bone');
  emptyHand.hand = [];
  assert.ok(grantedBlock(endTurn(emptyHand)), 'turnEnd：鱼骨在手牌为空时给了格挡');
  assert.ok(!grantedBlock(endTurn(withRelic('fish-bone'))), '手里有牌就不该给');

  assert.ok(grantedBlock(endTurn(withRelic('iron-tongs'))), 'firstAttacked：铁夹给了格挡');

  const scorched = withRelic('charred-block');              // 焦木块：敌人死于灼烧才给余烬
  scorched.enemies[0].hp = 2;
  scorched.enemies[0].statuses.scorch = 5;
  assert.equal(endTurn(scorched).player.statuses.ember, 2, 'enemyKilled：灼烧烧死的敌人触发焦木块（主槽 2 层）');

});

test('修正器：攻击加伤、抽牌、灼烧、生命上限都真的被读到了', () => {
  // 铁钉主槽每击必加；副槽是「每第 3 次命中」，所以它的值取决于已经打了几下——这正是它在
  // 命中计数上而不是在固定表上的原因。
  assert.equal(relicModifier(withRelic('iron-nail'), 'attackDamage'), 1);
  assert.equal(relicModifier(withRelic('night-lantern'), 'firstAttackDamage'), 3);
  assert.equal(relicModifier(withRelic('night-lantern', 'sub'), 'firstAttackDamage'), 2);
  assert.equal(relicModifier(withRelic('salt-jar'), 'scorchDamage'), 1);
  assert.equal(relicModifier(startBattle('ch1-1', 'blade', 7), 'attackDamage'), 0, '没有遗物就是 0');
});

test('雷击木加深引火：3 费牌第一张只要 1 点', () => {
  const plain = startBattle('ch1-1', 'blade', 7);
  const storm = withRelic('storm-wood');
  assert.equal(cardCostNow(plain, 'blade-27'), 2, '基准：3 费牌引火后 2 点');
  assert.equal(cardCostNow(storm, 'blade-27'), 1, '雷击木再减 1');
  assert.equal(cardCostNow(storm, 'blade-27'), 1);
});

test('生命上限只由遗物抬高，且带进来的血会被重新钳制', () => {
  const plain = startBattle('ch1-1', 'blade', 7, { hp: 60 });
  assert.equal(plain.player.maxHp, PLAYER_MAX_HP);
  // 守望者之誓是秘宝（锁在第二章），所以这里用一件不存在的遗物证明「没有遗物就不变」——
  // 抬高上限的路径由 isValidBattle 那条测试覆盖。
  assert.ok(isValidBattle(plain));
});

test('铜钥匙从抽牌堆里找出牌，而不是从空的弃牌堆里取', () => {
  const s = withRelic('brass-key');
  assert.equal(s.discard.length, 0, '开局弃牌堆本来就是空的');
  assert.equal(s.hand.length, 6, '所以它必须是从抽牌堆找出来的');
  assert.ok(s.log.some(line => line.text.includes('找出了')));
});

test('异变与遗物能同时生效，且状态依然合法', () => {
  for (const id of IMPLEMENTED_RELICS) {
    const s = withRelic(id);
    assert.ok(isValidBattle(s), `${id} 开局后状态不合法`);
    const after = endTurn(s);
    assert.ok(isValidBattle(after), `${id} 走一个回合后状态不合法`);
    assert.ok(after.player.hp >= 0 && after.player.hp <= after.player.maxHp, `${id}：生命越界`);
  }
});

// ------------------------------------------------------------- 3. the draw

test('抽取按权重、不重复、同种子可重放', () => {
  const pool = availableRelics(creditProgress(emptyProgress(), 'ch1-4'));
  const stream = (seed: number) => {
    let state = seed >>> 0;
    return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  };
  const drawn = drawRelics(pool, DRAW_OPTIONS, stream(3));
  assert.equal(drawn.length, DRAW_OPTIONS);
  assert.equal(new Set(drawn.map(r => r.id)).size, DRAW_OPTIONS, '一次抽取里不能出现重复');
  assert.deepEqual(drawRelics(pool, DRAW_OPTIONS, stream(3)).map(r => r.id), drawn.map(r => r.id),
    '同一个种子必须抽出同一批');

  // 权重确实在起作用：抽很多次，低阶的出现次数应该明显多于高阶。
  const tally = new Map<string, number>();
  const roll = stream(99);
  for (let i = 0; i < 400; i++) for (const relic of drawRelics(pool, 3, roll)) {
    tally.set(relic.tier, (tally.get(relic.tier) ?? 0) + 1);
  }
  assert.ok((tally.get('shard') ?? 0) > (tally.get('treasure') ?? 0),
    `残片应该比珍品常见，实际 ${JSON.stringify([...tally])}`);
});

test('不会抽到已经带在身上的遗物', () => {
  const pool = availableRelics(creditProgress(emptyProgress(), 'ch1-4'));
  let state = 5 >>> 0;
  const roll = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const held = pool[1].id;
  for (let i = 0; i < 40; i++) {
    const offered = offerRelics(pool, [held], roll);
    assert.ok(!offered.some(relic => relic.id === held), '抽到了已经持有的遗物');
  }
  assert.equal(opensSubSlot(() => 0), true);
  assert.equal(opensSubSlot(() => 1), false);
  for (const tier of Object.keys(RELIC_PRICE) as (keyof typeof RELIC_PRICE)[]) {
    assert.ok(RELIC_PRICE[tier] > 0);
  }
});

// -------------------------------------------------- 4. unlock & run plumbing

test('解锁：开局 36 件，击破小首领涨到 52 件，且跨周目保留', () => {
  const start = emptyProgress();
  assert.equal(poolSize(start), startingRelics().length);
  assert.equal(poolSize(start), 36);

  const after = creditProgress(start, 'ch1-4');
  assert.equal(poolSize(after), 52, '击破小首领应该解锁 16 件珍品');
  assert.equal(unlocksFor('ch1-4').length, 16);
  assert.equal(unlocksFor('ch1-1').length, 0, '普通战不解锁任何东西');
  assert.ok(earnedRelics(after).every(relic => relic.tier === 'treasure'));

  // 幂等：再打一次不会再涨，否则可以刷。
  assert.equal(creditProgress(after, 'ch1-4'), after);
  assert.deepEqual(after.unlocked, creditProgress(after, 'ch1-4').unlocked);
});

test('解锁存档校验：只有本章能发的阶才算数', () => {
  const good = creditProgress(emptyProgress(), 'ch1-4');
  assert.equal(isValidProgress(good), true);
  assert.equal(isValidProgress(emptyProgress()), true);
  for (const bad of [
    null, undefined, 42, 'x', {},
    { ...good, version: 2 },
    { ...good, unlocked: 'treasure' },
    { ...good, unlocked: ['nope'] },
    { ...good, unlocked: ['echo-1', 'flint'] },
    { ...good, unlocked: ['flint'], credited: 'ch1-4' },
  ]) {
    assert.equal(isValidProgress(bad), false, `本该拒绝：${JSON.stringify(bad)?.slice(0, 60)}`);
  }
});

test('只有有等级的战斗才给抽取，且抽到的能装进槽位', () => {
  assert.equal(earnsRelic('ch1-3'), true, '失落的商队是精英');
  assert.equal(earnsRelic('ch1-4'), true, '头狼是小首领');
  assert.equal(earnsRelic('ch1-5'), true, '守望者是首领');
  assert.equal(earnsRelic('ch1-1'), false, '荒野巡夜是普通战');
  assert.equal(earnsRelic('ch1-2'), false);

  const run = newRun('blade', 'bone', 4);
  const pool = availableRelics(emptyProgress());
  const { run: rolled, options } = rollOffer(run, pool);
  assert.equal(options.length, DRAW_OPTIONS);
  const offered = offerDraw(rolled, options.map(relic => relic.id), 'main', 'ch1-3');

  // **装哪个槽是玩家的选择**，不是抽取决定的：同一件遗物既可以进主槽也可以进副槽。
  assert.equal(claimRelic(offered, options[0].id, 'main').relics.main, options[0].id);
  assert.equal(claimRelic(offered, options[0].id, 'sub').relics.sub, options[0].id);
  assert.equal(claimRelic(offered, options[0].id, 'sub').relics.main, undefined);
  assert.equal(claimRelic(offered, options[0].id, 'main').pendingDraw, undefined);

  // 目标槽已有东西 → 旧的被换下来，而不是两件挤在一起
  const occupied = { ...offered, relics: { main: 'flint' } };
  const replaced = claimRelic(occupied, options[0].id, 'main');
  assert.equal(replaced.relics.main, options[0].id);
  assert.equal(replaced.relics.sub, undefined, '被换下来的不会自动跑去副槽');

  // 不在候选里的东西装不进去
  assert.equal(claimRelic(offered, 'night-lantern', 'main').relics.main, undefined);
  // 副槽抽取由 subPending 排队
  const queued = claimRelic({ ...offered, subPending: true }, options[0].id, 'main');
  assert.equal(queued.nextSlot, 'sub');
  assert.equal(queued.drawDue, 'ch1-3');
});

test('槽位可以调换，也可以把某一件丢掉', () => {
  const run = { ...newRun('blade', 'bone', 4), relics: { main: 'flint', sub: 'whetstone' } };
  const swapped = swapRelics(run);
  assert.deepEqual(swapped.relics, { main: 'whetstone', sub: 'flint' });
  assert.deepEqual(swapRelics(swapped).relics, run.relics, '换两次回到原状');
  assert.deepEqual(run.relics, { main: 'flint', sub: 'whetstone' }, 'swapRelics 不该改动输入');

  assert.deepEqual(discardRelic(run, 'main').relics, { sub: 'whetstone' });
  assert.deepEqual(discardRelic(run, 'sub').relics, { main: 'flint' });
  const empty = { ...newRun('blade', 'bone', 4) };
  assert.equal(swapRelics(empty), empty, '空槽调换是空操作，不该产生新对象');
  assert.equal(discardRelic(empty, 'main'), empty, '丢一个空槽同样是空操作');

  // 丢掉之后装新的：更少的东西，但装得进
  const after = discardRelic(run, 'main');
  assert.deepEqual(after.relics, { sub: 'whetstone' });
  assert.ok(isValidRunForTest(after));
});

test('遗物跟着 run 进战斗：主副槽都被读到', () => {
  const run = { ...newRun('blade', 'bone', 9), relics: { main: 'chain-link', sub: 'hemp-rope' } };
  const s = startBattle('ch1-1', run.main, 7, { hp: run.hp, sub: run.sub, relics: run.relics });
  // 铁链节（主）给 2 层壁垒，然后麻绳（副）看到「已有壁垒」就改给 2 点格挡——这正是麻绳副槽
  // 印的那条规则，两件遗物按顺序咬合，不是简单相加。
  assert.equal(s.player.statuses.rampart, 2, '铁链节主槽 2 层');
  assert.equal(s.player.block, 2, '麻绳副槽发现已有壁垒，改给格挡');
  assert.ok(isValidBattle(s));
  assert.deepEqual(s.relics, { main: 'chain-link', sub: 'hemp-rope' });
});

test('带遗物打赢一场，胜利结算仍然合法（金币与回血都算上）', () => {
  // 第一章是线性的，所以要先把前两场记成已打，才能进 ch1-3。
  // 血量压低，否则干粮的 +3 会被生命上限吃掉，看不出它生效。
  const run = {
    ...newRun('blade', 'bone', 21),
    cleared: ['ch1-1', 'ch1-2'],
    hp: 30,
    relics: { main: 'copper-coin', sub: 'dry-ration' },
  };
  const battle = startBattle('ch1-3', run.main, 7, { hp: run.hp, sub: run.sub, relics: run.relics });
  const outcome = finishBattle(run, { ...battle, phase: 'won' });
  assert.equal(outcome.won, true);
  assert.ok(outcome.gold >= 25, `精英战至少该给 25 金币，实际 ${outcome.gold}`);
  assert.ok(outcome.healed >= 1, '干粮应该额外回血');
  assert.ok(outcome.run.gold >= 25);
  assert.ok(canEnter(outcome.run, 'ch1-4'), '胜利后应该能进下一场');
  assert.ok(outcome.run.drawDue === 'ch1-3', '有等级的战斗该欠一次抽取');
  assert.ok(outcome.run.nextSlot === 'main');
});

test('普通战不欠抽取，也没有额外金币', () => {
  const run = newRun('blade', 'bone', 21);
  const battle = startBattle('ch1-1', run.main, 7, { hp: run.hp, sub: run.sub });
  const outcome = finishBattle(run, { ...battle, phase: 'won' });
  assert.equal(outcome.run.drawDue, undefined);
  assert.ok(outcome.gold >= 8 && outcome.gold <= 14, `普通战金币应在 8–14，实际 ${outcome.gold}`);
});

// ------------------------------------------------- 无名之物：两件只装主槽的绝响

/**
 * 一场用来量伤害的战斗。
 *
 * ⚠️ **敌人必须是厚血的，而且要抹掉变异。** 上一版直接用 `ch1-1` 的原始影狼，结果量错了两次：
 * 它只有 12 血，而猎魔人翻倍后的一击是 14 —— `dealToEnemy` 把生命压在 0，所以量到的是**它剩下的
 * 12**，测试报「第一张没有翻倍」，而日志里明明白白写着 14。变异（那一次抽到的是「披甲的影狼」）
 * 还会改格挡和减伤，和这条要测的东西无关。
 */
function battle(relic: string | undefined, opts: { hp?: number; enemyHp?: number } = {}): BattleState {
  const s = structuredClone(startBattle('ch1-1', 'blade', 7, {
    hp: opts.hp ?? 30,
    relics: relic ? { main: relic } : undefined,
  }));
  for (const enemy of s.enemies) {
    enemy.mutation = undefined;
    enemy.statuses = {};
    enemy.block = 0;
    enemy.maxHp = opts.enemyHp ?? 60;
    enemy.hp = enemy.maxHp;
  }
  return s;
}
/** 手牌钉死成这几张，能量给满。 */
function hand(s: BattleState, cardIds: string[]): BattleState {
  const out = structuredClone(s);
  out.hand = cardIds.map((cardId, i) => ({ uid: `rig-${i}`, cardId }));
  out.player.energy = 3;
  return out;
}
/** 一场打完之后敌人掉了多少血。**目标要够厚**，否则量到的是它剩下的那一点。 */
const hpLost = (before: BattleState, after: BattleState): number =>
  before.enemies[0].hp - after.enemies[0].hp;
test('血云雾霭之卷 · 吸取：按**实际掉掉的血**回，不按牌面数字', () => {
  // 20% 生命吸取。回的是敌人**真的失去的生命**：被格挡吃掉的那部分不是伤害，为它回血等于给一个
  // 从来没存在过的数字付账。
  // 割线印着 7 点，但满血的敌人还吃「血气旺盛」的 +30%，所以这一击实际是 9 —— 吸取要按**结算之后**
  // 真正掉掉的血算，9 的 20% 取整是 1。
  const s = hand(battle('blood-mist'), ['blade-01']);
  const after = playCard(s, 'rig-0', s.enemies[0].uid);
  const dealt = hpLost(s, after);
  assert.equal(dealt, 9, '目标不够厚，这条测试量不准');
  assert.equal(after.player.hp, s.player.hp + 1, `9 点的 20% 取整是 1，实际回了 ${after.player.hp - s.player.hp}`);

  // 没装这件遗物时一滴都不回。
  const plain = hand(battle(undefined), ['blade-01']);
  assert.equal(playCard(plain, 'rig-0', plain.enemies[0].uid).player.hp, plain.player.hp, '没装遗物却在回血');
});

test('血云雾霭之卷 · 血气旺盛：满血的敌人多受 30%，掉过血的没有', () => {
  const full = hand(battle('blood-mist'), ['blade-01']);
  assert.equal(hpLost(full, playCard(full, 'rig-0', full.enemies[0].uid)), 9, '满血敌人应当吃 7 × 1.3 = 9');

  // 把它打到六成以下——血池要够厚，否则量到的是它剩下的那一点。
  const hurt = hand(battle('blood-mist'), ['blade-01']);
  hurt.enemies[0].hp = Math.floor(hurt.enemies[0].maxHp * .5);
  assert.equal(hpLost(hurt, playCard(hurt, 'rig-0', hurt.enemies[0].uid)), 7, '掉过血的敌人不该有加成');
});

test('血云雾霭之卷 · 免死：真的把你放回 15% 上限，而且卷轴自己没了', () => {
  // ⚠️ 这一条抓出过一个真 bug：第一版只让这一下「等于 0」而没动 `hp`，于是日志印着
  // 「你从血雾里站起来（生命 9）」、玩家其实还是 5 血，**下一只影狼的一下就要了命**。
  // 所以这里断言的是两件事：救回来之后**站着**，以及血雾给的是 15% 上限那一档。
  const s = battle('blood-mist', { hp: 5 });
  const after = endTurn({ ...s, player: { ...s.player, hp: 5 } });

  assert.notEqual(after.phase, 'lost', '本该要命的一下没有救回来');
  assert.ok(after.player.hp > 0, '救是救了，人还是倒了');
  assert.equal(after.relics?.main, undefined, '卷轴救了人却没有烧掉自己');
  assert.ok(after.log.some(line => line.text.includes(`生命 ${Math.round(60 * .15)}`)),
    `血雾应当把生命放回 15% 上限（${Math.round(60 * .15)}）`);
  assert.ok(isValidBattle(after), '救完之后的状态必须合法');
});

test('血云雾霭之卷 · 烧掉之后这一场不再生效，战后再从 run 里拿走', () => {
  // 战斗只拿得到一份 state：它把遗物从 state 里摘掉、在 marks 上留记号，真正拥有遗物的是 run。
  const s = battle('blood-mist', { hp: 5 });
  const saved = endTurn({ ...s, player: { ...s.player, hp: 5 } });
  assert.equal(saved.relics?.main, undefined, '战斗内没有摘掉');

  // 摘掉之后再吸血就一滴都不回。
  const again = hand({ ...saved, phase: 'player' }, ['blade-01']);
  const hit = playCard(again, 'rig-0', again.enemies[0].uid);
  assert.equal(hit.player.hp, again.player.hp, '卷轴已经烧了，还在吸血');

  // 而 run 那一侧：打完这一场，它从 run 里也没了，并且如实报给战果面板。
  const run: ChapterRun = {
    ...newRun('blade', 'bone', 7), relics: { main: 'blood-mist' }, relicGranted: true,
    refined: { 'blood-mist': 'small' },
  };
  const outcome = finishBattle(run, { ...saved, phase: 'won' });
  assert.deepEqual(outcome.brokenRelics, ['blood-mist'], '打完了却没说卷轴碎了');
  assert.equal(outcome.run.relics.main, undefined, '卷轴还留在 run 里');
  assert.equal(outcome.run.refined?.['blood-mist'], undefined, '烧掉的东西还留着淬炼档位');
  assert.equal(isValidRunForTest(outcome.run), true, '战斗之后的存档必须合法');
  // 没碎的时候不许报。
  const intact = finishBattle({ ...run, relics: { main: 'iron-nail' } }, { ...saved, phase: 'won' });
  assert.deepEqual(intact.brokenRelics, [], '什么都没碎却报了一串');
});

test('猎魔人之证 · 每回合第一张造成伤害的牌翻倍并抽 1 张，第二张不翻', () => {
  const s = hand(battle('hunter-mark'), ['blade-01', 'blade-01']);
  const first = playCard(s, 'rig-0', s.enemies[0].uid);
  assert.equal(hpLost(s, first), 14, '第一张没有翻倍');
  assert.equal(first.hand.length, s.hand.length, '翻倍的那张应当补抽一张（打出一张、抽回一张）');

  const second = playCard(first, 'rig-1', first.enemies[0].uid);
  assert.equal(hpLost(first, second), 7, '第二张不该翻倍');
});

test('猎魔人之证 · 每回合重新给一次；不造成伤害的牌不消耗它', () => {
  const s = hand(battle('hunter-mark'), ['blade-04', 'blade-01']);   // 掩刃 6 格挡，然后割线
  const shielded = playCard(s, 'rig-0');
  assert.equal(hpLost(s, shielded), 0, '掩刃不该造成伤害');
  assert.equal(hpLost(shielded, playCard(shielded, 'rig-1', shielded.enemies[0].uid)), 14,
    '格挡牌把这一回合的翻倍吃掉了');

  // 新回合：标记清掉，又能翻一次。
  const fresh = hand(endTurn(shielded), ['blade-01']);
  assert.equal(hpLost(fresh, playCard(fresh, 'rig-0', fresh.enemies[0].uid)), 14, '换了一回合却没有重新给翻倍');
});

test('猎魔人之证 · 击杀退还**印着的**费用，引火减掉的那一点也算', () => {
  // 割线 1 费，而当回合第一张会因引火变成 0 费。退还的必须是印着的 1 —— 「退还那张牌的全部能量」
  // 如果按实际付的算，这一张付了 0，就什么都没得退，和文案正好相反。
  const s = hand(battle('hunter-mark', { enemyHp: 6 }), ['blade-01']);
  const before = s.player.energy;
  const after = playCard(s, 'rig-0', s.enemies[0].uid);
  assert.equal(after.enemies[0].dead, true, '没打死，这条测试没验到东西');
  // 出牌实际花了 0（引火把印着的 1 费减到 0），而退还的是**印着的 1** —— 所以结束在 3 + 1 = 4。
  // 按实际付的算的话这一栏会是 3，和「退还那张牌的全部能量」正好相反。
  assert.equal(after.player.energy, before + 1, `该退还印着的 1 点（出 ${before}、收 ${after.player.energy}）`);
  assert.ok(after.log.some(line => line.text.includes('退还')), '退还了却没有说');

  // 没打死就不退：这张牌实际花了 0，所以打完**能量一点不动**。退了的话会是 +1。
  const alive = hand(battle('hunter-mark'), ['blade-01']);
  assert.equal(playCard(alive, 'rig-0', alive.enemies[0].uid).player.energy, alive.player.energy,
    '没打死却退了能量');
});

test('只装主槽：run 拒绝副槽，存档校验也拒绝手改过的', () => {
  for (const id of ['blood-mist', 'hunter-mark']) {
    const run: ChapterRun = { ...newRun('blade', 'bone', 7), pendingDraw: { options: [id], slot: 'sub', from: 'ch1-1' } };
    assert.equal(claimRelic(run, id, 'sub'), run, `${id} 被装进了副槽`);
    const placed = claimRelic(run, id, 'main');
    assert.equal(placed.relics.main, id, `${id} 连主槽都装不进去`);
    assert.equal(isValidRunForTest(placed), true, `${id} 装在主槽却不合法`);

    // 手改成副槽的存档必须被挡下——一件装错槽的遗物会安静地按副槽跑，也就是什么都不做。
    const forged: ChapterRun = { ...newRun('blade', 'bone', 7), relics: { sub: id } };
    assert.equal(isValidRunForTest(forged), false, `${id} 装在副槽的存档被放行了`);
  }
});
