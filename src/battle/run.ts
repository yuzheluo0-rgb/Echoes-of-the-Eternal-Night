/**
 * A chapter run — the layer the engine deliberately does not have.
 *
 * `engine.ts` knows one fight and nothing else: every entry point is a pure function over a single
 * `BattleState`, and `isValidBattle` rejects any player HP above `PLAYER_MAX_HP`. That is the right
 * shape for a battle and the wrong shape for a chapter, so the chapter lives out here instead, as a
 * plain object with its own transitions. The engine gains exactly one thing from this file: the
 * ability to be *started* at a carried-over HP (`startBattle`'s `opts.hp`).
 *
 * Three rules hold it together:
 *
 *   1. **HP carries.** A victory keeps whatever the player had left and adds a rolled 9–15 点 heal
 *      on top, capped at `PLAYER_MAX_HP`. A defeat ends the run.
 *   2. **The deck *pair* is locked, the orientation is not.** `main` and `sub` are chosen once and
 *      `swapDecks` only ever exchanges them, so a run cannot smuggle in a third deck.
 *   3. **`cleared` is a log of wins, not a sequence.** The tower deals fights from pools, so the order
 *      they are won in has nothing to do with the chapter's order, and the same fight can come round
 *      twice. `isValidRun` therefore checks membership and uniqueness rather than a prefix, and the
 *      chapter is done when each of the five anchors has been beaten *at some point*.
 *
 * Randomness is the engine's own LCG, copied verbatim, over the run's private `rng` stream. Drawing
 * a fight's shuffle from `battleSeed()` and the between-fight heal from `rng` keeps the two uses
 * independent: replaying a run from its seed reproduces both the heals and every shuffle.
 */

import { CARD_BY_ID, DECK_IDS, type DeckId } from '../cards/index.ts';
import { CHAPTER_1, chapterDeck, isDeckUnlocked } from './chapter.ts';
import { RELIC_BY_ID, type RelicDefinition } from '../relics/relics.ts';
import type { RefineTier } from './relics.ts';
import { generateMap, reachableFrom, type MapNode, type TowerMap } from './map.ts';
import { isUpgradable } from './upgrades.ts';
import {
  REWARD_BY_ID, fullDeckPool, rewardCardPool, rollCardOffer, rollReward, type CardOffer,
} from './rewards.ts';
import type { EventEffect, EventOption } from './events.ts';
import { SUB_SLOT_CHANCE, offerRelics } from './relicDraw.ts';
import { PLAYER_MAX_HP, isJunkId, relicModifier, type BattleCard, type BattleState } from './engine.ts';
import { ALL_ENCOUNTERS, ENCOUNTERS, POOLS, type Encounter } from './enemies.ts';

/** One card in the run's deck. `upgraded` is per copy, so a run can hold a polished 割线 and a plain
 *  one at the same time. */
export interface RunCard {
  cardId: string;
  upgraded?: boolean;
}

/** A relic draw waiting on the player: three relics are offered, one is taken. */
export interface PendingDraw {
  /** Relic ids on offer. */
  options: string[];
  /** Which slot the chosen one lands in. */
  slot: 'main' | 'sub';
  /** The encounter that paid for this draw, for the log line. */
  from: string;
}

/** The between-fight heal, inclusive at both ends. */
export const HEAL_MIN = 9;
export const HEAL_MAX = 15;

/** Chapter I's encounters, in the only order they may be fought. */
export const RUN_ENCOUNTERS: Encounter[] = ENCOUNTERS;

export interface ChapterRun {
  version: 1;
  chapterId: string;
  /** The locked pair. `swapDecks` exchanges these two and nothing else. */
  main: DeckId;
  sub: DeckId;
  /** Carried into the next fight. Reset to full only by starting a new run. */
  hp: number;
  /** The ceiling. Starts at `PLAYER_MAX_HP`; only a reward raises it, and it never falls. */
  maxHp: number;
  /** Spent at shops, and what 铜板 / 商队账本 act on. */
  gold: number;
  /**
   * The run's own deck, in draw order — **not** recomputed per fight.
   *
   * It used to be `chapterDeck(main, sub)` every time, which was correct only while nothing could
   * change it. A card reward, a shop, a card burned at the campfire and a card polished there all
   * edit this list, and a fight is dealt from it.
   */
  deck: RunCard[];
  /** The two relics carried into every fight. See `BattleState.relics`. */
  relics: { main?: string; sub?: string };
  /**
   * Which relics have been **淬炼**, and how far — keyed by relic **id**, not by slot.
   *
   * By id because 淬炼 belongs to the thing rather than to the shelf: `swapRelics` moves a relic
   * between slots, and a slot-keyed map would have to be moved alongside it in every transition that
   * touches `relics` — one more place to fall out of step, for nothing. The cost is that re-drawing a
   * relic you once quenched brings it back quenched; nobody has ever discarded a relic and drawn the
   * same one again, and if they did, the refinement was paid for.
   */
  refined?: Record<string, RefineTier>;
  /** A relic draw the player has not answered yet. Persisted, so a reload lands back on it. */
  pendingDraw?: PendingDraw;
  /** The encounter whose victory owes a draw that has not been offered yet. */
  drawDue?: string;
  /** Which slot the owed draw is for. A victory owes `main`; if that draw rolled the sub slot open,
   *  claiming it re-arms `drawDue` with `sub`. */
  nextSlot?: 'main' | 'sub';
  /** Rolled at the victory: whether a *second* draw follows the main one. Cleared once it is spent. */
  subPending?: boolean;
  /**
   * Has this run ever been owed a relic draw? Set by the first graded win **or** by the row-3
   * guarantee, and never cleared.
   *
   * It cannot be inferred from `relics` being empty: a player may have drawn one and thrown it away,
   * and the guarantee firing again would hand out a second relic for discarding the first.
   */
  relicGranted?: boolean;
  /**
   * The tower this run is climbing. Always present, and a pure function of `seed` — it is stored
   * rather than recomputed because it is what `at` and `path` refer *into*, and a generator change
   * would otherwise move the player onto a different node mid-run.
   */
  map: TowerMap;
  /** The node the run is standing on. Absent at the bottom, where the choice is which column to
   *  start in. */
  at?: string;
  /** The fight the current floor turned out to hold. Rolled on entry — see `encounterFor`. */
  currentFight?: string;
  /**
   * The node whose *reward* the player has not answered yet, if any.
   *
   * Two different things happen on a floor and they happen at different times. A **campfire** asks
   * its question the moment you step on it; a **fight** is resolved first and pays afterwards. So a
   * victory sets `rewardDue` while `at` is already the next floor's business.
   */
  rewardDue?: string;
  /** The node whose non-combat outcome has already been applied, so the screen is not shown twice. */
  resolved?: string;
  /** The reward a victory rolled, waiting to be claimed. See `rewards.ts`. */
  pendingReward?: string;
  /**
   * A card-picking step the player still owes, and what it is for. One field rather than three,
   * because only ever one of them can be outstanding.
   */
  cardTask?: 'pick' | 'remove' | 'polish' | 'duplicate';
  /** The cards a `pick` task is offering. */
  cardOptions?: CardOffer[];
  /**
   * Cards that have **already** moved in or out of the deck, waiting to be looked at.
   *
   * A `pick` shows its cards by definition — the choosing *is* the display. Every other way a card
   * moves does not: 「一捆牌」 prints 「直接获得 2 张牌」 and the two cards arrive unseen, and 换一张
   * takes one out without ever saying which. Both are reported here instead, and the reveal screen
   * holds them until 继续 — same split as 打磨's `repairCard` / `dismissCard`, for the same reason:
   * the player is owed a look at what just happened to their deck.
   */
  cardReveal?: {
    gained: CardOffer[];
    /** The card that left the deck, if any. 换一张 loses one and gains one. */
    lost?: string;
    /** The headline: where this happened, as the player reads it. */
    from: string;
  };
  /**
   * A 淬炼 the player still owes — **which relic** is the decision, so it waits for a pick like
   * `cardTask` does. The tier and the odds come from the option they chose, so both are carried here
   * rather than re-read from the event: the event's identity is derived from the node, and a save
   * reloaded onto a different node must not change what the player bet.
   */
  relicTask?: {
    tier: RefineTier;
    chance: number;
    /**
     * Set once the gamble has landed, and **kept** until the player dismisses the reveal.
     *
     * Same split as 打磨's `repairCard` / `dismissCard`, and for the same reason: the dispatcher stops
     * treating this floor as a 奇遇 the instant `relicTask` clears, so clearing it on the roll would
     * unmount the result screen on the very frame it has something to show. It doubles as the
     * idempotence guard — a second `answerRefine` sees `done` and refuses to roll again.
     */
    done?: {
      relicId: string;
      won: boolean;
      /**
       * Which slot it was in **when it went in the fire**.
       *
       * Recorded rather than looked up, because the lookup is impossible exactly when it matters: a
       * failed quench removes the relic, so by the time the reveal renders, `run.relics[slot]` no
       * longer names it and 「主槽空了」 would have come out as 「副槽空了」 every single time.
       */
      slot: 'main' | 'sub';
    };
  };
  /** Every node stepped on, in order — the route drawn on the map, and what an upgrade owes to
   *  `cleared` being a chapter fact rather than a route fact. */
  path: string[];
  /** Beaten encounters, in order. Kept for the chapter's own bookkeeping (unlocks, the boss flag);
   *  which fights happen is now the map's business. */
  cleared: string[];
  /** Fixed at run creation; every fight's shuffle is derived from it. */
  seed: number;
  /** Advances on every heal roll. Kept apart from `seed` so heals and shuffles stay independent. */
  rng: number;
}

// ------------------------------------------------------------------ transitions

export function newRun(main: DeckId, sub: DeckId, seed = 7): ChapterRun {
  if (!isDeckUnlocked(main) || !isDeckUnlocked(sub)) {
    throw new Error(`第一章还不能携带「${main}」与「${sub}」牌组。`);
  }
  const stamped = Math.trunc(seed) >>> 0;
  return {
    version: 1,
    chapterId: CHAPTER_1.id,
    main,
    sub,
    hp: PLAYER_MAX_HP,
    maxHp: PLAYER_MAX_HP,
    gold: 0,
    deck: chapterDeck(main, sub).map(cardId => ({ cardId })),
    relics: {},
    // Laid down here rather than by a separate call, so a run is *never* without its tower. An
    // earlier version left this to `startClimb`, and a save written before the tower existed loaded
    // clean — `isValidRun` did not look for a map — and then white-screened the page on
    // `map.startIds`. A run that cannot be drawn is not a run.
    map: generateMap(stamped),
    path: [],
    cleared: [],
    seed: stamped,
    rng: stamped,
  };
}

// --------------------------------------------------------------- the deck

/** Take a new card into the deck. Draws are dealt off `draw` in order, so a new card is appended —
 *  it will be met late in the first fight and normally from then on. */
export function addCard(run: ChapterRun, cardId: string, upgraded?: boolean): ChapterRun {
  return { ...run, deck: [...run.deck, upgraded ? { cardId, upgraded: true } : { cardId }] };
}

/** Burn a card. `index` is into `run.deck`, which is what the picker shows. */
export function removeCard(run: ChapterRun, index: number): ChapterRun {
  if (index < 0 || index >= run.deck.length) return run;
  return { ...run, deck: run.deck.filter((_, at) => at !== index) };
}

/** 打磨 one copy. Already-polished cards are left alone rather than double-dipped. */
export function upgradeCard(run: ChapterRun, index: number): ChapterRun {
  const card = run.deck[index];
  if (!card || card.upgraded || !isUpgradable(card.cardId)) return run;
  const deck = run.deck.slice();
  deck[index] = { ...card, upgraded: true };
  return { ...run, deck };
}

/** A copy of the deck as battle cards, which is what `startBattle` wants. */
export function deckFor(tag: string, run: ChapterRun): BattleCard[] {
  return run.deck.map((card, index) => ({ uid: `${tag}${index}`, cardId: card.cardId, upgraded: card.upgraded }));
}


/** Roll the reward a victory owes, so the screen has something to show. */
export function rollPendingReward(run: ChapterRun): ChapterRun {
  const next = { ...run };
  const reward = rollReward(() => nextRandom(next));
  return { ...next, pendingReward: reward.id, rewardDue: undefined };
}

/**
 * Claim it. Most rewards settle here; the ones that need a choice set `cardTask` and wait for
 * `chooseCard`.
 */
export function claimReward(run: ChapterRun): ChapterRun {
  const reward = run.pendingReward ? REWARD_BY_ID.get(run.pendingReward) : undefined;
  if (!reward) return { ...run, pendingReward: undefined };
  const paid: ChapterRun = { ...run, pendingReward: undefined };
  const effect = reward.effect;
  switch (effect.kind) {
    case 'gold': return { ...paid, gold: paid.gold + effect.amount };
    case 'heal': return { ...paid, hp: Math.min(PLAYER_MAX_HP, paid.hp + effect.amount) };
    // Raising the ceiling heals by the same amount: a bigger bar the player cannot feel is not a
    // reward, it is a number.
    case 'maxHp': return { ...paid, maxHp: paid.maxHp + effect.amount, hp: paid.hp + effect.amount };
    case 'relic': return { ...paid, drawDue: 'reward', nextSlot: 'main' };
    case 'cards': return effect.pick
      ? { ...paid, cardTask: 'pick', cardOptions: rollOffers(paid, effect.count) }
      : gainCards(paid, effect.count, '战利品');
    case 'remove': return { ...paid, cardTask: 'remove' };
    case 'polish': return { ...paid, cardTask: 'polish' };
    case 'duplicate': return { ...paid, cardTask: 'duplicate' };
  }
}

/** Roll `count` card ids for the player to choose between, advancing the run's stream. */
/**
 * Roll `count` cards off the run's stream.
 *
 * `mystery` is 奇遇 only — see `CardOffer.hidden`. A reward is what a fight paid out, so it is always
 * face up; a hole in the ground is allowed to hide what is in it.
 */
function rollOffers(run: ChapterRun, count: number, mystery = false): CardOffer[] {
  return rollCardOffer(rewardCardPool(run.main, run.sub), count, () => nextRandom(run),
    fullDeckPool([run.main, run.sub]), mystery);
}

/** A `CardOffer` as the deck stores it. The 已打磨 flag has to travel with the card. */
const asRunCard = (offer: CardOffer): RunCard =>
  (offer.upgraded ? { cardId: offer.cardId, upgraded: true } : { cardId: offer.cardId });

/**
 * Put `count` rolled cards into the deck **and stage them for the reveal**.
 *
 * The staging is the point. A card that arrives with no screen is a card the player never reads, and
 * 「一捆牌」 has been handing over two of them behind a line of text that says only how many.
 */
function gainCards(run: ChapterRun, count: number, from: string): ChapterRun {
  const gained = rollOffers(run, count);
  if (!gained.length) return run;
  return { ...run, deck: [...run.deck, ...gained.map(asRunCard)], cardReveal: { gained, from } };
}

/**
 * Answer a card task. `index` is into `run.deck`, except for `pick`, where it is into
 * `run.cardOptions` — the one task whose card is not already in the deck.
 *
 * `index` of `null` passes on a `pick`, which is a real decision: a thicker deck is not
 * automatically a better one.
 */
export function chooseCard(run: ChapterRun, index: number | null): ChapterRun {
  const task = run.cardTask;
  if (!task) return run;
  if (task === 'pick') {
    if (index === null) return { ...run, cardTask: undefined, cardOptions: undefined };
    const offer = run.cardOptions?.[index];
    if (!offer) return run;
    // The 已打磨 flag travels with the card into the deck — a polished offer that arrived unpolished
    // would be the offer screen lying about what the player picked.
    const taken = addCard(run, offer.cardId, offer.upgraded);
    const cleared = { ...taken, cardTask: undefined, cardOptions: undefined };
    // A card picked **blind** is turned over here. Choosing a deck's back and then never finding out
    // which card it was would make the mystery a shrug instead of a beat — the same rule 打磨's reveal
    // follows, applied to the one pick the player could not read on the way in.
    return offer.hidden ? { ...cleared, cardReveal: { gained: [offer], from: '你摸到的那张' } } : cleared;
  }
  if (index === null) return { ...run, cardTask: undefined, cardOptions: undefined };
  const next = task === 'remove' ? removeCard(run, index)
    : task === 'polish' ? upgradeCard(run, index)
      : { ...run, deck: [...run.deck, run.deck[index]].filter(Boolean) };
  if (next === run) return run;
  return { ...next, cardTask: undefined, cardOptions: undefined };
}

/**
 * Settle the card task without ending it.
 *
 * 打磨 is the one card task whose *result* is worth looking at — the card gains its mark and its text
 * changes, in place, on the screen the player is already looking at. That needs the run updated while
 * the picker is still mounted, and the picker stays mounted for exactly as long as `cardTask` is set.
 * So the two halves are split: this applies the choice immediately (the face changes under the
 * player's cursor), and `dismissCard` closes the picker once the strike animation has played.
 *
 * Calling this twice is a no-op the second time — `upgradeCard` refuses a card that is already
 * polished, and `chooseCard` refuses an index whose task has been cleared.
 */
export function repairCard(run: ChapterRun, index: number): ChapterRun {
  const task = run.cardTask;
  if (!task || task === 'pick') return run;
  const next = task === 'remove' ? removeCard(run, index)
    : task === 'polish' ? upgradeCard(run, index)
      : { ...run, deck: [...run.deck, run.deck[index]].filter(Boolean) };
  return next === run ? run : next;
}

/** Close the picker: the animation is over, the run has already taken the choice. */
export function dismissCard(run: ChapterRun): ChapterRun {
  if (!run.cardTask) return run;
  return { ...run, cardTask: undefined, cardOptions: undefined };
}

/** Close the card reveal. The deck has already moved; this only ends the look at it. */
export function dismissReveal(run: ChapterRun): ChapterRun {
  if (!run.cardReveal) return run;
  return { ...run, cardReveal: undefined };
}

// --------------------------------------------------------------- the campfire

export type CampfireChoice =
  /** Heal 30% of the ceiling. */
  | { kind: 'rest' }
  /** Burn a card out of the deck for good. */
  | { kind: 'burn'; index: number }
  /** 打磨 one copy. */
  | { kind: 'polish'; index: number };

/**
 * Resolve a campfire. Returns the run unchanged when the choice cannot be applied — an out-of-range
 * index, or a card that has already been polished — so the caller can simply not advance.
 */
export function campfire(run: ChapterRun, choice: CampfireChoice): ChapterRun {
  if (choice.kind === 'rest') return { ...restHeal(run), resolved: run.at, rewardDue: undefined };
  if (choice.kind === 'burn') {
    const next = removeCard(run, choice.index);
    if (next === run) return run;
    return { ...next, resolved: run.at, rewardDue: undefined };
  }
  const next = upgradeCard(run, choice.index);
  if (next === run) return run;
  return { ...next, resolved: run.at, rewardDue: undefined };
}

// ------------------------------------------------------------------- 奇遇

/**
 * Answer an event. The option's `requires` is paid out of the run, then its effect lands — so an
 * event can never be the thing that kills you and can never let you spend coin you do not have.
 */
export function resolveEvent(run: ChapterRun, option: EventOption): ChapterRun {
  const paid: ChapterRun = { ...run, resolved: run.at };
  const afterCost: ChapterRun = option.requires ? {
    ...paid,
    gold: paid.gold - (option.requires.gold ?? 0),
    hp: paid.hp - (option.requires.hp ?? 0),
  } : paid;
  return applyEventEffect(afterCost, option.effect);
}

/**
 * The effect half of an event, split out so a `junk`'s companion effect can be applied without running
 * the cost pass twice — 「拿走 75 金币，但牌组多一张废牌」 is one option with one price.
 */
function applyEventEffect(afterCost: ChapterRun, effect: EventEffect): ChapterRun {
  switch (effect.kind) {
    case 'gold': return { ...afterCost, gold: Math.max(0, afterCost.gold + effect.amount) };
    // Floored at 1: an event that kills you is a bug, not a difficulty.
    case 'hp': return { ...afterCost, hp: Math.max(1, Math.min(afterCost.maxHp, afterCost.hp + effect.amount)) };
    case 'maxHp':
      return {
        ...afterCost,
        maxHp: Math.max(PLAYER_MAX_HP, afterCost.maxHp + effect.amount),
        hp: afterCost.hp + Math.max(0, effect.amount),
      };
    case 'relic': return { ...afterCost, drawDue: 'event', nextSlot: 'main' };
    case 'remove': return { ...afterCost, cardTask: 'remove' };
    case 'polish': return { ...afterCost, cardTask: 'polish' };
    case 'duplicate': return { ...afterCost, cardTask: 'duplicate' };
    // The relic is not chosen yet — `relicTask` holds the bet until the player picks which one to put
    // in the fire. See `answerRefine`.
    case 'refine': return { ...afterCost, relicTask: { tier: effect.tier, chance: effect.chance } };
    // 换一张 — 「他挑走一张，塞给你一张」. **He** picks, hence the random removal, and both halves are
    // staged for the reveal: a trade whose losing half is invisible reads as a gift that glitched.
    case 'swap': {
      const next: ChapterRun = { ...afterCost };
      const gained = rollOffers(next, 1);
      if (!gained.length || !next.deck.length) return next;
      const lostIndex = Math.floor(nextRandom(next) * next.deck.length);
      const lost = next.deck[lostIndex].cardId;
      return {
        ...next,
        deck: [...next.deck.filter((_, i) => i !== lostIndex), asRunCard(gained[0])],
        cardReveal: { gained, lost, from: '换来的' },
      };
    }
    // A hazard. It goes straight into the deck — no picker, because the whole point is that you did
    // not choose it. Whatever it came attached to lands after it, so the option's own ledger line
    // still reads cost-first.
    case 'junk': return effect.with
      ? applyEventEffect(addCard(afterCost, effect.cardId), effect.with)
      : addCard(afterCost, effect.cardId);
    // `mystery` — an 奇遇's cards may come face down. See `CardOffer.hidden`.
    case 'cards': return {
      ...afterCost, cardTask: 'pick', cardOptions: rollOffers(afterCost, effect.count, true),
    };
    case 'nothing': return afterCost;
  }
}

/** How many copies of each card, polished and plain kept apart. For the deck screen. */
export function deckCounts(run: ChapterRun): { cardId: string; upgraded: boolean; count: number }[] {
  const tally = new Map<string, { cardId: string; upgraded: boolean; count: number }>();
  for (const card of run.deck) {
    const key = `${card.cardId}:${card.upgraded ? '+' : ''}`;
    const entry = tally.get(key) ?? { cardId: card.cardId, upgraded: !!card.upgraded, count: 0 };
    entry.count += 1;
    tally.set(key, entry);
  }
  return [...tally.values()];
}

// --------------------------------------------------------------- the tower

/** Where the run may go next: every starting node at first, then whatever this node leads to. */
export function nextChoices(run: ChapterRun): string[] {
  return reachableFrom(run.map, run.at);
}

/** Is this node one of the places the run could actually move to right now? */
export function canEnterNode(run: ChapterRun, nodeId: string): boolean {
  return nextChoices(run).includes(nodeId);
}

/** Step onto a node. Combat is not resolved here — the caller starts a fight for those. */
export function enterNode(run: ChapterRun, nodeId: string): ChapterRun {
  if (!canEnterNode(run, nodeId)) return run;
  const node = run.map.byId.get(nodeId)!;
  const next: ChapterRun = { ...run, at: nodeId, path: [...run.path, nodeId], resolved: undefined };
  // The fight is decided here, at the threshold, and kept on the run so the preparation screen, the
  // battle and a reload all agree about what is standing on this floor.
  if (node.kind === 'combat' || node.kind === 'elite' || node.kind === 'boss') {
    const stamped = { ...next };
    return { ...next, currentFight: encounterFor(node, () => nextRandom(stamped), next.cleared) };
  }
  return next;
}

/** The node the run is standing on. */
export function nodeAt(run: ChapterRun): MapNode | undefined {
  return run.at ? run.map.byId.get(run.at) : undefined;
}

/**
 * The fight a floor turns out to hold, rolled **when the player walks in** rather than when the map
 * was laid down.
 *
 * This is what makes the tower a set of decisions instead of a list of spoilers: a floor says
 * 「战斗」 and the rest is only true once you are standing on it. Row 1 is the exception — its text
 * names 「两只影狼」, so it has to be the teaching fight or it would be lying.
 */
export function encounterFor(node: MapNode, roll: () => number, beaten: readonly string[] = []): string {
  if (node.kind === 'boss') return POOLS.boss[0].id;
  if (node.row === 1) return 'ch1-1';

  const pool = node.kind === 'elite' ? POOLS.elite : node.row <= 4 ? POOLS.weak : POOLS.strong;
  /**
   * Fresh fights first, repeats only as a fallback.
   *
   * The pools hold the five **chapter** encounters as anchors — 头狼 is in `elite`, 萤火树洞 in `weak`
   * — which is what lets the chapter's own fights turn up on the map at all. The cost is that a pool
   * can deal one the run has already won, and a re-won fight pays **nothing**: `finishBattle` returns
   * the run untouched when the encounter is already in `cleared`. A whole floor spent, no card, no
   * coin, and the walk to the boss one step further away.
   *
   * So already-beaten encounters are held back rather than filtered out — the fallback matters,
   * because on a late row every fight in the pool may have been won and a floor with no fight at all
   * is worse than a repeat.
   *
   * Split, then pick — **not sorted**. The obvious one-liner is a comparator on `beaten.includes`,
   * and it is wrong: that comparator returns 0 for two fresh encounters and non-zero for a fresh and
   * a beaten one depending on argument order, which is not a consistent ordering, and V8 is free to
   * hand back an array that is not partitioned. It did — `w-ashdogs` came out ahead of `ch1-1` about
   * an eighth of the time. Two passes and no sort semantics to rely on.
   */
  const fresh = pool.filter(entry => !beaten.includes(entry.id));
  const options = fresh.length ? fresh : pool;
  return options[Math.floor(roll() * options.length)].id;
}

/** Spend gold. Refuses rather than going negative. */
export function spendGold(run: ChapterRun, amount: number): ChapterRun | undefined {
  if (amount > run.gold) return undefined;
  return { ...run, gold: run.gold - amount };
}

/** 营火 — heal 30% of the maximum. */
export function restHeal(run: ChapterRun): ChapterRun {
  const ceiling = run.maxHp;
  return { ...run, hp: Math.min(ceiling, run.hp + Math.round(ceiling * .3)) };
}

/** Fights that pay a relic draw. Elite, miniboss and boss — the graded ones. */
/**
 * The floor by which a run is **guaranteed** to have been offered a relic, if an elite has not already
 * done it. See the note in `finishBattle` — the short version is that 21.8% of routes never meet an
 * elite, and a run with no relic can never use a 淬炼 event.
 *
 * Row 3 and not row 1: the first two rows are the tutorial stretch, and handing over a relic before
 * the deck has a shape makes the choice of which slot to put it in a coin flip.
 */
export const FIRST_RELIC_ROW = 3;

const GRADED_POOLS = new Set(['elite', 'boss']);

/** Does beating this encounter earn a relic draw? */
export function earnsRelic(encounterId: string): boolean {
  const encounter = ALL_ENCOUNTERS.find(entry => entry.id === encounterId);
  return !!encounter && GRADED_POOLS.has(encounter.pool);
}

/** Put a draw in front of the player. The caller supplies the options, because the pool is
 *  meta-progress and the run has no business knowing about it. */
export function offerDraw(run: ChapterRun, options: string[], slot: 'main' | 'sub', from: string): ChapterRun {
  return { ...run, pendingDraw: { options, slot, from }, drawDue: undefined };
}

/**
 * Take one, and say where it goes.
 *
 * `placeIn` is the player's decision, not the draw's: the relic can go into either slot, and if that
 * slot already holds something the old one is replaced. Anything else is not a choice — "the first
 * draw goes to main and the second to sub" made the whole ritual a formality the player watched
 * rather than played.
 */
export function claimRelic(run: ChapterRun, relicId: string, placeIn: 'main' | 'sub'): ChapterRun {
  const draw = run.pendingDraw;
  if (!draw || !draw.options.includes(relicId)) return run;
  const next: ChapterRun = {
    ...run,
    relics: { ...run.relics, [placeIn]: relicId },
    pendingDraw: undefined,
  };
  // A relic claimed while the sub slot is open owes a second offer; the caller makes it.
  if (run.subPending) return { ...next, drawDue: draw.from, nextSlot: 'sub', subPending: undefined };
  return { ...next, nextSlot: undefined, subPending: undefined };
}

/** Exchange the two slots. The pair is what matters, not which half leads — same as the decks. */
export function swapRelics(run: ChapterRun): ChapterRun {
  if (!run.relics.main && !run.relics.sub) return run;
  return { ...run, relics: { main: run.relics.sub, sub: run.relics.main } };
}

/** Throw one away, to make room or to be rid of a downside. */
export function discardRelic(run: ChapterRun, slot: 'main' | 'sub'): ChapterRun {
  if (!run.relics[slot]) return run;
  const relics = { ...run.relics };
  const gone = relics[slot]!;
  delete relics[slot];
  return { ...run, relics: relics, refined: withoutRefinement(run.refined, gone) };
}

/**
 * 营火的那一档淬炼：把赌局挂上去，**并且由它自己结束这一层**。
 *
 * It lives here rather than inline in the campfire's click handler for two reasons. One is the test:
 * `strip-types` cannot parse JSX, so a branch written beside its screen is a branch nothing can hold
 * to account. The other is the bug that branch has already caused once in this file — 焚牌 and 打磨
 * only armed a `cardTask` and left `resolved` alone, and since the picker is drawn *over* the
 * campfire, one night at the fire could be spent twice: burn a card, then rest as well.
 *
 * So this sets `resolved` (and clears `rewardDue`) the same way the other two do, and `run.test.ts`
 * asserts it — 「谁负责结束这一层」 is the question every sub-task-awarding flow has to answer.
 */
export function campfireQuench(run: ChapterRun, tier: RefineTier, chance: number): ChapterRun {
  return { ...run, relicTask: { tier, chance }, resolved: run.at, rewardDue: undefined };
}

/**
 * 淬炼 a relic: every number it prints goes up by one (`small`) or two (`large`).
 *
 * Pure and additive — calling it twice just overwrites the tier, and the run cannot end up with two
 * refinements on one relic. Whether it *succeeds* is the event's business (`events.ts` rolls it), and
 * so is the price; this is only the half that changes the relic.
 */
export function refineRelic(run: ChapterRun, relicId: string, tier: RefineTier): ChapterRun {
  if (!holdsRelic(run, relicId)) return run;
  return { ...run, refined: { ...run.refined, [relicId]: tier } };
}

/**
 * 淬炼 failed — the relic is gone.
 *
 * Not `discardRelic`: the player did not choose this and there is nothing to put in the slot
 * afterward, so it takes the id rather than the slot and removes it wherever it is. This is the
 * whole price of the gamble, and it is why the event has to be a real decision.
 */
export function shatterRelic(run: ChapterRun, relicId: string): ChapterRun {
  if (!holdsRelic(run, relicId)) return run;
  const relics = { ...run.relics };
  for (const slot of ['main', 'sub'] as const) if (relics[slot] === relicId) delete relics[slot];
  return { ...run, relics, refined: withoutRefinement(run.refined, relicId) };
}

/**
 * Put the chosen relic in the fire. **This is where the gamble lands.**
 *
 * The roll comes off the run's own stream, so a run replays to the same outcome — the same reason the
 * between-fight heal does. It is spent here rather than at `resolveEvent` because the odds are a
 * property of the *option* and the outcome is a property of the *pick*, and a player who backs out of
 * the picker must not have burned a roll for it.
 *
 * The failure is `shatterRelic`, not `discardRelic`: it takes the relic wherever it is and there is
 * nothing to put in the slot afterwards. That is the entire price of the bet, and it is why the event
 * prints the percentage.
 */
export function answerRefine(run: ChapterRun, relicId: string): ChapterRun {
  const task = run.relicTask;
  if (!task || task.done || !holdsRelic(run, relicId)) return run;
  const slot = run.relics.main === relicId ? 'main' as const : 'sub' as const;
  const rolled: ChapterRun = { ...run };
  const won = nextRandom(rolled) * 100 < task.chance;
  const applied = won ? refineRelic(rolled, relicId, task.tier) : shatterRelic(rolled, relicId);
  return { ...applied, relicTask: { ...task, done: { relicId, won, slot } } };
}

/**
 * Close the reveal without changing anything.
 *
 * Split from `answerRefine` for the same reason `dismissCard` is split from `repairCard`: the result
 * screen has to stay mounted to show what happened, and it stays mounted for exactly as long as
 * `relicTask` is set. The run has already taken the outcome by the time this is called.
 */
export function dismissRefine(run: ChapterRun): ChapterRun {
  if (!run.relicTask) return run;
  return { ...run, relicTask: undefined };
}

/** Is this relic one of the two the run is carrying? */
export function holdsRelic(run: ChapterRun, relicId: string): boolean {
  return run.relics.main === relicId || run.relics.sub === relicId;
}

/** Drop a relic's entry from the refinement map. Returns `undefined` when nothing is left, so an
 *  untouched run keeps carrying `undefined` rather than an empty object that has to be validated. */
function withoutRefinement(
  refined: Record<string, RefineTier> | undefined, relicId: string,
): Record<string, RefineTier> | undefined {
  if (!refined?.[relicId]) return refined;
  const next = { ...refined };
  delete next[relicId];
  return Object.keys(next).length ? next : undefined;
}

/** The fight the run is on, or `undefined` once the chapter is done. */
export function currentEncounter(run: ChapterRun): Encounter | undefined {
  return RUN_ENCOUNTERS.find(entry => !run.cleared.includes(entry.id));
}

/** Chapter I is a line, not a map: only the next unbeaten encounter may be entered. */
export function canEnter(run: ChapterRun, encounterId: string): boolean {
  return currentEncounter(run)?.id === encounterId;
}

/**
 * Is the chapter over?
 *
 * **Every chapter encounter beaten — not five entries in the log.** It used to ask for
 * `cleared.length >= RUN_ENCOUNTERS.length`, which reads as the same thing and is not: `cleared` is
 * an append log with no de-duplication, and the map deals its fights from pools that *include* all
 * five chapter encounters as anchors. 头狼 is in the elite pool, so a run can fight it twice, and the
 * second win appends a fifth entry without the boss ever being touched. The chapter then declares
 * itself over — the preparation screen swaps to 「这一章的五个夜晚都过去了」, 开战 goes disabled, and
 * the player walks up to the boss floor and is told, permanently and in this session, that there is
 * nothing left to do.
 *
 * A reload used to be the only way out, and only by accident: `isValidRun` already refuses that save
 * (the prefix rule below), so the run was quietly discarded and the player lost their chapter instead
 * of their boss. Both now agree, because both are asking the same question about the same five ids.
 */
export function isChapterCleared(run: ChapterRun): boolean {
  return RUN_ENCOUNTERS.every(entry => run.cleared.includes(entry.id));
}

/**
 * How many of the chapter's five anchors have been beaten — **not** `cleared.length`.
 *
 * The two were the same number back when the chapter was five fights in a row. Now the tower deals
 * from pools, so `cleared` also logs `w-*` / `s-*` / `e-brood` wins and is routinely longer than the
 * chapter: rendering its length against five printed 「7/5」. Progress means anchors.
 */
export function chapterProgress(run: ChapterRun): number {
  return RUN_ENCOUNTERS.filter(entry => run.cleared.includes(entry.id)).length;
}

/**
 * Exchange the main and sub decks. The pair is what the chapter locks; which half leads is the one
 * lever the player gets between fights, so this is the whole of the per-fight deck decision.
 */
export function swapDecks(run: ChapterRun): ChapterRun {
  return { ...run, main: run.sub, sub: run.main };
}

/**
 * The shuffle seed for one fight. Derived from the run seed, so a run replays identically.
 *
 * ⚠️ **The index is into `ALL_ENCOUNTERS`, not the five anchors.** It was the anchors, and the map
 * deals pool fights far more often than anchors — so `findIndex` returned **-1 for every pool fight**
 * and they all hashed to the same seed. Every `w-*` / `s-*` / `e-brood` floor in a run opened on a
 * byte-identical shuffle: about four fights per run dealt the same hand. Anchors still get their own
 * seed each, because their indices are still distinct.
 */
export function battleSeed(run: ChapterRun, encounterId: string): number {
  const index = ALL_ENCOUNTERS.findIndex(entry => entry.id === encounterId);
  return (Math.imul(run.seed, 31) + index + 1) >>> 0;
}

/** The run's own stream. Same LCG as the engine's, so a run is reproducible to the last point. */
function nextRandom(run: ChapterRun): number {
  run.rng = (Math.imul(run.rng, 1664525) + 1013904223) >>> 0;
  return run.rng / 4294967296;
}

/** Rolls whether the sub slot opens alongside a main relic. Same stream as the heal, so a run
 *  replays to the relic as well as to the coin. */
export function rollSubSlot(run: ChapterRun): { run: ChapterRun; opens: boolean } {
  const next = { ...run };
  return { run: next, opens: nextRandom(next) < SUB_SLOT_CHANCE };
}

/** Roll this run's next relic offer. Advances the run's stream, like every other roll it makes. */
export function rollOffer(
  run: ChapterRun, pool: RelicDefinition[],
): { run: ChapterRun; options: RelicDefinition[] } {
  const next = { ...run };
  return { run: next, options: offerRelics(pool, [next.relics.main, next.relics.sub], () => nextRandom(next)) };
}

/** Rolls 9–15 and returns the run with its stream advanced. */
export function healRoll(run: ChapterRun): { run: ChapterRun; heal: number } {
  const next = { ...run };
  const roll = nextRandom(next);
  return { run: next, heal: HEAL_MIN + Math.floor(roll * (HEAL_MAX - HEAL_MIN + 1)) };
}

export interface BattleOutcome {
  run: ChapterRun;
  won: boolean;
  /** What the campfire rolled, before 皮水袋 and 干粮. Rolled only on a victory, so a defeat does not
   *  advance the stream. */
  heal: number;
  /** What the player actually gained after the relics and the cap — the number to show, not `heal`. */
  healed: number;
  /** Gold this victory paid, relics included. */
  gold: number;
  /** True when this victory beat the chapter's last encounter. */
  chapterCleared: boolean;
}

/** What a fight pays before relics. Chapter I has no economy of its own yet, so this is the whole
 *  table — 铜板 and 商队账本 are percentages and flats on top of it. */
const GOLD_BY_POOL: Record<string, [number, number]> = {
  weak: [8, 14], strong: [13, 20], elite: [25, 35], boss: [95, 105],
};

function goldFor(run: ChapterRun, state: BattleState, encounterId: string): { run: ChapterRun; gold: number } {
  const encounter = RUN_ENCOUNTERS.find(entry => entry.id === encounterId)
    ?? ALL_ENCOUNTERS.find(entry => entry.id === encounterId);
  const [low, high] = GOLD_BY_POOL[encounter?.pool ?? 'weak'] ?? [8, 14];
  // Off the run's own stream, alongside the heal, so a run still replays to the coin.
  const next = { ...run };
  const roll = nextRandom(next);
  const base = low + Math.floor(roll * (high - low + 1));
  const flat = relicModifier(state, 'victoryGold');
  const percent = relicModifier(state, 'goldBonus');
  return { run: next, gold: Math.round(base * (1 + percent / 100)) + flat };
}

/**
 * Settle a finished fight into the run. A victory keeps the player's remaining HP, adds the heal and
 * advances the line; a defeat leaves the run exactly as it was, for the caller to discard.
 *
 * A victory in anything other than the run's current encounter cannot happen through the UI; if it
 * is passed anyway the run does not advance, because `cleared` staying a prefix is the invariant the
 * rest of this module is built on.
 */
export function finishBattle(run: ChapterRun, state: BattleState): BattleOutcome {
  const nothing = { heal: 0, healed: 0, gold: 0, chapterCleared: false };
  if (state.phase !== 'won') return { run, won: false, ...nothing };
  // No linear guard any more: which fights are legal is the *map's* business now, and the map
  // already refused the step before the battle started. `cleared` is de-duplicated instead, so a
  // fight reached from two different routes cannot be counted twice.
  if (run.cleared.includes(state.encounterId)) return { run, won: true, ...nothing };

  const { run: rolled, heal } = healRoll(run);
  const paid = goldFor(rolled, state, state.encounterId);

  // 皮水袋 multiplies the campfire, 干粮 and 锡杯 add flat on top of it, and the ceiling is whatever
  // the relics made it — capping at `PLAYER_MAX_HP` would silently eat 守望者之誓's extra 15.
  const total = Math.round(heal * (1 + relicModifier(state, 'healMultiplier') / 100))
    + relicModifier(state, 'victoryHeal');
  const hp = Math.max(0, Math.min(run.maxHp, state.player.hp + total));
  // A graded victory also rolls the sub slot. Rolled here rather than when the sub offer is made so
  // the result is part of the same settled outcome — the player sees "a second slot opened" on the
  // result panel, not as a surprise two screens later.
  /**
   * 走到第几层还没有遗物的，这一场补一件。
   *
   * **遗物现在只从精英和首领掉，而精英是路线运气**：实测 200 个种子、每条路线走完整座塔，
   * **21.8% 的路线一个精英都遇不到**——把精英下限从第 6 行提到第 4 行也只压到 16.2%。那些局在打
   * boss 之前一件遗物都没有，于是「淬火石」这类奇遇对它们是一扇锁着的门，而遗物是这个 run 的成长
   * 主线，不该由路线决定有没有。
   *
   * 只补**一次**，而且是补在**还没拿到**的时候：先遇到精英的人照常从精英那里拿，保证只是托底。
   */
  const guaranteed = !run.relicGranted && (nodeAt(run)?.row ?? 0) >= FIRST_RELIC_ROW;
  const graded = earnsRelic(state.encounterId) || guaranteed;
  const sub = graded ? rollSubSlot(paid.run) : { run: paid.run, opens: false };

  const next: ChapterRun = {
    ...sub.run,
    hp,
    gold: sub.run.gold + paid.gold,
    // Appended once, ever. A pool can deal a fight the run has already won — `encounterFor` makes
    // that rare, and it pays nothing when it happens — and the second win must not write a second
    // entry: `cleared` is a set of what has been beaten, and a duplicate is both a lie about progress
    // and, because `isValidRun` refuses duplicate ids, a save that silently fails to reload.
    cleared: run.cleared.includes(state.encounterId)
      ? run.cleared : [...run.cleared, state.encounterId],
    subPending: sub.opens || undefined,
    // Recorded once, ever — the guarantee above reads it, so a run that was topped up on row 3 is not
    // topped up again on row 4.
    relicGranted: graded || run.relicGranted || undefined,
    drawDue: graded ? state.encounterId : undefined,
    nextSlot: graded ? 'main' : undefined,
    // Every victory offers a card, graded or not — that is the whole way a deck grows. The relic is
    // what the graded fights add on top.
    rewardDue: state.encounterId,
  };
  return {
    run: next, won: true, heal,
    healed: hp - state.player.hp, gold: paid.gold,
    chapterCleared: isChapterCleared(next),
  };
}

// ------------------------------------------------------------------ validation

/** Mirrors `isValidBattle`'s job: sound or not, never "winnable or not". */
/**
 * The tower is **derived, never trusted from a save**.
 *
 * `TowerMap.byId` is a `Map`, and `JSON.stringify(new Map(...))` is `{}` — so a serialized tower came
 * back as a tower with no index in it, and every run failed to reload. The map is a pure function of
 * `seed` anyway, so the fix is to stop saving it and rebuild it instead. The route (`at`, `path`) is
 * checked against the rebuilt tower, which is the only thing that needs the map to validate.
 */
function rebuildMap(run: ChapterRun): TowerMap {
  return generateMap(run.seed);
}

export function isValidRun(value: unknown): value is ChapterRun {
  if (!value || typeof value !== 'object') return false;
  const run = value as ChapterRun;
  if (run.version !== 1) return false;
  if (run.chapterId !== CHAPTER_1.id) return false;
  if (!DECK_IDS.includes(run.main) || !DECK_IDS.includes(run.sub)) return false;
  if (!isDeckUnlocked(run.main) || !isDeckUnlocked(run.sub)) return false;
  if (!Number.isInteger(run.maxHp) || run.maxHp < PLAYER_MAX_HP) return false;
  if (!Number.isInteger(run.hp) || run.hp < 0 || run.hp > run.maxHp) return false;
  if (!Number.isInteger(run.gold) || run.gold < 0) return false;

  // The route, checked against the tower the seed produces. A save written before the tower existed
  // has no `path` at all — and letting it through is what white-screened the battle page: the
  // validator said yes, so the page tried to draw a tower that was not there.
  if (!Array.isArray(run.path) || !run.path.every((id: unknown) => typeof id === 'string')) return false;
  const map = rebuildMap(run);
  if (map.nodes.length === 0 || map.startIds.length === 0) return false;
  if (!map.nodes.some(node => node.id === map.bossId)) return false;
  if (run.at !== undefined && !map.nodes.some(node => node.id === run.at)) return false;
  if (!run.path.every(id => map.nodes.some(node => node.id === id))) return false;

  // The run's own deck. It replaced a per-fight `chapterDeck` call, so a save without one has no
  // deck at all — and every card in it has to be a card that exists.
  if (!Array.isArray(run.deck) || !run.deck.length) return false;
  // Junk counts as a card here. A 奇遇 can put a hazard in the deck (`events.ts`'s `junk` effect), and
  // this check used to accept only library cards — so taking a shortcut would have written a save that
  // `loadRun` throws away, losing the whole run on the next reload. The deck screen already knows how
  // to print a card with no `CARD_BY_ID` entry; the validator did not.
  if (!run.deck.every(card => card && typeof card.cardId === 'string'
    && (CARD_BY_ID.has(card.cardId) || isJunkId(card.cardId))
    && (card.upgraded === undefined || typeof card.upgraded === 'boolean'))) return false;
  if (!run.relics || typeof run.relics !== 'object') return false;
  for (const id of [run.relics.main, run.relics.sub]) {
    if (id !== undefined && !RELIC_BY_ID.has(id)) return false;
  }
  if (run.relics.main !== undefined && run.relics.main === run.relics.sub) return false;
  // 淬炼. Every entry has to name a relic that exists **and** is being carried: one for a relic the
  // run no longer holds is a number nobody can see, and it would sit there waiting to become a free
  // upgrade the moment that relic was drawn again.
  if (run.refined !== undefined) {
    if (!run.refined || typeof run.refined !== 'object') return false;
    for (const [id, tier] of Object.entries(run.refined)) {
      if (!RELIC_BY_ID.has(id)) return false;
      if (tier !== 'small' && tier !== 'large') return false;
      if (run.relics.main !== id && run.relics.sub !== id) return false;
    }
  }
  if (run.pendingDraw !== undefined) {
    const draw = run.pendingDraw;
    if (!draw || !Array.isArray(draw.options) || !draw.options.length) return false;
    if (!draw.options.every(id => typeof id === 'string' && RELIC_BY_ID.has(id))) return false;
    if (new Set(draw.options).size !== draw.options.length) return false;
    if (draw.slot !== 'main' && draw.slot !== 'sub') return false;
    if (typeof draw.from !== 'string') return false;
  }
  if (run.subPending !== undefined && typeof run.subPending !== 'boolean') return false;
  if (run.relicGranted !== undefined && typeof run.relicGranted !== 'boolean') return false;
  if (run.drawDue !== undefined && typeof run.drawDue !== 'string') return false;
  if (run.nextSlot !== undefined && run.nextSlot !== 'main' && run.nextSlot !== 'sub') return false;
  if ((run.drawDue === undefined) !== (run.nextSlot === undefined)) return false;
  if (run.rewardDue !== undefined && typeof run.rewardDue !== 'string') return false;
  if (run.resolved !== undefined && typeof run.resolved !== 'string') return false;
  if (run.pendingReward !== undefined && !REWARD_BY_ID.has(run.pendingReward)) return false;
  if (run.cardTask !== undefined && !['pick', 'remove', 'polish', 'duplicate'].includes(run.cardTask)) return false;
  if (run.cardReveal !== undefined) {
    const reveal = run.cardReveal;
    if (!reveal || typeof reveal !== 'object' || typeof reveal.from !== 'string') return false;
    if (!Array.isArray(reveal.gained) || !reveal.gained.length) return false;
    for (const offer of reveal.gained) {
      if (!offer || typeof offer.cardId !== 'string' || !CARD_BY_ID.has(offer.cardId)) return false;
    }
    if (reveal.lost !== undefined && !CARD_BY_ID.has(reveal.lost)) return false;
  }
  if (run.relicTask !== undefined) {
    const task = run.relicTask;
    if (!task || (task.tier !== 'small' && task.tier !== 'large')) return false;
    if (!Number.isInteger(task.chance) || task.chance < 0 || task.chance > 100) return false;
    if (task.done !== undefined) {
      // The reveal is on screen: the outcome has already been applied, so a save reloaded here must
      // find the relic in the state the roll left it. `won` and the relic have to agree.
      if (typeof task.done.won !== 'boolean' || typeof task.done.relicId !== 'string') return false;
      if (task.done.slot !== 'main' && task.done.slot !== 'sub') return false;
      if (!RELIC_BY_ID.has(task.done.relicId)) return false;
      const isRefined = run.refined?.[task.done.relicId] !== undefined;
      const stillHeld = run.relics.main === task.done.relicId || run.relics.sub === task.done.relicId;
      if (task.done.won !== (isRefined && stillHeld)) return false;
    }
    // A 淬炼 with nothing to quench would open a picker with no cards in it. Unreachable through the
    // UI (`requires.relic` gates the option), which is exactly why it is worth refusing here.
    //
    // ⚠️ **Only while the bet is still open.** Once `done` is set, an empty pair of slots is the
    // *expected* state — it is what 碎了 leaves behind, and the reveal screen is still mounted on it.
    // Checking it unconditionally rejected exactly the save the player was looking at, so a refresh
    // there threw the whole run away.
    if (!task.done && !run.relics.main && !run.relics.sub) return false;
  }
  if (run.cardOptions !== undefined) {
    if (!Array.isArray(run.cardOptions) || !run.cardOptions.length) return false;
    // ⚠️ Each entry is a **`CardOffer`**, not a bare id — it carries whether the card is 已打磨 and
    // whether it came from outside the run's pool, and both have to survive a reload to still be true.
    // The check still read `typeof id === 'string'` after the shape changed, so **every save taken on
    // the card-picker screen was silently refused** and the run vanished on refresh.
    for (const offer of run.cardOptions) {
      if (!offer || typeof offer !== 'object') return false;
      if (typeof offer.cardId !== 'string' || !CARD_BY_ID.has(offer.cardId)) return false;
      if (offer.upgraded !== undefined && typeof offer.upgraded !== 'boolean') return false;
      if (offer.beyond !== undefined && typeof offer.beyond !== 'boolean') return false;
      if (offer.hidden !== undefined && typeof offer.hidden !== 'boolean') return false;
    }
    if (new Set(run.cardOptions.map(offer => offer.cardId)).size !== run.cardOptions.length) return false;
  }
  if (!Array.isArray(run.cleared)) return false;
  if (!run.cleared.every(id => typeof id === 'string')) return false;
  // Membership and uniqueness — **not order**. It used to demand that `cleared` be a prefix of the
  // chapter's order, which was true when the chapter was a line and is not true now that the map
  // deals its fights: every pool holds the chapter's anchors, so 头狼 can be dealt after 余烬守望者
  // would have been, and the log ends up out of sequence through no fault of the player's. The prefix
  // rule threw those runs away on reload. What it was actually protecting against — a hand-edited
  // save that skips to the boss — is membership.
  //
  // ⚠️ **Membership is `ALL_ENCOUNTERS`, not the five anchors.** It was the anchors, and that made
  // every run that won a *pool* fight save itself into a state this function refuses — `finishBattle`
  // logs whatever `state.encounterId` it was handed, and the map deals `w-*` / `s-*` / `e-brood` far
  // more often than it deals an anchor. `loadRun` drops an invalid run rather than repairing it, so
  // the player's whole chapter vanished on the next reload. Roughly half of every run's fights are
  // pool fights, so this was not an edge case; it was the normal path.
  //
  // No-skip still holds because `cleared` is not what decides the chapter any more — `isChapterCleared`
  // asks whether each of the five anchors is in it. An id that names no encounter at all is still
  // refused, and duplicates are still refused, so five entries cannot cover five anchors while naming
  // something else.
  if (!run.cleared.every(id => ALL_ENCOUNTERS.some(entry => entry.id === id))) return false;
  if (new Set(run.cleared).size !== run.cleared.length) return false;
  if (!Number.isInteger(run.seed) || !Number.isInteger(run.rng) || run.rng < 0 || run.rng > 0xFFFFFFFF) return false;
  return true;
}

// ----------------------------------------------------------------- persistence

export const RUN_KEY = 'eternal-night-chapter-run-v1';

/** Absent in node, and throwing in a locked-down browser — both just mean "no save". */
function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** A run that fails validation is dropped rather than repaired: a half-trusted run is worse than none. */
export function loadRun(): ChapterRun | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(RUN_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isValidRun(parsed)) return null;
    // Put the tower back. It was never in the save; the seed is.
    return { ...parsed, map: rebuildMap(parsed) };
  } catch {
    return null;
  }
}

/** The tower is left out on purpose: it is derived from the seed, and a `Map` does not survive JSON
 *  — saving it wrote `byId: {}` and every reload came back with a tower that had no index. */
export function saveRun(run: ChapterRun) {
  try {
    const { map, ...rest } = run;
    void map;
    storage()?.setItem(RUN_KEY, JSON.stringify(rest));
  } catch { /* Private mode still plays. */ }
}

export function clearRun() {
  try { storage()?.removeItem(RUN_KEY); } catch { /* Fine. */ }
}
