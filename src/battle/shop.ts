/**
 * 商店 —— 塔上唯一一个「把攒下的东西花掉」的地方。
 *
 * 这一层是**纯数据 + 掷点**：价格表、类别权重、一格货长什么样，以及「这一格你付不付得起」。
 * 真正的转移（扣钱、换走遗物、把牌塞进牌库）在 `run.ts` 里，和 `campfire` / `resolveEvent` 同一个位置——
 * 因为那几件事改的是 run 的状态，而 run 的状态只有 `run.ts` 拥有。依赖是单向的：`run.ts → shop.ts`，
 * 这里对 run 只有 `import type`。
 *
 * ## 三条设计上的规矩
 *
 * 1. **每一格都能用三种东西付：金币 / 生命 / 一件够值的遗物。** 这不是三个并列的按钮，是同一个
 *    标价的三种读法——三种价钱都从**折后**的金币价推出来（`hpPrice` 是它的 1/5，`relicPrice` 就是它
 *    本身），所以「半价那一格」在三种货币上都是半价。遗物那一栏比的是**价值不低于**，而价值就是
 *    `RELIC_PRICE` 按品阶标出来的那个数——那是项目里**已经存在**的「一件遗物值多少钱」，不是为商店
 *    另造的一张表（它的注释写着「留给商店和 boss 奖励共用同一个数」）。
 * 2. **价钱是按真实收入定的，不是拍脑袋。** 一条路线走完大约 700~800 金币、走到一半 300~400，
 *    而一局只有 2~3 家店——所以一家店应该让人**买得走 1~2 件**。见下面每张表上的注释。
 * 3. **生命不是免费的第二条钱包。** 判血用的是 `>`（照抄 `events.ts` 的 `canAfford`）：
 *    付完还剩 0 血必须挡住，`run.hp` 付完至少留 1。
 *
 * ## 为什么它必须能被测试直接调
 *
 * `strip-types` 不解析 JSX，所以长在界面里的定价规则是一条**没有任何东西盯得住**的规则。这里的
 * 每一张表都是导出常量，`run.test.ts` 拿它们和文案对跑。
 */

import { CARD_BY_ID, TIER_BY_ID, type TierId } from '../cards/index.ts';
import { PROPS, PROP_BY_ID, type PropDefinition } from '../props/props.ts';
import { RELIC_BY_ID } from '../relics/relics.ts';
import { startingRelics } from '../relics/unlocks.ts';
import { RELIC_PRICE } from './relicDraw.ts';
import { rewardCardPool } from './rewards.ts';
import type { ChapterRun } from './run.ts';

// ------------------------------------------------------------------ the shape

export type ShopKind = 'prop' | 'card' | 'relic' | 'stat' | 'life';

export interface ShopSlot {
  kind: ShopKind;
  /** prop / card / relic 用；stat 与 life 也带着（见 `FIXED_GOODS`），界面可以直接查名字。 */
  id?: string;
  /** 实际售价（已经算过五折）。 */
  price: number;
  /** 原价，用于在半价那格上印一道划掉的原价。没打折时等于 price。 */
  fullPrice: number;
  /** 生命价。**从折后价推**，所以半价那格的血价也是半价。 */
  hpPrice: number;
  /** 要拿一件**价值不低于这个数**的遗物来换。 */
  relicPrice: number;
  sold?: boolean;
}

export interface ShopState {
  slots: ShopSlot[];
  /** 这一家已经刷新过几次（递增价格的依据）。 */
  rerolls: number;
  /** 买下免死之后为 true —— 见下面「免死」那条。 */
  warded?: boolean;
  /**
   * 这家店的**删牌服务**已经用过了。
   *
   * ⚠️ 这一项不在最初给定的 `ShopState` 里，是这次实现加上去的，理由是**没有它这条服务就不是
   * 「一次」**：价格按「路上已经走过几家店」递增，而那个数只在踏进新店时才变——同一家店里可以
   * 无限次地按同一个价删牌。界面读它来把按钮置灰（「这家已经用过了」）。
   */
  removed?: boolean;
}

/** Pay for a slot with coin, blood, or a relic off your own shelf. */
export type PayWith = 'gold' | 'hp' | 'relic';

/** 一排五格。杀戮尖塔的货架也是五格，五格刚好够摆出「两种想要的 + 一种买不起的」。 */
export const SHOP_SLOTS = 5;

/** 第一次刷新的价钱。之后翻倍：40 / 80 / 160 / 320。 */
export const SHOP_REROLL_BASE = 40;

/** 第 `rerolls` 次刷新要多少钱。⛔ 不要改成线性递增——递增的刷新费等于鼓励玩家一次刷到底。 */
export function rerollCost(rerolls: number): number {
  return SHOP_REROLL_BASE * 2 ** Math.max(0, Math.floor(rerolls));
}

/**
 * 每一格各占多少权重。
 *
 * 道具最重：它是唯一一件**当场就能用**、而且不占牌库也不占遗物槽的东西，也是商店这个概念最直接的
 * 答案。遗物最贵（120~165），所以它的权重低——它该是那种「这家店值得来」的格子，不是常客。
 * 五档加起来正好 100，改一个数就是改一个百分点。
 */
export const KIND_WEIGHT: Record<ShopKind, number> = {
  prop: 30, card: 26, stat: 20, relic: 14, life: 10,
};

/** 货架上的分类标签与颜色。颜色取自 `props.ts` 的九色，别在这里新开一套。 */
export const KIND_META: Record<ShopKind, { label: string; tone: string }> = {
  prop: { label: '道具', tone: '#9c9c8a' },
  card: { label: '卡牌', tone: '#7fa8c4' },
  relic: { label: '遗物', tone: '#d9a45f' },
  stat: { label: '属性', tone: '#8fae7c' },
  life: { label: '免死', tone: '#c46a5a' },
};

// ------------------------------------------------------------------ the prices

/**
 * 道具：按**掉落权重**分三档，权重是数据层已经写好的稀有度（100 常备 / 45 少见 / 18 难得）。
 *
 * 不另立一套稀有度标签，也不看 `kind`——`props.ts` 的文件头写着「道具没有稀有度阶梯」，而
 * `weight` 本来就是它唯一那个「多常见」的数。用它当价签，等于店里卖的东西和你路上捡到的东西
 * 是同一把尺子量的。
 */
export const PROP_PRICE = { common: 80, uncommon: 130, rare: 190 } as const;

/** 卡牌：按档位（`TIERS` 的 rank）分三档。rank 0 残烬 / 1~2 微光·明焰 / 3~4 长明·星陨。 */
export const CARD_PRICE = { common: 85, uncommon: 130, rare: 220 } as const;

/** 免死 —— 货架上最贵的一格。它得是一个要犹豫的决定，而不是顺手拿的东西。 */
export const LIFE_PRICE = 260;

/** 删牌服务：跨商店递增，75 / 100 / 125…，和杀戮尖塔同一个数、同一个步长。 */
export const REMOVE_BASE = 75;
export const REMOVE_STEP = 25;

/** 一件遗物值多少钱。**就是 `RELIC_PRICE`**——按品阶标定的内置价格，没有第二张表。 */
export function relicValueOf(relicId: string): number {
  const relic = RELIC_BY_ID.get(relicId);
  return relic ? (RELIC_PRICE[relic.tier] ?? 0) : 0;
}


/** 生命价：金币价的 1/5，向上取整。60 血的人买不起 340 那一档——那是设计，不是限制。 */
export function hpPriceOf(price: number): number {
  return Math.max(1, Math.ceil(price / 5));
}

/**
 * `stat` 与 `life` 这两类的货是**固定的两三种**，不像道具卡牌遗物那样从池子里掷。
 *
 * 所以它们的名字与效果写在这里，而不是散在界面里：`run.ts` 按 `effect` 结算，界面按 `name` 印字，
 * 两边读的是同一份数据。
 *
 * 两条属性同价（90），是因为它们给的东西分量相当：生命上限 +8 顺手补上同样的 8 点生命（这个项目
 * 一贯的算法，见 `claimReward` 的 `maxHp` 分支），而回血 30 是**当下**的 30 点——营火白送 30% 上限
 * 的回血，所以这里的回血必须比营火多，才有人买。
 */
export interface ShopGood {
  id: string;
  /** 一行价格旁边印得下的名字。 */
  name: string;
  /** 一个词，货格那张小面上印的就是它（`SHOP_STAT`）。长名字在小面上会挤成一团。 */
  short: string;
  text: string;
  price: number;
  effect: { maxHp?: number; heal?: number };
}

export const STAT_GOODS: ShopGood[] = [
  {
    id: 'max-hp', name: '生命上限 +8', short: '加厚', price: 90,
    text: '把上限抬高一截，跟着补上同样多的生命。',
    effect: { maxHp: 8 },
  },
  {
    id: 'heal', name: '回复 30 点生命', short: '缝合', price: 90,
    text: '把身上的伤补回来。营火给的是三成上限，这个给得更多。',
    effect: { heal: 30 },
  },
];

export const LIFE_GOOD: ShopGood = {
  id: 'death-ward', name: '一条命', short: '一条命', price: LIFE_PRICE,
  text: '本局下一次致命伤害为你留下 1 点生命。和「残烛」、铁面具是同一条命。',
  effect: {},
};

/** 属性格小面上的那个词，按 id 查。界面不必自己再写一张 id → 汉字的表（那就是第二份数据）。 */
export const SHOP_STAT: Record<string, string> =
  Object.fromEntries(STAT_GOODS.map(good => [good.id, good.short]));

/** 固定货的查表口。`isValidShop` 与界面都用它，所以它必须覆盖 `STAT_GOODS` 与 `LIFE_GOOD` 全部。 */
export const FIXED_GOODS: ShopGood[] = [...STAT_GOODS, LIFE_GOOD];
export const FIXED_BY_ID = new Map(FIXED_GOODS.map(good => [good.id, good]));

// ------------------------------------------------------------------ naming

/** 一格货印什么名字。五种都能查，界面不必自己 switch。 */
export function shopSlotName(slot: ShopSlot): string {
  switch (slot.kind) {
    case 'prop': return (slot.id && PROP_BY_ID.get(slot.id)?.name) ?? '一件道具';
    case 'card': return (slot.id && CARD_BY_ID.get(slot.id)?.name) ?? '一张牌';
    case 'relic': return (slot.id && RELIC_BY_ID.get(slot.id)?.name) ?? '一件遗物';
    default: return (slot.id && FIXED_BY_ID.get(slot.id)?.name) ?? KIND_META[slot.kind].label;
  }
}

/** 一格货印哪句效果文案。道具/卡牌/遗物的正文由界面自己那张卡面负责，这里只给固定货。 */
export function shopSlotText(slot: ShopSlot): string | undefined {
  if (slot.kind === 'prop') return slot.id ? PROP_BY_ID.get(slot.id)?.text : undefined;
  if (slot.kind === 'relic') return slot.id ? RELIC_BY_ID.get(slot.id)?.lore : undefined;
  return slot.id ? FIXED_BY_ID.get(slot.id)?.text : undefined;
}

// ------------------------------------------------------------------ the roll

/** 权重抽取。和 `rollReward` / `rollProp` 同一条规矩：权重在这层，掷点由调用方给。 */
function pickWeighted<T>(items: readonly T[], roll: () => number, weightOf: (item: T) => number): T | undefined {
  if (!items.length) return undefined;
  const total = items.reduce((sum, item) => sum + Math.max(0, weightOf(item)), 0);
  if (total <= 0) return items[Math.floor(roll() * items.length)];
  let ticket = roll() * total;
  for (const item of items) {
    ticket -= Math.max(0, weightOf(item));
    if (ticket <= 0) return item;
  }
  return items[items.length - 1];
}

const propPriceOf = (prop: PropDefinition): number =>
  prop.weight >= 100 ? PROP_PRICE.common : prop.weight >= 45 ? PROP_PRICE.uncommon : PROP_PRICE.rare;

const cardRank = (cardId: string): number => {
  const tier = CARD_BY_ID.get(cardId)?.tier as TierId | undefined;
  return (tier && TIER_BY_ID.get(tier)?.rank) ?? 0;
};

const cardPriceOf = (cardId: string): number => {
  const rank = cardRank(cardId);
  return rank <= 0 ? CARD_PRICE.common : rank <= 2 ? CARD_PRICE.uncommon : CARD_PRICE.rare;
};

/** 卡牌按档位加权抽取用的权重：残烬 46 对星陨 2，和掉落表同一把尺子。 */
const cardWeightOf = (cardId: string): number => {
  const tier = CARD_BY_ID.get(cardId)?.tier as TierId | undefined;
  return (tier && TIER_BY_ID.get(tier)?.weight) ?? 1;
};

/**
 * 一局里能出现在货架上的遗物。
 *
 * **就是第一章开局的那 36 件**（残片 + 旧物，见 `unlocks.ts` 的 `startingRelics`）。不读元进度、
 * 不读 `localStorage`：`rollShop` 必须是一个**纯函数**，否则「同一个种子给出同一批货」那条测试就
 * 变成了「同一台机器给出同一批货」。代价是店里不会出现珍品——那是击破头狼之后才解锁的一档，
 * 让它从商店漏出来等于把解锁阶梯绕过去。想放宽的话改这一行就够了。
 */
function relicPool(run: ChapterRun): string[] {
  return startingRelics()
    .filter(relic => relic.id !== run.relics.main && relic.id !== run.relics.sub)
    .map(relic => relic.id);
}

/** 一格货。掷不出东西时退化成一条属性——**货架永远是五格**，`isValidShop` 钉着这一点。 */
function makeSlot(
  kind: ShopKind, run: ChapterRun, roll: () => number, used: Set<string>, discounted: boolean,
): ShopSlot {
  let id: string | undefined;
  let full: number;

  switch (kind) {
    case 'prop': {
      const def = pickWeighted(PROPS.filter(entry => !used.has(entry.id)), roll, entry => entry.weight)
        ?? pickWeighted(PROPS, roll, entry => entry.weight);
      if (!def) return makeSlot('stat', run, roll, used, discounted);
      id = def.id;
      full = propPriceOf(def);
      break;
    }
    case 'card': {
      const pool = rewardCardPool(run.main, run.sub);
      const cardId = pickWeighted(pool.filter(entry => !used.has(entry)), roll, cardWeightOf)
        ?? pickWeighted(pool, roll, cardWeightOf);
      if (!cardId) return makeSlot('stat', run, roll, used, discounted);
      id = cardId;
      full = cardPriceOf(cardId);
      break;
    }
    case 'relic': {
      const pool = relicPool(run);
      const relicId = pickWeighted(pool.filter(entry => !used.has(entry)), roll, entry => 1)
        ?? pickWeighted(pool, roll, entry => 1);
      if (!relicId) return makeSlot('stat', run, roll, used, discounted);
      id = relicId;
      full = relicValueOf(relicId);
      break;
    }
    case 'stat': {
      const good = pickWeighted(STAT_GOODS, roll, () => 1) ?? STAT_GOODS[0];
      id = good.id;
      full = good.price;
      break;
    }
    case 'life': {
      id = LIFE_GOOD.id;
      full = LIFE_GOOD.price;
      break;
    }
  }

  if (id) used.add(id);
  const price = discounted ? Math.max(1, Math.ceil(full / 2)) : full;
  return {
    kind,
    ...(id ? { id } : {}),
    price,
    fullPrice: full,
    hpPrice: hpPriceOf(price),
    relicPrice: price,
  };
}

/**
 * 掷一排货。
 *
 * ⚠️ **掷点顺序是契约**：先掷「保底那一格道具在哪」，再逐格掷类别，再掷「哪一格打五折」，最后逐格
 * 掷具体是什么。顺序变了，同一颗种子就是另一批货——而货架是落盘的，一局里的第二家店会和存档里
 * 第一家对不上。加新东西一律**追加在最后**。
 *
 * 保底那一格是**先摇位置再填**，不是「掷完发现没道具就顶掉一格」：后者会让「有道具」这件事
 * 消费一个额外的掷点，于是同一颗种子有没有道具会改变后面所有格子的结果。
 *
 * `skip` 是「这几格已经卖掉了」（刷新时不重掷）。它们仍然会被填上一个类别，但调用方会把旧内容
 * 盖回去——保底与五折都只在没卖掉的那几格里挑，否则刷新一次可能什么都没变。
 */
export function rollShopSlots(run: ChapterRun, roll: () => number, skip: readonly number[] = []): ShopSlot[] {
  const open = Array.from({ length: SHOP_SLOTS }, (_, i) => i).filter(i => !skip.includes(i));
  if (!open.length) return [];
  const guaranteed = open[Math.floor(roll() * open.length)];
  const discounted = open[Math.floor(roll() * open.length)];

  const used = new Set<string>();
  const slots: ShopSlot[] = [];
  for (let index = 0; index < SHOP_SLOTS; index++) {
    const kind = index === guaranteed ? 'prop' : pickKind(roll);
    slots.push(makeSlot(kind, run, roll, used, index === discounted));
  }
  return slots;
}

function pickKind(roll: () => number): ShopKind {
  const total = SHOP_KINDS.reduce((sum, kind) => sum + KIND_WEIGHT[kind], 0);
  let ticket = roll() * total;
  for (const kind of SHOP_KINDS) {
    ticket -= KIND_WEIGHT[kind];
    if (ticket <= 0) return kind;
  }
  return SHOP_KINDS[SHOP_KINDS.length - 1];
}

/** 掷类别的固定顺序。它是 `pickKind` 的累减顺序，也是 `rollShopSlots` 里那个循环的顺序。 */
export const SHOP_KINDS: ShopKind[] = ['prop', 'card', 'stat', 'relic', 'life'];

// ------------------------------------------------------------------ paying

/**
 * 身上哪几件遗物够格换这一格。
 *
 * 判据是**价值不低于**，不是等值——所以玩家可以拿一件 165 的旧物换一张 130 的卡（剩下的是他自己
 * 愿意付的），但拿一件 120 的残片换不走 190 的那件。界面拿它来决定点亮哪一格/哪几格。
 */
export function relicFodder(run: ChapterRun, slot: ShopSlot): ('main' | 'sub')[] {
  return (['main', 'sub'] as const).filter(entry => {
    const id = run.relics[entry];
    return !!id && relicValueOf(id) >= slot.relicPrice;
  });
}

/**
 * 这一格，用这种货币付得起吗。
 *
 * 界面置灰用，真正的判定在 `buyShopSlot` 里重做一遍——和 `canPlay` / `canAfford` / `canUseRunProp`
 * 同一套：置灰是提示，不是规则。
 */
export function canPayWith(run: ChapterRun, index: number, payWith: PayWith): boolean {
  const slot = run.shop?.slots[index];
  if (!slot || slot.sold) return false;
  // ⚠️ **满血时「回血」这一格不算买得起。**
  //
  // 没有这一条时的表现：满血的玩家花 90 金买下「回复 30 点生命」，**什么都没发生**——
  // 货架卖掉、钱扣掉、血一点没动，而界面上没有任何东西提示他。`canPayWith` 原本只管
  // 「付不付得起」，付得起与**买得到东西**是两件事。
  //
  // 挡在这里而不是挡在 `buyShopSlot` 里：置灰与拒绝必须走同一个判据，否则界面会画出一个
  // 点得动却在引擎里被拒的按钮（`events.ts` 的 `canAfford` 与 `resolveEvent` 也是这么配对的）。
  if (isHealSlot(slot) && run.hp >= run.maxHp) return false;
  if (payWith === 'gold') return run.gold >= slot.price;
  // ⚠️ **严格大于**（照抄 `events.ts` 的 `canAfford`）：付完还剩 0 血必须挡住。`run.hp` 是这个 run
  // 的全部生命，付到 0 就是「在店里把自己付死了」，而一层楼不该有这种死法。
  if (payWith === 'hp') return run.hp > slot.hpPrice;
  return relicFodder(run, slot).length > 0;
}

/**
 * 这一格是不是「回血」。
 *
 * 满血的玩家买了它什么都不发生，所以 `canPayWith` 要据此把它挡掉——见那里那段注释。
 * 写成函数而不是内联 `slot.id === 'heal'`：判据只该有一处，改了 id 只改这里。
 */
function isHealSlot(slot: ShopSlot): boolean {
  return slot.kind === 'stat' && slot.id === 'heal';
}

/**
 * 这一家店现在刷新要多少钱。界面直接印它。
 *
 * 住在这一层（而不是 `run.ts`）是因为它不需要 run 的任何转移——它只读 `rerolls` 这个数。`run.ts`
 * 把它**再出口**一次，所以两处都能导入，界面不必为了一个价钱记住它住在哪一层。
 */
export function shopRerollCost(run: ChapterRun): number {
  return rerollCost(run.shop?.rerolls ?? 0);
}

/** 删牌服务现在要多少钱：按**路上已经走过几家店**递增。 */
export function removePrice(shopsVisited: number): number {
  return REMOVE_BASE + REMOVE_STEP * Math.max(0, shopsVisited);
}

// ------------------------------------------------------------------ validation

/** Mirrors `isValidRun`'s job: 形状对不对，从不问「买不买得起」。 */
export function isValidShop(value: unknown): value is ShopState {
  if (!value || typeof value !== 'object') return false;
  const shop = value as ShopState;
  if (!Array.isArray(shop.slots) || shop.slots.length !== SHOP_SLOTS) return false;
  if (!Number.isInteger(shop.rerolls) || shop.rerolls < 0) return false;
  if (shop.warded !== undefined && typeof shop.warded !== 'boolean') return false;
  if (shop.removed !== undefined && typeof shop.removed !== 'boolean') return false;
  for (const slot of shop.slots) {
    if (!slot || typeof slot !== 'object') return false;
    if (!SHOP_KINDS.includes(slot.kind)) return false;
    if (slot.sold !== undefined && typeof slot.sold !== 'boolean') return false;
    // 三种价钱都必须是**非负整数**：`run.gold` 本身必须是整数（`isValidRun` 钉着），拿一个
    // 1.5 去减它会得到一个不是整数的金币数，于是下一份存档直接不过校验、整局丢掉。
    for (const amount of [slot.price, slot.fullPrice, slot.hpPrice, slot.relicPrice]) {
      if (!Number.isInteger(amount) || amount < 0) return false;
    }
    // ⚠️ id 必须真的存在，理由和 `propTask` 那条一模一样：它下一步就被写进牌库/道具槽/遗物槽，
    // 而一个不存在的 id 会让**下一次加载把整局丢掉**——`loadRun` 丢 run，不修。
    if (slot.kind === 'prop' && !(typeof slot.id === 'string' && PROP_BY_ID.has(slot.id))) return false;
    if (slot.kind === 'card' && !(typeof slot.id === 'string' && CARD_BY_ID.has(slot.id))) return false;
    if (slot.kind === 'relic' && !(typeof slot.id === 'string' && RELIC_BY_ID.has(slot.id))) return false;
    // stat / life 的 id 是**可选**的（给定接口里就写着「不需要」），但写了就必须是对的。
    if (slot.kind !== 'prop' && slot.kind !== 'card' && slot.kind !== 'relic'
      && slot.id !== undefined && !FIXED_BY_ID.has(slot.id)) return false;
  }
  return true;
}
