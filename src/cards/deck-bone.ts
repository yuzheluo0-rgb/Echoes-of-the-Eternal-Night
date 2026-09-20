import type { CardDefinition } from './types';

/**
 * 长明壁垒 (bone) —— 堆格挡与壁垒，把防御本身变成武器：反伤、以格挡值打伤害、
 * 把多余的防御转成进攻。极其耐打、节奏慢、清场偏弱，越拖越强。
 */
export const DECK_BONE: CardDefinition[] = [
  // ── 残烬 cinder ───────────────────────────────────────────────
  { id: 'bone-01', name: '架盾', deck: 'bone', tier: 'cinder', cost: 1, type: 'skill',
    text: '获得 6 点格挡，获得 1 层锋锐。', keywords: ['edge'], lore: '亡者的骨，生者的墙。' },
  { id: 'bone-02', name: '骨刺', deck: 'bone', tier: 'cinder', cost: 1, type: 'attack',
    text: '造成 6 点伤害。', keywords: [], lore: '折断的肋骨，仍旧朝着来路。' },
  { id: 'bone-03', name: '垒石', deck: 'bone', tier: 'cinder', cost: 1, type: 'skill',
    text: '获得 6 点格挡。', keywords: [], lore: '一块压一块，直到夜压不进来。' },
  { id: 'bone-04', name: '撞角', deck: 'bone', tier: 'cinder', cost: 1, type: 'attack',
    text: '造成 5 点伤害。若你当前有格挡，额外造成 3 点伤害。', keywords: [], lore: '墙也会倒，倒在谁身上谁才知道疼。' },
  { id: 'bone-05', name: '沉垒', deck: 'bone', tier: 'cinder', cost: 1, type: 'skill',
    text: '获得 4 点格挡，获得 1 层壁垒。', keywords: ['rampart'], lore: '沉在最下面的那一层，从不曾被推倒。' },
  { id: 'bone-06', name: '楔石', deck: 'bone', tier: 'cinder', cost: 1, type: 'attack',
    text: '造成 4 点伤害，获得 5 点格挡。', keywords: [], lore: '拱顶正中那一块，替所有人受着力。' },
  { id: 'bone-07', name: '砺石', deck: 'bone', tier: 'cinder', cost: 1, type: 'skill',
    text: '获得 4 点格挡，抽 1 张牌。', keywords: [], lore: '磨得越薄，留下的刃就越亮。' },

  // ── 微光 glimmer ──────────────────────────────────────────────
  { id: 'bone-08', name: '白骨墙', deck: 'bone', tier: 'glimmer', cost: 2, type: 'skill',
    text: '获得 10 点格挡。', keywords: [], lore: '一百具骨架垒起来，比石头更懂得守夜。' },
  { id: 'bone-09', name: '殉道', deck: 'bone', tier: 'glimmer', cost: 1, type: 'skill',
    text: '获得 8 点格挡，失去 3 点生命。', keywords: [], lore: '总得有人先站到缺口那里去。' },
  { id: 'bone-10', name: '收烬', deck: 'bone', tier: 'glimmer', cost: 1, type: 'skill',
    text: '消耗你所有的余烬，每层获得 2 点格挡。', keywords: ['ember'], bridge: 'flame',
    lore: '火虽灭了，灰烬仍烫得握不住。' },
  { id: 'bone-11', name: '拒马', deck: 'bone', tier: 'glimmer', cost: 2, type: 'skill',
    text: '获得 6 点格挡，获得 2 层壁垒。', keywords: ['rampart'], lore: '尖的那头朝外，家就在它背后。' },
  { id: 'bone-12', name: '落石', deck: 'bone', tier: 'glimmer', cost: 2, type: 'attack',
    text: '造成 7 点伤害。你每有 1 层壁垒，额外造成 1 点伤害。', keywords: ['rampart'],
    lore: '高处那面墙，终于决定自己下来。' },
  { id: 'bone-13', name: '砺锋', deck: 'bone', tier: 'glimmer', cost: 1, type: 'skill',
    text: '获得 3 点格挡，获得 2 层锋锐。', keywords: ['edge'], lore: '骨上磨出的白，是刃原本的颜色。' },
  { id: 'bone-14', name: '骨棘', deck: 'bone', tier: 'glimmer', cost: 1, type: 'skill',
    text: '本回合内，每次受到攻击时，对攻击者造成 3 点伤害。', keywords: [],
    lore: '想拆墙的手，得先学会疼。' },
  { id: 'bone-15', name: '焦骨', deck: 'bone', tier: 'glimmer', cost: 1, type: 'attack',
    text: '造成 4 点伤害。若目标有灼烧，额外造成 4 点伤害。', keywords: ['scorch'], bridge: 'flame',
    lore: '烧过的那一截，轻轻一碰就碎。' },

  // ── 明焰 blaze ────────────────────────────────────────────────
  { id: 'bone-16', name: '回震', deck: 'bone', tier: 'blaze', cost: 2, type: 'attack',
    text: '造成等同于你当前格挡的伤害。', keywords: [], lore: '砸在墙上的力，原路找回它的主人。' },
  { id: 'bone-17', name: '照壁', deck: 'bone', tier: 'blaze', cost: 1, type: 'skill',
    text: '获得 5 点格挡，获得 1 层映照。', keywords: ['reflection'], bridge: 'mirror',
    lore: '墙照着墙，照出一座不存在的城。' },
  { id: 'bone-18', name: '不动', deck: 'bone', tier: 'blaze', cost: 2, type: 'power',
    text: '每回合开始时获得 3 点格挡，获得 1 层锋锐。', keywords: ['edge'],
    lore: '它不曾移动，于是夜只能绕着走。' },
  { id: 'bone-19', name: '断骨', deck: 'bone', tier: 'blaze', cost: 2, type: 'attack',
    text: '造成 12 点伤害，失去 4 点生命。', keywords: [], lore: '拿自己那根，换对面那根。' },
  { id: 'bone-20', name: '铁壁', deck: 'bone', tier: 'blaze', cost: 2, type: 'skill',
    text: '获得 9 点格挡，获得 1 层锋锐。', keywords: ['edge'], lore: '铁会锈，骨头却只会越磨越白。' },
  { id: 'bone-21', name: '铸镜', deck: 'bone', tier: 'blaze', cost: 2, type: 'skill',
    text: '消耗你所有的壁垒，每层获得 1 层映照。', keywords: ['rampart', 'reflection'], bridge: 'mirror',
    lore: '把身后的墙，熔成一面镜子。' },

  // ── 长明 everburning ──────────────────────────────────────────
  { id: 'bone-22', name: '磐石', deck: 'bone', tier: 'everburning', cost: 2, type: 'skill',
    text: '获得 13 点格挡，获得 2 层壁垒。', keywords: ['rampart'], lore: '山不说话，山只是站在那里。' },
  { id: 'bone-23', name: '崩城', deck: 'bone', tier: 'everburning', cost: 2, type: 'attack',
    text: '造成 8 点伤害。你每有 1 层壁垒，额外造成 2 点伤害。', keywords: ['rampart'],
    lore: '它倒下的时候，整座城都在震。' },
  { id: 'bone-24', name: '棘墙', deck: 'bone', tier: 'everburning', cost: 2, type: 'rite',
    text: '每当你受到攻击，对攻击者造成 3 点伤害，获得 1 层锋锐。', keywords: ['edge'],
    lore: '碰过它的人，从此记得墙也会痛。' },
  { id: 'bone-25', name: '对影', deck: 'bone', tier: 'everburning', cost: 2, type: 'skill',
    text: '获得等同于你当前格挡的格挡，获得 1 层映照。', keywords: ['reflection'], bridge: 'mirror',
    lore: '你的墙与它的影子，一起挡住了夜。' },
  { id: 'bone-26', name: '破城', deck: 'bone', tier: 'everburning', cost: 2, type: 'attack',
    text: '造成 10 点伤害。若你当前格挡不低于 10，额外造成 8 点伤害。', keywords: [],
    lore: '墙推到尽头，就该轮到对方了。' },

  // ── 星陨 starfall ─────────────────────────────────────────────
  { id: 'bone-27', name: '天倾', deck: 'bone', tier: 'starfall', cost: 3, type: 'attack',
    text: '造成两倍于你当前格挡的伤害。', keywords: [], lore: '天塌下来那日，你脚下只有自己的墙。' },
  { id: 'bone-28', name: '不朽', deck: 'bone', tier: 'starfall', cost: 3, type: 'rite',
    text: '每回合开始时获得 4 层壁垒，获得 1 层锋锐。', keywords: ['rampart', 'edge'],
    lore: '骨头烂尽之后，墙还站在那里。' },
];
