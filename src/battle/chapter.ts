import { CARDS, CARD_BY_ID, MAIN_SHARE, RESOURCES, TIER_BY_ID, type DeckId } from '../cards/index.ts';
import { isEarned } from './cardUnlocks.ts';

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
  /**
   * Three decks, and the third one is what makes the cycle a cycle.
   *
   * The library's four decks form a ring — 刃 攒余烬 → 焰 烧成灼烧 → 骨 把灼烧变成壁垒 → 镜 复制 → 回刃 —
   * and chapter I carried only the first and the third of them. **Both decks in a chapter-I run were
   * missing the two links between them**, so 「联动」 was a thing the card text promised and the deck
   * list made impossible; the only real traffic was 余烬, which 焰 is the deck that spends it.
   *
   * 燎原余烬 also brings the damage. 断罪之刃 opened with six attack cards out of twenty-two and
   * 长明壁垒 with three, which is the 「拿到手里没得打」 half of the same complaint — the burn deck is
   * the one that always has something to cast.
   */
  decks: ['blade', 'flame', 'bone'],
  // This used to name 三叠 and 垒壁, which were already in `unlocked` above — the promise was empty
  // from the day it was written. It now names the明焰阶 cards that are genuinely still locked.
  // 18 ids, spelled out. It is long, and it is the one place the player can read what beating the boss
  // is worth — a summary ("六张副牌组") would be shorter and would not be a promise anyone could check.
  nextUnlock: '击破「草原守望者」后，三副牌组各解锁六张 —— '
    + '断罪之刃 断罪 / 刃雨 / 裂甲 / 借焰 / 万刃 / 千刃，'
    + '燎原余烬 灰烬雨 / 透骨 / 火墙 / 长明灯 / 焚炉 / 骨炭，'
    + '长明壁垒 回震 / 照壁 / 炭墙 / 封炉 / 崩城 / 天倾',
  unlocked: {
    // The burn archetype, and the middle of the ring. 残烬 come in threes, so seven of these carry
    // the deck's damage: 火种 lights the fire, 舔焰 and 裂焰 cash it in, 引信 is a free swing.
    // 扬灰 and 炭衣 are the two links — 余烬 in, 壁垒 out — and they are why this deck is worth
    // splashing into either of the other two.
    flame: ['flame-01', 'flame-02', 'flame-03', 'flame-04', 'flame-05', 'flame-06', 'flame-07',
      'flame-08', 'flame-09', 'flame-12', 'flame-14', 'flame-15',
      // The four holes that cannot wait for the boss: 拾灰 / 取暖 are the only 回血 the deck has and
      // it pays for three of its own cards in 生命, 燎原 is its only affordable AOE, and 添薪 is a
      // straightforward place to put 余烬. A reward is the wrong shape for a card the deck cannot
      // function without.
      'flame-29', 'flame-30', 'flame-32', 'flame-37'],
    // Attack and tempo. Teaches 余烬 (build a resource), 烙印 (make one target die faster),
    // 反震 (punish being hit), 蓄火 (plan a turn ahead).
    blade: ['blade-01', 'blade-02', 'blade-03', 'blade-04', 'blade-07', 'blade-08', 'blade-09', 'blade-11', 'blade-14', 'blade-18', 'blade-21', 'blade-25'],
    // Defence that turns into offence. Teaches 壁垒 (block that stays), 格挡转伤害, 拾回 (get a card
    // back), 连缀 (play in the right order).
    //
    // `bone-05` 砺石 and `bone-09` 殉道 are the deck's *only* zero-cost cards, and leaving them out
    // made 长明壁垒 the one deck where every single card costs at least 1: three energy bought exactly
    // three cards every turn, with no slack, so a five-card hand always stranded two of them and
    // 连缀 (three cards in a turn) sat exactly on the boundary. 断罪之刃 meanwhile carries nine
    // zero-cost cards and never felt the squeeze. Reinstating them is what makes the two decks
    // comparable; the 引火 discount in `engine.ts` does the rest.
    bone: ['bone-01', 'bone-02', 'bone-03', 'bone-04', 'bone-05', 'bone-06', 'bone-07', 'bone-08', 'bone-09', 'bone-11', 'bone-13', 'bone-14', 'bone-18', 'bone-20'],
  },
};

/**
 * What each deck splashes into, and how the opening screen describes the pair.
 *
 * ⚠️ **The opening screen is built from this and `CHAPTER_1.decks`, not from a written-out list.**
 * It used to be a two-entry array in `BattleDemo.tsx`, and adding 燎原余烬 to the chapter changed
 * nothing a player could see — the deck was legal in every save and absent from the only screen that
 * offers one. Deriving it here means a deck added to `decks` cannot silently miss being offered, and
 * `run.test.ts` holds the two lists against each other so it stays that way.
 */
export const SPLASH_INTO: Record<string, { sub: DeckId; blurb: string }> = {
  blade: { sub: 'flame', blurb: '以断罪之刃为主：低费多段攻击堆余烬，燎原余烬再把它一次烧成灼烧。' },
  flame: { sub: 'bone', blurb: '以燎原余烬为主：先铺灼烧让敌人自己烂掉，长明壁垒把烧过的东西接成墙。' },
  bone: { sub: 'blade', blurb: '以长明壁垒为主：把格挡当燃料磨死对手，断罪之刃只掺几张余烬牌做引信。' },
};

/** The pairs the chapter offers, one per deck it hands out. */
export function openingForms(): { main: DeckId; sub: DeckId; blurb: string }[] {
  return CHAPTER_1.decks
    .filter(id => SPLASH_INTO[id])
    .map(id => ({ main: id, sub: SPLASH_INTO[id].sub, blurb: SPLASH_INTO[id].blurb }));
}

const UNLOCKED = new Set(Object.values(CHAPTER_1.unlocked).flat());

/**
 * A card the protagonist cannot draw yet. The library still shows it, greyed, with a padlock.
 *
 * Two ways to be unlocked, and the second one is what `nextUnlock` has been promising all along:
 * the starting pool, or the 明焰阶 set that 击破草原守望者 hands over. The earned half is
 * meta-progression (`cardUnlocks.ts`), so it survives the run that earned it — that is the point of
 * putting a boss behind it.
 *
 * Note what this does *not* change: `starterDeck` still reads `CHAPTER_1.unlocked` directly, so an
 * unlock widens what you can be **offered** and never what you begin with.
 */
export function isUnlocked(cardId: string) {
  return UNLOCKED.has(cardId) || isEarned(cardId);
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

/**
 * The 主/副 composition. `MAIN_SHARE` of what a battle draws should come from the main deck, and
 * because the engine shuffles one physical pile, that share has to be built into the deck rather
 * than rolled once per draw — the two are statistically the same, and only the first needs no engine
 * change. So the main deck is carried whole and the sub deck contributes a thin splash: one copy
 * each of a handful of its cards, which lands the pile at roughly four main cards to every sub card.
 *
 * The splash is ordered signature-first, so what the second deck actually adds is *options* rather
 * than bulk. That is the whole point of it: the sub deck is how a build answers a problem its main
 * deck cannot.
 */
export function chapterDeck(main: DeckId, sub?: DeckId): string[] {
  const base = starterDeck(main);
  if (!sub || sub === main) return base;
  return [...base, ...splashCards(sub, base.length)];
}

/**
 * How many sub cards it takes for the sub deck to be as close to `1 - MAIN_SHARE` of the finished
 * pile as a whole number of cards allows. Asked as "which share is nearest" rather than solved
 * arithmetically, because `1 - MAIN_SHARE` is 0.19999999999999996 in floating point and the direct
 * division silently rounds a 22-card main deck down to a 18.5% splash.
 */
function splashSize(mainSize: number, available: number): number {
  const target = 1 - MAIN_SHARE;
  let wanted = 1;
  let closest = Infinity;
  for (let sub = 1; sub <= available; sub++) {
    const error = Math.abs(sub / (mainSize + sub) - target);
    if (error < closest) { closest = error; wanted = sub; }
  }
  return wanted;
}

/** The sub deck's contribution: its signature cards first, then filler, one copy each. */
function splashCards(sub: DeckId, mainSize: number): string[] {
  // One copy each, in the deck's own stable order — the splash is variety, not volume.
  const distinct = [...new Set(starterDeck(sub))];
  // A deck can own more than one resource (长明壁垒 owns both 锋锐 and 壁垒), so this is the set,
  // not a single id.
  const owned = new Set(RESOURCES.filter(resource => resource.owner === sub).map(resource => resource.id));
  const signature = distinct.filter(id => CARD_BY_ID.get(id)!.keywords.some(keyword => owned.has(keyword)));
  const rest = distinct.filter(id => !signature.includes(id));
  return [...signature, ...rest].slice(0, splashSize(mainSize, distinct.length));
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
