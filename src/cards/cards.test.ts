import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, CARD_BY_ID, DECKS, DECK_BY_ID, DECK_IDS, KEYWORD_BY_ID, MAIN_SHARE, TIERS, drawSource, tierCounts } from './index.ts';
import { CARD_QUERY } from './art.ts';

const KEYWORD_BY_NAME = new Map([...KEYWORD_BY_ID.values()].map(keyword => [keyword.name, keyword.id]));

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
    // The brief asked for at least 37 and the structure is 46; drifting below that means cards were
    // dropped from a deck without anyone noticing.
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
  }
});

test('a card that names a keyword in its text actually declares it, and vice versa', () => {
  // The rules text is the only place a player learns a keyword applies, so the tag and the text
  // have to agree — a card tagged 灼烧 whose text never mentions it is a card nobody will ever play
  // for the reason its designer intended.
  for (const card of CARDS) {
    for (const id of card.keywords) assert.ok(KEYWORD_BY_ID.has(id), `${card.id} tags unknown keyword ${id}`);
    for (const [name, id] of KEYWORD_BY_NAME) {
      const named = card.text.includes(name);
      assert.equal(named, card.keywords.includes(id), `${card.id}: "${name}" appears=${named} but tagged=${card.keywords.includes(id)}`);
    }
  }
});

test('every deck both produces a mechanic and reaches into someone else\'s', () => {
  // This is the whole point of four decks rather than one big card list: each one owns a mechanic
  // and depends on a neighbour's. A deck that stops doing either has quietly become an island.
  for (const deck of DECKS) {
    const own = [...KEYWORD_BY_ID.values()].filter(keyword => keyword.owner === deck.id);
    assert.ok(own.length, `${deck.id} owns no mechanic`);
    const cards = deck.cards.map(entry => CARD_BY_ID.get(entry.id)!);
    for (const keyword of own) {
      assert.ok(cards.some(card => card.keywords.includes(keyword.id)), `${deck.id} never uses its own ${keyword.name}`);
    }
    const borrowed = cards.filter(card => card.keywords.some(id => KEYWORD_BY_ID.get(id)!.owner !== deck.id));
    assert.ok(borrowed.length >= 2, `${deck.id} borrows only ${borrowed.length} cards' worth of other decks' mechanics`);
  }
});

test('the drop table is a real distribution', () => {
  const total = TIERS.reduce((sum, tier) => sum + tier.weight, 0);
  assert.equal(total, 100, 'tier weights must sum to 100 so they read as percentages');
  for (let i = 1; i < TIERS.length; i++) assert.ok(TIERS[i].weight < TIERS[i - 1].weight, `${TIERS[i].name} is not rarer than ${TIERS[i - 1].name}`);
  for (const card of CARDS) assert.ok(TIERS.some(tier => tier.id === card.tier), `${card.id} has tier ${card.tier}`);
  // Every tier has to actually exist in the set, or a weight is advertising cards that were never written.
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

test('every card has artwork briefed, and the deck size tally matches its entries', () => {
  for (const card of CARDS) assert.ok(CARD_QUERY[card.id]?.length, `${card.id} has no art query`);
  for (const deck of DECKS) {
    const counts = tierCounts(deck.id);
    assert.equal(Object.values(counts).reduce((sum, n) => sum + n, 0), deck.size, `${deck.id}'s tier tally disagrees with its size`);
    assert.equal(DECK_BY_ID.get(deck.id)!.name, deck.name);
  }
});
