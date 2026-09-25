import type { CardDefinition } from './types';

/**
 * 长明壁垒 (bone) —— 格挡不是终点，而是燃料。
 *
 * 这副牌组把每一次防御都当成下一次进攻的原料：格挡可以换成锋锐（砺锋）、换成伤害（楔石、回震）、
 * 换成映照（铸镜、对影）；壁垒让墙留到下一回合，而下一回合的墙又更厚（沉垒、垒壁、不动）。
 * 它几乎不靠直伤取胜，而是靠反震、迟滞和消耗整面墙的终结技把对手拖进自己的节奏。
 *
 * 三张 bridge 伸向镜：照壁、铸镜、对影；两张伸向焰：收焰、炭墙——把敌人身上的灼烧拆下来砌墙。
 * 弱点：清场只有一张倾墙，启动慢；对手不打你，反震就换不到东西。
 */
export const DECK_BONE: CardDefinition[] = [
  // ── 残烬 · cinder：0~1 费，七张七种形状，各自只做一件事 ────────────────
  { id: 'bone-01', name: '架盾', deck: 'bone', tier: 'cinder', cost: 1, type: 'skill', pattern: 'block-basic',
    text: '获得 6 点格挡。若你拥有壁垒，额外获得 3 点格挡。', keywords: ['rampart'],
    lore: '亡者的骨，生者的墙，夜撞上来就碎。' },
  { id: 'bone-02', name: '骨刺', deck: 'bone', tier: 'cinder', cost: 1, type: 'attack', pattern: 'conditional-strike',
    text: '造成 5 点伤害。若你当前有格挡，额外造成 3 点伤害。', keywords: [],
    lore: '折断的肋骨，仍旧朝着来路。' },
  { id: 'bone-03', name: '沉垒', deck: 'bone', tier: 'cinder', cost: 1, type: 'skill', pattern: 'resource-build',
    text: '获得 1 层壁垒和 4 点格挡。', keywords: ['rampart'],
    lore: '沉在最下面的那一层，从不曾被推倒。' },
  { id: 'bone-04', name: '楔石', deck: 'bone', tier: 'cinder', cost: 1, type: 'attack', pattern: 'block-convert',
    text: '失去 5 点格挡，造成 9 点伤害。', keywords: [],
    lore: '拱顶正中那一块，替所有人受着力。' },
  { id: 'bone-05', name: '砺石', deck: 'bone', tier: 'cinder', cost: 0, type: 'skill', pattern: 'discard',
    // 「随机」 is printed because that is what the engine does. `playCard` carries a target and nothing
    // else, so there is no channel for a hand-selection prompt — the same constraint that made 拾回
    // take the top of the pile. A card that says 「弃 1 张牌」 and then picks for you is the 打磨 bug in
    // a different coat: the printed text is the one the player believes.
    text: '流转：抽 1 张牌，然后随机弃 1 张牌。', keywords: ['cycle'],
    lore: '磨得越薄，留下的刃就越亮。' },
  { id: 'bone-06', name: '骨棘', deck: 'bone', tier: 'cinder', cost: 1, type: 'skill', pattern: 'retaliate',
    text: '反震：本回合内每次被攻击时，对攻击者造成 3 点伤害。', keywords: ['retaliate'],
    lore: '想拆墙的手，得先学会疼。' },
  { id: 'bone-07', name: '拾骨', deck: 'bone', tier: 'cinder', cost: 1, type: 'skill', pattern: 'recycle',
    text: '拾回：从弃牌堆取回一张牌。空明：额外抽 1 张牌。', keywords: ['reclaim', 'empty'],
    lore: '同伴倒下时，总有人记得把他带回来。' },

  // ── 微光 · glimmer：牌组的骨架，格挡在这里第一次变成别的东西 ──────────
  { id: 'bone-08', name: '白骨墙', deck: 'bone', tier: 'glimmer', cost: 2, type: 'skill', pattern: 'block-burst',
    text: '获得 9 点格挡。空明：改为获得 14 点格挡。', keywords: ['empty'],
    lore: '一百具骨架垒起来，比石头更懂得守夜。' },
  { id: 'bone-09', name: '殉道', deck: 'bone', tier: 'glimmer', cost: 0, type: 'skill', pattern: 'sacrifice',
    text: '祭火：失去 5 点生命，获得 12 点格挡和 1 层壁垒。', keywords: ['sacrifice', 'rampart'],
    lore: '总得有人先站到缺口那里去。' },
  { id: 'bone-10', name: '拒马', deck: 'bone', tier: 'glimmer', cost: 2, type: 'skill', pattern: 'retaliate',
    text: '反震：本回合内每次被攻击时，对攻击者造成 3 点伤害，并获得 1 层锋锐。', keywords: ['retaliate', 'edge'],
    lore: '尖的那头朝外，家就在它背后。' },
  { id: 'bone-11', name: '砺锋', deck: 'bone', tier: 'glimmer', cost: 1, type: 'skill', pattern: 'resource-convert',
    text: '消耗 5 点格挡，获得 3 层锋锐。', keywords: ['edge'],
    lore: '骨上磨出的白，是刃原本的颜色。' },
  { id: 'bone-12', name: '落石', deck: 'bone', tier: 'glimmer', cost: 2, type: 'attack', pattern: 'conditional-strike',
    text: '造成 7 点伤害。你每有 2 层壁垒，额外造成 1 点伤害。', keywords: ['rampart'],
    lore: '高处那面墙，终于决定自己下来。' },
  { id: 'bone-13', name: '骨钉', deck: 'bone', tier: 'glimmer', cost: 1, type: 'attack', pattern: 'debuff',
    text: '造成 4 点伤害。烙印：被标记的敌人受到你的攻击时额外受到 3 点伤害。', keywords: ['mark'],
    lore: '钉进骨头里的那根，会一直记着仇。' },
  { id: 'bone-14', name: '垒壁', deck: 'bone', tier: 'glimmer', cost: 1, type: 'skill', pattern: 'resource-build',
    text: '获得 1 层壁垒。连缀：若你本回合已打出至少 3 张牌，改为获得 4 层壁垒。', keywords: ['rampart', 'chain'],
    lore: '一层压一层，直到夜压不进来。' },
  { id: 'bone-15', name: '收焰', deck: 'bone', tier: 'glimmer', cost: 1, type: 'skill', pattern: 'dot-convert',
    text: '引爆：消耗目标身上全部灼烧，每 2 层使你获得 1 层壁垒。', keywords: ['detonate', 'scorch', 'rampart'],
    bridge: 'flame', lore: '火灭了，灰还是热的，正好砌进墙里。' },

  // ── 明焰 · blaze：各自有一手绝活的中坚 ────────────────────────────────
  { id: 'bone-16', name: '回震', deck: 'bone', tier: 'blaze', cost: 2, type: 'attack', pattern: 'block-convert',
    text: '造成等同于你当前格挡的伤害。', keywords: [],
    lore: '砸在墙上的力，原路找回它的主人。' },
  { id: 'bone-17', name: '照壁', deck: 'bone', tier: 'blaze', cost: 2, type: 'skill', pattern: 'copy',
    text: '获得 5 点格挡，获得 1 层映照。回响：将这张牌的一个弱化复制品加入手牌。',
    keywords: ['reflection', 'echo'], bridge: 'mirror', lore: '墙照着墙，照出一座不存在的城。' },
  { id: 'bone-18', name: '不动', deck: 'bone', tier: 'blaze', cost: 2, type: 'power', pattern: 'ramp',
    text: '每回合开始时获得 2 点格挡和 1 层壁垒。', keywords: ['rampart'],
    lore: '它不曾移动，于是夜只能绕着走。' },
  { id: 'bone-19', name: '炭墙', deck: 'bone', tier: 'blaze', cost: 2, type: 'skill', pattern: 'block-basic',
    text: '获得 6 点格挡，并获得等同于目标灼烧层数的格挡。', keywords: ['scorch'],
    bridge: 'flame', lore: '烧成炭的那面墙，比新砌的更硬。' },
  { id: 'bone-20', name: '倾墙', deck: 'bone', tier: 'blaze', cost: 2, type: 'attack', pattern: 'aoe',
    text: '对所有敌人造成 4 点伤害。空明：改为造成 8 点伤害。', keywords: ['empty'],
    lore: '墙倒下来的时候，不分敌我，只分远近。' },
  { id: 'bone-21', name: '封炉', deck: 'bone', tier: 'blaze', cost: 1, type: 'skill', pattern: 'energy',
    text: '蓄火：本回合未用完的能量保留到下回合。获得 1 层壁垒。', keywords: ['bank', 'rampart'],
    lore: '炉口一封，火就在里头数着时辰。' },

  // ── 长明 · everburning：不添柴也能烧下去的引擎 ────────────────────────
  { id: 'bone-22', name: '磐石', deck: 'bone', tier: 'everburning', cost: 2, type: 'skill', pattern: 'block-burst',
    text: '迟滞：下回合开始时，你每有 1 层壁垒便获得 3 点格挡。', keywords: ['rampart', 'delay'],
    lore: '山不说话，山只是站在那里。' },
  { id: 'bone-23', name: '崩城', deck: 'bone', tier: 'everburning', cost: 2, type: 'attack', pattern: 'multi-hit',
    text: '造成 3 点伤害，重复 4 次。你每有 4 层壁垒，额外重复 1 次，最多 2 次。', keywords: ['rampart'],
    lore: '它倒下的时候，整座城都在震。' },
  { id: 'bone-24', name: '铸镜', deck: 'bone', tier: 'everburning', cost: 1, type: 'skill', pattern: 'resource-convert',
    text: '消耗你所有的壁垒，每层获得 1 层映照。', keywords: ['rampart', 'reflection'],
    bridge: 'mirror', lore: '把身后的墙，熔成一面镜子。' },
  { id: 'bone-25', name: '对影', deck: 'bone', tier: 'everburning', cost: 2, type: 'skill', pattern: 'copy',
    text: '复制你当前的格挡，获得 1 层映照。焚尽。', keywords: ['reflection', 'exhaust'],
    bridge: 'mirror', lore: '你的墙与它的影子，一起挡住了夜。' },
  { id: 'bone-26', name: '棘墙', deck: 'bone', tier: 'everburning', cost: 2, type: 'rite', pattern: 'retaliate',
    text: '每当你受到攻击，对攻击者造成 3 点伤害，并获得 1 层壁垒。', keywords: ['rampart'],
    lore: '碰过它的人，从此记得墙也会痛。' },

  // ── 星陨 · starfall：一副牌组只承载得起这些 ───────────────────────────
  { id: 'bone-27', name: '天倾', deck: 'bone', tier: 'starfall', cost: 3, type: 'attack', pattern: 'finisher',
    text: '消耗你所有的格挡，造成 3 倍于此数值的伤害。焚尽。', keywords: ['exhaust'],
    lore: '天塌下来那日，你脚下只有自己的墙。' },
  { id: 'bone-28', name: '不朽', deck: 'bone', tier: 'starfall', cost: 3, type: 'rite', pattern: 'ramp',
    text: '每当你获得格挡时，获得 1 层锋锐，每回合至多 3 次。壁垒每层额外保留 1 点格挡。',
    keywords: ['rampart', 'edge'], lore: '骨头烂尽之后，墙还站在那里。' },
];
