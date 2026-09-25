import type { SceneKey } from './scenes.ts';
import type { EnemyDefinition, EnemyRank, EnemyState, Intent, PlayerState, StatusId } from './types';

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

  /**
   * 头狼 — the pack leader, and the fight that had to be rebuilt rather than renumbered.
   *
   * It used to run a three-beat rotation: 9 damage, then a howl that summoned two wolves *and* handed
   * out permanent 力量, then an 18-damage 合围 — repeating forever. Against a 60-health player that is
   * not a fight but a countdown. Measured with a fixed policy it dealt 9 / 0 / 33 / **54** across four
   * turns, and it beat both decks roughly 0–20% of the time while the *boss* — twice its health —
   * beat them 100%. A miniboss that is four times harder than the chapter boss is mis-built, and no
   * amount of shaving its health fixed it: the health sweep barely moved the win rate, because the
   * damage was never coming from the wolf. It was coming from the board the wolf kept refilling.
   *
   * So the howl now happens **once**. That is also what the teach text always promised — 「要么在*那*
   * 之前解决它」 is a deadline, not a metronome — and it turns the fight into a real decision: race the
   * wolf, or spend two turns clearing the pack it just called. Its body is smaller than the elite's
   * because the two wolves are most of its threat.
   */
  alphawolf: (self, player) => {
    void player;
    if (self.turn === 1) return [SUMMON('shadewolf', '嚎叫'), SUMMON('shadewolf', '嚎叫')];
    return self.turn % 2 === 0 ? [A(8)] : [A(8, 2, '合围')];
  },

  /** 余烬守望者 — the chapter boss. See the note at the top of the file. */
  hearthwatcher: (self, player) => {
    void player;
    const relief: Intent = { kind: 'special', note: '换岗 · 将一张「未熄的誓言」放入你的牌堆' };
    if (self.hp <= self.maxHp / 2) return self.turn % 2 === 0 ? [A(18), BLOCK(8)] : [relief, A(12)];
    return [[A(14)], [BLOCK(12), A(8)], [relief]][self.turn % 3];
  },
};

/**
 * `hp` is a **range, rolled at spawn** from the battle's own seeded stream — the same thing Slay the
 * Spire does per monster (a Louse is 10–15, a large Spike Slime 64–70) rather than one global
 * difficulty knob. It is what stops two runs into 影狼 from being the same fight, and it costs no
 * non-determinism: the roll comes off `random(s)`, so a seed still replays exactly.
 *
 * The bands are centred on the single numbers this roster used before, so the balance that was
 * tuned against them still holds on average.
 */
export const ENEMIES: EnemyDefinition[] = [
  { id: 'shadewolf', name: '影狼', rank: 'minion', hp: [9, 13], script: 'shadewolf',
    note: '每有一只同伴，攻击 +2', lore: '长夜之后，狼群学会了不叫。',
    traits: [{ id: 'pack', amount: 2 }] },
  { id: 'emberfly', name: '萤火', rank: 'minion', hp: [7, 10], script: 'emberfly',
    note: '每回合给你 1 层余烬，同时攻击 3 —— 要不要杀它', lore: '树洞里升起来的光，据说是第一位守夜人没写完的信。',
    traits: [{ id: 'gift', status: 'ember', amount: 1 }] },
  { id: 'scavenger', name: '拾荒犬', rank: 'normal', hp: [13, 17], script: 'scavenger',
    note: '从你的弃牌堆里埋掉一张牌', lore: '商队没能走到营地，它却吃得很好。' },
  { id: 'packbeast', name: '商队驮兽', rank: 'normal', hp: [21, 27], script: 'packbeast',
    note: '每三回合冲撞一次，造成 15 点伤害', lore: '货物还在它背上，货主已经不在了。' },
  { id: 'watchershade', name: '守灯人残影', rank: 'normal', hp: [12, 16], script: 'watchershade',
    note: '巡视：你下回合少 2 点能量', lore: '它还在巡夜，只是已经忘了自己在守什么。' },
  { id: 'stalker', name: '潜草者', rank: 'normal', hp: [11, 15], script: 'stalker',
    note: '前三个回合潜伏，之后一口 16 点', lore: '草动的时候，你通常已经太迟了。' },
  { id: 'caravanguard', name: '商队首领', rank: 'elite', hp: [43, 53], script: 'caravanguard',
    note: '每两回合清点一次货物，永久变强', lore: '他说再清点一遍就出发。那是很多年前的事了。' },
  { id: 'alphawolf', name: '头狼', rank: 'miniboss', hp: [42, 50], script: 'alphawolf',
    note: '嚎叫只响一次，召来两只影狼 —— 要么赶在那之前解决它，要么准备好先清狼',
    lore: '它一开口，整片草甸都会安静下来。' },
  { id: 'hearthwatcher', name: '余烬守望者', rank: 'boss', hp: [116, 136], script: 'hearthwatcher',
    note: '换岗：把「未熄的誓言」放入你的牌堆 —— 它给你余烬，也给守望者力量', lore: '营地的火是他点起来的。他守了太久，久到忘了可以换班。' },
];

/**
 * 异变 — a minion or normal enemy rolls one of these rarely, and wears it as a name prefix and a
 * frame colour. It is the small-scale version of Slay the Spire's *burning elite*: a fight you were
 * expecting, with one thing in it you have to notice and decide about.
 *
 * Elites and bosses never mutate — they already are the thing you have to decide about.
 */
export interface Mutation {
  id: string;
  /** Goes in front of the name: 「狂躁的影狼」. */
  prefix: string;
  tone: string;
  /** Multiplies the rolled HP, rounded up. */
  hpScale?: number;
  /** Block it takes back at the start of each of its turns. */
  regenBlock?: number;
  /** Statuses it starts the fight holding. */
  statuses?: Partial<Record<StatusId, number>>;
  note: string;
}

export const MUTATIONS: Mutation[] = [
  { id: 'hardy', prefix: '强健的', tone: '#7fa86a', hpScale: 1.4, note: '生命 +40%' },
  { id: 'frenzied', prefix: '狂躁的', tone: '#d9694f', statuses: { strength: 2 }, note: '开局 2 层力量' },
  { id: 'armored', prefix: '披甲的', tone: '#8fa8c4', regenBlock: 4, note: '每回合开始格挡回到 4' },
  { id: 'swollen', prefix: '肿胀的', tone: '#c9a24f', hpScale: 1.2, regenBlock: 2, note: '生命 +20%，每回合格挡回到 2' },
];
export const MUTATION_BY_ID = new Map(MUTATIONS.map(mutation => [mutation.id, mutation]));

/** Ranks that can roll a mutation, and how often. */
export const MUTABLE_RANKS: EnemyRank[] = ['minion', 'normal'];
export const MUTATION_CHANCE = .12;
export const ENEMY_BY_ID = new Map(ENEMIES.map(enemy => [enemy.id, enemy]));

/** Junk card enemies can force into your deck: no effect, and it clogs a draw. */
/**
 * Cards that are not in the library: the junk shoved into your deck, and the hazards you pick up.
 *
 * They are all the same shape — a cost, and nothing to show for it — because that *is* the penalty.
 * A dead card is the most honest cost this game charges: it does not delete 生命 you might have
 * needed, it takes a slot in a 30-card deck and a card in a five-card hand, and its price is paid
 * every single shuffle for the rest of the run.
 *
 * The three hazards differ by **what they cost to be rid of**, not by what they do. 渣滓 is free to
 * draw and dead; 空话 costs two, which is enough to make you think about playing it and be wrong.
 */
export const JUNK = {
  ash: { name: '灰烬', cost: 1, text: '什么也不做。' },
  dross: { name: '渣滓', cost: 0, text: '什么也不做。它只是占着那个位置。' },
  ballast: { name: '压舱石', cost: 1, text: '什么也不做。你背着它走了一路。' },
  'hollow-word': { name: '空话', cost: 2, text: '什么也不做。说这话的人已经不在了。' },
} as const;

/** The hazards a 奇遇 can hand you, by id — see `events.ts`'s `junk` effect. Not `ash`, which only
 *  an enemy ever gives you. */
export type HazardId = 'dross' | 'ballast' | 'hollow-word';
export const HAZARD_IDS: HazardId[] = ['dross', 'ballast', 'hollow-word'];
export const isHazard = (cardId: string): cardId is HazardId =>
  (HAZARD_IDS as string[]).includes(cardId);

/** The boss's card. It is genuinely good for you, and every copy you play heals the boss. */
export const OATH = { id: 'oath', name: '未熄的誓言', cost: 0, text: '获得 3 层余烬，抽 1 张牌。打出时，守望者回复 6 点生命并获得 1 点力量。' } as const;

/** One monster in an encounter, and how many of it turn up. `[2, 2]` means "always exactly two". */
export interface SpawnUnit {
  id: string;
  count: [number, number];
}

/** Which draw pile a map node pulls from. Chapter I's opening fights come from `weak`, exactly as
 *  Slay the Spire keeps the first three combats of an act out of the strong pool. */
export type PoolId = 'weak' | 'strong' | 'elite' | 'boss';

export interface Encounter {
  id: string;
  name: string;
  kind: string;
  pool: PoolId;
  /** Which backdrop stands behind this fight. See `scenes.ts`. */
  scene: SceneKey;
  /**
   * The *kinds* of monster are fixed; only the counts roll. That is the point — an encounter is a
   * promise about what you will face, not about how much of it, so the player can plan the shape of
   * a fight without being able to memorise its numbers.
   */
  units: SpawnUnit[];
  blurb: string;
  teach: string;
}

const u = (id: string, count: [number, number]): SpawnUnit => ({ id, count });

/**
 * The five designed fights — the chapter's spine and what the linear demo plays through. Each one is
 * anchored to a specific floor of the map, so they keep their names and their ids.
 */
export const ENCOUNTERS: Encounter[] = [
  { id: 'ch1-1', name: '荒野巡夜', kind: '普通战', pool: 'weak', scene: 'wolf',
    // The teaching fight is the one encounter that does NOT roll: the tour explains 「两只影狼」 by
    // name, and a tutorial whose board changes underneath the text teaches worse, not better.
    units: [u('shadewolf', [2, 2])],
    blurb: '营地外围的第一次巡夜。两只影狼跟在你的火光后面。',
    teach: '先认识出牌、格挡和结束回合。影狼每多一只同伴，咬得就更狠。' },
  { id: 'ch1-2', name: '萤火树洞', kind: '普通战', pool: 'weak', scene: 'firefly',
    units: [u('emberfly', [1, 2]), u('scavenger', [1, 1])],
    blurb: '古树的空心里升起光。萤火一边咬你，一边往你身上落余烬。',
    teach: '有些敌人不一定要马上杀掉。萤火在帮你攒余烬，拾荒犬在吃你的弃牌堆。' },
  { id: 'ch1-3', name: '失落的商队', kind: '精英战', pool: 'elite', scene: 'caravan',
    units: [u('packbeast', [1, 1]), u('caravanguard', [1, 1])],
    blurb: '商队的货车还停在原地，驮兽还在等一个不会回来的命令。',
    teach: '驮兽的冲撞提前一回合就会写在它头顶。商队首领每两回合变强一次。' },
  { id: 'ch1-4', name: '草甸上的头狼', kind: '小首领', pool: 'elite', scene: 'wolf',
    // Just the wolf. The 潜草者 that used to share this floor gave the fight a *second* "deal with me
    // or die" clock running against the howl, and two overlapping clocks is not a harder fight, it is
    // an unreadable one — and the wolves the howl calls are the board the flavor already promised
    // (「它一开口，草里就会站起来更多东西」), so the encounter does not need to supply more of them.
    units: [u('alphawolf', [1, 1])],
    blurb: '头狼站在土丘上。它一开口，草里就会站起来更多东西。',
    teach: '嚎叫只响一次，但那两只狼会一直留着。要么赶在嚎叫之前解决它，要么准备好先清狼再回来。' },
  { id: 'ch1-5', name: '草原守望者', kind: '首领战', pool: 'boss', scene: 'boss',
    units: [u('hearthwatcher', [1, 1])],
    blurb: '营地的那簇火，是他点起来的。他不肯换班。',
    teach: '换岗会往你的牌堆里放一张很好用的誓言。每打出一次，守望者也更强一分。' },
];

const anchor = (id: string): Encounter => ENCOUNTERS.find(entry => entry.id === id)!;

/**
 * What a map floor draws from. The five anchors sit inside the pools rather than beside them, so a
 * floor can hand you 失落的商队 instead of a generated elite and the player cannot tell which is
 * which — they are all just fights.
 *
 * Every generated entry here exists to make `units` counts do the work: 草甸上的影群 is 2–3 wolves
 * where 荒野巡夜 is exactly 2, so the pack bonus is a different size each time you meet it.
 */
export const POOLS: Record<PoolId, Encounter[]> = {
  weak: [
    anchor('ch1-1'), anchor('ch1-2'),
    { id: 'w-shadepack', name: '草甸上的影群', kind: '普通战', pool: 'weak', scene: 'wolf',
      units: [u('shadewolf', [2, 3])],
      blurb: '火光外面有好几双眼睛，不叫，也不退。',
      teach: '影狼每多一只同伴就更狠。数量本身就是威胁。' },
    { id: 'w-hollowrim', name: '树洞边缘', kind: '普通战', pool: 'weak', scene: 'firefly',
      units: [u('emberfly', [2, 3])],
      blurb: '光从树洞里溢出来，落了你一身余烬。',
      teach: '不一定要全杀。留下的萤火还在替你攒余烬，也在咬你。' },
    { id: 'w-ashdogs', name: '灰烬里的拾荒犬', kind: '普通战', pool: 'weak', scene: 'dog',
      units: [u('scavenger', [1, 2])],
      blurb: '它们在翻找商队留下来的东西，也顺便翻找你丢掉的。',
      teach: '弃牌堆不是垃圾堆。丢掉的牌会被它们埋掉。' },
  ],
  strong: [
    { id: 's-lanternround', name: '守灯人的路线', kind: '普通战', pool: 'strong', scene: 'lantern',
      units: [u('watchershade', [1, 2])],
      blurb: '它还在巡夜，走的是几十年前那条路线。',
      teach: '它不打你的血，打你的节奏——下回合你会少 2 点能量。' },
    { id: 's-ambush', name: '草叶不动的地方', kind: '普通战', pool: 'strong', scene: 'stalker',
      units: [u('stalker', [1, 2])],
      blurb: '有一片草一直没动过。',
      teach: '潜草者前三个回合不出手。这题问的是「你来得及吗」。' },
    { id: 's-caravan', name: '驮兽与犬', kind: '普通战', pool: 'strong', scene: 'beast',
      units: [u('packbeast', [1, 1]), u('scavenger', [1, 1])],
      blurb: '驮兽站着，拾荒犬在它脚边转。',
      teach: '驮兽每三回合冲撞一次，意图提前一回合就写在它头顶。' },
    { id: 's-shaderound', name: '残影与狼', kind: '普通战', pool: 'strong', scene: 'lantern',
      units: [u('watchershade', [1, 1]), u('shadewolf', [2, 2])],
      blurb: '守灯人残影走在前面，狼群跟在后面。',
      teach: '先处理哪个：抽你能量的，还是咬你血的。' },
    { id: 's-deepgrass', name: '草甸深处', kind: '普通战', pool: 'strong', scene: 'stalker',
      units: [u('stalker', [2, 2])],
      blurb: '两片草叶同时静了下来。',
      teach: '两只潜草者会在同一回合扑出来。你只有一次机会。' },
    { id: 's-nightwatch', name: '巡夜队', kind: '普通战', pool: 'strong', scene: 'lantern',
      units: [u('watchershade', [2, 2]), u('emberfly', [1, 1])],
      blurb: '两个影子并排走着，中间飘着一点光。',
      teach: '被抽两次能量之后，你这一回合基本只剩两张牌。' },
  ],
  elite: [
    anchor('ch1-3'), anchor('ch1-4'),
    { id: 'e-brood', name: '潜草者巢穴', kind: '精英战', pool: 'elite', scene: 'stalker',
      units: [u('stalker', [2, 3]), u('emberfly', [1, 2])],
      blurb: '这里的草比别处矮，因为它们下面是空的。',
      teach: '三只潜草者会在同一回合一起扑。要么提前削掉，要么备好格挡。' },
  ],
  boss: [anchor('ch1-5')],
};

/** Every encounter that exists, anchors and generated alike. */
export const ALL_ENCOUNTERS: Encounter[] = Object.values(POOLS).flat();
export const ENCOUNTER_BY_ID = new Map(ALL_ENCOUNTERS.map(entry => [entry.id, entry]));

export type { EnemyDefinition };
