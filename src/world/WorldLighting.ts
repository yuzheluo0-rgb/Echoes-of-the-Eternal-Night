import * as THREE from 'three';
import {LANDMARKS,TILE_MAP,TILES,isWater,random,walkHeight} from './worldData';
import {landHeightAt,nearestTile} from './storybookLandscape';
import {minuteOfDay} from './WorldTime';

export interface WorldLightSource{x:number;y:number;z:number;color:string;radius:number;power:number;siteId?:string;harborStage?:number;kind?:'lamp'|'window'|'fire'|'crystal'|'beacon'}
interface LightFrame{hour:number;sky:string;ground:string;key:string;sea:string;fill:number;direct:number;night:number;tint:[number,number,number]}
const FRAMES:LightFrame[]=[
  {hour:0,sky:'#839ab8',ground:'#1d2531',key:'#becde0',sea:'#101920',fill:.36,direct:.68,night:1,tint:[.28,.35,.46]},
  {hour:4.5,sky:'#8b95b0',ground:'#252b34',key:'#b6c4d8',sea:'#151c25',fill:.38,direct:.59,night:1,tint:[.30,.35,.45]},
  {hour:5.5,sky:'#b3a4a5',ground:'#434747',key:'#e2baa0',sea:'#22292b',fill:.57,direct:.84,night:.68,tint:[.56,.48,.49]},
  {hour:7,sky:'#c5bdac',ground:'#515d53',key:'#e8c18b',sea:'#293332',fill:.86,direct:1.58,night:.06,tint:[.86,.73,.62]},
  {hour:10,sky:'#c4d1d1',ground:'#536057',key:'#e2d2ac',sea:'#26343a',fill:1.13,direct:1.80,night:0,tint:[.81,.88,.88]},
  {hour:12,sky:'#cbd6da',ground:'#5b675d',key:'#f0dbb2',sea:'#29373d',fill:1.26,direct:1.94,night:0,tint:[.90,.95,1]},
  {hour:15,sky:'#c6c4b3',ground:'#5d5c4f',key:'#e5bb7c',sea:'#333a35',fill:1.02,direct:1.70,night:0,tint:[.88,.72,.54]},
  {hour:17,sky:'#b7a199',ground:'#524b52',key:'#e6aa71',sea:'#393335',fill:.79,direct:1.38,night:.12,tint:[.78,.57,.46]},
  {hour:18,sky:'#a28b9f',ground:'#373446',key:'#e79974',sea:'#302831',fill:.54,direct:.98,night:.43,tint:[.60,.40,.44]},
  {hour:19.5,sky:'#858cab',ground:'#272a39',key:'#bec4df',sea:'#1b2130',fill:.37,direct:.63,night:.93,tint:[.34,.35,.46]},
  {hour:21,sky:'#839bbd',ground:'#1d2531',key:'#c2d3e9',sea:'#121d27',fill:.36,direct:.73,night:1,tint:[.28,.35,.46]},
  {hour:24,sky:'#839ab8',ground:'#1d2531',key:'#becde0',sea:'#101920',fill:.36,direct:.68,night:1,tint:[.28,.35,.46]},
];
/** One moving sun/moon shadow map plus four nearby point lights; distant lamps use batched glows. */
export class WorldLighting{
  readonly sky=new THREE.HemisphereLight();
  readonly key=new THREE.DirectionalLight();
  readonly night={value:0};
  private time={value:0};
  private pixelsPerUnit={value:40};
  private lightTint=new THREE.Color(1,1,1);
  private desiredTint=new THREE.Color();
  private desiredSky=new THREE.Color();
  private desiredGround=new THREE.Color();
  private desiredKey=new THREE.Color();
  private desiredSea=new THREE.Color();
  private desiredPosition=new THREE.Vector3();
  private sunlight=new THREE.Vector3();
  private moonlight=new THREE.Vector3();
  private colorScratch=new THREE.Color();
  private lastShadow=0;
  private lastMinutes=-1;
  private lastRetarget=-1;
  private shadowPosition=new THREE.Vector3(Infinity,Infinity,Infinity);
  private initialized=false;
  private sources:WorldLightSource[];
  private slots:{light:THREE.PointLight;index:number}[]=[];
  private chosen=new Set<number>();
  private enabled:number[]=[];
  private glowGeometry:THREE.BufferGeometry;
  private haloGeometry:THREE.BufferGeometry;
  private glowMaterials:{material:THREE.MeshBasicMaterial;color:THREE.Color}[]=[];
  private emissiveMaterials:THREE.MeshLambertMaterial[]=[];
  private tintedMaterials:THREE.ShaderMaterial[]=[];
  private horizonMaterials:{material:THREE.LineBasicMaterial;color:THREE.Color}[]=[];
  private moonBeam:THREE.Mesh|null=null;
  private harborBeam:THREE.Mesh|null=null;
  private harborStage=0;
  private discoveries:string[]=[];

  constructor(private scene:THREE.Scene,private renderer:THREE.WebGLRenderer,sources:WorldLightSource[]){
    this.sky.name='daylight-sky';this.key.name='sun-and-moon';this.key.castShadow=true;this.key.shadow.mapSize.set(2048,2048);
    Object.assign(this.key.shadow.camera,{left:-43,right:43,top:38,bottom:-38,near:1,far:160});this.key.shadow.bias=-.00035;this.key.shadow.normalBias=.038;scene.add(this.sky,this.key);
    this.sources=[...sources];
    for(const tile of TILES){
      if(tile.biome==='volcano'&&!tile.structure&&!tile.landmark&&random(tile.seed)>.4)this.sources.push({x:tile.x+.5,y:landHeightAt(tile.x+.5,tile.z-.35)+.65,z:tile.z-.35,color:'#ff8146',radius:1.42,power:1.9,kind:'fire'});
    }
    for(const site of LANDMARKS.filter(s=>s.kind==='main'||s.kind==='hidden')){
      const tile=TILE_MAP.get(`${site.q},${site.r}`)!;
      this.sources.push({x:tile.x,y:walkHeight(tile)+1.6,z:tile.z,color:site.biome==='blood'?'#ef7298':site.biome==='crystal'?'#afafff':site.biome==='forest'||site.biome==='swamp'?'#b0e6b2':'#f5cf91',radius:1.28,power:.50,siteId:site.id,kind:'beacon'});
    }
    const materialSet=new Set<THREE.Material>();scene.traverse(object=>{const material=(object as THREE.Mesh).material;if(material)(Array.isArray(material)?material:[material]).forEach(m=>materialSet.add(m));});
    for(const material of materialSet){
      if(material instanceof THREE.MeshBasicMaterial&&material.userData.nightGlow)this.glowMaterials.push({material,color:material.color.clone()});
      if(material instanceof THREE.MeshLambertMaterial&&material.userData.nightEmission)this.emissiveMaterials.push(material);
      if(material instanceof THREE.ShaderMaterial&&material.uniforms.uLightTint)this.tintedMaterials.push(material);
      if(material instanceof THREE.LineBasicMaterial)this.horizonMaterials.push({material,color:material.color.clone()});
    }
    for(let i=0;i<4;i++){const light=new THREE.PointLight('#ffc776',0,3.1,2);light.name='nearby-lamp-'+i;scene.add(light);this.slots.push({light,index:-1});}
    this.enabled=this.sources.map(source=>{const site=LANDMARKS.find(s=>s.id===source.siteId);return source.harborStage||site?.kind==='hidden'||site?.kind==='event'?0:1;});
    this.glowGeometry=this.buildPools();this.haloGeometry=this.buildHalos();this.buildLighthouseBeam();
  }
  private surface(x:number,z:number){const tile=nearestTile(x,z);return tile?.bridge?walkHeight(tile):tile?.structure&&isWater(tile.biome)?.67:Math.max(.14,landHeightAt(x,z)+.04);}
  private buildPools(){
    const positions:number[]=[],uvs:number[]=[],colors:number[]=[],power:number[]=[],enabled:number[]=[],sourceIndices:number[]=[],indices:number[]=[];
    this.sources.forEach((source,index)=>{
      const start=positions.length/3,color=new THREE.Color(source.color),radius=source.radius;
      for(let n=0;n<=24;n++){
        const angle=(n-1)/24*Math.PI*2,dx=n?Math.sin(angle)*radius:0,dz=n?Math.cos(angle)*radius:0,x=source.x+dx,z=source.z+dz;
        positions.push(x,this.surface(x,z)+.012,z);uvs.push(dx/radius,dz/radius);colors.push(color.r,color.g,color.b);power.push(source.kind==='fire'?.30:source.kind==='crystal'?.20:.16);enabled.push(this.enabled[index]);sourceIndices.push(index);
        if(n>1)indices.push(start,start+n-1,start+n);
      }indices.push(start,start+24,start+1);
    });
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setAttribute('aPower',new THREE.Float32BufferAttribute(power,1));geometry.setAttribute('aEnabled',new THREE.Float32BufferAttribute(enabled,1));geometry.setIndex(indices);geometry.userData.sources=sourceIndices;
    const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide,vertexColors:true,uniforms:{uNight:this.night,uTime:this.time},vertexShader:'attribute float aPower;attribute float aEnabled;varying vec2 vUv;varying vec3 vColor;varying float vPower;void main(){vUv=uv;vColor=color;vPower=aPower*aEnabled;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'uniform float uNight;uniform float uTime;varying vec2 vUv;varying vec3 vColor;varying float vPower;void main(){float radius=length(vUv);float falloff=pow(max(0.,1.-radius),2.4);float shimmer=.97+sin(uTime*2.+vUv.x*3.)*.03;gl_FragColor=vec4(vColor,falloff*vPower*(.03+uNight*.97)*shimmer);}'});
    const mesh=new THREE.Mesh(geometry,material);mesh.name='lamplight-on-ground';mesh.matrixAutoUpdate=false;mesh.renderOrder=1;this.scene.add(mesh);return geometry;
  }
  private buildHalos(){
    const positions:number[]=[],colors:number[]=[],sizes:number[]=[];for(const source of this.sources){positions.push(source.x,source.y,source.z);const c=new THREE.Color(source.color);colors.push(c.r,c.g,c.b);sizes.push(source.kind==='fire'?.53:source.kind==='window'?.32:source.kind==='crystal'?.47:.39);}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setAttribute('aSize',new THREE.Float32BufferAttribute(sizes,1));geometry.setAttribute('aEnabled',new THREE.Float32BufferAttribute(this.enabled,1));
    const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,vertexColors:true,blending:THREE.AdditiveBlending,uniforms:{uNight:this.night,uPixels:this.pixelsPerUnit},vertexShader:'attribute float aSize;attribute float aEnabled;uniform float uPixels;varying vec3 vColor;varying float vEnabled;void main(){vColor=color;vEnabled=aEnabled;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_PointSize=clamp(aSize*uPixels,3.,85.);}',fragmentShader:'uniform float uNight;varying vec3 vColor;varying float vEnabled;void main(){float r=length(gl_PointCoord-.5)*2.;float halo=exp(-r*r*5.)*(1.-smoothstep(.65,1.,r));gl_FragColor=vec4(vColor,halo*(.015+uNight*.48)*vEnabled);}'});
    const mesh=new THREE.Points(geometry,material);mesh.name='window-and-lantern-halos';mesh.frustumCulled=false;this.scene.add(mesh);return geometry;
  }
  private buildLighthouseBeam(){
    const source=this.sources.find(s=>s.siteId==='fog'&&s.y>2.5);if(!source)return;
    const geometry=new THREE.ConeGeometry(1.22,8,14,1,true);geometry.translate(0,-4,0);geometry.rotateX(-Math.PI/2);
    const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,uniforms:{uNight:this.night},vertexShader:'varying vec3 vLocal;void main(){vLocal=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'uniform float uNight;varying vec3 vLocal;void main(){float fade=pow(max(0.,1.-abs(vLocal.z)/8.),2.);gl_FragColor=vec4(1.,.77,.43,fade*uNight*.045);}'});
    this.moonBeam=new THREE.Mesh(geometry,material);this.moonBeam.name='lighthouse-sweep';this.moonBeam.position.set(source.x,source.y,source.z);this.scene.add(this.moonBeam);
    const harbor=this.sources.find(s=>s.siteId==='ocean'&&s.harborStage===2&&s.kind==='lamp');if(harbor){this.harborBeam=new THREE.Mesh(geometry,material);this.harborBeam.name='restored-harbor-sweep';this.harborBeam.position.set(harbor.x,harbor.y,harbor.z);this.harborBeam.visible=false;this.scene.add(this.harborBeam);}
  }
  dispose(){this.key.shadow.dispose();}
  setHarborStage(stage:number){this.harborStage=stage;this.setDiscoveries(this.discoveries);}
  setDiscoveries(ids:string[]){
    this.discoveries=ids;
    this.sources.forEach((source,i)=>{const site=LANDMARKS.find(s=>s.id===source.siteId);this.enabled[i]=source.harborStage&&source.harborStage>this.harborStage?0:site?.kind==='hidden'||site?.kind==='event'?Number(ids.includes(site.id)):1;});
    const halos=this.haloGeometry.getAttribute('aEnabled') as THREE.BufferAttribute,pools=this.glowGeometry.getAttribute('aEnabled') as THREE.BufferAttribute;this.enabled.forEach((v,i)=>halos.setX(i,v));(this.glowGeometry.userData.sources as number[]).forEach((i,n)=>pools.setX(n,this.enabled[i]));halos.needsUpdate=pools.needsUpdate=true;
  }
  private retarget(target:THREE.Vector3){
    const ordered=this.sources.map((source,index)=>({index,score:((source.x-target.x)**2+(source.z-target.z)**2+1)/(source.power+.3)})).filter(item=>this.enabled[item.index]>0).sort((a,b)=>a.score-b.score).slice(0,4);this.chosen=new Set(ordered.map(s=>s.index));
  }
  update(totalMinutes:number,dt:number,environmentTime:number,target:THREE.Vector3,pixelsPerUnit:number,reduced=false){
    const hour=minuteOfDay(totalMinutes)/60,upper=FRAMES.findIndex(frame=>frame.hour>hour),a=FRAMES[Math.max(0,upper-1)],b=FRAMES[upper<0?FRAMES.length-1:upper];
    let t=(hour-a.hour)/Math.max(.001,b.hour-a.hour);t=t*t*(3-2*t);
    const blend=(out:THREE.Color,left:string,right:string)=>out.set(left).lerp(this.colorScratch.set(right),t);
    blend(this.desiredSky,a.sky,b.sky);blend(this.desiredGround,a.ground,b.ground);blend(this.desiredKey,a.key,b.key);blend(this.desiredSea,a.sea,b.sea);this.desiredTint.setRGB(...a.tint).lerp(this.colorScratch.setRGB(...b.tint),t);
    const night=THREE.MathUtils.lerp(a.night,b.night,t),sunAngle=(hour-6)/12*Math.PI,moonHour=hour<12?hour+24:hour,moonAngle=(moonHour-18)/12*Math.PI;
    this.sunlight.set(-Math.cos(sunAngle)*53,Math.max(8,Math.sin(sunAngle)*61),16);
    this.moonlight.set(Math.cos(moonAngle)*44,Math.max(12,Math.sin(moonAngle)*48),-18);
    const moonWeight=THREE.MathUtils.smoothstep(night,.60,.96);this.desiredPosition.copy(this.sunlight).lerp(this.moonlight,moonWeight);
    const ease=!this.initialized||reduced?1:1-Math.exp(-Math.min(dt,.1)*2.4),mix=(x:number,y:number)=>THREE.MathUtils.lerp(x,y,ease);
    this.sky.color.lerp(this.desiredSky,ease);this.sky.groundColor.lerp(this.desiredGround,ease);this.sky.intensity=mix(this.sky.intensity,THREE.MathUtils.lerp(a.fill,b.fill,t));this.key.color.lerp(this.desiredKey,ease);this.key.intensity=mix(this.key.intensity,THREE.MathUtils.lerp(a.direct,b.direct,t));this.key.position.lerp(this.desiredPosition,ease);this.night.value=mix(this.night.value,night);this.lightTint.lerp(this.desiredTint,ease);
    (this.scene.background as THREE.Color).lerp(this.desiredSea,ease);(this.scene.fog as THREE.Fog).color.copy(this.scene.background as THREE.Color);
    this.time.value=environmentTime;this.pixelsPerUnit.value=pixelsPerUnit;
    for(const material of this.tintedMaterials){material.uniforms.uLightTint.value.copy(this.lightTint);if(material.uniforms.uNight)material.uniforms.uNight.value=this.night.value;if(material.uniforms.uHighlight)material.uniforms.uHighlight.value.copy(this.key.color).multiplyScalar(.50+this.night.value*.20);if(material.uniforms.uLightX)material.uniforms.uLightX.value=this.key.position.x/53;}
    for(const {material,color}of this.glowMaterials)material.color.copy(color).multiplyScalar(.62+this.night.value*1.05);
    for(const material of this.emissiveMaterials)material.emissiveIntensity=this.night.value*(material.userData.nightEmission as number);
    for(const {material,color}of this.horizonMaterials)material.color.copy(color).multiply(this.colorScratch.setRGB(.36+.64*(1-this.night.value),.46+.54*(1-this.night.value),.70+.30*(1-this.night.value)));
    const now=performance.now(),positionChange=this.key.position.distanceToSquared(this.shadowPosition),jump=this.lastMinutes>=0&&Math.abs(totalMinutes-this.lastMinutes)>2;
    if(!this.initialized||(now-this.lastShadow>2400&&positionChange>.018)||jump){this.renderer.shadowMap.needsUpdate=true;this.lastShadow=now;this.shadowPosition.copy(this.key.position);}
    if(now-this.lastRetarget>450){this.retarget(target);this.lastRetarget=now;}
    const occupied=new Set(this.slots.map(slot=>slot.index));
    for(const slot of this.slots){
      if(!this.chosen.has(slot.index)&&slot.light.intensity<.025){occupied.delete(slot.index);slot.index=[...this.chosen].find(index=>!occupied.has(index))??-1;occupied.add(slot.index);if(slot.index>=0){const source=this.sources[slot.index];slot.light.position.set(source.x,source.y+.08,source.z+.10);slot.light.color.set(source.color);slot.light.distance=source.radius*2;}}
      const source=this.sources[slot.index],power=source&&this.chosen.has(slot.index)?source.power*this.night.value:0;slot.light.intensity=mix(slot.light.intensity,power);
    }
    if(this.moonBeam){this.moonBeam.rotation.y=environmentTime*.16;this.moonBeam.visible=this.night.value>.15;}
    if(this.harborBeam){this.harborBeam.rotation.y=-environmentTime*.13;this.harborBeam.visible=this.harborStage>=2&&this.night.value>.15;}
    const settled=this.key.position.distanceToSquared(this.desiredPosition)<.0002&&Math.abs(this.night.value-night)<.001;
    this.lastMinutes=totalMinutes;this.initialized=true;return!settled;
  }
}
