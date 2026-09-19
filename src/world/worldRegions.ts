import type {Biome,Tile} from './worldData.ts';

/** Southern wetlands → eastern coast → northern crown → western islands. */
export const REGION_ORDER:Biome[]=['grass','swamp','forest','ocean','desert','volcano','blood','snow','waste','cliff','fog','crystal'];
export interface RegionProgress {version:1;unlocked:Biome[];snowTrail:string[]}
export const freshRegions=():RegionProgress=>({version:1,unlocked:['grass'],snowTrail:[]});
export const isRegionOpen=(progress:RegionProgress,biome:Biome)=>progress.unlocked.includes(biome);
/** Which chapter a tile belongs to. A building cell is filed under its site's region rather than
 *  the cell's own biome. Main-site ids double as region names ('forest', 'volcano'…), except the
 *  camp, which is filed under grass; derived compounds are named `<kind>-<biome>`, so the region is
 *  the suffix. Anything unrecognised falls back to the cell's own biome, which is what the walkable
 *  forecourt already carries — generation forces an entrance tile to its site's biome.
 *  This leans on the naming contract in worldData (derived ids are always `<kind>-<biome>`), so a
 *  main-site id containing a dash would be misread here. Casting a derived id straight to Biome
 *  instead filed every compound under a region that does not exist, which sealed its own forecourt. */
export function tileRegion(tile:Tile):Biome{
  if(!tile.structure)return tile.biome;
  const named:string=tile.structure==='camp'?'grass':tile.structure.slice(tile.structure.indexOf('-')+1);
  return (REGION_ORDER as readonly string[]).includes(named)?named as Biome:tile.biome;
}
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
