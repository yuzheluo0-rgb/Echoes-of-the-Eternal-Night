import { CARDS, CARD_BY_ID, TIER_BY_ID, type DeckId } from '../cards/index.ts';

/**
 * Chapter I. The protagonist starts with two decks unlocked and only part of each one — the rest of
 * the cards are visible in the library but locked, and a locked card can never be drawn. This is the
 * chapter's pacing device: the first fights teach four or five mechanics properly instead of dumping
 * twenty on the player at once, and every later unlock is a card you have already read.
 */
export interface Chapter {
  id: string;
  name: string;
  subtitle: string;
  /** The decks the protagonist may carry. */
  decks: DeckId[];
  /** Card ids unlocked per deck. Everything else in that deck is locked. */
  unlocked: Record<string, string[]>;
  /** Shown on the unlock panel, so the player can see what a locked card will become. */
  nextUnlock: string;
}

export const CHAPTER_1: Chapter = {
  id: 'ch1',
  name: '第一章 · 余烬营地',
  subtitle: 'CHAPTER I · THE LAST HEARTH',
  decks: ['blade', 'bone'],
  nextUnlock: '击破「草原守望者」后解锁 断罪之刃 · 三叠 与 长明壁垒 · 垒壁 的进阶牌',
  unlocked: {
    // Attack and tempo. Teaches 余烬 (build a resource), 烙印 (make one target die faster),
    // 反震 (punish being hit), 蓄火 (plan a turn ahead).
    blade: ['blade-01', 'blade-02', 'blade-03', 'blade-04', 'blade-07', 'blade-08', 'blade-09', 'blade-11', 'blade-14', 'blade-18', 'blade-21', 'blade-25'],
    // Defence that turns into offence. Teaches 壁垒 (block that stays), 格挡转伤害, 拾回 (get a card
    // back), 连缀 (play in the right order).
    bone: ['bone-01', 'bone-02', 'bone-03', 'bone-04', 'bone-06', 'bone-07', 'bone-08', 'bone-11', 'bone-13', 'bone-14', 'bone-18', 'bone-20'],
  },
};

const UNLOCKED = new Set(Object.values(CHAPTER_1.unlocked).flat());

/** A card the protagonist cannot draw yet. The library still shows it, greyed, with a padlock. */
export function isUnlocked(cardId: string) {
  return UNLOCKED.has(cardId);
}
export function isDeckUnlocked(deck: string) {
  return CHAPTER_1.decks.includes(deck as DeckId);
}

/** Basics come in threes, as everywhere else — a starting hand that misses them entirely feels broken. */
function copies(cardId: string) {
  const tier = CARD_BY_ID.get(cardId)!.tier;
  return tier === 'cinder' ? 3 : 1;
}

/** The card ids (with duplicates) a chapter-I player actually shuffles up, in a stable order. */
export function starterDeck(deck: DeckId): string[] {
  const pool = CHAPTER_1.unlocked[deck] ?? [];
  return pool.flatMap(id => Array.from({ length: copies(id) }, () => id));
}

export interface ChapterDeckView {
  deck: DeckId;
  unlockedCount: number;
  lockedCount: number;
  size: number;
  cards: { id: string; name: string; tier: string; unlocked: boolean }[];
}

export function deckView(deck: DeckId): ChapterDeckView {
  const cards = CARDS.filter(card => card.deck === deck).map(card => ({
    id: card.id, name: card.name, tier: TIER_BY_ID.get(card.tier)!.name, unlocked: isUnlocked(card.id),
  }));
  const size = starterDeck(deck).length;
  return { deck, unlockedCount: cards.filter(c => c.unlocked).length, lockedCount: cards.filter(c => !c.unlocked).length, size, cards };
}
