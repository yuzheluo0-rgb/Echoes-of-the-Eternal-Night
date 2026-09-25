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
 *      identically from the same seed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { CARD_BY_ID, DECK_IDS, MAIN_SHARE, type DeckId } from '../cards/index.ts';
import { CHAPTER_1, chapterDeck, isDeckUnlocked, openingForms, starterDeck } from './chapter.ts';
import {
  PLAYER_MAX_HP, canPlay, endTurn, isValidBattle, livingEnemies, playCard, startBattle, type BattleState,
} from './engine.ts';
import { ALL_ENCOUNTERS, POOLS } from './enemies.ts';
import { effectFor } from './effects.ts';
import { EVENTS } from './events.ts';
import { REWARD_BY_ID } from './rewards.ts';
import { fullDeckPool, rewardCardPool, rollCardOffer } from './rewards.ts';
import { generateMap } from './map.ts';
import {
  HEAL_MAX, HEAL_MIN, RUN_ENCOUNTERS, addCard, answerRefine, battleSeed, canEnter, canEnterNode,
  chooseCard, claimReward, currentEncounter, deckFor, dismissRefine, dismissReveal, resolveEvent, encounterFor, enterNode, finishBattle, healRoll, holdsRelic,
  isValidRun, newRun, nextChoices, removeCard, restHeal, spendGold, swapDecks, upgradeCard,
  isChapterCleared, type ChapterRun,
} from './run.ts';

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
