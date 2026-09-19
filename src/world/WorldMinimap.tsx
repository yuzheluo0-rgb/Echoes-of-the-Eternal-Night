import { memo, useRef, type MouseEvent } from 'react';
import { TILE_MAP,TILES,WORLD_SCALE, type Biome } from './worldData';
import { isRegionOpen, type RegionProgress } from './worldRegions';
import { PALETTE } from './storybookLandscape';

const outlines=new Map<Biome,string>();
for(const tile of TILES){const points=Array.from({length:6},(_,n)=>`${(tile.x+Math.sin(n*Math.PI/3)).toFixed(2)},${(tile.z+Math.cos(n*Math.PI/3)).toFixed(2)}`);outlines.set(tile.biome,(outlines.get(tile.biome)||'')+'M'+points.join('L')+'Z');}
export default memo(function WorldMinimap({position,selected,regions,onChoose}:{position:string;selected:string;regions:RegionProgress;onChoose:(id:string)=>void}){
  const svg=useRef<SVGSVGElement>(null),actor=TILE_MAP.get(position)!,destination=TILE_MAP.get(selected)!;
  const choose=(event:MouseEvent<SVGSVGElement>)=>{
    const matrix=svg.current?.getScreenCTM();if(!matrix)return;
    const p=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());
    const nearest=TILES.reduce((a,b)=>Math.hypot(a.x-p.x,a.z-p.y)<Math.hypot(b.x-p.x,b.z-p.y)?a:b);
    if(Math.hypot(nearest.x-p.x,nearest.z-p.y)<1.6*WORLD_SCALE)onChoose(nearest.id);
  };
  /** Keeps the viewBox readable instead of emitting a long float string once the map grows. */
  const fit=(v:number)=>Math.round(v*100)/100;
  return <aside className="world-minimap" aria-label="世界概览小地图"><div><span>山海图卷</span><small>点击定位</small></div><svg ref={svg} viewBox={`${fit(-32*WORLD_SCALE)} ${fit(-23*WORLD_SCALE)} ${fit(64*WORLD_SCALE)} ${fit(46*WORLD_SCALE)}`} onClick={choose} role="img" aria-label="当前位置与世界地貌"><rect x={fit(-32*WORLD_SCALE)} y={fit(-23*WORLD_SCALE)} width={fit(64*WORLD_SCALE)} height={fit(46*WORLD_SCALE)} fill="#17232b"/>{[...outlines].map(([biome,d])=>{const sealed=!isRegionOpen(regions,biome);return <path key={biome} d={d} fill={PALETTE[biome]} opacity={sealed?(biome==='ocean'?.1:.26):biome==='ocean'?.32:1}/>;})}{selected!==position&&<circle cx={destination.x} cy={destination.z} r={1.1*WORLD_SCALE} fill="none" stroke="#f3d08b" strokeWidth=".45"/>}<circle cx={actor.x} cy={actor.z} r={1.8*WORLD_SCALE} fill="#ffdf9b" opacity=".18"/><circle cx={actor.x} cy={actor.z} r={.85*WORLD_SCALE} fill="#ffe4a2" stroke="#151d22" strokeWidth=".35"/></svg><p><span />守夜人 <i />{TILES.length} 格 · {regions.unlocked.length} / 12 片风土</p></aside>;
});
