import { ENCOUNTERS, STORIES } from './worldStories.ts';
import {REGION_ORDER,canEnterTile,freshRegions,isRegionOpen,parseRegions,type RegionProgress} from './worldRegions.ts';
export type Biome = 'grass' | 'forest' | 'desert' | 'cliff' | 'snow' | 'ocean' | 'blood' | 'fog' | 'swamp' | 'volcano' | 'crystal' | 'waste';
export interface Tile { id: string; q: number; r: number; x: number; z: number; biome: Biome; height: number; walkable: boolean; bridge: boolean; seed: number; landmark?: string; structure?: string; transit?:Biome }
export interface Landmark { id: string; q: number; r: number; biome: Biome; name: string; subtitle: string; lore: string; levels: string[]; difficulty: string; kind?: 'main' | 'hidden' | 'side' | 'event'; quest?: { title: string; npc: string; reward: string; targets: string[] } }
export const BIOMES: Record<Biome, { name: string; color: string; description: string }> = {
  grass: { name: '草原', color: '#b9c780', description: '风掠过旧王国的草甸，篝火尚有余温。' },
  forest: { name: '森林', color: '#67ad8a', description: '巨木遮蔽星光，林间的小径通向古老圣所。' },
  desert: { name: '沙漠', color: '#e7bf7e', description: '流沙吞没了王朝，只留下金色的残垣。' },
  cliff: { name: '悬崖', color: '#b2b1bc', description: '层叠断岩托起哨塔，深谷中回荡着钟声。' },
  snow: { name: '雪山', color: '#b7ddeb', description: '群峰永冻，失落的誓言封存于蓝色冰川。' },
  ocean: { name: '大海', color: '#68c7cf', description: '潮汐仍循着月亮，孤独的港湾等待归帆。' },
  blood: { name: '血海', color: '#da808d', description: '暗红的海面从不平静，祭坛正呼唤来者。' },
  fog: { name: '雾海', color: '#b7c9da', description: '银雾穿过浮岛，唯有灯塔记得航路。' },
  swamp: { name: '沼泽', color: '#97bc80', description: '芦苇与苔石之间，古老的晚钟仍在回荡。' },
  volcano: { name: '火山', color: '#f19b6c', description: '黑色火山岩下，熔流照亮仍未沉寂的旧炉。' },
  crystal: { name: '晶原', color: '#bcb0f0', description: '紫晶从大地生长，折射出另一片星空。' },
  waste: { name: '荒原', color: '#d3b494', description: '风蚀台地与巨兽遗骨，记得旧王朝的名字。' },
};
export const MAIN_SITES: Landmark[] = [
  { id: 'camp', q: 0, r: 1, biome: 'grass', name: '余烬营地', subtitle: 'THE LAST HEARTH', lore: '长夜之中，总有人守着一簇火。循着远处的钟声，找回属于守夜人的第一枚印记。', levels: ['荒野巡夜', '失落的商队', '草原守望者'], difficulty: '推荐初访' },
  { id: 'forest', q: -4, r: 4, biome: 'forest', name: '幽林圣所', subtitle: 'THE HOLLOW GROVE', lore: '根须缠绕的石门后，旧日的祈祷仍未散去。不要回应林中的第二声脚步。', levels: ['低语林径', '古树的心脏', '无面林主'], difficulty: '幽暗险境' },
  { id: 'ocean', q: 0, r: 5, biome: 'ocean', name: '沉潮旧港', subtitle: 'THE HARBOR THAT FORGOT THE DAWN', lore: '旧王国最大的南方港口沉寂于此。吊机折向海面，沉船堵住船坞，百年未燃的航灯下，只剩一位不肯离开的老船匠。让这座港口再次迎接归帆，是重建主世界的第一项工程。', levels: ['潮痕栈桥', '幽灵航线', '深海回响'], difficulty: '主世界修复工程' },
  { id: 'desert', q: 5, r: -1, biome: 'desert', name: '沙海遗迹', subtitle: 'THE GILDED RUIN', lore: '风沙磨去了石碑上的名字，却磨不去王冠的重量。沉睡的王正在等待新的祭品。', levels: ['埋骨沙丘', '日蚀王陵', '黄金之殇'], difficulty: '失落禁地' },
  { id: 'blood', q: 4, r: -4, biome: 'blood', name: '血潮祭坛', subtitle: 'THE CRIMSON ALTAR', lore: '猩红浪潮之下，似乎有一颗庞大的心脏。踏过黑石祭桥，直面没有尽头的饥渴。', levels: ['猩红渡口', '献祭回廊', '血潮之心'], difficulty: '极危禁地' },
  { id: 'snow', q: 0, r: -4, biome: 'snow', name: '霜冠神殿', subtitle: 'THE FROST CROWN', lore: '雪线之上，群星触手可及。冰封神殿里，最后一位骑士仍守着空无一人的王座。', levels: ['寂静雪线', '冰封长阶', '霜冠骑士'], difficulty: '永冻险境' },
  { id: 'cliff', q: -3, r: -2, biome: 'cliff', name: '断崖哨塔', subtitle: 'THE FALLEN WATCH', lore: '哨塔之下是深不见底的裂谷。守望者的钟声，从未因城墙坍塌而停止。', levels: ['碎石古道', '悬空哨所', '敲钟人'], difficulty: '高地险境' },
  { id: 'fog', q: -5, r: 0, biome: 'fog', name: '雾港灯塔', subtitle: 'THE VEILED BEACON', lore: '雾是一片没有边界的海。跟随灯火，穿过悬于虚空的木桥，抵达被世界遗忘的港口。', levels: ['迷雾墓园', '遗忘浮岛', '引路人的灯'], difficulty: '迷雾险境' },
  { id: 'swamp', q: -5, r: 5, biome: 'swamp', name: '苔泽钟楼', subtitle: 'THE MOSSBELL', lore: '钟楼的根基早已没入苔水，仍有一只无形的手在暮色中摇响晚钟。', levels: ['芦苇低语', '苔水迷径', '沉钟守卫'], difficulty: '苔泽险境' },
  { id: 'volcano', q: 15, r: -6, biome: 'volcano', name: '灰烬熔炉', subtitle: 'THE EMBER FORGE', lore: '王朝的锻炉熄灭之后，山的心脏替它燃烧。火光中，隐约有人仍在锤打最后一把剑。', levels: ['熔岩古道', '灰烬长阶', '不灭炉心'], difficulty: '熔火禁地' },
  { id: 'crystal', q: -15, r: 5, biome: 'crystal', name: '星镜尖塔', subtitle: 'THE STARGLASS', lore: '尖塔记录的星辰比夜空中多出一颗。只有走进晶石的影子，才能看到它的轨迹。', levels: ['折光原野', '镜中回廊', '星镜守护者'], difficulty: '折光秘境' },
  { id: 'waste', q: -5, r: -9, biome: 'waste', name: '遗骨王庭', subtitle: 'THE BONE COURT', lore: '荒原上的王庭没有屋顶，只有巨兽遗骨替昔日的王遮挡风沙。', levels: ['风蚀旷野', '遗骨长廊', '无名旧王'], difficulty: '古国遗境' },
].map((site,index)=>({...site,q:index>0&&index<8?site.q*2:site.q,r:index>0&&index<8?site.r*2:site.r,kind:'main' as const,levels:site.levels as [string,string,string],biome:site.biome as Biome}));
export const DIRECTIONS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]] as const;
export const START_ID = '0,1';
export const tileId = (q: number, r: number) => `${q},${r}`;
export const hexDistance = (a: { q: number; r: number }, b: { q: number; r: number }) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
export function random(seed: number) { const n = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return n - Math.floor(n); }
export const WORLD_SEED = 7319;
export const isWater = (biome: Biome) => biome === 'ocean' || biome === 'blood' || biome === 'fog';
export const SITE_SIZE:Record<string,number>={camp:4,forest:4,ocean:9,desert:5,blood:4,snow:5,cliff:4,fog:3,swamp:3,volcano:5,crystal:4,waste:5};
/** Seeded coastlines sit on the same regular pointy-top hex lattice as navigation. */
export function createWorld(worldSeed = WORLD_SEED): Tile[] {
  const tiles: Tile[] = [];
  const ellipse = (x: number, z: number, cx: number, cz: number, rx: number, rz: number) => 1 - ((x - cx) / rx) ** 2 - ((z - cz) / rz) ** 2;
  const phase = random(worldSeed) * 9;
  const heights: Record<Biome, number> = { grass: .56, forest: .59, desert: .46, cliff: 1.02, snow: .79, ocean: .08, blood: .08, fog: .08, swamp:.34,volcano:.72,crystal:.58,waste:.66 };
  for (let q = -20; q <= 20; q++) for (let r = -15; r <= 15; r++) {
    const x = Math.sqrt(3) * (q + r / 2), z = r * 1.5;
    const gx=x/2,gz=z/2;
    const seed = (q + 19) * 59 + (r + 19) * 13 + worldSeed;
    const ripple = Math.sin(gx * .83 + phase) * .10 + Math.cos(gz * 1.17 - gx * .32) * .11;
    if (ellipse(gx, gz, 0, 0, 14.9, 10.6) + ripple < 0) continue;
    // A hooked mainland, a broken eastern cape and a few smaller outlying islands.
    const mainland = Math.max(ellipse(gx,gz,-3.7,-.3,5.6,6.1), ellipse(gx,gz,-5.7,-4.5,3,2.8), ellipse(gx,gz,-2.5,5.1,3.5,2.6), ellipse(gx,gz,-1.8,-6,3.1,2.4));
    const eastern = Math.max(ellipse(gx,gz,7,-1.5,3.3,3.4), ellipse(gx,gz,7.3,4,1.8,1.8), ellipse(gx,gz,3.5,7,1.6,1.5));
    const volcanic=ellipse(gx,gz,10.1,-5.4,2.45,2.5),crystalline=ellipse(gx,gz,-11,3.8,2.35,2.5),waste=ellipse(gx,gz,-8,-6.3,2.4,2.3);
    const lagoon = ellipse(gx,gz,-5.9,2,1.8,1.85) > .16;
    const dry = Math.max(mainland,eastern,volcanic,crystalline,waste) + ripple > .04 && !lagoon;
    let biome: Biome = 'ocean';
    if (dry) {
      if(volcanic+ripple>.04)biome='volcano';
      else if(crystalline+ripple>.04)biome='crystal';
      else if(waste+ripple>.04)biome='waste';
      else if(ellipse(gx,gz,-2.2,3.2,2.35,2.05)>.03)biome='swamp';
      else if (gx > 3.6 && gz < 2.1) biome = 'desert';
      else if (gz < -4 + Math.sin(gx * .7) * .65) biome = 'snow';
      else if (gx < -5.1 && gz < .2) biome = 'cliff';
      else if (gz > 2.8 || (gx < -2.1 && gz > -.8)) biome = 'forest';
      else biome = 'grass';
    } else if (ellipse(gx,gz,3.9,-6.5,3.3,2.8) + ripple > 0) biome = 'blood';
    else if (ellipse(gx,gz,-9.1,-.1,2.5,4.5) + ripple > 0) biome = 'fog';
    const landmark = MAIN_SITES.find(l => l.q === q && l.r === r);
    if (landmark) biome = landmark.biome;
    const liquid = isWater(biome);
    tiles.push({ id: tileId(q,r), q, r, x, z, biome, seed, height: heights[biome] + (liquid ? 0 : random(seed) * .08), walkable: !liquid && (biome !== 'snow' || !!landmark || random(seed + 4) > .66), bridge: false, landmark: landmark?.id });
  }
  const map = new Map(tiles.map(t => [t.id, t]));
  const connected = () => {
    const reached = new Set([START_ID]), queue = [map.get(START_ID)!];
    for (let i = 0; i < queue.length; i++) for (const [dq,dr] of DIRECTIONS) {
      const next = map.get(tileId(queue[i].q+dq,queue[i].r+dr));
      if (next?.walkable && !reached.has(next.id)) { reached.add(next.id); queue.push(next); }
    }
    return reached;
  };
  // Prefer dry ground and short straits, instead of drawing eight radial bridges.
  const connect = (destination: string) => {
    const reached = connected(); if (reached.has(destination)) return;
    const open = new Set(reached), costs = new Map([...reached].map(id => [id,0])), came = new Map<string,string>();
    while (open.size) {
      const current = [...open].reduce((a,b) => costs.get(a)! < costs.get(b)! ? a : b);
      open.delete(current);
      if (current === destination) {
        let cursor = current;
        while (!reached.has(cursor)) {
          const tile = map.get(cursor)!; tile.walkable = true; tile.bridge = isWater(tile.biome);
          cursor = came.get(cursor)!;
        }
        return;
      }
      const tile = map.get(current)!;
      for (const [dq,dr] of DIRECTIONS) {
        const next = map.get(tileId(tile.q+dq,tile.r+dr)); if (!next || next.structure&&!next.landmark) continue;
        const cost = costs.get(current)! + (isWater(next.biome) ? 9 : next.walkable ? 1 : 3);
        if (cost < (costs.get(next.id) ?? Infinity)) { costs.set(next.id,cost); came.set(next.id,current); open.add(next.id); }
      }
    }
  };
  for (const site of MAIN_SITES) connect(tileId(site.q,site.r));
  for (const tile of tiles) if (tile.walkable) connect(tile.id);
  for(const site of MAIN_SITES) for(const kind of ['side','hidden','event'] as const) {
    const occupied=tiles.filter(t=>t.landmark);
    const candidates=tiles.filter(t=>t.biome===site.biome&&!t.landmark&&occupied.every(o=>hexDistance(t,o)>=3));
    candidates.sort((a,b)=>{
      const score=(t:Tile)=>random(t.seed+(kind==='hidden'?71:23))*3+hexDistance(t,site)*(kind==='hidden'?.16:-.1);
      return score(b)-score(a);
    });
    const chosen=candidates[0]||tiles.find(t=>t.biome===site.biome&&!t.landmark);
    if(!chosen)throw new Error('Missing location for '+site.biome);
    chosen.landmark=kind+'-'+site.biome;connect(chosen.id);
  }
  // Keep a walkable forecourt at each location. Its connected rear cells belong to
  // the architecture, so pathfinding never sends the traveller through a building.
  for(const site of MAIN_SITES){
    const entrance=map.get(tileId(site.q,site.r))!;entrance.structure=site.id;
    const footprint=[entrance];
    while(footprint.length<SITE_SIZE[site.id]){
      const candidates=tiles.filter(t=>!t.structure&&!t.landmark&&hexDistance(t,entrance)<=2&&footprint.some(f=>hexDistance(t,f)===1));
      candidates.sort((a,b)=>{
        const score=(t:Tile)=>site.id==='ocean'?hexDistance(t,entrance)*2-(t.x-entrance.x)*.35-(t.z-entrance.z)*.25+(isWater(t.biome)?0:1.5):hexDistance(t,entrance)*3+(t.x-entrance.x)*.36+(t.z-entrance.z)*.8+(t.biome===site.biome?0:1.5);
        return score(a)-score(b)||a.id.localeCompare(b.id);
      });
      const next=candidates[0];if(!next)throw new Error('No building footprint for '+site.id);
      next.structure=site.id;next.walkable=false;next.bridge=false;footprint.push(next);
    }
  }
  for(const site of MAIN_SITES)connect(tileId(site.q,site.r));
  for(const tile of tiles)if(tile.walkable)connect(tile.id);
  // Make each chapter independently traversable. Only short water crossings and
  // passes inside the open region may be added; locked buildings are never transit.
  const unlocked:Biome[]=[];
  for(const region of REGION_ORDER){
    unlocked.push(region);const progress:RegionProgress={version:1,unlocked,snowTrail:[]};
    const reachable=()=>{const seen=new Set([START_ID]),queue=[map.get(START_ID)!];for(let i=0;i<queue.length;i++)for(const[dq,dr]of DIRECTIONS){const next=map.get(tileId(queue[i].q+dq,queue[i].r+dr));if(canEnterTile(progress,next)&&!seen.has(next!.id)){seen.add(next!.id);queue.push(next!);}}return seen;};
    for(const destination of tiles.filter(t=>t.biome===region&&t.walkable)){
      const reached=reachable();if(reached.has(destination.id))continue;
      const open=new Set(reached),costs=new Map([...reached].map(id=>[id,0])),came=new Map<string,string>();let found=false;
      while(open.size){
        const id=[...open].reduce((a,b)=>costs.get(a)!<costs.get(b)!?a:b);open.delete(id);
        if(id===destination.id){let cursor=id;while(!reached.has(cursor)){const tile=map.get(cursor)!;tile.walkable=true;if(isWater(tile.biome)){tile.bridge=true;tile.transit??=region;}cursor=came.get(cursor)!;}found=true;break;}
        const tile=map.get(id)!;
        for(const[dq,dr]of DIRECTIONS){
          const next=map.get(tileId(tile.q+dq,tile.r+dr));
          if(!next||next.structure&&!next.landmark||!unlocked.includes(next.biome)&&(!isWater(next.biome)||next.landmark))continue;
          const cost=costs.get(id)!+(canEnterTile(progress,next)?1:isWater(next.biome)?6:3);
          if(cost<(costs.get(next.id)??Infinity)){costs.set(next.id,cost);came.set(next.id,id);open.add(next.id);}
        }
      }
      if(!found)throw new Error('Unreachable chapter location: '+region+' / '+destination.id);
    }
  }
  return tiles;
}
export const TILES = createWorld();
export const LANDMARKS: Landmark[] = [...MAIN_SITES,...TILES.filter(t=>t.landmark&&!MAIN_SITES.some(s=>s.id===t.landmark)).map(tile=>{
  const story=STORIES[tile.biome],hidden=tile.landmark!.startsWith('hidden-'),main=MAIN_SITES.find(s=>s.biome===tile.biome)!;
  if(tile.landmark!.startsWith('event-'))return{id:tile.landmark!,q:tile.q,r:tile.r,biome:tile.biome,name:ENCOUNTERS[tile.biome].name,kind:'event' as const,subtitle:'A CHANCE ALONG THE ROAD',lore:ENCOUNTERS[tile.biome].text,difficulty:'旅途奇遇',levels:[]};
  return {id:tile.landmark!,q:tile.q,r:tile.r,biome:tile.biome,name:hidden?story.hidden:story.side,kind:hidden?'hidden' as const:'side' as const,subtitle:hidden?'A SECRET IN THE WILD':'TALES ALONG THE WAY',lore:hidden?story.secret:story.story,difficulty:hidden?'隐秘据点':'区域支线',levels:[hidden?'秘境寻踪':story.title,hidden?'旧物回声':'旅人的线索',hidden?'守藏者的试炼':'归途的赠礼'] as [string,string,string],quest:hidden?undefined:{title:story.title,npc:story.npc,reward:story.reward,targets:[main.id,'hidden-'+tile.biome]}};
})];
export const TILE_MAP = new Map(TILES.map(tile => [tile.id, tile]));
export function siteFootprint(id:string){const site=MAIN_SITES.find(s=>s.id===id);if(!site)return[];const entry=TILE_MAP.get(tileId(site.q,site.r))!;return[entry,...TILES.filter(t=>t.structure===id&&t!==entry).sort((a,b)=>hexDistance(a,entry)-hexDistance(b,entry)||(a.x-entry.x)*.36+(a.z-entry.z)*.8-((b.x-entry.x)*.36+(b.z-entry.z)*.8))];}
export function navigationTarget(id:string){const tile=TILE_MAP.get(id),site=MAIN_SITES.find(s=>s.id===tile?.structure);return site?tileId(site.q,site.r):id;}
export const walkHeight = (tile: Tile) => tile.bridge ? .62 : tile.height + .045;
export function findPath(startId: string, endId: string,regions?:RegionProgress): string[] {
  const start = TILE_MAP.get(startId), end = TILE_MAP.get(endId);
  if (!start || !end || !end.walkable || regions&&(!canEnterTile(regions,start)||!canEnterTile(regions,end))) return [];
  const open = new Set([startId]), came = new Map<string, string>(), cost = new Map([[startId, 0]]);
  while (open.size) {
    const currentId = [...open].sort((a, b) => (cost.get(a)! + hexDistance(TILE_MAP.get(a)!, end)) - (cost.get(b)! + hexDistance(TILE_MAP.get(b)!, end)))[0];
    if (currentId === endId) { const path = [endId]; let cursor = endId; while (came.has(cursor)) { cursor = came.get(cursor)!; path.unshift(cursor); } return path; }
    open.delete(currentId);
    const current = TILE_MAP.get(currentId)!;
    for (const [dq, dr] of DIRECTIONS) {
      const next = TILE_MAP.get(tileId(current.q + dq, current.r + dr));
      if (!next?.walkable || regions&&!canEnterTile(regions,next)) continue;
      const nextCost = cost.get(currentId)! + 1;
      if (nextCost < (cost.get(next.id) ?? Infinity)) { came.set(next.id, currentId); cost.set(next.id, nextCost); open.add(next.id); }
    }
  }
  return [];
}
export interface WorldSave { position: string; visited: string[]; mission: string | null; discovered:string[]; acceptedQuests:string[]; completedQuests:string[]; embers:number; echoes:number; encounters:Record<string,number>; harbor:{accepted:boolean;stage:number};regions:RegionProgress }
export const SAVE_KEY = 'eternal-night-world-v1';
const secretSite=(site:Landmark)=>site.kind==='hidden'||site.kind==='event';
export function advanceJourney(save:WorldSave,position:string):WorldSave {
  const tile=TILE_MAP.get(position);if(!tile||!canEnterTile(save.regions,tile))return save;
  const discovered=[...new Set([...save.discovered,...LANDMARKS.filter(s=>isRegionOpen(save.regions,s.biome)&&secretSite(s)&&hexDistance(tile,s)<=2).map(s=>s.id)])];
  const visited=[...new Set([...save.visited,...(tile.landmark?[tile.landmark]:[])])];
  const newlyComplete=LANDMARKS.filter(s=>s.quest&&save.acceptedQuests.includes(s.id)&&!save.completedQuests.includes(s.id)&&s.quest.targets.every(id=>visited.includes(id))).map(s=>s.id);
  const regions=tile.biome==='snow'&&save.regions.snowTrail.length<6&&!save.regions.snowTrail.includes(position)?{...save.regions,snowTrail:[...save.regions.snowTrail,position]}:save.regions;
  return {...save,position,visited,discovered,regions,completedQuests:[...save.completedQuests,...newlyComplete],embers:save.embers+newlyComplete.length*4};
}
export function acceptSideQuest(save:WorldSave,id:string):WorldSave {
  const site=LANDMARKS.find(s=>s.id===id);if(!site?.quest||!isRegionOpen(save.regions,site.biome)||save.position!==tileId(site.q,site.r)||save.acceptedQuests.includes(id))return save;
  return advanceJourney({...save,acceptedQuests:[...save.acceptedQuests,id]},save.position);
}
export function resolveEncounter(save:WorldSave,id:string,choice:number):WorldSave {
  const site=LANDMARKS.find(s=>s.id===id);if(site?.kind!=='event'||!isRegionOpen(save.regions,site.biome)||save.position!==tileId(site.q,site.r)||save.encounters[id]!==undefined||(choice!==0&&choice!==1))return save;
  const result=ENCOUNTERS[site.biome].choices[choice];if(save.embers+result.embers<0)return save;
  return {...save,embers:save.embers+result.embers,echoes:save.echoes+result.echoes,encounters:{...save.encounters,[id]:choice}};
}
export function travelByBeacon(save:WorldSave,id:string):WorldSave {
  const site=MAIN_SITES.find(s=>s.id===id);if(!site||!isRegionOpen(save.regions,site.biome)||!save.visited.includes(id))return save;
  const cost=id==='camp'||id==='ocean'&&save.harbor.stage===3?0:1;if(save.embers<cost)return save;
  return advanceJourney({...save,embers:save.embers-cost},tileId(site.q,site.r));
}
export function parseSave(raw: string | null): WorldSave {
  const defaults:WorldSave = { position: START_ID, visited: ['camp'], mission: null, discovered:[],acceptedQuests:[],completedQuests:[],embers:3,echoes:0,encounters:{},harbor:{accepted:false,stage:0},regions:freshRegions() };
  try {
    const value = JSON.parse(raw || '{}');
    const validMissions = LANDMARKS.flatMap(site => site.levels);
    const validIds=(list:unknown,predicate:(site:Landmark)=>boolean)=>[...new Set((Array.isArray(list)?list:[]).filter((id:unknown)=>typeof id==='string'&&LANDMARKS.some(s=>s.id===id&&predicate(s))))] as string[];
    const visited=[...new Set(['camp',...validIds(value?.visited,()=>true)])],acceptedQuests=validIds(value?.acceptedQuests,s=>!!s.quest);
    const completedQuests=validIds(value?.completedQuests,s=>!!s.quest&&acceptedQuests.includes(s.id)&&s.quest.targets.every(id=>visited.includes(id)));
    const amount=(n:unknown,fallback:number)=>typeof n==='number'&&Number.isFinite(n)?Math.min(99999,Math.max(0,Math.floor(n))):fallback;
    const encounters:Record<string,number>={};for(const site of LANDMARKS)if(site.kind==='event'&&(value?.encounters?.[site.id]===0||value?.encounters?.[site.id]===1))encounters[site.id]=value.encounters[site.id];
    const harborAccepted=value?.harbor?.accepted===true&&visited.includes('ocean');
    const harborStage=harborAccepted&&Number.isInteger(value?.harbor?.stage)&&value.harbor.stage>=0&&value.harbor.stage<=3?value.harbor.stage:0;
    const regions=parseRegions(value?.regions);regions.snowTrail=regions.snowTrail.filter(id=>{const t=TILE_MAP.get(id);return t?.biome==='snow'&&t.walkable;});
    const position=navigationTarget(value?.position);return { position: canEnterTile(regions,TILE_MAP.get(position)) ? position : START_ID, visited, mission: validMissions.includes(value?.mission) ? value.mission : null,discovered:validIds(value?.discovered,secretSite),acceptedQuests,completedQuests,embers:amount(value?.embers,3),echoes:amount(value?.echoes,0),encounters,harbor:{accepted:harborAccepted,stage:harborStage},regions };
  } catch { return defaults; }
}
