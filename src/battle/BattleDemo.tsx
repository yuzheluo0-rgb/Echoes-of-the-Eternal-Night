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
  ArrowLeftRight, BookOpen, ChevronLeft, ChevronRight, Eye, Flame, Layers, RotateCcw, Shield, Skull,
  Sparkles, Swords, Volume2, VolumeX, Zap,
} from 'lucide-react';
import { sound, type SoundKind } from '../audio';
import { CardBack, CardFace } from '../cards/CardFace';
import { CARD_BY_ID, DECKS, type DeckId } from '../cards/index.ts';
import { CHAPTER_1, chapterDeck, openingForms } from './chapter.ts';
import {
  KINDLING_DISCOUNT, canPlay, cardAccent, cardCost, cardName, cardRules, cardTag, endTurn, enemyName,
  intentFor, intentText, livingEnemies, playCard, startBattle, type BattleCard, type BattleState,
} from './engine.ts';
import { ENEMY_BY_ID, MUTATION_BY_ID, type Encounter } from './enemies.ts';
import { RelicFace } from '../relics/RelicFace';
import { REFINE_LABEL, RELIC_BY_ID, TIER_BY_ID, type RelicDefinition } from '../relics/relics.ts';
// The relic **behaviour** layer, not the data one — `refineLines` runs this relic's handlers to work
// out what moved. Two files named `relics.ts` in different folders; the paths are explicit on purpose.
import { refineLines } from './relics.ts';
import {
  availableRelics, creditProgress, loadProgress, saveProgress, type RelicProgress,
} from '../relics/unlocks.ts';
import { creditAndSave, earnedCards, unlocksFor } from './cardUnlocks.ts';
import {
  answerRefine, canEnterNode, campfire, chooseCard, claimRelic, claimReward, deckFor, discardRelic,
  dismissCard, dismissRefine, dismissReveal, enterNode, repairCard,
  nodeAt, offerDraw, resolveEvent, rollOffer, rollPendingReward, swapRelics,
} from './run.ts';
import { REWARD_BY_ID } from './rewards.ts';
import { eventForNode, type EventOption } from './events.ts';
import {
  CampfireScreen, CardPicker, CardRevealScreen, EventScreen, RefineScreen, RewardScreen, UnlockScreen,
  type CampfirePick,
} from './NodeScreen.tsx';
import { ALL_ENCOUNTERS, ENCOUNTER_BY_ID } from './enemies.ts';
import { BOSS_ROW } from './map.ts';
import TowerMapView from './TowerMap.tsx';
import {
  HEAL_MAX, HEAL_MIN, RUN_ENCOUNTERS, battleSeed, chapterProgress, clearRun, finishBattle, isChapterCleared,
  loadRun, newRun, saveRun, swapDecks,
  type BattleOutcome, type ChapterRun,
} from './run.ts';
import {
  RANK_COLOR, RANK_LABEL, STATUS_GOOD, STATUS_LABEL, STATUS_RULE,
  type EnemyState, type Intent, type StatusId,
} from './types.ts';
import './battle.css';

/** Set once the tour has been seen through or skipped, so it never comes back on its own. */
const TOUR_KEY = 'eternal-night-battle-tutorial-v1';

/** The deck the chapter opens on. The pair is locked at that point; only 主/副 moves after it. */
/**
 * The pairs the opening screen offers — **derived from the chapter, not written out here**.
 *
 * This was a two-entry literal, and when 燎原余烬 joined `CHAPTER_1.decks` nothing on this screen
 * changed: the deck was legal in every save and invisible to every player. The list lives in
 * `chapter.ts` now, where the deck list is, and `openingForms()` reads it.
 */
const OPENING_FORMS = openingForms();

const deckName = (id: DeckId) => DECKS.find(deck => deck.id === id)?.name ?? id;
const deckAccent = (id: DeckId) => DECKS.find(deck => deck.id === id)?.accent ?? '#d4bd87';

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
    body: '左边是你。格挡先于生命被打掉，而且回合结束时会全部清零——除非你有「壁垒」，每层能留下 1 点。能量每回合回满 3 点，出牌全靠它。能量旁边亮着的那个「−1」是引火：本回合你打出的第一张牌少花 1 点，打出去之后就熄灭。',
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

/**
 * A card the library does not know: 灰烬, 未熄的誓言 and 照壁's echo live in the engine, not in
 * `CARD_BY_ID`.
 *
 * The grey face is right for two of the three — junk the enemy shoved into your deck, and the boss's
 * oath. 残壁 is the opposite kind of card, something the player *earned*, so a card may carry an
 * accent and the face picks it up rather than making a gift look like rubbish.
 */
function JunkFace({ card }: { card: BattleCard }) {
  const accent = cardAccent(card.cardId);
  return <article className={`bd-junk ${accent ? 'bd-junk-accent' : ''}`}
    style={accent ? ({ '--junk': accent } as CSSProperties) : undefined}>
    {/* 灰烬 and 未熄的誓言 have no photograph of their own and keep the plain wash. 残壁 does, and a
        card the player was *given* should not be the one card in hand with nothing behind it. */}
    <span className="bd-junk-art" style={{ backgroundImage: `url(/assets/cards/${card.cardId}.webp)` }} />
    <span className="bd-junk-cost">{cardCost(card.cardId) >= 0 ? cardCost(card.cardId) : '—'}</span>
    <h3>{cardName(card.cardId)}</h3>
    <p>{cardRules(card.cardId)}</p>
    <span className="bd-junk-tag">{cardTag(card.cardId)}</span>
  </article>;
}

// ------------------------------------------------------------------- the page

export default function BattleDemo() {
  // The run is the page's spine. `state` is null whenever the player is not mid-fight, and which of
  // the three screens is showing is *derived* from these two rather than tracked beside them — a
  // separate `screen` flag could disagree with the state it describes, and did in an earlier draft.
  const [run, setRun] = useState<ChapterRun | null>(loadRun);
  const [state, setState] = useState<BattleState | null>(null);
  const [outcome, setOutcome] = useState<BattleOutcome | null>(null);
  // Meta-progression, not run state: beating 头狼 widens the pool for the *next* run, which is why it
  // lives beside the run rather than inside it.
  const [progress, setProgress] = useState<RelicProgress>(loadProgress);
  /** The 明焰阶 cards 击破守望者 just unlocked — what `UnlockScreen` puts on screen, as faces. */
  const [unlockedCards, setUnlockedCards] = useState<string[]>([]);
  /** 解锁屏看过了没有。它只在这一次击杀之后有意义，所以是组件状态而不是 run 的一部分。 */
  const [unlockSeen, setUnlockSeen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [audioOn, setAudioOn] = useState(true);
  const [fx, setFx] = useState<{ seq: number; events: FxEvent[] }>({ seq: 0, events: [] });
  const [hurt, setHurt] = useState(0);
  const [pile, setPile] = useState<'draw' | 'discard' | 'exhaust' | null>(null);
  // Never auto-opens from storage: it belongs to the run's first fight, and the run decides.
  const [tour, setTour] = useState<number | null>(null);

  const seq = useRef(0);
  const timers = useRef<number[]>([]);
  const fxTimer = useRef<number>(0);
  const gate = useRef({ logSeq: 0, turn: 0 });
  const logRef = useRef<HTMLDivElement>(null);

  // While a fight is on screen this must be the encounter being *fought*; otherwise it is whatever
  // is standing on the floor the run is on. Winning advances the run immediately, so asking the run
  // would relabel the finished fight with the name of the one after it.
  const floor = run ? nodeAt(run) : undefined;
  const encounter: Encounter | undefined = state
    ? ALL_ENCOUNTERS.find(entry => entry.id === state.encounterId)
    : run?.currentFight ? ALL_ENCOUNTERS.find(entry => entry.id === run.currentFight) : undefined;
  /**
   * Fights are the floors that stop at the preparation screen. A floor whose fight is already in
   * `cleared` is *done* — that is what sends the player back to the tower after a win instead of
   * leaving them standing on the node they just finished.
   */
  const inFight = !!floor
    && (floor.kind === 'combat' || floor.kind === 'elite' || floor.kind === 'boss')
    && !!run?.currentFight
    && !run.cleared.includes(run.currentFight);
  const living = state ? livingEnemies(state) : [];
  const target = state ? (living.find(enemy => enemy.uid === state.targetUid) ?? living[0]) : undefined;
  const ended = state ? state.phase === 'won' || state.phase === 'lost' : false;

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
    if (!state || !canPlay(state, card.uid)) { sound('select', audioOn); return; }
    try {
      const next = playCard(state, card.uid, targetUid);
      sound('play', audioOn);
      setPicked(null);
      commit(next, state, card.cardId);
    } catch { /* The engine refuses loudly; the demo simply does not move. */ }
  }, [state, audioOn, commit]);

  function onCard(card: BattleCard) {
    if (!state || !canPlay(state, card.uid)) { sound('select', audioOn); return; }
    if (picked === card.uid) { play(card, target?.uid); return; }
    sound('select', audioOn);
    setPicked(card.uid);
  }

  function onEnemy(enemy: EnemyState) {
    if (!state || enemy.dead) return;
    setState(current => (current ? { ...current, targetUid: enemy.uid } : current));
    sound('select', audioOn);
    const card = state.hand.find(entry => entry.uid === picked);
    if (card && canPlay(state, card.uid)) play(card, enemy.uid);
  }

  function onEndTurn() {
    if (!state || ended) return;
    sound('select', audioOn);
    try {
      const next = endTurn(state);
      setPicked(null);
      commit(next, state);
    } catch { /* Same as above. */ }
  }

  /** Clears the per-fight furniture. Every path between fights goes through here. */
  function resetFx() {
    for (const timer of timers.current) window.clearTimeout(timer);
    window.clearTimeout(fxTimer.current);
    timers.current = [];
    setFx({ seq: seq.current, events: [] });
    setPicked(null);
    setPile(null);
    setHurt(0);
  }

  /** Open the fight the floor is holding: carried HP, the run's deck, the 主/副 pile. */
  function beginFight(next: ChapterRun) {
    // Rolled when the player stepped onto the floor, not here — the preparation screen has been
    // showing this fight's briefing since then, and re-rolling now would make the screen a lie.
    const encounterId = next.currentFight;
    if (!encounterId) return;
    // `maxHp` goes in with the HP: the run's ceiling is the fight's ceiling. Without it every
    // 「生命上限 +N」 the player had earned was silently reset to 60 the moment a battle began.
    const fresh = startBattle(encounterId, next.main, battleSeed(next, encounterId),
      { hp: next.hp, maxHp: next.maxHp, sub: next.sub, relics: next.relics, refined: next.refined,
        cards: deckFor('r', next) });
    resetFx();
    setState(fresh);
    setOutcome(null);
    // A fresh battle is a fresh gate: without this, a tour sitting on 「结束回合」 would count the
    // new battle's first turn as the action it was waiting for.
    gate.current = { logSeq: fresh.logSeq, turn: fresh.turn };
    // The tour belongs to the run's opening fight, and to a player who has not seen it.
    if (next.cleared.length === 0 && !tourSeen()) setTour(0);
    sound('shuffle', audioOn);
  }

  function startChapter(main: DeckId, sub: DeckId) {
    // `newRun` lays the tower down itself — a run always has a map, so there is no window in which
    // one exists without the other.
    const next = newRun(main, sub, Math.trunc(Date.now() % 100000));
    saveRun(next);
    setRun(next);
    setOutcome(null);
    // The unlock panel belongs to the win that earned it. Carrying it into the next run would show
    // 「明焰阶 · 已解锁」 on a chapter that has not been cleared yet.
    setUnlockedCards([]);
    setUnlockSeen(false);
    setState(null);
    sound('bell', audioOn);
  }

  /**
   * Step onto a floor.
   *
   * Nothing is resolved here but the treasure roll — a campfire and an event both *ask* something,
   * and their screens read the floor the run is standing on. Resolving them on arrival would mean
   * deciding for the player before they had seen the question.
   */
  function enterFloor(nodeId: string) {
    if (!run?.map) return;
    const node = run.map.byId.get(nodeId);
    if (!node || !canEnterNode(run, nodeId)) return;

    let next = enterNode(run, nodeId);
    // 宝箱 is a reward roll like any other, so the chest can hold coin, a card, a relic or something
    // stranger — and the table decides, not the node type.
    if (node.kind === 'treasure') next = rollPendingReward(next);
    saveRun(next);
    setRun(next);
    sound(node.kind === 'rest' ? 'bell' : 'select', audioOn);
  }

  /** Claim the reward a victory or a chest rolled. */
  function claimRolledReward() {
    if (!run) return;
    const next = claimReward(run);
    saveRun(next); setRun(next);
  }

  /**
   * Answer a campfire. 焚牌 and 打磨 hand off to the card picker rather than settling here.
   *
   * They still **settle the floor**, though, and that has to happen at the click rather than in
   * `chooseCard`. The campfire promises 「无论选哪个，这一层就过去了」 — but the two card branches only
   * ever set `cardTask`, and the picker is drawn *over* the campfire rather than instead of it. So
   * clearing the task dropped the player back onto the three choices they had already answered, free
   * to take a second one: burn a card *and* rest, from one night. `campfire()` does this itself for
   * 休息; the other two have to do it where they are built.
   */
  function answerCampfire(choice: CampfirePick) {
    if (!run) return;
    // The campfire says 焚牌; the run calls that task `remove`. Same thing, and the rename keeps the
    // run's vocabulary about the deck rather than about one screen's wording.
    const next: ChapterRun = choice === 'rest'
      ? campfire(run, { kind: 'rest' })
      : {
        ...run, cardTask: choice === 'burn' ? 'remove' : 'polish',
        resolved: run.at, rewardDue: undefined,
      };
    saveRun(next); setRun(next);
    if (choice === 'rest') sound('bell', audioOn);
  }

  /**
   * Commit an answered event.
   *
   * This is the *second* half of the exchange — `EventScreen` shows the outcome line first and calls
   * back on 继续. Resolving it on the click instead would set `run.resolved`, which is what takes the
   * event screen off the page, so the outcome would be written and never read.
   */
  function commitEvent(option: EventOption) {
    if (!run) return;
    const next = resolveEvent(run, option);
    saveRun(next); setRun(next);
  }

  /** Answer whatever card the run is waiting on: a pick, a burn, a polish or a copy. */
  function answerCard(index: number | null) {
    if (!run) return;
    // 打磨 is the one task that settles in two steps: the deck changes now and the picker turns into a
    // reveal of the card that changed. `repairCard` applies the choice without ending the task;
    // `onDismiss`, from the reveal's 继续, is what ends it.
    const next = run.cardTask === 'polish' && index !== null
      ? repairCard(run, index)
      : chooseCard(run, index);
    saveRun(next); setRun(next);
  }

  /**
   * Put one relic in the fire. **This is where the gamble lands** — `answerRefine` rolls off the run's
   * own stream and either lifts the relic's numbers or destroys it.
   *
   * Like 打磨, the run is changed *without* clearing `relicTask`, so the reveal screen stays mounted to
   * show what happened; `dismissRefine`, from its 继续, is what closes it.
   */
  function putRelicInFire(relicId: string) {
    if (!run) return;
    const next = answerRefine(run, relicId);
    if (next === run) return;
    saveRun(next); setRun(next);
    // 成了 gets the bell; 碎了 gets the same sound an enemy makes when it comes apart, which is the
    // closest thing the set has to a shatter.
    sound(next.relicTask?.done?.won ? 'bell' : 'death', audioOn);
  }

  /** Swap which half of the locked pair leads. The only deck decision a run allows after it starts. */
  function swapFormation() {
    if (!run) return;
    const next = swapDecks(run);
    saveRun(next);
    setRun(next);
    sound('select', audioOn);
  }

  /** Retry the current fight from the top. Safe to spam: the seed and the HP are both fixed. */
  function restart() {
    if (!run) return;
    beginFight(run);
  }

  /** Leave a fight and go back to the preparation screen. The run is untouched, so nothing is lost —
   *  and nothing is gained, because the shuffle is seeded per encounter. `outcome` is deliberately
   *  kept: it is what tells the prep screen how much the campfire just gave back. */
  function backToPrep() {
    sound('select', audioOn);
    resetFx();
    setState(null);
  }

  /** Turn the owed draw into an actual offer. */
  function claimDraw(relicId: string, placeIn: 'main' | 'sub') {
    if (!run) return;
    const next = claimRelic(run, relicId, placeIn);
    setRun(next);
    saveRun(next);
  }

  function swapRelicSlots() {
    if (!run) return;
    sound('select', audioOn);
    const next = swapRelics(run);
    setRun(next); saveRun(next);
  }

  function dropRelic(slot: 'main' | 'sub') {
    if (!run) return;
    sound('select', audioOn);
    const next = discardRelic(run, slot);
    setRun(next); saveRun(next);
  }

  // A victory owes a reward. Rolled here for the same reason the draw is: it advances the run's
  // stream, and a render-time roll would re-roll on every render.
  useEffect(() => {
    if (!run || !run.rewardDue || run.pendingReward) return;
    // A win owes its reward *after* the fight has been settled, so this only fires from the map.
    if (state) return;
    const next = rollPendingReward(run);
    setRun(next);
    saveRun(next);
  }, [run, state]);

  // A graded victory owes a relic draw. The offer is rolled *here* rather than during render: it
  // advances the run's stream, and a render-time roll would re-roll every time the component did.
  useEffect(() => {
    if (!run || state || run.pendingDraw || !run.drawDue || !run.nextSlot) return;
    const { run: rolled, options } = rollOffer(run, availableRelics(progress));
    if (!options.length) return;
    const next = offerDraw(rolled, options.map(relic => relic.id), run.nextSlot, run.drawDue);
    setRun(next);
    saveRun(next);
  }, [run, state, progress]);

  /** Leave the run and go back to the opening screen — the exit for both a cleared chapter and a
   *  dead one. Nothing is kept: the next chapter starts from a fresh formation and a fresh seed. */
  function leaveRun() {
    clearRun();
    resetFx();
    setRun(null);
    setUnlockedCards([]);
    setUnlockSeen(false);
    setState(null);
    setOutcome(null);
    sound('bell', audioOn);
  }

  function endTour() {
    markTourSeen();
    setTour(null);
  }
  function startTour() {
    if (!state) return;
    try { localStorage.removeItem(TOUR_KEY); } catch { /* Fine. */ }
    gate.current = { logSeq: state.logSeq, turn: state.turn };
    setTour(0);
  }

  // The two gated steps: they advance when the engine log says the player did the thing, never on a
  // timer. Watching the log (rather than a counter) means ending a turn cannot strand the tour.
  useEffect(() => {
    if (tour === null || !state) return;
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

  // Settle the fight into the run the moment it ends, exactly once: `outcome` being set is what both
  // puts up the result panel and stops this effect from running again on the next render.
  useEffect(() => {
    if (!run || !state || outcome) return;
    if (state.phase !== 'won' && state.phase !== 'lost') return;
    const settled = finishBattle(run, state);
    setOutcome(settled);
    if (settled.won) {
      setRun(settled.run);
      saveRun(settled.run);
      // A graded win may unlock relics for good. Idempotent, so a replayed fight cannot farm it.
      const widened = creditProgress(progress, state.encounterId);
      if (widened !== progress) { setProgress(widened); saveProgress(widened); }
      // And 击破守望者 widens the *card* pool — the promise `nextUnlock` has carried since the
      // chapter was written. Read what is new *before* crediting, because afterwards the answer is
      // always "nothing". Also idempotent.
      const opened = unlocksFor(state.encounterId).filter(id => !earnedCards().includes(id));
      if (opened.length) { creditAndSave(state.encounterId); setUnlockedCards(opened); }
    } else {
      // The run is dead. Drop the save so a reload cannot resume a chapter that was already lost.
      clearRun();
    }
  }, [run, state, outcome]);

  // Entering a step re-arms the gate and measures the spotlight. Deliberately keyed on the step
  // alone: re-measuring on every log line would re-arm the gate with the very action it is waiting
  // for, and the tour would never move.
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const step = tour === null ? null : TOUR_STEPS[tour];
  const selector = step?.target;
  useLayoutEffect(() => {
    if (state) gate.current = { logSeq: state.logSeq, turn: state.turn };
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
  const logLength = state?.log.length ?? 0;
  useEffect(() => {
    const node = logRef.current;
    if (node && stick.current) node.scrollTop = node.scrollHeight;
  }, [logLength]);

  const enemyFx = useMemo(() => {
    const map = new Map<string, FxEvent[]>();
    for (const event of fx.events) {
      if (event.side !== 'enemy' || !event.uid) continue;
      map.set(event.uid, [...(map.get(event.uid) ?? []), event]);
    }
    return map;
  }, [fx]);
  const playerFx = useMemo(() => fx.events.filter(event => event.side === 'player'), [fx]);
  const audioToggle = () => { setAudioOn(current => !current); sound('select', !audioOn); };

  // Everything above this line is a hook, so the two non-fight screens can return early.
  if (!run) return <ChapterIntro audioOn={audioOn} onAudio={audioToggle} onStart={startChapter} />;

  // --- the screens that take the whole frame, in the order they can be outstanding ----------------
  // A card choice is the tail of a reward, so it comes first; the reward it came from is already
  // spent by then. Then the reward itself, then the relic draw, then the floor's own question.
  // The card reveal is checked first because it is terminal: whatever moved the cards — a 战利品 or a
  // 奇遇 — is already settled, and nothing else can be outstanding beside it.
  if (run.cardReveal) {
    return <CardRevealScreen run={run} audioOn={audioOn}
      onDone={() => { const next = dismissReveal(run); saveRun(next); setRun(next); }} />;
  }
  // 淬炼 comes next: it is the tail of a 奇遇, and the floor's own screen must not come back while the
  // reveal is still on it.
  if (run.relicTask) {
    return <RefineScreen run={run} onPick={putRelicInFire}
      onDismiss={() => { const next = dismissRefine(run); saveRun(next); setRun(next); }}
      audioOn={audioOn} />;
  }
  if (run.cardTask) {
    return <CardPicker task={run.cardTask} run={run} options={run.cardOptions ?? []}
      onChoose={index => answerCard(index)}
      // 打磨 leaves the picker open for one beat after the card has changed — see POLISH_BEAT.
      onDismiss={() => { const next = dismissCard(run); saveRun(next); setRun(next); }}
      onPass={run.cardTask === 'pick' ? () => answerCard(null) : undefined}
      audioOn={audioOn} />;
  }
  if (run.pendingReward) {
    const reward = REWARD_BY_ID.get(run.pendingReward);
    if (reward) {
      return <RewardScreen reward={reward} run={run} onClaim={claimRolledReward} audioOn={audioOn}
        from={run.rewardDue ? '战斗胜利' : '这一层'} />;
    }
  }
  if (floor && run.resolved !== run.at) {
    if (floor.kind === 'rest') return <CampfireScreen run={run} onPick={answerCampfire} audioOn={audioOn} />;
    if (floor.kind === 'event') {
      // `key` — the screen holds the half-answered option in local state, so climbing to the next
      // 奇遇 has to hand it a fresh one rather than leave it showing the last floor's answer.
      return <EventScreen key={floor.id} event={eventForNode(floor.id)} run={run}
        onContinue={commitEvent} audioOn={audioOn} />;
    }
  }

  // The tower is the hub. A fight is the only thing that takes you off it, and the relic draw is
  // the only thing that interrupts it.
  if (!inFight || !encounter) {
    return <div className="tw-host">
      <TowerMapView run={run} encounters={ENCOUNTER_BY_ID} onEnter={enterFloor} />
      {run.pendingDraw && <div className="bd-over">
        <div className="bd-map-draw">
          <RelicDraw run={run} options={run.pendingDraw.options} slot={run.pendingDraw.slot}
            onClaim={claimDraw} audioOn={audioOn} />
        </div>
      </div>}
    </div>;
  }

  if (!state) {
    return <BattlePrep run={run} outcome={outcome} audioOn={audioOn} onAudio={audioToggle}
      onSwap={swapFormation} onFight={() => beginFight(run)} onClaimDraw={claimDraw}
      onSwapRelics={swapRelicSlots} onDropRelic={dropRelic} />;
  }

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
        <span className="bd-fact" title={`主牌组 ${deckName(run.main)} · 副牌组 ${deckName(run.sub)}`}>
          <i>牌组</i><b>{deckName(run.main)}</b>
        </span>
        <span className="bd-fact"><i>生命</i><b>{state.player.hp}</b></span>
        <span className="bd-fact"><i>能量</i><b>{state.player.energy}</b></span>
      </div>
      <div className="bd-tools">
        <button className="bd-btn" onClick={backToPrep}><ChevronLeft size={14} strokeWidth={1.7} />战前准备</button>
        <button className="bd-btn" onClick={restart}><RotateCcw size={14} strokeWidth={1.7} />重开本场</button>
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
          {/* 引火 lives next to the pips rather than on the cards: it belongs to the *turn*, not to
              any one card, and the player has to spend it on whichever card they lead with. */}
          <span className={`bd-kindling ${state.playedThisTurn > 0 ? 'spent' : ''}`}
            title={`引火 · 本回合第一张牌费用 −${KINDLING_DISCOUNT}${state.playedThisTurn > 0 ? '（本回合已用）' : '（尚未使用）'}`}>
            −{KINDLING_DISCOUNT}
          </span>
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
            const mutation = enemy.mutation ? MUTATION_BY_ID.get(enemy.mutation) : undefined;
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
                  {/* A 异变 recolours the whole name, so "that one is different" reads before the
                      words do — the player has to notice it in the half-second they spend scanning. */}
                  <h3 className="bd-enemy-name" style={{ color: mutation ? mutation.tone : RANK_COLOR[rank] }}>
                    {mutation && <i className="bd-mutation">{mutation.prefix}</i>}
                    {def?.name ?? enemy.id}
                  </h3>
                  <span className="bd-rank">{mutation ? '异变' : RANK_LABEL[rank]}</span>
                </div>
                <HealthBar hp={enemy.hp} maxHp={enemy.maxHp} block={enemy.block} tone="enemy" id={enemy.uid} />
                <div className="bd-enemy-pills"><EnemyPills enemy={enemy} /></div>
                {mutation && <p className="bd-enemy-note" style={{ color: mutation.tone }}>异变 · {mutation.note}</p>}
                {def && !mutation && <p className="bd-enemy-note">{def.note}</p>}
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
        and a hand you have to scroll to read is not a hand. The relics live at the left end of that
        same floor — they are the other half of 「what you are carrying」, and down here they get to be
        the actual cards rather than a name in a box. */}
    <div className="bd-floor">
      <BattleRelics run={run} />
      <div className="bd-hand-row">
      {state.hand.map(card => {
        const face = CARD_BY_ID.get(card.cardId);
        const playable = canPlay(state, card.uid);
        return <button key={card.uid} className={`bd-hand-card ${picked === card.uid ? 'on' : ''} ${playable ? '' : 'off'}`}
          onClick={() => onCard(card)} aria-disabled={!playable} aria-label={`打出 ${cardName(card.cardId)}`}>
          {face
            ? <CardFace card={face} selected={picked === card.uid} upgraded={card.upgraded} />
            : <JunkFace card={card} />}
        </button>;
      })}
      {!state.hand.length && <p className="bd-hand-empty">手牌是空的。</p>}
      </div>
    </div>

    {pile && <div className="bd-modal" role="dialog" aria-label="牌堆" onClick={event => { if (event.target === event.currentTarget) setPile(null); }}>
      <div className="bd-modal-inner">
        <h3>{pile === 'draw' ? '抽牌堆' : pile === 'discard' ? '弃牌堆' : '已移出'}
          <small>{piles[pile].length} 张 · 顺序即抽取顺序</small></h3>
        <div className="bd-modal-list">
          {piles[pile].map(card => <span key={card.uid} className="bd-modal-card">
            <b>{cardName(card.cardId)}</b>{card.upgraded && <em className="bd-modal-plus">已打磨</em>}
            <i>{cardCost(card.cardId) >= 0 ? `${cardCost(card.cardId)} 费` : '不可打出'}</i>
          </span>)}
          {!piles[pile].length && <p className="bd-modal-empty">这里什么都没有。</p>}
        </div>
        <button className="bd-modal-close" onClick={() => setPile(null)} aria-label="关闭">✕</button>
      </div>
    </div>}

    {/* 击破守望者的解锁**先于**战果面板整屏出现。
        它原来只是战果面板里的一行名字，而那个面板讲的是这一仗：带走的血、拿到的钱。
        解锁讲的是往后每一局，缩在里面就等于没有。摆的是牌面——「万刃」和「千刃」对一个没见过
        这两张牌的玩家是同样三个字。 */}
    {outcome && !!unlockedCards.length && !unlockSeen && <div className="bd-over">
      <UnlockScreen cards={unlockedCards} audioOn={audioOn} onDone={() => setUnlockSeen(true)} />
    </div>}

    {outcome && (!unlockedCards.length || unlockSeen) && <div className="bd-over">
      <div className={`bd-over-card bd-spoils ${outcome.won ? 'won' : 'lost'}`}>
        <p className="bd-over-kicker">
          {!outcome.won ? 'DEFEAT' : outcome.chapterCleared ? 'CHAPTER I · CLEARED' : 'VICTORY'}
        </p>
        <h2>{!outcome.won ? '火熄了' : outcome.chapterCleared ? '长夜未尽' : '火还亮着'}</h2>
        <p>{!outcome.won
          ? `${encounter.name} · 第 ${state.turn} 回合。营地里那簇火又暗了一分。`
          : outcome.chapterCleared
            ? `${encounter.name} 倒在第 ${state.turn} 回合。守望者的火换了一个人来守——营地的第一个夜晚，过去了。`
            : `${encounter.name} · ${state.turn} 个回合。草地上的灰会被夜里的风带走。`}</p>

        {outcome.won && <>
          <dl className="bd-spoils-stats">
            {/* Post-heal, because that is what the next fight opens with — "剩余生命" would read as
                the number the fight ended on, which is `state.player.hp` and a different value. */}
            <div><dt>带进下一场</dt><dd>{outcome.run.hp}<i>/{state.player.maxHp}</i></dd></div>
            <div><dt>{outcome.chapterCleared ? '最后一程' : '营火回血'}</dt>
              <dd className="good">+{outcome.heal}</dd></div>
            {/* Anchors beaten, not `cleared.length` — the tower's pool fights are logged in `cleared`
                too, so the raw length reads 「7/5」 on any run that has fought more than five times. */}
            <div><dt>进度</dt><dd>{chapterProgress(outcome.run)}<i>/{RUN_ENCOUNTERS.length}</i></dd></div>
          </dl>
          {outcome.healed < outcome.heal && <p className="bd-spoils-note">
            营火给了 {outcome.heal} 点，但生命已到上限，实际只收回 {outcome.healed} 点。
          </p>}
        </>}

        {/* The 解锁 block that used to sit here — a list of names — is gone. `UnlockScreen` shows the
            same thing one step earlier and with the actual cards on it; saying it twice, once without
            the cards, is how the feedback got missed in the first place. */}

        {!outcome.won && <p className="bd-spoils-note">
          这一章到此为止。火熄了就得重新点——新的牌序，新的血量，从头再来。
        </p>}

        <div className="bd-spoils-actions">
          {outcome.won && !outcome.chapterCleared
            ? <button className="bd-btn bd-over-btn" onClick={backToPrep}>
                进入下一场<ChevronRight size={15} strokeWidth={1.8} /></button>
            : <button className="bd-btn bd-over-btn" onClick={leaveRun}>
                {outcome.chapterCleared ? '回到开场' : '重新挑战本章'}<RotateCcw size={14} strokeWidth={1.7} /></button>}
        </div>
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

// ------------------------------------------------------------------- relics


/**
 * The two slots on the battle floor, at the left of the hand.
 *
 * **Full card faces**, not name plates — down here there is room for them, and a relic is read the
 * same way a card in hand is. The 主/副 tag is what says which half of the printed card is live, so
 * the face itself does not have to change between slots.
 *
 * Read-only: the loadout is decided on the preparation screen, and a fight in progress is the wrong
 * place to change what you walked in with.
 */
function BattleRelics({ run }: { run: ChapterRun }) {
  return <div className="bd-hand-relics">
    {(['main', 'sub'] as const).map(slot => {
      const relic = run.relics[slot] ? RELIC_BY_ID.get(run.relics[slot]!) : undefined;
      return <div key={slot} className={`bd-hand-relic ${relic ? '' : 'is-empty'}`}>
        <div className="bd-hand-relic-scale">
          {relic
            ? <RelicFace relic={relic} refine={refineBadge(run, slot)} />
            : <span className="bd-hand-relic-blank"><i>{slot === 'main' ? '主遗物' : '副遗物'}</i>空</span>}
        </div>
        <span className="bd-hand-relic-tag">{slot === 'main' ? '主' : '副'}</span>
      </div>;
    })}
  </div>;
}

/**
 * 淬炼, in the shape the face wants it: the tier, and the lines saying what moved.
 *
 * The lines come from `refineLines`, which runs the relic's **own handlers** at both tiers — the same
 * call the engine makes during a fight. That is the whole point: authoring a second set of numbers for
 * the card face is how 打磨 shipped a card that said 「抽 1 张牌」 while the engine drew two, and this
 * arrangement cannot repeat it.
 *
 * `slot` matters: 干粮 pays 3 生命 in the 主槽 and 1 in the 副槽, so the same relic refines to a
 * different number on each side of the frame.
 */
function refineBadge(run: ChapterRun, slot: 'main' | 'sub') {
  const id = run.relics[slot];
  const tier = id ? run.refined?.[id] : undefined;
  if (!id || !tier) return undefined;
  return { tier, lines: refineLines(id, slot, tier) };
}

/**
 * The two slots, as boxes.
 *
 * On the preparation screen they are **worked, not just read**: a relic can be swapped between the
 * slots or thrown away. Carrying a relic is otherwise a decision made once and never revisited —
 * you could see that 断刃's tax was hurting you and have no way to put it down.
 */
function RelicSlots({ run, onSwap, onDrop, audioOn }: {
  run: ChapterRun; onSwap?: () => void; onDrop?: (slot: 'main' | 'sub') => void; audioOn?: boolean;
}) {
  const editable = !!(onSwap && onDrop);
  const held = !!(run.relics.main || run.relics.sub);
  return <div className="bd-relic-slots">
    {(['main', 'sub'] as const).map(slot => {
      const relic = run.relics[slot] ? RELIC_BY_ID.get(run.relics[slot]!) : undefined;
      const tier = relic ? TIER_BY_ID.get(relic.tier)! : undefined;
      return <div key={slot} className={`bd-relic-slot ${relic ? 'filled' : 'empty'}`}
        style={tier ? { '--tier': tier.accent } as CSSProperties : undefined}
        title={relic ? `${relic.name}\n主槽：${relic.text}\n副槽：${relic.sub}` : undefined}>
        <span>{slot === 'main' ? '主遗物' : '副遗物'}</span>
        <b>{relic ? relic.name : '空'}</b>
        {relic && <i>{tier!.name} · {slot === 'main' ? '完整效果' : '折扣效果'}
          {/* The plate is a name plate rather than a face, so the refinement is one more clause
              rather than a block of its own — but it still has to be *here*, because this is the
              screen where the loadout is read. */}
          {run.refined?.[relic.id] && <em className="bd-relic-refined">
            {REFINE_LABEL[run.refined[relic.id]!]}
          </em>}
        </i>}
        {editable && relic && <button className="bd-relic-drop" onClick={() => onDrop!(slot)}
          onPointerEnter={() => sound('hover', audioOn ?? true)}>丢弃</button>}
      </div>;
    })}
    {editable && held && <button className="bd-relic-swap" onClick={onSwap}
      onPointerEnter={() => sound('hover', audioOn ?? true)}>
      <ArrowLeftRight size={13} strokeWidth={1.8} />调换主副
    </button>}
  </div>;
}

/**
 * The draw. Three relics face down; turn one over and it goes into a slot.
 *
 * The flip is a real half-turn rather than a fade, for the same reason the card draw is — and the
 * burst that goes off on the turn is in the relic's own tier colour, so the *rarity* lands before the
 * name does. The other two stay face down and are never seen: what you did not pick is not
 * information the game owes you.
 */
function RelicDraw({ run, options, slot, onClaim, audioOn }: {
  run: ChapterRun; options: string[]; slot: 'main' | 'sub';
  onClaim: (relicId: string, placeIn: 'main' | 'sub') => void; audioOn: boolean;
}) {
  const [flipped, setFlipped] = useState<string | null>(null);
  const [burst, setBurst] = useState(0);
  const chosen = flipped ? RELIC_BY_ID.get(flipped) : undefined;

  function turn(id: string) {
    if (flipped) return;
    setFlipped(id);
    setBurst(seq => seq + 1);
    sound('relic', audioOn);
  }

  return <section className="bd-draw">
    <div className="bd-draw-head">
      <h2>{slot === 'main' ? '主遗物' : '副遗物'}<small>{slot === 'main' ? 'MAIN RELIC' : 'SUB RELIC'}</small></h2>
    </div>
    <p className="bd-draw-note">
      {slot === 'main'
        ? '打赢了这一场，营地给你一次翻东西的机会。三件里挑一件，装进主遗物槽，拿它完整的效果。'
        : '副遗物槽也开了。这里挑到的一件只给折扣效果——但折扣总比空着强。'}
    </p>
    <div className="bd-draw-row">
      {options.map(id => {
        const relic = RELIC_BY_ID.get(id);
        if (!relic) return null;
        const tier = TIER_BY_ID.get(relic.tier)!;
        const isFlipped = flipped === id;
        return <button key={id} className={`bd-draw-card ${isFlipped ? 'is-flipped' : ''} ${flipped && !isFlipped ? 'is-dimmed' : ''}`}
          style={{ '--tier': tier.accent } as CSSProperties}
          onPointerEnter={() => { if (!flipped) sound('hover', audioOn); }}
          onClick={() => turn(id)} aria-label={isFlipped ? relic.name : '未翻开的遗物'}>
          <span className="bd-draw-inner">
            <span className="bd-draw-face bd-draw-back"><i /></span>
            <span className="bd-draw-face bd-draw-front">
              <RelicFace relic={relic} />
              {isFlipped && <span key={burst} className="bd-draw-burst" style={{ '--tier': tier.accent } as CSSProperties} />}
            </span>
          </span>
        </button>;
      })}
    </div>
    {chosen
      ? <>
        <p className="bd-draw-hint">
          装进哪个槽由你决定：<b>主槽</b>给卡面上半部分的完整效果，<b>副槽</b>只给下半部分的折扣效果。
          目标槽已有东西的话，旧的会被换下来。
        </p>
        <div className="bd-draw-actions">
          {(['main', 'sub'] as const).map(target => {
            const current = run.relics[target] ? RELIC_BY_ID.get(run.relics[target]!) : undefined;
            return <button key={target} className="bd-btn bd-fight-btn"
              onClick={() => { sound('relic-set', audioOn); onClaim(chosen.id, target); }}>
              装入{target === 'main' ? '主' : '副'}遗物槽
              {current && <i className="bd-draw-replace">替换 {current.name}</i>}
            </button>;
          })}
        </div>
      </>
      : <p className="bd-draw-hint">点一张翻开。</p>}
  </section>;
}

// --------------------------------------------------------------- the two screens

/** A small, self-contained audio switch — the fight's header owns the real one, but these screens
 *  need a way back to silence too. */
function PrepAudio({ audioOn, onAudio }: { audioOn: boolean; onAudio: () => void }) {
  return <button className={`bd-btn bd-sound ${audioOn ? 'on' : ''}`} aria-pressed={audioOn} onClick={onAudio}>
    {audioOn ? <Volume2 size={14} strokeWidth={1.7} /> : <VolumeX size={14} strokeWidth={1.7} />}音效
  </button>;
}

/**
 * The chapter's front door. The pair is locked the moment the player commits, so this is the last
 * point at which the two decks are still a choice rather than a fact.
 */
function ChapterIntro({ audioOn, onAudio, onStart }: {
  audioOn: boolean; onAudio: () => void; onStart: (main: DeckId, sub: DeckId) => void;
}) {
  return <div className="bd bd-prep">
    <div className="bd-prep-inner">
      <header className="bd-prep-head">
        <p className="bd-prep-kicker">{CHAPTER_1.subtitle}</p>
        <h1 className="bd-prep-title">{CHAPTER_1.name}</h1>
        <p className="bd-prep-copy">
          五场战斗，一条命。血量从这里带出去就一直带到底，每打赢一场营火会替你回一点。
          这一章不会换牌组——但每一场开打前，你都可以决定让哪一副走在前面。
        </p>
        <div className="bd-prep-tools"><PrepAudio audioOn={audioOn} onAudio={onAudio} /></div>
      </header>

      <section className="bd-forms">
        {OPENING_FORMS.map(form => {
          const mainSize = chapterDeck(form.main).length;
          const pile = chapterDeck(form.main, form.sub);
          const deck = DECKS.find(entry => entry.id === form.main)!;
          return <article key={form.main} className="bd-form" style={{ '--deck': deckAccent(form.main) } as CSSProperties}>
            <CardBack deck={deck} compact />
            <div className="bd-form-copy">
              <p className="bd-form-kicker">主牌组</p>
              <h2>{deck.name}<small>{deck.subtitle}</small></h2>
              <p>{form.blurb}</p>
              <p className="bd-form-pile">
                开打时 <b>{pile.length}</b> 张：{deck.name} {mainSize} 张，外加 {deckName(form.sub)} 的 {pile.length - mainSize} 张。
              </p>
              <button className="bd-btn bd-form-start" onPointerEnter={() => sound('hover', audioOn)}
                onClick={() => onStart(form.main, form.sub)}>
                以此开局<ChevronRight size={15} strokeWidth={1.8} />
              </button>
            </div>
          </article>;
        })}
      </section>
    </div>
  </div>;
}

/**
 * Between fights. This is where the two decisions a run actually offers live: whether to swap 主/副,
 * and whether to walk into the next fight at all — so the encounter is shown in full, portraits
 * included, before anything is committed.
 */
function BattlePrep({ run, outcome, audioOn, onAudio, onSwap, onFight, onClaimDraw, onSwapRelics, onDropRelic }: {
  run: ChapterRun; outcome: BattleOutcome | null; audioOn: boolean;
  onAudio: () => void; onSwap: () => void; onFight: () => void;
  onClaimDraw: (relicId: string, placeIn: 'main' | 'sub') => void;
  onSwapRelics: () => void; onDropRelic: (slot: 'main' | 'sub') => void;
}) {
  // The fight is the one the *floor* is holding, not "the next one in the chapter". This screen used
  // to ask `currentEncounter`, which walks the linear list — so standing on the boss floor it
  // announced 失落的商队, and the boss looked like it had been skipped.
  const encounter = run.currentFight ? ENCOUNTER_BY_ID.get(run.currentFight) : undefined;
  /** Which floor of the tower this is, out of how many. The chapter is a climb now, not a list. */
  const floorRow = run.at ? (run.map.byId.get(run.at)?.row ?? 0) : 0;
  const main = DECKS.find(deck => deck.id === run.main)!;
  const sub = DECKS.find(deck => deck.id === run.sub)!;
  const pile = chapterDeck(run.main, run.sub);
  const cleared = isChapterCleared(run);
  const lastOutcome = outcome;

  return <div className="bd bd-prep">
    <div className="bd-prep-inner">
      <header className="bd-prep-head">
        <p className="bd-prep-kicker">{CHAPTER_1.subtitle}</p>
        <h1 className="bd-prep-title">{CHAPTER_1.name}</h1>
        <div className="bd-progress" aria-label={`第 ${floorRow} 层，共 ${BOSS_ROW} 层`}>
          <span className="bd-progress-step now">{floorRow}</span>
          <b className="bd-progress-num">层<i>/{BOSS_ROW}</i></b>
          <span className="bd-progress-note">
            已走过 {run.path.length} 层 · 已击败 {run.cleared.length} 场
          </span>
        </div>
        <div className="bd-prep-tools"><PrepAudio audioOn={audioOn} onAudio={onAudio} /></div>
      </header>

      {cleared
        ? <p className="bd-prep-copy">这一章的五个夜晚都过去了。</p>
        : encounter && <>
          <section className="bd-brief">
            <div className="bd-brief-copy">
              <p className="bd-brief-kicker">第 {floorRow} 层 · {encounter.kind}</p>
              <h2>{encounter.name}</h2>
              <p className="bd-brief-blurb">{encounter.blurb}</p>
              {encounter.teach && <p className="bd-brief-teach"><i>这一场要你回答</i>{encounter.teach}</p>}
            </div>
            <div className="bd-brief-units">
              {encounter.units.map(unit => {
                const def = ENEMY_BY_ID.get(unit.id);
                const [low, high] = unit.count;
                return <figure key={unit.id} className="bd-brief-unit">
                  <img src={`/assets/monsters/${unit.id}.webp`} alt="" loading="lazy" />
                  <figcaption>
                    {def?.name ?? unit.id}
                    {/* The briefing promises kinds, not numbers — the count is a range and says so. */}
                    <i className="bd-brief-count">{low === high ? `×${low}` : `${low}–${high} 只`}</i>
                  </figcaption>
                </figure>;
              })}
            </div>
          </section>
        </>}

      {/* A draw that is owed takes over the screen. Everything else on the preparation page is
          something to read; this is the one thing on it that is a decision. */}
      {run.pendingDraw && <RelicDraw run={run} options={run.pendingDraw.options}
        slot={run.pendingDraw.slot} onClaim={onClaimDraw} audioOn={audioOn} />}

      <section className="bd-runbar">
        <div className="bd-run-hp">
          <p className="bd-run-label">带进这一场的生命</p>
          {/* `run.maxHp`, not `PLAYER_MAX_HP` — the bar has to agree with what the fight will open
              with, and that is now the run's own ceiling. */}
          <HealthBar hp={run.hp} maxHp={run.maxHp} block={0} tone="player" />
          {lastOutcome?.won && <p className="bd-run-heal">
            上一场营火回血 <b>+{lastOutcome.heal}</b>
            {lastOutcome.healed < lastOutcome.heal && <i>（生命已满，实收 {lastOutcome.healed}）</i>}
          </p>}
          {!lastOutcome && <p className="bd-run-heal">本章第一次开打，满血出发。</p>}
        </div>

        <div className="bd-run-decks" style={{ '--deck': deckAccent(run.main), '--deck-sub': deckAccent(run.sub) } as CSSProperties}>
          <p className="bd-run-label">本章锁定的牌组</p>
          {/* The backs are shown, not just the names: 「主牌组 · 断罪之刃」 is a label, but the cover
              is the thing you actually recognise across a table. */}
          <div className="bd-run-pair">
            <div className="bd-run-deck main">
              <CardBack deck={main} compact />
              <span>主牌组</span><i>{chapterDeck(run.main).length} 张</i>
            </div>
            <button className="bd-swap" onClick={onSwap} aria-label="调换主副牌组"
              onPointerEnter={() => sound('hover', audioOn)}>
              <ArrowLeftRight size={16} strokeWidth={1.8} />
              <span>调换</span>
            </button>
            <div className="bd-run-deck sub">
              <CardBack deck={sub} compact />
              <span>副牌组</span><i>{pile.length - chapterDeck(run.main).length} 张</i>
            </div>
          </div>
          <p className="bd-run-note">
            副牌组只掺 {pile.length - chapterDeck(run.main).length} 张，是细的第二股流；合起来一副 {pile.length} 张。
          </p>
        </div>

        <div className="bd-run-relics">
          <p className="bd-run-label">身上的遗物</p>
          <RelicSlots run={run} onSwap={onSwapRelics} onDrop={onDropRelic} audioOn={audioOn} />
          <p className="bd-run-note">金币 {run.gold} · 可以调换主副，也可以把某一件丢掉</p>
        </div>
      </section>

      <div className="bd-prep-go">
        <button className="bd-btn bd-fight-btn" onClick={onFight} disabled={cleared || !!run.pendingDraw}
          onPointerEnter={() => sound('hover', audioOn)}>
          <Swords size={16} strokeWidth={1.8} />
          {cleared ? '章节已完结' : run.pendingDraw ? '先挑一件遗物' : '开战'}
        </button>
      </div>
    </div>
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
