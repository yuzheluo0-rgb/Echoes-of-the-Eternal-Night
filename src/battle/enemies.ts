import type { EnemyDefinition, EnemyState, Intent, PlayerState, StatusId } from './types';

/**
 * Chapter I — 草原 · 余烬营地 (THE LAST HEARTH).
 *
 * This is the map's first region, so the bestiary is drawn from what is actually out there: the
 * grassland's hostile animal is the wolf, the hidden site is 萤火树洞 where fireflies rise out of a
 * hollow tree, and the camp's own three trials are 荒野巡夜 / 失落的商队 / 草原守望者. The chapter's
 * promise — 「长夜之中，总有人守着一簇火」 — is also its boss's mechanic.
 *
 * One rule shapes the whole roster: **every enemy makes you answer a different question.** Two
 * health bars and a damage number teach nothing; "kill the small one first" or "do not end your turn
 * holding that" teaches the game.
 *
 *   影狼        同伴越多咬得越狠 —— 先清数量还是先打大的
 *   萤火        它在打你，也在给你余烬 —— 你要不要杀一个对你有用的小东西
 *   拾荒犬      翻你的弃牌堆 —— 丢掉的牌不再是你的
 *   驮兽        皮厚咬得轻，但会蓄力冲撞 —— 什么时候该防
 *   守灯人残影  削你的能量 —— 节奏被打乱时要重排
 *   潜草者      前几回合不动，然后一口 16 —— 预告了的大招，你来得及吗
 *   商队首领    越打越硬 —— 逼你在它清点完货物之前解决它
 *   头狼        嚎叫招来同伴并强化全体 —— 它的嚎叫就是计时器
 *   余烬守望者  往你的牌堆里塞一张对你有利、对它更有利的誓言 —— 用它，还是忍着
 *
 * The boss's gimmick is the chapter's thesis. 断罪之刃 and 长明壁垒 both win by building an engine;
 * 换岗 hands you a card that feeds the engine and feeds the boss at the same time, so the question is
 * no longer "can I make this work" but "is it worth it".
 */

const A = (amount: number, times = 1, note?: string): Intent => ({ kind: 'attack', amount, times, note });
const BLOCK = (amount: number, note?: string): Intent => ({ kind: 'block', amount, note });
const BUFF = (status: StatusId, amount: number, note?: string): Intent => ({ kind: 'buff', status, amount, note });
const DEBUFF = (status: StatusId, amount: number, note?: string): Intent => ({ kind: 'debuff', status, amount, note });
const STEAL = (status: StatusId, note?: string): Intent => ({ kind: 'steal', status, note });
const SUMMON = (id: string, note?: string): Intent => ({ kind: 'summon', id, note });

export interface EnemyScript {
  /** The intents for this turn. `self.turn` is already advanced, so 0 is its first turn. */
  (self: EnemyState, player: PlayerState): Intent[];
}
const rotate = (turns: Intent[][]): EnemyScript => self => turns[self.turn % turns.length];

export const SCRIPTS: Record<string, EnemyScript> = {
  /** 影狼 — the grassland wolf that learned not to howl. Weak alone, and it is never alone. */
  shadewolf: rotate([[A(5)]]),

  /** 萤火 — the only enemy in the chapter you might not want to kill. It bites for 3, and every
   *  turn it hands you 1 层余烬. Kill it and the damage stops; keep it and the engine keeps growing.
   *  A two-turn clock either way. */
  emberfly: rotate([[A(3)], [A(3)]]),

  /** 拾荒犬 — eats your discard pile. Everything you throw away stops being yours. */
  scavenger: rotate([[A(6)], [A(6)], [{ kind: 'bury', amount: 1, note: '翻找' }]]),

  /** 商队驮兽 — thick and slow, then it charges. The charge is telegraphed a full turn ahead. */
  packbeast: rotate([[A(4)], [A(4)], [A(15, 1, '冲撞')]]),

  /** 守灯人残影 — the camp's own watch, still doing its rounds. It drains your energy, not your life. */
  watchershade: rotate([[A(5)], [DEBUFF('drained', 2, '巡视')]]),

  /** 潜草者 — lies still in the grass for three turns, then bites for 16. Everything about it is a
   *  question of whether you dealt with it in time. */
  stalker: (self, player) => {
    void player;
    if (self.turn < 3) return [BLOCK(4, '潜伏')];
    return [A(16, 1, '扑击')];
  },

  /** 商队首领 — the caravan's master, still counting cargo. Harder to kill every turn it survives. */
  caravanguard: rotate([[A(9)], [BLOCK(10, '清点货物'), BUFF('strength', 2, '清点货物')]]),

  /** 头狼 — the pack leader. The howl is the clock: after it, everything on the field hits harder
   *  and there are two more wolves. */
  alphawolf: rotate([
    [A(9)],
    [SUMMON('shadewolf', '嚎叫'), SUMMON('shadewolf', '嚎叫'), BUFF('strength', 2, '嚎叫')],
    [A(9, 2, '合围')],
  ]),

  /** 余烬守望者 — the chapter boss. See the note at the top of the file. */
  hearthwatcher: (self, player) => {
    void player;
    const relief: Intent = { kind: 'special', note: '换岗 · 将一张「未熄的誓言」放入你的牌堆' };
    if (self.hp <= self.maxHp / 2) return self.turn % 2 === 0 ? [A(18), BLOCK(8)] : [relief, A(12)];
    return [[A(14)], [BLOCK(12), A(8)], [relief]][self.turn % 3];
  },
};

export const ENEMIES: EnemyDefinition[] = [
  { id: 'shadewolf', name: '影狼', rank: 'minion', hp: 11, script: 'shadewolf',
    note: '每有一只同伴，攻击 +2', lore: '长夜之后，狼群学会了不叫。',
    traits: [{ id: 'pack', amount: 2 }] },
  { id: 'emberfly', name: '萤火', rank: 'minion', hp: 8, script: 'emberfly',
    note: '每回合给你 1 层余烬，同时攻击 3 —— 要不要杀它', lore: '树洞里升起来的光，据说是第一位守夜人没写完的信。',
    traits: [{ id: 'gift', status: 'ember', amount: 1 }] },
  { id: 'scavenger', name: '拾荒犬', rank: 'normal', hp: 15, script: 'scavenger',
    note: '从你的弃牌堆里埋掉一张牌', lore: '商队没能走到营地，它却吃得很好。' },
  { id: 'packbeast', name: '商队驮兽', rank: 'normal', hp: 24, script: 'packbeast',
    note: '每三回合冲撞一次，造成 15 点伤害', lore: '货物还在它背上，货主已经不在了。' },
  { id: 'watchershade', name: '守灯人残影', rank: 'normal', hp: 14, script: 'watchershade',
    note: '巡视：你下回合少 2 点能量', lore: '它还在巡夜，只是已经忘了自己在守什么。' },
  { id: 'stalker', name: '潜草者', rank: 'normal', hp: 13, script: 'stalker',
    note: '前三个回合潜伏，之后一口 16 点', lore: '草动的时候，你通常已经太迟了。' },
  { id: 'caravanguard', name: '商队首领', rank: 'elite', hp: 48, script: 'caravanguard',
    note: '每两回合清点一次货物，永久变强', lore: '他说再清点一遍就出发。那是很多年前的事了。' },
  { id: 'alphawolf', name: '头狼', rank: 'miniboss', hp: 80, script: 'alphawolf',
    note: '嚎叫：召来两只影狼并强化全体', lore: '它一开口，整片草甸都会安静下来。' },
  { id: 'hearthwatcher', name: '余烬守望者', rank: 'boss', hp: 126, script: 'hearthwatcher',
    note: '换岗：把「未熄的誓言」放入你的牌堆 —— 它给你余烬，也给守望者力量', lore: '营地的火是他点起来的。他守了太久，久到忘了可以换班。' },
];
export const ENEMY_BY_ID = new Map(ENEMIES.map(enemy => [enemy.id, enemy]));

/** Junk card enemies can force into your deck: no effect, and it clogs a draw. */
export const JUNK = { ash: { name: '灰烬', cost: 1, text: '什么也不做。' } } as const;

/** The boss's card. It is genuinely good for you, and every copy you play heals the boss. */
export const OATH = { id: 'oath', name: '未熄的誓言', cost: 0, text: '获得 3 层余烬，抽 1 张牌。打出时，守望者回复 6 点生命并获得 1 点力量。' } as const;

export interface Encounter { id: string; name: string; kind: string; units: string[]; blurb: string; teach: string }
/** The camp's own three trials, plus the pack and the road that lead to them. */
export const ENCOUNTERS: Encounter[] = [
  { id: 'ch1-1', name: '荒野巡夜', kind: '普通战', units: ['shadewolf', 'shadewolf'],
    blurb: '营地外围的第一次巡夜。两只影狼跟在你的火光后面。',
    teach: '先认识出牌、格挡和结束回合。影狼每多一只同伴，咬得就更狠。' },
  { id: 'ch1-2', name: '萤火树洞', kind: '普通战', units: ['emberfly', 'scavenger'],
    blurb: '古树的空心里升起光。萤火一边咬你，一边往你身上落余烬。',
    teach: '有些敌人不一定要马上杀掉。萤火在帮你攒余烬，拾荒犬在吃你的弃牌堆。' },
  { id: 'ch1-3', name: '失落的商队', kind: '精英战', units: ['packbeast', 'caravanguard'],
    blurb: '商队的货车还停在原地，驮兽还在等一个不会回来的命令。',
    teach: '驮兽的冲撞提前一回合就会写在它头顶。商队首领每两回合变强一次。' },
  { id: 'ch1-4', name: '草甸上的头狼', kind: '小首领', units: ['alphawolf', 'stalker'],
    blurb: '头狼站在土丘上。它一开口，草里就会站起来更多东西。',
    teach: '嚎叫那一拍是计时器。要么在那之前解决它，要么准备好接住两只新狼。' },
  { id: 'ch1-5', name: '草原守望者', kind: '首领战', units: ['hearthwatcher'],
    blurb: '营地的那簇火，是他点起来的。他不肯换班。',
    teach: '换岗会往你的牌堆里放一张很好用的誓言。每打出一次，守望者也更强一分。' },
];

export type { EnemyDefinition };
