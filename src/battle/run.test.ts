/**
 * What a run promises, and what it refuses to allow.
 *
 * This file is deliberately *not* a test of how well a scripted policy plays. Writing an AI that can
 * beat 头狼 would be testing the AI, not the run layer — and it would be brittle besides. What is
 * checked here is the run's actual contract:
 *
 *   1. the heal always lands in 9–15, is capped by 生命上限, and is reproducible from the run seed;
 *   2. the chapter is a line — no save and no transition can skip an encounter;
 *   3. a victory advances and a defeat does not, so the caller can safely discard a dead run;
 *   4. the 主/副 composition holds `MAIN_SHARE`, keeps the main deck whole, and splashes one copy each;
 *   5. a whole run driven through *real* battles keeps every invariant at every step, and replays
 *      identically from the same seed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { CARD_BY_ID, DECK_IDS, MAIN_SHARE, type DeckId } from '../cards/index.ts';
import { CHAPTER_1, chapterDeck, isDeckUnlocked, starterDeck } from './chapter.ts';
import { canPlay, endTurn, isValidBattle, livingEnemies, playCard, startBattle, type BattleState } from './engine.ts';
import { ALL_ENCOUNTERS, POOLS } from './enemies.ts';
import { generateMap } from './map.ts';
import {
  HEAL_MAX, HEAL_MIN, RUN_ENCOUNTERS, addCard, battleSeed, canEnter, canEnterNode, currentEncounter, deckFor,
  encounterFor, enterNode, finishBattle, healRoll, nextChoices, removeCard, restHeal, spendGold, upgradeCard,
  isChapterCleared, isValidRun, newRun, swapDecks, type ChapterRun,
} from './run.ts';

/** The two decks chapter I hands out. */
const DECKS: DeckId[] = ['blade', 'bone'];

/** The engine never uses `Math.random`, and neither do the tests. */
function lcg(seed: number) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

// ----------------------------------------------------------- 1. creating a run

test('新 run：满血、零进度、合法，且两副牌都必须在第一章可用', () => {
  const run = newRun('blade', 'bone', 11);
  assert.equal(run.hp, 60);
  assert.deepEqual(run.cleared, []);
  assert.equal(run.main, 'blade');
  assert.equal(run.sub, 'bone');
  assert.ok(isValidRun(run), '新 run 必须合法');
  assert.equal(currentEncounter(run)?.id, 'ch1-1', '第一场是荒野巡夜');
  assert.equal(isChapterCleared(run), false);
  assert.throws(() => newRun('flame', 'bone', 1), /不能携带/, '未解锁的牌组不能开局');
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
    { ...run, main: 'flame' },
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
    { ...run, cleared: ['ch1-1', 'w-hollowrim'] },
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
  ]) {
    assert.equal(isValidRun({ ...run, cleared }), true, `本该接受：${JSON.stringify(cleared)}`);
  }
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
  assert.throws(() => startBattle('ch1-1', 'blade', 7, { sub: 'flame' }), /不能携带/, '未解锁的副牌组必须拒绝');
  assert.throws(() => startBattle('ch1-1', 'flame', 7), /不能携带/, '未解锁的主牌组必须拒绝');
  // Passing the main deck as its own sub is a no-op, not an error — the splash is just empty.
  assert.equal(startBattle('ch1-1', 'blade', 7, { sub: 'blade' }).sub, 'blade');
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
  const other = newRun('blade', 'bone', 100);
  assert.notEqual(battleSeed(run, 'ch1-1'), battleSeed(other, 'ch1-1'), '不同 run 不该撞种子');
});

test('第一章的两副牌都能当主牌组，别的不能', () => {
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
