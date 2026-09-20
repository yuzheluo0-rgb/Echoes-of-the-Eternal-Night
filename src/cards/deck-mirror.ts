import type { CardDefinition } from './types';

/**
 * 千面回廊 —— 镜的打法核心是**重来一次**。
 *
 * 它自己几乎不产出数值：手里握的是「这张牌再打一遍」「这张牌回到手上」「这张牌本回合免费」
 * 「这张牌永久变强」——同一个回合里把三五张牌反复过一遍，才是它的伤害来源。
 * **映照** 只由 4 张牌产生（镜片、壁影、烬映、空镜），其余全部是「拿映照去做别的事」：
 * 加倍结算、退回手牌、把弃牌堆洗成资源、把壁垒拆成伤害。
 *
 * 五张 bridge 牌是它伸向两边的手：刃那边借余烬（回廊、烬映），
 * 骨那边拆壁垒（壁影、镜壁、破壁）。它一格格挡都不产，想活命就得先学会拆别人的墙。
 *
 * 起手最弱——残烬档七张全是标准件，单张谁都打不过；成型后一回合能连锁到底。
 */
export const DECK_MIRROR: CardDefinition[] = [
  // ── 残烬 cinder ──────────────────────────────────────────────────────────
  { id: 'mirror-01', name: '镜片', deck: 'mirror', tier: 'cinder', cost: 1, type: 'attack', pattern: 'basic-strike',
    text: '造成 5 点伤害，获得 1 层映照。', keywords: ['reflection'],
    lore: '镜中那人，总比你先回一次头。' },
  { id: 'mirror-02', name: '侧廊', deck: 'mirror', tier: 'cinder', cost: 1, type: 'skill', pattern: 'block-basic',
    text: '获得 6 点格挡；空明：若你手牌为空，改为获得 12 点格挡。', keywords: ['empty'],
    lore: '走廊很窄，回声却比人宽得多。' },
  { id: 'mirror-03', name: '借光', deck: 'mirror', tier: 'cinder', cost: 1, type: 'skill', pattern: 'draw',
    text: '流转：抽 2 张牌；本回合你打出的下一张牌费用减少 1。', keywords: ['cycle'],
    lore: '灯是别人的，影子却是自己的。' },
  { id: 'mirror-04', name: '问镜', deck: 'mirror', tier: 'cinder', cost: 1, type: 'skill', pattern: 'tutor',
    text: '流转：从抽牌堆中检索 1 张牌，置入手牌。', keywords: ['cycle'],
    lore: '你问它什么，它就还你什么。' },
  { id: 'mirror-05', name: '拾遗', deck: 'mirror', tier: 'cinder', cost: 1, type: 'skill', pattern: 'recycle',
    text: '拾回：从弃牌堆取回 1 张牌，本回合其费用为 0。', keywords: ['reclaim'],
    lore: '被丢掉的东西，都在镜后堆成了山。' },
  { id: 'mirror-06', name: '转手', deck: 'mirror', tier: 'cinder', cost: 0, type: 'skill', pattern: 'energy',
    text: '爆燃：立刻获得 2 点能量；下回合减少 2 点。', keywords: ['flare'],
    lore: '先借一夜的火，明早再还回去。' },
  { id: 'mirror-07', name: '弃镜', deck: 'mirror', tier: 'cinder', cost: 1, type: 'skill', pattern: 'discard',
    text: '弃 1 张牌，然后抽 2 张牌。', keywords: [],
    lore: '丢掉的那张，才是你真正想要的。' },

  // ── 微光 glimmer ─────────────────────────────────────────────────────────
  { id: 'mirror-08', name: '双影', deck: 'mirror', tier: 'glimmer', cost: 2, type: 'skill', pattern: 'copy',
    text: '复制本回合你打出的上一张牌，复制品带焚尽。', keywords: ['exhaust'],
    lore: '两个人一起回头，就分不清谁是真的。' },
  { id: 'mirror-09', name: '壁影', deck: 'mirror', tier: 'glimmer', cost: 1, type: 'skill', pattern: 'resource-convert',
    text: '消耗 2 层壁垒，获得 3 层映照。', keywords: ['rampart', 'reflection'], bridge: 'bone',
    lore: '墙的影子，比墙本身更懂得复制。' },
  { id: 'mirror-10', name: '回廊', deck: 'mirror', tier: 'glimmer', cost: 2, type: 'attack', pattern: 'resource-build',
    text: '造成 6 点伤害，获得 1 层余烬。回响：把这张牌的一个弱化复制品加入手牌。', keywords: ['echo', 'ember'],
    bridge: 'blade', lore: '走廊没有尽头，只有下一面镜子。' },
  { id: 'mirror-11', name: '倒映', deck: 'mirror', tier: 'glimmer', cost: 2, type: 'skill', pattern: 'recycle',
    text: '返照：把本回合打出的一张牌退回手牌，其费用为 0。', keywords: ['rewind'],
    lore: '打碎过的东西，会自己走回原处。' },
  { id: 'mirror-12', name: '折壁', deck: 'mirror', tier: 'glimmer', cost: 1, type: 'skill', pattern: 'block-convert',
    text: '消耗你所有的格挡，每 3 点抽 1 张牌，至多 3 张。', keywords: [],
    lore: '你以为撞上的是墙，其实是你自己。' },
  { id: 'mirror-13', name: '对望', deck: 'mirror', tier: 'glimmer', cost: 1, type: 'attack', pattern: 'conditional-strike',
    text: '造成 6 点伤害。连缀：本回合已打出过 2 张牌时，额外造成 6 点伤害。', keywords: ['chain'],
    lore: '你看它，它也在看你，谁都不先眨眼。' },
  { id: 'mirror-14', name: '铭影', deck: 'mirror', tier: 'glimmer', cost: 0, type: 'skill', pattern: 'upgrade',
    text: '祭火：失去 5 点生命。刻印：永久强化手牌中的一张牌（伤害与格挡 +3）。', keywords: ['sacrifice', 'inscribe'],
    lore: '名字刻进镜子，就再也擦不掉了。' },
  { id: 'mirror-15', name: '洗镜', deck: 'mirror', tier: 'glimmer', cost: 1, type: 'skill', pattern: 'shuffle',
    text: '流转：把弃牌堆洗回抽牌堆，然后抽 2 张牌。', keywords: ['cycle'],
    lore: '烧掉的、丢掉的，都还能再洗一遍。' },

  // ── 明焰 blaze ───────────────────────────────────────────────────────────
  { id: 'mirror-16', name: '镜壁', deck: 'mirror', tier: 'blaze', cost: 1, type: 'skill', pattern: 'retaliate',
    text: '反震：本回合每次被攻击时，消耗 1 层壁垒，对攻击者造成 6 点伤害。', keywords: ['retaliate', 'rampart'],
    bridge: 'bone', lore: '打在镜子上的拳头，落在自己脸上。' },
  { id: 'mirror-17', name: '烬映', deck: 'mirror', tier: 'blaze', cost: 2, type: 'power', pattern: 'resource-convert',
    text: '每当你获得余烬，就获得等量的映照。', keywords: ['reflection', 'ember'], bridge: 'blade',
    lore: '烧剩的那点红，在镜里又亮了一回。' },
  { id: 'mirror-18', name: '双生', deck: 'mirror', tier: 'blaze', cost: 2, type: 'skill', pattern: 'copy',
    text: '把你手牌中的 1 张牌复制两份，复制品带焚尽。', keywords: ['exhaust'],
    lore: '一个名字，两个同时应答的人。' },
  { id: 'mirror-19', name: '破壁', deck: 'mirror', tier: 'blaze', cost: 2, type: 'attack', pattern: 'resource-spend',
    text: '消耗至多 4 层壁垒，每层对目标造成 4 点伤害。', keywords: ['rampart'], bridge: 'bone',
    lore: '把墙拆下来，砸回墙自己身上。' },
  { id: 'mirror-20', name: '环廊', deck: 'mirror', tier: 'blaze', cost: 2, type: 'skill', pattern: 'draw',
    text: '抽 2 张牌。连缀：本回合已打出过 3 张牌时，再抽 2 张牌。', keywords: ['chain'],
    lore: '一圈又一圈，走廊把自己数丢了。' },
  { id: 'mirror-21', name: '定影', deck: 'mirror', tier: 'blaze', cost: 1, type: 'skill', pattern: 'debuff',
    text: '烙印：标记目标。你对其打出的下一张攻击牌额外造成 10 点伤害。', keywords: ['mark'],
    lore: '被盯上的东西，连影子都不许动。' },

  // ── 长明 everburning ─────────────────────────────────────────────────────
  { id: 'mirror-22', name: '再临', deck: 'mirror', tier: 'everburning', cost: 2, type: 'skill', pattern: 'copy',
    text: '迟滞：下回合开始时，再结算一次本回合打出的最后一张牌。', keywords: ['delay'],
    lore: '你早已走开，回声才刚追上你。' },
  { id: 'mirror-23', name: '焚镜', deck: 'mirror', tier: 'everburning', cost: 2, type: 'power', pattern: 'exhaust-payoff',
    text: '每当你焚尽一张牌，获得 1 点能量。蓄火：本回合未用完的能量保留到下回合。', keywords: ['exhaust', 'bank'],
    lore: '烧掉的每一张，都在镜后重新点着。' },
  { id: 'mirror-24', name: '空镜', deck: 'mirror', tier: 'everburning', cost: 0, type: 'skill', pattern: 'draw',
    text: '空明：若你手牌为空，抽 3 张牌并获得 2 层映照。', keywords: ['empty', 'reflection'],
    lore: '手里什么都没有时，镜子最亮。' },
  { id: 'mirror-25', name: '万花筒', deck: 'mirror', tier: 'everburning', cost: 2, type: 'power', pattern: 'ramp',
    text: '本场战斗中你每打出过 1 张复制品，攻击牌就额外造成 3 点伤害。', keywords: [],
    lore: '碎玻璃转起来，就成了一整个世界。' },
  { id: 'mirror-26', name: '回廊尽处', deck: 'mirror', tier: 'everburning', cost: 2, type: 'skill', pattern: 'recycle',
    text: '返照：把本回合你打出过的所有牌退回手牌。', keywords: ['rewind'],
    lore: '走到尽头才发现，尽头也是一面镜子。' },

  // ── 星陨 starfall ────────────────────────────────────────────────────────
  { id: 'mirror-27', name: '万象镜', deck: 'mirror', tier: 'starfall', cost: 3, type: 'power', pattern: 'exhaust-payoff',
    text: '你打出的复制品不再带焚尽；每当你打出复制品，抽 1 张牌。', keywords: ['exhaust'],
    lore: '它不制造光，只把已有的光再数一遍。' },
  { id: 'mirror-28', name: '终映', deck: 'mirror', tier: 'starfall', cost: 3, type: 'attack', pattern: 'finisher',
    text: '造成 6 点伤害。本回合你每消耗过 1 层映照，此牌就额外结算一次。', keywords: ['reflection'],
    lore: '镜子照到最后，连出手的人也照进去。' },
];
