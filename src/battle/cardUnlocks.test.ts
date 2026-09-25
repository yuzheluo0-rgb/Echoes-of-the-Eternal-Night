/**
 * `CHAPTER_1.nextUnlock` is a sentence the game shows a player, and for most of this project's life it
 * was the *only* thing that existed: it named eight 明焰阶 cards, none of them had effects, and no
 * code anywhere moved them into a pool. The unlock panel promised a reward for beating 草原守望者
 * that the chapter could not deliver.
 *
 * So what is checked here is that the sentence is true end to end — every id resolves, each one does
 * something, each one can be polished, every deck the chapter hands out gets the same number, and a
 * victory actually widens the pool a run draws from. The "each one does something" half is the one
 * that would have failed the day the sentence was written; it is kept next to the rest because it is
 * the same promise.
 *
 * The storage tests run against a stub, because node has no `localStorage` and the whole point of the
 * memo in `earnedCards()` is that it has to be invalidated by a write — which is only observable if
 * there is somewhere to write to.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOSS_IDS, BOSS_UNLOCKS, clearProgress, creditAndSave, creditProgress, earnedCards, emptyProgress,
  isValidProgress, newUnlocks, unlockGroups, unlocksFor,
} from './cardUnlocks.ts';
import { CHAPTER_1 } from './chapter.ts';
import { rewardCardPool } from './rewards.ts';
import { CARD_EFFECTS } from './effects.ts';
import { isUpgradable } from './upgrades.ts';
import { CARD_BY_ID } from '../cards/index.ts';

/** A `localStorage` good enough for the progress module, torn down again afterwards. */
function withStorage<T>(fn: () => T): T {
  const store = new Map<string, string>();
  const g = globalThis as unknown as Record<string, unknown>;
  const before = g.localStorage;
  g.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
  };
  try {
    clearProgress();               // drop the memo, so each test starts from nothing
    return fn();
  } finally {
    clearProgress();               // and again, so no later test inherits this one's cache
    if (before === undefined) delete g.localStorage; else g.localStorage = before;
  }
}

test('击破守望者给每一副牌组同样多的牌，而且一张白板都没有', () => {
  const ids = unlocksFor('ch1-5');
  assert.deepEqual([...ids].sort(), [...BOSS_IDS].sort());

  // **The floor is six for every deck, and ten for a deck whose starting pool contains none of its
  // own 明焰阶.** That asymmetry is derived rather than chosen, and it has a reason: half of every
  // other deck's 明焰阶 already sits in its starting pool, so for them the boss is a top-up, while
  // for the deck that starts with none of it the boss is the *only* place its archetype can arrive
  // from — and six cards is not a package anyone can build around.
  //
  // The check lives here rather than in a comment because the tempting version of this reward is to
  // give the deck you happen to like more, and that turns the reward into a reason to have picked
  // that deck a chapter ago instead of a reason to start another run.
  for (const deck of CHAPTER_1.decks) {
    const unlocked = BOSS_UNLOCKS[deck] ?? [];
    const starter = new Set(CHAPTER_1.unlocked[deck] ?? []);
    const blaze = CARD_BY_ID.get('blade-16')!.tier;   // 明焰阶, by example rather than by name
    const startsWithBlaze = [...starter].some(id => CARD_BY_ID.get(id)?.tier === blaze);
    assert.ok(unlocked.length >= 6, `${deck} 只解锁 ${unlocked.length} 张，打完之后没有新鲜感`);
    if (!startsWithBlaze) {
      assert.ok(unlocked.length >= 10,
        `${deck} 起手一张明焰阶都没有，解锁必须给够一套能玩的 —— 现在只有 ${unlocked.length} 张`);
    }
    for (const id of unlocked) assert.ok(!starter.has(id), `${deck} 的 ${id} 起手就有，解锁没有意义`);
  }
  assert.equal(ids.length, CHAPTER_1.decks.reduce((n, d) => n + (BOSS_UNLOCKS[d]?.length ?? 0), 0));

  // Everything else in the chapter pays in relics or in nothing, never in cards.
  for (const id of ['ch1-1', 'ch1-2', 'ch1-3', 'ch1-4', 'w-shadepack', 'nope']) {
    assert.deepEqual(unlocksFor(id), [], `${id} 不该解锁牌`);
  }

  for (const id of ids) {
    assert.ok(CARD_BY_ID.has(id), `${id} 不在牌库里`);
    // The check that would have failed the day the sentence was written.
    assert.ok(CARD_EFFECTS[id], `${id} 没有效果 —— 解锁出去就是一张白板`);
    assert.ok(isUpgradable(id), `${id} 磨不动，营火会把它列出来然后什么都不做`);
    // And they are not quietly already in the starting pool, or the unlock would be a no-op.
    assert.ok(!Object.values(CHAPTER_1.unlocked).flat().includes(id), `${id} 起手就该有，解锁没有意义`);
  }
});

test('解锁是幂等的：同一场打赢两次不会重复发放', () => {
  const once = creditProgress(emptyProgress(), 'ch1-5');
  assert.equal(once.unlocked.length, BOSS_IDS.length);
  assert.deepEqual(once.credited, ['ch1-5']);
  assert.equal(creditProgress(once, 'ch1-5'), once, '第二次必须原地返回，调用方才能便宜地跳过写入');

  // ⚠️ And a victory that pays no cards must not be written down at all. `isValidProgress` only
  // accepts encounters that can pay out, so recording 「ch1-1」 here would invalidate the whole file
  // and throw the unlocks away on the next load.
  const ordinary = creditProgress(once, 'ch1-1');
  assert.equal(ordinary, once, '不发牌的遭遇战不该动这份存档');
  assert.equal(isValidProgress(ordinary), true, '而且它必须仍然是合法的');
});

test('解锁之后，那几张牌真的进了战利品池', () => {
  withStorage(() => {
    const before = rewardCardPool('blade', 'bone');
    assert.ok(!before.includes('blade-16'), '还没打赢就不该出现');
    assert.deepEqual(earnedCards(), [], '一开始什么都没解锁');

    creditAndSave('ch1-5');
    for (const id of BOSS_IDS) assert.ok(earnedCards().includes(id), `${id} 没有被记住`);

    // Per deck, because the pool is 「both of the run's decks and nothing else」 — an unlocked card
    // from a deck the run is not carrying is still a card with no support around it. Checking all
    // eighteen against one pair of decks would have been checking the wrong thing, and did fail.
    for (const deck of CHAPTER_1.decks) {
      const pool = rewardCardPool(deck, deck);
      for (const id of BOSS_UNLOCKS[deck]) assert.ok(pool.includes(id), `${id} 解锁后仍然抽不到`);
    }
    assert.ok(!rewardCardPool('blade', 'blade').includes('bone-16'), '不该混进没带的那副');
    assert.ok(rewardCardPool('bone', 'bone').includes('bone-16'), '带了就该有');
    assert.ok(!rewardCardPool('blade', 'blade').includes('flame-16'), 'flame 的牌不该进刃的池子');

    // A second victory credits nothing new, and leaves the pool exactly as it was.
    const after = rewardCardPool('blade', 'bone');
    creditAndSave('ch1-5');
    assert.deepEqual(rewardCardPool('blade', 'bone'), after);
  });
});

test('损坏的解锁存档被拒绝，不会把别的牌塞进池子', () => {
  for (const bad of [
    null, undefined, 42, 'x', {},
    { version: 2, unlocked: [], credited: [] },
    { version: 1, unlocked: 'blade-16', credited: [] },
    // Starting cards are not unlocks — a file claiming them is describing a chapter that never existed.
    { version: 1, unlocked: ['blade-01'], credited: [] },
    { version: 1, unlocked: ['nope'], credited: [] },
    { version: 1, unlocked: ['blade-16', 'blade-16'], credited: [] },
    // An encounter that cannot pay out must not be in `credited`, for the reason the test above gives.
    { version: 1, unlocked: [], credited: ['ch1-1'] },
  ]) {
    assert.equal(isValidProgress(bad), false, `本该拒绝：${JSON.stringify(bad)}`);
  }
  assert.equal(isValidProgress({ version: 1, unlocked: ['blade-16'], credited: ['ch1-5'] }), true);
});

test('解锁的牌按牌组合并，顺序跟着牌组表走', () => {
  // 这一条管的是**解锁屏第一眼看到什么**：那 26 张牌里，哪几张是给我正在用的那副牌的。
  // 分组写在 `cardUnlocks.ts` 而不是屏幕里，因为 `strip-types` 解析不了 JSX——
  // 写在屏幕旁边的规则是测试够不到的规则（`describeEffect` 就是为此挪出来的）。
  const groups = unlockGroups(BOSS_IDS);
  assert.deepEqual(groups.map(g => g.deck), ['blade', 'flame', 'bone'], '牌组顺序必须跟着 DECKS 走');
  assert.equal(groups.length, 3, '三副牌各一组');
  for (const group of groups) {
    assert.ok(group.ids.length > 0, `${group.deck} 分到了空组`);
    // 每一张都必须真的属于这一组，不能串台。
    for (const id of group.ids) assert.equal(CARD_BY_ID.get(id)?.deck, group.deck, `${id} 分错了牌组`);
  }
  // 合起来必须**一张不多一张不少**——分组丢牌是最容易发生、也最难在界面上发现的错。
  assert.deepEqual(groups.flatMap(g => g.ids).sort(), [...BOSS_IDS].sort(), '分组把牌弄丢或弄重了');
  // 空输入不该崩，也不该吐出一个空组。
  assert.deepEqual(unlockGroups([]), []);
});

test('newUnlocks：一次击杀只报**这次新拿到的**，重复击破返回空', () => {
  // 判定抽在 `cardUnlocks.ts` 而不是屏幕里：`strip-types` 解析不了 JSX，
  // 写在组件旁边的规则是测试够不到的规则。
  assert.deepEqual(newUnlocks('ch1-5', []).sort(), [...BOSS_IDS].sort(), '第一次击破应当报全部');
  assert.deepEqual(newUnlocks('ch1-5', BOSS_IDS), [], '第二次击破不该再报成「新解锁」');
  assert.deepEqual(newUnlocks('ch1-5', BOSS_IDS.slice(0, 5)).sort(), [...BOSS_IDS].slice(5).sort(),
    '只解锁了一部分时，报的应当正好是没拿到的那部分');
  // 一场不发牌的仗永远报空——这是 `creditAndSave` 的幂等性依赖的前提。
  assert.deepEqual(newUnlocks('ch1-1', []), []);
  assert.deepEqual(newUnlocks('没有这场仗', []), []);
});
