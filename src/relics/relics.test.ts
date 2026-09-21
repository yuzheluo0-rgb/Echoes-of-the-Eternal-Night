/**
 * The relic set's contract with itself.
 *
 * The page cannot be imported here — it is `.tsx` behind two stylesheets, and node's type stripping
 * parses neither JSX nor CSS. So this checks the two things that *can* be checked without a browser,
 * and both of them are the kind of mistake that ships silently:
 *
 *   1. **the data is complete** — 71 relics, one of every tier, no duplicate id or name, and every
 *      relic has a search phrase AND a lesser-slot effect that actually differs from the main one;
 *   2. **the art request in `art.ts` and the set in `relics.ts` line up in both directions.** A relic
 *      with no phrase is a card with no picture; a phrase with no relic is a photograph nobody asked
 *      for. Neither is visible in the UI until it is too late.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { RELIC_QUERY } from './art.ts';
import { RELICS, RELIC_TIERS, RANK_OF, TIER_BY_ID, relicsForChapter, relicsOfTier, tierCounts } from './relics.ts';

const EXPECTED_TOTAL = 71;

test('遗物正好 71 件，id 与名称都不重复', () => {
  assert.equal(RELICS.length, EXPECTED_TOTAL, `遗物总数应为 ${EXPECTED_TOTAL}`);
  const ids = RELICS.map(relic => relic.id);
  assert.equal(new Set(ids).size, ids.length, 'id 必须唯一');
  const names = RELICS.map(relic => relic.name);
  assert.equal(new Set(names).size, names.length, '名称必须唯一，否则玩家分不清两件东西');
  for (const id of ids) assert.match(id, /^[a-z0-9-]+$/, `${id} 只能用小写字母、数字和连字符`);
});

test('每一件都有主槽与副槽两套效果，且两套确实不同', () => {
  for (const relic of RELICS) {
    assert.ok(relic.text.length > 0, `${relic.id} 没有主槽效果`);
    assert.ok(relic.sub.length > 0, `${relic.id} 没有副槽效果`);
    assert.ok(relic.lore.length > 0, `${relic.id} 没有来历`);
    assert.notEqual(relic.sub, relic.text,
      `${relic.id} 的副槽效果和主槽一字不差——副槽是打折，不是复制`);
    assert.ok(TIER_BY_ID.has(relic.tier), `${relic.id} 的品阶 ${relic.tier} 不在阶梯上`);
    assert.ok(relic.chapter >= 1, `${relic.id} 的章节号必须是正数`);
  }
});

test('五阶齐备，件数相加等于总数', () => {
  const counts = tierCounts();
  assert.equal(RELIC_TIERS.length, 5, '阶梯应该是五阶');
  assert.deepEqual(RELIC_TIERS.map(tier => tier.id), ['shard', 'relic', 'treasure', 'arcanum', 'echo']);
  const sum = RELIC_TIERS.reduce((total, tier) => total + counts[tier.id], 0);
  assert.equal(sum, EXPECTED_TOTAL, '各阶件数相加必须等于总数');
  // 件数不必逐级递减。中段最宽是这个类型的常态，不是错误：杀戮尖塔的遗物也是普通 24 / 罕见 30 /
  // 稀有 21，因为玩法真正发生在中段，那里才需要最多的花样。真正的阶梯是**权重**（见下一条）。
  // 但最稀有的两阶在件数上也必须确实最少，否则「稀有」只体现在概率上，池子里却到处都是。
  const floor = Math.min(...RELIC_TIERS.slice(0, 3).map(tier => counts[tier.id]));
  for (const tier of RELIC_TIERS.slice(3)) {
    assert.ok(counts[tier.id] < floor,
      `${tier.name}(${counts[tier.id]}) 应该少于下面三阶里最少的那一阶(${floor})`);
  }
  for (const tier of RELIC_TIERS) {
    assert.ok(tier.weight > 0, `${tier.id} 的抽取权重必须是正数`);
    assert.match(tier.accent, /^#[0-9a-f]{6}$/i, `${tier.id} 的配色不是十六进制`);
    assert.ok(tier.gloss.length > 0, `${tier.id} 没有一句话说明`);
    assert.equal(relicsOfTier(tier.id).length, counts[tier.id]);
  }
});

test('抽取权重随品阶递减——越稀有越难抽到', () => {
  for (let i = 1; i < RELIC_TIERS.length; i++) {
    assert.ok(RELIC_TIERS[i].weight < RELIC_TIERS[i - 1].weight,
      `${RELIC_TIERS[i].name} 的权重应该低于 ${RELIC_TIERS[i - 1].name}`);
  }
});

test('章节门槛：第一章只放出低阶，高阶留给后面的章节', () => {
  const chapter1 = relicsForChapter(1);
  assert.ok(chapter1.length > 0 && chapter1.length < RELICS.length, '第一章应该是全部的一个真子集');
  for (const relic of chapter1) {
    assert.ok(RANK_OF[relic.tier] <= RANK_OF.treasure,
      `${relic.name} 是 ${relic.tier}，不该在第一章就出现`);
  }
  // 后面的章节只会更多，不会更少
  for (let chapter = 1; chapter <= 4; chapter++) {
    assert.ok(relicsForChapter(chapter + 1).length >= relicsForChapter(chapter).length,
      `第 ${chapter + 1} 章的池子不该比第 ${chapter} 章小`);
  }
  // 最高两阶必须有主：它们是一章存在的理由
  assert.ok(relicsOfTier('arcanum').every(relic => relic.chapter > 1), '秘宝不该在第一章出现');
  assert.ok(relicsOfTier('echo').every(relic => relic.chapter > 1), '绝响不该在第一章出现');
  assert.ok(relicsOfTier('echo').length > 0, '绝响一件都没有，那这一阶就是空的');
});

test('遗物与检索词一一对应，两个方向都要对得上', () => {
  for (const relic of RELICS) {
    const query = RELIC_QUERY[relic.id];
    assert.ok(query, `${relic.id} 没有检索词——这张牌会没有图`);
    assert.ok(query.trim().length >= 3, `${relic.id} 的检索词太短，搜不出东西`);
  }
  const known = new Set(RELICS.map(relic => relic.id));
  for (const id of Object.keys(RELIC_QUERY)) {
    assert.ok(known.has(id), `${id} 有检索词但没有对应的遗物——这是一张没人要的照片`);
  }
  assert.equal(Object.keys(RELIC_QUERY).length, EXPECTED_TOTAL);
});

test('检索词指向物件，不是风景或人像', () => {
  // 这条挡不住所有风景照——没有任何关键词能——但它挡得住两件真发生过的事：
  // 「随手写个名词就交差」，以及把 `ember-heart` 搜成一张人举着相机的照片。
  const banned = /\b(landscape|scenery|sunset|sunrise|mountain range|portrait|woman|man|person|people|crowd|hands? holding)\b/;
  // 每条都得说明**怎么拍**：微距、静物、深色背景，或者放在哪里。词汇表放宽到几种写法都认，
  // 因为它要拦的是「没有取景说明」，不是「没用我偏爱的那个词」。
  const framing = /\b(macro|still life|close ?up|object|dark|table|background|rustic|hanging|lit|glowing|on fire)\b/;
  for (const [id, query] of Object.entries(RELIC_QUERY)) {
    assert.match(query, framing, `${id} 的检索词没有说明怎么拍：「${query}」`);
    assert.doesNotMatch(query, banned, `${id} 的检索词会搜到风景或人像：「${query}」`);
  }
});
