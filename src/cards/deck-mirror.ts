import type { CardDefinition } from './types';

/**
 * 千面回廊 —— 镜的打法核心是复制与转化。
 *
 * 它靠 **映照** 把打出的牌再复制一次，把双方资源互相翻转，并用检索/回收/弃牌/洗牌
 * 不停地重排自己的牌组。它不产出壁垒，只消耗别人的壁垒；五张 bridge 牌就是它伸向
 * 骨与刃的手：骨那边把壁垒翻倍、拆成伤害或换成映照，刃那边把余烬与锋锐烧成映照。
 *
 * 起手最弱，成型后一回合能连锁到底。
 */
export const DECK_MIRROR: CardDefinition[] = [
  // ── 残烬 cinder ──────────────────────────────────────────────────────────
  { id: 'mirror-01', name: '镜片', deck: 'mirror', tier: 'cinder', cost: 1, type: 'attack',
    text: '造成 5 点伤害，获得 1 层映照。', keywords: ['reflection'], lore: '镜中那人，总比你先回一次头。' },
  { id: 'mirror-02', name: '倒影', deck: 'mirror', tier: 'cinder', cost: 1, type: 'attack',
    text: '造成 6 点伤害。', keywords: [], lore: '水面替你挨了这一刀，纹丝不动。' },
  { id: 'mirror-03', name: '侧廊', deck: 'mirror', tier: 'cinder', cost: 1, type: 'skill',
    text: '获得 4 点格挡，抽 1 张牌。', keywords: [], lore: '走廊很窄，回声却比人宽得多。' },
  { id: 'mirror-04', name: '拾遗', deck: 'mirror', tier: 'cinder', cost: 1, type: 'skill',
    text: '从弃牌堆随机取回 1 张牌，置入手牌。', keywords: [], lore: '被丢掉的东西，都在镜后堆成了山。' },
  { id: 'mirror-05', name: '借光', deck: 'mirror', tier: 'cinder', cost: 1, type: 'skill',
    text: '抽 1 张牌，获得 1 层映照。', keywords: ['reflection'], lore: '灯是别人的，影子却是自己的。' },
  { id: 'mirror-06', name: '转手', deck: 'mirror', tier: 'cinder', cost: 1, type: 'attack',
    text: '造成 4 点伤害，抽 1 张牌。', keywords: [], lore: '刀刃换了只手，仍是同一把刀。' },
  { id: 'mirror-07', name: '鉴壁', deck: 'mirror', tier: 'cinder', cost: 1, type: 'skill',
    text: '获得 5 点格挡。若你拥有壁垒，抽 1 张牌。', keywords: ['rampart'], lore: '墙也照见了自己，于是厚了一寸。' },

  // ── 微光 glimmer ─────────────────────────────────────────────────────────
  { id: 'mirror-08', name: '双影', deck: 'mirror', tier: 'glimmer', cost: 2, type: 'attack',
    text: '造成 7 点伤害，获得 2 层映照。', keywords: ['reflection'], lore: '两个人一起回头，就分不清谁是真的。' },
  { id: 'mirror-09', name: '问镜', deck: 'mirror', tier: 'glimmer', cost: 1, type: 'skill',
    text: '从抽牌堆中检索 1 张牌，置入手牌。', keywords: [], lore: '你问它什么，它就还你什么。' },
  { id: 'mirror-10', name: '弃镜', deck: 'mirror', tier: 'glimmer', cost: 1, type: 'skill',
    text: '弃 1 张牌，抽 2 张牌。', keywords: [], lore: '丢掉的镜子，裂痕里还留着东西。' },
  { id: 'mirror-11', name: '重影', deck: 'mirror', tier: 'glimmer', cost: 2, type: 'skill',
    text: '复制本回合打出的上一张牌，复制品带消耗。', keywords: [], lore: '它比你慢了半步，其余一模一样。' },
  { id: 'mirror-12', name: '环廊', deck: 'mirror', tier: 'glimmer', cost: 2, type: 'skill',
    text: '抽 2 张牌，获得 1 层映照。', keywords: ['reflection'], lore: '走廊没有尽头，只有下一面镜子。' },
  { id: 'mirror-13', name: '转映', deck: 'mirror', tier: 'glimmer', cost: 2, type: 'attack',
    text: '造成 8 点伤害，获得 1 层映照。', keywords: ['reflection'], lore: '痛绕了一圈，回到出手的人身上。' },
  { id: 'mirror-14', name: '镜像壁', deck: 'mirror', tier: 'glimmer', cost: 2, type: 'skill',
    text: '获得 10 点格挡。', keywords: [], lore: '你以为撞上了墙，其实撞上了自己。' },
  { id: 'mirror-15', name: '壁影', deck: 'mirror', tier: 'glimmer', cost: 1, type: 'skill',
    text: '消耗 1 层壁垒，获得 2 层映照。', keywords: ['rampart', 'reflection'], bridge: 'bone',
    lore: '墙的影子，比墙本身更懂得复制。' },

  // ── 明焰 blaze ───────────────────────────────────────────────────────────
  { id: 'mirror-16', name: '叠壁', deck: 'mirror', tier: 'blaze', cost: 2, type: 'skill',
    text: '使你当前的壁垒层数翻倍。', keywords: ['rampart'], bridge: 'bone',
    lore: '两面镜子对照，墙就没有了尽头。' },
  { id: 'mirror-17', name: '烬映', deck: 'mirror', tier: 'blaze', cost: 1, type: 'skill',
    text: '消耗 3 层余烬，获得 3 层映照。', keywords: ['ember', 'reflection'], bridge: 'blade',
    lore: '烧剩的那点红，在镜里又亮了一回。' },
  { id: 'mirror-18', name: '锋返', deck: 'mirror', tier: 'blaze', cost: 1, type: 'skill',
    text: '消耗 2 层锋锐，获得 3 层映照。', keywords: ['edge', 'reflection'], bridge: 'blade',
    lore: '最利的刃照谁断谁，包括它自己。' },
  { id: 'mirror-19', name: '对望', deck: 'mirror', tier: 'blaze', cost: 2, type: 'skill',
    text: '抽 2 张牌。若你拥有映照，改为抽 3 张牌。', keywords: ['reflection'], lore: '你看它，它也在看你，谁都不先眨眼。' },
  { id: 'mirror-20', name: '破壁', deck: 'mirror', tier: 'blaze', cost: 2, type: 'attack',
    text: '消耗至多 3 层壁垒，每层造成 4 点伤害。', keywords: ['rampart'], bridge: 'bone',
    lore: '把墙拆下来，砸回墙自己身上。' },
  { id: 'mirror-21', name: '散镜', deck: 'mirror', tier: 'blaze', cost: 2, type: 'skill',
    text: '弃 2 张牌，抽 3 张牌，获得 1 层映照。', keywords: ['reflection'], lore: '拆开的镜子，每一片都还在照。' },

  // ── 长明 everburning ─────────────────────────────────────────────────────
  { id: 'mirror-22', name: '万花筒', deck: 'mirror', tier: 'everburning', cost: 2, type: 'power',
    text: '每回合你首次打出牌时，获得 1 层映照。', keywords: ['reflection'], lore: '碎玻璃转起来，就成了一整个世界的花。' },
  { id: 'mirror-23', name: '双生', deck: 'mirror', tier: 'everburning', cost: 2, type: 'skill',
    text: '复制你手牌中的 1 张牌，复制品带消耗。若你拥有映照，将该牌再复制 1 次。', keywords: ['reflection'],
    lore: '一个名字，两个同时应答的人。' },
  { id: 'mirror-24', name: '返照', deck: 'mirror', tier: 'everburning', cost: 1, type: 'skill',
    text: '将弃牌堆洗回抽牌堆，抽 2 张牌，获得 1 层映照。', keywords: ['reflection'], lore: '打碎过的东西，会自己走回原处。' },
  { id: 'mirror-25', name: '倒灌', deck: 'mirror', tier: 'everburning', cost: 2, type: 'attack',
    text: '消耗至多 3 层映照，每层造成 5 点伤害。', keywords: ['reflection'], lore: '影子倒着长，一直长回你身上。' },
  { id: 'mirror-26', name: '镜厅', deck: 'mirror', tier: 'everburning', cost: 3, type: 'rite',
    text: '每当你打出复制品，抽 1 张牌。每回合结束时，获得 1 层映照。', keywords: ['reflection'],
    lore: '一屋子站满了你，谁也不肯先动。' },

  // ── 星陨 starfall ────────────────────────────────────────────────────────
  { id: 'mirror-27', name: '无尽回廊', deck: 'mirror', tier: 'starfall', cost: 3, type: 'attack',
    text: '造成 14 点伤害。本回合你每消耗过 1 层映照，伤害增加 4 点。', keywords: ['reflection'],
    lore: '你走过的每一步，都有人替你重走一遍。' },
  { id: 'mirror-28', name: '万象镜', deck: 'mirror', tier: 'starfall', cost: 3, type: 'rite',
    text: '每回合开始时，获得 2 层映照。', keywords: ['reflection'], lore: '它不制造光，只把已有的光再数一遍。' },
];
