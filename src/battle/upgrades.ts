/**
 * 打磨 — what a card becomes after the campfire.
 *
 * An upgrade is **the same card with bigger numbers**, not a different card. That is the whole design
 * decision here, and it is what keeps this file to twenty-six short rows instead of twenty-six new
 * effect functions: `effects.ts` writes each card's behaviour once, and an upgrade is a set of deltas
 * the engine folds in while it runs that behaviour.
 *
 * The deltas are deliberately four shapes and no more — `hit`, `block`, `draw`/`reclaim`, and
 * `status`/`power`. A card whose upgrade would need a fifth shape is a card whose upgrade should be a
 * different card, and none of chapter I's are.
 *
 * **The `text` here must match what the deltas actually do.** It is printed on the card; when the two
 * disagree the text is what the player read, so the text wins and this file is the bug.
 */

import type { StatusId } from './types.ts';

export interface Upgrade {
  /** The card's rules text once upgraded. */
  text: string;
  /** Added to every `hit` amount. Applies per hit, so a 2-hit card gains it twice. */
  hit?: number;
  /** Added to every `block` amount. */
  block?: number;
  /** Added to every `draw` count. */
  draw?: number;
  /** Added to every `reclaim` count. */
  reclaim?: number;
  /** Added to a specific status whenever the card grants it. */
  status?: Partial<Record<StatusId, number>>;
  /** Added to whatever battle-power the card installs, once. */
  power?: number;
}

/**
 * Chapter I's upgradable cards, by id.
 *
 * Only the cards a chapter-I run can actually hold are here — the rest of the library is locked, and
 * an upgrade for a card nobody can draw is an upgrade nobody can test. `upgrades.test.ts` holds the
 * two lists against each other so adding a card to the chapter without an upgrade is caught.
 */
export const UPGRADES: Record<string, Upgrade> = {
  // ------------------------------------------------------------------ 断罪之刃
  'blade-01': { text: '造成 10 点伤害。', hit: 3 },                                  // 割线
  'blade-02': { text: '造成 4 点伤害 2 次。', hit: 1 },                              // 双刃
  'blade-03': { text: '获得 3 层余烬。', status: { ember: 1 } },                     // 拾烬
  'blade-04': { text: '获得 9 点格挡。', block: 3 },                                 // 掩刃
  'blade-07': { text: '空明：若你的手牌为空，造成 13 点伤害。', hit: 4 },              // 循隙
  'blade-08': { text: '本回合内，你每次攻击命中时获得 2 层余烬。', power: 1 },         // 攒烬
  // 三叠's second number is a hit *count*, not an amount, so only the first one moves.
  'blade-09': { text: '造成 3 点伤害 3 次。连缀：本回合第 3 张牌起改为 4 次。', hit: 1 },
  'blade-11': { text: '消耗 2 层锋锐，获得 16 点格挡。', block: 4 },                  // 卸锋
  'blade-14': { text: '每回合你首次打出攻击牌时，它额外造成 5 点伤害，你获得 1 层余烬。', power: 2 },
  'blade-18': { text: '造成 7 点伤害并烙印目标：你对被烙印的敌人造成的伤害 +3。', hit: 3 },   // 刻痕
  'blade-21': { text: '获得 10 点格挡。反震：本回合内每次被攻击时，对攻击者造成 4 点伤害。', block: 3 },
  'blade-25': { text: '造成 11 点伤害。蓄火：本回合未用完的能量保留到下回合。', hit: 3 },      // 敛刃

  // ------------------------------------------------------------------ 长明壁垒
  'bone-01': { text: '获得 9 点格挡。若你拥有壁垒，额外获得 3 点格挡。', block: 3 },   // 架盾
  'bone-02': { text: '造成 8 点伤害。若你当前有格挡，额外造成 3 点伤害。', hit: 3 },   // 骨刺
  'bone-03': { text: '获得 1 层壁垒和 7 点格挡。', block: 3 },                       // 沉垒
  'bone-04': { text: '失去 5 点格挡，造成 12 点伤害。', hit: 3 },                    // 楔石
  // The only upgrade here that moves a *count* rather than an amount.
  'bone-05': { text: '流转：抽 2 张牌，然后弃 1 张牌。', draw: 1 },                   // 砺石
  'bone-06': { text: '反震：本回合内每次被攻击时，对攻击者造成 5 点伤害。', status: { retaliate: 2 } },
  'bone-07': { text: '拾回：从弃牌堆取回 2 张牌。空明：额外抽 1 张牌。', reclaim: 1 },  // 拾骨
  'bone-08': { text: '获得 13 点格挡。空明：改为获得 18 点格挡。', block: 4 },         // 白骨墙
  'bone-09': { text: '祭火：失去 5 点生命，获得 16 点格挡和 1 层壁垒。', block: 4 },   // 殉道
  'bone-11': { text: '消耗 5 点格挡，获得 4 层锋锐。', status: { edge: 1 } },          // 砺锋
  'bone-13': { text: '造成 7 点伤害。烙印：被标记的敌人受到你的攻击时额外受到 3 点伤害。', hit: 3 },  // 骨钉
  'bone-14': { text: '获得 2 层壁垒。连缀：若你本回合已打出至少 3 张牌，改为获得 5 层壁垒。', status: { rampart: 1 } },
  'bone-18': { text: '每回合开始时获得 3 点格挡和 1 层壁垒。', power: 1 },            // 不动
  'bone-20': { text: '对所有敌人造成 6 点伤害。空明：改为造成 10 点伤害。', hit: 2 },  // 倾墙
};

export const EMPTY_UPGRADE: Upgrade = { text: '' };

export function upgradeFor(cardId: string, upgraded: boolean | undefined): Upgrade | undefined {
  return upgraded ? UPGRADES[cardId] : undefined;
}
export function isUpgradable(cardId: string): boolean {
  return cardId in UPGRADES;
}
/** What the card would read as once polished. Used by the campfire's picker. */
export function upgradedText(cardId: string, baseText: string): string {
  return UPGRADES[cardId]?.text ?? baseText;
}
