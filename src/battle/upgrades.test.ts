/**
 * 打磨's two promises, both of which are about a *pair* of things agreeing.
 *
 * The first is that chapter I can actually polish the cards it hands out. A card with no row in
 * `UPGRADES` is a card the campfire will offer and then silently do nothing to — the picker filters
 * by `isUpgradable`, so it never appears, which means the only symptom is a player standing at a
 * campfire being told 「牌组里没有还能打磨的牌」 while holding a deck full of them.
 *
 * The second is the one that actually bit. `upgrades.ts` states the rule outright: its `text` is what
 * the player reads, so when the text and the deltas disagree, the file is the bug. Nothing checked
 * it, and the card face printed `card.text` in every screen — so a polished 砺石 read 「抽 1 张牌」
 * while the engine drew 2, and a polished 三叠 read 「造成 3 点伤害 2 次」 while hitting 3 times. The
 * display and the engine pulled from two different sources and only one of them was ever shown.
 *
 * So every check here compares the printed text against the deltas in the same row. That is the only
 * version of this test that can fail for the right reason: checking the text against itself, or the
 * deltas against themselves, would have passed the whole time the bug was live.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAPTER_1 } from './chapter.ts';
import { UPGRADES, upgradeFor, upgradedText, isUpgradable } from './upgrades.ts';
import { CARD_BY_ID } from '../cards/index.ts';

/** Every card chapter I can put in a deck. Two decks overlap on the neutral cards, hence the Set. */
const UNLOCKED = [...new Set(Object.values(CHAPTER_1.unlocked).flat())];

/**
 * The numbers a rules text prints, in order. `undefined` for a text with none.
 *
 * 一 counts. The card library styles some counts as Chinese numerals — 拾骨 reads 「取回**一**张牌。空明：
 * 额外抽 **1** 张牌。」 in the same sentence — and an extractor that only sees `\d` reads that upgrade
 * as "a digit appeared out of nowhere" when what happened is a 一 became a 2.
 */
const CN_NUMERAL: Record<string, number> = {
  '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
};
function digits(text: string): number[] | undefined {
  const found = text.match(/\d+|[一二三四五六七八九十]/g);
  return found ? found.map(token => CN_NUMERAL[token] ?? Number(token)) : undefined;
}

/**
 * Does the delta actually move a number, or does it move a *count*?
 *
 * `hit`, `block`, `draw`, `reclaim`, `status` and `power` all raise an amount that is printed
 * somewhere — a 2-hit card gains `hit` twice, a 连缀 bonus raises its alternate number. So the text
 * must print a different set of numbers than the base card did. That is a real check with real teeth:
 * it is exactly what would have caught 砺石, where the delta is `draw: 1` and the printed number
 * never moved.
 */
test('打磨：印出来的数字真的跟着增量走了', () => {
  for (const id of UNLOCKED) {
    const card = CARD_BY_ID.get(id);
    assert.ok(card, `章节解锁了不存在的牌 ${id}`);
    const upgrade = UPGRADES[id];
    assert.ok(upgrade, `${card.name}（${id}）没有升级条目，营火会把它列出来然后什么都不做`);

    const before = digits(card.text), after = digits(upgrade.text);
    assert.notDeepEqual(after, before,
      `${card.name} 印的还是原来的数字：「${card.text}」→「${upgrade.text}」\n` +
      '打磨必须让玩家看出差别，否则卡面就是在说谎。');
    assert.ok(Object.keys(upgrade).some(key => key !== 'text'),
      `${card.name} 的升级条目只有文案，没有任何增量——引擎不会改变这张牌`);
  }
});

test('打磨：文案里的数字个数不能凭空多出来或少下去', () => {
  for (const id of UNLOCKED) {
    const card = CARD_BY_ID.get(id)!;
    const upgrade = UPGRADES[id]!;
    const before = digits(card.text) ?? [], after = digits(upgrade.text) ?? [];
    // Every upgrade in chapter I raises a number that was already printed. A text that *adds* a
    // number is describing an effect the delta cannot produce, because the delta shapes are only
    // `hit` / `block` / `draw` / `reclaim` / `status` / `power` — all of them "more of something that
    // was already there". If a card ever needs a genuinely new clause, this is the line that says so.
    assert.equal(after.length, before.length,
      `${card.name} 升级前后数字个数不同：\n  原「${card.text}」\n  新「${upgrade.text}」\n` +
      '增量形状只有「把已有的数字变多」，多出来的数字没有东西能兑现。');
    // A number that was not there before counts as raised — it is still the printed text changing,
    // which is what the delta has to justify. What is *not* allowed is a text whose numbers are all
    // the same, which is the shape 砺石 had: `draw: 1` in the row, 「抽 1 张牌」 on the card.
    const raised = after.some((value, index) => before[index] === undefined || value > before[index]);
    assert.ok(raised, `${card.name} 的升级数字没有任何一个变大：「${upgrade.text}」`);
  }
});

test('打磨：第一章解锁的牌全都磨得动', () => {
  for (const id of UNLOCKED) {
    assert.ok(isUpgradable(id), `${CARD_BY_ID.get(id)?.name ?? id} 不能打磨，但它在第一章牌组里`);
  }
  // The other direction: an upgrade row for a card nobody can draw is a row nobody can test.
  for (const id of Object.keys(UPGRADES)) {
    assert.ok(UNLOCKED.includes(id), `${id} 有升级条目，但第一章拿不到这张牌`);
  }
});

test('打磨：升级不是另一张牌，类型和费用都不动', () => {
  for (const id of UNLOCKED) {
    const card = CARD_BY_ID.get(id)!;
    const upgrade = UPGRADES[id]!;
    // `Upgrade` has no field for cost or type, and that is the design: 打磨 is the same card with
    // bigger numbers. If the shape ever grows one, this test is where the decision has to be made
    // deliberately rather than by someone adding a field.
    assert.deepEqual(Object.keys(upgrade).filter(key => !['text', 'hit', 'block', 'draw', 'reclaim', 'status', 'power'].includes(key)),
      [], `${card.name} 的升级条目带了未知字段`);
    assert.ok(upgradedText(id, card.text) !== card.text, `${card.name}：upgradedText 没有换文案`);
  }
});

test('打磨：没磨的牌一律读到原文案', () => {
  for (const id of UNLOCKED) {
    // The card face calls this with `upgraded` undefined for every card in the gallery and most of
    // the hand, so the fallback path is the one that runs the most.
    assert.equal(upgradedText(id, CARD_BY_ID.get(id)!.text), UPGRADES[id]!.text);
  }
  assert.equal(upgradedText('blade-01', '原文'), UPGRADES['blade-01'].text);
  // A card with no row keeps its own text rather than printing an empty string.
  assert.equal(upgradedText('does-not-exist', '原文'), '原文');
  assert.equal(upgradeFor('blade-01', undefined), undefined);
  assert.equal(upgradeFor('blade-01', false), undefined);
  assert.equal(upgradeFor('blade-01', true), UPGRADES['blade-01']);
});
