/**
 * 场景 — the backdrop behind a floor.
 *
 * One photograph per *subject*, not per encounter. Two fights that are both wolves standing in the
 * same grass are the same place, and pretending otherwise would mean twelve near-identical
 * photographs of night and fog. So an encounter names its subject and this table turns the subject
 * into the picture.
 *
 * A scene does three jobs at once: it is the tower map's backdrop when you hover that floor, it is
 * the backdrop of the preparation screen, and it is the backdrop of the fight itself. Walking into
 * 草甸上的头狼 therefore looks continuous from the map to the last card played.
 */

export interface Scene {
  key: SceneKey;
  /** What it is, for the hover card and for the credits. */
  name: string;
  /** The Unsplash search phrase. `.work/tower-fetch-scenes.cjs` reads these. */
  query: string;
}

export type SceneKey =
  | 'wolf' | 'dog' | 'firefly' | 'beast' | 'lantern' | 'stalker' | 'caravan' | 'boss'
  | 'rest' | 'treasure' | 'event' | 'shop' | 'grass';

export const SCENES: Scene[] = [
  // --- the fights -------------------------------------------------------------------
  { key: 'wolf', name: '狼群', query: 'wolf in dark forest night moody' },
  { key: 'dog', name: '拾荒犬', query: 'stray dog in foggy field dark' },
  { key: 'firefly', name: '萤火', query: 'fireflies glowing in dark forest night' },
  { key: 'beast', name: '驮兽', query: 'pack horse in misty field dark' },
  { key: 'lantern', name: '守灯人', query: 'lantern light in dark foggy forest' },
  { key: 'stalker', name: '潜草者', query: 'tall grass field at night dark' },
  { key: 'caravan', name: '废弃商队', query: 'abandoned wagon in dark field' },
  { key: 'boss', name: '余烬守望者', query: 'campfire at night in empty field dark' },

  // --- the rest of the tower --------------------------------------------------------
  { key: 'rest', name: '营火', query: 'campfire campsite at night dark' },
  { key: 'treasure', name: '宝箱', query: 'old wooden chest treasure dark' },
  { key: 'event', name: '岔路', query: 'dark path through foggy field night' },
  // 五个词以内：Unsplash 把整串当短语，长了静默返回空。夜里的市集、灯下的摊子——商店是塔上唯一一个
  // 有人的地方，这张图要说的是「这里有人做生意」，而不是「这里有一栋建筑」。
  { key: 'shop', name: '商店', query: 'night market lantern stall dark' },
  { key: 'grass', name: '草甸', query: 'night grassland fog dark moody' },
];

export const SCENE_BY_KEY = new Map(SCENES.map(scene => [scene.key, scene]));

/** The picture that stands behind a floor. Falls back to the tower's own gloom. */
export function sceneArt(key: string | undefined): string {
  return `/assets/scenes/${key && SCENE_BY_KEY.has(key as SceneKey) ? key : 'grass'}.webp`;
}
