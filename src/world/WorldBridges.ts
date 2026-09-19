import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TILES,TILE_MAP,DIRECTIONS,isWater,walkHeight,type Tile } from './worldData';
import { landHeightAt } from './storybookLandscape';

export type BridgeStyle='timber'|'harbor'|'vine'|'reed'|'suspension'|'ice'|'sandstone'|'ritual'|'mist'|'forge'|'prism';
function styleFor(a:Tile,b:Tile):BridgeStyle{
  const biomes=[a.biome,b.biome];
  for(const [biome,style]of [['volcano','forge'],['crystal','prism'],['snow','ice'],['desert','sandstone'],['cliff','suspension'],['swamp','reed'],['forest','vine']] as const)if(biomes.includes(biome))return style;
  if(biomes.includes('blood'))return'ritual';if(biomes.includes('fog'))return'mist';if(biomes.includes('ocean'))return'harbor';return'timber';
}
/** Distinct bridges share one navigation deck height and a handful of draw batches. */
export function buildWorldBridges(scene:THREE.Scene){
  const group=new THREE.Group();group.name='world-bridges';scene.add(group);
  const colors={wood:'#756047',plank:'#a68f6b',rope:'#c1b18c',leaf:'#62765d',stone:'#778480',sand:'#b69b6e',ice:'#b6cccc',blue:'#61808a',dark:'#3d424b',red:'#914f61',gold:'#bb9053',purple:'#8e84a7'};
  const mats=new Map(Object.entries(colors).map(([name,color])=>[name,new THREE.MeshLambertMaterial({color})]));
  const kit=new Map<string,THREE.BufferGeometry>([['box',new THREE.BoxGeometry(1,1,1)],['cylinder',new THREE.CylinderGeometry(1,1,1,8)],['cone',new THREE.ConeGeometry(1,1,6)],['rock',new THREE.IcosahedronGeometry(1,0)]]);
  const batches=new Map<THREE.Material,THREE.BufferGeometry[]>(),seen=new Set<string>(),spans:{from:string;to:string;style:BridgeStyle}[]=[];
  const collect=(g:THREE.BufferGeometry,color:string)=>{const material=mats.get(color)!;if(!batches.has(material))batches.set(material,[]);batches.get(material)!.push(g);};
  const deckHeight=(tile:Tile)=>tile.bridge?walkHeight(tile):landHeightAt(tile.x,tile.z)+.045;
  for(const a of TILES.filter(t=>t.bridge))for(const [dq,dr]of DIRECTIONS){
    const b=TILE_MAP.get(`${a.q+dq},${a.r+dr}`);if(!b?.walkable)continue;const key=[a.id,b.id].sort().join(':');if(seen.has(key))continue;seen.add(key);
    const style=styleFor(a,b);spans.push({from:a.id,to:b.id,style});
    const ax=a.x,az=a.z,ay=deckHeight(a),by=deckHeight(b),dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz),angle=Math.atan2(dx,dz),across=new THREE.Vector3(Math.cos(angle),0,-Math.sin(angle));
    const pos=(t:number,side=0,lift=0)=>new THREE.Vector3(ax+dx*t+across.x*side,THREE.MathUtils.lerp(ay,by,t)+lift,az+dz*t+across.z*side);
    const piece=(shape:string,color:string,t:number,side:number,lift:number,sx:number,sy:number,sz:number,tilt=0,roll=0)=>{const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt,angle,roll,'YXZ'));collect(kit.get(shape)!.clone().applyMatrix4(new THREE.Matrix4().compose(pos(t,side,lift),q,new THREE.Vector3(sx,sy,sz))),color);};
    const curve=(color:string,side:number,y:(t:number)=>number,r=.013)=>{const points=Array.from({length:9},(_,i)=>pos(i/8,side,y(i/8)));collect(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),12,r,5,false),color);};
    const slope=-Math.atan2(by-ay,length),post=(t:number,side:number,color:string,h=.51)=>piece('cylinder',color,t,side,h/2-.08,.025,h,.025);
    if(style==='ice'){
      for(let n=0;n<5;n++)piece('box',n%2?'ice':'blue',(n+.5)/5,0,-.07,.59,.11,length/5*.985,slope);
      for(const side of [-.30,.30]){curve('ice',side,t=>-.18-Math.sin(t*Math.PI)*.15,.045);for(const t of [.09,.91])piece('cone','ice',t,side,.16,.065,.38,.065);}
    }else if(style==='sandstone'){
      for(let n=0;n<7;n++)piece('box',n%2?'sand':'rope',(n+.5)/7,0,-.065,.65,.13,length/7*.97,slope);
      for(const side of [-.31,.31]){curve('sand',side,t=>-.45+Math.sin(t*Math.PI)*.35,.066);for(const t of [.06,.94])piece('box','sand',t,side,-.17,.17,.42,.20);curve('sand',side,()=>.17,.05);}
    }else if(style==='ritual'){
      for(let n=0;n<6;n++)piece('box','dark',(n+.5)/6,0,-.062,.53,.12,length/6*.91,slope);
      for(const side of [-.28,.28]){curve('red',side,()=>-.012,.018);for(const t of [.07,.93]){piece('cone','dark',t,side,.16,.10,.47,.1);piece('cone','red',t,side,.41,.045,.16,.045);}}
      for(const t of [.3,.5,.7])piece('box','gold',t,0,.007,.12,.012,.023,slope);
    }else if(style==='prism'){
      for(let n=0;n<5;n++){piece('box',n%2?'purple':'ice',(n+.5)/5,0,-.065,.60,.12,length/5*.9,slope);piece('cone','purple',(n+.5)/5,0,-.22,.23,.30,.23,Math.PI);}
      for(const side of [-.31,.31]){curve('gold',side,()=>.04,.012);for(const t of [.09,.91])piece('cone','ice',t,side,.20,.06,.40,.06);}
    }else if(style==='mist'){
      for(let n=0;n<5;n++){piece('box','stone',(n+.5)/5,0,-.067,.57,.12,length/5*.83,slope);piece('rock','blue',(n+.5)/5,0,-.18,.20,.10,.17);}
      for(const side of [-.29,.29]){curve('rope',side,t=>.16+Math.sin(t*Math.PI)*.05,.011);for(const t of [.06,.94]){post(t,side,'gold',.28);piece('cone','ice',t,side,.24,.044,.14,.044);}}
    }else if(style==='forge'){
      for(let n=0;n<9;n++)piece('box',n%3?'dark':'gold',(n+.5)/9,0,-.053,.54,.105,length/9*.90,slope);
      for(const side of [-.29,.29]){curve('dark',side,()=>-.14,.044);curve('gold',side,t=>.22+Math.sin(t*Math.PI)*.035,.019);for(const t of [.07,.93]){piece('box','dark',t,side,.15,.065,.50,.06);piece('box','red',t,side,.40,.076,.065,.071);}}
    }else{
      const wet=style==='harbor',vine=style==='vine',reed=style==='reed',suspended=style==='suspension',deckColor=reed?'rope':'plank';
      for(let n=0;n<9;n++)piece('box',deckColor,(n+.5)/9,0,-.052,wet?.61:.51,.095,length/9*.87,slope);
      for(const side of [-(wet?.33:.29),wet?.33:.29]){
        curve(vine?'wood':'wood',side,t=>-.14-(vine?Math.sin(t*Math.PI)*.08:0),vine?.040:.025);
        for(const t of [.07,.93]){post(t,side,vine?'wood':wet?'wood':'gold',suspended?.83:wet?.62:.50);if(wet)piece('cylinder','rope',t,side,.38,.040,.028,.04);}
        if(suspended){curve('rope',side,t=>.65-Math.sin(t*Math.PI)*.37,.016);for(const t of [.22,.40,.60,.78]){const top=.65-Math.sin(t*Math.PI)*.37;piece('cylinder','rope',t,side,top/2,.008,top,.008);}}
        else if(vine){curve('wood',side,t=>.20+Math.sin(t*Math.PI)*.16,.023);for(const t of [.28,.53,.76])piece('rock','leaf',t,side,.34,.072,.026,.043);}
        else if(reed){curve('leaf',side,()=>.24,.019);for(const t of [.17,.40,.64,.87])piece('cylinder','rope',t,side,.16,.012,.40,.012);}
        else if(wet)curve('rope',side,t=>.30-Math.sin(t*Math.PI)*.08,.013);
      }
    }
  }
  for(const tile of TILES.filter(t=>t.bridge)){
    const color=tile.biome==='blood'?'dark':tile.biome==='fog'?'stone':'wood';
    if(!isWater(tile.biome))continue;
    const material=mats.get(color)!;if(!batches.has(material))batches.set(material,[]);
    // Slim piles leave water visible below each junction, instead of identical rock bases.
    for(const side of [-1,1]){const geo=kit.get('cylinder')!.clone().scale(.045,.58,.045).translate(tile.x+side*.19,.31,tile.z);batches.get(material)!.push(geo);}
  }
  for(const [material,geometries]of batches){const normalized=geometries.map(g=>{const n=g.index?g.toNonIndexed():g;n.deleteAttribute('uv');if(n!==g)g.dispose();return n;});const mesh=new THREE.Mesh(mergeGeometries(normalized)!,material);mesh.castShadow=true;mesh.receiveShadow=true;mesh.matrixAutoUpdate=false;group.add(mesh);normalized.forEach(g=>g.dispose());}
  kit.forEach(g=>g.dispose());group.userData.spans=spans;return group;
}
