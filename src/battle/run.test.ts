/**
 * What a run promises, and what it refuses to allow.
 *
 * This file is deliberately *not* a test of how well a scripted policy plays. Writing an AI that can
 * beat 头狼 would be testing the AI, not the run layer — and it would be brittle besides. What is
 * checked here is the run's actual contract:
 *
 *   1. the heal always lands in 9–15, is capped by 生命上限, and is reproducible from the run seed;
 *   2. `cleared` is a log of wins over a tower that deals from pools — a save can name no encounter
 *      it did not fight, and can name no encounter twice, but the order is the map's business;
 *   3. a victory advances and a defeat does not, so the caller can safely discard a dead run;
 *   4. the 主/副 composition holds `MAIN_SHARE`, keeps the main deck whole, and splashes one copy each;
 *   5. a whole run driven through *real* battles keeps every invariant at every step, and replays
 *      identically from the same seed;
 *   6. the props: every 改 run one changes something when used, spent charges are copied back out of
 *      the fight that spent them, and the drop roll is **appended after** the three the run already
 *      makes — so no existing seed's heal or gold moves.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { CARD_BY_ID, DECK_IDS, MAIN_SHARE, TIER_BY_ID, type DeckId } from '../cards/index.ts';
import { CHAPTER_1, chapterDeck, isDeckUnlocked, openingForms, starterDeck } from './chapter.ts';
import {
  PLAYER_MAX_HP, canPlay, endTurn, isValidBattle, livingEnemies, playCard, startBattle, useProp, type BattleState,
} from './engine.ts';
import { ALL_ENCOUNTERS, POOLS } from './enemies.ts';
import { effectFor } from './effects.ts';
import { EVENTS } from './events.ts';
import { REWARD_BY_ID } from './rewards.ts';
import { fullDeckPool, rewardCardPool, rollCardOffer } from './rewards.ts';
import { generateMap } from './map.ts';
import {
  EITHER_OR_PROPS, HEAL_MAX, HEAL_MIN, FIRST_PROP_ROW, PROP_LUCK_BASE, PROP_LUCK_MAX, PROP_LUCK_MIN,
  RUN_ENCOUNTERS, addCard, answerRefine, battleSeed, campfireQuench, canEnter, canEnterNode,
  chooseCard, claimReward, currentEncounter, deckFor, dismissProp, dismissRefine, dismissReveal,
  discardProp, encounterFor, enterNode, finishBattle, healRoll, holdsRelic,
  isValidRun, newRun, nextChoices, placeProp, propSlots, removeCard, resolveEvent, restHeal,
  spendGold, swapDecks, upgradeCard, useRunProp, canUseRunProp,
  isChapterCleared,
  buyRemoveService, buyShopSlot, canPayWith, leaveShop, rerollShop, rollShop, shopRemoveCost,
  shopRerollCost, shopPending, wardMark,
  type ChapterRun,
} from './run.ts';
import {
  SHOP_KINDS, SHOP_REROLL_BASE, SHOP_SLOTS, hpPriceOf, relicValueOf, shopSlotName,
} from './shop.ts';
import { RELIC_PRICE } from './relicDraw.ts';
import { PROPS, PROP_BY_ID, emptyProps, placeIn, propsUsableIn } from '../props/props.ts';
import { RUN_PROPS } from './props.ts';

/** The decks chapter I hands out. Three since 燎原余烬 joined — the middle link of the cycle. */
const DECKS: DeckId[] = ['blade', 'flame', 'bone'];

/** The engine never uses `Math.random`, and neither do the tests. */
function lcg(seed: number) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

// ----------------------------------------------------------- 1. creating a run

test('新 run：满血、零进度、合法，且三副牌都必须在第一章可用', () => {
  const run = newRun('blade', 'bone', 11);
  assert.equal(run.hp, 60);
  assert.deepEqual(run.cleared, []);
  assert.equal(run.main, 'blade');
  assert.equal(run.sub, 'bone');
  assert.ok(isValidRun(run), '新 run 必须合法');
  assert.equal(currentEncounter(run)?.id, 'ch1-1', '第一场是荒野巡夜');
  assert.equal(isChapterCleared(run), false);
  // 燎原余烬 joined in chapter I (it is the ring's missing middle), so the deck that must still be
  // refused is 千面回廊 — and it must go on being refused in both slots.
  assert.throws(() => newRun('mirror', 'bone', 1), /不能携带/, '未解锁的牌组不能开局');
  assert.throws(() => newRun('blade', 'mirror', 1), /不能携带/);
});

// ------------------------------------------------------------------ 2. the heal

test('回血永远落在 9–15，两端都真的会出现', () => {
  let run = newRun('blade', 'bone', 5);
  let low = Infinity;
  let high = -Infinity;
  for (let i = 0; i < 3000; i++) {
    const rolled = healRoll(run);
    assert.ok(rolled.heal >= HEAL_MIN && rolled.heal <= HEAL_MAX, `回血越界：${rolled.heal}`);
    assert.ok(Number.isInteger(rolled.heal), '回血必须是整数');
    low = Math.min(low, rolled.heal);
    high = Math.max(high, rolled.heal);
    run = rolled.run;
  }
  assert.equal(low, HEAL_MIN, '9 点必须抽得到，否则区间是假的');
  assert.equal(high, HEAL_MAX, '15 点必须抽得到');
});

test('回血不吃掉超过上限的部分：带伤进场只回到 60', () => {
  const run = { ...newRun('blade', 'bone', 9), hp: 58 };
  const battle = freshBattle('ch1-1', run);
  const won: BattleState = { ...battle, phase: 'won', player: { ...battle.player, hp: 58 } };
  const outcome = finishBattle(run, won);
  assert.equal(outcome.run.hp, 60, '上限是 60');
  assert.ok(outcome.healed <= outcome.heal, '实际回血不能超过掷出的点数');
  assert.ok(outcome.healed >= 0, '实际回血不能是负的');
});

test('同种子的 run 走出完全相同的回血序列', () => {
  const walk = () => {
    let run = newRun('blade', 'bone', 4242);
    const heals: number[] = [];
    for (let i = 0; i < 40; i++) { const rolled = healRoll(run); heals.push(rolled.heal); run = rolled.run; }
    return heals;
  };
  assert.deepEqual(walk(), walk(), '同一个种子必须给出同一串回血');
  assert.notDeepEqual(walk(), (() => {
    let run = newRun('blade', 'bone', 4243);
    const heals: number[] = [];
    for (let i = 0; i < 40; i++) { const rolled = healRoll(run); heals.push(rolled.heal); run = rolled.run; }
    return heals;
  })(), '不同种子应该给出不同的序列');
});

// ------------------------------------------------------------------ 3. the pair

test('swapDecks 只交换主副，换两次回到原状', () => {
  const run = newRun('blade', 'bone', 3);
  const swapped = swapDecks(run);
  assert.equal(swapped.main, 'bone');
  assert.equal(swapped.sub, 'blade');
  assert.deepEqual(swapDecks(swapped), run, '换两次必须回到原状');
  assert.equal(run.main, 'blade', 'swapDecks 不能改动输入');
});

// ------------------------------------------------------------- 4. the line rule

test('主线是线性的：只能打当前这一场，跳关一律拒绝', () => {
  const run = newRun('blade', 'bone', 7);
  assert.equal(canEnter(run, 'ch1-1'), true);
  for (const later of ['ch1-2', 'ch1-3', 'ch1-4', 'ch1-5']) {
    assert.equal(canEnter(run, later), false, `开局不能直接打 ${later}`);
  }
  const after = finishBattle(run, wonBattle('ch1-1', run)).run;
  assert.equal(canEnter(after, 'ch1-2'), true, '打完第一场才能进第二场');
  assert.equal(canEnter(after, 'ch1-1'), false, '打过的不能再打');
  assert.equal(canEnter(after, 'ch1-5'), false, '仍然不能跳关');
});

test('胜利推进 run 并回血，失败原地不动', () => {
  const run = newRun('blade', 'bone', 13);
  const battle = { ...wonBattle('ch1-1', run), player: { ...wonBattle('ch1-1', run).player, hp: 31 } };
  const outcome = finishBattle(run, battle);
  assert.equal(outcome.won, true);
  assert.equal(outcome.run.cleared.length, 1);
  assert.ok(outcome.run.hp > 31, '胜利必须带回血');
  assert.ok(outcome.run.hp <= 60, '回血后不能超过上限');
  assert.ok(isValidRun(outcome.run), '推进后的 run 必须合法');

  const lost = { ...battle, phase: 'lost' as const };
  const defeat = finishBattle(run, lost);
  assert.equal(defeat.won, false);
  assert.equal(defeat.run, run, '战败必须原样退回，交给调用方丢弃');
  assert.deepEqual(defeat.run.cleared, [], '战败不能留下进度');
});

test('打满五场：章节完结，且没有下一场', () => {
  let run = newRun('blade', 'bone', 17);
  for (const encounter of RUN_ENCOUNTERS) {
    assert.equal(currentEncounter(run)?.id, encounter.id, `下一场应该是 ${encounter.id}`);
    run = finishBattle(run, wonBattle(encounter.id, run)).run;
  }
  assert.equal(run.cleared.length, RUN_ENCOUNTERS.length);
  assert.equal(isChapterCleared(run), true);
  assert.equal(currentEncounter(run), undefined, '通关后没有下一场');
  assert.ok(isValidRun(run));
});

test('通关 = 五场章节战都打赢过，不是日志里有五条记录', () => {
  const base = newRun('blade', 'bone', 17);
  /** `cleared` as a plain log of what was beaten, in order, duplicates and all. */
  const log = (...ids: string[]) => ({ ...base, cleared: ids });

  // The shape that shipped broken. 头狼 is an anchor in the **elite** pool, so the map can deal it a
  // second time; the re-win appends a fifth entry, `cleared.length` reaches five, and the chapter
  // declares itself over. The boss is never fought — and because `isValidRun` refuses this save on
  // reload (the prefix rule), the only thing the player can do is watch a cleared screen appear and
  // then lose the run when they refresh.
  assert.equal(isChapterCleared(log('ch1-1', 'ch1-2', 'ch1-3', 'ch1-4', 'ch1-4')), false,
    '打过两遍头狼不等于通关，boss 还站着');
  assert.equal(isChapterCleared(log('ch1-1', 'ch1-2', 'ch1-3', 'ch1-3', 'ch1-4')), false);
  // …and it works the other way too: five entries with a hole in the middle is not a chapter.
  assert.equal(isChapterCleared(log('ch1-1', 'ch1-2', 'ch1-3', 'ch1-4', 'w-hollowrim')), false);
  // The real thing still passes, however it was arrived at.
  assert.equal(isChapterCleared(log(...RUN_ENCOUNTERS.map(e => e.id), 'w-hollowrim')), true);
});

test('地图上的遭遇战优先排没打过的，重复只作兜底', () => {
  // Every map fight is dealt off a pool that *contains* the chapter anchors, so a pool can offer one
  // the run has already won — and a re-won fight pays nothing at all. The deal must therefore prefer
  // a fresh fight whenever the pool has one left.
  const map = generateMap(7);
  const fightNodes = map.nodes.filter(n => n.kind === 'combat' || n.kind === 'elite');
  assert.ok(fightNodes.length >= 8, `只有 ${fightNodes.length} 个战斗格，样本太小`);

  // Sweep the whole roll range, not one arbitrary value: the preference has to hold for every way the
  // dice could land, and a single sample would pass by luck.
  const ROLLS = Array.from({ length: 64 }, (_, i) => i / 64);
  for (const beaten of [
    ['ch1-1'],                                   // 早期：池子里几乎全是新的
    ['ch1-1', 'ch1-2', 'ch1-3', 'ch1-4'],        // 只剩 boss 没打，正是出事那一刻的状态
    ['w-hollowrim', 's-lanternround'],           // 打过的都是池子里的非章节战
  ]) {
    for (const node of fightNodes) {
      if (node.kind === 'boss' || node.row === 1) continue;
      for (const t of ROLLS) {
        const dealt = encounterFor(node, () => t, beaten);
        // `ALL_ENCOUNTERS`, not `ENCOUNTERS`: the latter is the five chapter anchors, and every
        // generated pool fight (w-shadepack and the rest) is a legitimate deal that is not in it.
        const pool = ALL_ENCOUNTERS.filter(e => e.id === dealt);
        assert.equal(pool.length, 1, `${node.id} 排出了表外的战斗 ${dealt}`);
        if (beaten.includes(dealt)) {
          // Allowed only when there is genuinely nothing fresh to deal — which is a fact about the
          // pool, not about this node, and is the reason this is a sort rather than a filter.
          const fresh = (node.kind === 'elite' ? POOLS.elite : node.row <= 4 ? POOLS.weak : POOLS.strong)
            .some(e => !beaten.includes(e.id));
          assert.equal(fresh, false,
            `${node.id}（第 ${node.row} 层 ${node.kind}）排了打过的 ${dealt}，但池子里还有没打过的`);
        }
      }
    }
  }
});

// ---------------------------------------------------------------- 5. the recipe

test('主副合成：主牌组整副保留，副牌组每张各一份，占比贴近 MAIN_SHARE', () => {
  for (const main of DECKS) {
    for (const sub of DECKS) {
      const pile = chapterDeck(main, sub);
      const base = starterDeck(main);
      assert.deepEqual(pile.slice(0, base.length), base, `${main} 主牌组必须整副保留且在最前`);

      const splash = pile.slice(base.length);
      if (main === sub) { assert.equal(splash.length, 0, '主副相同就不该有副牌组'); continue; }
      assert.equal(new Set(splash).size, splash.length, '副牌组每张只能取一份');
      assert.ok(splash.length > 0, '不同的副牌组必须真的掺进来');
      for (const id of splash) {
        assert.equal(CARD_BY_ID.get(id)!.deck, sub, `${id} 不属于副牌组 ${sub}`);
        assert.ok(CHAPTER_1.unlocked[sub].includes(id), `${id} 不在 ${sub} 的第一章解锁列表里`);
      }
      const share = splash.length / pile.length;
      assert.ok(Math.abs(share - (1 - MAIN_SHARE)) < .03, `${main}/${sub} 副牌组占比 ${(share * 100).toFixed(1)}% 偏离太多`);
    }
  }
});

test('副牌组先给签名牌：带本家资源的牌优先于填充牌', () => {
  const main = chapterDeck('blade', 'bone').slice(starterDeck('blade').length);
  // 长明壁垒 owns 锋锐 and 壁垒, so its signature cards are the ones carrying either.
  for (const id of ['bone-01', 'bone-03', 'bone-14']) {
    assert.ok(main.includes(id), `${CARD_BY_ID.get(id)!.name} 是壁垒的签名牌，应该进副牌组`);
  }
});

// ------------------------------------------------------------- 6. bad saves

test('isValidRun 拒绝损坏的存档', () => {
  const run = newRun('blade', 'bone', 21);
  assert.equal(isValidRun(run), true);
  const advanced: ChapterRun = { ...run, cleared: ['ch1-1', 'ch1-2'], hp: 40 };
  assert.equal(isValidRun(advanced), true, '正常的进度必须通过');

  for (const broken of [
    null, undefined, 42, 'run', {},
    { ...run, version: 2 },
    { ...run, chapterId: 'ch2' },
    { ...run, main: 'mirror' },
    { ...run, sub: 'mirror' },
    { ...run, main: 'nope' },
    { ...run, hp: -1 },
    { ...run, hp: 61 },
    { ...run, hp: 12.5 },
    { ...run, cleared: 'ch1-1' },
    // Duplicates, wherever they land. A duplicate is what a skipped chapter looks like from the
    // outside: five entries with one repeated cannot cover five distinct encounters.
    { ...run, cleared: ['ch1-1', 'ch1-1'] },
    { ...run, cleared: ['ch1-1', 'ch1-2', 'ch1-3', 'ch1-4', 'ch1-4'] },
    { ...run, cleared: ['ch1-1', 'ch1-2', 'ch1-3', 'ch1-4', 'ch1-5', 'ch1-1'] },
    { ...run, cleared: ['nope'] },
    { ...run, cleared: ['ch1-1', 'ch1-1', 'ch1-2'] },
    { ...run, cleared: ['ch1-1', 'w-hollowrim', 'nope'] },
    { ...run, seed: 1.5 },
    { ...run, rng: -1 },
    { ...run, rng: 0x100000000 },
    // 道具。形状那几条直接由引擎的 `validProps` 兜住（两边共用一份，见 `isValidRun`）。
    { ...run, props: [] },
    { ...run, props: [null, null] },
    { ...run, props: [null, null, null, null] },
    { ...run, props: [null, null, { id: 'nope', uses: 1 }] },
    { ...run, props: [null, null, { id: 'blood-tap', uses: 0 }] },
    { ...run, props: [null, null, { id: 'blood-tap', uses: 99 }] },
    { ...run, props: [null, null, 'blood-tap'] },
    // 一件捡到还没放下的道具，id 必须真的存在：它下一步会被写进槽位，而一个不存在的 id
    // 会让下一次加载把整局丢掉（`validProps` 拒它 → `loadRun` 丢 run）。
    { ...run, propTask: { id: 'nope', from: '奇遇' } },
    { ...run, propTask: { id: 'blood-tap' } },
    // 掉落概率**必须是 [0,100] 的整数**：写成小数时 `roll * 100 < luck` 恒为假，
    // 于是掉落静默地再也不发生——一份手改过的存档会让这个玩家永远抽不到道具，而且没有任何报错。
    { ...run, propLuck: 1.5 },
    { ...run, propLuck: -1 },
    { ...run, propLuck: 101 },
    { ...run, propGranted: 'yes' },
  ]) {
    assert.equal(isValidRun(broken), false, `本该拒绝：${JSON.stringify(broken)?.slice(0, 70)}`);
  }

  // Accepted, and this is the half that used to be wrong. `cleared` is a **log of wins**, not the
  // chapter's running order: the map deals its fights from pools that contain the chapter's anchors,
  // so a run can meet 头狼 before 萤火树洞 and its log ends up out of sequence. The old rule demanded
  // a prefix and threw those runs away on reload — a legitimate chapter, deleted on a page refresh.
  for (const cleared of [
    ['ch1-1', 'ch1-3'],
    ['ch1-2'],
    ['ch1-1', 'ch1-2', 'ch1-4', 'ch1-3'],
    ['ch1-5'],
    // **Pool fights belong here too**, and this list used to assert the opposite. The tower deals
    // `w-*` / `s-*` / `e-brood` far more often than it deals an anchor, and `finishBattle` logs
    // whatever it was handed — so refusing these ids meant the save from a normal run failed
    // validation and `loadRun` dropped it. See the round-trip test below for the whole path.
    ['w-hollowrim'],
    ['ch1-1', 'w-shadepack', 's-ambush'],
    ['e-brood', 's-nightwatch'],
  ]) {
    assert.equal(isValidRun({ ...run, cleared }), true, `本该接受：${JSON.stringify(cleared)}`);
  }
});

test('打赢一场池子里的遭遇战，存档必须还能读回来', () => {
  // Regression. `cleared` used to be validated against the five chapter anchors only, while the map
  // deals its fights from pools — so this exact sequence (win a pool fight → the save is written →
  // the page reloads) threw the whole chapter away. It was not an edge case: about half of every
  // run's fights are pool fights, so it fired on essentially every run.
  const run = newRun('blade', 'bone', 33);
  const pool = POOLS.strong[0];
  assert.ok(!RUN_ENCOUNTERS.some(entry => entry.id === pool.id), '这场必须不是章节锚点，否则测不到东西');

  const settled = finishBattle(run, wonBattle(pool.id, run));
  assert.ok(settled.won, '必须先真的赢下来');
  assert.ok(settled.run.cleared.includes(pool.id), '池子仗必须写进 cleared');

  // Through the wire, exactly as the browser stores it — the map is derived, never serialised.
  const { map, ...wire } = settled.run;
  void map;
  const round = JSON.parse(JSON.stringify(wire)) as ChapterRun;
  assert.equal(isValidRun(round), true, '这一局必须能通过校验');
  // And it still has to be legal after more pool fights land on top of it.
  const deeper: ChapterRun = { ...round, cleared: [...round.cleared, POOLS.weak[0].id, POOLS.elite[0].id] };
  assert.equal(isValidRun(deeper), true, '多打几场之后仍然必须合法');
});

// --------------------------------------------------- 7. a whole run, for real

/** A battle opened exactly the way the run says: carried HP, the run's own seed, the 主/副 pile. */
function freshBattle(encounterId: string, run: ChapterRun): BattleState {
  return startBattle(encounterId, run.main, battleSeed(run, encounterId), { hp: run.hp, sub: run.sub });
}

/** A won battle state for `encounterId`, ready to be settled into the run. */
function wonBattle(encounterId: string, run: ChapterRun): BattleState {
  return { ...freshBattle(encounterId, run), phase: 'won' };
}

/**
 * Plays the run from the top, settling every fight through the real engine, and returns the whole
 * trajectory. A defeat ends it — the run is dead and the caller would start a new one.
 */
function playRun(seed: number) {
  const roll = lcg(seed);
  const trail: { id: string; phase: string; hp: number; heal: number; turn: number }[] = [];
  let run = newRun('blade', 'bone', seed);

  while (!isChapterCleared(run)) {
    const encounter = currentEncounter(run)!;
    let s = freshBattle(encounter.id, run);
    assert.equal(s.player.hp, run.hp, `${encounter.id} 必须带着 run 的血量开局`);
    assert.equal(s.deck, run.main);
    assert.equal(s.sub, run.sub);

    let steps = 0;
    while (s.phase === 'player' && steps < 400) {
      steps += 1;
      const playable = s.hand.filter(card => canPlay(s, card.uid));
      if (playable.length && roll() < .9) {
        s = playCard(s, playable[Math.floor(roll() * playable.length)].uid, livingEnemies(s)[0]?.uid);
      } else {
        s = endTurn(s);
      }
      assert.ok(isValidBattle(s), `${encounter.id} 战斗中状态必须始终合法`);
    }
    assert.ok(s.phase === 'won' || s.phase === 'lost', `${encounter.id} 打不完（${steps} 步）`);

    const outcome = finishBattle(run, s);
    trail.push({ id: encounter.id, phase: s.phase, hp: outcome.run.hp, heal: outcome.heal, turn: s.turn });
    if (!outcome.won) {
      assert.equal(outcome.run, run, '战败之后 run 不能有任何变化');
      break;
    }
    run = outcome.run;
    assert.ok(isValidRun(run), `${encounter.id} 之后 run 必须合法`);
    assert.ok(run.hp >= 0 && run.hp <= 60, `回血后生命越界：${run.hp}`);
    assert.ok(outcome.heal >= HEAL_MIN && outcome.heal <= HEAL_MAX, `回血越界：${outcome.heal}`);
  }
  return { run, trail };
}

test('用真实战斗走一条 run：不变量恒成立，且必然会终止', () => {
  for (const seed of [4242, 777, 31, 20260921]) {
    const { run, trail } = playRun(seed);
    assert.ok(trail.length >= 1 && trail.length <= RUN_ENCOUNTERS.length, `种子 ${seed} 打出了 ${trail.length} 场`);
    // Whatever happened, the run has to be in one of exactly two coherent states.
    if (isChapterCleared(run)) {
      assert.equal(run.cleared.length, RUN_ENCOUNTERS.length, `种子 ${seed}：通关了但进度对不上`);
      assert.equal(run.cleared.at(-1), 'ch1-5', '通关必须终于守望者');
    } else {
      assert.equal(trail.at(-1)!.phase, 'lost', `种子 ${seed}：没通关又不是战败，run 卡住了`);
      assert.ok(run.cleared.length < RUN_ENCOUNTERS.length, '战败不能留下完整进度');
    }
    assert.deepEqual(run.cleared, RUN_ENCOUNTERS.slice(0, run.cleared.length).map(e => e.id), 'cleared 必须是主线的前缀');
  }
});

test('同一条 run 重放两次完全相同（种子决定一切）', () => {
  const first = playRun(20260921);
  const second = playRun(20260921);
  assert.deepEqual(first.trail, second.trail, '同一个种子必须走出同一条 run');
  assert.deepEqual(first.run, second.run);
});

// ------------------------------------------- 7b. saves from before the tower

test('地图出现之前的存档必须被拒绝，而不是让页面崩掉', () => {
  // 回归测试。爬塔地图接进来的那天，旧存档（没有 `map`、`deck`、`path`）通过了 `isValidRun`，
  // 于是页面去画一座不存在的塔，`map.startIds` 抛错，整个 #/battle 白屏。
  const run = newRun('blade', 'bone', 5);
  const old: Record<string, unknown> = { ...run };
  delete old.map; delete old.deck; delete old.path;
  assert.equal(isValidRun(old), false, '没有地图的 run 不该通过校验');

  // Note what is NOT here: a run with no `map` is *valid*. The tower is derived from the seed and is
  // deliberately absent from the save, so demanding one would reject every real save.
  for (const broken of [
    { ...run, at: 'nope' },
    { ...run, path: 'n1-0' },
    { ...run, path: ['nope'] },
    { ...run, deck: [] },
    { ...run, deck: [{ cardId: 'nope' }] },
    { ...run, deck: [{ cardId: 'blade-01', upgraded: 'yes' }] },
    { ...run, seed: 1.5 },
  ]) {
    assert.equal(isValidRun(broken), false, `本该拒绝：${JSON.stringify(broken).slice(0, 70)}`);
  }
  // And the shape a save really has — no map — is accepted.
  const { map, ...wire } = run;
  void map;
  assert.ok(isValidRun(wire), '不带地图的存档形状必须合法');
});

test('存档往返：地图不进存档，但读回来必须能重建出来', () => {
  // 回归测试。`TowerMap.byId` 是 `Map`，而 `JSON.stringify(new Map(...))` 是 `{}`——把地图序列化
  // 出去，读回来就是一座没有索引的塔，每一份存档一刷新就失效。地图是种子的纯函数，不该被存。
  const stepped = enterNode(newRun('blade', 'bone', 4242), nextChoices(newRun('blade', 'bone', 4242))[0]);
  const { map, ...rest } = stepped;
  assert.ok(map.nodes.length > 0, '内存里的 run 必须带着塔');

  const wire = JSON.parse(JSON.stringify(rest)) as Record<string, unknown>;
  assert.equal('map' in wire, false, '存档里不该有地图');
  assert.ok(isValidRun(wire), '去掉地图的存档仍然必须合法');

  // 读回来：地图由种子重建，路线与它自洽
  const rebuilt = generateMap(wire.seed as number);
  assert.equal(rebuilt.seed, stepped.map.seed, '重建的塔必须和原来那座一样');
  assert.equal(rebuilt.nodes.length, stepped.map.nodes.length);
  assert.ok(rebuilt.nodes.some(node => node.id === stepped.at), '重建后 still 站得住');
});

test('新 run 一定带着一座能画的塔和一副自己的牌组', () => {
  for (const seed of [1, 5, 99, 4242]) {
    const run = newRun('blade', 'bone', seed);
    assert.ok(isValidRun(run), `种子 ${seed}：新 run 必须合法`);
    assert.equal(run.map.seed, run.seed, '地图种子就是 run 种子');
    assert.ok(run.map.startIds.length > 0);
    assert.ok(run.map.nodes.some(node => node.id === run.map.bossId));
    assert.equal(run.path.length, 0);
    assert.ok(run.deck.length > 0, '牌组必须从开局就有，而不是每场重算');
  }
});

test('走一层：只能走到可达的节点，落子后 at 与 path 都跟着动', () => {
  const run = newRun('blade', 'bone', 7);
  const choices = nextChoices(run);
  assert.deepEqual(choices, run.map.startIds);
  assert.equal(canEnterNode(run, 'n5-3'), false, '没落地之前只能从第一行开始');
  const first = choices[0];
  const stepped = enterNode(run, first);
  assert.equal(stepped.at, first);
  assert.deepEqual(stepped.path, [first]);
  assert.deepEqual(nextChoices(stepped), run.map.byId.get(first)!.next);
  assert.equal(enterNode(stepped, 'n9-3').at, first, '跳不过去');
  assert.ok(isValidRun(stepped));
});

test('营火回血、加减牌、升级都改的是 run 自己的牌组', () => {
  const run = { ...newRun('blade', 'bone', 3), hp: 20 };
  assert.equal(restHeal(run).hp, 20 + 18, '营火回 30% 上限');

  const grown = addCard(run, 'blade-16');
  assert.equal(grown.deck.length, run.deck.length + 1);
  assert.equal(grown.deck.at(-1)!.cardId, 'blade-16');

  const trimmed = removeCard(run, 0);
  assert.equal(trimmed.deck.length, run.deck.length - 1);
  assert.equal(run.deck.length, newRun('blade', 'bone', 3).deck.length, 'removeCard 不能改动输入');

  const at = run.deck.findIndex(card => card.cardId === 'blade-01');
  const polished = upgradeCard(run, at);
  assert.equal(polished.deck[at].upgraded, true);
  assert.equal(upgradeCard(polished, at).deck[at].upgraded, true, '不能重复升级');
  assert.equal(run.deck[at].upgraded, undefined, '不能改动输入');

  assert.ok(spendGold({ ...run, gold: 50 }, 30), '钱够就该扣得掉');
  assert.equal(spendGold({ ...run, gold: 10 }, 30), undefined, '钱不够不该扣成负数');

  const dealt = deckFor('t', run);
  assert.equal(dealt.length, run.deck.length);
  assert.equal(new Set(dealt.map(card => card.uid)).size, dealt.length, '战斗内的 uid 必须唯一');
});

// ------------------------------------------------------- 8. the engine handshake

/** The one call that joins the two layers: a run opening a fight. Everything else in this file
 *  depends on it being the way the run says, so it is pinned here rather than left to the page. */
test('startBattle 带着 run 的血量与副牌组开局', () => {
  const run = { ...newRun('blade', 'bone', 55), hp: 37 };
  const s = startBattle('ch1-1', run.main, battleSeed(run, 'ch1-1'), { hp: run.hp, sub: run.sub });
  assert.equal(s.player.hp, 37, '带进来的血量必须原样生效');
  assert.equal(s.player.maxHp, 60, '上限仍然是 60，否则存档校验会拒绝');
  assert.equal(s.deck, 'blade');
  assert.equal(s.sub, 'bone');
  assert.ok(isValidBattle(s), '带血开局的战斗必须合法');
  const size = s.hand.length + s.draw.length + s.discard.length + s.exhaust.length;
  assert.equal(size, chapterDeck('blade', 'bone').length, '牌堆必须就是主副合成的那一副');
});

test('起始血量被钳进 [0, 60]，未解锁的副牌组直接拒绝', () => {
  const withHp = (hp?: number) => startBattle('ch1-1', 'blade', 7, { hp });
  assert.equal(withHp(999).player.hp, 60, '超过上限必须钳到 60');
  assert.equal(withHp(-5).player.hp, 0);
  assert.equal(withHp(undefined).player.hp, 60, '不给血量就是满血开局');
  assert.ok(isValidBattle(withHp(43)), '钳过之后必须仍然合法');
  assert.throws(() => startBattle('ch1-1', 'blade', 7, { sub: 'mirror' }), /不能携带/, '未解锁的副牌组必须拒绝');
  assert.throws(() => startBattle('ch1-1', 'mirror', 7), /不能携带/, '未解锁的主牌组必须拒绝');
  // Passing the main deck as its own sub is a no-op, not an error — the splash is just empty.
  assert.equal(startBattle('ch1-1', 'blade', 7, { sub: 'blade' }).sub, 'blade');
});

test('run 的 生命上限 必须进战斗，而且只能升不能降', () => {
  // Regression. The ceiling used to be pinned to `PLAYER_MAX_HP` + whatever the relics added, so a
  // run that had earned +12 生命上限 walked into every fight at 60/60 — and 生命上限 is a good share
  // of both the reward table and the event table. The run layer and the battle layer disagreed about
  // the same number, and the run layer is the one the player had been reading.
  const withMax = (maxHp?: number) => startBattle('ch1-1', 'blade', 7, { hp: 72, maxHp });
  assert.equal(withMax(72).player.maxHp, 72, 'run 的上限必须带进战斗');
  assert.equal(withMax(72).player.hp, 72, '带进来的血不能被 60 削掉');
  assert.equal(withMax(undefined).player.maxHp, PLAYER_MAX_HP, '不给就是基准值');
  assert.equal(withMax(undefined).player.hp, PLAYER_MAX_HP, '基准上限下多出来的血要削掉');
  // Downwards is illegal, not merely ignored: 60 is the number every constant was tuned against.
  for (const low of [40, 0, -10]) {
    assert.equal(withMax(low).player.maxHp, PLAYER_MAX_HP, `maxHp=${low} 必须被抬回基准值`);
  }
  assert.ok(isValidBattle(withMax(72)), '抬高之后的战斗必须仍然合法');
});

// ---------------------------------------------------------------- 9. guard rails

test('battleSeed 由 run 种子派生：同 run 稳定，不同 run 不同', () => {
  const run = newRun('blade', 'bone', 99);
  for (const encounter of RUN_ENCOUNTERS) {
    assert.equal(battleSeed(run, encounter.id), battleSeed(run, encounter.id), '同一场必须稳定');
    assert.ok(Number.isInteger(battleSeed(run, encounter.id)), '种子必须是整数');
    assert.ok(battleSeed(run, encounter.id) >= 0, '种子必须是非负的');
  }
  const seeds = RUN_ENCOUNTERS.map(e => battleSeed(run, e.id));
  assert.equal(new Set(seeds).size, seeds.length, '五场必须各有各的洗牌');

  // Regression: the index used to be into the five anchors, so every *pool* encounter — which is
  // most of what the tower deals — got `findIndex → -1` and hashed to one shared seed. Every
  // `w-*` / `s-*` / `e-brood` floor in a run therefore opened on the same shuffle.
  const poolSeeds = ALL_ENCOUNTERS.map(e => battleSeed(run, e.id));
  assert.equal(new Set(poolSeeds).size, ALL_ENCOUNTERS.length, '每一场遭遇战都必须有自己的洗牌');
  const other = newRun('blade', 'bone', 100);
  assert.notEqual(battleSeed(run, 'ch1-1'), battleSeed(other, 'ch1-1'), '不同 run 不该撞种子');
});

test('章节给出的每一副牌组，开场屏都真的能选', () => {
  // Regression, and a nasty shape of one: `OPENING_FORMS` was a two-entry literal in
  // `BattleDemo.tsx`, so adding 燎原余烬 to `CHAPTER_1.decks` produced a deck that was legal in every
  // save, unlocked in every check, and **absent from the only screen that offers one**. Every unit
  // test passed. It took a screenshot to see it.
  //
  // The screen is a `.tsx` file, which `node --experimental-strip-types` cannot parse, so the check
  // has to live here against the same function the screen calls.
  const forms = openingForms();
  assert.equal(forms.length, CHAPTER_1.decks.length, '每一副牌组都该有一个开局形态');
  for (const deck of CHAPTER_1.decks) {
    assert.ok(forms.some(form => form.main === deck), `${deck} 没有开局形态，玩家选不到它`);
  }
  for (const form of forms) {
    assert.ok(CHAPTER_1.decks.includes(form.main), `${form.main} 不是第一章的牌组`);
    assert.ok(CHAPTER_1.decks.includes(form.sub), `${form.sub} 不是第一章的牌组`);
    assert.notEqual(form.main, form.sub, '主副不能是同一副');
    assert.ok(form.blurb.length >= 8, '开局形态得有话说');
    assert.ok(chapterDeck(form.main, form.sub).length > chapterDeck(form.main).length,
      `${form.main} 的副牌组一张都没掺进去，这个形态是假的`);
  }
});

test('第一章的三副牌都能当主牌组，别的不能', () => {
  for (const deck of DECKS) {
    assert.equal(isDeckUnlocked(deck), true);
    assert.ok(chapterDeck(deck).length > 0, `${deck} 必须能组出牌堆`);
  }
  for (const deck of DECK_IDS.filter(id => !DECKS.includes(id))) {
    assert.equal(isDeckUnlocked(deck), false, `${deck} 不该在第一章可用`);
  }
  assert.equal(RUN_ENCOUNTERS.length, 5, '第一章是五个锚点，run 用的就是它们');
  // 长明壁垒 carries its two zero-cost cards (砺石 / 殉道) so that it is not the one deck whose
  // cheapest card costs 1 — see the note on `CHAPTER_1.unlocked.bone`.
  assert.equal(starterDeck('blade').length, 22);
  assert.equal(starterDeck('bone').length, 28);
});

// ---------------------------------------------------------------------- 淬炼

/**
 * A run standing in front of the fire with one relic on it and the bet already named.
 *
 * **Seven rolls are spent before the bet**, because a 淬炼 never meets the stream's first value: 回血,
 * 遗物抽取, 战斗生成 and the card offers all come off the same stream, and by the time the player is
 * deep enough in the tower to meet a 奇遇 the run has drawn from it many times. It also matters
 * mechanically — the LCG is seeded with the run seed itself, so its *first* output for seeds 1–60 all
 * land on the same side of 50%, and a test that rolled the first value would find only one outcome
 * and conclude the gamble was fake.
 */
function atTheFire(seed: number, chance: number, tier: 'small' | 'large' = 'small'): ChapterRun {
  let run: ChapterRun = { ...newRun('blade', 'bone', seed), relics: { main: 'iron-nail' } };
  for (let i = 0; i < 7; i++) run = healRoll(run).run;
  return { ...run, relicTask: { tier, chance } };
}

test('淬炼：成算 100 一定成、成算 0 一定碎，而且结果真的落到遗物上', () => {
  const won = answerRefine(atTheFire(3, 100), 'iron-nail');
  assert.equal(won.refined?.['iron-nail'], 'small', '成了却没记下档位');
  assert.equal(holdsRelic(won, 'iron-nail'), true, '成了遗物却不见了');
  // 结果留在 `relicTask.done` 上，屏幕靠着它渲染——它必须在 `relicTask` 清掉之前一直活着。
  assert.equal(won.relicTask?.done?.won, true, '结果没写进 relicTask，结果屏就没得可显示');
  assert.equal(dismissRefine(won).relicTask, undefined, '继续之后这一层还没结束');

  const lost = answerRefine(atTheFire(3, 0), 'iron-nail');
  assert.equal(holdsRelic(lost, 'iron-nail'), false, '碎了却还在身上');
  assert.equal(lost.refined, undefined, '碎掉的东西不该留着淬炼档位');
  assert.equal(lost.relicTask?.done?.won, false);
});

test('淬炼：同种子重放一样，不同种子两种结果都出得来', () => {
  // 赌局走的是 run 自己的流，所以一整局仍然由一个种子完整重放——和回血同一条规矩。
  const wins = new Set<boolean>();
  for (let seed = 1; seed <= 60; seed++) {
    const a = answerRefine(atTheFire(seed, 50), 'iron-nail');
    const b = answerRefine(atTheFire(seed, 50), 'iron-nail');
    assert.equal(a.refined?.['iron-nail'] ?? '碎', b.refined?.['iron-nail'] ?? '碎',
      `种子 ${seed}：同一注掷出了两个结果`);
    wins.add(a.relicTask?.done?.won === true);
  }
  assert.deepEqual([...wins].sort(), [false, true], '成算 50% 只出一种结果，那这个赌局是假的');
});

test('淬炼：赌完之后不能重复掷，不能拿不在身上的东西去淬', () => {
  const rolled = answerRefine(atTheFire(9, 50), 'iron-nail');
  const again = answerRefine(rolled, 'iron-nail');
  assert.equal(again, rolled, '同一注被掷了第二次——结果会因为点两下而改变');
  // 一件不在身上的遗物：淬炼会把它「变强」，而玩家根本看不到它。
  const stranger = answerRefine(atTheFire(9, 100), 'whetstone');
  assert.equal(stranger.refined, undefined, '拿不在身上的遗物去淬炼居然成功了');
});

test('淬炼：等着被裁决的存档必须能过校验，而且结果与遗物状态一致', () => {
  const pending = atTheFire(11, 70);
  assert.equal(isValidRun(pending), true, '开着淬炼的存档被丢掉了——刷新一下玩家就没了这一注');
  const rolled = answerRefine(pending, 'iron-nail');
  assert.equal(isValidRun(rolled), true, '结果屏上的存档过不了校验，刷新会丢掉整局');
  // 输了那一份也要合法——**两个槽都空着正是「碎了」留下的状态**，而结果屏还挂在上面。
  const lost = answerRefine(atTheFire(11, 0), 'iron-nail');
  assert.equal(lost.relics.main, undefined);
  assert.equal(isValidRun(lost), true, '碎掉之后的存档被丢掉了——刷新一下玩家就没了');

  // `done.won` 与遗物的实际状态必须对得上：一份说「成了」而遗物已经不在的存档会让结果屏说谎。
  const guaranteed = answerRefine(atTheFire(11, 100), 'iron-nail');
  assert.equal(guaranteed.relicTask?.done?.won, true);
  assert.equal(isValidRun({ ...guaranteed, relics: {}, refined: undefined }), false,
    '一份「说成了但遗物没了」的存档被放行了');
});

// ------------------------------------------------------------ 选牌的两种彩头

test('选牌会出「已打磨」与「未解锁」的牌', () => {
  const pool = rewardCardPool('blade', 'bone');
  const wide = fullDeckPool(['blade', 'bone']);
  const roll = lcg(7);
  let upgraded = 0;
  let beyond = 0;
  for (let i = 0; i < 400; i++) {
    const offers = rollCardOffer(pool, 3, roll, wide);
    assert.equal(new Set(offers.map(offer => offer.cardId)).size, offers.length, '一次选牌里出现了两张一样的牌');
    for (const offer of offers) {
      if (offer.upgraded) upgraded++;
      if (offer.beyond) beyond++;
    }
  }
  assert.ok(upgraded > 0, '掷了 1200 张牌，一次「已打磨」都没有');
  assert.ok(beyond > 0, '一次「未解锁」都没有');
});

test('未解锁的牌必须是**有实现**的，而且真的在池子之外', () => {
  // ⚠️ 这条是这一组里最重要的。未解锁的那条彩头是**唯一**绕开解锁名单的路，而没写效果的牌在引擎里
  // 是白板——打得出去，只写一行「还没有实装效果」。把它当成奖励发到玩家手上，是这类 bug 最糟的
  // 发现方式：玩家会以为是自己看不懂这张牌。
  //
  // 另一半同样重要：一张**本来就在池子里**的牌被标上「未解锁」，是在跟玩家说假话。
  const pool = rewardCardPool('blade', 'bone');
  const wide = fullDeckPool(['blade', 'bone']);
  const roll = lcg(11);
  const seen = new Set<string>();
  for (let i = 0; i < 400; i++) {
    for (const offer of rollCardOffer(pool, 3, roll, wide)) {
      if (!offer.beyond) continue;
      seen.add(offer.cardId);
      assert.ok(effectFor(offer.cardId), `${offer.cardId} 没有实现，却被当成「未解锁」发了出去`);
      assert.ok(!pool.includes(offer.cardId), `${offer.cardId} 本来就在池子里，却被标成「未解锁」`);
    }
  }
  assert.ok(seen.size > 0, '一条未解锁的彩头都没有抽到，这条测试什么都没验');
});

test('已打磨的彩头进牌组时真的带着打磨标记', () => {
  // 界面上的「已打磨」必须**跟着牌进牌组**。少了这一步，选牌屏会说「这是一张打磨过的牌」，
  // 而玩家拿到的是一张原版的——和打磨那一轮的 bug 是同一种形状，只是换了个地方。
  const pool = rewardCardPool('blade', 'bone');
  const wide = fullDeckPool(['blade', 'bone']);
  const roll = lcg(3);
  let checked = 0;
  for (let i = 0; i < 300 && checked < 5; i++) {
    const offers = rollCardOffer(pool, 3, roll, wide);
    const index = offers.findIndex(offer => offer.upgraded);
    if (index < 0) continue;
    checked++;
    const run = { ...newRun('blade', 'bone', i + 1), cardTask: 'pick' as const, cardOptions: offers };
    const after = chooseCard(run, index);
    const added = after.deck[after.deck.length - 1];
    assert.equal(added.cardId, offers[index].cardId);
    assert.equal(added.upgraded, true, '选牌屏说已打磨，进牌组却是原版');
  }
  assert.equal(checked, 5, '三次里都没抽到已打磨的牌，这条测试没验到东西');
});

// -------------------------------------------------- 牌组的变动必须看得见

test('换一张真的换：走一张、来一张，两张都交给展示屏', () => {
  // ⚠️ 这条钉的是一个**说谎的文案**。「和他换一张」从写下起就写着「他挑走一张，塞给你一张」，
  // 而它的效果是 `cards(3)`——玩家自己挑三张里的一张，**什么都没被拿走**。一张牌说某样东西让你
  // 付出了代价、而实际上没有，是这类 bug 里最不该有的那个方向。
  const option = EVENTS.find(event => event.id === 'quiet-pilgrim')!.options[0];
  const run = newRun('blade', 'bone', 4);
  const after = resolveEvent(run, option);
  assert.equal(after.deck.length, run.deck.length, '换一张之后牌组张数应当不变');
  assert.ok(after.cardReveal, '换完没有展示屏——玩家看不到换走了什么');
  assert.equal(after.cardReveal.gained.length, 1, '换来的不止一张');
  assert.ok(after.cardReveal.lost, '没记下换走的是哪一张');
  assert.ok(!after.deck.some(card => card.cardId === after.cardReveal!.lost) === false
    || after.deck.length === run.deck.length, '换走的牌不该还在牌组里（张数对不上）');
  // 换走的那一张**必须真的不在牌组里**了。上面那句只是张数检查，这一句点名。
  const lostCountBefore = run.deck.filter(c => c.cardId === after.cardReveal!.lost).length;
  const lostCountAfter = after.deck.filter(c => c.cardId === after.cardReveal!.lost).length;
  assert.equal(lostCountAfter, lostCountBefore - 1, '说换走了，牌组里却一张没少');
  assert.equal(isValidRun(after), true, '展示屏上的存档过不了校验');
});

test('直接给牌的奖励，牌必须摆出来 —— 不能只印一句「直接获得 2 张」', () => {
  // 「一捆牌」给 1 张、「夹在书里的两页」给 2 张，两者都是 `pick: false`：直接进牌组，
  // 而奖励屏只印一句张数。**卡面一张都不显示**，玩家永远不知道进牌组的是什么。
  for (const id of ['bundle', 'loose-leaf']) {
    const reward = REWARD_BY_ID.get(id)!;
    const run = { ...newRun('blade', 'bone', 6), pendingReward: id };
    const after = claimReward(run);
    const count = reward.effect.kind === 'cards' ? reward.effect.count : 0;
    assert.equal(after.deck.length, run.deck.length + count, `${id}：牌数不对`);
    assert.ok(after.cardReveal, `${id}：给了牌却没有展示屏`);
    assert.equal(after.cardReveal!.gained.length, count, `${id}：展示的牌数对不上`);
    // 展示的就是**真的进了牌组的那几张**，按 id 一一对上。
    const added = after.deck.slice(run.deck.length).map(card => card.cardId).sort();
    assert.deepEqual(after.cardReveal!.gained.map(offer => offer.cardId).sort(), added,
      `${id}：展示的牌和实际进牌组的牌对不上`);
    assert.equal(isValidRun(after), true, `${id}：展示屏上的存档过不了校验`);
    assert.equal(dismissReveal(after).cardReveal, undefined, `${id}：继续之后展示屏还没关`);
  }
});

test('展示屏能关，且关掉之后张数不变', () => {
  const run = { ...newRun('blade', 'bone', 8), pendingReward: 'loose-leaf' };
  const shown = claimReward(run);
  const closed = dismissReveal(shown);
  assert.equal(closed.cardReveal, undefined);
  assert.deepEqual(closed.deck, shown.deck, '关屏不该动牌组');
});

// ------------------------------------------------------ 选牌的背面朝上

test('奇遇的选牌会出背面朝上的牌，奖励的不会', () => {
  // 奇遇是「把手伸进洞里」，藏起来是这一层的虚构本身；奖励是打赢挣来的，藏起来等于把报酬收回去一半。
  const pool = rewardCardPool('blade', 'bone');
  const wide = fullDeckPool(['blade', 'bone']);
  const roll = lcg(21);
  let hidden = 0;
  for (let i = 0; i < 400; i++) {
    for (const offer of rollCardOffer(pool, 3, roll, wide, true)) {
      if (offer.hidden) hidden++;
      // 已打磨的牌**永远不背过去**：「一张你看不见、但已经打磨过的牌」比两者单独出现都更差。
      assert.ok(!(offer.hidden && offer.upgraded), '打磨过的牌不该背面朝上');
    }
    for (const offer of rollCardOffer(pool, 3, roll, wide, false)) {
      assert.ok(!offer.hidden, '奖励的牌被背过去了');
    }
  }
  assert.ok(hidden > 0, '掷了 1200 张奇遇牌，一张背面朝上的都没有');
  // 也不该全都背过去：全是盲选就不是选择，是抽奖。
  assert.ok(hidden < 1200, '所有奇遇牌都背面朝上，那不是选择');
});

test('摸到背面那张，必须翻给你看', () => {
  // 挑了一张牌组的背面、然后永远不知道是哪张——那这个谜就只是个白眼。和打磨的展示屏同一条规矩。
  const pool = rewardCardPool('blade', 'bone');
  const wide = fullDeckPool(['blade', 'bone']);
  const roll = lcg(5);
  let checked = 0;
  for (let i = 0; i < 200 && checked < 4; i++) {
    const offers = rollCardOffer(pool, 3, roll, wide, true);
    const index = offers.findIndex(offer => offer.hidden);
    if (index < 0) continue;
    checked++;
    const run = { ...newRun('blade', 'bone', i + 1), cardTask: 'pick' as const, cardOptions: offers };
    const after = chooseCard(run, index);
    assert.equal(after.cardReveal?.gained[0].cardId, offers[index].cardId, '翻开的那张不是玩家摸到的那张');
    assert.equal(after.deck[after.deck.length - 1].cardId, offers[index].cardId);
    assert.equal(isValidRun(after), true);
  }
  assert.equal(checked, 4, '没抽到背面朝上的牌，这条测试没验到东西');
});

// ------------------------------------------------------ 第一件遗物的保证

test('走到第 3 层还没有遗物的，赢一场就补一件', () => {
  // ⚠️ 遗物**只从精英和首领掉**，而精英是路线运气：实测 200 个种子、每条路线走完整座塔，
  // **21.8% 的路线一个精英都遇不到**（把精英下限从第 6 行提到第 4 行也只压到 16.2%）。那些局在打
  // boss 之前一件遗物都没有，于是「淬火石」这类奇遇对它们是一扇**锁着的门**——而遗物是这个 run
  // 的成长主线，不该由路线决定有没有。
  const map = generateMap(7);
  const weak = ALL_ENCOUNTERS.find(entry => entry.pool === 'weak')!;
  const at = (row: number): ChapterRun => {
    const node = map.nodes.find(n => n.row === row)!;
    return { ...newRun('blade', 'bone', 7), at: node.id, path: [node.id] };
  };

  // 第 1、2 行是教学段：赢了也不发。
  for (const row of [1, 2]) {
    const before = at(row);
    const after = finishBattle(before, wonBattle(weak.id, before));
    assert.equal(after.run.drawDue, undefined, `第 ${row} 层就发遗物太早了`);
    assert.equal(after.run.relicGranted, undefined);
  }

  // 第 3 行起，普通战也补。
  const run = at(3);
  const after = finishBattle(run, wonBattle(weak.id, run));
  assert.equal(after.run.drawDue, weak.id, '第 3 层还没有遗物，却没补上');
  assert.equal(after.run.relicGranted, true, '补了却没记下来——下一场会再补一次');
  assert.equal(after.run.nextSlot, 'main', '补出来的那一次也要指明进哪个槽');
  assert.equal(isValidRun(after.run), true, '补出来的存档必须合法');
});

test('保证只补一次：先遇到精英的人照常从精英拿，不会拿两份', () => {
  const map = generateMap(7);
  const weak = ALL_ENCOUNTERS.find(entry => entry.pool === 'weak')!;
  const elite = ALL_ENCOUNTERS.find(entry => entry.pool === 'elite')!;
  const node = map.nodes.find(n => n.row === 3)!;
  const start: ChapterRun = { ...newRun('blade', 'bone', 7), at: node.id, path: [node.id] };

  // 第 3 层先打精英 → 照常发，并记下已经发过。
  const first = finishBattle(start, wonBattle(elite.id, start)).run;
  assert.equal(first.drawDue, elite.id);
  assert.equal(first.relicGranted, true);

  // 之后普通战不再补第二次。
  const later: ChapterRun = { ...first, at: map.nodes.find(n => n.row === 8)!.id, drawDue: undefined };
  const second = finishBattle(later, wonBattle(weak.id, later)).run;
  assert.equal(second.drawDue, undefined, '一场赢了两件遗物——保证和精英的奖励叠上了');
});

test('保证不认「身上没有遗物」：丢掉之后再赢一场，不会再发一件', () => {
  // 判据是 run 自己的标记，不是 `relics` 是否为空。用后者的话，玩家把不喜欢的遗物丢掉就能再刷一件。
  const map = generateMap(7);
  const weak = ALL_ENCOUNTERS.find(entry => entry.pool === 'weak')!;
  const node = map.nodes.find(n => n.row === 6)!;
  const granted: ChapterRun = {
    ...newRun('blade', 'bone', 7), at: node.id, path: [node.id],
    relics: { main: 'flint' }, relicGranted: true,
  };
  // 两件都丢掉，身上空了——但这一局已经领过。
  const emptied: ChapterRun = { ...granted, relics: {}, drawDue: undefined };
  const after = finishBattle(emptied, wonBattle(weak.id, emptied)).run;
  assert.equal(after.drawDue, undefined, '丢掉遗物就能再领一件');
});

test('营火淬炼：挂上赌局，而且**由它自己结束这一层**', () => {
  // ⚠️ 这一条钉的是 CLAUDE.md 点名的那个坑。焚牌和打磨当年只挂 `cardTask`、不设 `resolved`，
  // 而选牌器是**盖在**营火上面的——于是**一次营火可以既焚牌又休息**，同一晚花两遍。
  //
  // 淬炼挂的是 `relicTask` 而不是 `cardTask`，走的是另一条分支，所以它必须自己回答
  // 「谁负责结束这一层」。抽成函数就是为了这条测试够得到它。
  const node = generateMap(7).nodes.find(n => n.row === 9)!;
  const run: ChapterRun = {
    ...newRun('blade', 'bone', 7), at: node.id, path: [node.id],
    relics: { main: 'iron-nail' }, relicGranted: true, rewardDue: node.id,
  };
  const quenched = campfireQuench(run, 'small', 72);
  assert.equal(quenched.relicTask?.tier, 'small');
  assert.equal(quenched.relicTask?.chance, 72);
  assert.equal(quenched.resolved, node.id, '没标成已解决——这个营火还能再花一次');
  assert.equal(quenched.rewardDue, undefined, '战利品没清掉，会再弹一次');
  assert.equal(isValidRun(quenched), true, '存档必须合法，否则刷新一下整局没了');
  // 赌局本身照常结算。
  const after = answerRefine(quenched, 'iron-nail');
  assert.equal(after.refined?.['iron-nail'], 'small');
  assert.equal(after.relicTask?.done?.won, true, '成算 72 却不给结果屏');
});

// -------------------------------------------------- 五场章节战必须凑得齐

test('走一条路线一定遇得到全部五场章节战 —— 通关条件不能靠运气', () => {
  // ⚠️ 这条钉的是一个**结构性**的问题，不是数值问题。五场锚点原来和别的遭遇战一起从池子里抽，
  // 而池子分得极不均匀：`strong` 的 6 场里**一场锚点都没有**，`elite` 的 3 场里却挤着两场
  // （ch1-3 与头狼）。一条路线平均只经过约 1.2 个精英层，所以两场根本凑不齐——实测 200 个种子，
  // **71% 的路线打不满五场**，头狼单独看更是 **66.5%** 见不到。
  //
  // 而 `isChapterCleared` 要求五场**每场**都打赢过：通关条件对大多数局是不可达的。
  // 现在锚点排在池子之前发放，精英级的两场从 `ELITE_ANCHOR_ROW` 起也能站到普通战斗层上。
  const anchors = new Set(RUN_ENCOUNTERS.map(entry => entry.id));
  const short: string[] = [];
  for (let seed = 1; seed <= 200; seed++) {
    let run = newRun('blade', 'bone', seed);
    const roll = lcg(seed * 7919 + 13);          // 挑路线的骰子，和 run 的流分开
    const met = new Set<string>();
    for (let step = 0; step < 40; step++) {
      const choices = nextChoices(run);
      if (!choices.length) break;
      run = enterNode(run, choices[Math.floor(roll() * choices.length)]);
      if (!run.currentFight) continue;
      met.add(run.currentFight);
      // 假定玩家都赢——这条测的是「遇不遇得到」，不是「打不打得过」。
      run = { ...run, cleared: [...new Set([...run.cleared, run.currentFight])], currentFight: undefined };
    }
    if ([...anchors].some(id => !met.has(id))) {
      short.push(`种子 ${seed}：只遇到 ${[...met].filter(id => anchors.has(id)).length}/5`);
    }
  }
  assert.deepEqual(short.slice(0, 5), [], `${short.length}/200 条路线凑不齐五场章节战`);
});

// -------------------------------------------------------------------- 道具

/**
 * A run that satisfies every 改 run 道具's precondition at once, so the sweep below can run all nine
 * through one setup: 30 生命（回血看得出）、500 金币（金烬付得起）、一件主遗物（圣物匣有的烧）。
 */
function propReady(): ChapterRun {
  return { ...newRun('blade', 'bone', 21), hp: 30, gold: 500, relics: { main: 'flint' } };
}

test('每一件改 run 的道具，用下去都必须真的改变什么', () => {
  // 和 `src/battle/props.test.ts` 那条同构，只是换了一边：那一条管战斗里的二十八件，这一条管
  // run 的九件。一件效果没接上的道具不会抛错，它只是**点了没反应**。
  const shape = (value: ChapterRun) => JSON.stringify({ ...value, props: undefined });
  for (const id of Object.keys(RUN_PROPS)) {
    const run: ChapterRun = { ...propReady(), props: placeIn(emptyProps(), 1, id) };
    const def = PROP_BY_ID.get(id)!;
    // 袖炉是唯一一件二选一：描述符里两半都写着，而文案说的是「或」。见 `PropHalf`。
    const after = id === 'pocket-forge' ? useRunProp(run, 1, 'effect') : useRunProp(run, 1);
    assert.notDeepEqual(shape(after), shape(run),
      `${id}（${def.name}）除了扣一次以外什么都没变——它没有接上 run 层`);

    // 用过一次就少一次；用完最后一格是 `null`，**不是 `undefined`，也不是留着 `uses: 0` 的槽**。
    const left = propSlots(after)[1];
    if (def.charges === 1) assert.equal(left, null, `${id} 用完最后一格没有空出来`);
    else assert.equal(left?.uses, def.charges - 1, `${id} 的次数没扣对`);
    assert.equal(propSlots(run)[1]?.uses, def.charges, `${id} 就地改了传进来的 run`);
    assert.ok(isValidRun(after), `${id} 用完之后存档过不了校验——刷新一下整局就没了`);
  }
});

test('「二选一」那份名单和文案对得上', () => {
  // 名单（`EITHER_OR_PROPS`）说的是「这一件的两半要用哪一半得由界面点」。判据不写在类型里，
  // 只写在**印给玩家看的那句文案**里——所以拿文案反过来验它：多了等于那件少做一半，少了等于袖炉多做一半。
  for (const id of Object.keys(RUN_PROPS)) {
    const text = PROP_BY_ID.get(id)!.text;
    assert.equal(EITHER_OR_PROPS.has(id), text.includes('二选一'), `${id} 的文案「${text}」和名单对不上`);
  }
});

test('付不起就不动用，而且一次也不扣', () => {
  // 拒绝的三种：钱不够、没有主遗物可烧、格子里本来就没东西（或者那件只有战斗效果）。
  const poor: ChapterRun = { ...newRun('blade', 'bone', 4), gold: 10, props: placeIn(emptyProps(), 0, 'gold-ash') };
  assert.equal(canUseRunProp(poor, 0), false, '界面应当把它置灰');
  assert.equal(useRunProp(poor, 0), poor, '金币不够却把它花掉了——连次数都该留着');

  const bare: ChapterRun = { ...newRun('blade', 'bone', 4), relics: {}, props: placeIn(emptyProps(), 0, 'reliquary') };
  assert.equal(canUseRunProp(bare, 0), false);
  assert.equal(useRunProp(bare, 0), bare, '没有主遗物却烧了');

  const empty = newRun('blade', 'bone', 4);
  assert.equal(useRunProp(empty, 0), empty, '空格子应当原样退回，不抛错');
  assert.equal(canUseRunProp(empty, 9), false, '越界');
  // 一件只有战斗效果的道具：run 这一层不认识它，什么都不做（界面按「有没有战斗效果」分流）。
  const fightOnly: ChapterRun = { ...empty, props: placeIn(emptyProps(), 0, 'frost-nail') };
  assert.equal(useRunProp(fightOnly, 0), fightOnly);
});

test('袖炉是二选一：一半当场回血、一半开选牌器，两半都只扣一次', () => {
  // ⚠️ 描述符里两半都写着（`{ task: 'polish', heal: 15 }`），而它印出来的文案是
  // 「**二选一**：回复 15 点生命，或打磨牌库里的一张牌」。两半一起做的话，这件道具会比它印给
  // 玩家看的多给一半。
  const forge: ChapterRun = { ...newRun('blade', 'bone', 9), hp: 20, props: placeIn(emptyProps(), 0, 'pocket-forge') };
  const healed = useRunProp(forge, 0, 'effect');
  assert.equal(healed.hp, 35, '回血那一半没有回');
  assert.equal(healed.cardTask, undefined, '回血那一半不该顺手开选牌器');
  const polishing = useRunProp(forge, 0, 'task');
  assert.equal(polishing.cardTask, 'polish', '打磨那一半没开选牌器');
  assert.equal(polishing.hp, 20, '打磨那一半不该顺手回血');
  // 省缺按「回血」走：一个会自己开屏的默认值，比一个安静回血的默认值危险得多。
  assert.equal(useRunProp(forge, 0).hp, 35);
  for (const after of [healed, polishing]) assert.equal(propSlots(after)[0]?.uses, 1, '两半都只该扣一次');

  // 灰誓是另一头：`{ task: 'remove', maxHp: 6 }` 两半**都要落**（「摧毁牌库里的一张牌，生命上限 +6」）。
  const oath: ChapterRun = { ...propReady(), props: placeIn(emptyProps(), 0, 'ash-oath') };
  const sworn = useRunProp(oath, 0);
  assert.equal(sworn.cardTask, 'remove', '灰誓没开选牌器');
  assert.equal(sworn.maxHp, 66, '灰誓的 +6 上限被 `half` 吃掉了——它没有二选一那回事');
});

test('道具把生命上限压低时，当前生命一起钳住，而且存档必须仍然合法', () => {
  // 夜祷书：生命上限 −10，换一张本牌组的稀有牌。
  const run: ChapterRun = { ...propReady(), hp: 60, props: placeIn(emptyProps(), 0, 'night-office') };
  const after = useRunProp(run, 0);
  assert.equal(after.maxHp, 50, '上限没有被压低');
  assert.equal(after.hp, 50, '当前生命没有跟着钳到新上限');
  // ⚠️ 这一条钉的是 `isValidRun`：它原来要求 `maxHp >= PLAYER_MAX_HP`（那是**战斗**的不变量），
  // 而 run 的上限现在可以被道具压低。不放松的话，玩家用一次夜祷书、刷新一下**整局就没了**。
  assert.ok(isValidRun(after), '压低上限之后的存档过不了校验');

  // 压不到 1 以下：这是 run 层的底线（上限 0 的 run 永远回不了血）。
  const deep: ChapterRun = {
    ...newRun('blade', 'bone', 4), maxHp: 8, hp: 8, props: placeIn(emptyProps(), 0, 'night-office'),
  };
  assert.equal(useRunProp(deep, 0).maxHp, 1, '上限被压到了 1 以下');
  assert.ok(isValidRun(useRunProp(deep, 0)), '压到底之后的存档过不了校验');
});

test('空心齿把当前生命的一半搬到上限上；陪葬钱扣血但绝不致死', () => {
  const run: ChapterRun = { ...newRun('blade', 'bone', 5), hp: 21, props: placeIn(emptyProps(), 0, 'hollow-tooth') };
  const bitten = useRunProp(run, 0);
  assert.equal(bitten.hp, 11, '留下的那一半');
  assert.equal(bitten.maxHp, 70, '搬上去的那一半');   // 60 + (21 − 11)

  // 陪葬钱：失去 15 点生命，抽一件遗物。**扣到 0 就钳在 1**——一件道具用出一次死亡是 bug 不是难度。
  const dying: ChapterRun = { ...newRun('blade', 'bone', 5), hp: 9, props: placeIn(emptyProps(), 0, 'grave-penny') };
  const paid = useRunProp(dying, 0);
  assert.equal(paid.hp, 1, '道具把玩家扣死了');
  assert.equal(paid.drawDue, 'grave-penny', '没有挂上遗物那一手');
  assert.equal(paid.nextSlot, 'main');
  assert.ok(isValidRun(paid), '欠着一手遗物的存档过不了校验');
});

test('夜祷书给的是本牌组**最高那一档**的牌，而且摆出来给玩家看', () => {
  // ⚠️ `rare` 取的是池子里 rank 最大的那一档，**不是写死 `starfall`**：第一章解锁的牌里根本没有
  // 星陨，写死它等于这件道具什么都不给（而它的代价是 10 点生命上限）。
  const rank = (id: string) => TIER_BY_ID.get(CARD_BY_ID.get(id)!.tier)!.rank;
  for (let seed = 1; seed <= 12; seed++) {
    const run: ChapterRun = { ...propReady(), seed, rng: seed, props: placeIn(emptyProps(), 0, 'night-office') };
    const after = useRunProp(run, 0);
    const gained = after.cardReveal?.gained[0];
    assert.ok(gained, `种子 ${seed}：给了牌却什么都没摆出来——玩家永远不知道拿到的是哪张`);
    assert.equal(after.deck.at(-1)!.cardId, gained.cardId, '展示的那张和进牌组的不是同一张');
    const best = Math.max(...rewardCardPool(after.main, after.sub).map(rank));
    assert.equal(rank(gained.cardId), best, `种子 ${seed}：拿到的不是最高档的牌`);
  }
});

test('放下 / 不要 / 丢掉', () => {
  const held: ChapterRun = {
    ...newRun('blade', 'bone', 3),
    props: placeIn(emptyProps(), 0, 'blood-tap'),
    propTask: { id: 'spyglass', from: '战利品' },
  };
  const placed = placeProp(held, 1);
  assert.equal(propSlots(placed)[1]?.id, 'spyglass');
  assert.equal(propSlots(placed)[1]?.uses, 2, '放进去应当是满次数');
  assert.equal(placed.propTask, undefined, '放下之后那件「还没放下」的还挂着');
  assert.equal(placed.propGranted, true, '拿到过一件，兜底就不该再发第二件');
  assert.equal(propSlots(placed)[0]?.id, 'blood-tap', '别的格子不该动');
  assert.ok(isValidRun(placed), '放下之后的存档过不了校验');

  // 替换：往已经占着的格子里放（`claimRelic` 同一个语义，**从不问「满了吗」**）。
  assert.deepEqual(propSlots(placeProp(held, 0)).map(entry => entry?.id ?? null), ['spyglass', null, null]);

  // 「不要」。三格都称手时这是真答案，所以它不该动身上任何东西。
  const refused = dismissProp(held);
  assert.equal(refused.propTask, undefined);
  assert.deepEqual(propSlots(refused), propSlots(held), '「不要」动了身上的东西');

  // 丢掉一格。
  assert.equal(propSlots(discardProp(placed, 0))[0], null);
  assert.equal(propSlots(discardProp(placed, 0))[1]?.id, 'spyglass', '丢掉一格不该动另一格');
  assert.equal(discardProp(placed, 2), placed, '空格子丢掉应当原样退回');

  // 战果面板那条路：**不经过 `propTask`**，id 直接传进来（见 `BattleOutcome.propDrop`）。
  const fromPanel = placeProp(newRun('blade', 'bone', 3), 2, 'wall-seed');
  assert.equal(propSlots(fromPanel)[2]?.id, 'wall-seed');

  // 不存在的 id / 越界的格子：原样退回，不抛错。
  assert.equal(placeProp(held, 1, 'nope'), held);
  assert.equal(placeProp(held, 9), held);
});

test('战斗用掉的道具按战斗里那一份结算：次数抄回来、用完的那格变 null', () => {
  const run: ChapterRun = {
    ...newRun('blade', 'bone', 8),
    props: placeIn(placeIn(emptyProps(), 0, 'spyglass'), 1, 'wall-seed'),
  };
  // 战斗里用掉窥管一次（2 → 1）和墙种一次（1 → 0，那一格该空出来）。
  const battle = startBattle('ch1-1', run.main, battleSeed(run, 'ch1-1'), { hp: run.hp, sub: run.sub, props: run.props });
  const played = useProp(useProp(battle, 0), 1);
  assert.equal(played.props?.[1], null, '战斗里用过最后一次，那一格本来就该空掉');

  const outcome = finishBattle(run, { ...played, phase: 'won' });
  assert.deepEqual(propSlots(outcome.run), [{ id: 'spyglass', uses: 1 }, null, null]);
  assert.deepEqual(outcome.spentProps, [
    { id: 'spyglass', used: 1, left: 1 },
    { id: 'wall-seed', used: 1, left: 0 },
  ], '结果面板读的差额不对');
  assert.ok(isValidRun(outcome.run), '结算之后的存档过不了校验');

  // ⚠️ 一份**没有 `props` 字段**的战斗状态（它是后加的字段）：run 的那一包**不许消失**。
  const legacy: BattleState = { ...played, phase: 'won', props: undefined };
  assert.deepEqual(propSlots(finishBattle(run, legacy).run), propSlots(run), '一次误采纳让整包道具消失了');
  assert.deepEqual(finishBattle(run, legacy).spentProps, [], '没有 props 就没有差额可报');

  // 落败那一支不扣道具，原样退回。
  const lost = finishBattle(run, { ...played, phase: 'lost' });
  assert.equal(lost.run, run, '战败必须原样退回');
  assert.deepEqual(lost.spentProps, [], '战败却报了用掉的道具');
});

test('战后掉落：营火专用的那几件不掉，保底从第 2 层开始', () => {
  const fight = ALL_ENCOUNTERS.find(entry => entry.pool === 'weak')!;
  let lucky = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const node = generateMap(seed).nodes.find(n => n.row === 4)!;
    /** 站在第 4 层上、还没有道具的一局：`propLuck` 压到最低，好让掷点本身几乎不掉东西。 */
    const at = (extra: Partial<ChapterRun>): ChapterRun =>
      ({ ...newRun('blade', 'bone', seed), at: node.id, path: [node.id], propLuck: PROP_LUCK_MIN, ...extra });

    const bare = at({});
    const first = finishBattle(bare, wonBattle(fight.id, bare));
    assert.ok(first.propDrop, `种子 ${seed}：第 4 层还没有道具，却没有补一件`);
    assert.ok(PROP_BY_ID.has(first.propDrop!), `${first.propDrop} 不是一件存在的道具`);
    // ⚠️ 营火专用的那几件（要开牌库选牌器）**不能从战斗掉落里出**：战斗中一置上 `cardTask`，
    // 整张战斗页会被选牌器顶掉。
    assert.notEqual(PROP_BY_ID.get(first.propDrop!)!.use, 'camp', `掉出了营火专用的 ${first.propDrop}`);
    assert.ok(propsUsableIn('battle').some(prop => prop.id === first.propDrop), '掉出了池子外的道具');
    assert.equal(first.run.propGranted, true, '补了却没记下来——下一场会再补一次');
    assert.ok(isValidRun(first.run), `种子 ${seed}：补出来的存档不合法`);

    // 判据是 run 自己的标记，**不是「props 是不是空的」**：丢掉三件之后不会再刷一轮。
    const flagged = at({ propGranted: true });
    if (finishBattle(flagged, wonBattle(fight.id, flagged)).propDrop) lucky++;
  }
  // 标记立着的时候，掉落就只剩 5% 的基础概率了——不比出来的话，上面那句「补了」可能只是运气。
  assert.ok(lucky < 20, `60 次里掉了 ${lucky} 次——保底没有被标记挡住`);
});

test('掉落概率留在这个区间里，而且真的两种结果都出得来', () => {
  const fight = ALL_ENCOUNTERS.find(entry => entry.pool === 'strong')!;
  const drops = new Set<boolean>();
  for (let seed = 1; seed <= 120; seed++) {
    const run: ChapterRun = { ...newRun('blade', 'bone', seed), propLuck: PROP_LUCK_BASE };
    const after = finishBattle(run, wonBattle(fight.id, run)).run;
    assert.ok(Number.isInteger(after.propLuck), `种子 ${seed}：概率成了 ${after.propLuck}`);
    assert.ok(after.propLuck! >= PROP_LUCK_MIN && after.propLuck! <= PROP_LUCK_MAX,
      `种子 ${seed}：概率跑到了 ${after.propLuck}`);
    assert.ok(isValidRun(after), `种子 ${seed}：结算之后的存档不合法`);
    drops.add(after.propLuck! < PROP_LUCK_BASE);
  }
  assert.deepEqual([...drops].sort(), [false, true], '120 个种子只出一种结果，这个概率模型是假的');
  // 概率存的是**数**：掉一次 −15，没掉 +12。
  const run: ChapterRun = { ...newRun('blade', 'bone', 3), propLuck: PROP_LUCK_BASE };
  const after = finishBattle(run, wonBattle(fight.id, run)).run;
  assert.ok([PROP_LUCK_BASE - 15, PROP_LUCK_BASE + 12].includes(after.propLuck!), `概率被记成了 ${after.propLuck}`);
});

test('道具的掷点排在既有三个之后：回血与金币一个数都不动', () => {
  // ⚠️ 这条钉的是「追加在最后」。插在 `healRoll` / `goldFor` / `rollSubSlot` 中间的话，每一个既有
  // 种子的回血、金币和「开副槽」都会被推移一格——而真正的代价是**所有玩家存档里那条流都对不上了**。
  const run = newRun('blade', 'bone', 4242);
  const state = wonBattle('ch1-1', run);
  const outcome = finishBattle(run, state);
  // 回血是这条流的第一口：它必须等于「单独掷一次」的结果。
  assert.equal(outcome.heal, healRoll(run).heal, '回血之前多了别的掷点');
  // 冻结点数。改 `HEAL_MIN` / `GOLD_BY_POOL` 或者往流里插一个掷点都会让这两行变红——那正是要知道的事。
  assert.equal(outcome.heal, 15, '种子 4242 的回血变了：流的顺序被改动了');
  assert.equal(outcome.gold, 8, '种子 4242 的金币变了：流的顺序被改动了');
  // 同一条 run 结算两次，逐字段相同。
  assert.deepEqual(finishBattle(run, state).run, outcome.run, '同一条 run 两次结算不一样');
  // 身上带着道具、概率也不一样时，回血与金币**仍然一个数都不动**。
  const carrying: ChapterRun = { ...run, props: placeIn(emptyProps(), 0, 'blood-tap'), propLuck: 71, propGranted: true };
  const withProps = finishBattle(carrying, {
    ...startBattle('ch1-1', carrying.main, battleSeed(carrying, 'ch1-1'),
      { hp: carrying.hp, sub: carrying.sub, props: carrying.props }),
    phase: 'won',
  });
  assert.equal(withProps.heal, outcome.heal, '回血被道具的掷点推移了');
  assert.equal(withProps.gold, outcome.gold, '金币被道具的掷点推移了');
});

test('存档往返：带着道具的 run 过一遍 JSON 还能逐字段读回来', () => {
  // ⚠️ 这是**唯一**能抓住「不小心把 Map / 函数塞进 props」的测试：`JSON.stringify` 会静默地把它们
  // 丢掉，而丢完之后 `isValidRun` 仍然可能通过。
  const run: ChapterRun = {
    ...newRun('blade', 'bone', 12),
    props: placeIn(placeIn(emptyProps(), 0, 'blood-tap'), 2, 'spyglass'),
    propTask: { id: 'staunch-moss', from: '奇遇' },
    propLuck: 47,
    propGranted: true,
  };
  const { map, ...wire } = run;
  void map;
  const round = JSON.parse(JSON.stringify(wire)) as ChapterRun;
  assert.deepEqual(round, wire, '存档过一遍 JSON 就变了——里面混进了不是纯数据的东西');
  assert.equal(isValidRun(round), true, '带着道具的存档过不了校验');
  // 两格带同一件是合法的（消耗品就该能带两个）；遗物那条「主副不能同件」**不能照抄**过来。
  const twin = { ...run, props: placeIn(placeIn(emptyProps(), 0, 'blood-tap'), 2, 'blood-tap') };
  assert.equal(isValidRun(twin), true, '两件一样的道具被拒了');
});

test('战斗里把一格换成另一件（未拆的信）：报的是用掉的那件，新来的那件不算「用掉」', () => {
  const run: ChapterRun = { ...newRun('blade', 'bone', 8), props: placeIn(emptyProps(), 0, 'sealed-letter') };
  const battle = startBattle('ch1-1', run.main, battleSeed(run, 'ch1-1'), { hp: run.hp, sub: run.sub, props: run.props });
  const opened = useProp(battle, 0);          // 这一格被换成了另一件道具
  assert.notEqual(opened.props?.[0]?.id, 'sealed-letter', '这封信开出了它自己，这条测试就没验到东西');
  const outcome = finishBattle(run, { ...opened, phase: 'won' });
  assert.deepEqual(propSlots(outcome.run), opened.props, '战场上的那一包没有被原样采纳');
  assert.deepEqual(outcome.spentProps, [{ id: 'sealed-letter', used: 1, left: 0 }],
    '报的是新来的那件，而不是用掉的那件');
  assert.ok(isValidRun(outcome.run));
});

test('营火专用的那三件道具必须拿得到', () => {
  // ⚠️ 它们**不能**从战斗掉落里出（要开牌库选牌器，会顶掉整张战斗页），所以塔上拾取是唯一的来源。
  // 哪天有人把塔上那个池子「顺手统一」成 `propsUsableIn('battle')`，净灯 / 灰誓 / 袖炉就成了三行
  // 玩家永远见不到的数据——而卡面、图标、检索词一应俱全，看起来完全正常。
  const campOnly = PROPS.filter(prop => prop.use === 'camp');
  assert.ok(campOnly.length > 0, '一件 camp 道具都没有，这条测试就没有意义');
  for (const prop of campOnly) {
    assert.ok(!propsUsableIn('battle').some(entry => entry.id === prop.id), `${prop.id} 出现在了战斗掉落池里`);
  }
  // 宝箱那一行（奖励表里给道具的那份）掷出来的东西里必须真的见得到 camp 道具。
  //
  // ⚠️ **先走几格流**：这个 LCG 的**第一口**对连续的种子是挤在一起的（种子 1..400 只铺开整个区间的
  // 15%），而加权抽取按的是那个值——直接拿种子当掷点，400 次全都落在同一个带里，看起来就像
  // 「营火道具一件都不出」。同样的坑在 `atTheFire` 上面记过一次。
  const id = [...REWARD_BY_ID.values()].find(entry => entry.effect.kind === 'prop')!.id;
  const seen = new Set<string>();
  for (let seed = 1; seed <= 400; seed++) {
    let run: ChapterRun = { ...newRun('blade', 'bone', seed), pendingReward: id };
    for (let i = 0; i < 5; i++) run = healRoll(run).run;
    const task = claimReward(run).propTask;
    if (task) seen.add(PROP_BY_ID.get(task.id)!.use);
  }
  assert.ok(seen.has('camp'), '400 次宝箱拾取里一件营火道具都没出——它们已经拿不到了');
  assert.ok(seen.has('battle'), '战斗道具一件都不出，这个池子被换掉了');
});

test('宝箱与奇遇都停在「还没放下」上等玩家回答', () => {
  // 宝箱：奖励表里那一行。⚠️ 这张表**宝箱和普通战斗奖励共用**，所以普通胜仗也会开出道具来。
  const reward = [...REWARD_BY_ID.values()].find(entry => entry.effect.kind === 'prop')!;
  assert.ok(reward, '奖励表里没有给道具的那一行');
  const run = { ...newRun('blade', 'bone', 6), pendingReward: reward.id };
  const after = claimReward(run);
  assert.ok(after.propTask, '宝箱给了道具却没有停在待放上');
  assert.ok(PROP_BY_ID.has(after.propTask.id), '给了一件不存在的道具');
  assert.equal(after.propTask.from, '战利品');
  assert.equal(after.pendingReward, undefined, '收下了却还挂着那份奖励');
  assert.ok(isValidRun(after), '待放道具的存档过不了校验');
  assert.equal(placeProp(after, 0).propTask, undefined, '放下之后还没收起来');

  // 奇遇：表里 effect 是 prop 的那一条，而且**必须有代价**——稀缺感由 `requires` 表达，不由骰子。
  const option = EVENTS.flatMap(event => event.options).find(entry => entry.effect.kind === 'prop')!;
  assert.ok(option, '奇遇表里没有给道具的选项');
  assert.ok((option.requires?.hp ?? 0) > 0 || (option.requires?.gold ?? 0) > 0,
    '给道具的选项没有代价——那它就是一次白拿');
  const before: ChapterRun = { ...newRun('blade', 'bone', 6), hp: 40, gold: 100 };
  const given = resolveEvent(before, option);
  assert.ok(given.propTask, '奇遇给了道具却没有停在待放上');
  assert.equal(given.propTask.from, '奇遇');
  assert.ok(isValidRun(given), '待放道具的存档过不了校验');
  // **不是概率**：同一条 run 结算两次拿到的是同一件，而且每次都真的给。
  assert.equal(resolveEvent(before, option).propTask!.id, given.propTask.id, '两次结算给了两件不同的道具');
});

// ---------------------------------------------------------------- 商店

/**
 * 一张种子的第一商店。
 *
 * ⚠️ **不写死种子，也不写死节点 id。** 权重一动整座塔就重掷，写死种子的测试会在下一次改 `bandFor`
 * 时变成一句谎话——它会「因为那个节点不再是商店」而红，而不是因为商店坏了。
 */
function shopOn(seed: number, gold = 500): ChapterRun | undefined {
  const run = newRun('blade', 'bone', seed);
  const node = run.map.nodes.find(entry => entry.kind === 'shop');
  return node ? rollShop({ ...run, at: node.id, path: [node.id], gold }) : undefined;
}

function shopRun(gold = 500): ChapterRun {
  for (let seed = 7; seed <= 207; seed++) {
    const run = shopOn(seed, gold);
    if (run) return run;
  }
  throw new Error('200 个种子里一家商店都没有——`bandFor` 里的 shop 被拿掉了？');
}

/** 一个已经打完的假状态，只给 `finishBattle` 读它真正读的那几个字段。 */
const wonState = (hp: number, marks: Record<string, number>) => ({
  phase: 'won', encounterId: 'ch1-1', player: { hp }, marks,
} as unknown as BattleState);

test('商店：五格、至少一格道具、恰一格打五折', () => {
  const run = shopRun();
  const slots = run.shop!.slots;
  assert.equal(slots.length, SHOP_SLOTS);
  // 保底那一格是**先摇位置再填**的，所以「有道具」不是概率，是承诺。
  assert.ok(slots.some(slot => slot.kind === 'prop'), '货架上没有道具——那一格是保底的');
  const onSale = slots.filter(slot => slot.price < slot.fullPrice);
  assert.equal(onSale.length, 1, `五折应该恰好一格，实际 ${onSale.length} 格`);
  assert.equal(onSale[0].price, Math.ceil(onSale[0].fullPrice / 2), '五折那一格的价钱不是一半');
  for (const slot of slots) {
    // 血价与遗物价都是**从折后价推**的，所以半价那一格在三种货币上都是半价。
    assert.equal(slot.hpPrice, hpPriceOf(slot.price), '血价不是从折后价推的');
    assert.equal(slot.relicPrice, slot.price, '遗物价不是这一格的标价');
    assert.ok(Number.isInteger(slot.price) && slot.price > 0 && slot.price <= slot.fullPrice);
    assert.ok(SHOP_KINDS.includes(slot.kind));
    assert.ok(shopSlotName(slot).length > 0, `${slot.kind} 那一格没有名字`);
  }
  assert.ok(isValidRun(run), '商店的存档过不了校验');
});

test('商店：同一个种子同一批货，而且掷点一格都不碰 run 的流', () => {
  const run = shopRun();
  assert.deepEqual(rollShop({ ...run, shop: undefined }).shop!.slots, run.shop!.slots,
    '同一个节点掷出了两批货');
  // 幂等：重绘、重载、界面照宝箱那条路多调一次，摆出来的都还是那五格。
  assert.equal(rollShop(run), run, '`rollShop` 第二次调用换了货');
  // ⚠️ 商店的掷点走自己那条流（种子 + 节点 id）。插进 `run.rng` 会把每一个种子的回血与金币整体
  // 推移一格——上面那条「同一条 run 重放两次完全相同」就是钉这件事的。
  assert.equal(run.rng, newRun('blade', 'bone', run.seed).rng, '掷货架动了 run 的掷点流');

  const shelves = new Set<string>();
  for (let seed = 7; seed <= 60; seed++) {
    const one = shopOn(seed);
    if (one) shelves.add(JSON.stringify(one.shop!.slots));
  }
  assert.ok(shelves.size > 10, `几十家店只摆出 ${shelves.size} 种货架——掷点可能没走种子`);
});

test('商店：金币付 —— 买不起、越界、已售，都必须是同一个对象', () => {
  const run = shopRun(1000);
  const slot = run.shop!.slots[0];
  const bought = buyShopSlot(run, 0, 'gold');
  assert.equal(bought.gold, run.gold - slot.price, '买完金币不对');
  assert.equal(bought.shop!.slots[0].sold, true, '买下了却没有标售出');
  assert.equal(bought.shop!.slots[1], run.shop!.slots[1], '没买的那一格也变了');

  // ⚠️ 界面靠 `next === run` 判断要不要播音效 / 扣动画，所以「没做成」必须是同一个引用。
  const broke: ChapterRun = { ...run, gold: slot.price - 1 };
  assert.equal(canPayWith(broke, 0, 'gold'), false);
  assert.equal(buyShopSlot(broke, 0, 'gold'), broke, '钱不够却动了 run');
  assert.equal(buyShopSlot(run, SHOP_SLOTS, 'gold'), run, '越界');
  assert.equal(buyShopSlot(run, -1, 'gold'), run, '负下标');
  assert.equal(buyShopSlot(bought, 0, 'gold'), bought, '已经卖掉的那一格还能再买一次');
  assert.equal(buyShopSlot({ ...run, shop: undefined }, 0, 'gold').shop, undefined, '不在商店里也能买');
});

test('商店：生命付 —— 付完必须还剩至少 1 点', () => {
  const run = shopRun(0);
  const slot = run.shop!.slots[0];
  // 判据是 `>` 不是 `>=`，和奇遇的 `canAfford` 同一条：付完剩 0 血要挡住。
  const exact: ChapterRun = { ...run, hp: slot.hpPrice };
  assert.equal(canPayWith(exact, 0, 'hp'), false, '付完正好 0 血却点亮了');
  assert.equal(buyShopSlot(exact, 0, 'hp'), exact, '在店里把自己付死了');
  const paid = buyShopSlot({ ...run, hp: slot.hpPrice + 1 }, 0, 'hp');
  assert.equal(paid.hp, 1, '付完不是剩 1 点');
  assert.equal(paid.gold, run.gold, '用血付还扣了钱');
});

test('商店：遗物付 —— 比的是「价值不低于」，换走的连带清掉淬炼', () => {
  const base = shopRun(0);
  const worth = relicValueOf('iron-nail');
  assert.equal(worth, RELIC_PRICE.shard, '残片的价不是 RELIC_PRICE 里那个数——两套价表分家了');
  const run: ChapterRun = { ...base, relics: { main: 'iron-nail' }, refined: { 'iron-nail': 'small' } };

  const dear = run.shop!.slots.findIndex(slot => slot.relicPrice > worth);
  assert.ok(dear >= 0, '货架上没有一格比残片贵——这条就验不到东西');
  assert.equal(canPayWith(run, dear, 'relic'), false, '一件残片买走了更贵的东西');
  assert.equal(buyShopSlot(run, dear, 'relic', 'main'), run, '价值不够却成交了');
  assert.equal(buyShopSlot(run, dear, 'relic'), run, '没说要拿哪一格，却也成交了');
  assert.equal(buyShopSlot(run, dear, 'relic', 'sub'), run, '副槽是空的，却按副槽成交了');

  // 便宜的那一格收。保底的道具格一定在其中（最贵的道具打完折也低于一件残片）。
  const cheap = run.shop!.slots.findIndex(slot => slot.relicPrice <= worth);
  assert.ok(cheap >= 0, '五格里没有一格收得下残片');
  const traded = buyShopSlot(run, cheap, 'relic', 'main');
  assert.notEqual(traded, run);
  assert.equal(traded.relics.main, undefined, '换走了却还挂在主槽上');
  assert.equal(traded.refined?.['iron-nail'], undefined, '遗物换走了，淬炼还留着');
  assert.equal(traded.gold, run.gold, '用遗物付还扣了钱');
  assert.equal(traded.relics.sub, run.relics.sub, '主槽空了，副槽不该被顶上来');
});

test('商店：刷新一次翻一倍，钱不够就原样退回', () => {
  const run = shopRun(0);
  assert.equal(shopRerollCost(run), SHOP_REROLL_BASE);
  assert.equal(rerollShop(run), run, '一分钱没有却刷了货');

  const once = rerollShop({ ...run, gold: SHOP_REROLL_BASE });
  assert.notEqual(once, run);
  assert.equal(once.gold, 0);
  assert.equal(once.shop!.rerolls, 1);
  assert.equal(shopRerollCost(once), SHOP_REROLL_BASE * 2, '刷新费没有翻倍');
  const nearly = { ...once, gold: SHOP_REROLL_BASE * 2 - 1 };
  assert.equal(rerollShop(nearly), nearly, '差一个铜板也刷得动');

  // 卖掉的那几格不重生（它本来就是空的），刷新只在还摆着货的格子里换。
  const rich = shopRun(1000);
  const taken = buyShopSlot(rich, 0, 'gold');
  const after = rerollShop(taken);
  assert.equal(after.shop!.slots[0].sold, true, '刷新把已经卖掉的那一格又摆上了货');
  assert.notEqual(after.shop!.slots[1], taken.shop!.slots[1], '刷新没有换货');
});

test('商店：删牌服务一家一次，价钱跨商店递增（75 / 100）', () => {
  const run = shopRun(1000);
  assert.equal(shopRemoveCost(run), 75);
  const bought = buyRemoveService(run);
  assert.equal(bought.cardTask, 'remove', '买了删牌却没有开选牌器');
  assert.equal(bought.gold, run.gold - 75, '价钱不对');
  assert.equal(bought.shop!.removed, true);
  assert.equal(buyRemoveService(bought), bought, '同一家店删了两次');
  const nearly = { ...run, gold: 74 };
  assert.equal(buyRemoveService(nearly), nearly, '差价一个铜板也删得动');

  // 第二家店：价钱按「路上已经走过几家店」递增。
  let two: ChapterRun | undefined;
  for (let seed = 7; seed <= 207 && !two; seed++) {
    const candidate = newRun('blade', 'bone', seed);
    const shops = candidate.map.nodes.filter(node => node.kind === 'shop');
    if (shops.length >= 2) {
      two = rollShop({ ...candidate, at: shops[1].id, path: [shops[0].id, shops[1].id], gold: 1000 });
    }
  }
  assert.ok(two, '200 个种子里没有一张图有两家店');
  assert.equal(shopRemoveCost(two!), 75 + 25, '第二家店的删牌价没有递增');
});

test('商店：上一件还没放下就不再卖 —— 收钱不发货是最坏的失败', () => {
  const run = shopRun(1000);
  const prop = run.shop!.slots.findIndex(slot => slot.kind === 'prop');

  const first = buyShopSlot(run, prop, 'gold');
  assert.ok(first.propTask, '买了道具却没有停在「还没放下」上');
  assert.equal(first.shop!.slots[prop].sold, true);

  // 三样东西各要一个没答完的决定，而那个决定同时只能有一个。
  const holding: ChapterRun = { ...run, propTask: { id: 'staunch-moss', from: '商店' } };
  assert.equal(shopPending(holding), true);
  assert.equal(buyShopSlot(holding, prop, 'gold'), holding, '上一件道具还没放下又卖了一件');
  assert.equal(holding.gold, run.gold, '被拒绝的那一次也扣了钱');

  const revealing: ChapterRun = {
    ...run, cardReveal: { gained: [{ cardId: run.deck[0].cardId }], from: '商店' },
  };
  const card = run.shop!.slots.findIndex(slot => slot.kind === 'card');
  if (card >= 0) assert.equal(buyShopSlot(revealing, card, 'gold'), revealing, '买来的牌还没看就给第二张');

  const drawing: ChapterRun = { ...run, pendingDraw: { options: ['iron-nail'], slot: 'main', from: '商店' } };
  const relic = run.shop!.slots.findIndex(slot => slot.kind === 'relic');
  if (relic >= 0) assert.equal(buyShopSlot(drawing, relic, 'gold'), drawing, '上一件遗物还没放又卖了一件');
});

test('商店：买下来的东西落得到手上', () => {
  /**
   * ⚠️ **先扣掉 20 点血，否则这条断言在测种子而不是在测商店。**
   *
   * `stat` 那一格是 `STAT_GOODS` 里的**两件之一**，其中「回复 30 点生命」在满血的一局里买下来
   * `hp` 一格都不动（`deliver` 里是 `Math.min(maxHp, hp + 30)`），于是 `gained > 0` 会红。
   * `shopRun` 从种子 7 起找**第一家店**，而「第一家店掷到哪一件」是塔的形状的函数——加高塔
   * （16 → 21 行）把它从加厚换成了回血，这条测试就红了，而商店一点没坏。
   *
   * 扣血之后两件货都真的给得出东西，`gained > 0` 一个字没放松。
   */
  const shelf = shopRun(1000);
  const run: ChapterRun = { ...shelf, hp: shelf.maxHp - 20 };
  const find = (kind: string) => run.shop!.slots.findIndex(slot => slot.kind === kind);

  const prop = find('prop');
  assert.equal(buyShopSlot(run, prop, 'gold').propTask?.from, '商店');

  const card = find('card');
  if (card >= 0) {
    const done = buyShopSlot(run, card, 'gold');
    // 买来的牌一定要摆出来看一眼，理由和「一捆牌」那条一样：不摆出来的东西玩家永远不知道是什么。
    assert.equal(done.cardReveal?.from, '商店');
    assert.ok(done.deck.some(entry => entry.cardId === run.shop!.slots[card].id));
  }

  const relic = find('relic');
  if (relic >= 0) {
    const done = buyShopSlot(run, relic, 'gold');
    // 和一次遗物抽取共用 `pendingDraw`，所以「放进哪个槽」不需要另写一套。
    assert.deepEqual(done.pendingDraw?.options, [run.shop!.slots[relic].id]);
    assert.equal(done.pendingDraw?.from, '商店');
  }

  const stat = find('stat');
  if (stat >= 0) {
    const done = buyShopSlot(run, stat, 'gold');
    const gained = done.maxHp - run.maxHp + (done.hp - run.hp);
    assert.ok(gained > 0, '买了属性却没有变化');
  }
});

test('商店：界面置灰与真正的规则是两处代码，对跑一遍', () => {
  const run = shopRun(0);
  const poor: ChapterRun = { ...run, gold: 0, hp: 1, relics: {} };
  for (let index = 0; index < SHOP_SLOTS; index++) {
    for (const payWith of ['gold', 'hp', 'relic'] as const) {
      const lit = canPayWith(poor, index, payWith);
      const done = buyShopSlot(poor, index, payWith, 'main');
      assert.equal(done === poor, !lit,
        `第 ${index} 格用 ${payWith}：置灰说「${lit ? '买得起' : '买不起'}」，规则说「${done === poor ? '没成交' : '成交了'}」`);
    }
  }
  // 反过来：买得起的时候必须真的成交（`canPayWith` 为真而 `buyShopSlot` 原样退回，只能是漏了一条规则）。
  //
  // ⚠️ **这里刻意用不满血的一份。** 满血时「回复 30 点生命」那一格**本来就买不到**——
  // 付得起 90 金、扣了钱、血一点没动，而界面上没有任何东西提示玩家。所以 `canPayWith` 有一条
  // 「满血时回血格不算买得起」，而 `buyShopSlot` 走同一个判据。这一份血不满，它就买得到，
  // 「钱够 ⇒ 必成交」这条才立得住；满血那一格由下面那条单独钉。
  const rich: ChapterRun = { ...run, gold: 99999, hp: run.maxHp - 20 };
  for (let index = 0; index < SHOP_SLOTS; index++) {
    assert.notEqual(buyShopSlot(rich, index, 'gold'), rich, `第 ${index} 格付得起金币却没成交`);
  }
});

test('商店：满血时「回血」那一格买不到', () => {
  // 这是一条**买到了但什么也没发生**的 bug：货架卖掉、钱扣掉、血没动，界面也不提示。
  // 挡在 `canPayWith` 里，因为置灰与拒绝必须走同一个判据（否则会画出一个点得动却被引擎拒的按钮）。
  const run = { ...shopRun(0), gold: 99999, hp: shopRun(0).maxHp };
  const heal = run.shop!.slots.findIndex(slot => slot.kind === 'stat' && slot.id === 'heal');
  // 这一家不一定摆回血；摆了就验，没摆就跳过——不为了测它去改货架。
  if (heal < 0) return;
  assert.equal(canPayWith(run, heal, 'gold'), false, '满血时回血格不该是买得起的');
  assert.equal(canPayWith(run, heal, 'hp'), false);
  assert.equal(buyShopSlot(run, heal, 'gold'), run, '满血买回血不该成交');
  // 掉一点血之后它就该买得动了——否则这条规则会连正常情况一起挡掉。
  const hurt: ChapterRun = { ...run, hp: run.maxHp - 1 };
  assert.equal(canPayWith(hurt, heal, 'gold'), true);
  assert.notEqual(buyShopSlot(hurt, heal, 'gold'), hurt);
});

test('商店：脏的货架过不了校验（少一格 / 假 id / 负价 / 负刷新次数）', () => {
  const run = shopRun(1000);
  assert.ok(isValidRun(run));
  const { map, ...wire } = run;
  void map;
  const round = JSON.parse(JSON.stringify(wire)) as ChapterRun;
  assert.deepEqual(round.shop, wire.shop, '货架过一遍 JSON 变了样——里面混进了不是纯数据的东西');
  assert.equal(isValidRun(round), true, '过一遍 JSON 就不过校验了');

  const rest = run.shop!.slots.slice(1);
  const broken: [string, ChapterRun][] = [
    ['少了格子', { ...run, shop: { ...run.shop!, slots: rest } }],
    ['多了一格', { ...run, shop: { ...run.shop!, slots: [...run.shop!.slots, run.shop!.slots[0]] } }],
    ['id 不存在', { ...run, shop: { ...run.shop!, slots: [{ ...run.shop!.slots[0], id: 'no-such-thing' }, ...rest] } }],
    ['负价', { ...run, shop: { ...run.shop!, slots: [{ ...run.shop!.slots[0], price: -1 }, ...rest] } }],
    ['价钱不是整数', { ...run, shop: { ...run.shop!, slots: [{ ...run.shop!.slots[0], hpPrice: 1.5 }, ...rest] } }],
    ['刷新次数是负的', { ...run, shop: { ...run.shop!, rerolls: -1 } }],
    ['不是商店', { ...run, shop: { slots: 'nope' } } as unknown as ChapterRun],
  ];
  for (const [why, value] of broken) {
    assert.equal(isValidRun(value), false, `本该拒绝：${why}`);
  }
  assert.equal(isValidRun({ ...run, warded: 'yes' }), false, 'warded 不是布尔也该拒绝');
  assert.equal(isValidRun({ ...run, warded: true }), true, '一条命也算脏存档？');
});

test('免死：和残烛是同一条命，战斗把它用掉了才结账', () => {
  // 免死只是五类里的一类（权重 10），所以不是每家店都有——顺着种子找一家摆着它的。
  let shelf: ChapterRun | undefined;
  for (let seed = 7; seed <= 207 && !shelf; seed++) {
    const run = shopOn(seed, 1000);
    if (run && run.shop!.slots.some(slot => slot.kind === 'life')) shelf = run;
  }
  assert.ok(shelf, '200 个种子里没有一家卖免死——那一类的权重被拿掉了？');
  const run = shelf!;
  const life = run.shop!.slots.findIndex(slot => slot.kind === 'life');
  const bought = buyShopSlot(run, life, 'gold');
  assert.equal(bought.warded, true, '买了免死却没有那条命');
  assert.equal(bought.shop!.warded, true, '货架上没记下这一笔');
  assert.ok(isValidRun(bought), '带着一条命的存档过不了校验');

  /**
   * ⚠️ **记号必须是引擎里残烛写的那个键。**
   *
   * 项目里已经有两处「下一次致死伤害留 1 点」，商店这条命要走的是**残烛那一条**（道具是玩家花钱
   * 买的，遗物是带在身上更久的，两者不同）。这条测试不问 `engine.ts` 要什么，它让**残烛真的写一次**
   * 记号，再和 `wardMark()` 对键——两边任何一个改名都会红。
   */
  const battle = startBattle('ch1-1', bought.main, 7, { props: placeIn(emptyProps(), 0, 'stub-candle') });
  const candle = useProp(battle, 0);
  const wardKeys = Object.keys(wardMark());
  assert.equal(wardKeys.length, 1, '`wardMark()` 只该带一个记号');
  // ⚠️ 比的是「残烛真的写下的那些键」，不是整份 marks——战斗自己还写着 `attacked:turn` 之类。反过来
  // 两边任何一个改名，这里都会红。
  const candleKeys = Object.keys(candle.marks ?? {});
  for (const key of wardKeys) {
    assert.ok(candleKeys.includes(key),
      `残烛写的记号里没有 ${key}（场上只有 ${candleKeys.join(', ')}）—— 商店这条命会和道具那条分成两条`);
  }

  // 引擎把记号置 0 = 那一下被它挡掉了 → 结账；没置 0 就不动（也就不会把玩家买的东西悄悄吃掉）。
  const spent = finishBattle(bought, wonState(bought.hp, { 'prop:deathWard': 0 })).run;
  assert.equal(spent.warded, undefined, '那条命用掉了却还挂在身上');
  const kept = finishBattle(bought, wonState(bought.hp, {})).run;
  assert.equal(kept.warded, true, '没用掉的命被清掉了');
});

test('商店：离开就是结束这一层；买来的道具还没放下时不放人', () => {
  const run = shopRun(1000);
  const left = leaveShop(run);
  assert.equal(left.resolved, run.at, '离开没有设 resolved —— 楼层屏会再弹一次');
  assert.ok(isValidRun(left));

  // 放道具屏是 `propTask` 唯一的出口（分派链里没有别的屏读它），走了这一件就永远留在那儿了。
  const holding: ChapterRun = { ...run, propTask: { id: 'staunch-moss', from: '商店' } };
  assert.equal(shopPending(holding), true);
  assert.equal(leaveShop(holding), holding, '买来的道具还没放下就走了');
});

test('商店：踏进商店才掷货架，踏离就把它丢掉', () => {
  const base = newRun('blade', 'bone', 11);
  const shop = base.map.nodes.find(node => node.kind === 'shop');
  assert.ok(shop, '这个种子的塔上没有商店——换一个种子，或者 shop 的权重被拿掉了');
  assert.equal(base.shop, undefined);

  // 站在它的下一层——`enterNode` 只认「从脚下这一步走得过去」，所以不能随便找个起点。
  const below = base.map.nodes.find(node => node.next.includes(shop!.id));
  assert.ok(below, '商店没有前驱，那它根本走不到');
  const inside = enterNode({ ...base, at: below!.id, path: [below!.id] }, shop!.id);
  assert.ok(inside.shop, '踏进商店却没有货架');
  assert.equal(inside.shop!.slots.length, SHOP_SLOTS);
  assert.ok(inside.path.includes(shop!.id));

  // 再往上走一步：货架留在那家店里。
  const next = inside.map.byId.get(shop!.id)!.next[0];
  assert.equal(enterNode(inside, next).shop, undefined, '离开了商店，货架还跟着走');
  // 而且 `shop` 这个键是**摘掉**的，不是设成 undefined——JSON 会丢掉 undefined，于是存档往返测试
  // 会在 `deepEqual(round, wire)` 上莫名其妙地红。
  assert.equal('shop' in enterNode(inside, next), false, '`shop: undefined` 这种键会在 JSON 往返里变样');
});
