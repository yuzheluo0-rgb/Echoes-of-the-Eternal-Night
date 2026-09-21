/**
 * Which relics a run can be offered, and what widens that pool.
 *
 * This is **meta-progression**, not run state, which is why it lives here and not on `ChapterRun`:
 * the point of it is that beating 草甸上的头狼 in one run means the *next* run opens with a better
 * pool. Putting it in the run would reset it every time, which is the opposite of what it is for.
 *
 * The shape mirrors `src/battle/chapter.ts`: chapter I starts with the bottom two rungs of the ladder
 * and the rest arrive as you prove you can use them. Chapter I begins at 36 and finishes at 52.
 */

import { RELICS, RELIC_TIERS, RANK_OF, type RelicDefinition, type RelicTier } from './relics.ts';

/** The rungs chapter I opens with. Everything above these has to be earned. */
const STARTING_TIERS: RelicTier[] = ['shard', 'relic'];

/**
 * What a victory hands over, by encounter. A run's pool therefore grows *during* the run — the last
 * draw of chapter I is made from a noticeably better pile than the first, which is the whole point.
 */
const UNLOCK_BY_ENCOUNTER: Record<string, RelicTier[]> = {
  'ch1-4': ['treasure'],
};

export interface RelicProgress {
  version: 1;
  /** Relic ids unlocked on top of the starting set. */
  unlocked: string[];
  /** Encounters already paid out, so a repeated kill cannot farm the same relics twice. */
  credited: string[];
}

export function emptyProgress(): RelicProgress {
  return { version: 1, unlocked: [], credited: [] };
}

/** 残片 + 旧物 — the 36 relics chapter I opens with. */
export function startingRelics(): RelicDefinition[] {
  return RELICS.filter(relic => STARTING_TIERS.includes(relic.tier));
}

export function isStarting(relic: RelicDefinition): boolean {
  return STARTING_TIERS.includes(relic.tier);
}

/** Which relics a given victory unlocks. Empty for encounters that hand over nothing. */
export function unlocksFor(encounterId: string): RelicDefinition[] {
  const tiers = UNLOCK_BY_ENCOUNTER[encounterId];
  if (!tiers) return [];
  return RELICS.filter(relic => tiers.includes(relic.tier));
}

/**
 * Credit a victory. Idempotent per encounter — a second kill of the same fight unlocks nothing,
 * because `credited` remembers. Returns the same object when there is nothing to do, so callers can
 * cheaply skip a save.
 */
export function creditProgress(progress: RelicProgress, encounterId: string): RelicProgress {
  if (progress.credited.includes(encounterId)) return progress;
  const gained = unlocksFor(encounterId).map(relic => relic.id);
  return {
    ...progress,
    unlocked: [...new Set([...progress.unlocked, ...gained])],
    credited: [...progress.credited, encounterId],
  };
}

/** Everything this progress can be offered — the starting set plus whatever has been earned. */
export function availableRelics(progress: RelicProgress): RelicDefinition[] {
  const earned = new Set(progress.unlocked);
  return RELICS.filter(relic => isStarting(relic) || earned.has(relic.id));
}

/** How deep the pool is, for the UI to show the number going up. */
export function poolSize(progress: RelicProgress): number {
  return availableRelics(progress).length;
}

/** The relics this progress has earned, newest rung last — for a "what just opened up" panel. */
export function earnedRelics(progress: RelicProgress): RelicDefinition[] {
  const earned = new Set(progress.unlocked);
  return RELICS.filter(relic => earned.has(relic.id))
    .sort((a, b) => RANK_OF[a.tier] - RANK_OF[b.tier]);
}

// ------------------------------------------------------------------ validation

export function isValidProgress(value: unknown): value is RelicProgress {
  if (!value || typeof value !== 'object') return false;
  const progress = value as RelicProgress;
  if (progress.version !== 1) return false;
  if (!Array.isArray(progress.unlocked) || !Array.isArray(progress.credited)) return false;
  if (!progress.unlocked.every(id => typeof id === 'string')) return false;
  if (!progress.credited.every(id => typeof id === 'string')) return false;
  if (new Set(progress.unlocked).size !== progress.unlocked.length) return false;
  if (new Set(progress.credited).size !== progress.credited.length) return false;
  // Only rungs this chapter can actually hand out. A save claiming 秘宝 in chapter I is corrupt, and
  // letting it through would put chapter-II content into a chapter-I pool.
  const earnable = new Set<RelicTier>(Object.values(UNLOCK_BY_ENCOUNTER).flat());
  const starters = new Set(startingRelics().map(relic => relic.id));
  const byId = new Map(RELICS.map(relic => [relic.id, relic]));
  for (const id of progress.unlocked) {
    const relic = byId.get(id);
    if (!relic || starters.has(id)) return false;
    if (!earnable.has(relic.tier)) return false;
  }
  return true;
}

// ----------------------------------------------------------------- persistence

export const UNLOCK_KEY = 'eternal-night-relic-unlocks-v1';

/** Absent in node, and throwing in a locked-down browser — both just mean "no progress". */
function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

export function loadProgress(): RelicProgress {
  const store = storage();
  if (!store) return emptyProgress();
  try {
    const raw = store.getItem(UNLOCK_KEY);
    if (!raw) return emptyProgress();
    const parsed: unknown = JSON.parse(raw);
    return isValidProgress(parsed) ? parsed : emptyProgress();
  } catch {
    return emptyProgress();
  }
}

export function saveProgress(progress: RelicProgress) {
  try { storage()?.setItem(UNLOCK_KEY, JSON.stringify(progress)); } catch { /* Private mode still plays. */ }
}

export function clearProgress() {
  try { storage()?.removeItem(UNLOCK_KEY); } catch { /* Fine. */ }
}
