/**
 * Chapter-I battle engine — deterministic, presentation-free, and pure. Every entry point clones its
 * input (`structuredClone`) and never writes to it, so the UI can keep old states around for undo,
 * animation and replays. Same seed plus the same calls gives the same battle, byte for byte.
 *
 * TURN FLOW
 *   1. 玩家回合开始 — 灼烧结算（你身上有的话）→ 格挡按「壁垒」保留 → 蓄火/枯竭折成能量 →
 *      抽 5 张（缠布每层少 1，至少 1）→ 「不动」补上格挡与壁垒。
 *   2. 出牌 — 扣能量，跑 `CARD_EFFECTS[cardId]`，牌进弃牌堆。
 *   3. 结束回合 — 蓄火结算进 `statuses.bank`，弃掉整手牌。
 *   4. 敌人回合 — 每个存活敌人依次：清格挡（`keepsBlock` 例外）→ 聚群/馈赠 → 灼烧结算 →
 *      执行 intent → 把下回合的 intent 写回头顶。
 *   5. 回到 1。
 *
 * JUDGEMENT CALLS (each one is a place the brief left open — see the notes on the named functions):
 *   - **两种「埋」是不同的东西。** 翻找 (`bury` intent) takes random cards out of the *discard pile*
 *     and into `exhaust` — the scavenger eats your graveyard. `EffectContext.bury` is the card-facing
 *     one from `effects.ts` and turns cards in *hand* into 灰烬; no chapter-I card calls it, and the
 *     frozen interface's own doc comment is why it still reads that way.
 *   - **反震 / 攒烬 在「下一个玩家回合开始时」清零，不在按下结束回合时。** The brief lists them
 *     under 结束回合, but 反震 only ever fires while the *enemies* act, so clearing it at the moment
 *     the player ends the turn would make 逆守 a dead card. They are cleared in `beginTurn`, i.e. at
 *     the end of the full round, which is what "本回合内" means for both of them.
 *   - **灼烧 is symmetric.** The brief only settles it on enemies, but an intent can hand 灼烧 to the
 *     player (`DEBUFF('scorch')`), so `beginTurn` settles the player's own stacks the same way.
 *   - **deathBurst hits the player too.** `types.ts` says "every other unit on the field, allies
 *     included"; the roster has no deathBurst user, and the trait is read straight off `ENEMIES`.
 *   - **聚群 (`pack`) is evaluated when the attack resolves**, from the living count at that moment,
 *     so killing an escort really does soften the next bite. `intentFor()` is the display path that
 *     shows the boosted number — see the note there.
 *   - **换岗 / 「未熄的誓言」** are hard-coded to the boss id (`hearthwatcher`), because the card is
 *     not in `CARD_BY_ID` and the effect is not in `CARD_EFFECTS`.
 *   - **拾回 takes the top of the discard pile**, and 翻找 buries random cards of the hand: neither has
 *     a UI channel to make a choice with (`playCard` only carries a target), so both pick in-engine.
 */

import { CARD_BY_ID, DECK_IDS, type DeckId } from '../cards/index.ts';
import { chapterDeck, isDeckUnlocked } from './chapter.ts';
import { RELIC_BY_ID } from '../relics/relics.ts';
import { EMPTY_POWERS, effectFor, type BattlePowers, type EffectContext } from './effects.ts';
import {
  effectsFor, readModifier, refinedPair, refineSteps,
  type RefineTier, type RelicContext, type RelicFlag, type RelicModifierKey, type RelicSlot,
  type RelicTrigger,
} from './relics.ts';
import { upgradeFor, type Upgrade } from './upgrades.ts';
import {
  ALL_ENCOUNTERS, ENEMY_BY_ID, JUNK, MUTATIONS, MUTATION_BY_ID, MUTATION_CHANCE, MUTABLE_RANKS, OATH,
  SCRIPTS, type Encounter,
} from './enemies.ts';
import {
  STATUS_GOOD, STATUS_LABEL,
  type EnemyDefinition, type EnemyState, type Intent, type LogLine, type Phase, type PlayerState,
  type StatusId, type Trait,
} from './types.ts';

export const PLAYER_MAX_HP = 60;
export const ENERGY_PER_TURN = 3;
export const DRAW_PER_TURN = 5;
export const HAND_LIMIT = 10;
/** No more than four things may stand against you — summons past that simply fail. */
export const FIELD_LIMIT = 4;
/** 蓄火 keeps at most this much energy for the next turn. */
export const BANK_LIMIT = 3;
/** 烙印: attacks against a marked enemy deal this much extra, per hit. */
export const MARK_BONUS = 3;
/** 换岗 shuffles one of these into your draw pile, and playing it feeds the boss. */
export const OATH_WATCHER = 'hearthwatcher';
export const OATH_HEAL = 6;

const LOG_LIMIT = 200;
const LOG_KEEP = 160;

const TONES: LogLine['tone'][] = ['good', 'bad', 'neutral', 'special'];
const PHASES: Phase[] = ['player', 'enemy', 'won', 'lost'];

/**
 * 残壁 — 照壁's 回响.
 *
 * The weakened copy the keyword promises, and it is a **named token rather than a copy of the card
 * that made it**. That is not a shortcut, it is the only sound shape: a duplicate carrying 回响 would
 * produce another duplicate on its way out, and the chain would never close. A distinct id with no
 * 回响 on it ends after one card, which is what 「一个弱化复制品」 says.
 *
 * Weaker than 照壁 on both axes that matter: half the block for half the cost, so it is strictly
 * worse per energy and worth less per card. It is still a real card — an extra body is an extra body —
 * which is the point of paying 2 energy for 照壁 in the first place.
 */
const ECHO_WALL = { name: '残壁', cost: 1, text: '获得 3 点格挡。', tag: '回声', accent: '#d9a45f' };

/** Cards that live in a deck but not in `CARD_BY_ID`: junk, the boss's oath, and 照壁's echo. */
const OFF_DECK_CARDS: Record<string, {
  name: string; cost: number; text: string; tag?: string; accent?: string;
}> = {
  ash: JUNK.ash,
  [OATH.id]: OATH,
  'echo-01': ECHO_WALL,
};

/**
 * Which enemies keep their block when their own turn starts. `types.ts` gives `EnemyState` no room
 * for a per-instance flag and that file is frozen, so the switch lives here, keyed by *definition*
 * id — a summoned copy inherits it, which is what you want.
 *
 * 潜草者 is the one: it lurks for three turns behind `BLOCK(4, '潜伏')`, and that rotation only reads
 * as a wall if the stacks pile up (4 → 8 → 12). Every other foe blocks for a single round on purpose
 * (商队首领's 清点货物, 守望者's 护灯拍), and those walls must come down again or the player could
 * never get through them.
 *
 * This replaced 骨堆 when the roster was rewritten for the grassland — the brief's original note was
 * "骨堆是靠 block 意图反复叠", and 潜草者's 潜伏 rotation is the same shape. An enemy whose definition
 * carries `regenBlock` also keeps its block (that is what the field means); none does yet.
 */
const KEEP_BLOCK_IDS = new Set(['stalker']);

export interface BattleCard {
  uid: string;
  cardId: string;
  /** 打磨过的副本。 The bonus lives on the *instance*, so a run can hold one polished 割线 and one
   *  plain one — which is exactly what happens after a campfire. */
  upgraded?: boolean;
}

export interface BattleState {
  version: 1;
  encounterId: string;
  /** The main deck. When a run supplies a sub deck, `sub` carries the other half of the pair. */
  deck: DeckId;
  /** The sub deck the pile was splashed from, if any. See `chapterDeck`. */
  sub?: DeckId;
  /**
   * The two relics the run is carrying, by id. **Ids, never handlers** — every entry point
   * `structuredClone`s the state, and a function would not survive the clone. Behaviour is looked up
   * in `./relics.ts` the same way card behaviour is looked up in `./effects.ts`.
   */
  relics?: { main?: string; sub?: string };
  /**
   * Which relics have been **淬炼**, and how far. Keyed by relic id rather than by slot.
   *
   * Keyed by id because the refinement belongs to the *thing*, not to the shelf it is standing on:
   * `swapRelics` moves a relic between 主/副 and a slot-keyed map would have to remember to move the
   * refinement with it, which is one more place to get out of step for no gain.
   */
  refined?: Record<string, RefineTier>;
  /** Battle-scoped scratch space for relics: 「每场只生效三次」 and friends. Cleared with the battle. */
  marks?: Record<string, number>;
  /** Attack hits landed this battle, for 铁钉's 「每第 3 次命中」. */
  hits?: number;
  /**
   * Per-card-instance cost deltas, keyed by `uid` — 「随机一张手牌费用 -1，本场战斗有效」.
   * Keyed by instance rather than by card id so two copies of 割线 can end up costing different
   * amounts, which is what actually happens when you play 焚书 twice.
   */
  costMarks?: Record<string, number>;
  seed: number;
  /** The live LCG state for **the card stream and nothing else**. See `spawnRng`. */
  rng: number;
  /**
   * A second, independent stream for encounter composition — how many of each monster turned up,
   * what their HP rolled, and which of them mutated.
   *
   * It is deliberately not `rng`. Slay the Spire rolls a monster's HP when the *combat* is generated,
   * before any deck exists, and keeping the two apart here buys the same thing: `rng` means exactly
   * one thing ("the order cards come out in"), so a fight's shape never shifts because the shuffle
   * happened to run first, and a test about 蓄火 cannot be knocked over by a wolf rolling 强健的.
   */
  spawnRng: number;
  /** Player turns taken. 1 on the opening turn. */
  turn: number;
  phase: Phase;
  player: PlayerState;
  enemies: EnemyState[];
  hand: BattleCard[];
  draw: BattleCard[];
  discard: BattleCard[];
  exhaust: BattleCard[];
  powers: BattlePowers;
  log: LogLine[];
  /** The enemy the player last aimed at; falls back to the first living one. */
  targetUid?: string;
  /** Cards played this turn — what 连缀 counts. */
  playedThisTurn: number;
  /** 淬刃: whether this turn's first attack card has already been played. */
  attackPlayed: boolean;
  /** 断齿梳: whether this turn's first skill card has already been played. Cleared each turn. */
  skillPlayedThisTurn?: boolean;
  /** 铁匠锤: whether this battle's first power card has already been played. Never cleared. */
  powerPlayedThisBattle?: boolean;
  /** 蓄火: set by `bank()`, read when the turn ends. */
  banking: boolean;
  uidSeq: number;
  summonSeq: number;
  logSeq: number;
}

const clone = <T,>(value: T): T => structuredClone(value);

// ---------------------------------------------------------------- randomness

function random(s: BattleState): number {
  s.rng = (Math.imul(s.rng, 1664525) + 1013904223) >>> 0;
  return s.rng / 4294967296;
}

/** Fisher–Yates over the battle's own stream. Never `Math.random`. */
function shuffled<T>(s: BattleState, items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random(s) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// -------------------------------------------------------------------- logging

function log(s: BattleState, text: string, tone: LogLine['tone'] = 'neutral') {
  s.logSeq += 1;
  s.log.push({ id: s.logSeq, text, tone });
  if (s.log.length > LOG_LIMIT) s.log = s.log.slice(-LOG_KEEP);
}

// ------------------------------------------------------------------ card data

export function cardName(cardId: string): string {
  return CARD_BY_ID.get(cardId)?.name ?? OFF_DECK_CARDS[cardId]?.name ?? cardId;
}
/** Energy cost, or -1 for a card that cannot be played straight from hand. */
export function cardCost(cardId: string): number {
  return CARD_BY_ID.get(cardId)?.cost ?? OFF_DECK_CARDS[cardId]?.cost ?? -1;
}

/**
 * 引火 — the first card of a turn costs 1 less, to a floor of 0. The fire is hottest when you first
 * feed it.
 *
 * This exists because 3 energy is the right *base* and 4 is too much: at 4 the 断罪之刃 deck, whose
 * cards average 0.68 energy, simply empties its hand and wastes a quarter of the energy it is given
 * every turn. A flat discount instead lands between the two, and it lands there unevenly on purpose
 * — it is worth a whole extra card to 长明壁垒 (every card of which costs at least 1) and close to
 * nothing to 断罪之刃 (which leads with 0-cost cards anyway). The rule balances itself.
 *
 * It needs no new state: `playedThisTurn` already means exactly "is this the opening card".
 */
export const KINDLING_DISCOUNT = 1;

/**
 * What a card costs to play *right now*, which is what the UI must show and the engine must charge.
 *
 * `uid` is the card *instance*: relics can make one copy of a card cheaper than another, so the
 * per-instance mark has to be part of the price. Callers that only have the id get the unmarked cost,
 * which is the right answer for a card that is not in hand.
 */
export function cardCostNow(state: BattleState, cardId: string, uid?: string): number {
  const base = cardCost(cardId);
  // A card that cannot be played from hand (-1) is not discounted into playability.
  if (base < 0) return base;
  const card = CARD_BY_ID.get(cardId);
  let cost = base + (uid ? state.costMarks?.[uid] ?? 0 : 0);

  // 引火, deepened by 雷击木.
  if (state.playedThisTurn === 0) cost -= KINDLING_DISCOUNT + relicModifier(state, 'kindling');

  // Relic rules that discount the first card of a *kind*. These stack with 引火 rather than
  // replacing it: one is about being the first card of the turn, the others about being the first
  // skill or the first power, and a card can be both.
  if (state.playedThisTurn === 0) cost += relicModifier(state, 'firstCardCost');
  if (card?.type === 'skill' && !state.skillPlayedThisTurn) cost += relicModifier(state, 'firstSkillCost');
  if (card?.type === 'power' && !state.powerPlayedThisBattle) cost += relicModifier(state, 'firstPowerCost');

  return Math.max(0, cost);
}
function cardText(cardId: string): string {
  return CARD_BY_ID.get(cardId)?.text ?? OFF_DECK_CARDS[cardId]?.text ?? '';
}
function isAttackCard(cardId: string): boolean {
  return CARD_BY_ID.get(cardId)?.type === 'attack';
}
/** Rules text for a card in hand — read from here, because junk and oaths are not in `CARD_BY_ID`. */
export function cardRules(cardId: string): string {
  return cardText(cardId);
}
/**
 * The line under the name on a card the library does not know. Junk and the oath have no tag of their
 * own and read as what they are; 照壁's echo does, because calling a card you were *given* 「牌堆里的
 * 异物」 would be telling the player it is a piece of junk.
 */
export function cardTag(cardId: string): string {
  return OFF_DECK_CARDS[cardId]?.tag ?? '牌堆里的异物';
}
/**
 * The colour to draw a card the library does not know in. Absent means the plain grey the junk face
 * has always used, which is right for 灰烬 — a card an enemy shoved into your deck.
 *
 * 残壁 carries one because it is the opposite kind of card: something you were *given*, by a card you
 * spent two energy on. Drawing it in the same grey as junk tells the player their echo is rubbish.
 */
export function cardAccent(cardId: string): string | undefined {
  return OFF_DECK_CARDS[cardId]?.accent;
}

// --------------------------------------------------------------- enemy traits

/**
 * The definition an enemy is *actually* running: its own, with its 异变 folded in.
 *
 * Everything that reads traits, `regenBlock` or keep-block has to come through here. Reading
 * `ENEMY_BY_ID` directly would silently give a mutated enemy the base version of the very field its
 * mutation set — 「披甲的」 would be a name and a colour and nothing else.
 */
function defOf(enemy: EnemyState): EnemyDefinition | undefined {
  const base = ENEMY_BY_ID.get(enemy.id);
  if (!base) return undefined;
  const mutation = enemy.mutation ? MUTATION_BY_ID.get(enemy.mutation) : undefined;
  if (!mutation) return base;
  return { ...base, regenBlock: mutation.regenBlock ?? base.regenBlock };
}

function traitOf<T extends Trait['id']>(enemy: EnemyState, id: T): Extract<Trait, { id: T }> | undefined {
  const def = defOf(enemy);
  return def?.traits?.find((trait): trait is Extract<Trait, { id: T }> => trait.id === id);
}
/** The name as the player sees it, 异变 prefix included. Exported because the battle page has to
 *  match log lines against the same string this prints. */
export function enemyName(enemy: EnemyState): string {
  const base = ENEMY_BY_ID.get(enemy.id)?.name ?? enemy.id;
  const mutation = enemy.mutation ? MUTATION_BY_ID.get(enemy.mutation) : undefined;
  return mutation ? `${mutation.prefix}${base}` : base;
}
const nameOf = enemyName;
export function livingEnemies(state: BattleState): EnemyState[] {
  return state.enemies.filter(enemy => !enemy.dead && enemy.hp > 0);
}
function keepsBlock(enemy: EnemyState): boolean {
  const def = defOf(enemy);
  if (!def) return false;
  return def.regenBlock !== undefined || KEEP_BLOCK_IDS.has(def.id);
}
/**
 * 聚群: +amount for every *other* living enemy **of the same kind**, counted when the attack resolves.
 *
 * The same-kind clause is load-bearing. Counting the whole field meant a 影狼 standing next to 头狼
 * and two 潜草者 was getting +6 and biting for 11 — more than the miniboss it was standing behind —
 * so 草甸上的头狼 dealt 54 damage in one turn against a 60-health player. 「同伴」 means packmates.
 *
 * It also gives the two wolf-shaped enemies different jobs: the pack scales off its own numbers,
 * and the 头狼 buffs by handing out 力量 instead. Neither steps on the other.
 */
function packBonus(s: BattleState, enemy: EnemyState): number {
  const trait = traitOf(enemy, 'pack');
  if (!trait) return 0;
  const packmates = livingEnemies(s).filter(other => other.uid !== enemy.uid && other.id === enemy.id).length;
  return trait.amount * packmates;
}

// ------------------------------------------------------------------- intents

/** The intents as they stand *right now* — `pack` and 力量 folded in. This is what the UI should
 *  print (`intentText(intentFor(state, enemy)[0])`), because both numbers move during a turn: the
 *  stored `enemy.intent` is the script's own text, straight from the rotation. */
export function intentFor(state: BattleState, enemy: EnemyState): Intent[] {
  if (enemy.dead) return enemy.intent;
  const pack = packBonus(state, enemy);
  const strength = enemy.statuses.strength ?? 0;
  return enemy.intent.map(intent => {
    if (intent.kind !== 'attack') return intent;
    const extra = pack + strength;
    return extra === 0 ? intent : { ...intent, amount: intent.amount + extra };
  });
}

export function intentText(intent: Intent): string {
  const note = intent.note;
  const lead = note ? `${note} · ` : '';
  switch (intent.kind) {
    case 'attack': {
      const times = intent.times ?? 1;
      return `${lead}攻击 ${intent.amount}${times > 1 ? `×${times}` : ''}`;
    }
    case 'block': return `${lead}格挡 ${intent.amount}`;
    case 'buff': return `${lead}${STATUS_LABEL[intent.status]} +${intent.amount}`;
    case 'debuff': return `${lead}你 +${intent.amount} ${STATUS_LABEL[intent.status]}`;
    case 'pollute': return `${lead}落灰${intent.amount > 1 ? ` ×${intent.amount}` : ''}`;
    case 'drain': return `${lead}枯竭 ${intent.amount}`;
    case 'ward': return `${lead}同僚格挡 ${intent.amount}`;
    case 'bury': return `${lead}掩埋 ${intent.amount}`;
    case 'summon': return `${lead}召唤 ${ENEMY_BY_ID.get(intent.id)?.name ?? intent.id}`;
    // 吞光's note already reads as the whole line ("吞光 · 吃下 4 层"), so it is not prefixed.
    case 'devour': return note || '吞光';
    case 'steal': return `${lead}窃取 ${STATUS_LABEL[intent.status]}`;
    case 'special': return intent.note;
  }
}

/**
 * Publish (or republish) an enemy's intents. The scripts hand back shared literals — `rotate()` returns
 * the same array and the same objects every cycle — so everything is copied before it is stored.
 */
function publishIntent(s: BattleState, enemy: EnemyState): Intent[] {
  const script = SCRIPTS[ENEMY_BY_ID.get(enemy.id)?.script ?? ''];
  if (!script) return [];
  return script(enemy, s.player).map(intent => ({ ...intent }));
}

// -------------------------------------------------------------- status plumbing

function statusOf(statuses: Partial<Record<StatusId, number>>, status: StatusId): number {
  return statuses[status] ?? 0;
}
function setStatus(statuses: Partial<Record<StatusId, number>>, status: StatusId, value: number) {
  if (value > 0) statuses[status] = value; else delete statuses[status];
}
function gainStatus(
  s: BattleState, statuses: Partial<Record<StatusId, number>>, status: StatusId, amount: number, who: string,
) {
  if (!amount) return;
  const next = Math.max(0, statusOf(statuses, status) + amount);
  setStatus(statuses, status, next);
  log(s, `${who} ${amount > 0 ? '获得' : '失去'} ${Math.abs(amount)} 层${STATUS_LABEL[status]}（${next}）。`,
    STATUS_GOOD[status] ? 'good' : 'bad');
}

// --------------------------------------------------------------------- relics

/** The two slots. Main first, so a pair that both fire on the same trigger reads in that order. */
const RELIC_SLOTS: RelicSlot[] = ['main', 'sub'];

/**
 * The abilities a relic effect may use.
 *
 * Built fresh on every call rather than cached on the state: the state is `structuredClone`d at every
 * entry point, and a closure would not survive the clone. This is the same reason `relics` holds ids
 * rather than handlers.
 */
function relicContext(s: BattleState, slot: RelicSlot, extra: Partial<RelicContext> = {}): RelicContext {
  const relicId = s.relics?.[slot];
  const refine = relicId ? s.refined?.[relicId] : undefined;
  const steps = refineSteps(refine);
  // Pick the slot's number, then bump it. Every relic that writes a `[main, sub]` pair gets 淬炼 for
  // free through here — see `refinedPair`, which is the same arithmetic and is what the tests assert.
  const climbed = (main: number, sub: number) => {
    const [m, u] = refinedPair(main, sub, refine);
    return slot === 'main' ? m : u;
  };
  return {
    slot,
    refine,
    v: climbed,
    main: slot === 'main',
    n: base => base + steps,
    steps,
    turn: s.turn,
    hpFraction: s.player.maxHp ? s.player.hp / s.player.maxHp : 0,
    player: s.player,
    handSize: s.hand.length,
    enemies: livingEnemies(s),
    hits: s.hits ?? 0,
    count: key => s.marks?.[`${relicId}:${key}`] ?? 0,
    bump: (key, by = 1) => {
      s.marks = s.marks ?? {};
      const marked = `${relicId}:${key}`;
      s.marks[marked] = (s.marks[marked] ?? 0) + by;
    },
    // Off the encounter stream. Spending `rng` here would reorder the deck — the same mistake that
    // split `spawnRng` off in the first place.
    roll: () => spawnRandom(s),
    log: (text, tone = 'neutral') => log(s, text, tone),
    status: (who, status, amount) => {
      if (!amount) return;
      if (who === 'player') gainStatus(s, s.player.statuses, status, amount, '你');
      else for (const enemy of livingEnemies(s)) gainStatus(s, enemy.statuses, status, amount, nameOf(enemy));
    },
    statusOn: (enemy, status, amount) => {
      if (!enemy || enemy.dead || !amount) return;
      gainStatus(s, enemy.statuses, status, amount, nameOf(enemy));
    },
    block: amount => {
      if (!amount) return;
      s.player.block = Math.max(0, s.player.block + amount);
      log(s, `遗物 · 你获得 ${amount} 点格挡（${s.player.block}）。`, 'good');
    },
    energy: amount => {
      if (!amount) return;
      s.player.energy = Math.max(0, s.player.energy + amount);
      log(s, `遗物 · 能量 ${amount > 0 ? '+' : ''}${amount}（${s.player.energy}）。`, 'good');
    },
    draw: count => { if (count > 0) drawCards(s, count); },
    heal: amount => {
      if (amount <= 0) return;
      const healed = Math.min(amount, s.player.maxHp - s.player.hp);
      s.player.hp += healed;
      if (healed) log(s, `遗物 · 你回复 ${healed} 点生命（${s.player.hp}）。`, 'good');
    },
    loseHp: amount => {
      if (amount <= 0) return;
      s.player.hp = Math.max(0, s.player.hp - amount);
      log(s, `遗物 · 你失去 ${amount} 点生命（${s.player.hp}）。`, 'bad');
      if (s.player.hp <= 0) lose(s);
    },
    stripBlock: amount => {
      for (const enemy of livingEnemies(s)) {
        const taken = Math.min(enemy.block, Math.max(0, amount));
        if (!taken) continue;
        enemy.block -= taken;
        log(s, `遗物 · ${nameOf(enemy)} 失去 ${taken} 点格挡（${enemy.block}）。`, 'good');
      }
    },
    reclaim: count => reclaimCards(s, count),
    tutor: kind => tutor(s, kind),
    purgeJunk: () => purgeJunk(s),
    discardRandom: count => discardRandom(s, count),
    cheapenHand: (count, by, floor = 0) => cheapenHand(s, count, by, floor),
    copyHand: (count, extra = 0) => copyHand(s, count, extra),
    topOfDraw: count => s.draw.slice(0, Math.max(0, count)).map(card => cardName(card.cardId)),
    ...extra,
  };
}

/** Ask both relics for a number. Called from the hot paths (every attack hit), so it stays small.
 *  Exported for the run layer, which reads the victory payouts (`victoryHeal`, `goldBonus`). */
export function relicModifier(s: BattleState, key: RelicModifierKey, extra: Partial<RelicContext> = {}): number {
  if (!s.relics) return 0;
  let total = 0;
  for (const slot of RELIC_SLOTS) {
    const spec = effectsFor(s.relics[slot])?.modifiers?.[key];
    if (spec === undefined) continue;
    total += readModifier(spec, relicContext(s, slot, extra));
  }
  return total;
}

/**
 * Which slot is supplying this rule, if any.
 *
 * A flag is binary but its *effect* is not: 铁面具 saves you either way, but the sub slot makes you
 * pay for it, and 燧发枪弹's extra swing is at half damage only in the sub slot. So the engine asks
 * which slot, not just whether.
 */
function relicFlagSlot(s: BattleState, flag: RelicFlag): RelicSlot | undefined {
  if (!s.relics) return undefined;
  return RELIC_SLOTS.find(slot => effectsFor(s.relics![slot])?.flags?.includes(flag));
}

/** Is this rule switched on by either slot? */
function relicFlag(s: BattleState, flag: RelicFlag): boolean {
  return relicFlagSlot(s, flag) !== undefined;
}

/** Fire a moment. Both slots, main first. */
function fireRelics(s: BattleState, trigger: RelicTrigger, extra: Partial<RelicContext> = {}) {
  if (!s.relics) return;
  for (const slot of RELIC_SLOTS) {
    const handler = effectsFor(s.relics[slot])?.triggers?.[trigger];
    if (handler) handler(relicContext(s, slot, extra));
  }
}

/** 灰烬瓮 — takes the junk an enemy put in your deck back out of it. Never touches `exhaust`. */
function purgeJunk(s: BattleState): number {
  const junk = (cards: BattleCard[]) => cards.filter(card => card.cardId === 'ash').length;
  const before = junk(s.hand) + junk(s.draw);
  s.hand = s.hand.filter(card => card.cardId !== 'ash');
  s.draw = s.draw.filter(card => card.cardId !== 'ash');
  return before;
}

/** Drops `count` cards at random out of hand. Removed from the back so indices stay valid. */
function discardRandom(s: BattleState, count: number) {
  const picks = shuffled(s, s.hand.map((_, index) => index)).slice(0, Math.max(0, Math.floor(count)));
  for (const index of picks.sort((a, b) => b - a)) {
    const [card] = s.hand.splice(index, 1);
    s.discard.push(card);
    log(s, `遗物 · 弃掉「${cardName(card.cardId)}」。`, 'neutral');
  }
}

/**
 * 断齿梳 / 借物 — makes cards in hand cheaper for the rest of the battle. The discount is stored per
 * card instance, not per card id, so two copies of 割线 can cost different amounts.
 */
function cheapenHand(s: BattleState, count: number, by: number, floor: number) {
  const picks = shuffled(s, s.hand.map((_, index) => index)).slice(0, Math.max(0, Math.floor(count)));
  for (const index of picks) {
    const card = s.hand[index];
    s.costMarks = s.costMarks ?? {};
    // The floor is on the final price, so it becomes a floor on the delta.
    const lowest = floor - cardCost(card.cardId);
    const next = Math.max(lowest, (s.costMarks[card.uid] ?? 0) - by);
    if (next === s.costMarks[card.uid]) continue;
    s.costMarks[card.uid] = next;
    log(s, `遗物 · 「${cardName(card.cardId)}」本场战斗费用 ${by > 0 ? '降低' : '提高'} ${Math.abs(by)} 点。`, 'good');
  }
}

/** 铜钥匙 — digs the topmost card of a kind out of the draw pile and puts it in your hand. */
function tutor(s: BattleState, kind: 'attack' | 'skill' | 'power') {
  if (s.hand.length >= HAND_LIMIT) { log(s, `手牌已满（${HAND_LIMIT} 张），找出来的牌放不下。`, 'neutral'); return; }
  const index = s.draw.findIndex(card => CARD_BY_ID.get(card.cardId)?.type === kind);
  if (index < 0) return;
  const [card] = s.draw.splice(index, 1);
  s.hand.push(card);
  log(s, `遗物 · 从抽牌堆找出了「${cardName(card.cardId)}」。`, 'good');
}

/**
 * 铜镜 — duplicates cards already in hand. The copy gets a fresh `uid`, so it is a genuinely separate
 * card and not a second reference to the same one; a relic that pushed the same object twice would
 * have both copies move together the first time either was played.
 */
function copyHand(s: BattleState, count: number, extra: number) {
  const picks = shuffled(s, s.hand.map((_, index) => index)).slice(0, Math.max(0, Math.floor(count)));
  for (const index of picks) {
    if (s.hand.length >= HAND_LIMIT) { log(s, `手牌已满（${HAND_LIMIT} 张），复制品放不下了。`, 'neutral'); return; }
    const source = s.hand[index];
    const copy: BattleCard = { uid: `r${s.uidSeq++}`, cardId: source.cardId };
    if (extra) s.costMarks = { ...s.costMarks, [copy.uid]: extra };
    s.hand.push(copy);
    log(s, `遗物 · 复制了「${cardName(source.cardId)}」${extra ? `（复制品费用 +${extra}）` : ''}。`, 'good');
  }
}

/**
 * 回响 — puts a card the library does not have straight into the player's hand.
 *
 * Only `OFF_DECK_CARDS` ids are accepted, and that is deliberate rather than incidental: this is the
 * one funnel that conjures a card from nothing, and letting it name anything in the library would put
 * 「打出这张牌，把随便哪张牌加入手牌」 one typo away. The token it is built for (残壁) is registered
 * next to 灰烬 and 未熄的誓言, which is where cards-that-are-not-in-the-library already live.
 *
 * A fresh `uid` with the `r` prefix, like `copyHand` — the card is a genuinely separate instance, not
 * a second reference to one already in a pile.
 */
function addToHand(s: BattleState, cardId: string, label: string) {
  if (!OFF_DECK_CARDS[cardId]) return;
  if (s.hand.length >= HAND_LIMIT) {
    log(s, `手牌已满（${HAND_LIMIT} 张），回声没有落脚的地方。`, 'neutral');
    return;
  }
  s.hand.push({ uid: `r${s.uidSeq++}`, cardId });
  log(s, `${label} · 「${cardName(cardId)}」留在了你手里。`, 'good');
}

// ------------------------------------------------------------------- the piles

function drawCards(s: BattleState, count: number) {
  let full = false;
  for (let i = 0; i < count; i++) {
    if (s.hand.length >= HAND_LIMIT) { full = true; break; }
    if (!s.draw.length) {
      if (!s.discard.length) break;
      s.draw = shuffled(s, s.discard);
      s.discard = [];
      log(s, '抽牌堆已空 · 弃牌堆洗回抽牌堆。', 'neutral');
    }
    const card = s.draw.shift()!;
    s.hand.push(card);
    log(s, `抽到「${cardName(card.cardId)}」。`, 'neutral');
  }
  if (full) log(s, `手牌已满（${HAND_LIMIT} 张），停止抽牌。`, 'neutral');
}

/** `EffectContext.bury` — turns cards in hand into junk. The instance stays where it is, only its face
 *  changes, so the number of cards in the battle never moves. (No chapter-I card calls it yet; the
 *  enemy's 翻找 is the *other* bury, below.) */
function buryHand(s: BattleState, count: number): number {
  const picks = shuffled(s, s.hand.map((_, index) => index)).slice(0, Math.max(0, Math.floor(count)));
  for (const index of picks) s.hand[index].cardId = 'ash';
  return picks.length;
}

/**
 * 翻找 — 拾荒犬 eats the discard pile. `count` cards are picked at random and taken out of the battle
 * for good: they land in `exhaust`, where nothing can draw, reclaim or shuffle them back. Since the
 * whole hand is discarded at the end of every turn, the pile is never empty when this runs.
 */
function buryDiscard(s: BattleState, count: number): BattleCard[] {
  const picks = shuffled(s, s.discard.map((_, index) => index))
    .slice(0, Math.max(0, Math.floor(count)))
    .sort((a, b) => b - a); // descending, so removing one does not shift the next index
  const buried = picks.map(index => s.discard.splice(index, 1)[0]);
  s.exhaust.push(...buried);
  return buried;
}

/** 拾回 takes from the top of the discard pile (the last card thrown away). There is no UI channel to
 *  pick one — `playCard` only carries a target — so the engine picks deterministically. */
function reclaimCards(s: BattleState, count: number): number {
  let taken = 0;
  for (let i = 0; i < count; i++) {
    if (!s.discard.length || s.hand.length >= HAND_LIMIT) break;
    const card = s.discard.pop()!;
    s.hand.push(card);
    taken += 1;
    log(s, `拾回「${cardName(card.cardId)}」。`, 'good');
  }
  if (!taken) log(s, '弃牌堆里没有可以拾回的牌。', 'neutral');
  return taken;
}

/** Inserts a card at a random depth of the draw pile. Always rolls, so the stream stays stable. */
function insertIntoDraw(s: BattleState, cardId: string): BattleCard {
  const card: BattleCard = { uid: `c${s.uidSeq++}`, cardId };
  const at = Math.floor(random(s) * (s.draw.length + 1));
  s.draw.splice(at, 0, card);
  return card;
}

// ------------------------------------------------------------------- damage

function shatterCheck(s: BattleState, enemy: EnemyState) {
  const trait = traitOf(enemy, 'shatter');
  if (!trait) return;
  enemy.hp = Math.max(0, enemy.hp - trait.amount);
  log(s, `${nameOf(enemy)} 的格挡被一击打穿 · 碎裂，自身受到 ${trait.amount} 点伤害。`, 'good');
}

/** Raw damage to an enemy: block first, then health. No death processing — see `settle`. */
function dealToEnemy(s: BattleState, enemy: EnemyState, amount: number, label: string) {
  if (enemy.dead) return;
  const blockBefore = enemy.block;
  const blocked = Math.min(blockBefore, Math.max(0, amount));
  enemy.block = blockBefore - blocked;
  const hurt = Math.max(0, amount) - blocked;
  enemy.hp = Math.max(0, enemy.hp - hurt);
  log(s, `${label} → ${nameOf(enemy)}：${Math.max(0, amount)} 点伤害（格挡 ${blocked}，生命 −${hurt}）。`,
    hurt > 0 ? 'good' : 'neutral');
  // 碎裂 is per *hit*, not per turn: only a single blow that empties a non-empty wall breaks it.
  if (blockBefore > 0 && enemy.block === 0) shatterCheck(s, enemy);
}

function lose(s: BattleState) {
  if (s.phase === 'lost') return;
  s.phase = 'lost';
  log(s, '火熄了 · 战斗失败。', 'special');
}

function damagePlayer(s: BattleState, amount: number, label: string): number {
  const blocked = Math.min(s.player.block, Math.max(0, amount));
  s.player.block -= blocked;
  let hurt = Math.max(0, amount) - blocked;
  // 铁面具 — survives the first blow that would have finished you, once. Applied before the
  // subtraction rather than after, because "you are at 1" has to be true when 火熄了 would fire.
  const saveSlot = !s.marks?.['lethal:spent'] && s.player.hp > 0 && hurt >= s.player.hp
    ? relicFlagSlot(s, 'lethalSave')
    : undefined;
  if (saveSlot) {
    s.marks = { ...s.marks, 'lethal:spent': 1 };
    log(s, '铁面具 · 这一下本该要你的命，面具替你留住了最后一点火。', 'special');
    hurt = Math.max(0, s.player.hp - 1);
    // The lesser slot saves you, but charges for it.
    if (saveSlot === 'sub') gainStatus(s, s.player.statuses, 'drained', 1, '铁面具');
  }
  s.player.hp = Math.max(0, s.player.hp - hurt);
  log(s, `${label} → 你：${Math.max(0, amount)} 点伤害（格挡 ${blocked}，生命 −${hurt}）。`, 'bad');
  if (s.player.hp <= 0) { lose(s); return hurt; }
  // 铁夹 / 皮革护腕 answer being hit. Fired *after* the damage so the block they grant is not eaten
  // by the very blow that triggered them, and gated on a mark so "the first time" means it.
  if (!s.marks?.['attacked:battle']) {
    s.marks = { ...s.marks, 'attacked:battle': 1 };
    fireRelics(s, 'firstAttacked');
  }
  if (!s.marks?.['attacked:turn']) {
    s.marks = { ...s.marks, 'attacked:turn': 1 };
    fireRelics(s, 'firstAttackedTurn');
  }
  return hurt;
}

/**
 * Deaths, in order, including chains: a 亡语 that kills a neighbour makes the neighbour's own 亡语
 * fire in turn. Iterative rather than recursive so a long chain cannot blow the stack, and the queue
 * is re-collected after each burst so `dealToEnemy` stays a plain "subtract numbers" call.
 */
function settle(s: BattleState, scorched?: EnemyState) {
  let queue = s.enemies.filter(enemy => !enemy.dead && enemy.hp <= 0);
  while (queue.length) {
    const enemy = queue.shift()!;
    if (enemy.dead) continue;
    enemy.dead = true;
    enemy.hp = 0;
    log(s, `${nameOf(enemy)} 消散。`, 'special');
    // The one place an enemy death can be observed. `scorched` is the enemy `settleScorch` just
    // burned, so 焦木块 can tell a death by fire from a death by blade.
    fireRelics(s, 'enemyKilled', { fallen: enemy, byScorch: enemy === scorched });
    const burst = traitOf(enemy, 'deathBurst');
    if (!burst) continue;
    log(s, `${nameOf(enemy)} 炸开 · 对场上其他所有单位造成 ${burst.amount} 点伤害。`, 'bad');
    for (const other of s.enemies) {
      if (other === enemy || other.dead) continue;
      dealToEnemy(s, other, burst.amount, `${nameOf(enemy)} 的爆裂`);
    }
    if (s.phase === 'player' || s.phase === 'enemy') damagePlayer(s, burst.amount, `${nameOf(enemy)} 的爆裂`);
    queue = queue.concat(s.enemies.filter(other => !other.dead && other.hp <= 0));
    if (s.phase === 'won' || s.phase === 'lost') break;
  }
  if ((s.phase === 'player' || s.phase === 'enemy') && !livingEnemies(s).length) {
    s.phase = 'won';
    log(s, '草地上只剩下灰 · 战斗胜利。', 'special');
  }
}

// ------------------------------------------------------------ effect context

function currentTarget(s: BattleState): EnemyState | undefined {
  const chosen = s.targetUid ? s.enemies.find(enemy => enemy.uid === s.targetUid) : undefined;
  if (chosen && !chosen.dead && chosen.hp > 0) return chosen;
  return livingEnemies(s)[0];
}

function makeContext(
  s: BattleState, cardId: string, firstAttackBonus: number, isAttack = false, upgrade?: Upgrade,
): EffectContext {
  const label = `「${cardName(cardId)}」`;
  /** 打磨 — the deltas are folded in at the four places a card can hand something out, which is what
   *  lets an upgrade be a table row instead of a second effect function. */
  const plus = (value: number, delta: number | undefined) => value + (delta ?? 0);
  /** 燧发枪弹 — the first *attack card of the battle* swings once more, for half. Spent on first use,
   *  so a multi-hit card does not get one bonus swing per hit. */
  const bonusSwing = isAttack && !s.marks?.['extraHit:spent']
    ? relicFlagSlot(s, 'extraHitFirstAttack')
    : undefined;

  const strike = (target: EnemyState, amount: number) => {
    // `printed` is what the card says it does, upgrade included — so the 余势 swing halves *that*
    // rather than the pre-polish number.
    const printed = Math.max(0, plus(amount, upgrade?.hit));
    // The one place "your attack hits do +N" belongs: upstream of `dealToEnemy`, so it covers both
    // `hit` and `hitAll`, it is applied once *per hit* rather than once per card, and it is naturally
    // out of reach of 反震 and 亡语, which are not your attacks.
    const extra = statusOf(s.player.statuses, 'edge')
      + (statusOf(target.statuses, 'mark') > 0 ? MARK_BONUS : 0)
      + firstAttackBonus
      + relicModifier(s, 'attackDamage');
    s.hits = (s.hits ?? 0) + 1;
    dealToEnemy(s, target, Math.max(0, printed + extra), label);
    if (bonusSwing && !s.marks?.['extraHit:spent'] && !target.dead) {
      // The sub slot swings at half. Half of the card's own printed damage either way, not half of
      // the buffed total — it is the swing that repeats, not everything 锋锐 and 烙印 did to it.
      const swing = bonusSwing === 'sub' ? Math.max(1, Math.floor(printed / 2)) : printed;
      s.marks = { ...s.marks, 'extraHit:spent': 1 };
      log(s, `燧发枪弹 · 余势再中一次${bonusSwing === 'sub' ? '（减半）' : ''}。`, 'good');
      dealToEnemy(s, target, swing, `${label}（余势）`);
    }
    if (s.powers.emberPerHit > 0 && !target.dead) {
      gainStatus(s, s.player.statuses, 'ember', s.powers.emberPerHit, '你');
    }
  };
  return {
    cardId,
    // Re-resolved per hit: a multi-hit card whose target dies rolls the rest onto the next one
    // instead of dumping damage into a corpse.
    target: () => currentTarget(s),
    living: () => livingEnemies(s),
    hit: (amount, times = 1) => {
      for (let i = 0; i < times; i++) {
        const target = currentTarget(s);
        if (!target) return;
        strike(target, amount);
      }
    },
    hitAll: amount => {
      for (const target of livingEnemies(s)) strike(target, amount);
    },
    block: amount => {
      const gain = plus(amount, upgrade?.block);
      if (gain <= 0) return;
      s.player.block += gain;
      log(s, `${label} · 你获得 ${gain} 点格挡（${s.player.block}）。`, 'good');
    },
    spendBlock: amount => {
      const spent = Math.min(s.player.block, Math.max(0, amount));
      s.player.block -= spent;
      if (spent > 0) log(s, `${label} · 你失去 ${spent} 点格挡（${s.player.block}）。`, 'neutral');
      return spent;
    },
    gain: (status, amount) => gainStatus(s, s.player.statuses, status, plus(amount, upgrade?.status?.[status]), '你'),
    spend: (status, amount) => {
      const have = statusOf(s.player.statuses, status);
      const spent = Math.min(have, Math.max(0, Math.floor(amount)));
      if (spent > 0) {
        setStatus(s.player.statuses, status, have - spent);
        log(s, `${label} · 你消耗 ${spent} 层${STATUS_LABEL[status]}（${have - spent}）。`, 'neutral');
      }
      return spent;
    },
    mark: count => {
      const target = currentTarget(s);
      if (!target) return;
      gainStatus(s, target.statuses, 'mark', count, nameOf(target));
    },
    // 长明灯 (`scorchBonus`) stacks on top of the polish delta for both of these — they are the only
    // two places the player lights anything, so it is the whole of the card's effect.
    burn: count => {
      const target = currentTarget(s);
      if (!target) return;
      gainStatus(s, target.statuses, 'scorch',
        plus(count, upgrade?.status?.scorch) + s.powers.scorchBonus, nameOf(target));
    },
    burnAll: count => {
      const amount = plus(count, upgrade?.status?.scorch) + s.powers.scorchBonus;
      for (const target of livingEnemies(s)) gainStatus(s, target.statuses, 'scorch', amount, nameOf(target));
    },
    flare: count => {
      if (!count) return;
      s.player.energy += count;
      log(s, `${label} · 能量 +${count}（${s.player.energy}）。`, 'good');
      // 爆燃 borrows from the next turn rather than creating energy — `beginTurn` reads this, subtracts
      // it, and clears it, so two 引信 in one turn cost two on the next.
      gainStatus(s, s.player.statuses, 'drained', count, '爆燃');
    },
    spendEnemyStatus: (status, max) => {
      const target = currentTarget(s);
      if (!target) return 0;
      const had = statusOf(target.statuses, status);
      const spent = Math.min(had, Math.max(0, Math.floor(max)));
      if (spent <= 0) return 0;
      setStatus(target.statuses, status, had - spent);
      log(s, `${label} · 消耗 ${nameOf(target)} 身上的 ${spent} 层${STATUS_LABEL[status]}（${had - spent}）。`, 'neutral');
      return spent;
    },
    draw: count => drawCards(s, Math.max(0, plus(count, upgrade?.draw))),
    bury: count => {
      const buried = buryHand(s, count);
      if (buried) log(s, `${label} · 你手牌里的 ${buried} 张牌变成了「灰烬」。`, 'bad');
      return buried;
    },
    reclaim: count => reclaimCards(s, Math.max(0, plus(count, upgrade?.reclaim))),
    addToHand: cardId => addToHand(s, cardId, label),
    gainEnergy: count => {
      if (!count) return;
      s.player.energy += count;
      log(s, `${label} · 你获得 ${count} 点能量（${s.player.energy}）。`, 'good');
    },
    loseHp: count => {
      s.player.hp = Math.max(0, s.player.hp - count);
      log(s, `${label} · 你失去 ${count} 点生命（${s.player.hp}）。`, 'bad');
      if (s.player.hp <= 0) lose(s);
    },
    handSize: () => s.hand.length,
    played: () => s.playedThisTurn,
    stacks: status => statusOf(s.player.statuses, status),
    // Re-resolved against the current target, like everything else here — a card that reads 灼烧 off
    // 「目标」 means the enemy the player picked, not whichever one happened to be first.
    enemyStacks: status => {
      const target = currentTarget(s);
      return target ? statusOf(target.statuses, status) : 0;
    },
    clearEnemyStatus: status => {
      const target = currentTarget(s);
      if (!target) return 0;
      const had = statusOf(target.statuses, status);
      if (had <= 0) return 0;
      setStatus(target.statuses, status, 0);
      log(s, `${label} · 消耗 ${nameOf(target)} 身上的 ${had} 层${STATUS_LABEL[status]}。`, 'neutral');
      return had;
    },
    clearAllEnemyStatus: status => {
      let taken = 0;
      for (const enemy of livingEnemies(s)) {
        const had = statusOf(enemy.statuses, status);
        if (had <= 0) continue;
        setStatus(enemy.statuses, status, 0);
        taken += had;
      }
      if (taken) log(s, `${label} · 消耗全场 ${taken} 层${STATUS_LABEL[status]}。`, 'neutral');
      return taken;
    },
    heal: count => {
      const healed = Math.min(Math.max(0, plus(count, upgrade?.heal)), s.player.maxHp - s.player.hp);
      if (healed <= 0) return;
      s.player.hp += healed;
      log(s, `${label} · 你回复 ${healed} 点生命（${s.player.hp}）。`, 'good');
    },
    playerBlock: () => s.player.block,
    bank: () => {
      if (s.banking) return;
      s.banking = true;
      log(s, `${label} · 蓄火：本回合未用完的能量会留到下回合（最多 ${BANK_LIMIT} 点）。`, 'good');
    },
    power: s.powers,
  };
}

/** 未熄的誓言. Not in `CARD_EFFECTS` because it is not a card from the library — every copy the player
 *  plays heals the boss and hands it a point of 力量, which is the whole point of 换岗. */
function playOath(s: BattleState, ctx: EffectContext) {
  log(s, `「${OATH.name}」· ${OATH.text}`, 'special');
  ctx.gain('ember', 3);
  ctx.draw(1);
  for (const enemy of livingEnemies(s)) {
    if (enemy.id !== OATH_WATCHER) continue;
    const healed = Math.min(OATH_HEAL, enemy.maxHp - enemy.hp);
    enemy.hp += healed;
    enemy.statuses.strength = statusOf(enemy.statuses, 'strength') + 1;
    log(s, `誓言回响 · ${nameOf(enemy)} 回复 ${healed} 点生命（${enemy.hp}），力量 +1。`, 'bad');
  }
}

// ------------------------------------------------------------------ the enemy

/** FNV-1a. Only used to fold an encounter id into the encounter stream's seed. */
function hashId(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0;
  return hash >>> 0;
}

/** Steps the encounter stream. Same LCG constants as the card stream, different state. */
function spawnRandom(s: BattleState): number {
  s.spawnRng = (Math.imul(s.spawnRng, 1664525) + 1013904223) >>> 0;
  return s.spawnRng / 4294967296;
}

/** Inclusive roll off the encounter stream, so a seed still replays the fight exactly. */
function rollBetween(s: BattleState, [min, max]: [number, number]): number {
  if (max <= min) return min;
  return min + Math.floor(spawnRandom(s) * (max - min + 1));
}

/** Only the small ranks mutate: an elite or a boss is already the thing you have to decide about. */
function rollMutation(s: BattleState, def: EnemyDefinition): string | undefined {
  if (!MUTABLE_RANKS.includes(def.rank)) return undefined;
  return spawnRandom(s) < MUTATION_CHANCE ? MUTATIONS[Math.floor(spawnRandom(s) * MUTATIONS.length)].id : undefined;
}

function spawnEnemy(s: BattleState, id: string, uid: string, mutationId?: string): EnemyState {
  const def = ENEMY_BY_ID.get(id);
  if (!def) throw new Error(`没有这种敌人：${id}`);
  const mutation = mutationId ? MUTATION_BY_ID.get(mutationId) : undefined;
  const rolled = rollBetween(s, def.hp);
  const hp = mutation?.hpScale ? Math.ceil(rolled * mutation.hpScale) : rolled;
  const enemy: EnemyState = {
    uid, id, mutation: mutationId, hp, maxHp: hp, block: 0,
    statuses: mutation?.statuses ? { ...mutation.statuses } : {},
    turn: 0, intent: [], dead: false,
  };
  enemy.intent = publishIntent(s, enemy);
  s.enemies.push(enemy);
  return enemy;
}

/**
 * Roll each unit's count, then each one's 异变, then spawn. Counts are rolled for a unit before any of
 * its members spawn so the *size* of a fight never depends on how many mutations happened to land.
 */
function spawnEncounter(s: BattleState, encounter: Encounter) {
  let index = 0;
  for (const unit of encounter.units) {
    const def = ENEMY_BY_ID.get(unit.id);
    if (!def) throw new Error(`没有这种敌人：${unit.id}`);
    const count = rollBetween(s, unit.count);
    for (let i = 0; i < count; i++) {
      // The field holds four. A high roll on a three-unit encounter is capped rather than refused —
      // the fight is smaller than the dice said, which is a better failure than a crash.
      if (s.enemies.length >= FIELD_LIMIT) return;
      spawnEnemy(s, unit.id, `${unit.id}-${index++}`, rollMutation(s, def));
    }
  }
}

/** 灼烧 is not an attack: it burns straight through block on both sides of the field ("受到等量伤害",
 *  not "被攻击"), so the same three lines settle it for an enemy here and for the player in `beginTurn`. */
function settleScorch(s: BattleState, enemy: EnemyState) {
  const stacks = statusOf(enemy.statuses, 'scorch');
  if (stacks <= 0) return;
  const amount = stacks + relicModifier(s, 'scorchDamage', { subject: enemy });
  enemy.hp = Math.max(0, enemy.hp - amount);
  log(s, `灼烧 · ${nameOf(enemy)} 受到 ${amount} 点伤害（${enemy.hp}）。`, 'good');
  // 焚炉 — the fire does not burn down. (秘宝, so no chapter-I relic sets this yet.)
  if (!relicFlag(s, 'scorchHolds')) setStatus(enemy.statuses, 'scorch', stacks - 1);
  settle(s, enemy);
}

/** Everything that happens before an enemy acts: its wall comes down (unless it keeps one), its
 *  passives hand out their gifts, and its 灼烧 burns. */
function startEnemyTurn(s: BattleState, enemy: EnemyState) {
  const def = defOf(enemy);
  if (def?.regenBlock !== undefined) {
    const before = enemy.block;
    enemy.block = Math.max(enemy.block, def.regenBlock);
    if (enemy.block !== before) log(s, `${nameOf(enemy)} 的格挡回到 ${enemy.block}。`, 'bad');
  } else if (enemy.block > 0 && !keepsBlock(enemy)) {
    log(s, `${nameOf(enemy)} 的格挡消散（${enemy.block}）。`, 'neutral');
    enemy.block = 0;
  }
  const gift = traitOf(enemy, 'gift');
  if (gift) gainStatus(s, s.player.statuses, gift.status, gift.amount, '你');
  settleScorch(s, enemy);
}

function summon(s: BattleState, summoner: EnemyState, id: string) {
  if (livingEnemies(s).length >= FIELD_LIMIT) {
    log(s, `${nameOf(summoner)} 想要召唤，但场上已经站满了。`, 'neutral');
    return;
  }
  const spawned = spawnEnemy(s, id, `s${s.summonSeq++}`);
  log(s, `${nameOf(summoner)} 召来了 ${nameOf(spawned)}。`, 'bad');
}

function runIntent(s: BattleState, enemy: EnemyState, intent: Intent) {
  switch (intent.kind) {
    case 'attack': {
      const times = Math.max(1, intent.times ?? 1);
      const amount = Math.max(0, intent.amount + statusOf(enemy.statuses, 'strength') + packBonus(s, enemy));
      for (let i = 0; i < times; i++) {
        if (enemy.dead || s.phase !== 'enemy') return;
        damagePlayer(s, amount, `${nameOf(enemy)} 的攻击`);
        if (s.phase !== 'enemy') return;
        // 反震 answers every single hit, not every attack action.
        const thorns = statusOf(s.player.statuses, 'retaliate');
        if (thorns > 0 && !enemy.dead) {
          log(s, `反震 · 你反击 ${nameOf(enemy)} ${thorns} 点。`, 'good');
          dealToEnemy(s, enemy, thorns, '反震');
          settle(s);
        }
      }
      return;
    }
    case 'block': {
      enemy.block += intent.amount;
      log(s, `${nameOf(enemy)} 获得 ${intent.amount} 点格挡（${enemy.block}）。`, 'bad');
      return;
    }
    case 'buff':
      gainStatus(s, enemy.statuses, intent.status, intent.amount, nameOf(enemy));
      return;
    case 'debuff':
      gainStatus(s, s.player.statuses, intent.status, intent.amount, '你');
      return;
    case 'pollute': {
      for (let i = 0; i < intent.amount; i++) insertIntoDraw(s, 'ash');
      log(s, `落灰 · ${intent.amount} 张「灰烬」被塞进你的抽牌堆。`, 'bad');
      return;
    }
    case 'drain':
      gainStatus(s, s.player.statuses, 'drained', intent.amount, '你');
      return;
    case 'ward': {
      const warded: string[] = [];
      for (const other of s.enemies) {
        if (other === enemy || other.dead) continue;
        other.block += intent.amount;
        warded.push(nameOf(other));
      }
      log(s, warded.length
        ? `${nameOf(enemy)} 为 ${warded.join('、')} 各加上 ${intent.amount} 点格挡。`
        : `${nameOf(enemy)} 想要掩护同伴，但场上只有它自己。`, 'bad');
      return;
    }
    case 'bury': {
      const buried = buryDiscard(s, intent.amount);
      log(s, buried.length
        ? `翻找 · 弃牌堆里的 ${buried.map(card => `「${cardName(card.cardId)}」`).join('、')} 被埋掉，本场战斗不再出现。`
        : '翻找 · 你的弃牌堆是空的，它什么也没找到。', 'bad');
      return;
    }
    case 'summon':
      summon(s, enemy, intent.id);
      return;
    case 'devour': {
      const ember = statusOf(s.player.statuses, 'ember');
      const edge = statusOf(s.player.statuses, 'edge');
      const eaten = ember + edge;
      setStatus(s.player.statuses, 'ember', 0);
      setStatus(s.player.statuses, 'edge', 0);
      enemy.block += eaten * 2;
      log(s, `吞光 · ${nameOf(enemy)} 吃下你 ${eaten} 层余烬与锋锐，化为 ${eaten * 2} 点格挡（${enemy.block}）。`, 'bad');
      return;
    }
    case 'steal': {
      const stolen = statusOf(s.player.statuses, intent.status);
      setStatus(s.player.statuses, intent.status, 0);
      // 向下取整，至少 1 —— the brief's rule, taken literally: a steal always pays the thief.
      const gained = Math.max(1, Math.floor(stolen / 2));
      enemy.statuses.strength = statusOf(enemy.statuses, 'strength') + gained;
      log(s, `窃取 · 你失去 ${stolen} 层${STATUS_LABEL[intent.status]}，${nameOf(enemy)} 获得 ${gained} 点力量。`, 'bad');
      return;
    }
    case 'special': {
      log(s, intent.note, 'special');
      // 换岗: the only special in the chapter, and the boss's whole gimmick.
      if (enemy.id === OATH_WATCHER) {
        insertIntoDraw(s, OATH.id);
        log(s, `换岗 · 一张「${OATH.name}」被洗进你的抽牌堆。`, 'bad');
      }
      return;
    }
  }
}

function enemyPhase(s: BattleState) {
  s.phase = 'enemy';
  log(s, '—— 敌人回合 ——', 'special');
  // Snapshot: something summoned this turn does not also act this turn.
  for (const enemy of s.enemies.filter(unit => !unit.dead)) {
    if (s.phase !== 'enemy') return;
    if (enemy.dead || enemy.hp <= 0) continue;
    startEnemyTurn(s, enemy);
    if (enemy.dead || s.phase !== 'enemy') continue;
    for (const intent of enemy.intent) {
      if (enemy.dead || s.phase !== 'enemy') break;
      runIntent(s, enemy, intent);
    }
    if (enemy.dead || s.phase !== 'enemy') continue;
    enemy.turn += 1;
    enemy.intent = publishIntent(s, enemy);
  }
  settle(s);
}

// ----------------------------------------------------------------- the player

function beginTurn(s: BattleState) {
  s.turn += 1;
  s.phase = 'player';
  s.playedThisTurn = 0;
  s.attackPlayed = false;
  s.skillPlayedThisTurn = false;
  s.banking = false;
  // 「每回合第一次被攻击」 is per turn; 「每场战斗第一次」 is not.
  if (s.marks) s.marks = { ...s.marks, 'attacked:turn': 0 };
  // 反震 and 攒烬 live for one full round: they are set during your turn and must survive the enemy
  // phase they were bought to punish, so they are cleared here rather than on 结束回合.
  setStatus(s.player.statuses, 'retaliate', 0);
  s.powers.emberPerHit = 0;

  // 灼烧 is symmetric — a debuff intent can hand it to the player, so it burns here too.
  const burn = statusOf(s.player.statuses, 'scorch');
  if (burn > 0) {
    s.player.hp = Math.max(0, s.player.hp - burn);
    setStatus(s.player.statuses, 'scorch', burn - 1);
    log(s, `灼烧 · 你受到 ${burn} 点伤害（${s.player.hp}）。`, 'bad');
    if (s.player.hp <= 0) { lose(s); return; }
  }

  // 壁垒: every stack holds one point of last turn's wall.
  const rampart = statusOf(s.player.statuses, 'rampart');
  const kept = Math.min(s.player.block, rampart);
  if (kept !== s.player.block) log(s, `壁垒 · 你保留了 ${kept} 点格挡，其余 ${s.player.block - kept} 点消散。`, 'neutral');
  else if (kept > 0) log(s, `壁垒 · 你保留了 ${kept} 点格挡。`, 'neutral');
  s.player.block = kept;

  const banked = statusOf(s.player.statuses, 'bank');
  const drained = statusOf(s.player.statuses, 'drained');
  setStatus(s.player.statuses, 'bank', 0);
  setStatus(s.player.statuses, 'drained', 0);
  // 无尽沙漏 / 永夜之心 add energy here rather than by raising `energyPerTurn`, which
  // `isValidBattle` pins to `ENERGY_PER_TURN` — the per-turn allowance is a constant, the bonus is not.
  const relicEnergy = relicModifier(s, 'energyBonus');
  s.player.energy = Math.max(0, s.player.energyPerTurn + Math.min(banked, BANK_LIMIT) - drained + relicEnergy);
  log(s, `第 ${s.turn} 回合 · 能量 ${s.player.energy}`
    + `${relicEnergy ? `（遗物 ${relicEnergy > 0 ? '+' : ''}${relicEnergy}）` : ''}`
    + `${banked ? `（蓄火 +${Math.min(banked, BANK_LIMIT)}）` : ''}`
    + `${drained ? `（枯竭 −${drained}）` : ''}。`, 'special');

  const shrouded = statusOf(s.player.statuses, 'shrouded');
  setStatus(s.player.statuses, 'shrouded', 0);
  drawCards(s, Math.max(1, DRAW_PER_TURN - shrouded + relicModifier(s, 'drawCount')));

  // Last, so a relic that grants block does not have it eaten by 壁垒's reconciliation above, and so
  // 「回合开始时若格挡为 0」 sees the block the player actually kept.
  fireRelics(s, 'turnStart');

  // 不动: the only power that pays out on its own.
  if (s.powers.turnBlock > 0) {
    s.player.block += s.powers.turnBlock;
    log(s, `不动 · 你获得 ${s.powers.turnBlock} 点格挡（${s.player.block}）。`, 'good');
  }
  if (s.powers.turnRampart > 0) {
    gainStatus(s, s.player.statuses, 'rampart', s.powers.turnRampart, '你');
  }
}

function endPlayerTurn(s: BattleState) {
  // Before the hand is thrown away: 「回合结束时随机一张手牌费用 -1」 has to be able to see the hand.
  fireRelics(s, 'turnEnd');
  if (s.banking) {
    const banked = Math.min(BANK_LIMIT, s.player.energy);
    setStatus(s.player.statuses, 'bank', banked);
    if (banked > 0) log(s, `蓄火 · ${banked} 点能量留到下回合。`, 'good');
  } else {
    setStatus(s.player.statuses, 'bank', 0);
  }
  // The whole hand goes to the discard pile, so every turn starts from a fresh five. This is also what
  // feeds 拾荒犬: the cards you just threw away are the only thing lying in the discard when 翻找 runs.
  const discarded = s.hand.length;
  s.discard.push(...s.hand);
  s.hand = [];
  if (discarded) log(s, `结束回合 · 弃掉 ${discarded} 张手牌。`, 'neutral');
}

// -------------------------------------------------------------- the public API

/** What a chapter run hands to a fight that the fight cannot work out on its own. */
export interface StartOptions {
  /** Carried-over HP. Clamped into `[0, the fight's ceiling]` — the run owns the value, not the battle. */
  hp?: number;
  /**
   * The run's 生命上限, if it has been raised.
   *
   * Absent means the plain `PLAYER_MAX_HP` baseline, which is what every caller did before a run
   * could raise its own ceiling. **Only the raising direction is legal** — `isValidBattle` refuses a
   * state below `PLAYER_MAX_HP`, because 60 is the number every constant was tuned against.
   */
  maxHp?: number;
  /** The sub deck to splash into the pile. See `chapterDeck`. */
  sub?: DeckId;
  /** The relics the run is carrying. See `BattleState.relics`. */
  relics?: { main?: string; sub?: string };
  /** Which of them have been 淬炼, and how far. See `BattleState.refined`. */
  refined?: Record<string, RefineTier>;
  /**
   * The run's own deck, if it has been edited. Absent means "deal the chapter's starting pile for
   * `deck`", which is what every caller did before a run could add, burn or polish a card.
   *
   * No `uid` here: a card's identity is per-*battle*, and this list belongs to the run. The uids are
   * stamped as the pile is dealt.
   */
  cards?: { cardId: string; upgraded?: boolean }[];
}

export function startBattle(encounterId: string, deck: DeckId, seed = 7, opts: StartOptions = {}): BattleState {
  // Any encounter in any pool, not just the five anchors: the map hands out generated fights from
  // the same list the designed ones live in.
  const encounter = ALL_ENCOUNTERS.find(entry => entry.id === encounterId);
  if (!encounter) throw new Error(`没有这场战斗：${encounterId}`);
  if (!isDeckUnlocked(deck)) throw new Error(`第一章还不能携带「${deck}」牌组。`);
  if (opts.sub !== undefined && !isDeckUnlocked(opts.sub)) throw new Error(`第一章还不能携带「${opts.sub}」牌组。`);
  const chapterCards = chapterDeck(deck, opts.sub);
  if (!chapterCards.length) throw new Error(`「${deck}」牌组在第一章没有可用的牌。`);
  // A run passes in the HP left over from the last fight, and the ceiling it has earned.
  const carried = Number.isFinite(opts.hp) ? Math.trunc(opts.hp!) : PLAYER_MAX_HP;
  /**
   * The run's 生命上限 — **not** unconditionally `PLAYER_MAX_HP`, which is what it used to be.
   *
   * The ceiling was pinned to the baseline plus the relics' own modifier, so a run's `maxHp` was
   * thrown away at the door: eight of the event table's options are 「生命上限 +N」 and a good share
   * of the reward table is too, and **every one of them bought the player nothing inside a fight**.
   * The run layer and the battle layer disagreed about the same number, and the run layer is the one
   * the player had been reading.
   *
   * Floored at `PLAYER_MAX_HP` rather than assigned: a battle may raise its ceiling above the
   * baseline and `isValidBattle` forbids lowering it, so a run can only ever be tougher than the
   * tuned baseline, never softer.
   */
  const runMaxHp = Math.max(PLAYER_MAX_HP,
    Number.isFinite(opts.maxHp) ? Math.trunc(opts.maxHp!) : PLAYER_MAX_HP);

  const s: BattleState = {
    version: 1,
    encounterId,
    deck,
    sub: opts.sub,
    seed: Math.trunc(seed) >>> 0,
    rng: Math.trunc(seed) >>> 0,
    // Seeded from the seed *and* the encounter id, so opening two different fights with the same
    // seed does not roll the same monsters.
    spawnRng: (Math.imul(Math.trunc(seed) >>> 0, 0x9e3779b1) ^ hashId(encounterId)) >>> 0,
    turn: 0,
    phase: 'player',
    relics: opts.relics,
    refined: opts.refined,
    marks: {},
    hits: 0,
    costMarks: {},
    player: {
      // Provisional. 守望者之誓 raises the ceiling, and that has to be asked of the relics *after*
      // the state exists — so it is settled a few lines down, before the opening turn.
      hp: Math.max(0, Math.min(runMaxHp, carried)), maxHp: runMaxHp, block: 0,
      energy: ENERGY_PER_TURN, energyPerTurn: ENERGY_PER_TURN, statuses: {},
    },
    enemies: [],
    hand: [],
    draw: [],
    discard: [],
    exhaust: [],
    powers: { ...EMPTY_POWERS },
    log: [],
    targetUid: undefined,
    playedThisTurn: 0,
    attackPlayed: false,
    banking: false,
    uidSeq: 0,
    summonSeq: 0,
    logSeq: 0,
  };

  log(s, `${encounter.name} · ${encounter.kind} · 战斗开始。`, 'special');
  // A run hands its own deck in; anything else gets the chapter's starting pile. The uids are
  // re-stamped here either way, because a battle's uids have to be unique *within the battle* and the
  // run's copy is not the battle's to name.
  const pile: { cardId: string; upgraded?: boolean }[] = opts.cards ?? chapterCards.map(cardId => ({ cardId }));
  s.draw = shuffled(s, pile.map(card => ({ uid: `c${s.uidSeq++}`, cardId: card.cardId, upgraded: card.upgraded })));
  spawnEncounter(s, encounter);
  s.targetUid = s.enemies[0]?.uid;

  // The ceiling is settled before anything reads 生命, and the carried-over HP is re-clamped to it —
  // a run that walked in at 60 with a +15 relic walks in at 60/75, not at 75/75.
  const ceiling = runMaxHp + relicModifier(s, 'maxHp');
  s.player.maxHp = ceiling;
  s.player.hp = Math.max(0, Math.min(ceiling, carried));

  beginTurn(s);

  // Battle-start relics fire **after** the opening turn has begun, not before it, for two reasons
  // that both showed up the moment the first batch of relics was tested:
  //
  //   1. 铜镜 copies 「a card in hand」, and before `beginTurn` there is no hand to copy from.
  //   2. `beginTurn` clears 反震 at the top of every turn (it lives one full round), so a relic that
  //      grants 反震 at battle start had it wiped before the player ever saw the number.
  //
  // The enemies are already standing either way, so 「对所有敌人造成 N 点伤害」 still has a target.
  // `settle` is called by hand because `startBattle` has no other one: without it a kill here would
  // leave an enemy at `hp <= 0 && dead === false` until the first card was played.
  fireRelics(s, 'battleStart');
  settle(s);
  return s;
}

export function canPlay(state: BattleState, cardUid: string): boolean {
  if (state.phase !== 'player') return false;
  const card = state.hand.find(entry => entry.uid === cardUid);
  if (!card) return false;
  const cost = cardCostNow(state, card.cardId, card.uid);
  return cost >= 0 && cost <= state.player.energy;
}

export function playCard(source: BattleState, cardUid: string, targetUid?: string): BattleState {
  if (source.phase !== 'player') {
    throw new Error(source.phase === 'enemy' ? '敌人正在行动，现在不能出牌。' : '战斗已经结束。');
  }
  if (!source.hand.some(entry => entry.uid === cardUid)) throw new Error('手牌里没有这张牌。');
  if (targetUid !== undefined && !source.enemies.some(enemy => enemy.uid === targetUid && !enemy.dead && enemy.hp > 0)) {
    throw new Error('目标无效。');
  }

  const s = clone(source);
  const index = s.hand.findIndex(entry => entry.uid === cardUid);
  const card = s.hand[index];
  // Read before `playedThisTurn` moves at the end of this function — that counter *is* the 引火
  // condition, so charging after the increment would silently drop the discount on every card.
  const cost = cardCostNow(s, card.cardId, card.uid);
  if (cost < 0) throw new Error(`「${cardName(card.cardId)}」不能直接打出。`);
  if (cost > s.player.energy) throw new Error(`能量不足，无法打出「${cardName(card.cardId)}」。`);

  s.player.energy -= cost;
  s.hand.splice(index, 1);
  if (targetUid !== undefined) s.targetUid = targetUid;
  const attack = isAttackCard(card.cardId);
  // 淬刃 and 守夜人的提灯 both pay out on the first attack card of the turn, and only on that card.
  const firstAttackBonus = attack && !s.attackPlayed
    ? s.powers.firstAttackBonus + relicModifier(s, 'firstAttackDamage')
    : 0;
  if (attack) s.attackPlayed = true;
  // The two cost rules that key off a card's *kind* rather than off the turn.
  const kind = CARD_BY_ID.get(card.cardId)?.type;
  if (kind === 'skill') s.skillPlayedThisTurn = true;
  if (kind === 'power') s.powerPlayedThisBattle = true;
  log(s, `打出「${cardName(card.cardId)}」（能量 −${cost}，余 ${s.player.energy}）。`, 'special');

  const upgrade = upgradeFor(card.cardId, card.upgraded);
  const effect = effectFor(card.cardId);
  if (effect) {
    // 打磨's `power` delta is applied by watching what the card actually changed rather than by
    // handing every effect a wrapped powers object: `effects.ts` writes `ctx.power.emberPerHit += 1`
    // directly, and rewriting all twenty-six of those to go through a setter is a large change for a
    // bonus that only ever lands once.
    const powersBefore = upgrade?.power ? { ...s.powers } : undefined;
    effect(makeContext(s, card.cardId, firstAttackBonus, attack, upgrade));
    if (powersBefore) {
      for (const key of Object.keys(s.powers) as (keyof typeof s.powers)[]) {
        if (s.powers[key] > powersBefore[key]) s.powers[key] += upgrade!.power!;
      }
    }
  } else if (card.cardId === OATH.id) playOath(s, makeContext(s, card.cardId, 0));
  else if (card.cardId !== 'ash') log(s, `「${cardName(card.cardId)}」还没有实装效果。`, 'neutral');

  // 双生镜 — the first card of the battle comes back to hand instead of going to the discard. The
  // lesser slot only catches it if that first card was an attack.
  const retainSlot = s.marks?.['retain:spent'] ? undefined : relicFlagSlot(s, 'retainFirstCard');
  const retains = retainSlot === 'main' || (retainSlot === 'sub' && attack);
  if (retains) {
    s.marks = { ...s.marks, 'retain:spent': 1 };
    s.hand.push(card);
    log(s, '双生镜 · 这张牌又回到了手里。', 'special');
  } else {
    s.discard.push(card);
  }
  s.playedThisTurn += 1;
  settle(s);
  return s;
}

export function endTurn(source: BattleState): BattleState {
  if (source.phase !== 'player') {
    throw new Error(source.phase === 'enemy' ? '敌人正在行动。' : '战斗已经结束。');
  }
  const s = clone(source);
  endPlayerTurn(s);
  enemyPhase(s);
  if (s.phase === 'enemy') beginTurn(s);
  return s;
}

// ------------------------------------------------------------------ validation

function validStatuses(statuses: unknown): boolean {
  if (!statuses || typeof statuses !== 'object') return false;
  return Object.entries(statuses).every(([id, value]) =>
    Object.hasOwn(STATUS_LABEL, id) && Number.isInteger(value) && (value as number) >= 0);
}

function validEnemy(enemy: unknown): boolean {
  if (!enemy || typeof enemy !== 'object') return false;
  const e = enemy as EnemyState;
  if (typeof e.uid !== 'string' || !e.uid.length || !ENEMY_BY_ID.has(e.id)) return false;
  if (e.mutation !== undefined && !MUTATION_BY_ID.has(e.mutation)) return false;
  if (!Number.isInteger(e.hp) || e.hp < 0 || !Number.isInteger(e.maxHp) || e.maxHp <= 0 || e.hp > e.maxHp) return false;
  if (!Number.isInteger(e.block) || e.block < 0) return false;
  if (!Number.isInteger(e.turn) || e.turn < 0 || typeof e.dead !== 'boolean') return false;
  if (!validStatuses(e.statuses)) return false;
  if (!Array.isArray(e.intent) || !e.intent.every(intent => intent && typeof intent === 'object' && typeof intent.kind === 'string')) return false;
  return true;
}

/** A save is valid if it is structurally sound: right shape, in-bounds numbers, a conserved deck and
 *  line-per-line log. It says nothing about whether the position is *winnable*, only that nothing in
 *  it can make the engine misbehave. */
export function isValidBattle(value: unknown): value is BattleState {
  if (!value || typeof value !== 'object') return false;
  const s = value as BattleState;
  if (s.version !== 1) return false;
  if (typeof s.encounterId !== 'string' || !ALL_ENCOUNTERS.some(entry => entry.id === s.encounterId)) return false;
  if (!DECK_IDS.includes(s.deck)) return false;
  // Optional, so every state saved before chapter runs existed stays valid.
  if (s.sub !== undefined && !DECK_IDS.includes(s.sub)) return false;
  if (s.relics !== undefined) {
    if (typeof s.relics !== 'object' || s.relics === null) return false;
    for (const id of [s.relics.main, s.relics.sub]) {
      if (id !== undefined && !RELIC_BY_ID.has(id)) return false;
    }
  }
  if (s.marks !== undefined && (!s.marks || typeof s.marks !== 'object')) return false;
  if (s.hits !== undefined && (!Number.isInteger(s.hits) || s.hits < 0)) return false;
  if (s.costMarks !== undefined) {
    if (!s.costMarks || typeof s.costMarks !== 'object') return false;
    // A mark big enough to make a 3-cost card free is fine; one big enough to make it cost 100 is a
    // corrupt save, and the cost path would happily charge it.
    if (!Object.values(s.costMarks).every(value => Number.isInteger(value) && Math.abs(value) <= 10)) return false;
  }
  if (s.skillPlayedThisTurn !== undefined && typeof s.skillPlayedThisTurn !== 'boolean') return false;
  if (s.powerPlayedThisBattle !== undefined && typeof s.powerPlayedThisBattle !== 'boolean') return false;
  if (!PHASES.includes(s.phase)) return false;
  if (!Number.isInteger(s.turn) || s.turn < 1) return false;
  if (!Number.isInteger(s.seed) || !Number.isInteger(s.rng) || s.rng < 0 || s.rng > 0xFFFFFFFF) return false;
  if (!Number.isInteger(s.spawnRng) || s.spawnRng < 0 || s.spawnRng > 0xFFFFFFFF) return false;

  const p = s.player;
  if (!p || typeof p !== 'object') return false;
  // A relic may raise the ceiling (守望者之誓), so this is a floor rather than an equality now.
  // Nothing may *lower* it — `PLAYER_MAX_HP` is still the number every other constant is tuned to.
  if (!Number.isInteger(p.maxHp) || p.maxHp < PLAYER_MAX_HP) return false;
  if (!Number.isInteger(p.hp) || p.hp < 0 || p.hp > p.maxHp) return false;
  if (!Number.isInteger(p.block) || p.block < 0) return false;
  if (!Number.isInteger(p.energy) || p.energy < 0) return false;
  if (p.energyPerTurn !== ENERGY_PER_TURN) return false;
  if (!validStatuses(p.statuses)) return false;

  if (!Array.isArray(s.enemies) || !s.enemies.length || !s.enemies.every(validEnemy)) return false;
  if (![s.hand, s.draw, s.discard, s.exhaust, s.log].every(Array.isArray)) return false;
  if (s.hand.length > HAND_LIMIT) return false;

  if (!s.hand.every(card => card && Object.keys(card).every(key =>
    key === 'uid' || key === 'cardId' || key === 'upgraded'))) return false;
  const cards = [...s.hand, ...s.draw, ...s.discard, ...s.exhaust];
  if (!cards.every(card => card.upgraded === undefined || typeof card.upgraded === 'boolean')) return false;
  const bad = cards.some(card => !card || typeof card.uid !== 'string' || typeof card.cardId !== 'string'
    || (!CARD_BY_ID.has(card.cardId) && !OFF_DECK_CARDS[card.cardId]));
  if (bad) return false;
  if (new Set(cards.map(card => card.uid)).size !== cards.length) return false;

  if (!s.log.every(line => line && Number.isInteger(line.id) && typeof line.text === 'string' && TONES.includes(line.tone))) return false;
  if (!s.powers || typeof s.powers !== 'object') return false;
  const power = s.powers;
  if (![power.firstAttackBonus, power.turnBlock, power.turnRampart, power.emberPerHit]
    .every(value => Number.isInteger(value) && value >= 0)) return false;

  if (!Number.isInteger(s.playedThisTurn) || s.playedThisTurn < 0) return false;
  if (typeof s.attackPlayed !== 'boolean' || typeof s.banking !== 'boolean') return false;
  if (!Number.isInteger(s.uidSeq) || s.uidSeq < 0) return false;
  if (!Number.isInteger(s.summonSeq) || s.summonSeq < 0) return false;
  if (!Number.isInteger(s.logSeq) || s.logSeq < 0) return false;
  if (s.targetUid !== undefined && typeof s.targetUid !== 'string') return false;
  return true;
}
