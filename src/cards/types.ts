/**
 * The card layer for the rebuilt battle. Deliberately self-contained: nothing here imports from
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
  /** Accent used by the card frame, the name plate and the ambient effect. */
  accent: string;
  /** Multiplies the name's font size, and how loud the ambient effect is. */
  rank: number;
}
export const TIERS: Tier[] = [
  { id: 'cinder', name: '残烬', gloss: '火将熄时剩下的那点红。撑得住开场，撑不到终局。', weight: 46, accent: '#8a7f6c', rank: 0 },
  { id: 'glimmer', name: '微光', gloss: '灯芯第一次咬住火。牌组的骨架由它长成。', weight: 30, accent: '#b9c9c4', rank: 1 },
  { id: 'blaze', name: '明焰', gloss: '能照亮一间屋子的火，也够烧穿一层甲。', weight: 16, accent: '#d9a45f', rank: 2 },
  { id: 'everburning', name: '长明', gloss: '不靠添柴也能烧下去的火。见过它的人不再怕夜。', weight: 6, accent: '#f0cf87', rank: 3 },
  { id: 'starfall', name: '星陨', gloss: '从天上掉下来的一小块光。一副牌组只承载得起一枚。', weight: 2, accent: '#9fd8ff', rank: 4 },
];
export const TIER_BY_ID = new Map(TIERS.map(tier => [tier.id, tier]));
/** Total weight, so a caller can normalise without re-adding the table. */
export const TIER_TOTAL = TIERS.reduce((sum, tier) => sum + tier.weight, 0);

export type DeckId = 'blade' | 'flame' | 'bone' | 'mirror';
/** A card's home. `neutral` cards belong to no archetype and can be carried by any deck — they are
 *  where most of the traffic between decks actually happens. */
export type CardDeck = DeckId | 'neutral';
export type CardType = 'attack' | 'skill' | 'power' | 'rite';

/**
 * The five shared mechanics. Each archetype produces exactly one of them and consumes another's,
 * which is what makes the decks talk to each other instead of sitting in four sealed boxes:
 *
 *   刃 ──余烬──▶ 焰 ──灼烧──▶ 骨 ──壁垒──▶ 镜 ──映照──▶ 刃
 *
 * 镜 is also the wildcard: it can copy any of the others, so it links to all three.
 */
export type KeywordId = 'ember' | 'edge' | 'rampart' | 'scorch' | 'reflection';
export interface Keyword {
  id: KeywordId; name: string; owner: DeckId;
  /** One line the gallery shows on hover, and that card text is expected to match. */
  rule: string;
}
export const KEYWORDS: Keyword[] = [
  { id: 'ember', name: '余烬', owner: 'blade', rule: '层数，不会自然消退。焰牌消耗它换取爆发，骨牌可以把它烧成格挡。' },
  { id: 'edge', name: '锋锐', owner: 'bone', rule: '每层让你的攻击每次命中 +1 伤害。骨牌在获得格挡时积累，刃牌负责把它花掉。' },
  { id: 'scorch', name: '灼烧', owner: 'flame', rule: '施加在敌人身上。其回合开始时受到等于层数的伤害，然后层数 −1。' },
  { id: 'rampart', name: '壁垒', owner: 'bone', rule: '层数。每层让你在回合开始时保留 1 点格挡，而不是全部清空。' },
  { id: 'reflection', name: '映照', owner: 'mirror', rule: '层数。可以消耗 1 层把打出的牌复制一次，复制品带消耗。' },
];
export const KEYWORD_BY_ID = new Map(KEYWORDS.map(keyword => [keyword.id, keyword]));

export const DECK_IDS: DeckId[] = ['blade', 'flame', 'bone', 'mirror'];

export interface CardDefinition {
  /** `<deck>-<two digits>`, and it must never change once a save can hold it. */
  id: string;
  name: string;
  /** The deck this card belongs to. A card lives in exactly one deck, or in none. */
  deck: CardDeck;
  tier: TierId;
  /** Energy. 0–3; -1 marks a card that cannot be played straight from hand. */
  cost: number;
  type: CardType;
  /** Rules text. Uses the keyword names verbatim so the gallery can link them. */
  text: string;
  keywords: KeywordId[];
  /** Set when the card reaches into another deck's mechanic — the cross-deck link, made explicit. */
  bridge?: DeckId;
  lore: string;
}

export interface DeckEntry { id: string; copies: number }
export interface Deck {
  id: DeckId;
  name: string;
  /** English subtitle for the plate on the card back. */
  subtitle: string;
  blurb: string;
  accent: string;
  /** Total cards carried into a battle, copies included. */
  size: number;
  cards: DeckEntry[];
}

export const TYPE_LABEL: Record<CardType, string> = { attack: '攻击', skill: '技能', power: '能力', rite: '仪式' };
