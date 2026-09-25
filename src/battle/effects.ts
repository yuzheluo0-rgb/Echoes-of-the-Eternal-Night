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
  /** 长明灯: extra 灼烧 on every burn the player applies. Read by `burn` / `burnAll`. */
  scorchBonus: number;
}
export const EMPTY_POWERS: BattlePowers = {
  firstAttackBonus: 0, turnBlock: 0, turnRampart: 0, emberPerHit: 0, scorchBonus: 0,
};

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
  /**
   * Puts `count` stacks of 灼烧 on the target — the mirror of `mark`, which is hardcoded to 烙印.
   *
   * ⚠️ **`gain()` cannot do this.** It writes `s.player.statuses`, and 灼烧 is a status that only
   * ever lives on an *enemy*: it ticks at the start of their turn and falls off. Until this existed
   * there was no way for any card to apply it, which is why 燎原余烬 had no implemented cards at all —
   * the half that ticks had been in the engine since the beginning, and the half that lights it never
   * had a door.
   */
  burn(count: number): void;
  /** 灼烧 on every living enemy. */
  burnAll(count: number): void;
  /**
   * 爆燃 — energy now, against the same amount drained from the **next** turn.
   *
   * No state of its own: `drained` is already read and cleared at the top of `beginTurn`, which is
   * exactly 「下回合相应减少」, and the turn log has printed （枯竭 −N） since the first enemy used it.
   */
  flare(count: number): void;
  /** Consumes up to `max` of the target's `status`, returning how many were actually taken. */
  spendEnemyStatus(status: StatusId, max: number): number;
  /**
   * Wipes `status` off **every** living enemy and returns the total taken.
   *
   * The field-wide twin of `clearEnemyStatus`, and it exists for the same reason `burnAll` does: a
   * card that detonates the whole board has to read every stack before any of them are cleared, and
   * `clearEnemyStatus` only ever speaks about the chosen target.
   */
  clearAllEnemyStatus(status: StatusId): number;
  /**
   * 回复生命, capped at the player's ceiling.
   *
   * ⚠️ The engine had **no way for a card to heal at all** until 燎原余烬 needed one, and the card
   * layer already carried a `heal` pattern that no card had ever used. That was survivable while the
   * only healing in the game was the between-fights roll — and it stopped being survivable the moment
   * a deck started paying for its own cards in 生命 (献薪 −4, 透骨 −8, and now 爆燃).
   */
  heal(count: number): void;
  draw(count: number): void;
  /** Turns `count` cards in the player's hand into 灰烬. */
  bury(count: number): void;
  /** Moves up to `count` cards from the discard pile into the hand. */
  reclaim(count: number): void;
  /**
   * 回响 — conjures a named card straight into the hand, out of `OFF_DECK_CARDS` in the engine.
   *
   * Takes an **id that is not the calling card's own**. A copy that carried 回响 would make another
   * copy on the way out; see `残壁` in `engine.ts`. Only off-deck ids are accepted, so a typo cannot
   * quietly turn this into "add any card in the library".
   */
  addToHand(cardId: string): void;
  gainEnergy(count: number): void;
  loseHp(count: number): void;
  handSize(): number;
  /** How many cards were played before this one this turn — what 连缀 counts. */
  played(): number;
  /** The player's own stacks. */
  stacks(status: StatusId): number;
  /**
   * The **target's** stacks of a status.
   *
   * 灼烧 lives on the enemy and `stacks()` only ever reads the player, so a card that scales off
   * 「目标身上有多少层灼烧」 had no way to ask. Two of the 明焰阶 cards do exactly that (借焰, 炭墙),
   * and the alternative — reaching into `target().statuses` from the effect table — would write past
   * the log and put status plumbing in the data layer.
   */
  enemyStacks(status: StatusId): number;
  /**
   * Wipes the target's stacks and **returns how many there were**, so a consume-and-convert card can
   * be one call rather than a read that a dying target can invalidate between the two halves.
   */
  clearEnemyStatus(status: StatusId): number;
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

  // ---- 燎原余烬 ----------------------------------------------------------
  // The burn half of the cross-deck cycle: 刃 攒余烬 → 焰 把它烧成灼烧 → 骨 再把灼烧和格挡变成壁垒.
  // Seven of these are 残烬 (three copies each), which is what makes the deck actually deal damage —
  // the complaint that started this was 「拿到手里没得打」, and it was arithmetic: 断罪之刃 opened with
  // six attack cards out of twenty-two, and nothing else in the chapter applied 灼烧 at all.

  // 火种 — damage *and* the burn that every other card in the deck reads. Burn first: a lethal 4 would
  // move `currentTarget` between the two halves and light the wrong enemy on fire.
  'flame-01': ctx => { ctx.burn(2); ctx.hit(4); },
  // 拾柴 — 空明 is read before anything else happens, which is the whole card.
  'flame-02': ctx => { ctx.block(6 + (empty(ctx) ? 4 : 0)); },
  // 引信 — a free hit that pays for itself out of the next turn. Playable at 0 energy from an empty
  // board, which is exactly the 「手里有牌打不出去」 case.
  'flame-03': ctx => { ctx.flare(1); ctx.hit(2, 2); },
  // 舔焰 — the first payoff for having lit something: 4 damage becomes 8.
  'flame-04': ctx => { ctx.hit(3 + (ctx.enemyStacks('scorch') > 0 ? 4 : 0)); },
  // 献薪 — 祭火 is the deck's other currency. Life now for fire on everything.
  'flame-05': ctx => { ctx.loseHp(4); ctx.burnAll(2); },
  'flame-06': ctx => { ctx.gain('ember', 2); },                          // 掩薪
  'flame-07': ctx => { ctx.gain('retaliate', 4); },                      // 焦壳
  // 扬灰 — 刃's 余烬 spent into 焰's fire, and it lands on the whole field. `spend` takes what is
  // there rather than failing, the same way 楔石 spends up to 5 block and always swings.
  'flame-08': ctx => { ctx.spend('ember', 3); ctx.burnAll(2); },
  // 裂焰 — the payoff. **One hit per layer**, not one hit for the total, so a polish that adds 1 to
  // the card's damage adds it per layer — which is what 「每层造成 3 点伤害」 prints, and which a single
  // `hit(layers * 3)` could not express.
  'flame-09': ctx => { ctx.hit(3, ctx.clearEnemyStatus('scorch')); },
  // 存薪 — 蓄火 is the deck's answer to 引信's debt and to a slow opening.
  'flame-12': ctx => { ctx.block(4); ctx.bank(); },
  // 余温 — the grind card: a wall that hands a card back, so the deck does not stall.
  'flame-14': ctx => { ctx.block(5); ctx.reclaim(1); },
  // 炭衣 — the 焰 → 骨 link, and the only card in the chapter that turns fire into a wall. Block is
  // granted per layer rather than in one sum for the same reason 裂焰 strikes per layer: it is what
  // the printed text says, and what makes `block: 2` mean +2 *a layer* when polished.
  'flame-15': ctx => {
    const layers = ctx.spendEnemyStatus('scorch', 4);
    for (let i = 0; i < layers; i++) ctx.block(3);
  },

  // ---- flame 的 boss 解锁：六张，主题是「灼烧不再只是掉血」 -------------------
  // 「对所有敌人」 and 空明 read the field before anything is applied, so the 空明 branch is measured
  // against the hand the player actually has, not the one they are about to draw into.
  'flame-16': ctx => { ctx.burnAll(3 + (empty(ctx) ? 2 : 0)); },              // 灰烬雨
  // 透骨 — the deck's 祭火 card: 8 life for 16, and only against something already alight. Played on
  // a cold target it pays the blood and does nothing, which the card does not warn about; that is
  // the printed text, and the printed text wins.
  'flame-19': ctx => { ctx.loseHp(8); if (ctx.enemyStacks('scorch') > 0) ctx.hit(16); },  // 透骨
  'flame-21': ctx => { ctx.block(10); if (chained(ctx)) ctx.burnAll(3); },    // 火墙
  'flame-22': ctx => { ctx.power.scorchBonus += 1; },                         // 长明灯
  'flame-24': ctx => { ctx.spend('ember', 4); ctx.hit(12); ctx.burn(3); },    // 焚炉
  // 骨炭 — 焰 → 骨 in one card. Blocked **once per unit** rather than in one sum, so the polished
  // 「每 2 层使你获得 7 点格挡」 is true per unit rather than once for the whole card.
  'flame-25': ctx => {
    const units = Math.floor(ctx.clearEnemyStatus('scorch') / 2);
    for (let i = 0; i < units; i++) ctx.block(5);
    if (units) ctx.gain('rampart', units);
  },

  // ---- 补的四块缺口（flame-29..40）---------------------------------------
  // Two rules hold across all twelve, and both are about making the *polish* honest:
  //
  //   1. 「每层造成 N 点」 is written `hit(N, layers)`, never `hit(layers * N)`. One delta then lands
  //      on every layer — which is what the printed text says — where a computed total would only
  //      ever move once.
  //   2. 「每层使你获得 N 点」 is a loop for the same reason, one `block` / `heal` per layer.
  'flame-29': ctx => { ctx.heal(empty(ctx) ? 11 : 6); },                       // 拾灰
  'flame-30': ctx => {                                                          // 取暖
    const layers = ctx.spend('ember', 3);
    for (let i = 0; i < layers; i++) ctx.heal(4);
  },
  // 炭火 — the heal counts the enemies the burn *landed on*, measured before `burnAll` so a kill
  // cannot shrink the number the player was promised.
  'flame-31': ctx => {
    const lit = ctx.living().length;
    ctx.burnAll(2);
    for (let i = 0; i < lit; i++) ctx.heal(4);
  },
  'flame-32': ctx => { ctx.hitAll(5); ctx.burnAll(1); },                       // 燎原
  // 灰烬风暴 — one `hitAll` per repetition rather than a `times` argument, because `hitAll` has none.
  'flame-33': ctx => {
    const times = chained(ctx) ? 4 : 3;
    for (let i = 0; i < times; i++) ctx.hitAll(2);
  },
  // 余温炸裂 — every stack on the field is consumed *first*, then the whole field takes 2 a layer.
  // Read-then-hit would have let the first enemy's detonation kill it and move the target.
  'flame-34': ctx => {
    const layers = ctx.clearAllEnemyStatus('scorch');
    for (let i = 0; i < layers; i++) ctx.hitAll(2);
  },
  // 焦土 — 5 a layer and 2 of your own life for the privilege. The damage is per layer, the blood is
  // a flat toll, so a polish moves the first and not the second.
  'flame-35': ctx => { ctx.hit(5, ctx.clearEnemyStatus('scorch')); ctx.loseHp(2); },
  // 白热 — the only card in the deck that turns a kill back into fuel. `living()` filters on `hp > 0`,
  // so it reflects the kill immediately even though `settle` has not run yet.
  'flame-36': ctx => {
    const before = ctx.living().length;
    ctx.hit(4, ctx.clearEnemyStatus('scorch'));
    if (ctx.living().length < before) ctx.gain('ember', 3);
  },
  'flame-37': ctx => {                                                          // 添薪
    const layers = ctx.spend('ember', 3);
    for (let i = 0; i < layers; i++) ctx.block(5);
  },
  'flame-38': ctx => { ctx.hit(3, ctx.spend('ember', 999)); },                 // 炽白
  // 引火 and 薪尽 charge their 余烬 **in full**, and the wording is what decides it. 「消耗 2 层余烬」
  // is a price; 「消耗至多 3 层余烬」 and 「消耗你全部余烬」 are the other thing — pay what you have —
  // which is what 添薪 / 炽白 / 取暖 print and how they behave. A 0-cost card that pays its cost
  // *optionally* is not a card with a cost; it is free draw.
  'flame-39': ctx => { if (ctx.spend('ember', 2) === 2) ctx.draw(2); },         // 引火
  'flame-40': ctx => {                                                          // 薪尽
    if (ctx.spend('ember', 2) !== 2) return;
    ctx.gainEnergy(2);
    ctx.draw(1);
  },

  // ---- blade 的 boss 解锁：两张 ------------------------------------------
  // 万刃 — 连缀 with no cap: one hit for the card, one for every card played before it this turn.
  // Expressed as `hit(3, times)` rather than a computed total, which is what makes a polish add its
  // point to *every* swing instead of once at the end.
  'blade-22': ctx => { ctx.hit(3, 1 + ctx.played()); },
  // 千刃 — 锋锐 spent for *hits* rather than for damage, which is the one thing the resource had
  // never been spent on. Spending first is what makes that true: the stacks are gone before the
  // first 3 lands, so the card does not also get the +1-per-layer they would have given it.
  'blade-28': ctx => { ctx.hit(3, 3 + ctx.spend('edge', 999)); },

  // ---- bone 的 boss 解锁：两张 -------------------------------------------
  'bone-23': ctx => { ctx.hit(3, 4 + Math.min(2, Math.floor(ctx.stacks('rampart') / 4))); },  // 崩城
  // 天倾 — the whole wall, thrown. `spendBlock` returns what was actually there, so an empty wall is
  // a card that does nothing rather than a crash, and 「3 倍」 is three hits of the same number.
  'bone-27': ctx => { ctx.hit(3, ctx.spendBlock(ctx.playerBlock())); },

  // ---- 明焰阶 · 击破守望者后解锁 -----------------------------------------
  // Seven of these read state that already existed; 照壁 is the one that needed a new primitive.

  // 断罪 — a finisher that pays more the closer the target is to dead, so it is worth holding. Counted
  // in whole tenths of the target's *maximum*, and by subtraction rather than as `1 - hp/maxHp`,
  // because a target at exactly 90% has lost one tenth and `0.1 * 10` is 0.9999999999999999 in
  // floating point — the card would quietly deal 6 where it prints 8.
  'blade-16': ctx => {
    const target = ctx.target();
    const lost = target ? Math.floor(Math.max(0, target.maxHp - target.hp) * 10 / target.maxHp) : 0;
    ctx.hit(6 + lost * 2);
  },
  // 刃雨 — two swings across the field, and the 余烬 is 「每命中一个敌人」, so it counts what each
  // swing actually touched. Sampled around its own `hitAll` rather than once up front: an enemy that
  // dies to the first swing is not hit by the second, and must not be paid for twice.
  'blade-17': ctx => {
    const first = ctx.living().length;
    ctx.hitAll(4);
    const second = ctx.living().length;
    ctx.hitAll(4);
    ctx.gain('ember', first + second);
  },
  // 裂甲 — `spend` returns what was actually there, so played with no 锋锐 it is simply a 7.
  'blade-19': ctx => { ctx.hit(7 + ctx.spend('edge', 3) * 4); },
  // 借焰 — detonates *before* it strikes. The other order would let a lethal 5 move `currentTarget`
  // between the two halves and burn the scorch off whichever enemy stepped up; consuming first makes
  // the halves independent and is what 「消耗目标身上全部灼烧」 describes anyway.
  'blade-20': ctx => {
    const burned = ctx.clearEnemyStatus('scorch');
    ctx.hit(5);
    if (burned) ctx.gain('ember', burned);
  },
  // 回震 — damage equal to the wall you are standing behind. It reads the block, it does not spend it.
  'bone-16': ctx => { ctx.hit(ctx.playerBlock()); },
  // 照壁 — the wall, a point of 映照, and the echo. `echo-01` is 残壁, the token in `OFF_DECK_CARDS`;
  // it carries no 回响 of its own, which is what stops the chain.
  'bone-17': ctx => { ctx.block(5); ctx.gain('reflection', 1); ctx.addToHand('echo-01'); },
  // 炭墙 — the wall grows with the fire already on the target.
  'bone-19': ctx => { ctx.block(6 + ctx.enemyStacks('scorch')); },
  // 封炉 — bank the unspent energy and start holding block between turns.
  'bone-21': ctx => { ctx.bank(); ctx.gain('rampart', 1); },

  // ---- the echo 照壁 leaves in your hand ---------------------------------
  'echo-01': ctx => { ctx.block(3); },

  // ---- the junk card enemies put in your deck ----------------------------
  ash: () => { /* 灰烬: nothing, and that is the whole point of it. */ },
};

export function effectFor(cardId: string) {
  return CARD_EFFECTS[cardId];
}
