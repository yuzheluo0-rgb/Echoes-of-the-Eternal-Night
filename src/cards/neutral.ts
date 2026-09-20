import type { CardDefinition } from './types';

/**
 * Cards with no archetype. Every deck may carry a few, and they do two jobs at once: they are where
 * most of the traffic between decks happens, and they are the only place a player can see a
 * mechanic their own deck does not own.
 *
 * Each one is deliberately a different shape — a build, a burst, a conversion, a manipulation —
 * rather than a differently numbered version of the same sentence.
 */
export const NEUTRAL: CardDefinition[] = [
  { id: 'neutral-01', name: '拾薪', deck: 'neutral', tier: 'cinder', cost: 0, type: 'skill', pattern: 'resource-build',
    text: '获得 1 层余烬。空明：若你的手牌为空，改为获得 3 层。', keywords: ['ember', 'empty'], lore: '火要有人看着，才肯继续烧。' },
  { id: 'neutral-02', name: '垒骨', deck: 'neutral', tier: 'cinder', cost: 0, type: 'skill', pattern: 'block-basic',
    text: '获得 4 点格挡。', keywords: [], lore: '一根骨头挡不住什么，一千根可以。' },
  { id: 'neutral-03', name: '磨石', deck: 'neutral', tier: 'glimmer', cost: 1, type: 'skill', pattern: 'upgrade',
    text: '刻印：本场战斗中强化手牌里的一张牌，其伤害与格挡 +3。', keywords: ['inscribe'], lore: '钝了的不是刃，是拿刃的人。' },
  { id: 'neutral-04', name: '星火', deck: 'neutral', tier: 'glimmer', cost: 1, type: 'attack', pattern: 'dot-apply',
    text: '造成 5 点伤害，施加 2 层灼烧。', keywords: ['scorch'], lore: '从一粒火星开始，长夜就有了裂口。' },
  { id: 'neutral-05', name: '照影', deck: 'neutral', tier: 'glimmer', cost: 1, type: 'skill', pattern: 'resource-build',
    text: '获得 1 层映照，抽 1 张牌。', keywords: ['reflection'], lore: '镜子不说话，它只是重复你说过的。' },
  { id: 'neutral-06', name: '换气', deck: 'neutral', tier: 'glimmer', cost: 1, type: 'skill', pattern: 'discard',
    text: '流转：抽 2 张牌，然后弃 1 张牌。', keywords: ['cycle'], lore: '火不能一直烧同一口空气。' },
  { id: 'neutral-07', name: '灰烬号角', deck: 'neutral', tier: 'blaze', cost: 2, type: 'power', pattern: 'ramp',
    text: '每回合开始时，获得 1 层余烬。', keywords: ['ember'], lore: '吹响它的人，从此不再自己生火。' },
  { id: 'neutral-08', name: '挡火墙', deck: 'neutral', tier: 'blaze', cost: 2, type: 'skill', pattern: 'resource-convert',
    text: '获得 12 点格挡。消耗 3 层余烬，改为获得 18 点格挡。', keywords: ['ember'], bridge: 'flame', lore: '把烧过的东西垒起来，就是墙。' },
  { id: 'neutral-09', name: '熔接', deck: 'neutral', tier: 'everburning', cost: 2, type: 'skill', pattern: 'block-convert',
    text: '失去一半格挡，获得等量的锋锐。', keywords: ['edge'], bridge: 'bone', lore: '墙拆下来的铁，正好用来开刃。' },
  { id: 'neutral-10', name: '余晖', deck: 'neutral', tier: 'starfall', cost: 3, type: 'rite', pattern: 'ramp',
    text: '每回合开始时，获得 1 层余烬、1 层锋锐与 1 层壁垒。', keywords: ['ember', 'edge', 'rampart'], lore: '太阳落下之后，光并没有消失，只是换了地方。' },
];
