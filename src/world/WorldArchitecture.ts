import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LANDMARKS, TILE_MAP, siteFootprint, walkHeight, isWater, type Landmark, type Tile } from './worldData';
import { landHeightAt } from './storybookLandscape';
import type {WorldLightSource} from './WorldLighting';
import {buildWorldHarbor} from './WorldHarbor';

type Point = {x:number;y:number;z:number};
type Kit = Map<string,THREE.BufferGeometry>;
/** Forty-eight authored silhouettes, baked by material into a small static batch. */
export function buildWorldArchitecture(scene:THREE.Scene,kit:Kit,lava:THREE.Material){
  const colors:Record<string,string>={stone:'#8c9790',chalk:'#c2bfac',slate:'#4e5d6b',dark:'#282e39',wood:'#7e654a',plank:'#ac906c',leaf:'#426351',moss:'#748463',gold:'#c7a15a',cloth:'#c3b28b',blue:'#46616b',ice:'#b2cccd',red:'#854657',purple:'#9489b0',bone:'#c5bca0',sand:'#b19667',copper:'#997156',glow:'#ffdb99'};
  const mats=new Map(Object.entries(colors).map(([key,color])=>[key,key==='glow'?new THREE.MeshBasicMaterial({color}):new THREE.MeshLambertMaterial({color})] as [string,THREE.Material]));mats.set('lava',lava);
  mats.get('glow')!.userData.nightGlow=true;
  for(const [key,color,power]of [['quartz','#aaa0d4',.55],['quartz-ice','#b8e1ee',.43],['rune-red','#c96086',.78]] as const){const material=new THREE.MeshLambertMaterial({color,emissive:color,emissiveIntensity:0});material.userData.nightEmission=power;mats.set(key,material);}
  const emitters:WorldLightSource[]=[];let activeSite:Landmark;
  // Buildings were authored small against a camera that spans 23-38 world units, so they read as
  // scenery rather than landmarks. Everything below still uses its original dimensions.
  const BUILDING_SCALE=1.5;
  const batches=new Map<THREE.Material,THREE.BufferGeometry[]>();
  const add=(shape:string,color:string,p:Point,dx:number,dy:number,dz:number,sx:number,sy:number,sz:number,ry=0,rx=0,rz=0,fixed=false)=>{
    if(activeSite?.biome==='blood'&&color==='red'&&(shape==='torus'||shape==='rock'))color='rune-red';
    const material=mats.get(color)!;
    if(!batches.has(material))batches.set(material,[]);
    // Every building is authored at the size it was designed at; one factor here grows all of them
    // together, offsets included, so nothing has to be retouched branch by branch. Plinths opt out:
    // they already fill a hex and would spill into their neighbours at 1.5x.
    const k=fixed?1:BUILDING_SCALE;
    const matrix=new THREE.Matrix4().compose(new THREE.Vector3(p.x+dx*k,p.y+dy*k,p.z+dz*k),new THREE.Quaternion().setFromEuler(new THREE.Euler(rx,ry,rz)),new THREE.Vector3(sx*k,sy*k,sz*k));
    batches.get(material)!.push(kit.get(shape)!.clone().applyMatrix4(matrix));
    if(color==='glow')emitters.push({x:p.x+dx*k,y:p.y+dy*k,z:p.z+dz*k+.02,color:'#ffd091',radius:activeSite.id==='fog'&&dy>1.35?3.0:1.22,power:activeSite.id==='fog'&&dy>1.35?3.1:.90,siteId:activeSite.id,kind:shape==='box'?'window':'lamp'});
    if(color==='rune-red'&&shape==='rock')emitters.push({x:p.x+dx*k,y:p.y+dy*k,z:p.z+dz*k,color:'#eb6c97',radius:1.7,power:1.5,siteId:activeSite.id,kind:'crystal'});
  };
  const roofGeo=new THREE.BufferGeometry();roofGeo.setAttribute('position',new THREE.Float32BufferAttribute([-.5,-.5,-.5,.5,-.5,-.5,0,.5,-.5,-.5,-.5,.5,.5,-.5,.5,0,.5,.5],3));roofGeo.setIndex([0,2,1,3,4,5,0,3,5,0,5,2,2,5,4,2,4,1,0,1,4,0,4,3]);roofGeo.computeVertexNormals();kit.set('gable',roofGeo);
  const sailGeo=new THREE.PlaneGeometry(1,1,6,5),sp=sailGeo.getAttribute('position');for(let i=0;i<sp.count;i++)sp.setZ(i,Math.cos(sp.getX(i)*Math.PI)*Math.cos(sp.getY(i)*Math.PI)*.19);sailGeo.computeVertexNormals();kit.set('sail',sailGeo);
  const arch=(p:Point,width:number,height:number,color='stone')=>{add('rib',color,p,0,.12,0,width,height,.36);for(const side of [-1,1])add('box',color,p,side*width,.11,0,.20,.22,.29);};
  const beam=(a:Point,b:Point,width:number,color='wood')=>{
    const direction=new THREE.Vector3(b.x-a.x,b.y-a.y,b.z-a.z),mid=new THREE.Vector3(a.x,a.y,a.z).add(new THREE.Vector3(b.x,b.y,b.z)).multiplyScalar(.5);
    const rotation=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),direction.clone().normalize());
    const g=kit.get('cylinder')!.clone().applyMatrix4(new THREE.Matrix4().compose(mid,rotation,new THREE.Vector3(width,direction.length(),width)));
    const material=mats.get(color)!;if(!batches.has(material))batches.set(material,[]);batches.get(material)!.push(g);
  };
  const offset=(p:Point,x=0,y=0,z=0):Point=>({x:p.x+x,y:p.y+y,z:p.z+z});
  const point=(t:Tile):Point=>({x:t.x,y:Math.max(walkHeight(t),landHeightAt(t.x,t.z)+.07,t.structure&&isWater(t.biome)?.62:0),z:t.z});
  const window=(p:Point,x:number,y:number,z:number,w=.13,h=.22)=>{add('box','dark',p,x,y,z,w+.055,h+.06,.025);add('box','glow',p,x,y,z+.017,w,h,.015);};
  const stairs=(p:Point,w=.7,count=4)=>{for(let n=0;n<count;n++)add('box','stone',p,0,.025+n*.043,.67-n*.12,w,.055+n*.075,.15);};
  const lantern=(p:Point)=>{add('cylinder','gold',p,0,.29,0,.015,.57,.015);add('box','glow',p,0,.54,0,.10,.15,.10);add('cone','gold',p,0,.65,0,.12,.12,.12);};
  const crystal=(p:Point,h:number,color='purple',r=.23)=>{const material=color==='purple'?'quartz':'quartz-ice';add('crystal',material,p,0,h*.48,0,r,h*.96,r);add('cone',material,p,0,h+.13,0,r*.68,.32,r*.68);emitters.push({x:p.x,y:p.y+h*.65,z:p.z,color:color==='purple'?'#b6a9ff':'#a6e5ee',radius:Math.min(1.6,.55+h*.45),power:.3+h*.35,siteId:activeSite.id,kind:'crystal'});};
  const boat=(p:Point,scale=1,sail=false)=>{
    add('sphere','dark',p,0,.10,0,.31*scale,.19*scale,.73*scale);
    add('box','plank',p,0,.20,0,.43*scale,.07,.97*scale);
    for(const side of [-1,1])add('box','wood',p,side*.24*scale,.27,0,.055,.13,.95*scale);
    if(sail){add('cylinder','wood',p,0,.95*scale,0,.028,1.7*scale,.028);add('sail','cloth',p,0,1.24*scale,.015,.95*scale,.96*scale,1,0);beam(offset(p,-.56*scale,1.74*scale,0),offset(p,.56*scale,1.74*scale,0),.024);beam(offset(p,0,1.83*scale,0),offset(p,0,.24,.60*scale),.009,'gold');}
  };
  const anvil=(p:Point,scale=1)=>{add('box','dark',p,0,.16*scale,0,.38*scale,.32*scale,.33*scale);add('box','slate',p,0,.34*scale,0,.64*scale,.17*scale,.36*scale);add('cone','slate',p,.37*scale,.34*scale,0,.16*scale,.43*scale,.15*scale,0,0,-Math.PI/2);};
  const wagon=(p:Point,color='cloth')=>{add('box','wood',p,0,.29,0,.85,.20,.95);for(const x of [-.47,.47])for(const z of [-.34,.34])add('torus','dark',p,x,.19,z,.19,.19,.19,Math.PI/2);add('box',color,p,0,.65,0,.80,.61,.88);add('dune',color,p,0,.95,0,.48,.30,.50);window(p,0,.66,.452,.23,.20);beam(offset(p,-.25,.25,.50),offset(p,-.25,.21,1.0),.025);};
  const tent=(p:Point,color='cloth',s=1)=>{add('gable',color,p,0,.42*s,0,1.04*s,.85*s,.83*s);add('gable','dark',p,0,.32*s,.427*s,.39*s,.61*s,.015);for(const side of [-1,1])beam(offset(p,side*.52*s,0,.42*s),offset(p,0,.85*s,.42*s),.025,'gold');};
  const npc=(p:Point,color:string)=>{add('cone',color,p,0,.20,0,.13,.40,.12);add('sphere','cloth',p,0,.45,0,.095,.115,.095);add('cone',color,p,0,.59,0,.16,.24,.16);};
  const bell=(p:Point,s=1)=>{add('cone','gold',p,0,.28*s,0,.25*s,.42*s,.25*s);add('torus','gold',p,0,.095*s,0,.24*s,.24*s,.24*s,0,Math.PI/2);add('sphere','dark',p,0,.09*s,0,.06*s,.09*s,.06*s);};
  const flamePositions:Point[]=[];
  const sails:Point[]=[];
  const roots=(p:Point,s=1)=>{for(let n=0;n<5;n++){const a=n/5*Math.PI*2;beam(offset(p,Math.sin(a)*.15*s,.55*s,Math.cos(a)*.15*s),offset(p,Math.sin(a)*.83*s,.04,Math.cos(a)*.83*s),.12*s,'wood');}};

  const main=(site:Landmark)=>{
    const cells=siteFootprint(site.id),entry=point(cells[0]),parts=cells.slice(1).map(point),p=parts[0],wing=parts[1],tail=parts[2]||parts[1];
    for(const [i,tile]of cells.entries()){
      const f=point(tile),color=site.biome==='desert'?'sand':site.biome==='volcano'||site.biome==='blood'?'dark':site.biome==='waste'?'bone':site.biome==='snow'?'ice':site.biome==='forest'||site.biome==='swamp'?'moss':'stone';
      // Forecourts stay flush with the navigation surface; only occupied cells rise.
      if(i){add('hexrock',color,f,0,-.09,0,.94,.18,.94,0,0,0,true);add('hexrock',color,f,0,.022,0,.83,.065,.83,0,0,0,true);}
      else {for(const side of [-1,1])lantern(offset(f,side*.67,0,.28));}
    }
    if(site.id==='camp'){
      wagon(p);tent(wing,'blue',1.23);add('box','wood',tail,0,.62,0,.83,1.2,.76);add('gable','blue',tail,0,1.42,0,1.06,.60,.94);window(tail,0,.88,.40,.33,.24);
      add('box','plank',tail,0,.09,.65,.91,.14,.40);for(const side of [-1,1])add('cylinder','wood',tail,side*.33,.52,.59,.04,1.02,.04);
      const hearth=offset(entry,.46,0,-.38);for(let n=0;n<8;n++)add('rock','slate',hearth,Math.sin(n*.79)*.25,.025,Math.cos(n*.79)*.25,.08,.07,.08);flamePositions.push(hearth);
      for(let n=0;n<3;n++)add('cylinder','wood',wing,.58+n*.11,.15,.44,.1,.3,.1);
    }else if(site.id==='forest'){
      add('trunk','wood',p,0,1.10,0,.43,2.2,.43);roots(p,1.1);arch(offset(p,0,.14,.43),.30,.70,'wood');add('box','dark',p,0,.41,.38,.44,.58,.04);
      for(let n=0;n<5;n++){const a=n*1.256;beam(offset(p,0,1.36,0),offset(p,Math.sin(a)*.8,2.05,Math.cos(a)*.8),.09,'wood');add('crown',n%2?'leaf':'moss',p,Math.sin(a)*.71,2.20,Math.cos(a)*.61,.71,.61,.67,a);}
      add('dune','leaf',wing,0,.46,0,.73,.42,.62);for(const x of [-.44,.44])add('trunk','wood',wing,x,.28,0,.045,.58,.045);add('box','gold',wing,0,.19,0,.26,.31,.21);
      for(let n=0;n<5;n++)add('rock',n%2?'stone':'moss',tail,Math.sin(n*1.26)*.52,.23,Math.cos(n*1.26)*.52,.15,.35,.15,n);crystal(offset(tail,0,.07,0),.32,'ice',.13);
    }else if(site.id==='snow'){
      add('box','ice',p,0,.75,0,1.18,1.5,1.25);add('gable','chalk',p,0,1.91,0,1.46,.89,1.5);arch(offset(p,0,.20,.65),.31,.75,'slate');window(p,0,1.40,.64,.27,.33);stairs(p,1.05,5);
      for(const [i,t]of parts.slice(1).entries()){const h=i===0?2.4:1.5;add('cylinder','ice',t,0,h*.45,0,.33,h*.9,.33);add('cone','blue',t,0,h+.28,0,.48,.73,.48);add('cone','chalk',t,0,h+.39,0,.35,.52,.35);window(t,0,h*.60,.34,.12,.43);}
      for(const side of [-1,1])add('box','chalk',p,side*.62,.75,0,.12,1.43,1.12);
    }else if(site.id==='desert'){
      for(let n=0;n<4;n++)add('box',n%2?'sand':'chalk',p,0,.2+n*.30,0,1.65-n*.27,.32,1.55-n*.27);
      add('box','gold',p,0,1.46,0,.52,.13,.49);add('box','dark',p,0,1.04,.39,.23,.46,.03);stairs(p,1.0,5);
      for(const [i,t]of parts.slice(1).entries()){if(i<2){add('box','sand',t,0,.53,0,.74,1.06,.47);add('box','gold',t,0,1.08,0,.83,.10,.54);add('box','dark',t,0,.55,.244,.12,.58,.016);add('peak','gold',t,0,1.39,0,.36,.54,.25,Math.PI/4);}else{arch(t,.57,.82,'sand');add('box','sand',t,.58,.13,.40,.42,.23,.31,.25);}}
    }else if(site.id==='blood'){
      add('cylinder','dark',p,0,.14,0,.86,.28,.86);add('torus','red',p,0,.30,0,.69,.69,.69,0,Math.PI/2);
      add('torus','dark',p,0,1.44,-.12,.74,.90,.74);add('torus','gold',p,0,1.44,-.11,.61,.77,.61);add('rock','red',p,0,1.25,.05,.28,.48,.25);add('cone','glow',p,0,1.84,.07,.11,.34,.11);
      for(const [i,t]of parts.slice(1).entries()){add('peak','dark',t,0,.73,0,.54,1.45,.50,i*.7);add('peak','red',t,0,1.61,0,.18,.53,.16,i);add('torus','red',t,0,.03,0,.59,.59,.59,0,Math.PI/2);}
    }else if(site.id==='fog'){
      add('cylinder','chalk',p,0,1.15,0,.32,2.3,.32);for(const y of [.17,.82,1.53,2.31])add('cylinder','blue',p,0,y,0,y===2.31?.60:.36,.10,y===2.31?.60:.36);
      add('cylinder','glow',p,0,2.62,0,.28,.53,.28);add('cone','blue',p,0,3.03,0,.59,.45,.59);add('sphere','gold',p,0,3.29,0,.07,.10,.07);
      for(let n=0;n<8;n++)add('cylinder','gold',p,Math.sin(n*.785)*.45,2.48,Math.cos(n*.785)*.45,.018,.36,.018);
      for(let n=0;n<7;n++){const a=n*.71;add('box','slate',p,Math.sin(a)*.36,.11+n*.22,Math.cos(a)*.36,.23,.08,.20,-a);}
      add('box','plank',wing,0,.16,0,1.25,.16,.95);boat(offset(wing,.15,.26,-.07),.65);for(const side of [-1,1])lantern(offset(wing,side*.48,.15,.4));
    }else if(site.id==='cliff'){
      add('box','slate',p,0,.72,0,1.02,1.43,.93);add('box','stone',p,0,1.47,0,1.2,.14,1.1);
      for(const x of [-.46,0,.46])for(const z of [-.44,.44])add('box','stone',p,x,1.64,z,.22,.30,.22);window(p,0,.95,.48,.15,.43);arch(offset(p,0,.08,.49),.22,.49,'stone');
      add('box','slate',wing,0,.39,0,.81,.78,.85);add('box','plank',wing,0,.87,0,1.15,.16,1.12);beam(offset(wing,-.34,.9,0),offset(wing,-.34,1.85,0),.055);beam(offset(wing,-.47,1.78,0),offset(wing,.70,1.78,0),.055);beam(offset(wing,.6,1.78,0),offset(wing,.6,.93,0),.009,'gold');bell(offset(wing,.6,.65,0),.55);
      add('box','stone',tail,0,.29,0,1.14,.58,.34);for(const x of [-.40,0,.4])add('box','stone',tail,x,.66,0,.19,.22,.38);
    }else if(site.id==='ocean'){
      add('box','blue',p,0,.51,0,1.12,1.02,.84);add('gable','copper',p,0,1.28,0,1.39,.54,1.09);for(const side of [-1,1])window(p,side*.31,.65,.436,.24,.24);add('box','dark',p,0,.30,.437,.24,.53,.025);
      for(const [i,t]of parts.slice(1).entries()){add('box','plank',t,0,.12,0,1.29,.16,1.15);for(const x of [-.52,.52])for(const z of [-.44,.44])add('cylinder','wood',t,x,-.17,z,.05,.75,.05);if(i===0){boat(offset(t,0,.18,0),1.12,true);sails.push(t);}else if(i===1){boat(offset(t,0,.20,0),.8);for(let n=0;n<3;n++)add('cylinder','wood',t,-.55,.32,(n-1)*.27,.12,.32,.12);}else{beam(offset(t,-.35,.16,0),offset(t,-.35,1.30,0),.055);beam(offset(t,-.55,1.22,0),offset(t,.57,1.22,0),.055);beam(offset(t,.45,1.22,0),offset(t,.45,.45,0),.008,'gold');add('box','wood',t,.4,.30,0,.37,.40,.35);}}
    }else if(site.id==='swamp'){
      for(const x of [-.42,.42])for(const z of [-.36,.36])add('trunk','wood',p,x,.54,z,.055,1.24,.055);
      add('box','plank',p,0,.71,0,1.2,.10,1.08);for(const x of [-.38,.38])add('trunk','wood',p,x,1.22,0,.06,1.01,.06,0,0,.06);
      add('dune','moss',p,0,1.73,0,.82,.49,.72);add('dune','leaf',p,-.12,1.91,.03,.50,.42,.43);bell(offset(p,0,1.08,.02),1.12);roots(p,.86);
      add('box','wood',wing,0,.42,0,.9,.64,.7);add('gable','moss',wing,0,.94,0,1.23,.39,.95);window(wing,0,.48,.36,.23,.22);boat(offset(wing,.58,.01,.40),.57);
    }else if(site.id==='volcano'){
      add('crater','dark',p,0,.74,0,1.35,1.43,1.35);add('cylinder','lava',p,0,1.39,0,.44,.035,.44);add('torus','copper',p,0,1.48,0,.49,.49,.49,0,Math.PI/2);flamePositions.push(offset(p,0,1.4,0));
      for(const side of [-1,1])add('box','slate',p,side*.72,.46,.38,.27,.91,.30);add('box','dark',p,0,.78,.56,1.66,.24,.39);add('box','lava',p,0,.34,.76,.42,.48,.03);
      for(const [i,t]of parts.slice(1).entries()){if(i===0){for(let n=0;n<3;n++){add('cylinder','dark',t,(n-1)*.39,.72+n*.21,0,.16,1.44+n*.42,.16);add('cylinder','copper',t,(n-1)*.39,1.5+n*.42,0,.20,.13,.20);flamePositions.push(offset(t,(n-1)*.39,1.55+n*.42,0));}}else if(i===1){anvil(t,1.6);add('torus','copper',t,0,.10,0,.66,.66,.66,0,Math.PI/2);}else{add('box','copper',t,0,.39,0,.95,.78,.85);add('gable','dark',t,0,.94,0,1.19,.33,1.04);window(t,0,.42,.438,.31,.25);}}
    }else if(site.id==='crystal'){
      crystal(p,1.66,'purple',.48);add('torus','gold',p,0,1.48,0,.84,.84,.84,.4,.55,.2);add('torus','ice',p,0,1.48,0,.74,.74,.74,-.5,-.62,-.3);add('sphere','glow',p,0,2.34,0,.16,.16,.16);
      crystal(offset(wing,-.25,0,-.10),.97,'ice',.28);crystal(offset(wing,.29,0,.2),1.4,'purple',.26);add('torus','gold',wing,0,.12,0,.67,.67,.67,0,Math.PI/2);
      for(const [i,t]of parts.slice(2).entries()){for(let n=0;n<3;n++)beam(offset(t,Math.sin(n*2.094)*.38,0,Math.cos(n*2.094)*.38),offset(t,0,.70,0),.035,'gold');add('cylinder','blue',t,0,.97,0,.20,.87,.20,0,-.65);add('cylinder','ice',t,0,1.30,-.27,.19,.035,.19,0,-.65);if(i)add('rock','purple',t,.4,.19,.3,.22,.35,.22);}
    }else if(site.id==='waste'){
      for(const t of [p,...parts.slice(1,3)]){for(const dz of [-.36,.02,.40])add('rib','bone',t,0,.05,dz,.68,1.30,.53);beam(offset(t,0,1.34,-.60),offset(t,0,1.34,.60),.085,'bone');}
      add('sphere','bone',p,0,.39,-.25,.48,.33,.59);for(const side of [-1,1]){add('sphere','dark',p,side*.23,.46,.15,.12,.12,.06);add('cone','bone',p,side*.48,.53,-.23,.12,.73,.12,0,0,-side*.72);}add('box','dark',p,0,.27,.27,.17,.16,.02);
      const throne=parts.at(-1)!;add('box','sand',throne,0,.24,0,.73,.45,.66);add('box','sand',throne,0,.75,-.26,.80,1.18,.19);for(const side of [-1,1])add('box','gold',throne,side*.38,.47,.1,.13,.72,.55);add('peak','gold',throne,0,1.51,-.26,.19,.37,.14,Math.PI/4);stairs(throne,.80,3);
    }
  };

  const small=(site:Landmark)=>{
    const tile=TILE_MAP.get(`${site.q},${site.r}`)!,p=offset(point(tile),-.19,0,-.30),b=site.biome;
    if(site.kind==='side'){
      if(b==='grass'){add('cylinder','chalk',p,0,.46,0,.23,.92,.23);add('cone','blue',p,0,1.05,0,.39,.41,.39);for(let n=0;n<4;n++)add('box','cloth',p,Math.sin(n*Math.PI/2)*.23,1.04+Math.cos(n*Math.PI/2)*.23,.25,.15,.54,.026,0,0,-n*Math.PI/2);window(p,0,.35,.24);}
      else if(b==='forest'){add('cylinder','chalk',p,0,.26,0,.30,.52,.30);add('dune','red',p,0,.55,0,.56,.35,.52);for(let n=0;n<5;n++)add('sphere','cloth',p,Math.sin(n*1.25)*.30,.75,Math.cos(n*1.25)*.25,.058,.022,.055);window(p,0,.27,.31);for(const x of [-.45,.45])add('sphere','purple',p,x,.12,.20,.10,.12,.10);}
      else if(b==='desert'){wagon(offset(p,0,0,-.13),'red');add('gable','cloth',p,.45,.54,.35,.5,.32,.47);for(let n=0;n<3;n++)add('sphere',n%2?'gold':'copper',p,.46,.10,.12+n*.2,.10,.13,.10);}
      else if(b==='cliff'){for(const x of [-.39,.39])add('box','wood',p,x,.46,0,.08,.91,.10);add('box','plank',p,0,.90,0,.97,.12,.38);add('torus','gold',p,0,.70,0,.17,.17,.17);add('box','wood',p,0,.22,.20,.70,.13,.41);for(let n=0;n<4;n++)add('cylinder','wood',p,-.38,.12,-.33+n*.12,.053,.62,.053,0,Math.PI/2);}
      else if(b==='snow'){add('box','wood',p,0,.32,0,.67,.64,.68);add('gable','ice',p,0,.94,0,.90,.70,.94);add('box','slate',p,.20,.99,-.22,.12,.5,.14);window(p,0,.38,.35,.22,.21);for(const x of [-.45,-.36])add('box','plank',p,x,.32,.26,.046,.73,.06,0,0,-.24);}
      else if(b==='ocean'){for(const x of [-.33,.33])for(const z of [-.29,.29])add('cylinder','wood',p,x,.23,z,.035,.65,.035);add('box','blue',p,0,.58,0,.66,.43,.57);add('gable','cloth',p,0,.95,0,.85,.33,.79);window(p,0,.61,.30,.22,.13);for(let n=0;n<5;n++)beam(offset(p,.44+n*.05,.15,.17),offset(p,.42+n*.05,.60,-.29),.006,'cloth');}
      else if(b==='blood'){tent(p,'red',.8);add('torus','bone',p,0,.87,0,.17,.17,.17);for(const side of [-1,1])add('cone','dark',p,side*.16,.87,.02,.10,.41,.1,0,0,-side*.9);add('box','cloth',p,.49,.24,.0,.28,.12,.49);add('sphere','glow',p,.49,.35,0,.08,.10,.08);}
      else if(b==='fog'){add('box','blue',p,0,.31,0,.57,.59,.51);add('dune','cloth',p,0,1.38,0,.43,.50,.36);for(const x of [-.27,.27])beam(offset(p,x,.56,0),offset(p,x,1.39,0),.012,'gold');add('box','gold',p,0,.68,0,.66,.08,.59);window(p,0,.37,.27,.20,.17);add('box','red',p,.42,.21,.1,.20,.35,.19);}
      else if(b==='swamp'){for(const x of [-.39,.39])add('cylinder','wood',p,x,.29,0,.037,.58,.037);add('gable','moss',p,0,.67,0,.99,.50,.81);boat(offset(p,0,.02,0),.7);for(let n=0;n<4;n++)add('cylinder','plank',p,-.40+n*.13,.82,0,.026,.87,.026,0,Math.PI/2);}
      else if(b==='volcano'){for(let n=0;n<3;n++)beam(offset(p,Math.sin(n*2.09)*.40,0,Math.cos(n*2.09)*.40),offset(p,0,.73,0),.034,'copper');add('torus','gold',p,0,.83,0,.34,.34,.34,0,.44);add('cylinder','slate',p,0,.43,0,.13,.80,.13);add('sphere','glow',p,0,.93,0,.08,.08,.08);add('box','copper',p,.48,.16,.18,.31,.31,.29);}
      else if(b==='crystal'){tent(p,'purple',.92);add('torus','gold',p,0,.85,.40,.20,.20,.20);crystal(offset(p,.47,0,.15),.45,'ice',.10);add('box','blue',p,-.4,.19,.20,.26,.13,.43);}
      else {arch(p,.45,.77,'bone');add('sail','cloth',p,0,.53,-.03,.76,.67,.25);for(let n=0;n<3;n++)add('box',n%2?'wood':'copper',p,-.50+n*.29,.13,.41,.23,.23,.20,n*.13);}
      npc(offset(p,.54,0,.50),b==='snow'?'blue':b==='volcano'?'copper':b==='forest'?'purple':'dark');
    }else if(site.kind==='hidden'){
      if(b==='grass'){add('trunk','wood',p,0,.46,0,.44,.92,.40);add('sphere','dark',p,0,.39,.38,.24,.31,.04);roots(p,.62);add('dune','moss',p,0,.91,0,.49,.14,.46);for(let n=0;n<4;n++)add('sphere','glow',p,(n-1.5)*.09,.29+(n%2)*.17,.45,.017,.019,.017);}
      else if(b==='forest'){add('hexrock','stone',p,0,.14,0,.49,.28,.43);add('sphere','stone',p,0,.49,0,.23,.19,.12);for(const side of [-1,1]){beam(offset(p,side*.12,.49,0),offset(p,side*.35,.94,0),.035,'bone');beam(offset(p,side*.24,.74,0),offset(p,side*.48,.81,0),.022,'bone');}add('sphere','moss',p,-.39,.18,.28,.16,.14,.13);}
      else if(b==='desert'){for(let n=0;n<4;n++)add('box','sand',p,0,.07+n*.075,-.15-n*.12,.64,.10,.16);add('box','dark',p,0,.03,.28,.45,.02,.42);arch(offset(p,0,.03,-.40),.38,.49,'sand');add('box','gold',p,.47,.07,.06,.22,.08,.21);}
      else if(b==='cliff'){add('rock','slate',p,0,.48,0,.48,.58,.38);add('sphere','dark',p,0,.29,.32,.24,.26,.07);add('torus','wood',p,0,.99,0,.26,.26,.24,0,Math.PI/2);for(let n=0;n<3;n++)add('sphere','cloth',p,(n-1)*.1,1.0,0,.06,.09,.06);beam(offset(p,-.36,0,.43),offset(p,-.36,.8,.22),.012,'gold');}
      else if(b==='snow'){for(const side of [-1,1])crystal(offset(p,side*.35,0,0),side===1?.66:.9,'ice',.25);add('rib','ice',p,0,.07,0,.38,.71,.29);add('box','blue',p,0,.30,-.04,.44,.52,.07);}
      else if(b==='ocean'){for(const side of [-1,1])add('rock','slate',p,side*.28,.24,0,.31,.32,.39);add('rock','stone',p,0,.59,0,.44,.20,.31);add('sphere','dark',p,0,.23,.17,.28,.26,.04);for(let n=0;n<3;n++)add('sphere','glow',p,(n-1)*.1,.16,.25,.024,.024,.024);}
      else if(b==='blood'){add('hexrock','dark',p,0,.07,0,.5,.14,.5);add('torus','red',p,0,.08,0,.43,.43,.43,0,Math.PI/2);arch(p,.28,.51,'dark');add('sphere','red',p,0,.40,.06,.16,.16,.04);add('sphere','dark',p,.06,.44,.10,.14,.14,.018);}
      else if(b==='fog'){add('rock','slate',p,0,-.04,0,.59,.43,.49);add('hexrock','moss',p,0,.20,0,.52,.08,.43);add('box','stone',p,-.13,.43,0,.26,.46,.10,0,0,-.08);lantern(offset(p,.30,.21,.22));}
      else if(b==='swamp'){arch(p,.4,.66,'moss');add('box','dark',p,0,.31,-.09,.45,.55,.07);for(let n=0;n<4;n++)add('sphere','leaf',p,Math.sin(n*2)*.4,.53+Math.cos(n)*.17,0,.17,.10,.19);add('rock','ice',p,0,.48,.08,.05,.11,.025);}
      else if(b==='volcano'){add('crater','dark',p,0,.36,0,.64,.72,.62);add('cylinder','lava',p,0,.69,0,.21,.028,.21);anvil(offset(p,.37,.04,.31),.57);flamePositions.push(offset(p,0,.69,0));}
      else if(b==='crystal'){add('torus','gold',p,0,.53,0,.37,.51,.37);add('sphere','blue',p,0,.53,0,.31,.43,.04);for(const side of [-1,1])crystal(offset(p,side*.44,0,0),.60,'purple',.16);}
      else {for(let n=0;n<3;n++)add('rib','bone',p,0,.03,(n-1)*.23,.39,.49,.3);add('box','dark',p,0,.02,.06,.43,.02,.68);add('box','sand',p,.45,.11,-.3,.20,.23,.3,.24);}
    }else{
      if(b==='grass'){add('cylinder','wood',p,0,.40,0,.035,.8,.035);add('box','plank',p,.10,.64,0,.61,.15,.06,0,0,.16);add('box','blue',p,-.10,.41,0,.48,.13,.06,0,0,-.14);}
      else if(b==='forest'){add('sphere','dark',p,0,.16,0,.26,.15,.15);add('sphere','dark',p,.23,.34,.04,.10,.11,.08);add('cone','gold',p,.30,.33,.1,.039,.13,.038,0,0,-1);add('box','plank',p,-.28,.09,.26,.21,.13,.18);}
      else if(b==='desert'){add('box','copper',p,0,.13,0,.43,.25,.28,0,0,.15);for(const side of [-1,1])add('box','gold',p,side*.13,.14,0,.035,.26,.30,0,0,.15);add('dune','sand',p,-.14,.04,-.07,.36,.10,.27);}
      else if(b==='cliff'){beam(offset(p,-.37,0,0),offset(p,-.37,.85,0),.035);beam(offset(p,-.37,.85,0),offset(p,.21,.96,0),.035);beam(offset(p,.16,.93,0),offset(p,.16,.53,0),.009,'gold');bell(offset(p,.16,.20,0),.48);}
      else if(b==='snow'){add('trunk','wood',p,0,.39,0,.046,.78,.046);for(let n=0;n<3;n++)add('cone','ice',p,0,.61+n*.21,0,.34-n*.07,.47,.34-n*.07);lantern(offset(p,.25,.04,.28));for(let n=0;n<4;n++)add('sphere','slate',p,-.2+n*.10,.015,.45+n*.08,.025,.009,.05);}
      else if(b==='ocean'){add('cylinder','ice',p,0,.14,0,.09,.27,.09,0,0,-.63);add('cylinder','wood',p,.10,.27,0,.037,.075,.037,0,0,-.63);add('box','cloth',p,-.16,.026,.23,.19,.022,.13,.3);}
      else if(b==='blood'){add('cylinder','gold',p,0,.21,0,.045,.42,.045);add('crater','gold',p,0,.46,0,.42,.27,.42,0,0,Math.PI);add('sphere','glow',p,0,.48,0,.10,.13,.10);}
      else if(b==='fog'){boat(p,.70);lantern(offset(p,0,.19,.29));add('box','cloth',p,0,.25,-.18,.23,.013,.25);}
      else if(b==='swamp'){add('sphere','moss',p,0,.22,0,.16,.22,.13);for(const side of [-1,1])add('sphere','dark',p,side*.057,.30,.115,.02,.026,.016);add('cylinder','cloth',p,.25,.30,.06,.023,.34,.023);add('dune','glow',p,.25,.47,.06,.17,.11,.16);}
      else if(b==='volcano'){add('cylinder','dark',p,0,.20,0,.026,.4,.026);for(let n=0;n<6;n++)add('rock','copper',p,Math.sin(n*1.047)*.14,.38,Math.cos(n*1.047)*.14,.11,.043,.11,n);add('sphere','glow',p,0,.40,0,.07,.06,.07);}
      else if(b==='crystal'){for(let n=0;n<3;n++)crystal(offset(p,(n-1)*.21,0,0),n===1?.59:.35,n===1?'ice':'purple',.12);}
      else {add('box','stone',p,0,.31,0,.36,.62,.16,0,0,.08);add('box','dark',p,0,.36,.09,.21,.25,.016);for(let n=0;n<3;n++){beam(offset(p,(n-1)*.04,0,.26),offset(p,(n-1)*.10,.23,.19),.012,'wood');add('sphere','cloth',p,(n-1)*.10,.24,.19,.04,.05,.04);}}
    }
  };
  for(const site of LANDMARKS){activeSite=site;if(site.id==='ocean')continue;if(site.kind==='main')main(site);else small(site);}
  const harbor=buildWorldHarbor(scene,kit,mats);emitters.push(...harbor.emitters);
  for(const [material,geometries]of batches){
    const normalized=geometries.map(g=>{const n=g.index?g.toNonIndexed():g;for(const key of Object.keys(n.attributes))if(key!=='position'&&key!=='normal')n.deleteAttribute(key);if(n!==g)g.dispose();return n;});
    const mesh=new THREE.Mesh(mergeGeometries(normalized)!,material);mesh.name='world-architecture';mesh.castShadow=material!==lava;mesh.receiveShadow=true;mesh.matrixAutoUpdate=false;scene.add(mesh);normalized.forEach(g=>g.dispose());
  }
  for(const p of flamePositions)emitters.push({...p,y:p.y+.18,color:'#ffad68',radius:1.7,power:2.2,kind:'fire'});
  return {flamePositions,sails,emitters,harbor};
}
