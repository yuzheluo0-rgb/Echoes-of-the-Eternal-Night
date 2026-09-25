/**
 * Which cards a chapter can put in front of you, and what widens that pool.
 *
 * **Meta-progression, exactly like `src/relics/unlocks.ts` and for the same reason.** `CHAPTER_1.nextUnlock`
 * has promised a boss unlock since the chapter was written, and for most of that time nothing
 * implemented it: the promise was a string, the pools never moved, and the cards it named had no
 * effects either. This is the half that makes the sentence true.
 *
 * What an unlock widens is the **reward** pool — these are cards you can now be *offered*, not cards
 * that appear in your opening hand. A chapter that quietly grew your starting deck because of a boss
 * killed in some previous run would be changing the fight you already know how to read. `starterDeck`
 * therefore stays on the starting pool and never moves.
 */

import { CARD_BY_ID, DECKS, type DeckId } from '../cards/index.ts';

/**
 * What 击破草原守望者 hands over, per deck: six cards each.
 *
 * Every deck in the chapter gets the same number, and that is the design rather than a rounding.
 * A boss unlock that favoured one deck would make the reward a reason to have picked that deck a
 * chapter ago; what it should be is a reason to start *another* run, whichever one you took.
 *
 * The first four of each are that deck's missing 明焰阶 (half of every deck's 明焰阶 sits in the
 * starting pool, half behind the boss — which is where the tier's name comes from). The last two
 * reach into 长明阶, and they are chosen for being *shapes* rather than sizes: 万刃 grows with the
 * turn, 千刃 spends 锋锐 for hits, 崩城 grows with the wall, 天倾 throws the whole wall at once,
 * 长明灯 changes every burn afterwards, 骨炭 turns the fire into a second resource.
 */
export const BOSS_UNLOCKS: Record<string, string[]> = {
  blade: ['blade-16', 'blade-17', 'blade-19', 'blade-20', 'blade-22', 'blade-28'],
  // **Fourteen, not six, and the number is derived rather than chosen.** Half of every other deck's
  // 明焰阶 already sits in its starting pool; 燎原余烬's starting pool contains *none* of its own, so
  // the boss is the only place its archetype can arrive from — and six cards is not enough of a
  // 灼烧/引爆 package to build around. `cardUnlocks.test.ts` states the rule in exactly those terms,
  // so a future deck that starts with none of its 明焰阶 gets the same treatment automatically.
  flame: ['flame-16', 'flame-19', 'flame-21', 'flame-22', 'flame-24', 'flame-25',
    'flame-31', 'flame-33', 'flame-34', 'flame-35', 'flame-36', 'flame-38', 'flame-39', 'flame-40'],
  bone: ['bone-16', 'bone-17', 'bone-19', 'bone-21', 'bone-23', 'bone-27'],
};

/** Every id this module can ever hand over, whichever deck it belongs to. */
export const BOSS_IDS: string[] = Object.values(BOSS_UNLOCKS).flat();

/** Which victory hands them over. The boss, and only the boss. */
const UNLOCK_BY_ENCOUNTER: Record<string, string[]> = { 'ch1-5': BOSS_IDS };

export interface CardProgress {
  version: 1;
  unlocked: string[];
  /** Encounters already paid out, so a second kill of the same fight unlocks nothing. */
  credited: string[];
}

export function emptyProgress(): CardProgress {
  return { version: 1, unlocked: [], credited: [] };
}

/** The card ids a given victory hands over. Empty for encounters that hand over nothing. */
export function unlocksFor(encounterId: string): string[] {
  return UNLOCK_BY_ENCOUNTER[encounterId] ?? [];
}

/**
 * The unlocked cards, **grouped by deck in the chapter's own deck order** — what `UnlockScreen` draws.
 *
 * Here rather than inside the screen for the reason `describeEffect` lives in `events.ts`:
 * `node --experimental-strip-types` cannot parse JSX, so a helper written beside its component is a
 * helper no test can reach. This one is worth testing — it decides which six cards are shown as
 * whose, and 「这六张是给我哪副牌的」 is the first question the screen invites.
 *
 * The order comes from `DECKS`, not from the order the ids happen to sit in `BOSS_UNLOCKS`, so the
 * groups appear in the same order as the opening screen's deck list.
 */
export function unlockGroups(cards: string[]): { deck: DeckId; ids: string[] }[] {
  return DECKS
    .map(deck => ({ deck: deck.id, ids: cards.filter(id => CARD_BY_ID.get(id)?.deck === deck.id) }))
    .filter(group => group.ids.length > 0);
}

/**
 * Credit a victory. Idempotent per encounter, so a repeated kill cannot farm the same cards twice —
 * and a repeat is a real possibility, because the tower deals its fights from pools.
 *
 * ⚠️ **An encounter that pays out nothing is not recorded as credited.** It is tempting to log the
 * visit anyway, and it is a trap: `isValidProgress` only accepts ids that can pay out, so a
 * `credited` list carrying 「ch1-1」 would make the whole progress file invalid and throw away the
 * unlocks on the next load — the same shape of bug as a save the validator refuses, which is exactly
 * what this weekend's `cleared` fix was about. It also keeps this a no-op for the dozen ordinary
 * wins a run has, which is what lets `creditAndSave` skip the write.
 */
export function creditProgress(progress: CardProgress, encounterId: string): CardProgress {
  if (progress.credited.includes(encounterId)) return progress;
  const gained = unlocksFor(encounterId);
  if (!gained.length) return progress;
  return {
    ...progress,
    unlocked: [...new Set([...progress.unlocked, ...gained])],
    credited: [...progress.credited, encounterId],
  };
}

/**
 * The earned ids, memoised for the render path.
 *
 * `isUnlocked` is asked once per card per render — the library draws all 32 faces of a deck and each
 * one asks — so reading and parsing localStorage inside it would be thirty-odd JSON parses a frame.
 * The cache is dropped by every write, which is the only way the value can change.
 */
let cached: string[] | null = null;

export function earnedCards(): readonly string[] {
  if (!cached) cached = loadProgress().unlocked;
  return cached;
}

/**
 * Credit and persist in one step, and drop the memo so the same tick sees the new cards.
 *
 * Writes only when something actually moved — this is called on **every** victory, and a run wins a
 * dozen fights, so an unconditional write would be a dozen localStorage writes per run that say the
 * same thing.
 */
export function creditAndSave(encounterId: string): CardProgress {
  const before = loadProgress();
  const next = creditProgress(before, encounterId);
  if (next !== before) {
    saveProgress(next);
    cached = next.unlocked;
  }
  return next;
}

export function isEarned(cardId: string): boolean {
  return BOSS_IDS.includes(cardId) && earnedCards().includes(cardId);
}

// ------------------------------------------------------------------ validation

/**
 * A save claiming a card this chapter cannot hand out is corrupt, and letting it through would put
 * chapter-II content into a chapter-I pool — the same rule the relic progress file follows.
 */
export function isValidProgress(value: unknown): value is CardProgress {
  if (!value || typeof value !== 'object') return false;
  const progress = value as CardProgress;
  if (progress.version !== 1) return false;
  if (!Array.isArray(progress.unlocked) || !Array.isArray(progress.credited)) return false;
  if (!progress.unlocked.every(id => typeof id === 'string')) return false;
  if (!progress.credited.every(id => typeof id === 'string')) return false;
  if (new Set(progress.unlocked).size !== progress.unlocked.length) return false;
  if (new Set(progress.credited).size !== progress.credited.length) return false;
  if (!progress.unlocked.every(id => BOSS_IDS.includes(id))) return false;
  if (!progress.credited.every(id => id in UNLOCK_BY_ENCOUNTER)) return false;
  return true;
}

// ----------------------------------------------------------------- persistence

export const CARD_UNLOCK_KEY = 'eternal-night-card-unlocks-v1';

/** Absent in node, and throwing in a locked-down browser — both just mean "no progress yet". */
function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

export function loadProgress(): CardProgress {
  const store = storage();
  if (!store) return emptyProgress();
  try {
    const raw = store.getItem(CARD_UNLOCK_KEY);
    if (!raw) return emptyProgress();
    const parsed: unknown = JSON.parse(raw);
    return isValidProgress(parsed) ? parsed : emptyProgress();
  } catch {
    return emptyProgress();
  }
}

export function saveProgress(progress: CardProgress) {
  try { storage()?.setItem(CARD_UNLOCK_KEY, JSON.stringify(progress)); } catch { /* Private mode still plays. */ }
}

export function clearProgress() {
  cached = null;
  try { storage()?.removeItem(CARD_UNLOCK_KEY); } catch { /* Fine. */ }
}
