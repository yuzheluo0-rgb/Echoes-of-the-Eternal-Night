/**
 * The card layer for the battle. Deliberately self-contained: nothing here imports from
 * `src/world/**`, so the map's generation, its layout digest and its save format cannot be touched
 * by anything in this folder.
 */

/**
 * Rarity. The names are a ladder of light, which is what the world is about: a fire that has almost
 * gone out, then a wick catching, then the flame, then a flame that does not go out, and finally a
 * light that fell out of the sky. `weight` is the share of the reward pool each tier takes.
 */
export type TierId = 'cinder' | 'glimmer' | 'blaze' | 'everburning' | 'starfall';
export interface Tier {
  id: TierId; name: string; gloss: string; weight: number;
  accent: string;
  rank: number;
}
export const TIERS: Tier[] = [
  { id: 'cinder', name: '残烬', gloss: '火将熄时剩下的那点红。简单、直接、撑得起开局。', weight: 46, accent: '#8a7f6c', rank: 0 },
  { id: 'glimmer', name: '微光', gloss: '灯芯第一次咬住火。牌组的骨架由它长成。', weight: 30, accent: '#b9c9c4', rank: 1 },
  { id: 'blaze', name: '明焰', gloss: '能照亮一间屋子的火，也够烧穿一层甲。', weight: 16, accent: '#d9a45f', rank: 2 },
  { id: 'everburning', name: '长明', gloss: '不靠添柴也能烧下去的火。见过它的人不再怕夜。', weight: 6, accent: '#f0cf87', rank: 3 },
  { id: 'starfall', name: '星陨', gloss: '从天上掉下来的一小块光。一副牌组只承载得起一枚。', weight: 2, accent: '#9fd8ff', rank: 4 },
];
export const TIER_BY_ID = new Map(TIERS.map(tier => [tier.id, tier]));

export type DeckId = 'blade' | 'flame' | 'bone' | 'mirror';
export type CardDeck = DeckId | 'neutral';
export const DECK_IDS: DeckId[] = ['blade', 'flame', 'bone', 'mirror'];
export type CardType = 'attack' | 'skill' | 'power' | 'rite';

/**
 * Every mechanic a card may name. Two kinds:
 *
 * `resource` — the five archetype resources, one per deck. Each deck produces exactly one and
 * consumes another's, which is what makes the decks talk to each other instead of sitting in four
 * sealed boxes:
 *
 *   刃 ──余烬──▶ 焰 ──灼烧──▶ 骨 ──壁垒──▶ 镜 ──映照──▶ 刃
 *
 * `mechanic` — universal shapes any deck may use. These exist so a card can be interesting without
 * being a bigger number: they change *when* something happens (连缀, 空明, 迟滞), *what you pay with*
 * (祭火, 焚尽), or *where the cards go* (拾回, 返照, 回响, 流转). A card set that only has resources
 * and damage has one card in it, printed a hundred times.
 */
export type KeywordId =
  | 'ember' | 'edge' | 'scorch' | 'rampart' | 'reflection'
  | 'bank' | 'flare' | 'sacrifice' | 'exhaust' | 'reclaim' | 'rewind'
  | 'detonate' | 'inscribe' | 'chain' | 'empty' | 'echo' | 'delay' | 'retaliate' | 'mark' | 'cycle';

export interface Keyword {
  id: KeywordId; name: string; kind: 'resource' | 'mechanic';
  /** Only resources have an owner deck; a universal mechanic belongs to everybody. */
  owner?: DeckId;
  rule: string;
}
export const KEYWORDS: Keyword[] = [
  // --- resources -----------------------------------------------------------
  { id: 'ember', name: '余烬', kind: 'resource', owner: 'blade', rule: '层数，不会自然消退。焰牌消耗它换取爆发，骨牌可以把它烧成格挡。' },
  { id: 'edge', name: '锋锐', kind: 'resource', owner: 'bone', rule: '每层让你的攻击每次命中 +1 伤害。骨牌在获得格挡时积累，刃牌负责把它花掉。' },
  { id: 'scorch', name: '灼烧', kind: 'resource', owner: 'flame', rule: '施加在敌人身上。其回合开始时受到等于层数的伤害，然后层数 −1。' },
  { id: 'rampart', name: '壁垒', kind: 'resource', owner: 'bone', rule: '层数。每层让你在回合开始时保留 1 点格挡，而不是全部清空。' },
  { id: 'reflection', name: '映照', kind: 'resource', owner: 'mirror', rule: '层数。可以消耗 1 层把打出的牌复制一次，复制品带焚尽。' },
  // --- universal mechanics -------------------------------------------------
  { id: 'bank', name: '蓄火', kind: 'mechanic', rule: '本回合没有用完的能量保留到下回合，最多保留 3 点。' },
  { id: 'flare', name: '爆燃', kind: 'mechanic', rule: '立刻获得能量，但下回合相应减少。' },
  { id: 'sacrifice', name: '祭火', kind: 'mechanic', rule: '用生命值支付，而不是用能量。' },
  { id: 'exhaust', name: '焚尽', kind: 'mechanic', rule: '打出后本场战斗移出牌组，不会再被抽到。' },
  { id: 'reclaim', name: '拾回', kind: 'mechanic', rule: '从弃牌堆取回一张牌。' },
  { id: 'rewind', name: '返照', kind: 'mechanic', rule: '把本回合已经打出的一张牌退回手牌。' },
  { id: 'detonate', name: '引爆', kind: 'mechanic', rule: '消耗目标身上全部灼烧，每层立刻造成额外伤害。' },
  { id: 'inscribe', name: '刻印', kind: 'mechanic', rule: '本场战斗永久强化牌组中的一张牌。' },
  { id: 'chain', name: '连缀', kind: 'mechanic', rule: '本回合已经打出若干张牌时，触发额外效果。' },
  { id: 'empty', name: '空明', kind: 'mechanic', rule: '手牌为空时，触发额外效果。' },
  { id: 'echo', name: '回响', kind: 'mechanic', rule: '把这张牌的一个弱化复制品加入手牌。' },
  { id: 'delay', name: '迟滞', kind: 'mechanic', rule: '不在打出时结算，改为下回合开始时结算。' },
  { id: 'retaliate', name: '反震', kind: 'mechanic', rule: '本回合内每次被攻击时，对攻击者反击。' },
  { id: 'mark', name: '烙印', kind: 'mechanic', rule: '标记敌人。被标记的敌人受到指定牌的额外伤害。' },
  { id: 'cycle', name: '流转', kind: 'mechanic', rule: '抽牌、弃牌、检索或洗牌——调度牌组本身。' },
];
export const KEYWORD_BY_ID = new Map(KEYWORDS.map(keyword => [keyword.id, keyword]));
export const RESOURCES = KEYWORDS.filter(keyword => keyword.kind === 'resource');

/**
 * The mechanical shape of a card, independent of its numbers. This exists to be checked: the
 * brief was that every card should feel like its own card, and the failure mode of a large card
 * set is a hundred cards that all read "deal N damage". `cards.test.ts` holds each deck to a
 * minimum spread of shapes and caps how often any one shape may repeat.
 */
export type PatternId =
  | 'basic-strike' | 'multi-hit' | 'heavy-strike' | 'conditional-strike' | 'execute' | 'aoe'
  | 'dot-apply' | 'dot-payoff' | 'dot-convert' | 'debuff'
  | 'block-basic' | 'block-burst' | 'block-convert' | 'retaliate' | 'heal'
  | 'resource-build' | 'resource-spend' | 'resource-convert' | 'ramp'
  | 'draw' | 'discard' | 'tutor' | 'recycle' | 'shuffle' | 'copy' | 'energy' | 'sacrifice'
  | 'exhaust-payoff' | 'upgrade' | 'finisher';
export const PATTERN_LABEL: Record<PatternId, string> = {
  'basic-strike': '基础攻击', 'multi-hit': '多段', 'heavy-strike': '重击', 'conditional-strike': '条件攻击',
  execute: '处决', aoe: '群体', 'dot-apply': '施加持续伤害', 'dot-payoff': '持续伤害收益', 'dot-convert': '持续伤害转化',
  debuff: '削弱', 'block-basic': '基础格挡', 'block-burst': '爆发格挡', 'block-convert': '格挡转化',
  retaliate: '反击', heal: '回复', 'resource-build': '积累资源', 'resource-spend': '消耗资源',
  'resource-convert': '资源转化', ramp: '成长', draw: '抽牌', discard: '弃牌', tutor: '检索',
  recycle: '回收', shuffle: '洗牌', copy: '复制', energy: '能量', sacrifice: '献祭',
  'exhaust-payoff': '焚尽收益', upgrade: '强化', finisher: '终结技',
};

export interface CardDefinition {
  /** `<deck>-<two digits>`, and it must never change once a save can hold it. */
  id: string;
  name: string;
  deck: CardDeck;
  tier: TierId;
  /** Energy. 0–3; -1 marks a card that cannot be played straight from hand. */
  cost: number;
  type: CardType;
  /** Rules text. Names mechanics verbatim so the gallery can link them. */
  text: string;
  keywords: KeywordId[];
  /** The mechanical shape, for the anti-sameness check and the gallery's filters. */
  pattern: PatternId;
  /** Set when the card reaches into another deck's resource — the cross-deck link, made explicit. */
  bridge?: DeckId;
  lore: string;
}

export interface DeckEntry { id: string; copies: number }
export interface Deck {
  id: DeckId;
  name: string;
  subtitle: string;
  blurb: string;
  accent: string;
  size: number;
  cards: DeckEntry[];
}

export const TYPE_LABEL: Record<CardType, string> = { attack: '攻击', skill: '技能', power: '能力', rite: '仪式' };
