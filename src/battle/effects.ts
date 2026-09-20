import type { EnemyState, StatusId } from './types';

/**
 * What a card actually does, as code rather than as a sentence. Only the chapter-I unlocked cards
 * have an implementation — the rest of the library is locked and cannot be drawn, so it does not need
 * one yet. Each effect is written to match its printed text exactly; if the two ever disagree, the
 * text is what the player read, so the text wins and the code is the bug.
 */

/** Battle-long modifiers the player's power cards install. */
export interface BattlePowers {
  /** 淬刃: extra damage on the first attack card of each turn. */
  firstAttackBonus: number;
  /** 不动: gained at the start of every turn. */
  turnBlock: number;
  turnRampart: number;
  /** 攒烬: embers gained per attack hit; cleared at end of turn. */
  emberPerHit: number;
}
export const EMPTY_POWERS: BattlePowers = { firstAttackBonus: 0, turnBlock: 0, turnRampart: 0, emberPerHit: 0 };

export interface EffectContext {
  readonly cardId: string;
  /** The player's chosen target, or the first living enemy if none was chosen. */
  target(): EnemyState | undefined;
  living(): EnemyState[];
  /** Deal `amount` to the target, `times` times. */
  hit(amount: number, times?: number): void;
  hitAll(amount: number): void;
  block(amount: number): void;
  /** Removes up to `amount` block from the player. Returns how much was actually removed. */
  spendBlock(amount: number): number;
  gain(status: StatusId, amount: number): void;
  /** Spends up to `amount` stacks. Returns how many were actually spent. */
  spend(status: StatusId, amount: number): number;
  /** Puts `count` stacks of 烙印 on the target. */
  mark(count: number): void;
  draw(count: number): void;
  /** Turns `count` cards in the player's hand into 灰烬. */
  bury(count: number): void;
  /** Moves up to `count` cards from the discard pile into the hand. */
  reclaim(count: number): void;
  gainEnergy(count: number): void;
  loseHp(count: number): void;
  handSize(): number;
  /** How many cards were played before this one this turn — what 连缀 counts. */
  played(): number;
  stacks(status: StatusId): number;
  playerBlock(): number;
  /** 蓄火: whatever energy is left this turn carries into the next, up to 3. */
  bank(): void;
  power: BattlePowers;
}

/** 空明 — the hand is empty. Checked before the card's own draw effects run. */
const empty = (ctx: EffectContext) => ctx.handSize() === 0;
/** 连缀 — this is at least the third card played this turn. */
const chained = (ctx: EffectContext) => ctx.played() >= 2;

export const CARD_EFFECTS: Record<string, (ctx: EffectContext) => void> = {
  // ---- 断罪之刃 ----------------------------------------------------------
  'blade-01': ctx => { ctx.hit(7); },                                   // 割线
  'blade-02': ctx => { ctx.hit(3, 2); },                                // 双刃
  'blade-03': ctx => { ctx.gain('ember', 2); },                         // 拾烬
  'blade-04': ctx => { ctx.block(6); },                                 // 掩刃
  'blade-07': ctx => { if (empty(ctx)) ctx.hit(9); },                   // 循隙
  'blade-08': ctx => { ctx.power.emberPerHit += 1; },                   // 攒烬
  'blade-09': ctx => { ctx.hit(2, chained(ctx) ? 4 : 3); },             // 三叠
  // Spends what it can and pays 6 block a stack, so it is never a dead card in an opening hand.
  'blade-11': ctx => { ctx.block(ctx.spend('edge', 2) * 6); },          // 卸锋
  'blade-14': ctx => { ctx.power.firstAttackBonus += 3; },              // 淬刃
  'blade-18': ctx => { ctx.hit(4); ctx.mark(1); },                      // 刻痕
  'blade-21': ctx => { ctx.block(7); ctx.gain('retaliate', 4); },       // 逆守
  'blade-25': ctx => { ctx.hit(8); ctx.bank(); },                       // 敛刃

  // ---- 长明壁垒 ----------------------------------------------------------
  'bone-01': ctx => { ctx.block(6 + (ctx.stacks('rampart') > 0 ? 3 : 0)); },   // 架盾
  'bone-02': ctx => { ctx.hit(5 + (ctx.playerBlock() > 0 ? 3 : 0)); },         // 骨刺
  'bone-03': ctx => { ctx.gain('rampart', 1); ctx.block(4); },                 // 沉垒
  'bone-04': ctx => { ctx.spendBlock(5); ctx.hit(9); },                        // 楔石
  'bone-06': ctx => { ctx.gain('retaliate', 3); },                             // 骨棘
  // 空明 is read before the reclaim, or it could never be true.
  'bone-07': ctx => { const was = empty(ctx); ctx.reclaim(1); if (was) ctx.draw(1); },  // 拾骨
  'bone-08': ctx => { ctx.block(empty(ctx) ? 14 : 9); },                       // 白骨墙
  'bone-11': ctx => { const spent = ctx.spendBlock(5); if (spent) ctx.gain('edge', Math.max(1, Math.round(spent * 3 / 5))); },  // 砺锋
  'bone-13': ctx => { ctx.hit(4); ctx.mark(1); },                              // 骨钉
  'bone-14': ctx => { ctx.gain('rampart', chained(ctx) ? 4 : 1); },            // 垒壁
  'bone-18': ctx => { ctx.power.turnBlock += 2; ctx.power.turnRampart += 1; }, // 不动
  'bone-20': ctx => { ctx.hitAll(empty(ctx) ? 8 : 4); },                       // 倾墙

  // ---- the junk card enemies put in your deck ----------------------------
  ash: () => { /* 灰烬: nothing, and that is the whole point of it. */ },
};

export function effectFor(cardId: string) {
  return CARD_EFFECTS[cardId];
}
