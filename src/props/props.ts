// Explicit `.ts` specifiers throughout: `props.test.ts` runs under node's strip-types runner, which
// does no extensionless resolution and parses neither JSX nor CSS. Keep this file data-only.

/**
 * 道具 — the third axis.
 *
 * 牌组 is what you *do*, and it is unstable: you reshuffle it and you live with what you draw.
 * 遗物 is what you *are*, and it never changes once it is on. 道具 is the third thing — the one you
 * spend. It exists to answer exactly one feeling: *I drew nothing and I am about to die for it.*
 *
 * Which is why **almost every prop is used up**. A prop you can use every turn is not a prop, it is a
 * second relic track with extra steps; the whole tension is that using it costs you the chance to
 * use it later. Three slots makes that a real decision — you never carry the fourth thing you want.
 *
 * ## No rarity, deliberately
 *
 * ⚠️ The cards have a ladder (残烬 → 星陨) and the relics have one (残片 → 绝响). **A third ladder
 * that also means "rarer" would be one ladder too many** — that warning is already written down in
 * `relics.ts`, and it applies double here. A prop is a consumable: the question a player asks is
 * "do I use this *now*", never "how rare is it". So nothing about rarity is printed on the icon.
 * `weight` exists, but it is a drop-rate number in a data file, not a word on a card.
 *
 * What *is* printed is the **kind**, and the kind is a colour. Nine colours, one per kind, so a
 * glance at your three slots tells you what *sort* of answers you are carrying — which is the
 * question that actually matters mid-fight.
 *
 * ## Three axes, not one
 *
 * ⚠️ These are independent, and conflating any two of them is the obvious mistake:
 *
 *   `charges`  **印在数据上的上限**：能用几次。1 是消耗品，2~3 是工具。
 *   `uses`     **运行期还剩几次**，存在槽位上（`PropSlot`），不在这个文件里。
 *              上限是设计值（此处），剩余是每槽的值——同一件「袖炉」的两个副本可以处在
 *              不同的剩余次数上，所以两者绝不能是同一个字段。
 *   `use`      **能用在哪**：战斗里 / 营火边 / 两处都行。见下面那张表。
 *
 * ## The rule every effect follows
 *
 * Same as the relics: **a prop must bite into a mechanic that already exists** — 余烬, 锋锐, 壁垒,
 * 灼烧, 烙印, 反震, 蓄火, 格挡, 打磨 — rather than adding a number to a number.
 */

/** 槽位数。**是数量不是名字表**——道具没有主副，下标就是身份。 */
export const PROP_SLOTS = 3;

/**
 * 能用在哪。
 *
 * ⚠️ `camp` 这一档不是「文案上更弱」，是**界面上的硬约束**：战斗页的分派顺序里
 * `run.cardTask` 排在战斗本体**之前**（`BattleDemo.tsx`），所以战斗进行中一旦置上选牌任务，
 * **整张战斗页会被选牌器顶掉**——打到一半敌人消失、弹出一个选牌器。凡是需要开牌库选牌器的
 * 道具，因此只能在营火边用。用户那句「微型熔炉这种功能性道具可以在营火使用」正好落在这里。
 */
export type PropUse =
  /** 只在战斗里。效果全部落在这一场仗上。 */
  | 'battle'
  /** 只在战斗外（营火 / 战前准备）。需要开牌库选牌器的那几件。 */
  | 'camp'
  /** 战斗里与营火边都能用。改的是「你带着什么上路」，而且**不需要选牌器**。 */
  | 'anywhere';

export type PropKind =
  | 'convert' | 'hand' | 'energy' | 'control' | 'survive' | 'rite' | 'status' | 'gamble' | 'tool';

export interface PropKindDef {
  id: PropKind;
  name: string;
  /** One line: what question this kind of prop answers. Shown on the gallery's filter row. */
  gloss: string;
  accent: string;
}

/**
 * The nine kinds, and the colour each one is.
 *
 * ⚠️ **This is the only thing colour encodes.** A prop's accent says *what problem it solves*,
 * not how rare it is — see the note at the top of this file. The nine hues are spread around the
 * wheel so that two adjacent slots never read as the same colour at a glance.
 */
export const PROP_KINDS: PropKindDef[] = [
  { id: 'convert', name: '转化', gloss: '把一个维度换成另一个。', accent: '#b09478' },
  { id: 'hand', name: '手牌', gloss: '改的是你此刻手上有什么。', accent: '#7fa8c4' },
  { id: 'energy', name: '能量', gloss: '这一回合还差一点。', accent: '#e0b04e' },
  { id: 'control', name: '控制', gloss: '让对面少做一件事。', accent: '#8a86c4' },
  { id: 'survive', name: '生存', gloss: '把这一下扛过去。', accent: '#8fae7c' },
  { id: 'rite', name: '仪祭', gloss: '有代价的选择，不是白拿。', accent: '#b87da8' },
  { id: 'status', name: '状态', gloss: '直接把层数堆上去。', accent: '#c46a5a' },
  { id: 'gamble', name: '赌', gloss: '你知道概率，但你还是得掷。', accent: '#6fb0a0' },
  { id: 'tool', name: '工具', gloss: '不止用一次的东西。', accent: '#9c9c8a' },
];
export const KIND_BY_ID = new Map(PROP_KINDS.map(kind => [kind.id, kind]));

export interface PropDefinition {
  id: string;
  name: string;
  kind: PropKind;
  use: PropUse;
  /** 能用几次的**上限**。运行期的剩余次数在槽位上，见 `PropSlot`。 */
  charges: number;
  /** 效果文案。**只印在悬停展开的那一面**上——方图标上只有图与名字。 */
  text: string;
  /** 需要指定敌人的道具。战斗页点敌人选目标，和出牌共用同一套。 */
  target?: 'enemy';
  /**
   * 需要玩家从**手牌**里挑牌的道具。
   *
   * ⚠️ 和 `deck` 是两回事，别混：手牌只存在于战斗里，玩家挑哪几张是**作为参数**递给引擎的
   * （`useProp(s, slot, { handUids })`），不打开任何界面，所以不影响 `use`。
   * 而 `deck` 要开 run 的选牌器，那个会顶掉整张战斗页——见 `use` 上的说明。
   */
  pick?: { count: number; from: 'hand' };
  /**
   * 这件道具改的是 **run 的牌库**，所以要开 run 的选牌器（`cardTask`）。
   *
   * ⚠️ **有这一项就必须是 `use: 'camp'`。** 战斗页的分派顺序里 `run.cardTask` 排在战斗本体
   * 之前，所以战斗进行中一置上它，敌人当场消失、换成一张选牌器。这条不是约定，是被界面结构
   * 逼出来的硬约束，`props.test.ts` 直接钉住它。
   */
  deck?: 'remove' | 'polish';
  /**
   * 掉落权重。**不印在任何地方**，见文件头那条关于不印稀有度的说明。
   * 100 常备 / 45 少见 / 18 难得。
   */
  weight: number;
  /** One line of provenance for the compendium. */
  lore: string;
}

/**
 * 一个槽。`id` 与剩余次数都是**纯数据**——`clone` 是 `structuredClone`，函数会被静默扔掉，
 * 行为和遗物一样靠查 `PROP_EFFECTS`。
 */
export interface PropSlot { id: string; uses: number }

/**
 * 三个槽，**定长**，`null` 是空槽。
 *
 * ⚠️ 不用稀疏数组：`isValidBattle` / `isValidRun` 要逐下标查，而稀疏数组会让
 * 「第 2 槽是空的」和「这个存档只有两个槽」变成同一件事——而后者会让界面三列轨错位。
 */
export type PropSlotState = PropSlot | null;

export const emptyProps = (): PropSlotState[] => Array.from({ length: PROP_SLOTS }, () => null);

const P = (
  id: string, name: string, kind: PropKind, use: PropUse, charges: number,
  text: string, weight: number, lore: string,
): PropDefinition => ({ id, name, kind, use, charges, text, weight, lore });

/** 一次性、战斗里用。绝大多数道具是这个形状——单列一个工厂省掉每行两个常量。 */
const B = (
  id: string, name: string, kind: PropKind, text: string, weight: number, lore: string,
): PropDefinition => P(id, name, kind, 'battle', 1, text, weight, lore);

/** 一次性、战斗外也能用（不需要选牌器的那些）。改的是 run，不是这一场仗。 */
const A = (
  id: string, name: string, kind: PropKind, text: string, weight: number, lore: string,
): PropDefinition => P(id, name, kind, 'anywhere', 1, text, weight, lore);

/**
 * 改牌库的那几件：**只能**在营火边用，因为要开 run 的选牌器，而选牌器会顶掉整张战斗页。
 * 见 `PropDefinition.deck`。
 */
const D = (
  id: string, name: string, kind: PropKind, deck: 'remove' | 'polish',
  text: string, weight: number, lore: string,
): PropDefinition => ({ ...P(id, name, kind, 'camp', 1, text, weight, lore), deck });

export const PROPS: PropDefinition[] = [
  // ------------------------------------------------------------------ 转化 · 5
  // 把一个维度换成另一个。这一类的趣味密度最高（万智牌的 Body Slam：伤害 = 格挡）——
  // 它让两种本来分开的资源之间长出结缔组织，而玩家会自己去找那个兑换率。
  // ⚠️ 打**一个**敌人的道具必须写 `target: 'enemy'`。漏了不会报错——`useProp` 会以为它不需要
  // 目标，于是「霜钉」在没有目标时静默打空，玩家看到的是「点了没反应」。
  { ...B('blood-tap', '放血针', 'convert', '失去 6 点生命，获得 3 点能量。', 100, '针管里那点东西不是药。营地里没人问过它是什么做的。') },
  { ...B('shield-splinter', '碎盾', 'convert', '把当前全部格挡转化为对一个敌人的等量伤害。', 18, '把墙拆下来砸人。拆完就没有墙了。'), target: 'enemy' as const },
  B('ember-scale', '烬秤', 'convert', '消耗全部余烬，每 2 点抽 1 张牌。', 100, '秤盘一头放火，一头放纸。放火那头总是先沉。'),
  A('gold-ash', '金烬', 'convert', '花 80 金币，随机获得一张本牌组的牌。', 18, '有人在营火里烧过钱，说烧完能看见路。'),
  { ...B('scorch-salve', '烫伤膏', 'convert', '消耗一个敌人身上的全部灼烧，每层为你回复 1 点生命。', 100, '把别人身上的火，抹到自己身上来。'), target: 'enemy' as const },

  // ------------------------------------------------------------------ 手牌 · 6
  // 改的是「你此刻手上有什么」。牌组不稳定，这一类道具就是拿回一点主动权的东西。
  { ...B('whetstone-kit', '磨石匣', 'hand', '本回合手牌中任选三张，本场战斗内视为已打磨。', 18, '匣子里三块石头，粗细各一。用完就没了。'), pick: { count: 3, from: 'hand' } },
  B('blank-slip', '空白签', 'hand', '弃掉整手牌，重抽同样多。', 100, '签上什么都没写。抽到它的人得自己重来一次。'),
  B('twin-needle', '双生针', 'hand', '复制手牌中的一张。', 45, '一根针扎两次，同一个眼。'),
  B('lead-thimble', '铅指套', 'hand', '本回合你手牌的费用全部变为 0。', 45, '戴上它，什么都能拿得动，也什么都留不住。'),
  B('index-card', '索引卡', 'hand', '从抽牌堆里检索一张技能牌，置入手中。', 45, '有人把整副牌抄了一遍，只为了找那一张。'),
  B('iron-comb', '铁梳', 'hand', '弃掉手牌中所有非攻击牌，每弃一张抽一张。', 45, '齿太密，软的东西一概过不去。'),

  // ------------------------------------------------------------------ 能量 · 3
  B('ember-draught', '烬饮', 'energy', '立刻回复 2 点能量。', 100, '喝下去喉咙里是热的。'),
  B('tailwind-flag', '顺风旗', 'energy', '获得 3 点能量，但下回合少 2 点能量。', 45, '旗子插在背上，跑起来才觉得有风——风是借的。'),
  B('slow-coal', '慢煤', 'energy', '获得 3 层蓄火（下回合开始时变成能量）。', 45, '它烧得慢。你等它，比它等你划算。'),

  // ------------------------------------------------------------------ 控制 · 4
  // ⚠️ 这一档只能做引擎真的支持的四件事：冻结、清格挡、改意图、上烙印。
  // 「让敌人攻击它自己」「敌人伤害减半」都要再加一个状态才成立，不值得为它们扩状态表。
  { ...B('frost-nail', '霜钉', 'control', '冻结一个敌人一回合——它下次不行动。', 100, '钉进影子里，影子就动不了。'), target: 'enemy' as const },
  { ...B('rust-knife', '锈刀', 'control', '清空一个敌人的格挡，并给它 3 层烙印。', 100, '锈比刃好使。刃要用力，锈自己会走。'), target: 'enemy' as const },
  { ...B('brass-whistle', '铜哨', 'control', '把一个敌人的意图换成「不动」，但它获得 4 层力量。', 45, '吹给谁听，谁就得愣一下——然后更用力地打回来。'), target: 'enemy' as const },
  B('binding-cord', '捆缚索', 'control', '给所有敌人各 2 层烙印。', 100, '一根绳子捆不住谁，但能让所有人都慢半拍。'),

  // ------------------------------------------------------------------ 生存 · 4
  B('staunch-moss', '止血苔', 'survive', '回复 12 点生命。', 100, '长在背阴的石头上，一按就渗水。'),
  B('wall-seed', '墙种', 'survive', '获得 14 点格挡。', 100, '埋下去，过一秒就长出一堵墙。'),
  B('stub-candle', '残烛', 'survive', '本场战斗内，下一次致死伤害为你留下 1 点生命。', 45, '烧到底的那一截。风一吹就灭——但还没灭。'),
  A('deep-root', '深根', 'survive', '生命上限 +8。', 18, '把根往下扎一尺，人就能多站一会儿。'),

  // ------------------------------------------------------------------ 仪祭 · 5
  // 有代价的选择。用户点名的那条「消耗生命值上限或者生命值通过仪式获得稀有牌」在这里。
  A('night-office', '夜祷书', 'rite', '生命上限 −10，获得一张本牌组的稀有牌。', 18, '念完这一页，你身上就少了一块，多了一张纸。'),
  D('ash-oath', '灰誓', 'rite', 'remove', '摧毁牌库里的一张牌，生命上限 +6。', 45, '烧掉一个名字，换来一点厚度。'),
  A('reliquary', '圣物匣', 'rite', '消耗你的主遗物，生命上限 +20。', 18, '匣子装不下两样东西。'),
  A('hollow-tooth', '空心齿', 'rite', '当前生命减半，等量的数值加到生命上限上。', 18, '牙是空的，但咬得很紧。'),
  A('grave-penny', '陪葬钱', 'rite', '失去 15 点生命，立刻抽一件遗物。', 18, '死人不需要钱，活人很需要。'),

  // ------------------------------------------------------------------ 状态 · 4
  B('cinder-flask', '炭火瓶', 'status', '给所有敌人各 6 层灼烧。', 100, '瓶底沉着一层没烧完的东西。'),
  B('ember-heart', '烬心', 'status', '立刻获得 12 层余烬。', 18, '一颗还在跳的炭。'),
  B('grindstone-dust', '磨石粉', 'status', '立刻获得 5 层锋锐。', 45, '吸进去会咳，但手会稳。'),
  B('bastion-shard', '壁垒残片', 'status', '立刻获得 8 层壁垒与 3 层反震。', 45, '墙上掉下来的那一块，还是墙。'),

  // ------------------------------------------------------------------ 赌 · 3
  B('sealed-letter', '未拆的信', 'gamble', '开出一件随机道具。', 18, '封泥是好的，所以没人拆过。谁拆谁承担。'),
  B('bone-dice', '骨骰', 'gamble', '掷 1~6：获得等量能量；掷到 6 再多抽 2 张牌。', 45, '掷出去之前，它还是别人的骨头。'),
  B('long-wager', '长赌契', 'gamble', '五成：获得 8 层锋锐；五成：生命降到 1 点。', 18, '签的时候只需要一个名字。兑的时候要全部。'),

  // ------------------------------------------------------------------ 工具 · 3
  // 有次数的那一类。⚠️「有几次」与「能在哪用」是两条轴：窥管有 2 次但只能战斗里用
  //（「抽牌堆顶三张」在营火边上根本不存在），袖炉有 2 次而且两处都能用。
  { ...P('pocket-forge', '袖炉', 'tool', 'camp', 2, '二选一：回复 15 点生命，或打磨牌库里的一张牌。', 100, '揣在袖子里的一个小炉子。它只烧你给它的东西。'), deck: 'polish' as const },
  P('spyglass', '窥管', 'tool', 'battle', 2, '看抽牌堆顶 3 张，费用最高的那张置入手中，其余弃掉。', 45, '看得见不算本事，挑得对才算。'),
  D('clean-lamp', '净灯', 'tool', 'remove', '从牌库里移除一张牌。', 45, '灯照过的地方，东西就没了。'),
];

export const PROP_BY_ID = new Map(PROPS.map(prop => [prop.id, prop]));

/** 出场用的掉落池。营火边不能用的那些不该出现在战斗掉落里，所以按使用时机筛。 */
export function propsUsableIn(use: Exclude<PropUse, 'camp'>): PropDefinition[] {
  return PROPS.filter(prop => prop.use === use || prop.use === 'anywhere');
}

export function propsOfKind(kind: PropKind): PropDefinition[] {
  return PROPS.filter(prop => prop.kind === kind);
}

/** 每类各几件。验收页的分组按钮与数据层测试都读它。 */
export function kindCounts(): Record<PropKind, number> {
  const counts = Object.fromEntries(PROP_KINDS.map(kind => [kind.id, 0])) as Record<PropKind, number>;
  for (const prop of PROPS) counts[prop.kind] += 1;
  return counts;
}

/**
 * 一件道具用掉一次之后剩几次。
 *
 * 抽成函数是因为**它是真正的规则，而它只有一行**——而这一行错掉的表现是「用不完的道具」
 * 或者「用一次就整件消失」，两种都不会抛错，只会看起来像设计。所以它值得被测试直接钉住。
 */
export function afterUse(remaining: number): number {
  return Math.max(0, remaining - 1);
}

/**
 * 用掉一次，但**不走效果**。
 *
 * 改 run 的那几件（金烬、夜祷书…）由 `run.ts` 的 `useRunProp` 执行，而战斗状态里的次数也得跟上——
 * 战斗结束时 `finishBattle` 是拿 `state.props` **采纳回 run 的**，少扣这一次就等于那一件白用。
 * 所以这是一条真规则，不是顺手写的一行。
 */
export function spendSlot(props: PropSlotState[], slot: number): PropSlotState[] {
  const next = props.map(entry => (entry ? { ...entry } : null));
  const entry = next[slot];
  if (!entry) return next;
  const left = afterUse(entry.uses);
  next[slot] = left > 0 ? { ...entry, uses: left } : null;
  return next;
}

/** 往一个槽里放一件道具，返回新的槽位数组。已存在的槽会被替换（和 `claimRelic` 同一个语义）。 */
export function placeIn(props: PropSlotState[], slot: number, id: string): PropSlotState[] {
  const next = props.map(entry => (entry ? { ...entry } : null));
  const def = PROP_BY_ID.get(id);
  if (!def || !Number.isInteger(slot) || slot < 0 || slot >= PROP_SLOTS) return next;
  next[slot] = { id, uses: def.charges };
  return next;
}

/** 清空一格。 */
export function clearSlot(props: PropSlotState[], slot: number): PropSlotState[] {
  const next = props.map(entry => (entry ? { ...entry } : null));
  if (Number.isInteger(slot) && slot >= 0 && slot < PROP_SLOTS) next[slot] = null;
  return next;
}
