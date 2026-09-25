/**
 * 战利品 — what a victory hands over.
 *
 * The point of this file is that a fight does **not** always pay the same way. The first version
 * always gave gold plus a choice of three cards, which after four fights reads as a formality: the
 * player stops reading the reward screen because they already know what is on it. So a victory rolls
 * **one row of this table** off the run's own stream, and the row decides what happens next.
 *
 * Adding a reward is adding a row. The table is data, the roll is pure, and `apply` is a small
 * switch over the effect kinds — a reward that needs a new *kind* of payoff is the only thing that
 * needs engine work, and there is a deliberate shortage of those.
 *
 * Weights are per-rarity rather than per-row so a common reward and a rare one of the same shape do
 * not drift apart as rows are added.
 */

import { CARDS, CARD_BY_ID } from '../cards/index.ts';
import { CHAPTER_1 } from './chapter.ts';
import { earnedCards } from './cardUnlocks.ts';
import { CARD_EFFECTS } from './effects.ts';

export type RewardRarity = 'common' | 'uncommon' | 'rare';

/** How often each rung comes up. A fight should mostly pay in coin and cards. */
export const RARITY_WEIGHT: Record<RewardRarity, number> = { common: 62, uncommon: 30, rare: 8 };

export const RARITY_LABEL: Record<RewardRarity, string> = { common: '寻常', uncommon: '难得', rare: '罕见' };
export const RARITY_COLOR: Record<RewardRarity, string> = { common: '#b6c3b2', uncommon: '#d9bc80', rare: '#e08a52' };

/**
 * What a reward actually does. Deliberately a closed set: every new reward should be expressible as
 * one of these, because a reward that needs a new shape is usually a reward that belongs in a
 * different screen.
 */
export type RewardEffect =
  /** Coin, straight into the purse. */
  | { kind: 'gold'; amount: number }
  /** 生命 back, capped at the ceiling. */
  | { kind: 'heal'; amount: number }
  /** Raise 生命上限 — and heal by the same amount, or it would be a number nobody feels. */
  | { kind: 'maxHp'; amount: number }
  /** Cards. `pick` means "choose one of `count`"; otherwise they all go straight into the deck. */
  | { kind: 'cards'; count: number; pick: boolean }
  /** A relic draw, the same one the graded fights pay. */
  | { kind: 'relic' }
  /** Burn a card of the player's choosing. */
  | { kind: 'remove' }
  /** 打磨 a card of the player's choosing. */
  | { kind: 'polish' }
  /** Copy a card of the player's choosing. */
  | { kind: 'duplicate' };

export interface RewardSpec {
  id: string;
  /** The headline, as the player reads it. */
  name: string;
  /** The flavour line under it. */
  blurb: string;
  rarity: RewardRarity;
  effect: RewardEffect;
}

/**
 * The table. Every row is a thing a fight can hand you.
 *
 * The rows are grouped by what they ask of the player: the first group is settled on the spot, the
 * second opens a card picker, the third is a straight gift. That ordering is for reading, not for
 * the roll — the roll does not care.
 */
export const REWARDS: RewardSpec[] = [
  // --- settled on the spot -----------------------------------------------------------
  { id: 'purse', name: '一只钱袋', blurb: '不知是谁丢的，也不知道该还给谁。', rarity: 'common', effect: { kind: 'gold', amount: 45 } },
  { id: 'toll', name: '过路钱', blurb: '路上有人收了钱，然后让开了。', rarity: 'common', effect: { kind: 'gold', amount: 30 } },
  { id: 'caravan-purse', name: '商队的钱箱', blurb: '锁是坏的，里面的东西还在。', rarity: 'uncommon', effect: { kind: 'gold', amount: 85 } },
  { id: 'hoard', name: '藏起来的积蓄', blurb: '有人打算回来取，但那是很久以前的事。', rarity: 'rare', effect: { kind: 'gold', amount: 160 } },

  { id: 'bandage', name: '绷带与热水', blurb: '不治什么大病，但能让人再走一段。', rarity: 'common', effect: { kind: 'heal', amount: 8 } },
  { id: 'hot-meal', name: '一顿热饭', blurb: '长夜里，热的东西比什么都稀罕。', rarity: 'common', effect: { kind: 'heal', amount: 12 } },
  { id: 'field-kit', name: '随军的医药包', blurb: '缝线、酒精、还有一小瓶不知道是什么的东西。', rarity: 'uncommon', effect: { kind: 'heal', amount: 20 } },

  // --- open a card picker ------------------------------------------------------------
  { id: 'spoils', name: '战利品', blurb: '从它们身上掉下来的，看看哪件合手。', rarity: 'common', effect: { kind: 'cards', count: 3, pick: true } },
  { id: 'scattered', name: '散落一地', blurb: '风把纸页吹得到处都是。', rarity: 'common', effect: { kind: 'cards', count: 3, pick: true } },

  { id: 'burn', name: '烧掉一张', blurb: '有些东西带着只会拖慢你。', rarity: 'uncommon', effect: { kind: 'remove' } },
  { id: 'hone', name: '磨一磨', blurb: '不是换一把，是把这一把磨到更好。', rarity: 'uncommon', effect: { kind: 'polish' } },
  { id: 'mirror', name: '照一遍', blurb: '同样的东西，再要一份。', rarity: 'rare', effect: { kind: 'duplicate' } },

  // --- straight gifts ----------------------------------------------------------------
  { id: 'bundle', name: '一捆牌', blurb: '不知道谁捆的，绳子还没解开。', rarity: 'uncommon', effect: { kind: 'cards', count: 1, pick: false } },
  { id: 'loose-leaf', name: '夹在书里的两页', blurb: '字迹和营地那本手册是同一个人写的。', rarity: 'uncommon', effect: { kind: 'cards', count: 2, pick: false } },

  { id: 'sturdier', name: '撑住', blurb: '这一夜之后，你比昨天能多挨一点。', rarity: 'uncommon', effect: { kind: 'maxHp', amount: 6 } },
  { id: 'second-wind', name: '缓过来一口气', blurb: '天还没亮，但身体记住了怎么继续走。', rarity: 'rare', effect: { kind: 'maxHp', amount: 12 } },

  { id: 'windfall-relic', name: '捡到的东西', blurb: '它落在灰里，不像本来属于这里。', rarity: 'uncommon', effect: { kind: 'relic' } },
  { id: 'dig', name: '往下挖了挖', blurb: '土很松，说明最近有人动过。', rarity: 'rare', effect: { kind: 'relic' } },
];

export const REWARD_BY_ID = new Map(REWARDS.map(reward => [reward.id, reward]));

/** The combined weight of the table — used by the roll and by the tests. */
export function totalRewardWeight(): number {
  return REWARDS.reduce((sum, reward) => sum + RARITY_WEIGHT[reward.rarity], 0);
}

/**
 * Roll one reward. `roll` is the run's own stream, so a run replays to the same loot.
 *
 * Weighted by rarity rather than uniformly: a table where a 160-gold hoard is as likely as a 30-gold
 * toll is a table where gold stops meaning anything.
 */
export function rollReward(roll: () => number): RewardSpec {
  const total = totalRewardWeight();
  let ticket = roll() * total;
  for (const reward of REWARDS) {
    ticket -= RARITY_WEIGHT[reward.rarity];
    if (ticket <= 0) return reward;
  }
  return REWARDS[REWARDS.length - 1];
}

/**
 * The cards this run can be offered, as a pool of ids.
 *
 * Both of the run's decks and nothing else: a reward that handed out a 燎原余烬 card to a run that
 * has never seen that deck would be a card with no support around it.
 */
export function rewardCardPool(main: string, sub: string): string[] {
  const decks = [main, sub];
  const base = decks.flatMap(deck => CHAPTER_1.unlocked[deck] ?? []);
  // Plus whatever 击破守望者 has unlocked — filtered to these two decks, because the pool is
  // 「both of the run's decks and nothing else」 and an unlocked card from a deck this run is not
  // carrying is still a card with no support around it.
  const earned = earnedCards().filter(id => decks.includes(CARD_BY_ID.get(id)?.deck ?? ''));
  return [...new Set([...base, ...earned])];
}

/** Roll `count` distinct card ids off a stream. */
export function rollCards(pool: string[], count: number, roll: () => number): string[] {
  const left = [...pool];
  const picked: string[] = [];
  for (let i = 0; i < count && left.length; i++) {
    picked.push(left.splice(Math.floor(roll() * left.length), 1)[0]);
  }
  return picked;
}

/**
 * A card on offer. **Not a bare id**, because one of them may be 已打磨 or a card the chapter has not
 * unlocked — and those are the two reasons a pick is worth reading rather than clicking through.
 */
export interface CardOffer {
  cardId: string;
  upgraded?: boolean;
  /** True when this card is **not** in the run's pool — a glimpse of what the rest of the library
   *  holds. The picker says so, because a card the player cannot otherwise get should look like one. */
  beyond?: boolean;
}

/**
 * One offer in six is 已打磨, and one in nine comes from outside the run's pool.
 *
 * Two different teases, and they are deliberately different sizes. **已打磨** is a straight upgrade the
 * player can evaluate on sight — it is the same card with bigger numbers, and the card face prints
 * them. **未解锁** is a card they have never seen, which is why it is rarer: a taste of the rest of the
 * library is a reason to keep playing, but a pick that is usually unfamiliar cards stops being a
 * choice between things the player already has opinions about.
 */
export const UPGRADE_OFFER_CHANCE = 17;
export const BEYOND_OFFER_CHANCE = 11;

/**
 * Every card of a deck that the engine can actually **play**, unlocked or not — the pool the 未解锁
 * tease draws from.
 *
 * The `CARD_EFFECTS` filter is the whole point. A card with no behaviour is a blank: it is drawable,
 * playable, and does nothing but write 「还没有实装效果」 into the log. Handing one to the player as a
 * *reward* would be the worst place in the game to find that out, and the tease deliberately reaches
 * outside the unlocked pool — which is exactly where the unimplemented cards live (they are locked
 * precisely because nobody has written them yet).
 */
export function fullDeckPool(decks: string[]): string[] {
  const wanted = new Set(decks);
  return CARDS.filter(card => wanted.has(card.deck) && CARD_EFFECTS[card.id]).map(card => card.id);
}

/**
 * Roll an offer of `count` cards: the run's own pool, with the two teases folded in.
 *
 * The roll order is fixed — one draw per offer slot for the card, then two more for its flags — so a
 * run still replays identically, and so adding a tease later cannot silently reshuffle which cards
 * come up.
 */
export function rollCardOffer(pool: string[], count: number, roll: () => number, beyond: string[]): CardOffer[] {
  const left = [...pool];
  const wide = beyond.filter(id => !pool.includes(id));
  const offers: CardOffer[] = [];
  for (let i = 0; i < count && left.length; i++) {
    const goWide = wide.length > 0 && roll() * 100 < BEYOND_OFFER_CHANCE;
    const from = goWide ? wide : left;
    const [id] = from.splice(Math.floor(roll() * from.length), 1);
    // Taken out of the narrow pool too, so the same card cannot arrive twice in one offer.
    if (goWide) {
      const dup = left.indexOf(id);
      if (dup >= 0) left.splice(dup, 1);
    }
    const upgraded = roll() * 100 < UPGRADE_OFFER_CHANCE;
    offers.push({ cardId: id, ...(upgraded ? { upgraded: true } : {}), ...(goWide ? { beyond: true } : {}) });
  }
  return offers;
}

/** Every card id the reward table can name, for the test that keeps the pool honest. */
export function rewardCardNames(ids: string[]): string[] {
  return ids.map(id => CARD_BY_ID.get(id)?.name ?? id);
}
