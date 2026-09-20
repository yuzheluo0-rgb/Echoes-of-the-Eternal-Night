import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, CARD_BY_ID, DECKS, DECK_BY_ID, DECK_IDS, KEYWORD_BY_ID, KEYWORDS, MAIN_SHARE, PATTERN_LABEL, RESOURCES, TIERS, drawSource, tierCounts, type DeckId } from './index.ts';
import type { PatternId } from './index.ts';
import { CARD_QUERY } from './art.ts';

const BY_NAME = new Map(KEYWORDS.map(keyword => [keyword.name, keyword.id]));

test('every card id and name is unique across all four decks', () => {
  assert.equal(CARD_BY_ID.size, CARDS.length, 'card ids must be unique');
  const names = new Map<string, string>();
  for (const card of CARDS) {
    assert.ok(!names.has(card.name), `${card.id} and ${names.get(card.name)} are both called ${card.name}`);
    names.set(card.name, card.id);
  }
});

test('every deck carries well over the thirty-seven cards it was briefed for', () => {
  for (const deck of DECKS) {
    assert.ok(deck.size >= 37, `${deck.id} carries only ${deck.size}`);
    assert.equal(deck.size, deck.cards.reduce((sum, entry) => sum + entry.copies, 0), `${deck.id}'s size disagrees with its entries`);
    for (const entry of deck.cards) {
      assert.ok(CARD_BY_ID.has(entry.id), `${deck.id} carries ${entry.id}, which does not exist`);
      assert.ok(entry.copies >= 1 && Number.isInteger(entry.copies));
    }
    assert.ok(deck.cards.length >= 30, `${deck.id} has only ${deck.cards.length} distinct cards`);
  }
});

test('a card belongs to exactly one deck, and its bridges point somewhere else', () => {
  for (const card of CARDS) {
    assert.ok(card.deck === 'neutral' || DECK_IDS.includes(card.deck), `${card.id} names deck ${card.deck}`);
    if (card.bridge) {
      assert.ok(DECK_IDS.includes(card.bridge), `${card.id} bridges to ${card.bridge}`);
      assert.notEqual(card.bridge, card.deck, `${card.id} bridges to its own deck`);
    }
    assert.ok(Number.isInteger(card.cost) && card.cost >= -1 && card.cost <= 3, `${card.id} costs ${card.cost}`);
    assert.ok(card.name.length >= 2 && card.name.length <= 4, `${card.id} is named ${card.name}`);
    assert.ok(card.lore.length >= 8, `${card.id} has no flavour text`);
    assert.ok(card.pattern in PATTERN_LABEL, `${card.id} has pattern ${card.pattern}, which is not in the vocabulary`);
  }
});

test('a card that names a mechanic in its text actually declares it, and vice versa', () => {
  const trouble: string[] = [];
  for (const card of CARDS) {
    for (const id of card.keywords) assert.ok(KEYWORD_BY_ID.has(id), `${card.id} tags unknown keyword ${id}`);
    for (const [name, id] of BY_NAME) {
      if (card.text.includes(name) !== card.keywords.includes(id)) trouble.push(`${card.id} ${card.name}: "${name}" appears=${card.text.includes(name)} tagged=${card.keywords.includes(id)}`);
    }
  }
  assert.deepEqual(trouble, [], 'rules text and the keyword tag have to agree');
});

/**
 * The brief for this pass was that the cards should not feel like each other. These three tests are
 * what "not like each other" means in a form a machine can check: a spread of mechanical shapes, no
 * shape over-used, and no two cards whose rules text is the same sentence with a different number.
 */
test('no deck is built out of one shape repeated', () => {
  for (const deck of DECKS) {
    const own = CARDS.filter(card => card.deck === deck.id);
    const counts = new Map<PatternId, string[]>();
    for (const card of own) counts.set(card.pattern, [...(counts.get(card.pattern) ?? []), card.name]);
    for (const [pattern, users] of counts) {
      assert.ok(users.length <= 3, `${deck.id} uses ${PATTERN_LABEL[pattern]} ${users.length} times: ${users.join('、')}`);
    }
    assert.ok(counts.size >= 14, `${deck.id} only spreads across ${counts.size} shapes`);
    // And the deck as carried, neutral cards included, has to stay varied too.
    const carried = new Set(deck.cards.map(entry => CARD_BY_ID.get(entry.id)!.pattern));
    assert.ok(carried.size >= 16, `${deck.id} carries only ${carried.size} distinct shapes`);
  }
});

test('no two cards in a deck are the same sentence with a different number', () => {
  // Strip every digit and the names of the deck's own mechanics, and what is left is the shape of
  // the sentence. Two cards sharing one is exactly the failure this pass was meant to fix.
  const skeleton = (text: string) => text.replace(/[0-9]+/g, 'N').replace(/[，。；、·]/g, '');
  for (const deck of DECKS) {
    const seen = new Map<string, string>();
    for (const card of CARDS.filter(item => item.deck === deck.id)) {
      const key = skeleton(card.text);
      assert.ok(!seen.has(key), `${card.name} and ${seen.get(key)} are the same sentence: ${card.text}`);
      seen.set(key, card.name);
    }
  }
});

test('a deck both produces its own resources and reaches into someone else\'s', () => {
  // Five resources over four decks, so one deck produces two: 骨 is the slow engine and makes both
  // 壁垒 and 锋锐, while 刃 is the one that spends the edge it never generates. What matters is that
  // no resource is orphaned and no deck is an island.
  for (const resource of RESOURCES) assert.ok(resource.owner, `${resource.name} belongs to nobody`);
  const owners = new Map<DeckId, number>();
  for (const resource of RESOURCES) owners.set(resource.owner!, (owners.get(resource.owner!) ?? 0) + 1);
  for (const deck of DECKS) assert.ok((owners.get(deck.id) ?? 0) >= 1, `${deck.id} produces no resource at all`);

  for (const deck of DECKS) {
    const cards = deck.cards.map(entry => CARD_BY_ID.get(entry.id)!);
    const mine = cards.filter(card => card.keywords.some(id => KEYWORD_BY_ID.get(id)!.owner === deck.id));
    assert.ok(mine.length >= 4, `${deck.id} only has ${mine.length} cards using its own resources`);
    // Borrowing is counted on resources only — a universal mechanic is nobody's, so it proves nothing.
    const borrowed = cards.filter(card => card.keywords.some(id => KEYWORD_BY_ID.get(id)!.owner && KEYWORD_BY_ID.get(id)!.owner !== deck.id));
    assert.ok(borrowed.length >= 4, `${deck.id} borrows only ${borrowed.length} cards' worth of other decks' resources`);
  }
});

test('the universal mechanics are actually used, not just declared', () => {
  const mechanics = KEYWORDS.filter(keyword => keyword.kind === 'mechanic');
  for (const keyword of mechanics) {
    const users = CARDS.filter(card => card.keywords.includes(keyword.id));
    assert.ok(users.length >= 2, `${keyword.name} is declared but only ${users.length} card(s) use it`);
  }
  // Every deck has to reach outside its own two resources, or the palette is decoration.
  for (const deck of DECKS) {
    const cards = CARDS.filter(card => card.deck === deck.id);
    const universal = cards.filter(card => card.keywords.some(id => KEYWORD_BY_ID.get(id)!.kind === 'mechanic'));
    assert.ok(universal.length >= 10, `${deck.id} only uses universal mechanics on ${universal.length} cards`);
  }
});

/**
 * The rest of what "interesting" means, taken from how the games this one is descended from are
 * built. Slay the Spire's designers state their goal as "no useless cards"; Magic's R&D lesson is
 * that being boring is a bigger risk than being extravagant, and that a card nobody dislikes is a
 * card nobody loves. Two things follow that a test can hold:
 *
 *  - A card that turns one resource into another is the richest kind there is — that is what makes
 *    a deck an engine instead of a pile — so every deck needs several.
 *  - A deck of bare numbers is a deck with one card in it. Pure stat cards are allowed only as the
 *    handful of basics a starting hand needs.
 */
test('every deck is an engine, not a pile of numbers', () => {
  const CONVERSIONS = new Set(['resource-convert', 'block-convert', 'dot-convert', 'resource-spend', 'sacrifice']);
  const ANCHORS = new Set(['ramp', 'finisher', 'copy', 'upgrade', 'retaliate']);
  const bare = (card: { keywords: unknown[]; text: string }) => card.keywords.length === 0 && !/[若每消耗转换或]/.test(card.text);
  for (const deck of DECKS) {
    const cards = CARDS.filter(card => card.deck === deck.id);
    const conversions = cards.filter(card => CONVERSIONS.has(card.pattern));
    assert.ok(conversions.length >= 3, `${deck.id} only converts resources on ${conversions.length} cards`);
    const anchors = cards.filter(card => ANCHORS.has(card.pattern));
    assert.ok(anchors.length >= 2, `${deck.id} has ${anchors.length} cards worth building a deck around`);
    const plain = cards.filter(bare);
    assert.ok(plain.length <= 4, `${deck.id} has ${plain.length} bare-number cards: ${plain.map(c => c.name).join('、')}`);
  }
  // And across the whole set, the basics are the only place a bare number is allowed at all.
  assert.ok(CARDS.filter(bare).length <= 8, 'too much of the set is bare numbers');
});

test('the drop table is a real distribution', () => {
  assert.equal(TIERS.reduce((sum, tier) => sum + tier.weight, 0), 100, 'tier weights must sum to 100');
  for (let i = 1; i < TIERS.length; i++) assert.ok(TIERS[i].weight < TIERS[i - 1].weight, `${TIERS[i].name} is not rarer than ${TIERS[i - 1].name}`);
  for (const card of CARDS) assert.ok(TIERS.some(tier => tier.id === card.tier), `${card.id} has tier ${card.tier}`);
  for (const tier of TIERS) assert.ok(CARDS.some(card => card.tier === tier.id), `no card is ${tier.name}`);
});

test('a draw comes from the main deck most of the time, and always from one of the two', () => {
  const battle = { main: 'blade', sub: 'bone' } as const;
  let main = 0;
  for (let step = 0; step < 1000; step++) {
    const source = drawSource(battle, step / 1000);
    assert.ok(source === 'blade' || source === 'bone');
    if (source === 'blade') main++;
  }
  assert.equal(main, Math.round(MAIN_SHARE * 1000));
  assert.ok(MAIN_SHARE > .5 && MAIN_SHARE < 1, 'the main deck has to be the majority, but not all of it');
});

test('the tier mix per deck matches the structure it was authored to', () => {
  for (const deck of DECKS) {
    const counts = tierCounts(deck.id);
    assert.equal(Object.values(counts).reduce((sum, n) => sum + n, 0), deck.size, `${deck.id}'s tier tally disagrees with its size`);
    assert.equal(DECK_BY_ID.get(deck.id)!.name, deck.name);
    assert.ok(counts.starfall >= 1, `${deck.id} carries no 星陨 card`);
  }
});

test('every card has artwork briefed', () => {
  for (const card of CARDS) assert.ok(CARD_QUERY[card.id]?.length, `${card.id} has no art query`);
});
