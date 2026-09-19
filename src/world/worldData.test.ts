import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { BIOMES, DIRECTIONS, LANDMARKS, START_ID, TILE_MAP, TILES, WORLD_GROWTH, WORLD_SEED, createWorld, findPath, hexDistance, isWater, parseSave, tileId,advanceJourney,acceptSideQuest,resolveEncounter,travelByBeacon,MAIN_SITES,SITE_SIZE,siteFootprint,navigationTarget } from './worldData.ts';
import { REGION_ORDER } from './worldRegions.ts';
/** The chapter system seals every biome but grass, so fixtures that travel further open the map first. */
const openAll=(extra:Record<string,unknown>={})=>parseSave(JSON.stringify({regions:{version:1,unlocked:[...REGION_ORDER]},...extra}));
/** Regenerate only when the map is deliberately redesigned: a mismatch means the coastline or
 *  bridge carve moved, every docs/previews screenshot is stale, and old saves may point at
 *  different terrain. Structural tests cannot tell "identical" from "different but still valid".
 *  Regenerated 2026-09-19 for the WORLD_GROWTH = sqrt(3) continent (776 -> 2315 tiles). */
const LAYOUT_DIGEST='sha256:aea17b32691649eedf5041de22ab20e6efcffc5e7a0ec5daf6de318c9b075a1b';

test('landmarks keep their distance so the continent does not feel cramped', () => {
  // The complaint this guards against: sites packed shoulder to shoulder with no wilderness
  // between them. Small islands cannot always honour the full spacing, hence 4 rather than 5.
  let closest=Infinity;
  for(let i=0;i<LANDMARKS.length;i++)for(let j=i+1;j<LANDMARKS.length;j++)closest=Math.min(closest,hexDistance(LANDMARKS[i],LANDMARKS[j]));
  assert.ok(closest>=4,`closest landmarks are ${closest} hexes apart`);
});

test('the generated layout matches the frozen digest', () => {
  const canonical=TILES.map(t=>[t.id,t.biome,t.walkable?1:0,t.bridge?1:0,t.transit??'',t.structure??'',t.landmark??'',t.caldera?1:0,t.height.toFixed(6)].join('/')).join('\n');
  assert.equal('sha256:'+createHash('sha256').update(canonical).digest('hex'),LAYOUT_DIGEST);
});

test('world generation stays inside the startup budget', () => {
  const start=performance.now();createWorld();const ms=performance.now()-start;
  // Runs at module load via `TILES = createWorld()`, so it blocks first paint. The heap plus the
  // reachability cache put 2315 tiles at ~154ms (776 tiles cost 152ms before them); this guard
  // catches a silent regression as the map grows.
  assert.ok(ms<400,`createWorld took ${ms.toFixed(0)}ms`);
});

test('large seeded islands retain twelve distinct biomes and regular hex navigation', () => {
  // Tracks the configured area, so resizing the continent is a one-line change in worldData.
  const expected = 776 * WORLD_GROWTH ** 2;
  assert.ok(TILES.length > expected * .9 && TILES.length < expected * 1.1, `got ${TILES.length}, expected around ${expected.toFixed(0)}`);
  assert.equal(new Set(TILES.map(t => t.id)).size, TILES.length);
  assert.deepEqual(createWorld(),TILES);
  assert.notDeepEqual(createWorld(WORLD_SEED+1).map(t=>[t.id,t.biome]),TILES.map(t=>[t.id,t.biome]));
  for (const biome of Object.keys(BIOMES)) {
    const region = TILES.filter(t => t.biome === biome); assert.ok(region.length >= 20, biome);
    const sites=LANDMARKS.filter(s=>s.biome===biome);assert.deepEqual(sites.map(s=>s.kind).sort(),['event','hidden','main','side']);
  }
  assert.ok(TILES.filter(t=>isWater(t.biome)).length/TILES.length>.5);
  const coast=TILES.filter(t=>!isWater(t.biome)&&DIRECTIONS.some(([dq,dr])=>{const n=TILE_MAP.get(tileId(t.q+dq,t.r+dr));return n&&isWater(n.biome);}));
  assert.ok(coast.length>25,'the land should have inlets and irregular coastlines');
  assert.equal(LANDMARKS.length,48);assert.equal(new Set(LANDMARKS.map(s=>tileId(s.q,s.r))).size,48);
  for(const tile of TILES) for(const [dq,dr]of DIRECTIONS){const next=TILE_MAP.get(tileId(tile.q+dq,tile.r+dr));if(next)assert.ok(Math.abs(Math.hypot(next.x-tile.x,next.z-tile.z)-Math.sqrt(3))<1e-10);}
});
test('every landmark is reachable from every other landmark using adjacent walkable cells', () => {
  for (const start of LANDMARKS) for (const end of LANDMARKS) {
    const path = findPath(tileId(start.q, start.r), tileId(end.q, end.r));
    assert.ok(path.length); assert.equal(path[0], tileId(start.q, start.r)); assert.equal(path.at(-1), tileId(end.q, end.r));
    for (let n = 0; n < path.length; n++) { assert.ok(TILE_MAP.get(path[n])?.walkable); if (n) assert.equal(hexDistance(TILE_MAP.get(path[n - 1])!, TILE_MAP.get(path[n])!), 1); }
  }
});
test('A* returns a shortest route and rejects open water and unknown cells', () => {
  const distances = new Map([[START_ID, 0]]), queue = [START_ID];
  while (queue.length) { const id = queue.shift()!, current = TILE_MAP.get(id)!; for (const next of TILES) if (next.walkable && !distances.has(next.id) && hexDistance(current, next) === 1) { distances.set(next.id, distances.get(id)! + 1); queue.push(next.id); } }
  for (const tile of TILES) { const path = findPath(START_ID, tile.id); if (!tile.walkable) assert.deepEqual(path, []); else assert.equal(path.length - 1, distances.get(tile.id), tile.id); }
  assert.deepEqual(findPath('missing', START_ID), []); assert.deepEqual(findPath(START_ID, 'missing'), []);
});
test('save validation rejects invalid positions and missions and deduplicates visits', () => {
  const blocked = TILES.find(tile => !tile.walkable&&!tile.structure)!;
  const valid = LANDMARKS[0].levels[0];
  const defaults=parseSave(null);assert.equal(defaults.embers,3);assert.deepEqual(parseSave('{bad json'),defaults);
  assert.equal(parseSave(JSON.stringify({ position: blocked.id })).position, START_ID);
  const available=TILES.find(t=>t.walkable&&!t.landmark)!.id;
  assert.deepEqual(openAll({ position: available, visited: ['forest', 'forest', 'fake', null], mission: valid }), { ...openAll(),position: available, visited: ['camp', 'forest'], mission: valid });
  assert.equal(parseSave(JSON.stringify({ mission: 'unknown' })).mission, null);
  assert.equal(parseSave('null').position, START_ID);
});

test('multi-cell architecture has connected footprints, accessible forecourts and safe save migration',()=>{
  for(const site of MAIN_SITES){
    const cells=siteFootprint(site.id),entry=tileId(site.q,site.r);assert.equal(cells.length,SITE_SIZE[site.id]);assert.ok(site.id==='ocean'?cells.length===9:cells.length>=3&&cells.length<=5);assert.equal(cells[0].id,entry);
    const reached=new Set([entry]);for(let n=0;n<cells.length;n++)for(const cell of cells)if(cells.some(c=>reached.has(c.id)&&hexDistance(cell,c)===1))reached.add(cell.id);assert.equal(reached.size,cells.length);
    for(const cell of cells){assert.equal(cell.walkable,cell.id===entry);assert.equal(navigationTarget(cell.id),entry);assert.equal(openAll({position:cell.id,embers:8}).position,entry);}
    assert.ok(findPath(START_ID,entry).length);
  }
});

test('secrets appear at proximity and accepted quests reward completion only once',()=>{
 const quest=LANDMARKS.find(s=>s.id==='side-grass')!,secret=LANDMARKS.find(s=>s.id==='hidden-grass')!;
 let save=parseSave(null);assert.equal(acceptSideQuest(save,quest.id),save,'cannot accept a quest remotely');
 save=advanceJourney(save,tileId(quest.q,quest.r));save=acceptSideQuest(save,quest.id);assert.ok(save.acceptedQuests.includes(quest.id));assert.equal(save.embers,3);
 const route=findPath(save.position,tileId(secret.q,secret.r));const approach=route[Math.max(0,route.length-3)];save=advanceJourney(save,approach);assert.ok(save.discovered.includes(secret.id));
 save=advanceJourney(save,tileId(secret.q,secret.r));assert.ok(save.completedQuests.includes(quest.id));assert.equal(save.embers,7);
 save=advanceJourney(save,save.position);assert.equal(save.embers,7,'no repeat rewards');assert.deepEqual(parseSave(JSON.stringify(save)),save);
});

test('encounter choices are local, persistent and cannot be farmed or overspent',()=>{
 const event=LANDMARKS.find(s=>s.id==='event-grass')!,snow=LANDMARKS.find(s=>s.id==='event-snow')!;
 let save=parseSave(null);assert.equal(resolveEncounter(save,event.id,0),save);
 save=advanceJourney(save,tileId(event.q,event.r));assert.equal(resolveEncounter(save,event.id,8),save);
 save=resolveEncounter(save,event.id,0);assert.equal(save.embers,6);assert.equal(save.encounters[event.id],0);assert.equal(resolveEncounter(save,event.id,1),save);
 assert.deepEqual(parseSave(JSON.stringify(save)),save);
 save=advanceJourney({...save,embers:0},tileId(snow.q,snow.r));assert.equal(resolveEncounter(save,snow.id,0),save,'insufficient embers');
});

test('beacons require a visit, charge once and always allow a free return to camp',()=>{
 const volcano=LANDMARKS.find(s=>s.id==='volcano')!;let save=openAll();
 assert.equal(travelByBeacon(save,volcano.id),save);save=advanceJourney(save,tileId(volcano.q,volcano.r));
 save=travelByBeacon(save,'camp');assert.equal(save.position,START_ID);assert.equal(save.embers,3);
 save=travelByBeacon(save,volcano.id);assert.equal(save.position,tileId(volcano.q,volcano.r));assert.equal(save.embers,2);
 save=travelByBeacon({...save,embers:0},'camp');assert.equal(save.position,START_ID);assert.equal(travelByBeacon(save,volcano.id),save);
});

test('expanded saves sanitize resources, discovery, quest identifiers and encounters',()=>{
 const save=parseSave(JSON.stringify({embers:-9,echoes:'many',acceptedQuests:['side-grass','fake','side-grass'],completedQuests:['side-grass'],discovered:['fake','camp','hidden-grass','hidden-grass'],encounters:{'event-grass':0,'event-snow':9,'fake':1}}));
 assert.equal(save.embers,0);assert.equal(save.echoes,0);assert.deepEqual(save.acceptedQuests,['side-grass']);assert.deepEqual(save.completedQuests,[]);assert.deepEqual(save.discovered,['hidden-grass']);assert.deepEqual(save.encounters,{'event-grass':0});
});
