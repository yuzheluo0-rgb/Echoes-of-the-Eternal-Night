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

import type { EnemyState, LogLine, PlayerState, StatusId } from './types.ts';

export type RelicSlot = 'main' | 'sub';

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
  /** Picks the main or the sub number. Write `v(3, 1)` — do not branch on `slot` for a plain scaling. */
  v: (main: number, sub: number) => number;
  /** True in the main slot. For the relics whose two slots differ by rule rather than by number. */
  main: boolean;
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
  flint: { triggers: { battleStart: c => already(c, 'ember') ? c.block(1) : c.status('player', 'ember', 1) } },
  whetstone: { triggers: { battleStart: c => already(c, 'edge') ? c.block(1) : c.status('player', 'edge', 1) } },
  'hemp-rope': { triggers: { battleStart: c => already(c, 'rampart') ? c.block(2) : c.status('player', 'rampart', 1) } },
  // Sub pays on every third hit instead of every hit. `c.hits` is a battle-wide tally the engine
  // keeps, so the rule stays a pure function of the state and nothing has to mutate during a query.
  'iron-nail': { modifiers: { attackDamage: c => c.main ? 1 : (c.hits % 3 === 0 ? 1 : 0) } },
  'dry-ration': { modifiers: { victoryHeal: [3, 1] } },
  'copper-coin': { modifiers: { victoryGold: [5, 2] } },
  'candle-stub': {
    triggers: {
      battleStart: c => { c.draw(1); if (!c.main) c.discardRandom(1); },
    },
  },
  'empty-vial': { triggers: { battleStart: c => { if (c.main || c.hpFraction < .5) c.heal(2); } } },
  'fish-bone': { triggers: { turnEnd: c => { if (c.handSize === 0) c.block(c.v(2, 1)); } } },
  'stone-shard': { modifiers: { firstAttackDamage: [3, 1] } },
  'rope-knot': { triggers: { turnStart: c => { if (c.turn === 1) { c.energy(1); if (!c.main) c.discardRandom(1); } } } },
  'wood-whistle': {
    triggers: {
      turnStart: c => {
        if (c.turn !== 1) return;
        if (c.main) c.status('enemies', 'strength', -1);
        else c.statusOn(c.enemies[0], 'strength', -1);
      },
    },
  },
  'dead-wick': { triggers: { turnStart: c => { if (c.hpFraction < c.v(.5, .25)) c.status('player', 'ember', 1); } } },
  'chipped-bowl': { triggers: { battleStart: c => already(c, 'retaliate') ? c.block(2) : c.status('player', 'retaliate', 1) } },

  // ------------------------------------------------------------------ 旧物
  'brass-watch': { triggers: { turnStart: c => { if (c.turn === c.v(5, 7)) c.energy(1); } } },
  'brass-key': { triggers: { battleStart: c => c.tutor(c.main ? 'attack' : 'skill') } },
  compass: {
    triggers: {
      battleStart: c => c.main
        ? c.statusOn(c.enemies[0], 'mark', 1)
        // 「随机一个」 — the battle's own stream picks, so a seed still replays the same target.
        : c.statusOn(c.enemies[Math.floor(c.roll() * c.enemies.length)], 'mark', 1),
    },
  },
  hourglass: { triggers: { turnStart: c => { if (c.turn === 3) c.draw(c.v(2, 1)); } } },
  'iron-bell': {
    triggers: {
      battleStart: c => c.main
        ? c.status('enemies', 'scorch', 1)
        : c.statusOn(c.enemies[Math.floor(c.roll() * c.enemies.length)], 'scorch', 1),
    },
  },
  // The lesser slot only pays on the first three turns — a turn condition, so the cost path stays a
  // pure read rather than something that counts how often it has been asked.
  'broken-comb': { modifiers: { firstSkillCost: c => c.main || c.turn <= 3 ? -1 : 0 } },
  waterskin: { modifiers: { healMultiplier: [100, 50] } },
  'bone-whistle': { triggers: { battleStart: c => c.cheapenHand(1, 1, c.main ? 0 : 1) } },
  'brass-mirror': { triggers: { battleStart: c => c.copyHand(1, c.main ? 0 : 1) } },
  'salt-jar': { modifiers: { scorchDamage: c => c.main || c.subject === c.enemies[0] ? 1 : 0 } },
  'iron-tongs': { triggers: { firstAttacked: c => c.block(c.v(4, 2)) } },
  'work-gloves': { modifiers: { firstAttackDamage: [2, 1] } },
  'clay-lamp': {
    triggers: {
      turnEnd: c => {
        if (c.player.energy < 2) return;
        if (!c.main && c.count('lamp') >= 3) return;   // the lesser slot pays three times a battle
        c.bump('lamp');
        c.status('player', 'ember', 1);
      },
    },
  },
  'chain-link': { triggers: { battleStart: c => c.status('player', 'rampart', c.v(2, 1)) } },
  'dry-herbs': { triggers: { battleStart: c => c.heal(c.v(4, 2)) } },
  'musket-balls': { flags: ['extraHitFirstAttack'] },
  'leather-bracer': { triggers: { firstAttackedTurn: c => c.status('player', 'retaliate', 2) } },
  'charred-block': { triggers: { enemyKilled: c => { if (c.byScorch) c.status('player', 'ember', c.v(2, 1)); } } },
  'old-map': { triggers: { battleStart: c => { c.draw(c.v(2, 1)); c.discardRandom(c.v(2, 1)); } } },
  'tin-cup': { modifiers: { victoryHeal: [6, 3] } },
  'dog-tag': {
    triggers: {
      battleStart: c => c.main
        ? c.status('enemies', 'mark', 1)
        : c.statusOn([...c.enemies].sort((a, b) => b.maxHp - a.maxHp)[0], 'mark', 1),
    },
  },
  'tar-lamp': { triggers: { turnStart: c => { if (c.player.block === 0) c.block(c.v(3, 2)); } } },

  // ------------------------------------------------------------------ 珍品
  'night-lantern': { modifiers: { firstAttackDamage: [3, 2] } },
  'ash-urn': {
    triggers: {
      battleStart: c => {
        const moved = c.purgeJunk();
        if (moved) c.log(`灰烬瓮 · 收走了 ${moved} 张「灰烬」。`, 'good');
      },
    },
  },
  ledger: { modifiers: { goldBonus: [50, 25] } },
  'ember-seed': {
    triggers: {
      turnStart: c => {
        if (c.main) c.status('player', 'ember', 1);
        else if (c.turn === 1 || c.turn === 4 || c.turn === 7) c.status('player', 'ember', 1);
      },
    },
  },
  // The cost tax is main-slot only: the lesser slot gives up the extra damage *and* the tax, so it
  // is a discount on both sides of the card rather than only the good half of it.
  'broken-edge': { modifiers: { attackDamage: [3, 2], firstCardCost: c => c.main ? 1 : 0 } },
  // One flag, two strengths: the engine asks *which slot* supplies it. Main catches any first card,
  // sub only catches it if that card was an attack.
  'twin-mirrors': { flags: ['retainFirstCard'] },
  'smith-hammer': { modifiers: { firstPowerCost: [-2, -1] } },
  'hair-shirt': { triggers: { turnStart: c => { c.loseHp(1); c.status('player', 'edge', c.v(2, 1)); } } },
  spyglass: {
    triggers: {
      battleStart: c => {
        // The print says "look at the top three and take one". With no choice prompt at battle start
        // the honest simplification is to take the top card and **say which ones were there**, so
        // the player can still see what they passed over instead of it silently being a plain draw.
        const top = c.topOfDraw(c.main ? 3 : 2);
        if (!top.length) return;
        c.log(`观星镜 · 抽牌堆顶：${top.join(' / ')}，取走「${top[0]}」。`, 'neutral');
        c.draw(1);
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
        c.status('player', 'ember', 1);
      },
    },
  },
  'moss-jar': { modifiers: { victoryHeal: [8, 4] } },
  'storm-wood': { modifiers: { kindling: c => c.main || c.turn <= 3 ? 1 : 0 } },
  'brass-hand': { triggers: { battleStart: c => c.block(Math.floor((1 - c.hpFraction) * (c.main ? 20 : 10))) } },
  'iron-mask': { flags: ['lethalSave'] },
  'burning-book': { triggers: { turnEnd: c => { if (c.main || c.turn <= 2) c.cheapenHand(1, 1); } } },
  'bell-clapper': {
    triggers: {
      battleStart: c => {
        if (c.main) { c.stripBlock(2); c.status('enemies', 'mark', 1); }
        else { c.stripBlock(2); c.statusOn(c.enemies[Math.floor(c.roll() * c.enemies.length)], 'mark', 1); }
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
