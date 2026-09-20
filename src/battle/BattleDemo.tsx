/**
 * 第一章战斗 demo —— 荒野巡夜。
 *
 * The page is a thin skin over a pure engine. Everything the player sees is either a field of
 * `BattleState` (health, block, energy, statuses, intents, the log) or an event derived from the
 * diff between two states. Nothing here calls into `src/world/**`; the map, its generation and its
 * save format are untouched by the battle layer.
 *
 * THREE IDEAS HOLD THE FILE TOGETHER
 *
 *   1. **The engine is the only source of truth.** `playCard` / `endTurn` return fresh states; the
 *      component keeps them in `useState` and never mutates one. Turn flow, pack bonuses, marks and
 *      chain counting all come out of the engine, never out of the view.
 *
 *   2. **Every animation is a diff, not a replay.** `collectFx(before, after)` reads the engine's own
 *      log lines — the only place the engine says *what* it hit and *for how much* — and turns them
 *      into timed events: which unit, how hard, which sound. Because the engine is deterministic and
 *      never uses `Math.random`, the same two states always produce the same effects.
 *
 *   3. **The tutorial is data.** `TOUR_STEPS` is a list of selectors plus copy. `TOUR_TARGETS` is
 *      exported so a test can hold the list against the classes that actually exist in this file —
 *      a spotlight pointing at nothing is worse than no spotlight at all.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  BookOpen, ChevronRight, Eye, Flame, Layers, RotateCcw, Shield, Skull, Sparkles, Swords, Volume2, VolumeX, Zap,
} from 'lucide-react';
import { sound, type SoundKind } from '../audio';
import { CardFace } from '../cards/CardFace';
import { CARD_BY_ID } from '../cards/index.ts';
import { CHAPTER_1 } from './chapter.ts';
import {
  canPlay, cardCost, cardName, cardRules, endTurn, intentFor, intentText, livingEnemies, playCard, startBattle,
  type BattleCard, type BattleState,
} from './engine.ts';
import { ENCOUNTERS, ENEMY_BY_ID } from './enemies.ts';
import {
  RANK_COLOR, RANK_LABEL, STATUS_GOOD, STATUS_LABEL, STATUS_RULE,
  type EnemyState, type Intent, type StatusId,
} from './types.ts';
import './battle.css';

const ENCOUNTER_ID = 'ch1-1';
const DECK_ID = 'blade';
/** Set once the tour has been seen through or skipped, so it never comes back on its own. */
const TOUR_KEY = 'eternal-night-battle-tutorial-v1';

/** The statuses the player can carry. All of them are shown; the ones at zero stay quiet. */
const PLAYER_STATUSES: StatusId[] = ['ember', 'edge', 'rampart', 'reflection', 'retaliate', 'bank', 'drained', 'shrouded'];
/** Battle-long modifiers the power cards install. Shown as their own row. */
const POWER_LABEL: Record<string, string> = {
  firstAttackBonus: '淬刃', turnBlock: '不动', turnRampart: '不动', emberPerHit: '攒烬',
};

// ------------------------------------------------------------------ hit effects

/**
 * What a card looks like when it lands. Five shapes, chosen from the card's own vocabulary rather
 * than from its deck alone — two cards in the same deck should not read as the same card.
 */
export type FxKind = 'strike' | 'flame' | 'shield' | 'ember' | 'heal';

/** Which sound each kind of hit makes. 灰烬 and 未熄的誓言 have no card face, so they fall through
 *  to the soft-white default. */
export function fxKindFor(cardId: string): FxKind {
  const card = CARD_BY_ID.get(cardId);
  if (!card) return 'heal';
  // 火焰: the whole 燎原余烬 deck, anything that applies a burn, and anything that pays one off.
  if (card.deck === 'flame' || card.keywords.includes('scorch') || card.pattern.startsWith('dot-')) return 'flame';
  // 格挡: every wall shape. 逆守 counts — it is bought for the block and the thorns behind it.
  if (card.pattern.includes('block') || card.pattern === 'retaliate') return 'shield';
  // 资源: the archetype currencies, plus 蓄火 (which is energy, whatever the pattern says).
  if (card.pattern.includes('resource') || card.pattern === 'energy'
    || card.keywords.some(keyword => keyword === 'ember' || keyword === 'edge' || keyword === 'reflection' || keyword === 'bank')) return 'ember';
  if (card.type === 'attack') return 'strike';
  return 'heal';
}

const FX_SOUND: Record<FxKind, SoundKind> = { strike: 'strike', flame: 'flame', shield: 'shield', ember: 'combo', heal: 'draw' };
export function fxSound(kind: FxKind): SoundKind {
  return FX_SOUND[kind];
}

/** One thing that happened, with the moment it should be shown. `at` is a delay in milliseconds
 *  from the action that caused it, so a three-hit card reads as three hits. */
export interface FxEvent {
  side: 'player' | 'enemy';
  /** The enemy this belongs to. Absent for player-side events. */
  uid?: string;
  kind: FxKind | 'death';
  at: number;
  /** The number that floats up, if any. */
  number?: string;
  tone?: 'damage' | 'block' | 'good' | 'bad';
  sound?: SoundKind;
}

/** `「割线」 → 影狼：7 点伤害（格挡 0，生命 −7）。` — one line per hit, which is why the engine's log
 *  is the right place to count hits rather than the card's printed text. */
const HIT_LINE = /^「(.+?)」 → (.+?)：(\d+) 点伤害（格挡 (\d+)，生命 −(\d+)）。$/;
const BURN_LINE = /^灼烧 · (.+?) 受到 (\d+) 点伤害/;
const DEATH_LINE = /^(.+?) 消散。$/;

const enemyName = (enemy: EnemyState): string => ENEMY_BY_ID.get(enemy.id)?.name ?? enemy.id;

/** Which unit a hit line landed on. The log prints names, and two 影狼 share one, so the hit is
 *  charged against whichever of them still has unaccounted damage left. */
function pickEnemy(state: BattleState, name: string, hurt: number, remaining: Map<string, number>): string | undefined {
  const named = state.enemies.filter(enemy => enemyName(enemy) === name);
  const pick = named.find(enemy => (remaining.get(enemy.uid) ?? 0) > 0) ?? named[0];
  if (pick) remaining.set(pick.uid, Math.max(0, (remaining.get(pick.uid) ?? 0) - hurt));
  return pick?.uid;
}

/**
 * Turn two states into a list of timed effects. Pure: the same pair of states always gives the same
 * events, which is what makes the hit effects testable without a browser.
 *
 * `cardId` is the card that was just played, if any — it decides what the hit *looks* like. During
 * the enemy phase there is no card, so hits fall back to the plain strike.
 */
export function collectFx(before: BattleState, after: BattleState, cardId?: string): FxEvent[] {
  const kind: FxKind = cardId ? fxKindFor(cardId) : 'strike';
  const events: FxEvent[] = [];
  const remaining = new Map<string, number>();
  for (const enemy of after.enemies) {
    const was = before.enemies.find(unit => unit.uid === enemy.uid);
    remaining.set(enemy.uid, Math.max(0, (was?.hp ?? enemy.hp) - enemy.hp));
  }

  let at = 0;
  let struckEnemy = false;
  let struckPlayer = false;

  for (const line of after.log) {
    if (line.id <= before.logSeq) continue;
    const hit = HIT_LINE.exec(line.text);
    if (hit) {
      const [, , target, rawAmount, rawBlocked, rawHurt] = hit;
      const amount = Number(rawAmount), hurt = Number(rawHurt), blocked = Number(rawBlocked);
      const number = hurt > 0 ? `-${amount}` : `格挡 ${blocked}`;
      const tone = hurt > 0 ? 'damage' as const : 'block' as const;
      if (target === '你') {
        events.push({ side: 'player', kind: cardId ? kind : 'strike', at, number, tone, sound: hurt > 0 ? 'strike' : 'shield' });
        struckPlayer = true;
      } else {
        events.push({ side: 'enemy', uid: pickEnemy(after, target, hurt, remaining), kind, at, number, tone, sound: fxSound(kind) });
        struckEnemy = true;
      }
      at += 180;
      continue;
    }
    const burn = BURN_LINE.exec(line.text);
    if (burn) {
      const [, target, rawAmount] = burn;
      const number = `-${rawAmount}`;
      if (target === '你') events.push({ side: 'player', kind: 'flame', at, number, tone: 'damage', sound: 'flame' });
      else events.push({ side: 'enemy', uid: pickEnemy(after, target, Number(rawAmount), remaining), kind: 'flame', at, number, tone: 'damage', sound: 'flame' });
      at += 200;
      continue;
    }
    const death = DEATH_LINE.exec(line.text);
    if (death) {
      const fallen = after.enemies.find(enemy => enemyName(enemy) === death[1] && enemy.dead);
      if (fallen) events.push({ side: 'enemy', uid: fallen.uid, kind: 'death', at, sound: 'death' });
      at += 240;
    }
  }

  // What the card did to *you*: block, a status, a power, or its own life price. The engine logs all
  // of these, but only as sentences — the diff is the tidy way to get at the numbers.
  const blockGain = Math.max(0, after.player.block - before.player.block);
  const hpLoss = Math.max(0, before.player.hp - after.player.hp);
  const gained: { id: StatusId; delta: number }[] = [];
  for (const id of new Set([...Object.keys(before.player.statuses), ...Object.keys(after.player.statuses)])) {
    const delta = (after.player.statuses[id as StatusId] ?? 0) - (before.player.statuses[id as StatusId] ?? 0);
    if (delta > 0) gained.push({ id: id as StatusId, delta });
  }
  const powers = (Object.keys(POWER_LABEL) as (keyof typeof after.powers)[])
    .map(key => ({ key, delta: after.powers[key] - before.powers[key] }))
    .filter(entry => entry.delta > 0);

  if (blockGain > 0) {
    events.push({ side: 'player', kind: cardId ? kind : 'shield', at, number: `+${blockGain} 格挡`, tone: 'block', sound: cardId ? fxSound(kind) : 'shield' });
    at += 160;
  }
  for (const gain of gained) {
    events.push({
      side: 'player', kind: cardId ? kind : 'ember', at,
      number: `${STATUS_LABEL[gain.id]} +${gain.delta}`, tone: STATUS_GOOD[gain.id] ? 'good' : 'bad',
    });
    at += 140;
  }
  for (const power of powers) {
    events.push({ side: 'player', kind: cardId ? kind : 'ember', at, number: `${POWER_LABEL[power.key]} +${power.delta}`, tone: 'good' });
    at += 140;
  }
  if (hpLoss > 0 && !struckPlayer) {
    events.push({ side: 'player', kind: 'flame', at, number: `-${hpLoss}`, tone: 'damage', sound: 'flame' });
  }
  // A card that touched nothing visible — a pure draw, a reclaim, a shuffle — still deserves to be
  // seen, or half the deck would look like it did nothing at all.
  if (cardId && !struckEnemy && blockGain === 0 && !gained.length && !powers.length && hpLoss === 0) {
    events.push({ side: 'player', kind, at, sound: fxSound(kind) });
  }
  return events;
}

/** Cards taken off the top of the draw pile by this action — the engine writes one `抽到「…」` line
 *  per card, which is also the only place a draw is distinguishable from 拾回 or 换岗. */
export function drawnCards(before: BattleState, after: BattleState): number {
  return after.log.filter(line => line.id > before.logSeq && line.text.startsWith('抽到「')).length;
}

// --------------------------------------------------------------------- the tour

export interface TourStep {
  id: string;
  title: string;
  body: string;
  /** CSS selector for the spotlight. Absent on the two steps that dim nothing. */
  target?: string;
  cta?: string;
  /** The step will not advance until the player does this. */
  gate?: 'play' | 'endTurn';
  hint?: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    title: '一场战斗，九个回合以内',
    body: '这是第一章的教学战「荒野巡夜」：你带着《断罪之刃》，对面是两只影狼。营地里有一句话——一场战斗，九个回合以内。撑得过九个回合的火，才配叫火。接下来的八步把这场战斗的规则说完，然后就不再打扰你。',
    cta: '开始',
  },
  {
    id: 'enemies',
    title: '意图写在它们头顶',
    body: '敌人头顶永远写着它下回合要做什么：打多少、格挡多少、还是要往你身上挂什么。你不需要猜，只需要决定先处理哪一个。影狼每多一只同伴，它的攻击就更狠一分。',
    target: '.bd-enemy-row',
  },
  {
    id: 'player',
    title: '生命、格挡、能量',
    body: '左边是你。格挡先于生命被打掉，而且回合结束时会全部清零——除非你有「壁垒」，每层能留下 1 点。能量每回合回满 3 点，出牌全靠它。',
    target: '.bd-player-panel',
  },
  {
    id: 'hand',
    title: '每回合五张牌',
    body: '每回合开始抽 5 张，用手上的能量打出去。回合结束时整手牌都会被弃掉，所以没有「留到下回合」这回事——能打就打。抽牌堆和弃牌堆就在左下角，点开可以看里面还剩什么。',
    target: '.bd-hand-row',
  },
  {
    id: 'card',
    title: '一张牌分三段',
    body: '左上角是费用，中间是效果，底部是关键词——把鼠标停在关键词上，它会告诉你这条规则到底怎么算。灰色的牌是这一回合打不起的牌。',
    target: '.bd-hand-card',
  },
  {
    id: 'play',
    title: '点牌，再点敌人',
    body: '点一张牌选中它，再点一只敌人指定目标，牌会立刻结算（再点一次这张牌就直接打出去）。伤害、格挡、状态都会当场落在谁身上。',
    target: '.bd-hand-row, .bd-enemy-row',
    gate: 'play',
    hint: '打出一张牌，引导会继续。',
  },
  {
    id: 'endTurn',
    title: '结束回合',
    body: '手里没有想打的牌了，就结束回合。敌人会按头顶写着的意图依次行动——顺序写在右边的战斗日志里，一条都不会漏。',
    target: '.bd-end-turn',
    gate: 'endTurn',
    hint: '点一次「结束回合」，看看它们要做什么。',
  },
  {
    id: 'free',
    title: '自由作战',
    body: '影狼是聚群的：每多一只同伴，它们的攻击就更狠，所以先剪掉数量通常比先啃最硬的更划算。下一场你会遇见萤火——它一边咬你，一边往你身上落余烬。要不要杀一个对自己有用的东西，是你自己的判断。',
    cta: '开始作战',
  },
];

/** Every selector the spotlight points at, in order. The test holds this against the classes that
 *  actually exist in this file — see `BattleDemo.test.ts`. */
export const TOUR_TARGETS: string[] = [
  '.bd-enemy-row',
  '.bd-player-panel',
  '.bd-hand-row',
  '.bd-hand-card',
  '.bd-hand-row, .bd-enemy-row',
  '.bd-end-turn',
];

function tourSeen(): boolean {
  try { return localStorage.getItem(TOUR_KEY) === '1'; } catch { return false; }
}
function markTourSeen() {
  try { localStorage.setItem(TOUR_KEY, '1'); } catch { /* Private mode still gets the tour. */ }
}

// ------------------------------------------------------------------ hit effects

/** Deterministic particle tables: no `Math.random`, so a hit looks the same every time it happens. */
const BURST = Array.from({ length: 9 }, (_, i) => {
  const angle = (i / 9) * Math.PI * 2;
  return { '--dx': `${Math.round(Math.cos(angle) * 64)}px`, '--dy': `${Math.round(Math.sin(angle) * 56)}px` };
});
const SPARKS = Array.from({ length: 7 }, (_, i) => ({ '--dx': `${(i - 3) * 13}px`, '--dy': `${-90 - (i % 3) * 34}px` }));

const INTENT_TONE: Record<Intent['kind'], string> = {
  attack: 'atk', block: 'def', ward: 'def', buff: 'hex', debuff: 'hex', drain: 'hex', steal: 'hex',
  pollute: 'junk', bury: 'junk', summon: 'spec', devour: 'spec', special: 'spec',
};
const INTENT_ICON: Record<Intent['kind'], typeof Swords> = {
  attack: Swords, block: Shield, ward: Shield, buff: Sparkles, debuff: Skull, drain: Zap, steal: Skull,
  pollute: Layers, bury: Layers, summon: Eye, devour: Flame, special: BookOpen,
};
/** `attack` is the one kind with a magnitude the player must do arithmetic on, so it is the one kind
 *  that gets a loud colour. Everything else is information, not threat. */
function intentChips(state: BattleState, enemy: EnemyState): ReactNode {
  const intents = intentFor(state, enemy);
  if (!intents.length) return <span className="bd-intent bd-intent-idle">静默</span>;
  return intents.map((intent, index) => {
    const Icon = INTENT_ICON[intent.kind];
    return <span key={index} className={`bd-intent ${INTENT_TONE[intent.kind]}`}>
      <Icon size={13} strokeWidth={1.6} />{intentText(intent)}
    </span>;
  });
}

function FxOne({ event }: { event: FxEvent }) {
  const style = { '--fx-delay': `${event.at}ms` } as CSSProperties;
  const float = event.number
    ? <span className={`fx-float ${event.tone ?? ''}`} style={style}>{event.number}</span>
    : null;
  if (!event.number) {
    if (event.kind === 'death') return <span className="fx fx-death" style={style}><i className="fx-puff" /></span>;
    if (event.kind === 'strike') return <span className="fx fx-strike" style={style}><i className="fx-slash" /><i className="fx-flash" /></span>;
    if (event.kind === 'flame') return <span className="fx fx-flame" style={style}><i className="fx-bloom" />{BURST.map((part, i) => <i key={i} className="fx-particle" style={{ ...part, '--i': i } as CSSProperties} />)}</span>;
    if (event.kind === 'shield') return <span className="fx fx-shield" style={style}><i className="fx-ring" />{SPARKS.slice(0, 3).map((_, i) => <i key={i} className="fx-ring" style={{ '--i': i } as CSSProperties} />)}</span>;
    if (event.kind === 'ember') return <span className="fx fx-ember" style={style}>{SPARKS.map((part, i) => <i key={i} className="fx-particle" style={{ ...part, '--i': i } as CSSProperties} />)}</span>;
    return <span className="fx fx-heal" style={style}><i className="fx-bloom" /></span>;
  }
  return <>
    {float}
    {event.kind === 'strike' && <span className="fx fx-strike" style={style}><i className="fx-slash" /><i className="fx-flash" /></span>}
    {event.kind === 'flame' && <span className="fx fx-flame" style={style}><i className="fx-bloom" />{BURST.slice(0, 5).map((part, i) => <i key={i} className="fx-particle" style={{ ...part, '--i': i } as CSSProperties} />)}</span>}
    {event.kind === 'shield' && <span className="fx fx-shield" style={style}><i className="fx-ring" /></span>}
    {event.kind === 'ember' && <span className="fx fx-ember" style={style}>{SPARKS.slice(0, 4).map((part, i) => <i key={i} className="fx-particle" style={{ ...part, '--i': i } as CSSProperties} />)}</span>}
    {event.kind === 'death' && <span className="fx fx-death" style={style}><i className="fx-puff" /></span>}
  </>;
}

function FxLayer({ events, className }: { events: FxEvent[]; className?: string }) {
  if (!events.length) return null;
  return <div className={`bd-fx ${className ?? ''}`} aria-hidden="true">
    {events.map((event, index) => <FxOne key={`${event.at}-${index}-${event.number ?? event.kind}`} event={event} />)}
  </div>;
}

/** The layered health bar. The fill snaps to the new value; the white ghost behind it lags, so a hit
 *  leaves a bright residue that drains away a beat later. */
function HealthBar({ hp, maxHp, block, tone, id }: { hp: number; maxHp: number; block: number; tone: 'player' | 'enemy'; id?: string }) {
  const pct = Math.max(0, Math.min(100, (hp / maxHp) * 100));
  return <div className={`bd-bar bd-bar-${tone}`} data-bar={id}>
    <div className="bd-bar-track">
      <div className="bd-bar-ghost" style={{ width: `${pct}%` }} />
      <div className="bd-bar-fill" style={{ width: `${pct}%` }} />
      <span className="bd-bar-shine" />
    </div>
    <span className="bd-bar-num">{hp}<i>/</i>{maxHp}</span>
    {block > 0 && <span className="bd-block" key={block} title={`格挡 ${block} · 先于生命被打掉`}>{block}</span>}
  </div>;
}

function StatusPills({ statuses, all }: { statuses: Partial<Record<StatusId, number>>; all?: boolean }) {
  const ids = all ? PLAYER_STATUSES : PLAYER_STATUSES.filter(id => (statuses[id] ?? 0) > 0);
  if (!ids.length) return <span className="bd-pill-empty">身上没有状态</span>;
  return <>
    {ids.map(id => {
      const value = statuses[id] ?? 0;
      return <span key={id} className={`bd-pill ${STATUS_GOOD[id] ? 'good' : 'bad'} ${value ? '' : 'zero'}`}
        title={`${STATUS_LABEL[id]} · ${STATUS_RULE[id]}`}>
        {STATUS_LABEL[id]}<b>{value}</b>
      </span>;
    })}
  </>;
}

function EnemyPills({ enemy }: { enemy: EnemyState }) {
  const ids = (Object.keys(enemy.statuses) as StatusId[]).filter(id => (enemy.statuses[id] ?? 0) > 0);
  if (!ids.length) return null;
  return <>{ids.map(id => <span key={id} className={`bd-pill ${STATUS_GOOD[id] ? 'good' : 'bad'}`}
    title={`${STATUS_LABEL[id]} · ${STATUS_RULE[id]}`}>{STATUS_LABEL[id]}<b>{enemy.statuses[id]}</b></span>)}</>;
}

/** A card the library does not know: 灰烬 and 未熄的誓言 live in the engine, not in `CARD_BY_ID`. */
function JunkFace({ card }: { card: BattleCard }) {
  return <article className="bd-junk">
    <span className="bd-junk-cost">{cardCost(card.cardId) >= 0 ? cardCost(card.cardId) : '—'}</span>
    <h3>{cardName(card.cardId)}</h3>
    <p>{cardRules(card.cardId)}</p>
    <span className="bd-junk-tag">牌堆里的异物</span>
  </article>;
}

// ------------------------------------------------------------------- the page

export default function BattleDemo() {
  const encounter = ENCOUNTERS.find(entry => entry.id === ENCOUNTER_ID)!;
  const [seed, setSeed] = useState(7);
  const [state, setState] = useState<BattleState>(() => startBattle(ENCOUNTER_ID, DECK_ID, 7));
  const [picked, setPicked] = useState<string | null>(null);
  const [audioOn, setAudioOn] = useState(true);
  const [fx, setFx] = useState<{ seq: number; events: FxEvent[] }>({ seq: 0, events: [] });
  const [hurt, setHurt] = useState(0);
  const [pile, setPile] = useState<'draw' | 'discard' | 'exhaust' | null>(null);
  const [tour, setTour] = useState<number | null>(() => (tourSeen() ? null : 0));

  const seq = useRef(0);
  const timers = useRef<number[]>([]);
  const fxTimer = useRef<number>(0);
  const gate = useRef({ logSeq: 0, turn: 0 });
  const logRef = useRef<HTMLDivElement>(null);

  const living = livingEnemies(state);
  const target = living.find(enemy => enemy.uid === state.targetUid) ?? living[0];
  const ended = state.phase === 'won' || state.phase === 'lost';

  // Every effect and every sound is scheduled off the same event list, so the picture and the noise
  // always agree about when a hit happened.
  const commit = useCallback((next: BattleState, before: BattleState, cardId?: string) => {
    const events = collectFx(before, next, cardId);
    setState(next);
    seq.current += 1;
    setFx({ seq: seq.current, events });

    const drawn = drawnCards(before, next);
    if (drawn > 0) sound('draw', audioOn);
    if (next.log.some(line => line.id > before.logSeq && line.text.startsWith('抽牌堆已空'))) sound('shuffle', audioOn);

    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current = [];
    const last = events.reduce((max, event) => Math.max(max, event.at), 0);
    for (const event of events) {
      if (!event.sound) continue;
      timers.current.push(window.setTimeout(() => sound(event.sound!, audioOn), event.at));
    }
    // Extra draws are a paper sound each, slightly apart — five cards landing on one beat reads as
    // one card landing five times.
    for (let i = 1; i < drawn; i++) timers.current.push(window.setTimeout(() => sound('draw', audioOn), i * 90));
    if (next.phase !== before.phase) {
      timers.current.push(window.setTimeout(() => sound(next.phase === 'won' ? 'win' : 'bell', audioOn), last + 420));
    }
    if (events.some(event => event.side === 'player' && event.tone === 'damage')) setHurt(seq.current);

    window.clearTimeout(fxTimer.current);
    const held = seq.current;
    fxTimer.current = window.setTimeout(() => setFx(current => (current.seq === held ? { seq: held, events: [] } : current)), last + 1500);
  }, [audioOn]);

  useEffect(() => () => {
    for (const timer of timers.current) window.clearTimeout(timer);
    window.clearTimeout(fxTimer.current);
  }, []);

  /** Play a hand card. A target is required by the fiction but not by the engine, so an omitted one
   *  falls through to whatever the field already has selected. */
  const play = useCallback((card: BattleCard, targetUid?: string) => {
    if (!canPlay(state, card.uid)) { sound('select', audioOn); return; }
    try {
      const next = playCard(state, card.uid, targetUid);
      sound('play', audioOn);
      setPicked(null);
      commit(next, state, card.cardId);
    } catch { /* The engine refuses loudly; the demo simply does not move. */ }
  }, [state, audioOn, commit]);

  function onCard(card: BattleCard) {
    if (!canPlay(state, card.uid)) { sound('select', audioOn); return; }
    if (picked === card.uid) { play(card, target?.uid); return; }
    sound('select', audioOn);
    setPicked(card.uid);
  }

  function onEnemy(enemy: EnemyState) {
    if (enemy.dead) return;
    setState(current => ({ ...current, targetUid: enemy.uid }));
    sound('select', audioOn);
    const card = state.hand.find(entry => entry.uid === picked);
    if (card && canPlay(state, card.uid)) play(card, enemy.uid);
  }

  function onEndTurn() {
    if (ended) return;
    sound('select', audioOn);
    try {
      const next = endTurn(state);
      setPicked(null);
      commit(next, state);
    } catch { /* Same as above. */ }
  }

  function restart() {
    const nextSeed = seed + 1;
    const fresh = startBattle(ENCOUNTER_ID, DECK_ID, nextSeed);
    for (const timer of timers.current) window.clearTimeout(timer);
    window.clearTimeout(fxTimer.current);
    timers.current = [];
    setSeed(nextSeed);
    setState(fresh);
    setFx({ seq: seq.current, events: [] });
    setPicked(null);
    setPile(null);
    setHurt(0);
    // A fresh battle is a fresh gate: without this, a tour sitting on 「结束回合」 would count the
    // new battle's first turn as the action it was waiting for.
    gate.current = { logSeq: fresh.logSeq, turn: fresh.turn };
    sound('shuffle', audioOn);
  }

  function endTour() {
    markTourSeen();
    setTour(null);
  }
  function startTour() {
    try { localStorage.removeItem(TOUR_KEY); } catch { /* Fine. */ }
    gate.current = { logSeq: state.logSeq, turn: state.turn };
    setTour(0);
  }

  // The two gated steps: they advance when the engine log says the player did the thing, never on a
  // timer. Watching the log (rather than a counter) means ending a turn cannot strand the tour.
  useEffect(() => {
    if (tour === null) return;
    const step = TOUR_STEPS[tour];
    if (!step?.gate || ended) return;
    if (step.gate === 'play') {
      const played = state.log.some(line => line.id > gate.current.logSeq && line.text.startsWith('打出「'));
      if (played) setTour(tour + 1);
    } else if (state.turn > gate.current.turn) {
      setTour(tour + 1);
    }
  }, [state, tour, ended]);

  // A battle that ends while the tour is running ends the tour too — the result panel is the lesson.
  useEffect(() => {
    if (ended && tour !== null) endTour();
  }, [ended, tour]);

  // Entering a step re-arms the gate and measures the spotlight. Deliberately keyed on the step
  // alone: re-measuring on every log line would re-arm the gate with the very action it is waiting
  // for, and the tour would never move.
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const step = tour === null ? null : TOUR_STEPS[tour];
  const selector = step?.target;
  useLayoutEffect(() => {
    gate.current = { logSeq: state.logSeq, turn: state.turn };
    if (!selector) { setBox(null); return; }
    // One element per comma-separated part — `.bd-hand-card` lights the *first* card, while
    // `.bd-hand-row, .bd-enemy-row` lights both rows as one block.
    const measure = () => {
      const nodes = selector.split(',').map(part => document.querySelector(part.trim())).filter((node): node is Element => !!node);
      if (!nodes.length) { setBox(null); return; }
      const rects = nodes.map(node => node.getBoundingClientRect());
      const left = Math.min(...rects.map(rect => rect.left));
      const top = Math.min(...rects.map(rect => rect.top));
      const right = Math.max(...rects.map(rect => rect.right));
      const bottom = Math.max(...rects.map(rect => rect.bottom));
      setBox({ x: left, y: top, w: right - left, h: bottom - top });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selector, tour]);

  // The log follows the fight — until the reader scrolls up to think, at which point it stays put
  // rather than yanking the panel away from them.
  const stick = useRef(true);
  useEffect(() => {
    const node = logRef.current;
    if (node && stick.current) node.scrollTop = node.scrollHeight;
  }, [state.log.length]);

  const enemyFx = useMemo(() => {
    const map = new Map<string, FxEvent[]>();
    for (const event of fx.events) {
      if (event.side !== 'enemy' || !event.uid) continue;
      map.set(event.uid, [...(map.get(event.uid) ?? []), event]);
    }
    return map;
  }, [fx]);
  const playerFx = useMemo(() => fx.events.filter(event => event.side === 'player'), [fx]);

  const powers = (Object.keys(POWER_LABEL) as (keyof typeof state.powers)[])
    .map(key => ({ key, value: state.powers[key] })).filter(entry => entry.value > 0);
  const piles = { draw: state.draw, discard: state.discard, exhaust: state.exhaust } as const;

  return <div className={`bd ${step ? 'is-tour' : ''}`}>
    <header className="bd-top">
      <div className="bd-brand">
        <p className="bd-kicker">{CHAPTER_1.name} · {encounter.kind}</p>
        <h1 className="bd-title">{encounter.name}<small>{CHAPTER_1.subtitle}</small></h1>
        <p className="bd-sub">{encounter.blurb}</p>
      </div>
      <div className="bd-facts">
        <span className="bd-fact"><i>回合</i><b>{state.turn}</b></span>
        <span className="bd-fact"><i>牌组</i><b>断罪之刃</b></span>
        <span className="bd-fact"><i>能量</i><b>{state.player.energy}</b></span>
      </div>
      <div className="bd-tools">
        <button className="bd-btn" onClick={restart}><RotateCcw size={14} strokeWidth={1.7} />重新开始</button>
        <button className="bd-btn" onClick={tour === null ? startTour : endTour}>
          <BookOpen size={14} strokeWidth={1.7} />{tour === null ? '重看引导' : '跳过引导'}
        </button>
        <button className={`bd-btn bd-sound ${audioOn ? 'on' : ''}`} aria-pressed={audioOn}
          onClick={() => { setAudioOn(!audioOn); sound('select', !audioOn); }}>
          {audioOn ? <Volume2 size={14} strokeWidth={1.7} /> : <VolumeX size={14} strokeWidth={1.7} />}音效
        </button>
      </div>
    </header>

    <main className="bd-stage">
      <aside className="bd-player-panel">
        <div className="bd-panel-head">
          <p className="bd-panel-kicker">你 · THE WATCHER</p>
          <h2>守夜人</h2>
        </div>
        <HealthBar hp={state.player.hp} maxHp={state.player.maxHp} block={state.player.block} tone="player" />
        <div className="bd-energy">
          <span className="bd-energy-label">能量</span>
          <span className="bd-pips">
            {Array.from({ length: Math.max(state.player.energyPerTurn, state.player.energy) }, (_, i) =>
              <i key={i} className={`bd-pip ${i < state.player.energy ? 'on' : ''}`} />)}
          </span>
          <b className="bd-energy-num">{state.player.energy}<i>/{state.player.energyPerTurn}</i></b>
        </div>
        <div className="bd-pills"><StatusPills statuses={state.player.statuses} all /></div>
        {powers.length > 0 && <div className="bd-powers">
          {powers.map(power => <span key={power.key} title="本场战斗持续生效">{POWER_LABEL[power.key]}<b>{power.value}</b></span>)}
        </div>}
        <div className="bd-piles">
          {(['draw', 'discard', 'exhaust'] as const).map(kind => <button key={kind} className="bd-pile" onClick={() => setPile(kind)}
            disabled={kind === 'exhaust' && !piles.exhaust.length}>
            <span>{kind === 'draw' ? '抽牌堆' : kind === 'discard' ? '弃牌堆' : '移出'}</span>
            <b>{piles[kind].length}</b>
          </button>)}
        </div>
        <p className="bd-panel-note">格挡在回合结束时清零（壁垒除外）。<br />灼烧与烙印在敌人回合结算。</p>
        <FxLayer events={playerFx} />
      </aside>

      <section className="bd-field">
        <div className="bd-enemy-row">
          {state.enemies.map(enemy => {
            const def = ENEMY_BY_ID.get(enemy.id);
            const rank = def?.rank ?? 'normal';
            const on = target?.uid === enemy.uid && !enemy.dead;
            return <article key={enemy.uid} data-uid={enemy.uid}
              className={`bd-enemy ${on ? 'on' : ''} ${enemy.dead ? 'is-dead' : ''}`}>
              <div className="bd-intents">{enemy.dead ? <span className="bd-intent bd-intent-idle">已消散</span> : intentChips(state, enemy)}</div>
              <button className="bd-enemy-frame" onClick={() => onEnemy(enemy)} disabled={enemy.dead}
                aria-label={`${def?.name ?? enemy.id}${on ? '（当前目标）' : ''}`}>
                <span className="bd-enemy-art">
                  <img className="bd-enemy-img" src={`/assets/monsters/${enemy.id}.webp`} alt="" loading="lazy" />
                  <span className="bd-vignette" />
                  <span className="bd-target-mark" />
                </span>
              </button>
              <div className="bd-enemy-foot">
                <div className="bd-enemy-line">
                  <h3 className="bd-enemy-name" style={{ color: RANK_COLOR[rank] }}>{def?.name ?? enemy.id}</h3>
                  <span className="bd-rank">{RANK_LABEL[rank]}</span>
                </div>
                <HealthBar hp={enemy.hp} maxHp={enemy.maxHp} block={enemy.block} tone="enemy" id={enemy.uid} />
                <div className="bd-enemy-pills"><EnemyPills enemy={enemy} /></div>
                {def && <p className="bd-enemy-note">{def.note}</p>}
              </div>
              <FxLayer events={enemyFx.get(enemy.uid) ?? []} />
            </article>;
          })}
        </div>
      </section>

      <aside className="bd-log">
        <div className="bd-log-head">
          <h2>战斗日志<small>BATTLE LOG</small></h2>
          <span className={`bd-played ${state.playedThisTurn >= 2 ? 'hot' : ''}`}>
            本回合已打出 <b>{state.playedThisTurn}</b> 张牌{state.playedThisTurn >= 2 && <i>连缀已就绪</i>}
          </span>
          <button className={`bd-btn bd-end-turn ${ended ? 'off' : ''}`} onClick={onEndTurn} disabled={ended}>
            结束回合<ChevronRight size={15} strokeWidth={1.8} />
          </button>
        </div>
        <div className="bd-log-body" ref={logRef} onScroll={event => {
          const node = event.currentTarget;
          stick.current = node.scrollHeight - node.scrollTop - node.clientHeight < 60;
        }}>
          {state.log.map(line => <p key={line.id} className={`bd-log-line ${line.tone}`}>{line.text}</p>)}
        </div>
        <p className="bd-log-note">意图 · 伤害 · 状态，全部按发生顺序落在这里。</p>
      </aside>
    </main>

    {/* The hand gets the whole floor to itself: five full-size cards do not fit in the middle column,
        and a hand you have to scroll to read is not a hand. */}
    <div className="bd-hand-row">
      {state.hand.map(card => {
        const face = CARD_BY_ID.get(card.cardId);
        const playable = canPlay(state, card.uid);
        return <button key={card.uid} className={`bd-hand-card ${picked === card.uid ? 'on' : ''} ${playable ? '' : 'off'}`}
          onClick={() => onCard(card)} aria-disabled={!playable} aria-label={`打出 ${cardName(card.cardId)}`}>
          {face ? <CardFace card={face} selected={picked === card.uid} /> : <JunkFace card={card} />}
        </button>;
      })}
      {!state.hand.length && <p className="bd-hand-empty">手牌是空的。</p>}
    </div>

    {pile && <div className="bd-modal" role="dialog" aria-label="牌堆" onClick={event => { if (event.target === event.currentTarget) setPile(null); }}>
      <div className="bd-modal-inner">
        <h3>{pile === 'draw' ? '抽牌堆' : pile === 'discard' ? '弃牌堆' : '已移出'}
          <small>{piles[pile].length} 张 · 顺序即抽取顺序</small></h3>
        <div className="bd-modal-list">
          {piles[pile].map(card => <span key={card.uid} className="bd-modal-card">
            <b>{cardName(card.cardId)}</b><i>{cardCost(card.cardId) >= 0 ? `${cardCost(card.cardId)} 费` : '不可打出'}</i>
          </span>)}
          {!piles[pile].length && <p className="bd-modal-empty">这里什么都没有。</p>}
        </div>
        <button className="bd-modal-close" onClick={() => setPile(null)} aria-label="关闭">✕</button>
      </div>
    </div>}

    {ended && <div className="bd-over">
      <div className={`bd-over-card ${state.phase}`}>
        <p className="bd-over-kicker">{state.phase === 'won' ? 'VICTORY' : 'DEFEAT'}</p>
        <h2>{state.phase === 'won' ? '火还亮着' : '火熄了'}</h2>
        <p>{state.phase === 'won'
          ? `${encounter.name} · ${state.turn} 个回合。草地上的灰会被夜里的风带走。`
          : `${encounter.name} · 第 ${state.turn} 回合。营地里那簇火又暗了一分。`}</p>
        <button className="bd-btn bd-over-btn" onClick={restart}><RotateCcw size={14} strokeWidth={1.7} />再来一次</button>
      </div>
    </div>}

    {step && <>
      {/* Steps the player only has to read swallow the clicks; the two that ask for an action
          (打出一张牌 / 结束回合) leave the board live, or the gate could never be satisfied. */}
      {!step.gate && <div className="bd-tour-shield" />}
      {box ? <>
        <div className="bd-tour-mask" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />
        <div className="bd-tour-ring" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />
      </> : <div className="bd-tour-mask bd-tour-mask-full" />}
      <TourBubble step={step} index={tour!} total={TOUR_STEPS.length} box={box}
        onNext={() => (tour! + 1 >= TOUR_STEPS.length ? endTour() : setTour(tour! + 1))}
        onSkip={endTour} />
    </>}

    {hurt > 0 && <span className="bd-flash" key={hurt} />}
  </div>;
}

/** The bubble, placed against whatever the spotlight is holding. It prefers to sit under the target,
 *  flips above when there is no room, and centres itself when there is no target at all. */
function TourBubble({ step, index, total, box, onNext, onSkip }: {
  step: TourStep; index: number; total: number;
  box: { x: number; y: number; w: number; h: number } | null;
  onNext: () => void; onSkip: () => void;
}) {
  const width = Math.min(360, window.innerWidth - 24);
  const height = 250;
  let left = (window.innerWidth - width) / 2;
  let top = (window.innerHeight - height) / 2;
  if (box) {
    left = Math.max(12, Math.min(box.x + box.w / 2 - width / 2, window.innerWidth - width - 12));
    const below = box.y + box.h + 16;
    top = below + height + 12 <= window.innerHeight ? below : Math.max(12, box.y - height - 16);
    if (top + height > window.innerHeight - 12) top = Math.max(12, window.innerHeight - height - 12);
  }
  const last = index + 1 >= total;
  return <div className="bd-tour-bubble" style={{ left, top, width }}>
    <p className="bd-tour-step">引导 {index + 1} / {total}</p>
    <h3 className="bd-tour-title">{step.title}</h3>
    <p className="bd-tour-body">{step.body}</p>
    {step.gate && <p className="bd-tour-hint">{step.hint}</p>}
    <div className="bd-tour-actions">
      <button className="bd-btn bd-tour-next" onClick={onNext} disabled={!!step.gate}>
        {step.cta ?? (last ? '结束引导' : '下一步')}{!step.gate && <ChevronRight size={14} strokeWidth={1.9} />}
      </button>
      <button className="bd-tour-skip" onClick={onSkip}>跳过引导</button>
    </div>
  </div>;
}
