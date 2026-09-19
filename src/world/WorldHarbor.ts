import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {MAIN_SITES,TILE_MAP,WORLD_SCALE,siteFootprint,tileId} from './worldData';
import {landHeightAt} from './storybookLandscape';
import type {WorldLightSource} from './WorldLighting';
type AddPiece=(shape:string,color:string,x:number,y:number,z:number,sx:number,sy:number,sz:number,ry?:number,rx?:number,rz?:number)=>void;
type AddBeam=(color:string,a:number[],b:number[],width?:number)=>void;

/** Authored nine-hex harbor. Restoration toggles baked groups, with no per-frame rebuild. */
export function buildWorldHarbor(scene:THREE.Scene,kit:Map<string,THREE.BufferGeometry>,materials:Map<string,THREE.Material>){
  const root=new THREE.Group();root.name='abandoned-grand-harbor';scene.add(root);
  const emitters:WorldLightSource[]=[],stages:{group:THREE.Group;min:number;max:number}[]=[];
  const build=(name:string,min:number,max:number,draw:(add:AddPiece,beam:AddBeam)=>void)=>{
    const group=new THREE.Group();group.name=name;group.userData.harborStage=min;root.add(group);stages.push({group,min,max});
    const batches=new Map<THREE.Material,THREE.BufferGeometry[]>();
    function collect(geometry:THREE.BufferGeometry,color:string){const mat=materials.get(color)!;if(!batches.has(mat))batches.set(mat,[]);batches.get(mat)!.push(geometry);}
    function piece(shape:string,color:string,x:number,y:number,z:number,sx:number,sy:number,sz:number,ry=0,rx=0,rz=0){
      const matrix=new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),new THREE.Quaternion().setFromEuler(new THREE.Euler(rx,ry,rz)),new THREE.Vector3(sx,sy,sz));collect(kit.get(shape)!.clone().applyMatrix4(matrix),color);
    }
    function span(color:string,a:number[],b:number[],width=.045){const direction=new THREE.Vector3(...b).sub(new THREE.Vector3(...a)),center=new THREE.Vector3(...a).add(new THREE.Vector3(...b)).multiplyScalar(.5),rotation=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),direction.clone().normalize());collect(kit.get('cylinder')!.clone().applyMatrix4(new THREE.Matrix4().compose(center,rotation,new THREE.Vector3(width,direction.length(),width))),color);}
    draw(piece,span);
    for(const [material,geometries]of batches){const normalized=geometries.map(g=>{const n=g.index?g.toNonIndexed():g;for(const key of Object.keys(n.attributes))if(key!=='position'&&key!=='normal')n.deleteAttribute(key);if(n!==g)g.dispose();return n;});const mesh=new THREE.Mesh(mergeGeometries(normalized)!,material);mesh.castShadow=!material.userData.nightGlow;mesh.receiveShadow=true;mesh.matrixAutoUpdate=false;mesh.userData.harbor=true;group.add(mesh);normalized.forEach(g=>g.dispose());}
  };
  const tilePoint=(id:string)=>{const t=TILE_MAP.get(id)!;return{x:t.x,y:Math.max(.67,landHeightAt(t.x,t.z)+.05),z:t.z};};
  // Anchored to the harbor's own tile. The previous literals ('1,9', '-1,11', '2,10', '2,9' and a
  // wreck at 10.55/16.53) were absolute coordinates from before the map was enlarged, so the whole
  // yard — warehouse, crane, tower, cargo and the wreck — ended up in open water far inland.
  const harbor=MAIN_SITES.find(s=>s.id==='ocean')!;
  const cellId=(dq:number,dr:number)=>tileId(harbor.q+dq,harbor.r+dr);
  const nearby=(dq:number,dr:number)=>tilePoint(cellId(dq,dr));
  const warehouse=nearby(1,-1),crane=nearby(-1,1),tower=nearby(2,0),cargo=nearby(2,-1);
  const berth=tilePoint(tileId(harbor.q,harbor.r));
  const ship={x:berth.x+1.89*WORLD_SCALE,y:.36,z:berth.z+1.53*WORLD_SCALE};
  build('harbor-seawalls-and-ruined-warehouses',0,3,(add,beam)=>{
    for(const [i,t]of siteFootprint('ocean').entries()){
      if(!i)continue;const y=Math.max(.60,landHeightAt(t.x,t.z));
      // Piles frame the tidal slip. Water remains visible beneath the wreck.
      if(![cellId(0,1),cellId(1,1)].includes(t.id))add('hexrock','slate',t.x,y-.13,t.z,.94,.26,.94);
      for(const side of [-1,1]){add('cylinder','wood',t.x+side*.58,.42,t.z+.55,.07,.78,.07);add('cylinder','gold',t.x+side*.58,.68,t.z+.55,.078,.04,.078);}
      if(i%2)for(let n=0;n<3;n++)add('rock','moss',t.x-.56+n*.14,.21,t.z+.71,.10,.075,.11,n);
    }
    const p=warehouse;
    add('box','stone',p.x,p.y+.72,p.z-.36,1.60,1.43,.22);add('box','slate',p.x-.72,p.y+.59,p.z,.22,1.17,1.05);
    for(const x of [-.57,.57]){add('box','stone',p.x+x,p.y+.75,p.z+.38,.37,1.5,.23);add('gable','stone',p.x+x,p.y+1.52,p.z+.38,.39,.36,.25);}
    add('rib','gold',p.x,p.y+.62,p.z+.50,.40,.65,.32);add('box','dark',p.x,p.y+.51,p.z+.32,.55,1.02,.04);
    for(const z of [-.38,0,.38])beam('wood',[p.x-.64,p.y+1.35,p.z+z],[p.x,p.y+1.92,p.z+z],.045);
    add('gable','copper',p.x-.38,p.y+1.56,p.z-.20,.81,.56,.70,.08,0,-.09);
    add('box','plank',p.x+.65,p.y+.15,p.z+.64,.18,.18,.77,.18,0,.11);
    // Customs gate, barrel yard and the broken western sea arm.
    add('rib','stone',cargo.x,cargo.y+.04,cargo.z,.55,1.02,.40);add('box','gold',cargo.x,cargo.y+1.08,cargo.z,.34,.11,.36);
    for(let n=0;n<5;n++){const x=cargo.x-.58+(n%3)*.37,z=cargo.z+.32+Math.floor(n/3)*.34;add('box','wood',x,cargo.y+.16,z,.30,.32,.30,.11*n);add('box','gold',x,cargo.y+.33,z,.032,.015,.32,.11*n);}
    const arm=tilePoint(cellId(-2,2));for(let n=0;n<7;n++){const t=n/6,x=THREE.MathUtils.lerp(crane.x,arm.x,t),z=THREE.MathUtils.lerp(crane.z,arm.z,t);add('box','stone',x,.62,z,.88,.23,.30,-.52);if(n%2===0)add('box','slate',x-.31,.86,z,.24,.40,.22,-.52,0,.14);}
    add('torus','gold',arm.x,.87,arm.z,.30,.30,.30,Math.PI/2);add('box','gold',arm.x,.82,arm.z,.07,.70,.07);
    // The shipwright and his repair bench are sheltered beside the forecourt.
    const artisan=tilePoint(cellId(0,0));add('box','wood',artisan.x-.55,.86,artisan.z-.39,.52,.44,.30);add('box','plank',artisan.x-.55,1.10,artisan.z-.39,.61,.07,.39);
    add('cone','blue',artisan.x-.38,.92,artisan.z-.04,.14,.43,.13);add('sphere','cloth',artisan.x-.38,1.21,artisan.z-.04,.10,.12,.10);add('sphere','bone',artisan.x-.38,1.17,artisan.z+.025,.07,.09,.07);add('dune','dark',artisan.x-.38,1.31,artisan.z-.04,.13,.08,.13);
    add('box','slate',artisan.x-.68,1.20,artisan.z-.42,.22,.10,.12);add('cylinder','wood',artisan.x-.68,1.10,artisan.z-.42,.024,.21,.024);
    // The lighthouse shell stays recognizable throughout all three repairs.
    add('cylinder','slate',tower.x,.91,tower.z,.60,.51,.60);add('cylinder','stone',tower.x,1.95,tower.z,.34,1.76,.34);
    for(const y of [1.18,1.98,2.75])add('cylinder','dark',tower.x,y,tower.z,.37,.13,.37);
    add('cylinder','gold',tower.x,2.85,tower.z,.61,.11,.61);
    for(let n=0;n<8;n++){const a=n*Math.PI/4;add('cylinder','gold',tower.x+Math.sin(a)*.45,3.18,tower.z+Math.cos(a)*.45,.022,.65,.022);}
    add('cone','dark',tower.x,3.72,tower.z,.67,.47,.67);add('sphere','gold',tower.x,3.98,tower.z,.06,.11,.06);
  });
  const dock=(repaired:boolean)=>build(repaired?'rebuilt-docks-and-upright-crane':'broken-docks-and-leaning-crane',repaired?1:0,repaired?3:0,(add,beam)=>{
    for(const id of [cellId(1,0),cellId(0,1),cellId(1,1)]){const p=tilePoint(id);for(let n=0;n<8;n++){if(!repaired&&[2,3,6].includes(n))continue;add('box',repaired?'plank':'wood',p.x,p.y-.02,p.z+(n-3.5)*.155,1.38,.085,.13,0,0,repaired?0:(n%3-1)*.10);}}
    const x=crane.x,z=crane.z,y=crane.y,lean=repaired?0:.51;
    add('cylinder','dark',x,y+.12,z,.40,.23,.40);beam('copper',[x,y+.20,z],[x+lean,y+2.35,z],.085);
    beam('wood',[x-.28,y+.25,z],[x+lean,y+2.0,z],.055);beam('copper',[x+lean-.37,y+2.18,z],[x+lean+1.07,y+2.47,z],.075);
    beam('gold',[x+lean,y+2.3,z],[x+lean+.95,y+2.44,z],.017);beam('gold',[x+lean+.94,y+2.42,z],[x+lean+.94,y+.83,z],.012);
    add('torus','dark',x+lean+.94,y+.72,z,.13,.20,.13);add('cylinder','gold',x+lean,y+1.12,z,.22,.13,.22,0,Math.PI/2);
    if(!repaired)for(let n=0;n<7;n++)add('box','plank',9.38+(n%3)*.32,.22+(n%2)*.04,15.7+Math.floor(n/3)*.32,.12,.05,.61,n*.72,0,.18);
  });dock(false);dock(true);
  build('dark-shattered-lighthouse',0,1,(add)=>{add('cylinder','dark',tower.x,3.17,tower.z,.33,.45,.33);add('rock','ice',tower.x+.2,2.95,tower.z+.27,.13,.065,.16);});
  build('rekindled-harbor-lights',2,3,(add)=>{
    add('cylinder','glow',tower.x,3.17,tower.z,.32,.48,.32);
    for(const p of [warehouse,cargo,crane]){add('box','glow',p.x+.50,p.y+.82,p.z+.42,.18,.27,.04);emitters.push({x:p.x+.50,y:p.y+.82,z:p.z+.45,color:'#ffd38e',radius:1.7,power:1.3,siteId:'ocean',kind:'window',harborStage:2});}
    emitters.push({x:tower.x,y:3.2,z:tower.z,color:'#ffe0a0',radius:3.2,power:3.1,siteId:'ocean',kind:'lamp',harborStage:2});
  });
  const vessel=(repaired:boolean)=>build(repaired?'refloated-homeward-ship':'half-sunken-homeward-wreck',repaired?3:0,repaired?3:2,(add,beam)=>{
    const p=ship,y=repaired?.79:.32,tilt=repaired?0:.23;
    add('sphere','dark',p.x,y,p.z,1.57,.33,.53,0,0,tilt);add('box',repaired?'plank':'wood',p.x,y+.22,p.z,2.55,.12,.76,0,0,tilt);
    for(const side of [-1,1]){add('box','wood',p.x,y+.41,p.z+side*.42,2.50,.29,.065,0,0,tilt);add('box','gold',p.x,y+.58,p.z+side*.43,2.50,.035,.045,0,0,tilt);}
    for(let n=0;n<6;n++)add('rib','wood',p.x-.9+n*.36,y+.20,p.z,.42,.48,.36,0,Math.PI/2);
    const mastX=p.x-.25,mastTop=y+(repaired?3.15:2.28);beam('wood',[mastX,y+.25,p.z],[mastX+(repaired?0:.58),mastTop,p.z],.055);
    for(const line of [-1,1])beam('gold',[mastX+(repaired?0:.58),mastTop-.1,p.z],[p.x+line*1.18,y+.48,p.z+line*.32],.008);
    if(repaired){add('sail','cloth',mastX+.18,y+2.08,p.z+.08,1.61,1.40,1);beam('gold',[mastX-.72,y+2.82,p.z],[mastX+.98,y+2.82,p.z],.025);add('box','blue',mastX+.24,mastTop-.13,p.z,.57,.21,.035);add('box','glow',p.x+1.0,y+.60,p.z+.42,.15,.18,.05);}
    else{for(let n=0;n<4;n++)add('sail','cloth',mastX+.26+n*.17,y+1.35+n*.05,p.z+.035,.18,.66-n*.08,1,0,0,.14+n*.13);beam('wood',[p.x-.90,y+.44,p.z],[p.x-1.66,y+.13,p.z-.27],.038);}
  });vessel(false);vessel(true);
  build('reopened-warehouse-and-harbor-flags',3,3,(add)=>{
    add('gable','copper',warehouse.x+.36,warehouse.y+1.56,warehouse.z+.10,.81,.56,.82);
    for(const p of [warehouse,cargo]){add('cylinder','gold',p.x-.60,p.y+1.28,p.z-.45,.02,2.3,.02);add('box','blue',p.x-.37,p.y+2.15,p.z-.45,.46,.43,.025);add('box','gold',p.x-.37,p.y+2.15,p.z-.425,.10,.28,.013);}
  });
  const rendered=new THREE.Group();root.add(rendered);let currentStage=-1;
  const setStage=(stage:number)=>{
    if(stage===currentStage)return;currentStage=stage;rendered.name='harbor-state-'+stage;
    for(const child of [...rendered.children]){rendered.remove(child);(child as THREE.Mesh).geometry.dispose();}
    const batches=new Map<THREE.Material,THREE.BufferGeometry[]>();
    for(const item of stages){item.group.visible=false;if(stage<item.min||stage>item.max)continue;for(const child of item.group.children){const mesh=child as THREE.Mesh,material=mesh.material as THREE.Material;if(!batches.has(material))batches.set(material,[]);batches.get(material)!.push(mesh.geometry);}}
    for(const [material,geometries]of batches){const mesh=new THREE.Mesh(mergeGeometries(geometries)!,material);mesh.castShadow=!material.userData.nightGlow;mesh.receiveShadow=true;mesh.matrixAutoUpdate=false;rendered.add(mesh);}
    root.userData.stage=stage;
  };setStage(0);
  return{root,emitters,setStage};
}
