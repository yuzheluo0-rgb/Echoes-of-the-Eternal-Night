// Pure species data: no imports beyond a type-only one, so `worldData.ts` can validate saved fauna
// ids against this list without importing the placement module — which itself imports worldData,
// and would close a cycle. `worldFauna.ts` re-exports all of this for the render layer.
import type { Biome } from './worldData.ts';

/** Whether a creature will let the watcher approach, ignore them, or come for them. Flavour only —
 *  nothing here touches pathfinding or the chapter chain. */
export type Temperament = 'friendly' | 'neutral' | 'hostile';

/** Where an instance may stand, and therefore where it may wander. 'air' takes either. */
export type Habitat = 'land' | 'water' | 'air';

export interface FaunaPalette {
  coat: string; belly: string; dark: string;
}

/** Which imported mesh a species wears, and how to bend it into shape. The source models are the
 *  CC0 Quaternius set (see `public/assets/world/fauna/CREDITS.md`); they arrive at inconsistent
 *  scales and six of the seventeen lie along x, so the loader normalises before any of this. */
export interface FaunaModel {
  /** OBJ basename under `public/assets/world/fauna/`. */
  file: string;
  /** Radians added after the head is turned onto +z, for models the height rule gets wrong. */
  yaw?: number;
  /** Per-axis squash applied before scaling — how one mesh is bent into a second creature. */
  stretch?: [number, number, number];
  /** Uniform size trim on top of `size`. */
  scale?: number;
}

/** How the creature moves when it is not standing still. */
export interface Motion {
  /** Tiles per second while walking. A fox trots, a whale cruises. */
  speed: number;
  /** Herbivores put their heads down to feed; hunters scan instead. Drives the graze channel. */
  grazes?: boolean;
  /** How far it will wander from where it stands, in hexes. */
  range: number;
}

export interface Species {
  id: string; biome: Biome; name: string; latin: string;
  temperament: Temperament; habitat: Habitat;
  /** Standing height for land animals, nose-to-tail length for swimmers and flyers — a whale
   *  scaled by height would be two and a half hexes long. */
  size: number; sizeAxis?: 'height' | 'length';
  /** Drives `castShadow`. Each shadow caster draws twice, so only the big ones opt in. */
  large?: boolean;
  palette: FaunaPalette;
  model: FaunaModel;
  motion: Motion;
  lore: string;
}

/**
 * Two to three inhabitants per land, every one of them an animal that belongs there — nothing from
 * another biome ever spawns here, which is the whole point of keying the table by biome. The
 * seventeen source meshes are reused across biomes by recolouring and rescaling, so the pack covers
 * twelve lands it was never drawn for.
 */
export const SPECIES: Species[] = [
  // 草原 — open meadow: a fox, a hunter and the camp's own dog.
  { id: 'fox', biome: 'grass', name: '赤狐', latin: 'Vulpes rufa', temperament: 'neutral', habitat: 'land', size: .70,
    palette: { coat: '#c2682f', belly: '#f0e2ca', dark: '#43281a' }, model: { file: 'fox' }, motion: { speed: .9, range: 5 },
    lore: '它总在人看不见的地方先停下。草甸上的赤狐记得每一处篝火的余温，也记得谁曾经喂过它。' },
  { id: 'wolf', biome: 'grass', name: '灰狼', latin: 'Lupus cineris', temperament: 'hostile', habitat: 'land', size: .92, large: true,
    palette: { coat: '#6d7178', belly: '#c9ccc8', dark: '#2f333a' }, model: { file: 'wolf' }, motion: { speed: 1.5, range: 8 },
    lore: '它先看见你，然后才让你看见它。长夜之后狼群学会了不叫，只在你身后留下两行并排的脚印。' },
  { id: 'sheepdog', biome: 'grass', name: '牧羊犬', latin: 'Canis vigil', temperament: 'friendly', habitat: 'land', size: .78,
    palette: { coat: '#c9a878', belly: '#f2e7d2', dark: '#6a5236' }, model: { file: 'dog' }, motion: { speed: 1.2, range: 6 },
    lore: '营地最早的朋友。它替守夜人把走散的羊赶回栅栏，也替旅人把陌生的脚步声提前带来。' },
  // 森林 — under the canopy: a darker fox, a lynx, and something singing.
  { id: 'woodfox', biome: 'forest', name: '林狐', latin: 'Vulpes silva', temperament: 'neutral', habitat: 'land', size: .78,
    palette: { coat: '#8a4a24', belly: '#d8c7a6', dark: '#2f1c11' }, model: { file: 'fox', scale: 1.08 }, motion: { speed: .9, range: 5 },
    lore: '毛色比草甸的同类更深，几乎融进树影。它跟人保持的距离，正好是一支箭的射程。' },
  { id: 'lynx', biome: 'forest', name: '猞猁', latin: 'Lynx umbrosa', temperament: 'hostile', habitat: 'land', size: .62,
    palette: { coat: '#6b5a48', belly: '#cdbfa4', dark: '#2b241c' }, model: { file: 'cat', scale: 1.15 }, motion: { speed: 1.3, range: 7 },
    lore: '它蹲在枝桠上一动不动，直到你走出很远，才发现那截「枯枝」换了方向。' },
  { id: 'songbird', biome: 'forest', name: '林雀', latin: 'Avis nemoris', temperament: 'friendly', habitat: 'air', size: .34, sizeAxis: 'length',
    palette: { coat: '#7d8f5c', belly: '#e6e2c6', dark: '#3c4230' }, model: { file: 'bird' }, motion: { speed: 1.1, range: 6 },
    lore: '圣所的树上一直有鸟。老守夜人说，只要它们还在唱，林中的第二声脚步就还没走近。' },
  // 沙漠 — sand: a camelid and a pale fennec.
  { id: 'camelid', biome: 'desert', name: '沙驼', latin: 'Camelus arenae', temperament: 'friendly', habitat: 'land', size: 1.15, large: true,
    palette: { coat: '#c9a468', belly: '#efe0c0', dark: '#7a5c33' }, model: { file: 'llama' }, motion: { speed: .8, range: 6, grazes: true },
    lore: '商队留下的最后一头。它认得回沙海遗迹的路，只是不再愿意走。' },
  { id: 'fennec', biome: 'desert', name: '沙狐', latin: 'Vulpes deserti', temperament: 'neutral', habitat: 'land', size: .58,
    palette: { coat: '#dcb87e', belly: '#f7eed8', dark: '#8a6a3c' }, model: { file: 'fox', scale: 1.1 }, motion: { speed: 1.0, range: 6 },
    lore: '耳朵比草甸的狐狸大得多，沙丘底下有虫子在动，它比谁都先知道。' },
  // 悬崖 — crags: a raptor and a sure-footed climber.
  { id: 'raptor', biome: 'cliff', name: '崖隼', latin: 'Falco rupis', temperament: 'neutral', habitat: 'air', size: .95, sizeAxis: 'length', large: true,
    palette: { coat: '#7a6a58', belly: '#ddd2ba', dark: '#33302a' }, model: { file: 'eagle' }, motion: { speed: 1.6, range: 9 },
    lore: '哨塔塌了以后，隼把巢搬到了断崖上。它盘旋的位置，正好是当年钟声能传到的最远处。' },
  { id: 'cragcat', biome: 'cliff', name: '山猫', latin: 'Felis rupestris', temperament: 'neutral', habitat: 'land', size: .58,
    palette: { coat: '#8a8378', belly: '#d6d0c2', dark: '#3b3833' }, model: { file: 'cat', scale: 1.1 }, motion: { speed: 1.2, range: 6 },
    lore: '走在碎石上没有一点声音。修桥匠说，它比任何一位守望者都更熟悉这条山脊。' },
  // 雪山 — the frozen line: a white wolf and a white raptor.
  { id: 'icewolf', biome: 'snow', name: '冰狼', latin: 'Lupus glacialis', temperament: 'hostile', habitat: 'land', size: .95, large: true,
    palette: { coat: '#c6d2da', belly: '#f2f6f8', dark: '#7d8b96' }, model: { file: 'wolf', scale: 1.05 }, motion: { speed: 1.5, range: 8 },
    lore: '霜冠神殿的骑士曾把它们当作坐骑的替身。它们的毛色和雪线以上的一切一样白。' },
  { id: 'snowowl', biome: 'snow', name: '雪枭', latin: 'Bubo nivis', temperament: 'neutral', habitat: 'air', size: .82, sizeAxis: 'length',
    palette: { coat: '#e8eef2', belly: '#fbfdfe', dark: '#9aa8b4' }, model: { file: 'eagle', scale: .92 }, motion: { speed: 1.2, range: 7 },
    lore: '飞起来没有声音。冰封长阶上的旅人常常先看见影子，再抬头。' },
  { id: 'snowhare', biome: 'snow', name: '雪兔', latin: 'Lepus niveus', temperament: 'friendly', habitat: 'land', size: .38,
    palette: { coat: '#eef3f6', belly: '#ffffff', dark: '#b3c0c9' }, model: { file: 'pug', stretch: [1, .92, 1.5] }, motion: { speed: 1.4, range: 5, grazes: true },
    lore: '雪面上那串突然中断的脚印多半是它的——它一跳能越过两个人并排的距离。' },
  // 大海 — open water: a whale, a school-fish and a hunter.
  { id: 'whale', biome: 'ocean', name: '远海鲸', latin: 'Balaena longinqua', temperament: 'neutral', habitat: 'water', size: 2.6, sizeAxis: 'length', large: true,
    palette: { coat: '#4a6472', belly: '#c2d2d8', dark: '#25333c' }, model: { file: 'whale' }, motion: { speed: .55, range: 12 },
    lore: '它浮上来换气的时候，旧港的灯塔正好转过去。老船匠说那是在替沉船清点人数。' },
  { id: 'shoalfish', biome: 'ocean', name: '银鳍鱼', latin: 'Piscis argenteus', temperament: 'friendly', habitat: 'water', size: .85, sizeAxis: 'length',
    palette: { coat: '#8fb4c4', belly: '#eaf3f6', dark: '#476470' }, model: { file: 'fish', scale: 1.1 }, motion: { speed: 1.0, range: 6 },
    lore: '涨潮时贴着栈桥的桩子游过，鳞片把航灯的光撕成一小片一小片。' },
  { id: 'piranha', biome: 'ocean', name: '裂齿鱼', latin: 'Serra marina', temperament: 'hostile', habitat: 'water', size: .95, sizeAxis: 'length',
    palette: { coat: '#5d6a5a', belly: '#cbd0b8', dark: '#2b332a' }, model: { file: 'piranha' }, motion: { speed: 1.3, range: 8 },
    lore: '幽灵航线上最常见的东西。它们不咬船，只咬从船上掉下去的影子。' },
  // 血海 — the crimson tide: everything here is red and hungry.
  { id: 'bloodfin', biome: 'blood', name: '血鳍', latin: 'Pinna cruenta', temperament: 'hostile', habitat: 'water', size: 1.05, sizeAxis: 'length',
    palette: { coat: '#8e2f3c', belly: '#d9a0a4', dark: '#3d1218' }, model: { file: 'piranha', scale: 1.12 }, motion: { speed: 1.35, range: 8 },
    lore: '祭坛下的水比别处暖。它们围着黑石祭桥转圈，像在等什么被推下去。' },
  { id: 'bonewhale', biome: 'blood', name: '骸鲸', latin: 'Balaena ossium', temperament: 'neutral', habitat: 'water', size: 3.0, sizeAxis: 'length', large: true,
    palette: { coat: '#6b4a52', belly: '#c9b2b0', dark: '#2c1a1f' }, model: { file: 'whale', scale: .92 }, motion: { speed: .5, range: 12 },
    lore: '皮肉早被啃净了，骨架却还在游。血潮之心每跳一次，它就浮上来一次。' },
  // 雾海 — the veil: pale shapes that are only half there.
  { id: 'mistwhale', biome: 'fog', name: '雾鲸', latin: 'Balaena nebula', temperament: 'neutral', habitat: 'water', size: 2.8, sizeAxis: 'length', large: true,
    palette: { coat: '#9fb2bd', belly: '#e8eef1', dark: '#5c6d78' }, model: { file: 'whale' }, motion: { speed: .45, range: 12 },
    lore: '雾里的轮廓比雾本身更淡。灯塔守夜人从不记录它的位置，因为记了也对不上。' },
  { id: 'veilgull', biome: 'fog', name: '雾鸥', latin: 'Larus velatus', temperament: 'friendly', habitat: 'air', size: .60, sizeAxis: 'length',
    palette: { coat: '#c3ced6', belly: '#f2f6f8', dark: '#7b8894' }, model: { file: 'bird', scale: 1.35 }, motion: { speed: 1.1, range: 8 },
    lore: '浮岛之间没有风，它们却能一直悬着。邮差说这些鸟认得没有名字的收信人。' },
  // 沼泽 — the mossbell marsh: a heron, a swimmer and something in the reeds.
  { id: 'heron', biome: 'swamp', name: '苇鹭', latin: 'Ardea arundinis', temperament: 'neutral', habitat: 'air', size: .72, sizeAxis: 'length',
    palette: { coat: '#8d9a86', belly: '#e2e5d2', dark: '#454f42' }, model: { file: 'bird', scale: 1.5 }, motion: { speed: .85, range: 6 },
    lore: '它站在芦苇里能站一整个下午。老蛙人说，鹭不动的时候，连钟声都不敢响。' },
  // A fish would be the obvious marsh animal, but the swamp biome has no water tiles of its own —
  // every tile in it is land that merely looks wet. A rail belongs there anyway.
  { id: 'rail', biome: 'swamp', name: '苔水秧鸡', latin: 'Rallus muscus', temperament: 'friendly', habitat: 'land', size: .30,
    palette: { coat: '#5f6b45', belly: '#c6cdae', dark: '#2b3122' }, model: { file: 'chick', scale: 1.05 }, motion: { speed: .8, range: 4, grazes: true },
    lore: '在浮草上走，踩不破一层苔。它叫起来像两块湿石头互相敲。' },
  { id: 'marshcat', biome: 'swamp', name: '沼猫', latin: 'Felis palustris', temperament: 'hostile', habitat: 'land', size: .55,
    palette: { coat: '#6d6a52', belly: '#cbc8ac', dark: '#2e2d22' }, model: { file: 'cat' }, motion: { speed: 1.25, range: 7 },
    lore: '踩在浮草上不会陷下去。船坞的老蛙人从不把鱼晾在低处。' },
  // 火山 — the ember forge: a boar that eats cinders and a fox that walks on warm stone.
  { id: 'cinderboar', biome: 'volcano', name: '熔鬃野猪', latin: 'Aper cineris', temperament: 'hostile', habitat: 'land', size: .85, large: true,
    palette: { coat: '#6b4038', belly: '#b58a76', dark: '#2a1a17' }, model: { file: 'pig', stretch: [1, .95, .85] }, motion: { speed: 1.1, range: 7, grazes: true },
    lore: '背脊上的鬃毛是烧焦的。学徒说它啃冷却的炉渣，像别处的猪啃橡果。' },
  { id: 'emberfox', biome: 'volcano', name: '余烬狐', latin: 'Vulpes ember', temperament: 'neutral', habitat: 'land', size: .66,
    palette: { coat: '#8a4526', belly: '#d9a878', dark: '#2e1a12' }, model: { file: 'fox', scale: 1.05 }, motion: { speed: 1.15, range: 6 },
    lore: '爪子底下有厚厚的茧。它专挑还温着的石头走，像在给自己取暖。' },
  // 晶原 — the starglass: a pale steed and a shard-coloured cat.
  { id: 'glasssteed', biome: 'crystal', name: '棱晶兽', latin: 'Equus vitreus', temperament: 'neutral', habitat: 'land', size: 1.25, large: true,
    palette: { coat: '#a9a2cf', belly: '#e6e2f4', dark: '#5b5480' }, model: { file: 'horse', scale: .92 }, motion: { speed: 1.3, range: 7, grazes: true },
    lore: '鬃毛在星光下会折出第二层颜色。学者坚持它是马，只是活在会反光的地方。' },
  { id: 'shardcat', biome: 'crystal', name: '晶簇猫', latin: 'Felis crystallina', temperament: 'friendly', habitat: 'land', size: .52,
    palette: { coat: '#b7aede', belly: '#f0ecfa', dark: '#5d5490' }, model: { file: 'cat', scale: .95 }, motion: { speed: 1.2, range: 5 },
    lore: '踩过的地方会留下很浅的光。记录星光的学者用它当路标，比罗盘准。' },
  // 荒原 — the bone court: a scavenger dog and a vulture.
  { id: 'bonehound', biome: 'waste', name: '骸犬', latin: 'Canis ossium', temperament: 'hostile', habitat: 'land', size: .84, large: true,
    palette: { coat: '#c3b79c', belly: '#efe8d6', dark: '#6f6653' }, model: { file: 'dog', scale: 1.05 }, motion: { speed: 1.45, range: 8 },
    lore: '它把巨兽的肋骨当成自己的院子。拾荒者说，被它盯上的东西最后都会变成骨头。' },
  { id: 'vulture', biome: 'waste', name: '秃鹫', latin: 'Vultur aridus', temperament: 'neutral', habitat: 'air', size: 1.0, sizeAxis: 'length', large: true,
    palette: { coat: '#6e5c46', belly: '#c4b498', dark: '#2f2820' }, model: { file: 'eagle', scale: 1.1 }, motion: { speed: 1.5, range: 10 },
    lore: '它从不落下。王庭的屋顶早没了，它就在原来屋顶的位置盘旋。' },
];

export const SPECIES_BY_ID = new Map(SPECIES.map(species => [species.id, species]));

/** Chinese labels for the two enum-ish fields, shared by the bestiary dialog and the journal. */
export const TEMPERAMENT_LABEL: Record<Temperament, string> = { friendly: '友善', neutral: '中立', hostile: '敌对' };
export const HABITAT_LABEL: Record<Habitat, string> = { land: '陆生', water: '水生', air: '飞行' };
