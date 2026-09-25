/**
 * What a prop actually does.
 *
 * Same split as the cards and the relics: `src/props/props.ts` is the **data** (name, kind, the
 * printed effect, how many charges) and this file is the **behaviour**. Nothing here imports the
 * engine — the engine hands each effect a `PropContext` to act through, which keeps the dependency
 * one-way (`engine → props`).
 *
 * ## Three shapes, because props do not all land in the same place
 *
 *   - **`PROP_EFFECTS`** — combat props. They run through `useProp` and can only touch this fight.
 *   - **`RUN_PROPS`** — props that change what you are *carrying*: the deck, 生命上限, the relics.
 *     They are **descriptors, not functions**, because they are applied by `run.ts`, which owns
 *     those fields. Keeping them as data is what makes "which props edit the deck" a question a
 *     test can answer instead of a question you answer by reading.
 *   - Nothing else. There are no triggers and no modifiers: a prop never fires on its own and the
 *     engine never asks it for a number. It is always the player spending something.
 *
 * **The numbers here MUST match the text printed on the icon.** When the two disagree it is the text
 * the player read, so the text wins and this file is the bug. That rule is why `props.test.ts` can
 * be written against one fixed script: a prop whose effect silently does nothing is a blank prop.
 *
 * ## Why the context is a wishlist
 *
 * Every effect asks for what it wants (`ctx.heal(12)`) instead of reaching into the battle state.
 * The state is `structuredClone`d at every entry point, so a context that held a reference would be
 * stale after the first call; building it fresh per use is the same reason `relics` holds ids.
 */

import type { EnemyState, LogLine, PlayerState, StatusId } from './types.ts';

/**
 * The abilities a prop effect may use.
 *
 * Deliberately wider than `RelicContext` in one direction (props attack — relics never do) and
 * narrower in another (a prop has no slot, no 淬炼, no `v`/`n`, because a prop is never refined).
 */
export interface PropContext {
  turn: number;
  hpFraction: number;
  player: PlayerState;
  handSize: number;
  enemies: EnemyState[];
  /** 玩家为这次使用做出的选择：需要目标的道具用 `target`，需要挑手牌的用 `picked`。 */
  target?: EnemyState;
  /** `pick` 道具挑中的手牌 uid，按手牌顺序。引擎已经校验过它们真的在手上。 */
  picked: string[];
  count: (key: string) => number;
  bump: (key: string, by?: number) => void;
  /** 取遭遇流，**绝不碰 `rng`**——花掉洗牌流会重排牌堆。 */
  roll: () => number;
  log: (text: string, tone?: LogLine['tone']) => void;
  status: (who: 'player' | 'enemies', status: StatusId, amount: number) => void;
  statusOn: (enemy: EnemyState | undefined, status: StatusId, amount: number) => void;
  block: (amount: number) => void;
  energy: (amount: number) => void;
  draw: (count: number) => void;
  heal: (amount: number) => void;
  loseHp: (amount: number) => void;
  reclaim: (count: number) => void;
  /** 抽牌堆里最靠前的那张该类型的牌，进手。 */
  tutor: (kind: 'attack' | 'skill' | 'power') => void;
  /** 手牌里随机弃 `count` 张。 */
  discardRandom: (count: number) => void;
  /** 整手牌全弃，返回弃掉几张。 */
  discardHand: () => number;
  /** 弃掉手牌里**不属于** `keep` 这一类的那几张，返回弃掉几张。 */
  discardWhere: (keep: 'attack') => number;
  /**
   * 让手牌里随机 `count` 张本场战斗内变便宜 `by`，不低于 `floor`。
   *
   * ⚠️ 签名**必须和 `RelicContext` 的那一条逐字相同**：许愿清单是两边共用的一个实现，
   * 第三个参数在这里多一个形态，`wishlist()` 就摊不平了（铅指套要「全部手牌」，走 `handSize`）。
   */
  cheapenHand: (count: number, by: number, floor?: number) => void;
  copyHand: (count: number, extra?: number) => void;
  /** 给这几张手牌盖上打磨章（本场战斗内视为已打磨）。 */
  upgradeHand: (uids: string[]) => void;
  /** 抽牌堆顶 `count` 张是什么（名字与费用），不抽它们。 */
  peekDraw: (count: number) => { uid: string; name: string; cost: number }[];
  /** 把抽牌堆里指定的一张拿进手，其余 `drop` 张进弃牌堆。 */
  takeFromDraw: (uid: string, drop: number) => void;
  /** 读一个敌人身上某个状态的层数。 */
  stacks: (enemy: EnemyState | undefined, status: StatusId) => number;
  /** 消耗掉一个敌人身上该状态的全部层数，返回消耗掉几层。 */
  spend: (enemy: EnemyState | undefined, status: StatusId) => number;
  /** 把玩家当前的格挡全部拿走并返回它（碎盾用：墙拆下来砸人，拆完就没有墙了）。 */
  takeBlock: () => number;
  /** 让一个敌人下次不行动。 */
  freeze: (enemy: EnemyState | undefined) => void;
  /** 清空一个敌人的格挡，返回清掉多少。 */
  clearBlock: (enemy: EnemyState | undefined) => number;
  /** 把一个敌人的意图换成「什么都不做」。 */
  idle: (enemy: EnemyState | undefined) => void;
  /** 对**一个**敌人造成伤害。走引擎那条唯一的攻击漏斗，所以特效、反震、亡语全都在。 */
  strike: (enemy: EnemyState | undefined, amount: number) => void;
  /** 本场战斗内，下一次致死伤害留 1 点生命。 */
  deathWard: () => void;
  /** 把这一格换成另一件道具（未拆的信）。次数重置为新道具的满次数。 */
  replaceWith: (id: string) => void;
  /**
   * 一个敌人的显示名。
   *
   * `EnemyState` 上**没有**名字字段（名字来自定义、要过异变前缀），所以日志里要写「霜钉钉住了
   * 影狼」就只能问引擎。道具的日志比遗物更需要它——遗物很少点名，而控制类道具几乎每一句都点名。
   */
  nameOf: (enemy: EnemyState | undefined) => string;
  /**
   * 可以被开出来的道具 id。
   *
   * 由引擎递进来而不是在这里 import 数据层：这个文件**不 import `src/props/props.ts`**，
   * 否则「行为层不依赖数据层」这条就断了（`effects.ts` 与 `relics.ts` 都守着它）。
   */
  letterPool: string[];
}

export type PropHandler = (ctx: PropContext) => void;

/**
 * 战斗内道具的效果。**每件 `use: 'battle'` 或 `use: 'anywhere'` 的道具都必须在这里有一条**，
 * 否则它在战斗里点了没反应——`props.test.ts` 拿 `IMPLEMENTED_PROPS` 反向查这一点。
 */
export const PROP_EFFECTS: Record<string, PropHandler> = {
  // ------------------------------------------------------------------ 转化
  'blood-tap': ctx => {
    ctx.loseHp(6);
    if (ctx.player.hp > 0) ctx.energy(3);
  },
  'shield-splinter': ctx => {
    const wall = ctx.takeBlock();
    if (!ctx.target) return;
    if (wall <= 0) { ctx.log('你身上没有墙可以拆。', 'neutral'); return; }
    ctx.log(`你把 ${wall} 点格挡拆下来砸了出去。`, 'good');
    ctx.strike(ctx.target, wall);
  },
  'ember-scale': ctx => {
    // 余烬不会自己消退，所以「全部余烬」是一个玩家攒出来的决定，而不是一次结算。
    const ember = ctx.player.statuses.ember ?? 0;
    if (ember <= 0) { ctx.log('秤盘是空的。', 'neutral'); return; }
    // 负数是合法的：`gainStatus` 会把它钳到 0，所以「倒掉全部余烬」不用另开一个入口。
    ctx.status('player', 'ember', -ember);
    const cards = Math.floor(ember / 2);
    ctx.log(`烬秤烧掉 ${ember} 层余烬，换来 ${cards} 张牌。`, 'good');
    ctx.draw(cards);
  },
  'scorch-salve': ctx => {
    const burnt = ctx.spend(ctx.target, 'scorch');
    if (burnt <= 0) { ctx.log('它身上没有火可以抹。', 'neutral'); return; }
    ctx.heal(burnt);
  },

  // ------------------------------------------------------------------ 手牌
  'whetstone-kit': ctx => {
    if (!ctx.picked.length) { ctx.log('没有选中任何一张牌。', 'neutral'); return; }
    ctx.upgradeHand(ctx.picked);
    ctx.log(`磨石匣把 ${ctx.picked.length} 张牌磨快了。`, 'good');
  },
  'blank-slip': ctx => {
    const dropped = ctx.discardHand();
    ctx.log(`你把手里的 ${dropped} 张牌都放了回去。`, 'neutral');
    ctx.draw(dropped);
  },
  'twin-needle': ctx => {
    ctx.copyHand(1);
    ctx.log('手牌里多了一张一样的。', 'good');
  },
  'lead-thimble': ctx => {
    ctx.cheapenHand(ctx.handSize, 99);
    ctx.log('这一回合，手里什么都不值钱了。', 'good');
  },
  'index-card': ctx => {
    ctx.tutor('skill');
    ctx.log('你从牌堆里翻出一张技能牌。', 'good');
  },
  'iron-comb': ctx => {
    const combed = ctx.discardWhere('attack');
    if (!combed) { ctx.log('手上没有软的可以梳掉。', 'neutral'); return; }
    ctx.log(`铁梳刮掉 ${combed} 张，又补了 ${combed} 张。`, 'neutral');
    ctx.draw(combed);
  },

  // ------------------------------------------------------------------ 能量
  'ember-draught': ctx => ctx.energy(2),
  'tailwind-flag': ctx => {
    // 先给后欠：这是这一档里唯一「现在赚、下回合还」的东西，也是它和烬饮的区别所在。
    ctx.energy(3);
    ctx.status('player', 'drained', 2);
    ctx.log('风是借来的，下回合要还。', 'neutral');
  },
  'slow-coal': ctx => {
    // 蓄火是既有的机制：下回合开始折成能量（上限 3）。所以这件道具不用「结束回合」也能成立，
    // 而它的风险是真实的——你得活到下个回合才拿得到。
    ctx.status('player', 'bank', 3);
    ctx.log('慢煤压进炉底。它会在下个回合烧起来。', 'neutral');
  },

  // ------------------------------------------------------------------ 控制
  'frost-nail': ctx => {
    ctx.freeze(ctx.target);
    ctx.log(`霜钉钉住了 ${ctx.nameOf(ctx.target)}。`, 'good');
  },
  'rust-knife': ctx => {
    if (!ctx.target) return;
    const stripped = ctx.clearBlock(ctx.target);
    ctx.statusOn(ctx.target, 'mark', 3);
    ctx.log(stripped > 0 ? `锈刀刮掉 ${stripped} 点格挡，留下 3 层烙印。` : '锈刀留下了 3 层烙印。', 'good');
  },
  'brass-whistle': ctx => {
    if (!ctx.target) return;
    ctx.idle(ctx.target);
    ctx.statusOn(ctx.target, 'strength', 4);
    ctx.log('哨声让它停了一拍，也让它更用力。', 'neutral');
  },
  'binding-cord': ctx => {
    ctx.status('enemies', 'mark', 2);
  },

  // ------------------------------------------------------------------ 生存
  'staunch-moss': ctx => ctx.heal(12),
  'wall-seed': ctx => ctx.block(14),
  'stub-candle': ctx => {
    ctx.deathWard();
    ctx.log('残烛点上了。灭之前，它替你挡一次。', 'good');
  },

  // ------------------------------------------------------------------ 状态
  'cinder-flask': ctx => ctx.status('enemies', 'scorch', 6),
  'ember-heart': ctx => ctx.status('player', 'ember', 12),
  'grindstone-dust': ctx => ctx.status('player', 'edge', 5),
  'bastion-shard': ctx => {
    ctx.status('player', 'rampart', 8);
    // 反震只活一个完整回合（`beginTurn` 开头会清掉），所以这一条是「它这回合敢打你就要付钱」。
    ctx.status('player', 'retaliate', 3);
  },

  // ------------------------------------------------------------------ 赌
  'sealed-letter': ctx => {
    // 开出什么都可能，包括把这一格换成同一件信——那正好是「没拆出东西」的手感。
    // 用 `count`/`bump` 挪一格而不是用 `roll()` 的结果直接取模：`roll()` 每次都不一样，
    // 连着开两封信会开出两件不同的东西，那是对的；但池子只有一件时它必须仍然是那一件。
    const offset = ctx.count('letters');
    ctx.bump('letters');
    ctx.replaceWith(pickLetter(ctx, ctx.roll(), offset));
    ctx.log('封泥裂开了。', 'special');
  },
  'bone-dice': ctx => {
    const pip = 1 + Math.floor(ctx.roll() * 6);
    ctx.energy(pip);
    ctx.log(`骨骰掷出 ${pip}。`, pip === 6 ? 'special' : 'good');
    if (pip === 6) ctx.draw(2);
  },
  'long-wager': ctx => {
    // 五成。赢了是这一场所有**攻击命中**加伤 8，输了只剩 1 点血——两个结果都是真的。
    if (ctx.roll() < .5) {
      ctx.status('player', 'edge', 8);
      ctx.log('契书上写的是你赢。', 'special');
    } else {
      const owed = ctx.player.hp - 1;
      if (owed > 0) ctx.loseHp(owed);
      ctx.log('契书上写的是你欠。', 'bad');
    }
  },

  // ------------------------------------------------------------------ 工具
  'spyglass': ctx => {
    const top = ctx.peekDraw(3);
    if (!top.length) { ctx.log('窥管里是空的。', 'neutral'); return; }
    // 不挑，取最贵的那张——窥管的价值是「知道上面有什么」，而不是再开一个选择界面。
    const best = top.reduce((a, b) => (b.cost > a.cost ? b : a));
    ctx.takeFromDraw(best.uid, top.length - 1);
    ctx.log(`窥管里最重的是「${best.name}」。`, 'good');
  },
};

/**
 * 未拆的信开出哪一件。
 *
 * 抽成纯函数是为了让「开出来的东西必须存在」这条能被直接测——`replaceWith` 拿到一个不存在的
 * id 会静默什么都不做，而那看起来就像「这封信是空的」。
 */
function pickLetter(ctx: PropContext, roll: number, offset: number): string {
  // 从数据层现取：这个文件不 import 数据层的话就得把整张表抄第二遍。
  const ids = ctx.letterPool;
  if (!ids.length) return 'sealed-letter';
  return ids[Math.floor(roll * ids.length + offset) % ids.length];
}

/**
 * 改 run 的那几件：**描述符，不是函数**。
 *
 * `run.ts` 拥有牌库、生命上限和遗物，所以由它来执行；这里只说明「做什么」。
 * 用数据而不是回调有一个具体好处：「哪些道具会改牌库」变成了一条测试能直接问的问题
 * （而它正是那个「战斗中点开会顶掉整张战斗页」的约束所依赖的事实）。
 */
export interface RunPropEffect {
  /** 要开牌库选牌器的：挂一个 `cardTask`。 */
  task?: 'remove' | 'polish';
  /** 回血。 */
  heal?: number;
  /** 生命上限增减。 */
  maxHp?: number;
  /** 「当前生命减半，等量加到上限」——不能写成两个常数，它取决于当下的血量。 */
  halveIntoMaxHp?: boolean;
  /** 失去生命。 */
  loseHp?: number;
  /** 花掉的金币。 */
  gold?: number;
  /** 从本牌组随机获得一张牌。`rare` 只取稀有度最高的那一档。 */
  gainCard?: 'rare' | 'any';
  /** 消耗主遗物。 */
  eatRelic?: boolean;
  /** 随机抽一件遗物。 */
  gainRelic?: boolean;
}

export const RUN_PROPS: Record<string, RunPropEffect> = {
  'gold-ash': { gold: -80, gainCard: 'any' },
  'deep-root': { maxHp: 8 },
  'night-office': { maxHp: -10, gainCard: 'rare' },
  'ash-oath': { task: 'remove', maxHp: 6 },
  'reliquary': { eatRelic: true, maxHp: 20 },
  'hollow-tooth': { halveIntoMaxHp: true },
  'grave-penny': { loseHp: 15, gainRelic: true },
  'pocket-forge': { task: 'polish', heal: 15 },
  'clean-lamp': { task: 'remove' },
};

/** 「战斗里能用」的那几件——`useProof` 与测试都读它。 */
export const IMPLEMENTED_PROPS = Object.keys(PROP_EFFECTS);

/** 一件道具在战斗里有没有效果。没有的就是 run 层的，或者还没实装。 */
export function propEffectFor(id: string): PropHandler | undefined {
  return PROP_EFFECTS[id];
}

/** 一件道具改 run 的那部分。 */
export function runPropEffectFor(id: string): RunPropEffect | undefined {
  return RUN_PROPS[id];
}
