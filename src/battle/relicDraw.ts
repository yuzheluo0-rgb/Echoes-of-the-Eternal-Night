/**
 * The draw itself: which relics come out of the pool, and whether the second slot opens.
 *
 * Pure and seed-driven, like everything else in `src/battle/**`. The caller supplies the roll — the
 * run passes its own stream — so a run replays to the relic.
 */

import { RELIC_TIERS, type RelicDefinition, type RelicTier } from '../relics/relics.ts';

/** Chance the sub slot opens after a main relic has been drawn. */
export const SUB_SLOT_CHANCE = .25;

/** How many to offer at a draw. One is taken; the rest are shown face down and discarded unseen. */
export const DRAW_OPTIONS = 3;

const WEIGHT: Record<RelicTier, number> = Object.fromEntries(
  RELIC_TIERS.map(tier => [tier.id, tier.weight]),
) as Record<RelicTier, number>;

/**
 * `count` distinct relics from the pool, weighted towards the lower rungs.
 *
 * Weighted rather than uniform because the ladder is supposed to *feel* like a ladder: 残片 is 34
 * against 绝响's 5, so a run meets a lot of small things and very few large ones. Tiers that are not
 * in the pool simply never come up, so the same function serves a chapter-I pool and a full one.
 */
export function drawRelics(pool: RelicDefinition[], count: number, roll: () => number): RelicDefinition[] {
  const remaining = pool.slice();
  const drawn: RelicDefinition[] = [];
  for (let i = 0; i < count && remaining.length; i++) {
    const total = remaining.reduce((sum, relic) => sum + (WEIGHT[relic.tier] ?? 1), 0);
    let ticket = roll() * total;
    let index = remaining.length - 1;
    for (let j = 0; j < remaining.length; j++) {
      ticket -= WEIGHT[remaining[j].tier] ?? 1;
      if (ticket <= 0) { index = j; break; }
    }
    drawn.push(remaining.splice(index, 1)[0]);
  }
  return drawn;
}

/** Offer `DRAW_OPTIONS` relics the run does not already carry. */
export function offerRelics(
  pool: RelicDefinition[], held: (string | undefined)[], roll: () => number,
): RelicDefinition[] {
  const carrying = new Set(held.filter((id): id is string => !!id));
  return drawRelics(pool.filter(relic => !carrying.has(relic.id)), DRAW_OPTIONS, roll);
}

/** Does the sub slot open this time? */
export function opensSubSlot(roll: () => number): boolean {
  return roll() < SUB_SLOT_CHANCE;
}

/**
 * Gold a relic draw costs when it is bought rather than won. Kept here so the shop and the boss
 * reward quote the same number.
 */
export const RELIC_PRICE: Record<RelicTier, number> = {
  shard: 120, relic: 165, treasure: 210, arcanum: 275, echo: 340,
};
