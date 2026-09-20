/**
 * The battle layer. Like `src/cards/**`, it imports nothing from `src/world/**` — the map's
 * generation, layout digest and save format stay untouchable from here.
 */

export type Side = 'player' | 'enemy';

/** Every stackable number in a fight. Kept deliberately short and integral: a status is a word plus
 *  a whole number, which is what makes them easy to read and surprising to combine. */
export type StatusId =
  /** Player resource, produced by 断罪之刃. */
  | 'ember'
  /** Player resource, produced by 长明壁垒. Every attack hit deals this much extra. */
  | 'edge'
  /** Player resource, produced by 长明壁垒. Each stack keeps 1 block at end of turn. */
  | 'rampart'
  /** Player resource, produced by 千面回廊. Spend 1 to copy the card you play. */
  | 'reflection'
  /** On an enemy. Takes this much at the start of its turn, then loses 1. */
  | 'scorch'
  /** On an enemy. Attacks against it deal this much extra. */
  | 'mark'
  /** On the player. Each time an enemy attacks this turn, hit back for this much. */
  | 'retaliate'
  /** Player. Energy banked for next turn, capped at 3. */
  | 'bank'
  /** Player. Next turn starts with this much less energy. */
  | 'drained'
  /** Enemy. Each of its attacks deals this much extra. */
  | 'strength'
  /** Player. Next turn draws this many fewer cards. */
  | 'shrouded';

export const STATUS_LABEL: Record<StatusId, string> = {
  ember: '余烬', edge: '锋锐', rampart: '壁垒', reflection: '映照',
  scorch: '灼烧', mark: '烙印', retaliate: '反震', bank: '蓄火', drained: '枯竭', strength: '力量', shrouded: '缠布',
};
/** One line each, shown on hover in the demo. */
export const STATUS_RULE: Record<StatusId, string> = {
  ember: '不会消退。部分牌消耗它换取爆发。',
  edge: '每层让你的攻击每次命中 +1 伤害。',
  rampart: '每层让你在回合开始时保留 1 点格挡。',
  reflection: '消耗 1 层，把打出的牌复制一次。',
  scorch: '该敌人回合开始时受到等量伤害，然后 −1。',
  mark: '你对被烙印的敌人造成的伤害 +3。',
  retaliate: '本回合内每次被攻击，对攻击者反击等量伤害。',
  bank: '下回合开始时转化为能量，最多 3 点。',
  drained: '下回合开始时少这么多能量。',
  strength: '它的每次攻击额外造成这么多伤害。',
  shrouded: '下回合少抽这么多张牌。',
};
/** Which way each status is good. Drives the colour of the pill in the UI. */
export const STATUS_GOOD: Record<StatusId, boolean> = {
  ember: true, edge: true, rampart: true, reflection: true,
  scorch: false, mark: false, retaliate: true, bank: true, drained: false, strength: false, shrouded: false,
};

/** What an enemy is about to do. Shown above its head, always — the player should never be guessing. */
export type Intent =
  | { kind: 'attack'; amount: number; times?: number; note?: string }
  | { kind: 'block'; amount: number; note?: string }
  | { kind: 'buff'; status: StatusId; amount: number; note?: string }
  | { kind: 'debuff'; status: StatusId; amount: number; note?: string }
  /** Inserts junk cards into the player's draw pile. */
  | { kind: 'pollute'; amount: number; note?: string }
  | { kind: 'drain'; amount: number; note?: string }
  /** Gives every *other* enemy block — forces you to kill the support first. */
  | { kind: 'ward'; amount: number; note?: string }
  /** Turns cards in the player's hand into junk. */
  | { kind: 'bury'; amount: number; note?: string }
  | { kind: 'summon'; id: string; note?: string }
  /** Eats the player's 余烬 and 锋锐 and turns them into the enemy's own block. */
  | { kind: 'devour'; note?: string }
  /** Steals a status off the player and keeps it as 力量. */
  | { kind: 'steal'; status: StatusId; note?: string }
  | { kind: 'special'; note: string };

/** Behaviours that are not part of a turn rotation. */
export type Trait =
  /** On death, deals this much to every other unit on the field, allies included. */
  | { id: 'deathBurst'; amount: number }
  /** When one hit takes its block all the way to zero, it takes this much damage instead. */
  | { id: 'shatter'; amount: number }
  /** Its attacks grow by this much for every other living enemy. */
  | { id: 'pack'; amount: number }
  /** At the start of its turn it hands the player this status. */
  | { id: 'gift'; status: StatusId; amount: number };

export interface EnemyDefinition {
  id: string;
  name: string;
  /** Chapter-1 foes are graded, and the grade sets the name's colour in the UI. */
  rank: EnemyRank;
  hp: number;
  /** How much of it comes back each turn, before its action. */
  regenBlock?: number;
  note: string;
  /** One line of lore for the compendium panel. */
  lore: string;
  /** Passives, checked by the engine outside the turn rotation. */
  traits?: Trait[];
  /** Which turn-rotation this enemy runs. See `enemies.ts` for the actual scripts. */
  script: string;
}

/** The grade ladder. `boss` names are crimson, `elite` gold, `normal` bone white, `minion` grey. */
export type EnemyRank = 'minion' | 'normal' | 'elite' | 'miniboss' | 'boss';
export const RANK_LABEL: Record<EnemyRank, string> = { minion: '杂兵', normal: '寻常', elite: '精英', miniboss: '小首领', boss: '首领' };
/** Name colours by grade, so a fight's shape is readable before you read a single number. */
export const RANK_COLOR: Record<EnemyRank, string> = { minion: '#8d9a94', normal: '#d8d2c0', elite: '#e0b45f', miniboss: '#e08a52', boss: '#e2564f' };

export interface EnemyState {
  uid: string;
  id: string;
  hp: number;
  maxHp: number;
  block: number;
  statuses: Partial<Record<StatusId, number>>;
  /** Which turn of its script it is on. */
  turn: number;
  intent: Intent[];
  dead: boolean;
}

export interface PlayerState {
  hp: number;
  maxHp: number;
  block: number;
  energy: number;
  energyPerTurn: number;
  statuses: Partial<Record<StatusId, number>>;
}

export type CardKind = 'attack' | 'skill' | 'power' | 'rite';
/** A junk card an enemy can force into your deck. */
export interface JunkCard { id: string; name: string; cost: number; text: string }

export type Phase = 'player' | 'enemy' | 'won' | 'lost';
export interface LogLine { id: number; text: string; tone: 'good' | 'bad' | 'neutral' | 'special' }
