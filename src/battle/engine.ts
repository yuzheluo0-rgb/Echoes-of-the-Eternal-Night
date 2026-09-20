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
import { isDeckUnlocked, starterDeck } from './chapter.ts';
import { EMPTY_POWERS, effectFor, type BattlePowers, type EffectContext } from './effects.ts';
import { ENCOUNTERS, ENEMY_BY_ID, JUNK, OATH, SCRIPTS } from './enemies.ts';
import {
  STATUS_GOOD, STATUS_LABEL,
  type EnemyState, type Intent, type LogLine, type Phase, type PlayerState, type StatusId, type Trait,
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
/** The two cards that live in a deck but not in `CARD_BY_ID`: junk, and the boss's oath. */
const OFF_DECK_CARDS: Record<string, { name: string; cost: number; text: string }> = {
  ash: JUNK.ash,
  [OATH.id]: OATH,
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

export interface BattleCard { uid: string; cardId: string }

export interface BattleState {
  version: 1;
  encounterId: string;
  deck: DeckId;
  seed: number;
  /** The live LCG state — the only source of randomness in a battle. */
  rng: number;
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

// --------------------------------------------------------------- enemy traits

function traitOf<T extends Trait['id']>(enemy: EnemyState, id: T): Extract<Trait, { id: T }> | undefined {
  const def = ENEMY_BY_ID.get(enemy.id);
  return def?.traits?.find((trait): trait is Extract<Trait, { id: T }> => trait.id === id);
}
function nameOf(enemy: EnemyState): string {
  return ENEMY_BY_ID.get(enemy.id)?.name ?? enemy.id;
}
export function livingEnemies(state: BattleState): EnemyState[] {
  return state.enemies.filter(enemy => !enemy.dead && enemy.hp > 0);
}
function keepsBlock(enemy: EnemyState): boolean {
  const def = ENEMY_BY_ID.get(enemy.id);
  if (!def) return false;
  return def.regenBlock !== undefined || KEEP_BLOCK_IDS.has(def.id);
}
/** 聚群: +amount for every *other* living enemy, counted when the attack resolves. */
function packBonus(s: BattleState, enemy: EnemyState): number {
  const trait = traitOf(enemy, 'pack');
  if (!trait) return 0;
  return trait.amount * Math.max(0, livingEnemies(s).length - 1);
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
  const hurt = Math.max(0, amount) - blocked;
  s.player.hp = Math.max(0, s.player.hp - hurt);
  log(s, `${label} → 你：${Math.max(0, amount)} 点伤害（格挡 ${blocked}，生命 −${hurt}）。`, 'bad');
  if (s.player.hp <= 0) lose(s);
  return hurt;
}

/**
 * Deaths, in order, including chains: a 亡语 that kills a neighbour makes the neighbour's own 亡语
 * fire in turn. Iterative rather than recursive so a long chain cannot blow the stack, and the queue
 * is re-collected after each burst so `dealToEnemy` stays a plain "subtract numbers" call.
 */
function settle(s: BattleState) {
  let queue = s.enemies.filter(enemy => !enemy.dead && enemy.hp <= 0);
  while (queue.length) {
    const enemy = queue.shift()!;
    if (enemy.dead) continue;
    enemy.dead = true;
    enemy.hp = 0;
    log(s, `${nameOf(enemy)} 消散。`, 'special');
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

function makeContext(s: BattleState, cardId: string, firstAttackBonus: number): EffectContext {
  const label = `「${cardName(cardId)}」`;
  /** One hit: 锋锐 and 烙印 are per hit, and so is 淬刃's opening bonus. */
  const strike = (target: EnemyState, amount: number) => {
    const extra = statusOf(s.player.statuses, 'edge')
      + (statusOf(target.statuses, 'mark') > 0 ? MARK_BONUS : 0)
      + firstAttackBonus;
    dealToEnemy(s, target, Math.max(0, amount + extra), label);
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
      if (amount <= 0) return;
      s.player.block += amount;
      log(s, `${label} · 你获得 ${amount} 点格挡（${s.player.block}）。`, 'good');
    },
    spendBlock: amount => {
      const spent = Math.min(s.player.block, Math.max(0, amount));
      s.player.block -= spent;
      if (spent > 0) log(s, `${label} · 你失去 ${spent} 点格挡（${s.player.block}）。`, 'neutral');
      return spent;
    },
    gain: (status, amount) => gainStatus(s, s.player.statuses, status, amount, '你'),
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
    draw: count => drawCards(s, count),
    bury: count => {
      const buried = buryHand(s, count);
      if (buried) log(s, `${label} · 你手牌里的 ${buried} 张牌变成了「灰烬」。`, 'bad');
      return buried;
    },
    reclaim: count => reclaimCards(s, count),
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

function spawnEnemy(s: BattleState, id: string, uid: string): EnemyState {
  const def = ENEMY_BY_ID.get(id);
  if (!def) throw new Error(`没有这种敌人：${id}`);
  const enemy: EnemyState = {
    uid, id, hp: def.hp, maxHp: def.hp, block: 0, statuses: {}, turn: 0, intent: [], dead: false,
  };
  enemy.intent = publishIntent(s, enemy);
  s.enemies.push(enemy);
  return enemy;
}

/** 灼烧 is not an attack: it burns straight through block on both sides of the field ("受到等量伤害",
 *  not "被攻击"), so the same three lines settle it for an enemy here and for the player in `beginTurn`. */
function settleScorch(s: BattleState, enemy: EnemyState) {
  const stacks = statusOf(enemy.statuses, 'scorch');
  if (stacks <= 0) return;
  enemy.hp = Math.max(0, enemy.hp - stacks);
  log(s, `灼烧 · ${nameOf(enemy)} 受到 ${stacks} 点伤害（${enemy.hp}）。`, 'good');
  setStatus(enemy.statuses, 'scorch', stacks - 1);
  settle(s);
}

/** Everything that happens before an enemy acts: its wall comes down (unless it keeps one), its
 *  passives hand out their gifts, and its 灼烧 burns. */
function startEnemyTurn(s: BattleState, enemy: EnemyState) {
  const def = ENEMY_BY_ID.get(enemy.id);
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
  s.banking = false;
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
  s.player.energy = Math.max(0, s.player.energyPerTurn + Math.min(banked, BANK_LIMIT) - drained);
  log(s, `第 ${s.turn} 回合 · 能量 ${s.player.energy}`
    + `${banked ? `（蓄火 +${Math.min(banked, BANK_LIMIT)}）` : ''}`
    + `${drained ? `（枯竭 −${drained}）` : ''}。`, 'special');

  const shrouded = statusOf(s.player.statuses, 'shrouded');
  setStatus(s.player.statuses, 'shrouded', 0);
  drawCards(s, Math.max(1, DRAW_PER_TURN - shrouded));

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

export function startBattle(encounterId: string, deck: DeckId, seed = 7): BattleState {
  const encounter = ENCOUNTERS.find(entry => entry.id === encounterId);
  if (!encounter) throw new Error(`没有这场战斗：${encounterId}`);
  if (!isDeckUnlocked(deck)) throw new Error(`第一章还不能携带「${deck}」牌组。`);
  const cards = starterDeck(deck);
  if (!cards.length) throw new Error(`「${deck}」牌组在第一章没有可用的牌。`);

  const s: BattleState = {
    version: 1,
    encounterId,
    deck,
    seed: Math.trunc(seed) >>> 0,
    rng: Math.trunc(seed) >>> 0,
    turn: 0,
    phase: 'player',
    player: {
      hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP, block: 0,
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
  s.draw = shuffled(s, cards.map(cardId => ({ uid: `c${s.uidSeq++}`, cardId })));
  encounter.units.forEach((id, index) => spawnEnemy(s, id, `${id}-${index}`));
  s.targetUid = s.enemies[0]?.uid;
  beginTurn(s);
  return s;
}

export function canPlay(state: BattleState, cardUid: string): boolean {
  if (state.phase !== 'player') return false;
  const card = state.hand.find(entry => entry.uid === cardUid);
  if (!card) return false;
  const cost = cardCost(card.cardId);
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
  const cost = cardCost(card.cardId);
  if (cost < 0) throw new Error(`「${cardName(card.cardId)}」不能直接打出。`);
  if (cost > s.player.energy) throw new Error(`能量不足，无法打出「${cardName(card.cardId)}」。`);

  s.player.energy -= cost;
  s.hand.splice(index, 1);
  if (targetUid !== undefined) s.targetUid = targetUid;
  // 淬刃 pays out on the first attack card of the turn, and only on that card.
  const firstAttackBonus = isAttackCard(card.cardId) && !s.attackPlayed ? s.powers.firstAttackBonus : 0;
  if (isAttackCard(card.cardId)) s.attackPlayed = true;
  log(s, `打出「${cardName(card.cardId)}」（能量 −${cost}，余 ${s.player.energy}）。`, 'special');

  const effect = effectFor(card.cardId);
  if (effect) effect(makeContext(s, card.cardId, firstAttackBonus));
  else if (card.cardId === OATH.id) playOath(s, makeContext(s, card.cardId, 0));
  else if (card.cardId !== 'ash') log(s, `「${cardName(card.cardId)}」还没有实装效果。`, 'neutral');

  s.discard.push(card);
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
  if (typeof s.encounterId !== 'string' || !ENCOUNTERS.some(entry => entry.id === s.encounterId)) return false;
  if (!DECK_IDS.includes(s.deck)) return false;
  if (!PHASES.includes(s.phase)) return false;
  if (!Number.isInteger(s.turn) || s.turn < 1) return false;
  if (!Number.isInteger(s.seed) || !Number.isInteger(s.rng) || s.rng < 0 || s.rng > 0xFFFFFFFF) return false;

  const p = s.player;
  if (!p || typeof p !== 'object') return false;
  if (p.maxHp !== PLAYER_MAX_HP || !Number.isInteger(p.hp) || p.hp < 0 || p.hp > p.maxHp) return false;
  if (!Number.isInteger(p.block) || p.block < 0) return false;
  if (!Number.isInteger(p.energy) || p.energy < 0) return false;
  if (p.energyPerTurn !== ENERGY_PER_TURN) return false;
  if (!validStatuses(p.statuses)) return false;

  if (!Array.isArray(s.enemies) || !s.enemies.length || !s.enemies.every(validEnemy)) return false;
  if (![s.hand, s.draw, s.discard, s.exhaust, s.log].every(Array.isArray)) return false;
  if (s.hand.length > HAND_LIMIT) return false;

  if (!s.hand.every(card => card && Object.keys(card).every(key => key === 'uid' || key === 'cardId'))) return false;
  const cards = [...s.hand, ...s.draw, ...s.discard, ...s.exhaust];
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
