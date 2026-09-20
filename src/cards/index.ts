// Explicit `.ts` specifiers throughout: this module is imported by node's strip-types test runner,
// which does not do extensionless resolution. See the same convention in `worldData.ts`.
import { DECK_BLADE } from './deck-blade.ts';
import { DECK_FLAME } from './deck-flame.ts';
import { DECK_BONE } from './deck-bone.ts';
import { DECK_MIRROR } from './deck-mirror.ts';
import { NEUTRAL } from './neutral.ts';
import type { CardDefinition, Deck, DeckEntry, DeckId, TierId } from './types.ts';

export * from './types.ts';
export { NEUTRAL } from './neutral.ts';

/** Every card that exists, in a stable order: four archetypes, then the neutral pool. */
export const CARDS: CardDefinition[] = [...DECK_BLADE, ...DECK_FLAME, ...DECK_BONE, ...DECK_MIRROR, ...NEUTRAL];
export const CARD_BY_ID = new Map(CARDS.map(card => [card.id, card]));

/** Basics come in threes so a starting hand is never empty of them; everything else is a single. */
const COPIES: Record<TierId, number> = { cinder: 3, glimmer: 1, blaze: 1, everburning: 1, starfall: 1 };

/** Which neutral cards each archetype is allowed to carry. Chosen so every deck can reach at least
 *  one mechanic it does not own — that is where the decks overlap. */
const NEUTRALS: Record<DeckId, string[]> = {
  blade: ['neutral-03', 'neutral-06', 'neutral-08', 'neutral-09'],
  flame: ['neutral-01', 'neutral-07', 'neutral-08', 'neutral-10'],
  bone: ['neutral-02', 'neutral-03', 'neutral-09', 'neutral-08'],
  mirror: ['neutral-05', 'neutral-06', 'neutral-09', 'neutral-10'],
};

const PLATES: Record<DeckId, { name: string; subtitle: string; blurb: string; accent: string }> = {
  blade: { name: '断罪之刃', subtitle: 'THE SEVERING EDGE', accent: '#d8b878', blurb: '低费高频的多段攻击，靠攻击次数堆叠余烬，再一次性把锋锐花出去。攻击牌最多，防御最薄，怕被拖长。' },
  flame: { name: '燎原余烬', subtitle: 'THE SPREADING FIRE', accent: '#e08a52', blurb: '先铺灼烧让敌人自己烂掉，再把攒下的余烬一把烧成爆发。AOE 充足，启动慢，越到后期越难被挡住。' },
  bone: { name: '长明壁垒', subtitle: 'THE EVERBURNING WALL', accent: '#9fc0b4', blurb: '堆格挡与壁垒，把防御本身当武器——反伤、以格挡打伤害、把多余的墙拆下来开刃。最耐打，清场最弱。' },
  mirror: { name: '千面回廊', subtitle: 'THE HALL OF MIRRORS', accent: '#93c6d8', blurb: '用映照把关键牌再打一次，把自己和敌人的资源互相翻转。上限最高、最吃出牌顺序，起手最弱。' },
};

function entriesFor(id: DeckId): DeckEntry[] {
  const own = CARDS.filter(card => card.deck === id).map(card => ({ id: card.id, copies: COPIES[card.tier] }));
  return [...own, ...NEUTRALS[id].map(card => ({ id: card, copies: 1 }))];
}

export const DECKS: Deck[] = (Object.keys(PLATES) as DeckId[]).map(id => {
  const cards = entriesFor(id);
  return { id, ...PLATES[id], size: cards.reduce((sum, entry) => sum + entry.copies, 0), cards };
});
export const DECK_BY_ID = new Map(DECKS.map(deck => [deck.id, deck]));

/** How many cards of each tier a deck carries, copies included. */
export function tierCounts(id: DeckId) {
  const counts = { cinder: 0, glimmer: 0, blaze: 0, everburning: 0, starfall: 0 } as Record<TierId, number>;
  for (const entry of DECK_BY_ID.get(id)!.cards) counts[CARD_BY_ID.get(entry.id)!.tier] += entry.copies;
  return counts;
}

/**
 * A battle carries one main deck and one sub deck. Most draws come from the main one; the sub deck
 * is a thin second stream that lets a build splash a second archetype without diluting the first.
 */
export const MAIN_SHARE = .8;
export interface BattleDeck { main: DeckId; sub: DeckId }

/** `roll` is a number in [0, 1) from the battle's own seeded stream, never `Math.random`. */
export function drawSource(battle: BattleDeck, roll: number): DeckId {
  return roll < MAIN_SHARE ? battle.main : battle.sub;
}

/** A seedless preview of how a battle's draws would split, for the deck panel in the gallery. */
export function drawSplit(battle: BattleDeck, draws = 40) {
  const main = Math.round(draws * MAIN_SHARE);
  void battle;
  return { main, sub: draws - main };
}
