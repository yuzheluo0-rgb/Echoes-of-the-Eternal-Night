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
  /**
   * Added to every `heal` amount.
   *
   * **The seventh shape, and the note at the top of this file says to think before adding one.** The
   * test that note comes from is whether a delta is "more of a number the card already prints" or "an
   * effect the card would have to grow a new clause for". `heal` is unambiguously the first: 「回复 6
   * 点生命」 is a printed number with no shape able to move it, because the engine had no way for a
   * card to heal at all until 燎原余烬 needed one. The rule's spirit — never invent a clause the delta
   * cannot cash — is intact, so this is the case the note points at rather than the one it warns of.
   */
  heal?: number;
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

  // ------------------------------------------------------------------ 燎原余烬
  'flame-01': { text: '造成 7 点伤害，施加 2 层灼烧。', hit: 3 },                    // 火种
  'flame-02': { text: '获得 9 点格挡。空明：额外获得 4 点格挡。', block: 3 },         // 拾柴
  'flame-03': { text: '爆燃：立刻获得 1 点能量。造成 3 点伤害 2 次。', hit: 1 },      // 引信
  'flame-04': { text: '造成 6 点伤害。若目标已被灼烧，额外造成 4 点伤害。', hit: 3 },  // 舔焰
  // The blood price stays at 4. A polish buys more fire, not a bigger wound — and `loseHp(4)` is
  // hardcoded in the effect, so a text claiming 7 would be the lie this whole file exists to prevent.
  'flame-05': { text: '祭火：失去 4 点生命，对所有敌人施加 3 层灼烧。', status: { scorch: 1 } },  // 献薪
  'flame-06': { text: '获得 3 层余烬。', status: { ember: 1 } },                     // 掩薪
  'flame-07': { text: '反震：本回合内每次被攻击时，对攻击者造成 6 点伤害。', status: { retaliate: 2 } },  // 焦壳
  'flame-08': { text: '消耗 3 层余烬，对所有敌人施加 3 层灼烧。', status: { scorch: 1 } },  // 扬灰
  // 「每层造成 N 点」 is N *per layer*, which the effect expresses as `hit(3, layers)` — so this delta
  // lands once per layer, exactly as the text says, rather than once for the total.
  'flame-09': { text: '引爆：消耗目标身上全部灼烧，每层造成 4 点伤害。', hit: 1 },     // 裂焰
  'flame-12': { text: '获得 6 点格挡。蓄火：本回合未用完的能量保留到下回合。', block: 2 },  // 存薪
  'flame-14': { text: '获得 8 点格挡。拾回：从弃牌堆取回一张牌。', block: 3 },        // 余温
  // Same per-layer arrangement as 裂焰 — the effect blocks once per layer, so `block: 2` is +2 a layer.
  'flame-15': { text: '消耗目标身上至多 4 层灼烧，每层使你获得 5 点格挡。', block: 2 },  // 炭衣

  // ---- boss 解锁，第一部分：燎原余烬 --------------------------------------
  'flame-16': { text: '对所有敌人施加 4 层灼烧。空明：额外施加 3 层。', status: { scorch: 1 } },  // 灰烬雨
  // The blood price stays at 8; a polish buys more damage, not a bigger wound. Same rule as 献薪.
  'flame-19': { text: '祭火：失去 8 点生命。对已被灼烧的目标造成 20 点伤害。焚尽。', hit: 4 },  // 透骨
  'flame-21': { text: '获得 13 点格挡。连缀：若你本回合已打出至少 3 张牌，对所有敌人施加 3 层灼烧。', block: 3 },  // 火墙
  // `power` is added once, to whichever power the card raised — 长明灯 raises 灼烧加成 by 1, so the
  // polished card grants 2 and the text says 2.
  'flame-22': { text: '每当你施加灼烧时，额外施加 2 层灼烧。', power: 1 },           // 长明灯
  'flame-24': { text: '消耗 4 层余烬，造成 15 点伤害并施加 3 层灼烧。焚尽。', hit: 3 },  // 焚炉
  'flame-25': { text: '移除目标身上全部灼烧，每 2 层使你获得 7 点格挡和 1 层壁垒。', block: 2 },  // 骨炭

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

  // ---- 补的四块缺口：燎原余烬 flame-29..40 --------------------------------
  'flame-29': { text: '回复 9 点生命。空明：改为回复 14 点。', heal: 3 },              // 拾灰
  'flame-30': { text: '消耗至多 3 层余烬，每层回复 6 点生命。', heal: 2 },             // 取暖
  'flame-31': { text: '对所有敌人施加 2 层灼烧。每有一个敌人被点燃，你回复 6 点生命。', heal: 2 },  // 炭火
  'flame-32': { text: '对所有敌人造成 8 点伤害，然后施加 1 层灼烧。', hit: 3 },        // 燎原
  'flame-33': { text: '对所有敌人造成 3 点伤害 3 次。连缀：改为 4 次。', hit: 1 },     // 灰烬风暴
  'flame-34': { text: '引爆：消耗所有敌人身上的灼烧，每层对所有敌人造成 3 点伤害。', hit: 1 },  // 余温炸裂
  'flame-35': { text: '引爆：消耗目标身上全部灼烧，每层造成 7 点伤害，然后你失去 2 点生命。', hit: 2 },  // 焦土
  'flame-36': { text: '消耗目标身上全部灼烧，每层造成 6 点伤害。若目标因此死亡，你获得 3 层余烬。', hit: 2 },  // 白热
  'flame-37': { text: '消耗至多 3 层余烬，每层获得 8 点格挡。', block: 3 },             // 添薪
  'flame-38': { text: '消耗你全部余烬，每层造成 4 点伤害。', hit: 1 },                 // 炽白
  'flame-39': { text: '消耗 2 层余烬，抽 3 张牌。', draw: 1 },                        // 引火
  'flame-40': { text: '消耗 2 层余烬，获得 2 点能量，抽 2 张牌。', draw: 1 },          // 薪尽

  // ---- boss 解锁，第二部分：长明阶 ----------------------------------------
  // 万刃's two 3s both move, because the effect is `hit(3, times)` — one delta, applied to every swing.
  'blade-22': { text: '造成 4 点伤害。连缀：本回合你每打出过 1 张牌，就再造成 4 点伤害。', hit: 1 },  // 万刃
  'blade-28': { text: '消耗你全部锋锐，每层使这张牌多命中 1 次。造成 4 点伤害 3 次。', hit: 1 },    // 千刃
  'bone-23': { text: '造成 4 点伤害，重复 4 次。你每有 4 层壁垒，额外重复 1 次，最多 2 次。', hit: 1 },  // 崩城
  // 「3 倍」 is three hits of the same number, so one point of polish makes it four hits — which is
  // what 「4 倍」 says.
  'bone-27': { text: '消耗你所有的格挡，造成 4 倍于此数值的伤害。焚尽。', hit: 1 },     // 天倾

  // ------------------------------------------------------ 明焰阶 · 击破守望者后解锁
  // These are reachable once the boss is down (`cardUnlocks.ts`), so they need rows here for the same
  // reason the starting pool does — a card the campfire offers and then does nothing to is invisible
  // rather than broken, which is the worst way for a bug to look.
  'blade-16': { text: '造成 8 点伤害。目标每失去 10% 生命，这张牌就多造成 2 点伤害。', hit: 2 },   // 断罪
  'blade-17': { text: '对所有敌人造成 6 点伤害 2 次，每命中一个敌人你获得 1 层余烬。', hit: 2 },   // 刃雨
  'blade-19': { text: '造成 10 点伤害。消耗至多 3 层锋锐，每层额外造成 4 点伤害。', hit: 3 },      // 裂甲
  'blade-20': { text: '造成 8 点伤害。引爆：消耗目标身上全部灼烧，每层使你获得 1 层余烬。', hit: 3 }, // 借焰
  // 回震 is the one card in the chapter whose text prints **no numbers at all** — it deals 「等同于你
  // 当前格挡」. There is no printed number to move, so the only polish the player can see is one that
  // adds one, and `hit` is exactly the delta that produces it.
  'bone-16': { text: '造成等同于你当前格挡的伤害，再额外造成 3 点。', hit: 3 },                  // 回震
  'bone-17': { text: '获得 8 点格挡，获得 1 层映照。回响：将这张牌的一个弱化复制品加入手牌。', block: 3 }, // 照壁
  'bone-19': { text: '获得 9 点格挡，并获得等同于目标灼烧层数的格挡。', block: 3 },              // 炭墙
  'bone-21': { text: '蓄火：本回合未用完的能量保留到下回合。获得 2 层壁垒。', status: { rampart: 1 } }, // 封炉
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
