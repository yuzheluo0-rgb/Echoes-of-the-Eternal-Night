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

import { CARD_BY_ID, DECK_IDS, TIER_BY_ID, type DeckId } from '../cards/index.ts';
import { CHAPTER_1, chapterDeck, isDeckUnlocked } from './chapter.ts';
import {
  PROPS, PROP_BY_ID, PROP_SLOTS, afterUse, clearSlot, emptyProps, placeIn, propsUsableIn,
  type PropDefinition, type PropSlotState,
} from '../props/props.ts';
import { runPropEffectFor, type RunPropEffect } from './props.ts';
import { RELIC_BY_ID, type RelicDefinition } from '../relics/relics.ts';
import type { RefineTier } from './relics.ts';
import { generateMap, reachableFrom, type MapNode, type TowerMap } from './map.ts';
import { isUpgradable } from './upgrades.ts';
import {
  REWARD_BY_ID, fullDeckPool, rewardCardPool, rollCardOffer, rollReward, type CardOffer,
} from './rewards.ts';
import type { EventEffect, EventOption } from './events.ts';
import { SUB_SLOT_CHANCE, offerRelics } from './relicDraw.ts';
import {
  STAT_GOODS, SHOP_SLOTS, canPayWith, isValidShop, relicValueOf, removePrice, shopRerollCost,
  rollShopSlots, type PayWith, type ShopSlot, type ShopState,
} from './shop.ts';

/**
 * 商店那一套的再出口。
 *
 * `rollShop` / `buyShopSlot` 这一组本来就写在这个文件里，而 `canPayWith`、`PayWith`、`ShopSlot`
 * 住在 `shop.ts`（那里是纯数据，不 import 这个文件）。**两边都能导入**，免得界面为了一个谓词记住
 * 它到底住在哪一层——多写一行 `export`，少一次「为什么导不到」。
 */
export { canPayWith, shopRerollCost, SHOP_SLOTS };
export type { PayWith, ShopSlot, ShopState };
import { PLAYER_MAX_HP, isJunkId, relicModifier, validProps, type BattleCard, type BattleState } from './engine.ts';
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
  /**
   * The ceiling. Starts at `PLAYER_MAX_HP`; rewards and 奇遇 raise it, **and 道具 may lower it**
   * （夜祷书 生命上限 −10）. It never falls below 1 — see `useRunProp` and `isValidRun`. The battle
   * layer still refuses a ceiling under `PLAYER_MAX_HP` (`isValidBattle`), so a fight opens at the
   * baseline and comes back to whatever the run is carrying.
   */
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
  /**
   * 三个道具槽。定长三个，`null` 是空槽——形状与 `BattleState.props` 逐字段相同
   * （都来自 `src/props/props.ts`），进战斗时逐槽复制、出来时采纳回来，见 `finishBattle`。
   */
  props?: PropSlotState[];
  /** 一件已拾得、还没放下的道具。和 `relicTask` 同一个理由：这是玩家还没答完的决定，而要落盘。 */
  propTask?: { id: string; from: string };
  /** 下一场胜利的掉落概率（百分点）。基础 35，没掉 +12，掉了 −15，钳在 [5,75]。存**数**而不是每次重算。 */
  propLuck?: number;
  /** 本局是否已经吃过兜底掉落。⚠️ 判据是它，**不是「props 是否为空」**——否则把三件不喜欢的丢掉就能再刷一轮。 */
  propGranted?: boolean;
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
   * 这一家商店的货架。**只在「站在一家还没结算的商店上」时有意义**——踏进任何一个节点都会把它丢掉
   * （见 `enterNode`），然后在踏进商店时重掷一次（`rollShop`）。
   *
   * 它落盘，所以刷新一次店里还是那批货、还是那个刷新次数。它**不**存在地图上：`MapNode` 只说自己
   * 是什么类型，具体卖什么要等玩家站上去才掷——和「节点上没有 `encounterId`」是同一条规矩。
   */
  shop?: ShopState;
  /**
   * 商店买来的那条命：本局下一次致命伤害为你留下 1 点生命。
   *
   * ⚠️ **它不是一条新规则，是同一件事的第三个来源。** 项目里已经有两个实现了「下一次致死伤害留
   * 1 点」——道具「残烛」写下的 `marks['prop:deathWard']`，和遗物的 `lethalSave`（铁面具）。商店
   * 卖的就是**第一个**（残烛那一个）：进战斗时由 `wardMark()` 把同一个记号带上，用完由
   * `finishBattle` 把它清掉。见 `wardMark` 上面那段「引擎要改哪一行」。
   */
  warded?: boolean;
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
    props: emptyProps(),
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
    // ⚠️ 封顶跟 `maxHp` 走，**不是 `PLAYER_MAX_HP`**（`finishBattle` 那条注释说的是同一件事）。
    // 上限一旦能被道具压低（夜祷书 −10），写死 60 就会把生命回到上限之上——而 `isValidRun` 拒绝
    // `hp > maxHp`，于是玩家刷新一下整局就没了。
    case 'heal': return { ...paid, hp: Math.min(paid.maxHp, paid.hp + effect.amount) };
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
    // 道具：掷一件出来，挂成「还没放下」的 `propTask`。**这里不是 `BattleOutcome.propDrop` 那条路**
    // ——那个是战后掉落的，由战果面板当场放进格子；宝箱是在塔上开的，走的是 `propTask` + 放道具屏。
    case 'prop': return stageProp(paid, '战利品', TOWER_PROP_POOL);
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
    // 一件道具，和 `relic` 一样是「捡到的东西」——所以同样停在「还没放下」上等玩家回答。
    // ⚠️ **不做概率**：`refine` 是全表唯一的概率效果，而它的成算是**印在结果行上**的；
    // 给一件道具加上概率，`outcomeLine` 就会开始说谎（「得到一件道具」而可能什么都得不到）。
    case 'prop': return stageProp(afterCost, '奇遇', TOWER_PROP_POOL);
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
  /**
   * ⚠️ 上一层的货架留在上一层。
   *
   * 用解构**把 `shop` 整个摘掉**，而不是写 `shop: undefined`——`isValidRun` 不要求 `shop` 存在，
   * 而一份「键在、值是 undefined」的 run 过一个来回会变样（JSON 会把它丢掉），于是
   * `deepEqual(round, wire)` 这种存档往返测试会莫名其妙地红。`resolved: undefined` 是先例，
   * 不是可以照抄的样板。
   */
  const { shop: _left, ...rest } = run;
  void _left;
  const next: ChapterRun = { ...rest, at: nodeId, path: [...run.path, nodeId], resolved: undefined };
  // The fight is decided here, at the threshold, and kept on the run so the preparation screen, the
  // battle and a reload all agree about what is standing on this floor.
  if (node.kind === 'combat' || node.kind === 'elite' || node.kind === 'boss') {
    const stamped = { ...next };
    return { ...next, currentFight: encounterFor(node, () => nextRandom(stamped), next.cleared) };
  }
  // 商店的货架也是在这里掷的，和战斗一样是「踏进来才知道」。放这里而不是只留给界面调一次，
  // 是因为界面那条路（照宝箱的 `enterFloor`）忘了调的表现是「一家空店」，而 `rollShop` 是幂等的，
  // 两边都调也不会换一批货。
  if (node.kind === 'shop') return rollShop(next);
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

  /**
   * **The chapter's five fights come first.**
   *
   * ⚠️ They used to come out of the pool with everything else, and the pools do not hold them evenly:
   * `strong` holds **none** of the five, while `elite` holds **two** of them (ch1-3 and 头狼) among
   * three fights. A route passes about 1.2 elite nodes, so it cannot win both — measured over 200
   * seeds, **71% of routes fail to meet all five**, and 头狼 specifically was missed **66.5%** of the
   * time. The chapter's own win condition was unreachable for most runs.
   *
   * So an unbeaten anchor is dealt ahead of the pool, and the elite-grade ones may also stand on an
   * ordinary 战斗 floor **from `ELITE_ANCHOR_ROW`** — early rows still read 「一场寻常的遭遇」, and the
   * top of the tower is where this chapter's hard fights live. They keep their own `kind` and their
   * own relic payout (`earnsRelic` reads the encounter, not the node), so nothing else changes.
   *
   * Unbeaten only, and that is what keeps this from being free: a re-won anchor pays nothing, so the
   * pool still takes over as soon as the chapter is satisfied.
   */
  const anchors = ALL_ENCOUNTERS.filter(entry =>
    ANCHOR_IDS.has(entry.id) && !beaten.includes(entry.id)
    && (node.kind === 'elite'
      ? entry.pool === 'elite'
      : entry.pool !== 'boss' && (entry.pool !== 'elite' || node.row >= ELITE_ANCHOR_ROW)));
  if (anchors.length) return anchors[Math.floor(roll() * anchors.length)].id;

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
/** The chapter's five fights, by id — the spine `encounterFor` deals ahead of the pools. */
const ANCHOR_IDS = new Set(RUN_ENCOUNTERS.map(entry => entry.id));

/**
 * From this row up, the two **elite-grade** anchors (失落的商队 and 头狼) may also stand on an ordinary
 * 战斗 floor. See the note in `encounterFor`: they used to live only in the `elite` pool, which a route
 * passes about 1.2 times, so the chapter could not be finished.
 */
const ELITE_ANCHOR_ROW = 8;

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
  // 只能装在主槽的那几件（见 `RelicDefinition.mainOnly`）：**在 run 这一层拒绝**，不是只把界面上的
  // 按钮置灰——界面是提示，这里是规则。存档校验（`isValidRun`）另有一道。
  if (placeIn === 'sub' && RELIC_BY_ID.get(relicId)?.mainOnly) return run;
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

// ------------------------------------------------------------------ 道具

/**
 * 三个槽里现在有什么。
 *
 * `props` 是后加的字段，老存档里没有它（`isValidRun` 也不强制要求），所以每个读它的地方都先过这一层。
 * ⚠️ 有槽时返回的是 run 里**那个数组本身**——调用方要么只读，要么用 `placeIn` / `clearSlot` 那类
 * 会复制一份的入口去改。
 */
export function propSlots(run: ChapterRun): PropSlotState[] {
  return run.props ?? emptyProps();
}

/**
 * 战斗掉落的池子：**营火专用的那几件不进战斗掉落**。
 *
 * 判据是 `use` 而不是别的：净灯 / 灰誓 / 袖炉要开 run 的选牌器，而选牌器在战斗页的分派顺序里
 * 排在战斗本体**之前**，战斗里一置上它整张战斗页会被顶掉（见 `PropDefinition.deck`）。
 */
const BATTLE_PROP_POOL = propsUsableIn('battle');

/**
 * 塔上拾取（宝箱 / 奇遇）的池子：**全部**道具。
 *
 * ⚠️ 这里和战斗掉落**故意不同**。净灯 / 灰誓 / 袖炉是 `camp`，而它们唯一的来源就是塔上拾取：
 * 把这里也写成 `propsUsableIn('battle')` 的话，那三件一辈子也拿不到，`PROPS` 里就多了三行
 * **玩家永远见不到**的数据（`run.test.ts` 有一条盯着这件事）。拿到之后走到下一个营火就能用
 * ——`camp` 说的本来就是「战斗外」，而塔上到处都是营火。
 */
const TOWER_PROP_POOL = PROPS;

/** 加权的掉落抽取。和 `rollReward` / `drawRelics` 同一条规矩：权重在数据层，掷点由调用方给。 */
function rollProp(pool: PropDefinition[], roll: () => number): PropDefinition | undefined {
  const total = pool.reduce((sum, prop) => sum + prop.weight, 0);
  if (total <= 0) return undefined;
  let ticket = roll() * total;
  for (const prop of pool) {
    ticket -= prop.weight;
    if (ticket <= 0) return prop;
  }
  return pool[pool.length - 1];
}

/** 掷一件出来、挂成「还没放下」。塔上的拾取走这条；战果面板那条不经过 `propTask`。 */
function stageProp(run: ChapterRun, from: string, pool: PropDefinition[]): ChapterRun {
  const next = { ...run };
  const picked = rollProp(pool, () => nextRandom(next));
  if (!picked) return next;
  return { ...next, propTask: { id: picked.id, from } };
}

/**
 * 把手上那一件放进**玩家指定的**槽，替换掉原本在那儿的。
 *
 * 和 `claimRelic` 同一个语义：**从不问「槽满了吗」**——三格都占着的时候，玩家点哪一格就是拿哪一格
 * 去换，那三个按钮存在的意义正是这个。
 *
 * `id` 省缺时用 `propTask` 上那一件（塔上的拾取、宝箱、奇遇）。战果面板把它那件**直接传进来**，
 * 因为掉落面板全程不经过 `propTask`：`finishBattle` 一挂上 `propTask`，塔上的分派器就会把战果
 * 面板顶掉，玩家连「这仗打赢了」都看不到。见 `BattleOutcome.propDrop`。
 */
export function placeProp(run: ChapterRun, slot: number, id?: string): ChapterRun {
  const wanted = id ?? run.propTask?.id;
  if (!wanted || !PROP_BY_ID.has(wanted)) return run;
  if (!Number.isInteger(slot) || slot < 0 || slot >= PROP_SLOTS) return run;
  return {
    ...run,
    props: placeIn(propSlots(run), slot, wanted),
    propTask: undefined,
    propGranted: true,
  };
}

/**
 * 「不要」。三格都称手时这是真答案，所以它**只**清掉那件待放的道具。
 *
 * 它不动 `propGranted`：**拒收**一件不是**收下**一件。塔上捡到又被拒收的那一件因此不留标记，
 * 于是这一局如果身上还是空的，兜底的那件还会再来一次——那正是兜底该有的样子。
 * （战后的掉落是另一回事：那一件**已经掉出来了**，所以 `finishBattle` 当场就把标记立上，
 * 玩家后来把身上三件都丢掉也不会再刷一轮。）
 */
export function dismissProp(run: ChapterRun): ChapterRun {
  if (!run.propTask) return run;
  return { ...run, propTask: undefined };
}

/** 丢掉一格（照 `discardRelic`）。 */
export function discardProp(run: ChapterRun, slot: number): ChapterRun {
  const slots = propSlots(run);
  if (!Number.isInteger(slot) || !slots[slot]) return run;
  return { ...run, props: clearSlot(slots, slot) };
}

/** 掉落的基础概率（百分点）。 */
export const PROP_LUCK_BASE = 35;
/** 没掉的时候下一次加多少。 */
export const PROP_LUCK_MISS = 12;
/** 掉了之后下一次减多少——比加的多，所以运气会自己回到中间，而不是一路爬到必掉。 */
export const PROP_LUCK_HIT = -15;
export const PROP_LUCK_MIN = 5;
export const PROP_LUCK_MAX = 75;

/** 遭遇池再加一档。**首领比精英还高一档**：越难的仗越该给点东西，而道具是消耗品，不破坏曲线。 */
export const PROP_DROP_BONUS: Record<string, number> = { weak: 0, strong: 8, elite: 25, boss: 40 };

/**
 * 第几层还没有道具的，赢一场就补一件。**比遗物的 3 早一行**——道具是消耗品，早给一件不破坏曲线，
 * 而第 1 行本来就是教学战（一个只有一场仗打过的新玩家还不需要决定带什么）。
 */
export const FIRST_PROP_ROW = 2;

function clampLuck(value: number): number {
  return Math.max(PROP_LUCK_MIN, Math.min(PROP_LUCK_MAX, Math.round(value)));
}

/**
 * 这一次要用描述符里的哪一半。
 *
 * 描述符上的每一格**默认全部照做**——灰誓是 `{ task: 'remove', maxHp: 6 }`，两半都要落
 * （「摧毁牌库里的一张牌，生命上限 +6」），`half` 对它毫无意义。
 *
 * ⚠️ **袖炉是唯一的例外**：描述符里两半都写着（`{ task: 'polish', heal: 15 }`），而它印出来的文案
 * 是「**二选一**：回复 15 点生命，或打磨牌库里的一张牌」。所以它必须由界面指定用哪一半；省缺按
 * `'effect'`（回血）走——一个会自己开屏的默认值比一个安静回血的默认值危险得多。
 */
export type PropHalf = 'task' | 'effect';

/**
 * 两半都写在描述符里、而文案说的是「或」的那几件。见 `PropHalf`。
 *
 * 导出是为了让测试能拿它和文案对一遍：**印出来的「二选一」三个字就是这份名单的判据**。
 * 名单和文案一旦分家，两边都会说谎——多写一件等于那件少做一半，少写一件等于袖炉多做一半。
 */
export const EITHER_OR_PROPS = new Set(['pocket-forge']);

/** 这件道具这一次要不要用「改牌库」那半（挂 `cardTask`）。 */
function wantsTask(id: string, effect: RunPropEffect, half: PropHalf): boolean {
  if (!effect.task) return false;
  return !EITHER_OR_PROPS.has(id) || half === 'task';
}

/** 这件道具这一次要不要用数值那半。 */
function wantsValue(id: string, half: PropHalf): boolean {
  return !EITHER_OR_PROPS.has(id) || half === 'effect';
}

/**
 * 界面上置灰用。真正的判定在 `useRunProp` 里重做一遍——和 `canPlay` / `canAfford` / `canUseProp`
 * 同一套：置灰是提示，不是规则。
 */
export function canUseRunProp(run: ChapterRun, slot: number, half: PropHalf = 'effect'): boolean {
  const entry = propSlots(run)[slot];
  if (!entry || entry.uses <= 0) return false;
  const def = PROP_BY_ID.get(entry.id);
  const effect = def ? runPropEffectFor(def.id) : undefined;
  if (!def || !effect) return false;
  return canPay(run, effect, wantsValue(def.id, half));
}

/** 描述符里的代价付不付得起。付不起的一律**整体拒绝**，连次数都不扣。 */
function canPay(run: ChapterRun, effect: RunPropEffect, valueWanted: boolean): boolean {
  if (!valueWanted) return true;
  if (effect.gold && effect.gold < 0 && run.gold + effect.gold < 0) return false;
  // 圣物匣：没有主遗物就没有可烧的东西。静默地什么都不做会让这一格看起来是坏的。
  if (effect.eatRelic && !run.relics.main) return false;
  return true;
}

/**
 * 用掉一格道具。**改 run 的那九件走这里**（战斗那二十八件走引擎的 `useProp`）。
 *
 * 和 `useProp` 的两条不同，都是「这是 run 层」的直接后果：
 *
 *   - **不抛错，拒绝就原样退回**（和 `spendGold` / `campfire` / `discardRelic` 同一个形状）。
 *     付不起的 80 金币、不在身上的主遗物，都只是「这一次点不动」，界面用 `canUseRunProp` 置灰。
 *   - **不结束这一层。** 在营火边用道具是在回答营火**之前**做的事：`resolved` 只能由
 *     `campfire` / `resolveEvent` 那种「这一层的答案」去设（`campfireQuench` 上记着这条教训）。
 *
 * 数值那一半当场应用，改牌库的那一半挂 `cardTask`——**复用现成的选牌器，一行新界面都不用写**。
 */
export function useRunProp(run: ChapterRun, slot: number, half: PropHalf = 'effect'): ChapterRun {
  const entry = propSlots(run)[slot];
  if (!entry || entry.uses <= 0) return run;
  const def = PROP_BY_ID.get(entry.id);
  const effect = def ? runPropEffectFor(def.id) : undefined;
  if (!def || !effect) return run;
  const valueWanted = wantsValue(def.id, half);
  if (!canPay(run, effect, valueWanted)) return run;

  let next: ChapterRun = { ...run };

  if (valueWanted) {
    /**
     * 生命上限先定下来，当前生命才好跟着钳。
     *
     * ⚠️ **run 的生命上限可以被压低**（夜祷书 −10），而「只许抬高不许降低」是**战斗**的不变量
     * （`isValidBattle` 钉着它，`startBattle` 进战斗时会把上限抬回基准值）。所以这里只守一条底线：
     * 不低于 1——上限 0 的 run 是一个永远回不了血的 run。
     */
    if (effect.maxHp) {
      const ceiling = Math.max(1, next.maxHp + effect.maxHp);
      next = { ...next, maxHp: ceiling, hp: Math.min(next.hp, ceiling) };
    }
    // 空心齿：当前生命减半，减掉的那一半加到上限上。取整向上——留下的那半至少有一口。
    if (effect.halveIntoMaxHp) {
      const before = next.hp;
      const kept = Math.ceil(before / 2);
      next = { ...next, hp: kept, maxHp: next.maxHp + (before - kept) };
    }
    // ⚠️ 回血封顶跟 `maxHp` 走（`finishBattle` 那条注释说的是同一件事）。
    if (effect.heal) next = { ...next, hp: Math.min(next.maxHp, next.hp + effect.heal) };
    // ⚠️ **道具不会杀死你**：这是 run 层，扣到 0 就钳在 1。奇遇那条「事件不能是杀死玩家的东西」
    // 是同一个理由——一件道具用出一次死亡，是 bug 不是难度。
    if (effect.loseHp) next = { ...next, hp: Math.max(1, next.hp - effect.loseHp) };
    if (effect.gold) next = { ...next, gold: Math.max(0, next.gold + effect.gold) };
    if (effect.eatRelic) next = discardRelic(next, 'main');
    // 陪葬钱：照 `finishBattle` 发遗物的那条路走（`drawDue` + `nextSlot`，由塔上的分派器
    // 去掷那一手）。`drawDue` 在这一层只是个「哪来的」的字符串。
    if (effect.gainRelic) next = { ...next, drawDue: def.id, nextSlot: 'main' };
    if (effect.gainCard) next = gainTypedCard(next, effect.gainCard, def.name);
  }
  if (wantsTask(def.id, effect, half)) next = { ...next, cardTask: effect.task };

  // 次数最后扣，而且**扣在返回的那一份上**：中途任何一处 `return run` 都不会白花一次。
  const left = afterUse(entry.uses);
  const slots = propSlots(next).map(slotValue => (slotValue ? { ...slotValue } : null));
  slots[slot] = left > 0 ? { ...entry, uses: left } : null;
  return { ...next, props: slots };
}

/**
 * 从本牌组随机加一张，**并且摆出来**。
 *
 * 摆出来是关键：不摆的话玩家读到的只有一句「获得一张本牌组的稀有牌」，而那一张是什么永远看不到
 * ——和「一捆牌」当初一模一样的问题，见 `gainCards` 上的说明。
 *
 * `rare` 取的是**本牌组现有池子里最高的那一档**（`TIERS` 的 `rank`），不是写死 `starfall`：
 * 第一章解锁的牌里根本没有星陨，写死它等于这件道具什么都不给。
 */
function gainTypedCard(run: ChapterRun, want: 'rare' | 'any', from: string): ChapterRun {
  const pool = rewardCardPool(run.main, run.sub);
  if (!pool.length) return run;
  const chosen = want === 'rare' ? topTier(pool) : pool;
  const next = { ...run };
  const cardId = chosen[Math.floor(nextRandom(next) * chosen.length)];
  if (!cardId) return run;
  return { ...next, deck: [...next.deck, { cardId }], cardReveal: { gained: [{ cardId }], from } };
}

/** 池子里稀有度最高的那一档。牌表里的每一张都有档位，查不到的一律按最低算。 */
function topTier(pool: string[]): string[] {
  const rank = (id: string) => {
    const tier = CARD_BY_ID.get(id)?.tier;
    return (tier && TIER_BY_ID.get(tier)?.rank) ?? 0;
  };
  const best = Math.max(...pool.map(rank));
  return pool.filter(id => rank(id) === best);
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
  /**
   * Relics the fight **destroyed** — 血云雾霭之卷 burning itself out to save you. Empty on every other
   * victory, and empty on a defeat because a defeat hands the run back untouched.
   *
   * The result panel reads it: losing a relic is the kind of thing that has to be said out loud, and
   * the log line that announced it is two screens back by then.
   */
  brokenRelics: string[];
  /**
   * 这一场用掉了什么，一格一条。
   *
   * ⚠️ **方向和 `brokenRelics` 正好相反。** 那个是战斗在 `marks` 上留记号、run 照它摘遗物；道具反过来
   * ——**战斗里的 `props` 是真相**（`useProp` 就地扣次数），run 只是把它抄回货架，这里是两者的差额。
   * 一个「用了两次窥管」的结果面板，理由和 `brokenRelics` 一样：用完的东西要当场说出来，
   * 而战斗日志到那时已经翻过去两屏了。
   */
  spentProps: { id: string; used: number; left: number }[];
  /**
   * 这一场胜利掉了一件道具——**id 在这里定，放进哪一格是玩家的动作**（`placeProp`）。
   *
   * ⚠️ **不能写成 `run.propTask`。** 战果面板在塔上的分派顺序里排在 `propTask` 那些屏**之后**，
   * 所以 `finishBattle` 一挂上 `propTask`，塔上的分派器就会先渲染放道具屏——玩家连「这仗打赢了」
   * 都看不到。掉落面板因此把 id 带在结果里，由结果面板自己渲染那三个格子。
   * `propTask` 只服务塔上的拾取（宝箱 / 奇遇）。
   */
  propDrop?: string;
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
  // A defeat hands the run back untouched — including its relics and its props, so nothing was broken
  // and nothing was spent by it. ⚠️ `spentProps` has to be here as well as on a victory: the panel
  // reads it on both paths, and a missing field is a crash rather than a zero.
  const nothing = { heal: 0, healed: 0, gold: 0, chapterCleared: false, brokenRelics: [], spentProps: [] };
  if (state.phase !== 'won') return { run, won: false, ...nothing };
  // No linear guard any more: which fights are legal is the *map's* business now, and the map
  // already refused the step before the battle started. `cleared` is de-duplicated instead, so a
  // fight reached from two different routes cannot be counted twice.
  // 重复的胜仗不改 run，但**免死这一件例外**：这一场里如果那条命被用掉了，它就在这一场用掉了，
  // 和「这场仗给不给奖励」无关。见 `settleWard`。
  if (run.cleared.includes(state.encounterId)) return { run: settleWard(run, state), won: true, ...nothing };

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

  /**
   * 道具掉落。
   *
   * ⚠️ **掷点追加在既有的三个之后**（`healRoll` → `goldFor` → `rollSubSlot`）。插在中间会把每一个
   * 既有种子的回血、金币和「开副槽」全部推移一格——`run.test.ts` 那条「同一条 run 重放两次完全
   * 相同」当场变红，而真正的代价是**所有玩家存档里那条流都对不上了**。
   *
   * 概率模型见 `ChapterRun.propLuck`：存的是数（基础 35，没掉 +12、掉了 −15，钳在 [5,75]），
   * 遭遇池再叠一档（弱 0 / 强 8 / 精英 25 / 首领 40），合成出来的这一次也钳一次。
   *
   * 保底和遗物那条同构，只是一行更早（`FIRST_PROP_ROW`）：判据是 run 自己的标记，**不是
   * 「props 是否为空」**——用后者的话，把三件不喜欢的丢掉就能再刷一轮。
   */
  const dropRoll = (() => {
    const next = { ...sub.run };
    const roll = nextRandom(next);
    const pool = ALL_ENCOUNTERS.find(entry => entry.id === state.encounterId)?.pool ?? 'weak';
    const luck = clampLuck(sub.run.propLuck ?? PROP_LUCK_BASE);
    const chance = clampLuck(luck + (PROP_DROP_BONUS[pool] ?? 0));
    const owed = !run.propGranted && (nodeAt(run)?.row ?? 0) >= FIRST_PROP_ROW;
    const picked = roll * 100 < chance || owed
      ? rollProp(BATTLE_PROP_POOL, () => nextRandom(next)) : undefined;
    // 概率跟着**实际掉没掉**走，不是跟着掷点走：保底补上的那一件也是一次掉落。
    return { run: next, drop: picked, luck: clampLuck(luck + (picked ? PROP_LUCK_HIT : PROP_LUCK_MISS)) };
  })();

  /**
   * 道具的结算：**采纳，不是撤销**。
   *
   * ⚠️ 方向和 `brokenRelics` 正好相反。遗物那边是战斗在 `marks` 上留一串 `broken:<id>` 记号、run
   * 照着把遗物摘掉；道具反过来——`useProp` 已经把次数**就地扣在 `state.props` 上了**，所以战斗里那
   * 一份才是真相，run 只是把它抄回自己的货架。`spentProps` 是两者的差额，给结果面板读。
   *
   * ⚠️ **`state.props` 缺失时回退成 `run.props`**，绝不能写成 `undefined`：`props` 是后加的字段，
   * 一份早先写下的战斗存档里没有它，而一次「误采纳」会让玩家整包道具凭空消失。
   */
  const carried = (state.props && validProps(state.props) ? state.props : propSlots(run))
    .map(entry => (entry ? { ...entry } : null));
  const spentProps = propSlots(run).flatMap((before, slot) => {
    if (!before) return [];
    const after = carried[slot];
    // 同一格换了另一件（未拆的信把这一格换成了别的东西）：那一件是**用掉**了，而新来的那件不算
    // 「用掉」。`after` 为 `null` 是「用完最后一次」，走的是下面同一条路。
    const same = after?.id === before.id;
    const left = same ? after!.uses : 0;
    const used = before.uses - left;
    return used > 0 ? [{ id: before.id, used, left }] : [];
  });

  const next: ChapterRun = {
    ...dropRoll.run,
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
    // 战斗里的那一包是真相，这里把它抄回货架。见上面 `spentProps` 的说明。
    props: carried,
    // 掉出来的那一件**不写进 `props`**：放进哪一格是玩家的动作（`placeProp`），掉落面板拿着
    // `propDrop` 去渲染那三个格子。这里只把概率的账记下。
    propLuck: dropRoll.luck,
    // 记一次就够，而且是**真的拿到过**才记：兜底读它，所以记早了会把托底吃掉。
    propGranted: (!!dropRoll.drop) || run.propGranted || undefined,
  };
  /**
   * 血云雾霭之卷 在战斗里烧掉了自己。
   *
   * ⚠️ **战斗不能自己把它从 run 里拿走**，因为它只拿到一份 `state`：它在 `state.relics` 里摘掉那一格、
   * 在 `marks` 上留一个 `broken:<id>` 记号，真正拥有遗物的是 run，所以由这里结算——和回血、金币、
   * `cleared` 走同一条路。
   *
   * 顺带把它的淬炼档位一起清掉：一件不在身上的遗物留着一个档位，下次抽到同一件会带着上一次的
   * 淬炼回来，而那是**已经烧掉的那一卷**的档位。
   */
  // ⚠️ **只报 run 真的带着的那些。** 记号是战斗留在 `marks` 上的，而 `finishBattle` 只拿到一份 state
  // ——把状态里的每一个记号都当成「碎了一件」来报，会在战斗与 run 对不上的时候（换过主副、或者
  // 调用方拿错了 state）给玩家看一条不存在的损失。
  const broken = Object.keys(state.marks ?? {})
    .filter(key => key.startsWith('broken:'))
    .map(key => key.slice('broken:'.length))
    .filter(id => run.relics.main === id || run.relics.sub === id);
  const survivingRelics = broken.length ? (() => {
    const held = { ...next.relics };
    for (const slot of ['main', 'sub'] as const) if (held[slot] && broken.includes(held[slot]!)) delete held[slot];
    return held;
  })() : next.relics;
  const survivingRefined = broken.length
    ? Object.fromEntries(Object.entries(next.refined ?? {}).filter(([id]) => !broken.includes(id)))
    : next.refined;
  // 商店买的那条命：战斗把它用掉之后在这里结账。见 `settleWard`。
  const settled: ChapterRun = settleWard(
    { ...next, relics: survivingRelics, refined: survivingRefined }, state,
  );

  return {
    run: settled, won: true, heal,
    healed: hp - state.player.hp, gold: paid.gold,
    brokenRelics: broken,
    spentProps,
    propDrop: dropRoll.drop?.id,
    chapterCleared: isChapterCleared(settled),
  };
}

// ------------------------------------------------------------------ 商店

/**
 * 这一家店的掷点流。
 *
 * ⚠️ **和 `nextRandom(run)` 那条流完全分开，这一点是架构不是洁癖。** `run.rng` 是 run 唯一的掷点
 * 序列：回血、金币、「开副槽」、道具掉落、淬炼的成算全排在它上面。往里面插一次商店掷点，会把
 * **每一个既有种子的回血和金币整体推移一格**——`run.test.ts` 那条「同一条 run 重放两次完全相同」
 * 当场变红，而真正的代价是所有玩家存档里那条流都对不上了。见 `finishBattle` 里 `dropRoll` 上同一
 * 段说明。商店的掷点因此**只**是 `run.seed` 与节点 id 的函数，`run.rng` 一格都不动。
 */
function shopStream(run: ChapterRun, salt: number) {
  let state = (Math.imul(run.seed >>> 0, 0x9e3779b1)
    ^ hashText(run.at ?? '')
    ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** FNV-1a——和 `events.ts` 的 `eventForNode` 同一个哈希。用节点 id 把两家店分开。 */
function hashText(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * 掷这一家店的货架。**进入商店节点时调一次。**
 *
 * `enterNode` 已经替调用方调过了，所以界面那条路（照宝箱的 `enterFloor`）再调一次是**空操作**——
 * 这正是想要的：重绘、重载、或者界面多调一次，摆出来的都还是那五格。`rerolls` 归零，因为「刷新了
 * 几次」是这一家店的事。
 *
 * 不在 `MapNode` 上预掷：地图不进存档、由种子重建，把货架挂在节点上等于让「卖什么」跟着地图走，
 * 而地图会被下一次生成器改动换掉。和「节点上没有 `encounterId`」是同一条规矩。
 */
export function rollShop(run: ChapterRun): ChapterRun {
  const node = nodeAt(run);
  if (!node || node.kind !== 'shop') return run;
  if (run.shop) return run;
  return { ...run, shop: { slots: rollShopSlots(run, shopStream(run, 0)), rerolls: 0 } };
}

/**
 * 换一批货。钱不够、或者五格全卖光了，**原样返回同一个对象**——界面靠 `next === run` 判断要不要
 * 播刷新音效，所以这里不能返回一个「内容一样的新对象」。
 *
 * 卖掉的那几格**不重掷**（它们本来就是空的），而「保底一格道具」和「一格五折」只在还摆着货的格子
 * 里挑——否则刷完一次可能看不出任何变化。
 */
export function rerollShop(run: ChapterRun): ChapterRun {
  const shop = run.shop;
  if (!shop || !shop.slots.some(slot => !slot.sold)) return run;
  const paid = spendGold(run, shopRerollCost(run));
  if (!paid) return run;
  const sold = shop.slots.flatMap((slot, index) => (slot.sold ? [index] : []));
  const fresh = rollShopSlots(run, shopStream(run, shop.rerolls + 1), sold);
  const slots = fresh.map((slot, index) => (shop.slots[index]?.sold ? shop.slots[index] : slot));
  return { ...paid, shop: { ...shop, slots, rerolls: shop.rerolls + 1 } };
}

/**
 * 买下来的东西**放得下吗**。
 *
 * 三样东西都要一个「玩家还没答完的决定」才能落地，而那个决定同时只能有一个：道具走 `propTask`
 * （放进哪一格），卡牌走 `cardReveal`（买下来的牌得看得见），遗物走 `pendingDraw`（放进哪个槽）。
 * 上一件还没答完就再买一件，第二件会把第一件**顶掉**——玩家付了两次钱，只拿到一件。
 *
 * ⚠️ 判据放在**收钱之前**。这不是「界面该把按钮置灰」的礼貌，是规则本身：`buyShopSlot` 是可以被
 * 直接调的，而「收钱不发货」是一种比「买不起」更坏的失败。
 */
function canDeliver(run: ChapterRun, slot: ShopSlot): boolean {
  if (slot.kind === 'prop') return !run.propTask;
  if (slot.kind === 'card') return !run.cardReveal && !run.cardTask;
  if (slot.kind === 'relic') return !run.pendingDraw;
  return true;   // 属性与免死当场落到 run 上，不需要第二个决定
}

/** 把买到的那件东西落到 run 上。钱已经付过了，所以这里不允许失败。 */
function deliver(run: ChapterRun, slot: ShopSlot): ChapterRun {
  switch (slot.kind) {
    // 和宝箱、奇遇同一条路：停在「还没放下」上等玩家回答（`placeProp`）。
    case 'prop': return { ...run, propTask: { id: slot.id!, from: '商店' } };
    // ⚠️ **一定要摆出来。** 项目里有一条规矩：一张悄悄进牌库的牌，玩家从来看不见它——「一捆牌」
    // 和「换一张」都是为这件事才加了 `cardReveal`。买来的牌更该看得见，因为它是花钱买的。
    case 'card':
      return { ...addCard(run, slot.id!), cardReveal: { gained: [{ cardId: slot.id! }], from: '商店' } };
    // 和一次遗物抽取共用同一个状态、同一个入口（`claimRelic`），所以「放进哪个槽」这个决定不需要
    // 另写一套。`options` 只有一件——它不是三选一，是「你买的那一件，放哪」。
    case 'relic': return { ...run, pendingDraw: { options: [slot.id!], slot: 'main', from: '商店' } };
    case 'stat': {
      const good = STAT_GOODS.find(entry => entry.id === slot.id) ?? STAT_GOODS[0];
      if (good.effect.maxHp) {
        // 抬高上限时按同样的数额补血——`claimReward` 的 `maxHp` 分支是同一条算法，理由也一样：
        // 一条玩家感觉不到的血条不是奖励，是一个数。
        const amount = good.effect.maxHp;
        return { ...run, maxHp: run.maxHp + amount, hp: run.hp + amount };
      }
      // ⚠️ 回血封顶跟 `maxHp` 走，**不是 `PLAYER_MAX_HP`**（`claimReward` 那条注释说的是同一件事）。
      return { ...run, hp: Math.min(run.maxHp, run.hp + (good.effect.heal ?? 0)) };
    }
    case 'life': return { ...run, warded: true };
  }
}

/**
 * 买一格。
 *
 * 三种付款方式走同一条路：**先判交付、再收钱、最后落货**。买不起、已经卖掉、下标越界、遗物不够值、
 * 交付不出去——五种失败一律 `return run`（**同一个对象引用**），界面据此什么都不做。
 *
 * `relicSlot` 是「拿哪一格的遗物去换」，只有 `with === 'relic'` 时才有意义。换走的那件**连带清掉它的
 * 淬炼**（`discardRelic` 就是为这件事写的，`refined` 按 id 键）；而**不把副遗物顶上来**——哪一格是
 * 空的，是玩家看得见的状态。
 */
export function buyShopSlot(
  run: ChapterRun, index: number, payWith: PayWith, relicSlot?: 'main' | 'sub',
): ChapterRun {
  const shop = run.shop;
  const slot = shop?.slots[index];
  if (!shop || !slot || slot.sold) return run;
  if (!canPayWith(run, index, payWith)) return run;
  if (!canDeliver(run, slot)) return run;

  let paid: ChapterRun;
  if (payWith === 'gold') {
    const spent = spendGold(run, slot.price);
    if (!spent) return run;
    paid = spent;
  } else if (payWith === 'hp') {
    // `canPayWith` 已经保证付完剩 ≥1 点（判的是 `>`，照 `events.ts` 的 `canAfford`）。
    paid = { ...run, hp: run.hp - slot.hpPrice };
  } else {
    if (relicSlot !== 'main' && relicSlot !== 'sub') return run;
    const id = run.relics[relicSlot];
    if (!id || relicValueOf(id) < slot.relicPrice) return run;
    const dropped = discardRelic(run, relicSlot);
    if (dropped === run) return run;
    paid = dropped;
  }

  const delivered = deliver(paid, slot);
  return {
    ...delivered,
    shop: {
      ...shop,
      slots: shop.slots.map((entry, at) => (at === index ? { ...entry, sold: true } : entry)),
      // 免死买下来时在货架上也留个印子：界面拿它说「这家已经卖给你一条命了」。
      ...(slot.kind === 'life' ? { warded: true } : {}),
    },
  };
}

/**
 * 结束这一层。
 *
 * ⚠️ **买了一件道具还没放下时不放人。** 放道具屏是 `propTask` 唯一的出口（`BattleDemo` 的分派顺序
 * 里没有它——塔上的宝箱与奇遇也停在同一个状态上），走了这一件就永远留在 `propTask` 里了。界面可以
 * 用 `shopPending` 先把「离开」置灰，但规则在这里：`leaveShop` 不是可以被绕过的一层皮。
 *
 * 遗物那件**不拦**：`pendingDraw` 在塔上有自己的屏（`BattleDemo` 的遗物抽取浮层），离开商店之后它
 * 会照常弹出来。
 */
export function leaveShop(run: ChapterRun): ChapterRun {
  if (run.propTask) return run;
  return { ...run, resolved: run.at };
}

/** 买了东西还没落地（`leaveShop` 会因此拒绝）。界面用它把「离开」置灰。 */
export function shopPending(run: ChapterRun): boolean {
  return !!run.propTask;
}

/** 路上已经走过几家店（不含脚下这一家）。删牌价按它递增。 */
function shopsVisited(run: ChapterRun): number {
  return run.path.filter(id => id !== run.at && run.map.byId.get(id)?.kind === 'shop').length;
}

/** 删牌服务现在要多少钱：75 / 100 / 125…（跨商店递增，照杀戮尖塔）。 */
export function shopRemoveCost(run: ChapterRun): number {
  return removePrice(shopsVisited(run));
}

/**
 * 买这一次删牌。
 *
 * 走 `cardTask: 'remove'`——**复用现成的选牌器**，一行新界面都不用写。选牌器在战斗页的分派顺序里
 * 排在楼层屏**之前**，所以选完牌回来，脚下还是这家店（`resolved` 还没设）。
 */
export function buyRemoveService(run: ChapterRun): ChapterRun {
  const shop = run.shop;
  if (!shop || shop.removed) return run;
  if (run.cardTask) return run;
  const paid = spendGold(run, shopRemoveCost(run));
  if (!paid) return run;
  return { ...paid, cardTask: 'remove', shop: { ...shop, removed: true } };
}

/**
 * 商店买的那条命，进战斗时要带的记号。
 *
 * ⚠️ **我没有改 `engine.ts`，这条接缝留给 `BattleDemo` 的作者。** 已经确认过：`StartOptions` 上
 * **没有**任何通道能把一个记号带进战斗（它的字段只有 `hp` / `maxHp` / `sub` / `relics` / `refined`
 * / `props` / `cards`），而 `startBattle` 里 `marks` 是写死的 `{}`。项目里另外**两个**「下一次致死
 * 伤害留 1 点」——道具「残烛」（`PropContext.deathWard` 写下 `marks['prop:deathWard'] = 1`）和遗物
 * `lethalSave`（铁面具）——都是**战斗内部**获得的，所以这条通道从来不需要存在。
 *
 * 要接上，`engine.ts` 动两行：
 *
 * ```ts
 * // 1) `StartOptions` 加一项
 * export interface StartOptions {
 *   ...
 *   // 战斗开始时就带在身上的记号。见 `BattleState.marks`。
 *   marks?: Record<string, number>;
 * }
 *
 * // 2) `startBattle` 里把 `marks: {},` 换成
 * marks: opts.marks ? { ...opts.marks } : {},
 * ```
 *
 * 然后 `BattleDemo` 里 `beginFight` 递给 `startBattle` 的 `opts` 多一项：
 * `marks: run.warded ? wardMark() : undefined`。
 *
 * **引擎一行判定都不用新写**：`damagePlayer` 里那段 `s.marks?.['prop:deathWard']` 会自己认它
 * （顺序上排在铁面具之后、和残烛同一档——商店买的和道具买的本来就是同一条命），用完把它置 0，
 * 而 `finishBattle` 照着把 `run.warded` 清掉（见 `settleWard`）。
 *
 * 在这两行接上之前，买了免死的表现是：货架上那格卖掉了、`run.warded` 亮着，而战斗里什么都不发生。
 */
export function wardMark(): Record<string, number> {
  return { 'prop:deathWard': 1 };
}

/**
 * 那条命这一场用掉了吗。
 *
 * 判据是战斗把记号**置成了 0**（`damagePlayer` 里那一行）。没带记号进战斗时 `marks` 里根本没有
 * 这个键，读出来是 `undefined`，于是这里不会误清——所以免死接上引擎之前，这段是空转的，而不是把
 * 玩家花钱买的东西悄悄吃掉。
 *
 * 顺带说明「和残烛共用一格」的后果：一场里既带了残烛又买了命，用完的是**同一条**，两件都算用掉。
 * 这是刻意的——商店卖的本来就不是第二条命，是同一件事的第三个来源。
 */
function settleWard(run: ChapterRun, state: BattleState): ChapterRun {
  if (!run.warded || state.marks?.['prop:deathWard'] !== 0) return run;
  return { ...run, warded: undefined };
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
  /**
   * 生命上限：**只要求是正整数**。
   *
   * 它原来钉着 `>= PLAYER_MAX_HP`（「60 是所有常数调过的基准」），那条现在是**战斗**的不变量
   * （`isValidBattle` 还钉着，`startBattle` 进战斗时也会把上限抬回基准值）。**run 的上限可以被压低**
   * ——夜祷书印着「生命上限 −10」，拒绝一份压低了上限的存档，等于玩家用一次道具、刷新一下整局没了。
   * 底线只有一条：不低于 1（上限 0 的 run 永远回不了血）。
   */
  if (!Number.isInteger(run.maxHp) || run.maxHp < 1) return false;
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
  // 只能装主槽的那几件。`claimRelic` 已经拒绝过一次，但**存档是可以手改的**，而一件装错槽位的遗物
  // 会安静地按副槽的效果运行（对这两件来说是「什么都不发生」）——那正是这一整套校验存在的理由。
  if (run.relics.sub !== undefined && RELIC_BY_ID.get(run.relics.sub)?.mainOnly) return false;
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
  /**
   * 道具. 三个槽的形状**直接复用引擎导出的 `validProps`**——两边逐字段相同（都来自
   * `src/props/props.ts`），抄第二遍必然会漂。它管的是：长度是不是三格、id 在不在表上、
   * `uses` 是不是 1..charges（`uses: 0` 的槽位本该是 `null`）。
   *
   * ⚠️ **这里故意没有「道具不能重复」那一条**：两格带同一件是合法的（消耗品就该能带两个）。
   * 遗物那条 `main === sub` 拒的是同一件东西占两个**语义不同**的槽，不能照抄过来。
   */
  if (run.props !== undefined && !validProps(run.props)) return false;
  /**
   * 一件捡到还没放下的道具。
   *
   * ⚠️ **id 必须真的存在**：它下一步就被写进槽位（`placeProp`），而一个不存在的 id 会让下一次
   * 加载把整局丢掉——`validProps` 拒它，`loadRun` 丢 run。
   */
  if (run.propTask !== undefined) {
    const task = run.propTask;
    if (!task || typeof task !== 'object') return false;
    if (typeof task.id !== 'string' || !PROP_BY_ID.has(task.id)) return false;
    if (typeof task.from !== 'string') return false;
  }
  /**
   * 掉落概率。**必须是 [0,100] 的整数**：不是整数的时候 `roll * 100 < luck` 恒为假，
   * 于是掉落静默地再也不发生——一份手改过的存档会让这个玩家永远抽不到道具，而没有任何报错。
   */
  if (run.propLuck !== undefined
    && (!Number.isInteger(run.propLuck) || run.propLuck < 0 || run.propLuck > 100)) return false;
  if (run.propGranted !== undefined && typeof run.propGranted !== 'boolean') return false;
  /**
   * 商店的货架。**optional + 只在存在时校验**，和 `props` / `propTask` / `propLuck` 同一个先例：
   * 老存档里没有这个字段，而 `loadRun` 对不合格的存档是**整局丢掉**而不是修复。
   *
   * `isValidShop` 管形状：五格、三种价钱都是非负整数、每一格的 `id` 在它那一类的表里真的存在。
   * 最后那条是重点——`id` 下一步就被写进牌库 / 道具槽 / 遗物槽，一个不存在的 id 会让**下一次加载
   * 把整局丢掉**。
   */
  if (run.shop !== undefined && !isValidShop(run.shop)) return false;
  /** 商店买来的那条命。见 `ChapterRun.warded` 与 `settleWard`。 */
  if (run.warded !== undefined && typeof run.warded !== 'boolean') return false;
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
