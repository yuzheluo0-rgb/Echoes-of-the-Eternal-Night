import type {Biome,Tile} from './worldData.ts';

/** Southern wetlands → eastern coast → northern crown → western islands. */
export const REGION_ORDER:Biome[]=['grass','swamp','forest','ocean','desert','volcano','blood','snow','waste','cliff','fog','crystal'];
export interface RegionProgress {version:1;unlocked:Biome[];snowTrail:string[]}
export const freshRegions=():RegionProgress=>({version:1,unlocked:['grass'],snowTrail:[]});
export const isRegionOpen=(progress:RegionProgress,biome:Biome)=>progress.unlocked.includes(biome);
export function tileRegion(tile:Tile):Biome{return tile.structure?(tile.structure==='camp'?'grass':tile.structure as Biome):tile.biome;}
export const isTileSealed=(progress:RegionProgress,tile:Tile)=>!isRegionOpen(progress,tileRegion(tile))&&!(tile.bridge&&!tile.landmark&&!tile.structure&&tile.transit&&isRegionOpen(progress,tile.transit));
/** A causeway belongs to the chapter that opens it; sealed sea locations stay sealed. */
export function canEnterTile(progress:RegionProgress,tile:Tile|undefined):boolean{
  return !!tile?.walkable&&!isTileSealed(progress,tile);
}
export function parseRegions(value:unknown):RegionProgress{
  const result=freshRegions();
  if(!value||typeof value!=='object'||!('version' in value)||value.version!==1)return result;
  const data=value as {unlocked?:unknown;snowTrail?:unknown};
  if(Array.isArray(data.unlocked)&&data.unlocked[0]==='grass')for(let i=1;i<REGION_ORDER.length&&data.unlocked[i]===REGION_ORDER[i];i++)result.unlocked.push(REGION_ORDER[i]);
  if(result.unlocked.includes('snow')&&Array.isArray(data.snowTrail))result.snowTrail=[...new Set(data.snowTrail.filter((id):id is string=>typeof id==='string'))].slice(0,6);
  return result;
}
