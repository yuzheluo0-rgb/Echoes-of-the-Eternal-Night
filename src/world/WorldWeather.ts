import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TILES, WORLD_SCALE, random, isWater } from './worldData';
import { landHeightAt, nearestTile } from './storybookLandscape';

export function flowingLava(){
  const time={value:0};
  const material=new THREE.ShaderMaterial({uniforms:{uTime:time},vertexShader:`varying vec3 vWorld;void main(){vec4 p=vec4(position,1.);
    #ifdef USE_INSTANCING
      p=instanceMatrix*p;
    #endif
    p=modelMatrix*p;vWorld=p.xyz;gl_Position=projectionMatrix*viewMatrix*p;}`,
    fragmentShader:`varying vec3 vWorld;uniform float uTime;void main(){vec2 p=vWorld.xz*5.;float stream=sin(p.x*2.2+sin(p.y*2.7-uTime*.7)*1.4-uTime*.8);float crust=smoothstep(.2,.86,stream);float hot=pow(max(0.,sin(p.y*3.+p.x+uTime*.5)),6.);vec3 color=mix(vec3(.46,.075,.05),vec3(1.,.39,.055),crust);color=mix(color,vec3(1.,.82,.26),hot*.66);gl_FragColor=vec4(color,1.);
      #include <colorspace_fragment>
    }`});return{material,time};
}
export function addWind(material:THREE.MeshLambertMaterial,time:{value:number}){
  material.onBeforeCompile=shader=>{
    shader.uniforms.uWindTime=time;shader.vertexShader='uniform float uWindTime;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
      float seed=0.;
      #ifdef USE_INSTANCING
        seed=instanceMatrix[3].x*.47+instanceMatrix[3].z*.26;
      #endif
      float tip=max(0.,position.y+.47);transformed.x+=sin(uWindTime*1.15+seed)*tip*.045;transformed.z+=sin(uWindTime*.84+seed)*tip*.025;`);
  };material.customProgramCacheKey=()=> 'storybook-wind-v1';
}

/** A bounded number of moving meshes; vegetation and liquid motion stay on the GPU. */
export class WorldWeather{
  readonly group=new THREE.Group();
  readonly time={value:0};
  private clouds:THREE.InstancedMesh;
  private birds:THREE.InstancedMesh;
  private emberScale={value:1};
  private matrix=new THREE.Matrix4();
  private position=new THREE.Vector3();
  private rotation=new THREE.Quaternion();
  private scale=new THREE.Vector3();
  constructor(scene:THREE.Scene,flames:{x:number;y:number;z:number}[]){
    this.group.name='world-weather';scene.add(this.group);
    const puffs=[[-.8,0,0,.85,.23,.48],[0,.15,0,1.05,.40,.65],[.9,.02,.04,.73,.26,.50],[.2,0,.40,.66,.21,.46]].map(([x,y,z,sx,sy,sz])=>new THREE.IcosahedronGeometry(1,1).scale(sx,sy,sz).translate(x,y,z));
    const cloudGeometry=mergeGeometries(puffs)!;puffs.forEach(g=>g.dispose());
    this.clouds=new THREE.InstancedMesh(cloudGeometry,new THREE.MeshLambertMaterial({color:'#b1b8b3',transparent:true,opacity:.29,depthWrite:false}),10);this.clouds.name='drifting-clouds';this.clouds.frustumCulled=false;this.clouds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.group.add(this.clouds);
    const birdGeometry=new THREE.BufferGeometry();birdGeometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,.10,-.35,.035,-.065,-.12,0,.045,0,0,.10,.12,0,.045,.35,.035,-.065,0,0,.17,-.035,0,-.10,.035,0,-.10],3));
    const birdMaterial=new THREE.ShaderMaterial({side:THREE.DoubleSide,uniforms:{uTime:this.time},vertexShader:`uniform float uTime;void main(){vec3 p=position;p.y+=sin(uTime*7.+instanceMatrix[3].x)*abs(p.x)*.63;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(p,1.);}`,fragmentShader:'void main(){gl_FragColor=vec4(.055,.13,.16,1.);}'});
    this.birds=new THREE.InstancedMesh(birdGeometry,birdMaterial,15);this.birds.name='migrating-birds';this.birds.frustumCulled=false;this.birds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.group.add(this.birds);
    const origins=[...flames,...TILES.filter(t=>t.biome==='volcano'&&!t.structure&&!t.landmark&&random(t.seed)>.4).map(t=>({x:t.x+.5,y:landHeightAt(t.x+.5,t.z-.35)+.64,z:t.z-.35}))];
    const positions:number[]=[],phases:number[]=[];
    for(const [i,p]of origins.entries())for(let n=0;n<10;n++){positions.push(p.x,p.y,p.z);phases.push(random(i*23+n*7),random(i*47+n*13));}
    const emberGeo=new THREE.BufferGeometry();emberGeo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));emberGeo.setAttribute('aPhase',new THREE.Float32BufferAttribute(phases,2));
    const embers=new THREE.Points(emberGeo,new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,uniforms:{uTime:this.time,uScale:this.emberScale},vertexShader:`attribute vec2 aPhase;uniform float uTime;uniform float uScale;varying float vFade;void main(){float life=fract(aPhase.x+uTime*(.19+aPhase.y*.1));vec3 p=position;p.x+=sin(aPhase.x*32.+life*3.)*.18+life*.37;p.z+=cos(aPhase.x*29.+life*2.)*.15;p.y+=life*(.9+aPhase.y*.9);vFade=sin(life*3.14159);gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);gl_PointSize=clamp((2.+aPhase.y*2.)*uScale,1.,9.);}`,fragmentShader:`varying float vFade;void main(){float a=1.-smoothstep(.10,.5,length(gl_PointCoord-.5));gl_FragColor=vec4(1.,.54,.13,a*vFade*.8);}`}));embers.name='volcanic-embers';embers.frustumCulled=false;this.group.add(embers);
    this.river([[-9,-12],[-7,-9],[-4,-7],[-5,-4],[-2,-2],[-3,1],[-1,3],[-2,5],[-4,7],[-4,9]],.13);
    this.river([[-17,-4],[-15,-2],[-17,0],[-14,2],[-14,4]],.105);
    const gustPositions:number[]=[];for(let i=0;i<9;i++)for(let n=0;n<6;n++){for(const step of [n,n+1])gustPositions.push(((i%3-1)*9+step*.16)*WORLD_SCALE,.95+random(i)*.20,(Math.floor(i/3)*7-7+Math.sin(step*.48)*.10)*WORLD_SCALE);}
    const gustGeo=new THREE.BufferGeometry();gustGeo.setAttribute('position',new THREE.Float32BufferAttribute(gustPositions,3));
    const gusts=new THREE.LineSegments(gustGeo,new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{uTime:this.time},vertexShader:'uniform float uTime;varying float vAlpha;void main(){vec3 p=position;float phase=p.z*.72;p.x+=mod(uTime*.47+phase+10.,9.)-4.5;vAlpha=pow(max(0.,sin(uTime*.34+phase)),5.);gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}',fragmentShader:'varying float vAlpha;void main(){gl_FragColor=vec4(.76,.88,.78,vAlpha*.24);}'}));gusts.name='wind-streaks';gusts.frustumCulled=false;this.group.add(gusts);
    this.update(0,1,1);
  }
  private river(coordinates:number[][],width:number){
    const points=coordinates.map(([x,z])=>new THREE.Vector3(x*WORLD_SCALE,0,z*WORLD_SCALE));
    // The authored control points stop well inland. Walk on in the same direction until the sea so
    // the river ends in an estuary instead of breaking off in the middle of the continent.
    const last=points[points.length-1],back=new THREE.Vector3().subVectors(last,points[points.length-2]).normalize();
    for(let step=1;step<=400;step++){
      const probe=last.clone().addScaledVector(back,step*.30),tile=nearestTile(probe.x,probe.z);
      if(!tile)break;
      if(isWater(tile.biome)){points.push(probe);break;}
    }
    const curve=new THREE.CatmullRomCurve3(points),positions:number[]=[],uvs:number[]=[],indices:number[]=[];
    for(let i=0;i<=160;i++){
      const t=i/160,p=curve.getPoint(t),direction=curve.getTangent(t),tile=nearestTile(p.x,p.z);
      for(const side of [-1,1]){const x=p.x-direction.z*width*side,z=p.z+direction.x*width*side;positions.push(x,landHeightAt(x,z)+.04,z);uvs.push(side*.5+.5,t*18);}
      // Only a building interrupts the ribbon now. Skipping water as well used to shatter the river
      // into loose fragments at exactly the point where it should meet the sea.
      if(i&&tile&&!tile.structure){const n=i*2;indices.push(n-2,n,n-1,n-1,n,n+1);}
    }
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geo.setIndex(indices);
    const river=new THREE.Mesh(geo,new THREE.ShaderMaterial({side:THREE.DoubleSide,uniforms:{uTime:this.time,uLightTint:{value:new THREE.Color(1,1,1)}},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:`varying vec2 vUv;uniform float uTime;uniform vec3 uLightTint;void main(){float foam=pow(max(0.,sin(vUv.y*9.-uTime*2.7+sin(vUv.x*8.)*.45)),14.)*.38;float edge=smoothstep(.65,.99,abs(vUv.x-.5)*2.);vec3 color=mix(vec3(.070,.105,.12),vec3(.34,.36,.30),edge*.55+foam*.48)*uLightTint;gl_FragColor=vec4(color,1.);
      #include <colorspace_fragment>
    }`}));river.name='flowing-river';river.matrixAutoUpdate=false;this.group.add(river);
  }
  update(time:number,zoom:number,pixelRatio:number){
    this.time.value=time;this.emberScale.value=Math.sqrt(zoom)*pixelRatio;
    for(let i=0;i<10;i++){
      const x=(((i*11.3+time*(.14+random(i)*.075)+37)%74)-37)*WORLD_SCALE,z=((i%5)*9-17)*WORLD_SCALE+Math.sin(time*.025+i)*1.1;
      this.position.set(x,4.2+(i%3)*.7,z);const s=1.15+random(i*5)*.6;this.scale.set(s,1,s);this.rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP,.2);this.matrix.compose(this.position,this.rotation,this.scale);this.clouds.setMatrixAt(i,this.matrix);
    }
    for(let i=0;i<15;i++){
      const flock=Math.floor(i/5),n=i%5,t=time*.50+flock*17;
      this.position.set((((t+n*.4+50)%70)-35)*WORLD_SCALE,3.1+flock*.40+Math.sin(time*.6+i)*.09,(flock*11-10+Math.abs(n-2)*.43+Math.sin(t*.035)*3)*WORLD_SCALE);
      this.rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP,-Math.PI/2+.06*Math.sin(time*.3));this.scale.setScalar(.65+random(i)*.23);this.matrix.compose(this.position,this.rotation,this.scale);this.birds.setMatrixAt(i,this.matrix);
    }
    this.clouds.instanceMatrix.needsUpdate=true;this.birds.instanceMatrix.needsUpdate=true;
  }
}
