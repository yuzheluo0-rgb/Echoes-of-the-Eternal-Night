/**
 * What a relic actually does.
 *
 * Same split as the cards: `src/relics/relics.ts` is the **data** (name, tier, the two printed
 * effects) and this file is the **behaviour**, exactly as `src/battle/effects.ts` holds `CARD_EFFECTS`
 * beside `src/cards/**`. Nothing here imports the engine — the engine hands each effect a
 * `RelicContext` to act through, which keeps the dependency one-way (`engine → relics`) and keeps
 * every effect written against a small vocabulary rather than reaching into the battle state.
 *
 * THREE SHAPES, because relics are not all the same kind of thing:
 *
 *   - **triggers** fire at a moment — battle start, turn start, an enemy dying.
 *   - **modifiers** answer a question the engine asks when it needs a number — "how much extra does
 *     this hit do", "how many cards does this turn draw".
 *   - **flags** change a rule rather than a number — 灼烧 stops decaying, a lethal blow is survived.
 *
 * **The numbers here MUST match the text printed on the card.** When the two disagree it is the text
 * the player read, so the text wins and this file is the bug. A modifier that scales per slot writes
 * `c.v(main, sub)`; one whose two slots differ by *rule* rather than by number (打火石 gives 格挡
 * instead of a second 余烬) reads `c.main` and branches.
 */

import { STATUS_LABEL, type EnemyState, type LogLine, type PlayerState, type StatusId } from './types.ts';
import { REFINE_TEXT, refinedPair, refineSteps, type RefineTier } from '../relics/relics.ts';

export type RelicSlot = 'main' | 'sub';

// The 淬炼 vocabulary (tier, steps, pair arithmetic) lives in the **data** module — `src/relics/**`
// may not import `src/battle/**`, and the card face needs to read a tier too. Imported for this
// file's own use and re-exported so the engine and the run keep importing everything relic-shaped
// from one place.
export { REFINE_LABEL, refinedPair, refineSteps, type RefineTier } from '../relics/relics.ts';

/** When a relic pays out. */
export type RelicTrigger =
  /** Once, after the enemies are on the field and before the opening hand is drawn. */
  | 'battleStart'
  /** Top of every one of your turns, after energy and the draw. */
  | 'turnStart'
  /** When you end a turn, before the hand is discarded. */
  | 'turnEnd'
  /** Each time an enemy dies. */
  | 'enemyKilled'
  /** The first time an enemy hits you in a battle. */
  | 'firstAttacked'
  /** The first time an enemy hits you in a turn. */
  | 'firstAttackedTurn';

/** A number the engine asks for. */
export type RelicModifierKey =
  /** Added to every attack hit, once per hit. */
  | 'attackDamage'
  /** Added to the first attack card's hits each turn. */
  | 'firstAttackDamage'
  /** Added to each 灼烧 tick. */
  | 'scorchDamage'
  /** Added to the cards drawn at the top of a turn. */
  | 'drawCount'
  /** Added to the energy granted at the top of a turn. Not `energyPerTurn`, which is a constant. */
  | 'energyBonus'
  /** Added to 生命上限. */
  | 'maxHp'
  /** Added to the 引火 discount. */
  | 'kindling'
  /** Added to the cost of the first card each turn (negative makes it cheaper). */
  | 'firstCardCost'
  /** Added to the cost of the first skill card each turn. */
  | 'firstSkillCost'
  /** Added to the cost of the first power card each battle. */
  | 'firstPowerCost'
  /** Flat 生命 paid back after a victory. Read by the run. */
  | 'victoryHeal'
  /** Percent added to the campfire's heal after a victory. Read by the run. */
  | 'healMultiplier'
  /** Flat gold added to a victory. Read by the run. */
  | 'victoryGold'
  /** Percent added to the gold a victory pays out. Read by the run. */
  | 'goldBonus';

/** Rules that are true or false rather than a number. */
export type RelicFlag =
  /** 灼烧 does not lose a stack each tick. */
  | 'scorchHolds'
  /** The first lethal blow each battle leaves you at 1 生命 instead. */
  | 'lethalSave'
  /** The first card you play each battle goes back to hand instead of to the discard pile. */
  | 'retainFirstCard'
  /** The same, but only if that first card was an attack. */
  | 'retainFirstAttack'
  /** The first attack card each battle hits one extra time, at half damage. */
  | 'extraHitFirstAttack';

/**
 * What an effect is allowed to do. Deliberately small: if a relic needs something that is not here,
 * the question is whether the *relic* is wrong, not whether this list is too short.
 */
export interface RelicContext {
  slot: RelicSlot;
  /** This relic's 淬炼 tier, if it has been through the fire and come out. */
  refine?: RefineTier;
  /**
   * Picks the main or the sub number, **with this relic's 淬炼 bump already added**.
   *
   * Write `v(3, 1)` — never branch on `slot` for a plain scaling, and never add the refinement
   * yourself. This is the single funnel: every relic that writes a `[main, sub]` pair gets 淬炼 for
   * free by going through it, and a relic that did its own arithmetic would silently be the one relic
   * that stays unrefined.
   */
  v: (main: number, sub: number) => number;
  /** True in the main slot. For the relics whose two slots differ by rule rather than by number. */
  main: boolean;
  /**
   * The same bump for a relic whose number is **fixed** — one that does not differ between its two
   * slots, so `v` has no slot to pick. 蜡头 draws a card in either slot; 绳结 gives energy in either.
   *
   * `c.n(1)` is 1 未淬炼 / 2 小强化 / 3 大强化. Without it, more than half the set would have nothing
   * to enlarge and 淬炼 would be a coin flip over whether it did anything at all.
   */
  n: (base: number) => number;
  /**
   * The raw bump, for a relic whose scale is not 1.
   *
   * 水囊 pays a **percentage** of the campfire's heal, so +1 means nothing; 铁匠锤 pays a **cost**,
   * so +1 would be a downgrade. Those read `c.steps` and pick their own unit (水囊 +15% a tier,
   * 铁匠锤 −1 more). Everything else should go through `n` / `v` and not look at this at all.
   */
  steps: number;
  turn: number;
  /** 生命 as a fraction of 生命上限, for the relics that care about being hurt. */
  hpFraction: number;
  player: PlayerState;
  handSize: number;
  enemies: EnemyState[];
  /** Attack hits landed **this battle**, for 「每第 3 次命中」. */
  hits: number;
  /** The enemy being processed, when the modifier is per-enemy (灼烧 ticks). */
  subject?: EnemyState;
  /** The enemy that just died, if the trigger was `enemyKilled`. */
  fallen?: EnemyState;
  /** Set when the dying enemy was killed by 灼烧 rather than by a blow. */
  byScorch?: boolean;
  /** Per-battle scratch space, so 「每场只生效三次」 has somewhere to live. */
  count: (key: string) => number;
  bump: (key: string, by?: number) => void;
  /**
   * A number in [0, 1) for the few relics that pick a target at random. It comes off the **encounter
   * stream**, never off `rng` — spending the card stream here would change the order the deck comes
   * out in, which is the bug that split `spawnRng` off in the first place.
   */
  roll: () => number;
  log: (text: string, tone?: LogLine['tone']) => void;
  /** Stacks on the player, or on every living enemy. */
  status: (who: 'player' | 'enemies', status: StatusId, amount: number) => void;
  /** Stacks on one specific enemy. */
  statusOn: (enemy: EnemyState | undefined, status: StatusId, amount: number) => void;
  block: (amount: number) => void;
  energy: (amount: number) => void;
  draw: (count: number) => void;
  heal: (amount: number) => void;
  loseHp: (amount: number) => void;
  stripBlock: (amount: number) => void;
  /** Takes cards back out of the discard pile, the way 拾骨 does. */
  reclaim: (count: number) => void;
  /** Finds the topmost card of this kind still in the draw pile and puts it into your hand. */
  tutor: (kind: 'attack' | 'skill' | 'power') => void;
  /** Shuffles away the 灰烬 an enemy put in your deck. Returns how many went. */
  purgeJunk: () => number;
  /** Discards `count` cards at random from hand. */
  discardRandom: (count: number) => void;
  /** Makes `count` random cards in hand cheaper for the rest of the battle, but never below `floor`. */
  cheapenHand: (count: number, by: number, floor?: number) => void;
  /** Copies `count` random cards in hand. The copy costs `extra` more than the original. */
  copyHand: (count: number, extra?: number) => void;
  /** The names of the top `count` cards of the draw pile, without drawing them. */
  topOfDraw: (count: number) => string[];
}

export type Handler = (ctx: RelicContext) => void;
/** A modifier is a flat `[main, sub]` pair, or a function when the two slots differ by rule. */
export type Modifier = [main: number, sub: number] | ((ctx: RelicContext) => number);

export interface RelicEffects {
  triggers?: Partial<Record<RelicTrigger, Handler>>;
  modifiers?: Partial<Record<RelicModifierKey, Modifier>>;
  flags?: RelicFlag[];
}

/** Reads a modifier table entry, whichever shape it is. Exported for the engine's single query path. */
export function readModifier(spec: Modifier | undefined, ctx: RelicContext): number {
  if (spec === undefined) return 0;
  return typeof spec === 'function' ? spec(ctx) : ctx.v(spec[0], spec[1]);
}

/**
 * The chapter-I pool, by relic id.
 *
 * Every relic that can be **drawn** in chapter I must appear here — `relics.test.ts` fails otherwise.
 * A relic that does nothing is worse than no relic: the player spends a draw on it and gets a card
 * that lies to them.
 *
 * 秘宝 and 绝响 are absent on purpose. They are locked to chapters II and III, and behaviour for
 * content nobody can reach is behaviour nobody can test.
 */
export const RELIC_EFFECTS: Record<string, RelicEffects> = {
  // ------------------------------------------------------------------ 残片
  // 「获得 1 层 X；若已有 X，改为获得 N 点格挡」 is one shape repeated four times: the lesser slot
  // gives the same opener but pays out as block when the stack would otherwise be wasted.
  flint: { triggers: { battleStart: c => already(c, 'ember') ? c.block(c.n(1)) : c.status('player', 'ember', c.n(1)) } },
  whetstone: { triggers: { battleStart: c => already(c, 'edge') ? c.block(c.n(1)) : c.status('player', 'edge', c.n(1)) } },
  'hemp-rope': { triggers: { battleStart: c => already(c, 'rampart') ? c.block(c.n(2)) : c.status('player', 'rampart', c.n(1)) } },
  // Sub pays on every third hit instead of every hit. `c.hits` is a battle-wide tally the engine
  // keeps, so the rule stays a pure function of the state and nothing has to mutate during a query.
  'iron-nail': { modifiers: { attackDamage: c => c.main ? c.n(1) : (c.hits % 3 === 0 ? c.n(1) : 0) } },
  'dry-ration': { modifiers: { victoryHeal: [3, 1] } },
  'copper-coin': { modifiers: { victoryGold: [5, 2] } },
  'candle-stub': {
    triggers: {
      battleStart: c => { c.draw(c.n(1)); if (!c.main) c.discardRandom(1); },
    },
  },
  'empty-vial': { triggers: { battleStart: c => { if (c.main || c.hpFraction < .5) c.heal(c.n(2)); } } },
  'fish-bone': { triggers: { turnEnd: c => { if (c.handSize === 0) c.block(c.v(2, 1)); } } },
  'stone-shard': { modifiers: { firstAttackDamage: [3, 1] } },
  'rope-knot': { triggers: { turnStart: c => { if (c.turn === 1) { c.energy(c.n(1)); if (!c.main) c.discardRandom(1); } } } },
  'wood-whistle': {
    triggers: {
      turnStart: c => {
        if (c.turn !== 1) return;
        if (c.main) c.status('enemies', 'strength', -c.n(1));
        else c.statusOn(c.enemies[0], 'strength', -c.n(1));
      },
    },
  },
  // ⚠️ **The thresholds are fractions, so `c.v(.5, .25)` would add a whole 1 to them** — 0.25 + 1 is
  // 1.25, a 生命 fraction that is always true, and the relic would have quietly become 「每回合给余烬」
  // instead of 「快死的时候给」. Its rung is ten percentage points, not one.
  'dead-wick': {
    triggers: {
      turnStart: c => {
        if (c.hpFraction < (c.main ? .5 : .25) + c.steps * .1) c.status('player', 'ember', c.n(1));
      },
    },
  },
  'chipped-bowl': { triggers: { battleStart: c => already(c, 'retaliate') ? c.block(c.n(2)) : c.status('player', 'retaliate', c.n(1)) } },

  // ------------------------------------------------------------------ 旧物
  // 怀表's number is a **turn**, so the bump runs the other way: refining makes it arrive earlier,
  // not later. `c.v(5, 7)` would have pushed it to turn 7 and made 小强化 a downgrade.
  //
  // The energy stays 1. It is the *timing* that scales, and `c.n(1)` here would have double-dipped —
  // arriving on turn 3 **and** paying three energy, which is a different relic rather than a better
  // one. Its card face therefore cannot use the generic 「数值 +N」 line; see `REFINE_TEXT`.
  'brass-watch': { triggers: { turnStart: c => { if (c.turn === (c.main ? 5 : 7) - c.steps) c.energy(1); } } },
  // 铜钥匙 hands over a *kind* of card, which has no number to enlarge — so the tier pays in draws
  // instead, on top of the tutor. `c.n(0)` is exactly the bump (0 / 1 / 2), the same scale the rest
  // of the set uses, which keeps 「大强化 = +2」 true here too.
  'brass-key': { triggers: { battleStart: c => { c.tutor(c.main ? 'attack' : 'skill'); c.draw(c.n(0)); } } },
  compass: {
    triggers: {
      battleStart: c => c.main
        ? c.statusOn(c.enemies[0], 'mark', c.n(1))
        // 「随机一个」 — the battle's own stream picks, so a seed still replays the same target.
        : c.statusOn(c.enemies[Math.floor(c.roll() * c.enemies.length)], 'mark', c.n(1)),
    },
  },
  hourglass: { triggers: { turnStart: c => { if (c.turn === 3) c.draw(c.v(2, 1)); } } },
  'iron-bell': {
    triggers: {
      battleStart: c => c.main
        ? c.status('enemies', 'scorch', c.n(1))
        : c.statusOn(c.enemies[Math.floor(c.roll() * c.enemies.length)], 'scorch', c.n(1)),
    },
  },
  // A **cost**, so the sign is inverted: 「more」 means further below zero. `c.n(1)` would have made
  // 淬炼 charge the player more.
  //
  // ⚠️ **A pure discount cannot carry a refinement on its own**, which is why these three pay a rider
  // as well. `cardCostNow` clamps at zero, and 引火 has already taken a point off the turn's first
  // card — so by the time 断齿梳's extra point lands, a 1- or 2-cost card is free either way and the
  // refinement is invisible. `c.n(0)` is exactly the bump (0 / 1 / 2) and 0 is a no-op, so an
  // unrefined relic behaves byte-identically to before.
  'broken-comb': {
    modifiers: { firstSkillCost: c => c.main || c.turn <= 3 ? -(1 + c.steps) : 0 },
    triggers: { battleStart: c => c.status('player', 'ember', c.n(0)) },
  },
  // A **percentage** of the campfire's heal. +1% would be invisible, so this one's rung is 15 points.
  waterskin: { modifiers: { healMultiplier: c => (c.main ? 100 : 50) + c.steps * 15 } },
  'bone-whistle': { triggers: { battleStart: c => c.cheapenHand(c.n(1), 1, c.main ? 0 : 1) } },
  'brass-mirror': { triggers: { battleStart: c => c.copyHand(c.n(1), c.main ? 0 : 1) } },
  'salt-jar': { modifiers: { scorchDamage: c => c.main || c.subject === c.enemies[0] ? c.n(1) : 0 } },
  'iron-tongs': { triggers: { firstAttacked: c => c.block(c.v(4, 2)) } },
  'work-gloves': { modifiers: { firstAttackDamage: [2, 1] } },
  'clay-lamp': {
    triggers: {
      turnEnd: c => {
        if (c.player.energy < 2) return;
        if (!c.main && c.count('lamp') >= 3) return;   // the lesser slot pays three times a battle
        c.bump('lamp');
        c.status('player', 'ember', c.n(1));
      },
    },
  },
  'chain-link': { triggers: { battleStart: c => c.status('player', 'rampart', c.v(2, 1)) } },
  'dry-herbs': { triggers: { battleStart: c => c.heal(c.v(4, 2)) } },
  // The three **rule** relics have no number of their own, so 淬炼 pays them in a number they already
  // care about rather than in the rules they already set — 燧发枪弹 hits a little harder, 双生镜's
  // first card comes back with a little more, 铁面具 leaves you a little more room. Hand-designed
  // per relic, because 「+1」 has to mean something specific for each.
  'musket-balls': { flags: ['extraHitFirstAttack'], modifiers: { attackDamage: c => c.n(0) } },
  'leather-bracer': { triggers: { firstAttackedTurn: c => c.status('player', 'retaliate', c.n(2)) } },
  'charred-block': { triggers: { enemyKilled: c => { if (c.byScorch) c.status('player', 'ember', c.v(2, 1)); } } },
  'old-map': { triggers: { battleStart: c => { c.draw(c.v(2, 1)); c.discardRandom(c.v(2, 1)); } } },
  'tin-cup': { modifiers: { victoryHeal: [6, 3] } },
  'dog-tag': {
    triggers: {
      battleStart: c => c.main
        ? c.status('enemies', 'mark', c.n(1))
        : c.statusOn([...c.enemies].sort((a, b) => b.maxHp - a.maxHp)[0], 'mark', c.n(1)),
    },
  },
  'tar-lamp': { triggers: { turnStart: c => { if (c.player.block === 0) c.block(c.v(3, 2)); } } },

  // ------------------------------------------------------------------ 珍品
  'night-lantern': { modifiers: { firstAttackDamage: [3, 2] } },
  // 收灰烬 is all-or-nothing — there is no number in 「take the junk back out」. Like 铜钥匙, the tier
  // pays in draws: the urn clears your deck *and* hands you the tempo for it.
  'ash-urn': {
    triggers: {
      battleStart: c => {
        const moved = c.purgeJunk();
        if (moved) c.log(`灰烬瓮 · 收走了 ${moved} 张「灰烬」。`, 'good');
        c.draw(c.n(0));
      },
    },
  },
  // A **percentage** of the victory's gold, so its rung is 15 points rather than 1.
  ledger: { modifiers: { goldBonus: c => (c.main ? 50 : 25) + c.steps * 15 } },
  'ember-seed': {
    triggers: {
      turnStart: c => {
        if (c.main) c.status('player', 'ember', c.n(1));
        else if (c.turn === 1 || c.turn === 4 || c.turn === 7) c.status('player', 'ember', c.n(1));
      },
    },
  },
  // The cost tax is main-slot only: the lesser slot gives up the extra damage *and* the tax, so it
  // is a discount on both sides of the card rather than only the good half of it. **The tax does not
  // grow with 淬炼** — it is a price, and the refinement buys the damage, not a bigger fee.
  'broken-edge': { modifiers: { attackDamage: [3, 2], firstCardCost: c => c.main ? 1 : 0 } },
  // One flag, two strengths: the engine asks *which slot* supplies it. Main catches any first card,
  // sub only catches it if that card was an attack. The refinement pays in the first swing, which is
  // the thing this relic is already about.
  'twin-mirrors': { flags: ['retainFirstCard'], modifiers: { firstAttackDamage: c => c.n(0) } },
  // A **cost**, so the sign inverts — see 断齿梳 above for why the rider is here too.
  'smith-hammer': {
    modifiers: { firstPowerCost: c => (c.main ? -2 : -1) - c.steps },
    triggers: { battleStart: c => c.draw(c.n(0)) },
  },
  // 血衫's 1 生命 is a price and stays 1 — the refinement buys the 锋锐, not a bigger wound.
  'hair-shirt': { triggers: { turnStart: c => { c.loseHp(1); c.status('player', 'edge', c.v(2, 1)); } } },
  spyglass: {
    triggers: {
      battleStart: c => {
        // The print says "look at the top three and take one". With no choice prompt at battle start
        // the honest simplification is to take the top card and **say which ones were there**, so
        // the player can still see what they passed over instead of it silently being a plain draw.
        const top = c.topOfDraw((c.main ? 3 : 2) + c.n(0));
        if (!top.length) return;
        c.log(`观星镜 · 抽牌堆顶：${top.join(' / ')}，取走「${top[0]}」。`, 'neutral');
        c.draw(c.n(1));
        // The lesser slot takes the same card but pays for the shortcut.
        if (!c.main) c.cheapenHand(1, -1);
      },
    },
  },
  'bone-ring': {
    triggers: {
      turnStart: c => {
        if (!c.main && c.count('ring') >= 2) return;   // the lesser slot pays twice a battle
        c.bump('ring');
        c.status('player', 'ember', c.n(1));
      },
    },
  },
  'moss-jar': { modifiers: { victoryHeal: [8, 4] } },
  // 雷击木 deepens 引火, which lives on the same clamped cost as the other two — riders all round.
  'storm-wood': {
    modifiers: { kindling: c => c.main || c.turn <= 3 ? c.n(1) : 0 },
    triggers: { battleStart: c => c.draw(c.n(0)) },
  },
  // The block scales with how hurt you are, so its rung is 10 points of ceiling rather than 1 point of
  // block — +1 would have been invisible on a 40-point swing.
  'brass-hand': {
    triggers: { battleStart: c => c.block(Math.floor((1 - c.hpFraction) * ((c.main ? 20 : 10) + c.steps * 10))) },
  },
  // 铁面具's rule is binary — 「the first lethal blow leaves you at 1」 has no stronger version — so the
  // refinement buys 生命上限 instead, which is the thing the mask is standing in for.
  'iron-mask': { flags: ['lethalSave'], modifiers: { maxHp: c => c.n(0) } },
  'burning-book': { triggers: { turnEnd: c => { if (c.main || c.turn <= 2) c.cheapenHand(c.n(1), 1); } } },
  'bell-clapper': {
    triggers: {
      battleStart: c => {
        if (c.main) { c.stripBlock(c.n(2)); c.status('enemies', 'mark', c.n(1)); }
        else { c.stripBlock(c.n(2)); c.statusOn(c.enemies[Math.floor(c.roll() * c.enemies.length)], 'mark', c.n(1)); }
      },
    },
  },
};

/** Has the player already got at least one stack of this? Used by the four 「若已有」 relics. */
function already(c: RelicContext, status: StatusId): boolean {
  return (c.player.statuses[status] ?? 0) > 0;
}

export function effectsFor(relicId: string | undefined): RelicEffects | undefined {
  return relicId ? RELIC_EFFECTS[relicId] : undefined;
}

/** Every id that has behaviour. The test that refuses to ship a blank relic reads this. */
export const IMPLEMENTED_RELICS = Object.keys(RELIC_EFFECTS);

// ------------------------------------------------------------------ telling the player

/** What one number of a relic's effect did when it was quenched. */
export interface RefineDelta {
  /** The noun the player reads: 格挡, 余烬, 抽牌, 能力牌减费 … */
  label: string;
  from: number;
  to: number;
}

/**
 * What a relic's numbers become at a 淬炼 tier, **derived from the relic's own handlers**.
 *
 * This exists because of the rule the whole project keeps re-learning: a card that prints one number
 * while the engine uses another is a card that lies. 打磨 taught it once (`upgrades.ts`), and 淬炼 is
 * the same shape of feature — so rather than authoring a second set of printed text for fifty-two
 * relics and hoping the two stay in step, this **runs the handlers** and reports what moved.
 *
 * It cannot drift. Change `c.n(2)` to `c.n(3)` in a handler and this line changes with it, because it
 * is reading the same call.
 *
 * The numbers come from a synthetic board (turn 1–8, both a full and an empty hand, one enemy), which
 * is enough to fire every relic in the set — `relics.test.ts` asserts that **no relic ever reports an
 * empty summary**, so a relic whose refinement does nothing cannot be shown as 「已淬炼」 with nothing
 * underneath it.
 */
export function refineSummary(relicId: string, slot: RelicSlot, tier: RefineTier): RefineDelta[] {
  const before = tallyNumbers(relicId, slot, undefined);
  const after = tallyNumbers(relicId, slot, tier);
  const deltas: RefineDelta[] = [];
  for (const [label, to] of after) {
    const from = before.get(label) ?? 0;
    if (to !== from) deltas.push({ label, from, to });
  }
  // Largest change first: the line the player should read is the one that moved most.
  return deltas.sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from));
}

/**
 * The lines a 淬炼 relic prints under its name — ready to render, so the card face does no arithmetic.
 *
 * Two sources, in order:
 *
 *   1. **`REFINE_TEXT`**, for the five relics whose rung is not one. Hand-written, because 「回血加成
 *      +15%」 and 「提前到第 4 回合」 are sentences and no formula produces them.
 *   2. **The relic's own handlers**, run at both tiers — 「格挡 1 → 3」, 「攻击加伤 1 → 3」.
 *
 * The second source is the point of the whole arrangement. It is not a second copy of the numbers
 * kept in step by discipline; it is the *same call* the engine will make, read twice. A relic whose
 * refinement stopped working would print an empty card rather than a confident lie, and
 * `relics.test.ts` fails on an empty card.
 */
export function refineLines(relicId: string, slot: RelicSlot, tier: RefineTier): string[] {
  const authored = REFINE_TEXT[relicId]?.[tier];
  if (authored) return [authored];
  return refineSummary(relicId, slot, tier).map(delta => `${delta.label} ${delta.from} → ${delta.to}`);
}

/** The noun for each thing a relic can do, as the player reads it on the face. */
const EFFECT_LABELS: Record<string, string> = {
  block: '格挡', energy: '能量', draw: '抽牌', heal: '生命', reclaim: '拾回', stripBlock: '削格挡',
  copyHand: '复制牌', cheapenHand: '降费', discardRandom: '弃牌', loseHp: '失去生命',
  // Modifiers the engine asks for by name rather than through a context method.
  attackDamage: '攻击加伤', firstAttackDamage: '首次攻击加伤', scorchDamage: '灼烧伤害',
  maxHp: '生命上限', kindling: '引火加深', drawCount: '每回合抽牌', energyBonus: '每回合能量',
  victoryHeal: '战后回血', victoryGold: '战后金币', goldBonus: '金币加成', healMultiplier: '回血加成',
  firstCardCost: '首牌减费', firstSkillCost: '技能牌减费', firstPowerCost: '能力牌减费',
};

/** Costs are *added* to a price, so a negative one is a discount — flipped to read 「便宜 3」. */
const COST_KEYS = new Set(['firstCardCost', 'firstSkillCost', 'firstPowerCost']);

/** Sum every number a relic hands the engine, by what it was for. */
function tallyNumbers(
  relicId: string, slot: RelicSlot, tier: RefineTier | undefined,
): Map<string, number> {
  const steps = refineSteps(tier);
  const tally = new Map<string, number>();
  /**
   * Keeps the **largest single number** seen for a label, not the running total.
   *
   * The probe sweeps eight turns and two hands so that 怀表 and 鱼骨 have a chance to fire at all, and
   * summing across that sweep multiplies every value by the number of times it fired — 血衫 read as
   * 「锋锐 2 → 4」 a turn, which summed to 「32 → 64」 over the sweep and would have been a card face
   * claiming a refinement sixty-four times its real size. One invocation is the unit the player
   * reads. Magnitude, so a negative number (an enemy's 力量 going down) still counts as bigger.
   */
  const add = (label: string, n: number) => {
    if (!n) return;
    const seen = tally.get(label);
    if (seen === undefined || Math.abs(n) > Math.abs(seen)) tally.set(label, n);
  };
  const enemy: EnemyState = {
    id: 'probe', uid: 'e0', hp: 20, maxHp: 20, block: 0, statuses: {},
    dead: false, turn: 1, intent: [{ kind: 'attack', amount: 5 }],
  };
  const probe = (turn: number, handSize: number): RelicContext => ({
    slot, refine: tier, steps,
    v: (main, sub) => { const [m, u] = refinedPair(main, sub, tier); return slot === 'main' ? m : u; },
    main: slot === 'main',
    n: base => base + steps,
    turn, hpFraction: .3,
    // Energy above 2 so 陶灯's 「结束回合时还有能量」 gate is open at every tier.
    player: { statuses: {}, block: 0, energy: 3, energyPerTurn: 3, hp: 18, maxHp: 60 },
    handSize, enemies: [enemy], subject: enemy, fallen: enemy, byScorch: true, hits: 3,
    count: () => 0, bump: () => {}, roll: () => 0, log: () => {},
    // Both sides tally the same way on purpose: the summary says 「灼烧 1 → 3」, and whether that
    // landed on the player or on an enemy is the relic's printed text's business, not this line's.
    status: (_who, st, amount) => add(STATUS_LABEL[st], amount),
    statusOn: (_e, st, amount) => add(STATUS_LABEL[st], amount),
    block: a => add(EFFECT_LABELS.block, a),
    energy: a => add(EFFECT_LABELS.energy, a),
    draw: a => add(EFFECT_LABELS.draw, a),
    heal: a => add(EFFECT_LABELS.heal, a),
    loseHp: a => add(EFFECT_LABELS.loseHp, a),
    stripBlock: a => add(EFFECT_LABELS.stripBlock, a),
    reclaim: a => add(EFFECT_LABELS.reclaim, a),
    tutor: () => {},
    purgeJunk: () => 0,
    discardRandom: a => add(EFFECT_LABELS.discardRandom, a),
    cheapenHand: (count, by) => add(EFFECT_LABELS.cheapenHand, by * count),
    // Just the count — the test's strength metric weights a card double, but a card *face* that says
    // 「复制牌 2 → 4」 for a relic that copies one card is the kind of number this whole function
    // exists to avoid printing.
    copyHand: (count, _extra = 0) => add(EFFECT_LABELS.copyHand, count),
    topOfDraw: () => ['一', '二', '三', '四', '五'],
  }) as RelicContext;

  const effects = RELIC_EFFECTS[relicId];
  if (!effects) return tally;
  for (const trigger of ['battleStart', 'enemyKilled', 'firstAttacked', 'firstAttackedTurn'] as const) {
    effects.triggers?.[trigger]?.(probe(1, 3));
  }
  for (let turn = 1; turn <= 8; turn++) {
    for (const handSize of [3, 0]) {
      effects.triggers?.turnStart?.(probe(turn, handSize));
      effects.triggers?.turnEnd?.(probe(turn, handSize));
    }
  }
  for (const [key, spec] of Object.entries(effects.modifiers ?? {})) {
    const value = typeof spec === 'function' ? spec(probe(1, 3)) : (() => {
      const [m, s] = spec;
      const [a, b] = refinedPair(m, s, tier);
      return slot === 'main' ? a : b;
    })();
    add(EFFECT_LABELS[key] ?? key, COST_KEYS.has(key) ? -value : value);
  }
  return tally;
}
