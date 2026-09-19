import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { BIOMES, DIRECTIONS, LANDMARKS, TILE_MAP, TILES, WORLD_SCALE, random, walkHeight, navigationTarget, siteFootprint, type Biome } from './worldData';
import { tileSurface, cartoonWater, cloakGeometry, landHeightAt, pathClearance } from './storybookLandscape';
import { WorldRenderBudget, type WorldQuality } from './WorldQuality';
import { buildWorldArchitecture } from './WorldArchitecture';
import { WorldWeather, flowingLava, addWind } from './WorldWeather';
import { isRegionOpen, type RegionProgress } from './worldRegions';
import { buildWorldBridges } from './WorldBridges';
import {WorldLighting} from './WorldLighting';
import {WorldTime} from './WorldTime';

export interface SceneCallbacks {
  onSelect: (id: string) => void;
  onStep: (id: string) => void;
  onArrive: (id: string) => void;
  onReady: (failed: boolean) => void;
  onError: (message: string) => void;
  onCamera: (zoom: number, angle: number) => void;
  onFollow?: (following: boolean) => void;
}
const WATER = new Set<Biome>(['ocean', 'blood', 'fog']);
/** Canopy blob. A plain icosahedron reads as a faceted ball, so each vertex is pushed in or out by
 *  a hash of its own position — the copies that share a corner move together, so the surface stays
 *  closed — and welding first turns the per-face normals into smooth ones. */
function foliageGeometry() {
  const source = new THREE.IcosahedronGeometry(1, 1);
  const position = source.getAttribute('position');
  for (let n = 0; n < position.count; n++) {
    const x = position.getX(n), y = position.getY(n), z = position.getZ(n);
    const bump = .74 + random(x * 31.7 + y * 57.1 + z * 13.3) * .48;
    position.setXYZ(n, x * bump, y * bump * .78, z * bump);
  }
  const welded = mergeVertices(source, 1e-4);
  welded.computeVertexNormals();
  source.dispose();
  return welded;
}
function mountainGeometry() {
  const points: number[] = [], uvs: number[] = [], indices: number[] = [], colors: number[] = [];
  const levels = [0, .18, .4, .64, .83, 1], radii = [1, .85, .57, .37, .19, 0];
  for (let layer = 0; layer < levels.length; layer++) for (let n = 0; n < 11; n++) {
    const angle = n / 11 * Math.PI * 2, ridge = .72 + random(n * 8 + 5) * .45;
    const radius = radii[layer] * ridge;
    const x = Math.sin(angle) * radius + levels[layer] * .23, z = Math.cos(angle) * radius - levels[layer] * .13;
    const y = levels[layer] * (layer === 5 ? 1 : .88 + random(n + layer * 4) * .22);
    points.push(x, y, z); uvs.push(x * .5 + .5, z * .5 + .5);
    const color = new THREE.Color(layer >= 4 || (layer === 3 && n % 3 !== 0) ? '#e1eeec' : layer === 3 ? '#a7b9c0' : layer === 2 ? '#758b97' : '#67797c');
    colors.push(color.r, color.g, color.b);
    if (layer < 5) { const current = layer * 11 + n, next = layer * 11 + (n + 1) % 11; indices.push(current, next, current + 11, next, next + 11, current + 11); }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geo.setIndex(indices);
  const result = geo.toNonIndexed(); geo.dispose(); result.computeVertexNormals(); return result;
}
export class WorldScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-16, 16, 11, -11, .1, 150 * WORLD_SCALE);
  readonly controls: OrbitControls;
  private callbacks: SceneCallbacks;
  private host: HTMLDivElement;
  private frame = 0;
  private disposed = false;
  private resizeObserver: ResizeObserver;
  private geometry = new Map<string, THREE.BufferGeometry>();
  private materials = new Map<string, THREE.Material>();
  private renderBudget = new WorldRenderBudget();
  private harbor:ReturnType<typeof buildWorldArchitecture>['harbor'];
  private buckets = new Map<string, { geometry: THREE.BufferGeometry; material: THREE.Material; matrices: THREE.Matrix4[] }>();
  private picking: THREE.Mesh[] = [];
  private raycaster = new THREE.Raycaster();
  private pointerDown: { x: number; y: number; time: number } | null = null;
  private activePointers = new Set<number>();
  private multitouch = false;
  private hover = new THREE.Group();
  private selection = new THREE.Group();
  private routeGroup = new THREE.Group();
  private knight = new THREE.Group();
  private body = new THREE.Group();
  private legs: THREE.Group[] = [];
  private arms: THREE.Group[] = [];
  private cape: THREE.Mesh | null = null;
  private lantern: THREE.PointLight;
  private fire: THREE.Mesh | null = null;
  private beacons: THREE.Mesh[] = [];
  private regions: RegionProgress | null = null;
  private discovered: string[] = [];
  private encounters: Record<string, number> = {};
  private fog: THREE.Mesh[] = [];
  private fireflies: THREE.Points;
  private waterTimes: { value: number }[] = [];
  private windTime={value:0};
  private weather:WorldWeather;
  private lighting:WorldLighting;
  private stopClockSubscription:()=>void;
  private buildingOutline=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:'#ffe2a4',transparent:true,opacity:.8}));
  private labels = new Map<string, HTMLElement>();
  private positionId: string;
  private selectedId: string | null = null;
  private route: string[] = [];
  private stepTime = 0;
  private elapsed = 0;
  private lastTime = 0;
  private uiTime = 0;
  private hoverTime = 0;
  private uiDirty = true;
  private lastUIZoom = -1;
  private lastUIAngle = Infinity;
  private renderDirty = true;
  private cameraChangeTime = 0;
  private pendingRenderResize = false;
  private reduced = false;
  private paused = false;
  private yaw = 0;
  private targetCamera: THREE.Vector3 | null = null;
  private following = true;
  private loaded = false;
  private loadTimeout = 0;

  constructor(host: HTMLDivElement, positionId: string, callbacks: SceneCallbacks,readonly clock:WorldTime=new WorldTime()) {
    this.host = host; this.callbacks = callbacks; this.positionId = positionId;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false; this.renderer.shadowMap.needsUpdate = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping; this.renderer.toneMappingExposure = 1;
    this.renderer.setClearColor('#111e23', 0);
    this.renderer.domElement.setAttribute('aria-label', '可缩放、平移并跟随人物的 2.5D 六边格主世界地图');
    this.renderer.domElement.setAttribute('role', 'img');
    host.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color('#19262d');
    this.scene.fog = new THREE.Fog('#19262d',48*WORLD_SCALE,115*WORLD_SCALE);
    this.camera.position.set(14,26,24); this.camera.zoom=1.08; this.camera.lookAt(0,.8,0);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = .1;
    this.controls.enableRotate = false;
    this.controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    this.controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    this.controls.touches.ONE = THREE.TOUCH.PAN;
    this.controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    this.controls.minPolarAngle = Math.PI / 7; this.controls.maxPolarAngle = Math.PI / 2.7;
    this.controls.minZoom = .24 / WORLD_SCALE; this.controls.maxZoom = 3.4;
    this.controls.rotateSpeed = .65; this.controls.zoomSpeed = .8; this.controls.panSpeed = .8;
    this.controls.screenSpacePanning = false; this.controls.target.set(0, 1.5, .3);
    this.controls.addEventListener('start', this.cancelCameraFocus);
    this.controls.addEventListener('change', () => { this.uiDirty = true; this.renderDirty = true; this.cameraChangeTime = performance.now(); });
    this.geometry.set('box',new RoundedBoxGeometry(1,1,1,1,.06));
    this.geometry.set('rock',new THREE.IcosahedronGeometry(1,0));
    this.geometry.set('pebble',new THREE.IcosahedronGeometry(1,0));
    this.geometry.set('crown',new THREE.IcosahedronGeometry(1,1));
    this.geometry.set('foliage',foliageGeometry());
    this.geometry.set('bloom',new THREE.SphereGeometry(1,6,4));
    this.geometry.set('sphere',new THREE.SphereGeometry(1,16,12));
    this.geometry.set('cone',new THREE.ConeGeometry(1,1,10));
    this.geometry.set('trunk',new THREE.CylinderGeometry(.6,1,1,6));
    this.geometry.set('cylinder',new THREE.CylinderGeometry(1,1,1,12));
    this.geometry.set('hexrock',new THREE.CylinderGeometry(.86,1,1,6));
    this.geometry.set('dune',new THREE.SphereGeometry(1,18,10,0,Math.PI*2,0,Math.PI/2));
    this.geometry.set('mountain',mountainGeometry());
    this.geometry.set('peak',new THREE.ConeGeometry(1,1,4));
    this.geometry.set('torus',new THREE.TorusGeometry(1,.09,6,24));
    this.geometry.set('rib',new THREE.TorusGeometry(1,.065,5,16,Math.PI));
    this.geometry.set('crystal',new THREE.CylinderGeometry(.6,.68,1,5));
    this.geometry.set('crater',new THREE.CylinderGeometry(.32,.8,1,10,1,true));

    this.prepareMaterials();
    this.buildTerrain(); this.buildProps(); buildWorldBridges(this.scene); this.flushInstances();
    const architecture=buildWorldArchitecture(this.scene,this.geometry,this.materials.get('lava')!);
    this.harbor=architecture.harbor;
    this.weather=new WorldWeather(this.scene,architecture.flamePositions);
    this.buildLandmarks();this.scene.add(this.buildingOutline);
    this.buildKnight();
    // Environmental shadows update with the sun. A separate contact shadow keeps
    // walking inexpensive between the infrequent daylight shadow updates.
    this.knight.traverse(object=>{object.castShadow=false;});
    const contact=new THREE.Mesh(new THREE.PlaneGeometry(1.30,1.08),new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec2 vUv;void main(){float a=1.-smoothstep(.18,.49,length(vUv-.5));gl_FragColor=vec4(.06,.12,.14,a*.25);}'}));contact.rotation.x=-Math.PI/2;contact.position.y=-.025;this.knight.add(contact);
    this.lantern = new THREE.PointLight('#ffc46e', .055, 1.4, 2); this.lantern.position.set(.53, .42, .27); this.knight.add(this.lantern);
    const particles = new Float32Array(40 * 3);
    for (let i = 0; i < 40; i++) { particles[i * 3] = (random(i * 7) - .5) * 24; particles[i * 3 + 1] = random(i * 5) * 3 + .8; particles[i * 3 + 2] = (random(i * 3) - .5) * 20; }
    const particleGeo = new THREE.BufferGeometry(); particleGeo.setAttribute('position', new THREE.BufferAttribute(particles, 3));
    this.fireflies = new THREE.Points(particleGeo, new THREE.PointsMaterial({ color: '#edcf8b', size: .055, transparent: true, opacity: .65, depthWrite: false, blending: THREE.AdditiveBlending })); this.scene.add(this.fireflies);
    this.makeRing(this.hover, '#e4eac9', .65); this.makeRing(this.selection, '#ffd993', 1); this.scene.add(this.hover, this.selection, this.routeGroup); this.hover.visible = this.selection.visible = false;
    const tile = TILE_MAP.get(positionId)!; this.knight.position.set(tile.x, tile.bridge ? walkHeight(tile) : landHeightAt(tile.x, tile.z) + .045, tile.z);
    this.controls.target.copy(this.knight.position).add(new THREE.Vector3(0,.5,0));
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3(14,26,24));
    this.controls.update();
    this.lighting=new WorldLighting(this.scene,this.renderer,architecture.emitters);
    this.lighting.update(clock.totalMinutes,0,0,this.controls.target,40);
    this.stopClockSubscription=clock.subscribe(()=>{this.renderDirty=true;});
    document.addEventListener('visibilitychange',this.onVisibility);
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(host); this.resize();
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDown); canvas.addEventListener('pointerup', this.onPointerUp); canvas.addEventListener('pointermove', this.onPointerMove); canvas.addEventListener('pointercancel', this.onPointerCancel); canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('webglcontextlost', this.onContextLost); canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    this.loadTimeout = window.setTimeout(() => { if (!this.loaded && !this.disposed) this.callbacks.onError('地表材质载入超时，请重新载入地图。'); }, 18000);
    this.frame = requestAnimationFrame(this.animate);
  }
  private mat(name: string, color: string, roughness = .86, metalness = 0) {
    if (!this.materials.has(name)){const material=new THREE.MeshLambertMaterial({color});if(/leaves|shrubs|reeds|reed-head/.test(name))addWind(material,this.windTime);if(name.startsWith('quartz-')){material.emissive.copy(material.color);material.userData.nightEmission=.32;}this.materials.set(name,material);}
    return this.materials.get(name)!;
  }
  private prepareMaterials() {
    const lava=flowingLava();this.materials.set('lava',lava.material);this.waterTimes.push(lava.time);
    this.materials.set('terrain',new THREE.MeshLambertMaterial({vertexColors:true}));
    this.materials.set('mountains',new THREE.MeshLambertMaterial({vertexColors:true,flatShading:true}));
    this.materials.set('scanned-stone',this.mat('storybook-stone','#8b9ca7'));
    this.materials.set('scanned-cliff',this.mat('storybook-cliff','#85909c'));
    this.materials.set('foliage',this.mat('leaves','#4d916c'));
    for(const [name,color] of [['ocean','#1c2d34'],['blood','#5f283b'],['fog','#485964'],['shallows','#374943']]) {
      const water=cartoonWater(color);this.materials.set('water-'+name,water.material);this.waterTimes.push(water.time);
    }
    for(const [name,color] of [['architecture','#e5d9b8'],['foundation','#b8b895'],['roof','#427778'],['timber','#ba915c'],['gold','#c9a566'],['bark','#776147']]) this.mat(name,color);
    queueMicrotask(()=>{if(!this.disposed){this.loaded=true;this.renderDirty=true;this.callbacks.onReady(false);}});
  }
  private instance(shape: string, material: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0, rx = 0, rz = 0) {
    const geometry = this.geometry.get(shape)!; const key = `${geometry.uuid}-${material.uuid}`;
    if (!this.buckets.has(key)) this.buckets.set(key, { geometry, material, matrices: [] });
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
    this.buckets.get(key)!.matrices.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), quaternion, new THREE.Vector3(sx, sy, sz)));
  }
  private flushInstances() {
    for(const bucket of this.buckets.values()) {
      const mesh=new THREE.InstancedMesh(bucket.geometry,bucket.material,bucket.matrices.length);
      bucket.matrices.forEach((matrix,index)=>mesh.setMatrixAt(index,matrix));
      mesh.castShadow=true;mesh.receiveShadow=true;mesh.computeBoundingSphere();mesh.matrixAutoUpdate=false;this.scene.add(mesh);
    }
    this.buckets.clear();
  }
  private buildTerrain() {
    const batches=new Map<string,THREE.BufferGeometry[]>(),edges:number[]=[],coasts:number[]=[],walls:number[]=[],wallColors:number[]=[],shoals:number[]=[];
    const collect=(name:string,g:THREE.BufferGeometry)=>{if(!batches.has(name))batches.set(name,[]);batches.get(name)!.push(g);};
    const ocean=new THREE.Mesh(new THREE.PlaneGeometry(220*WORLD_SCALE,220*WORLD_SCALE),this.materials.get('water-ocean'));ocean.rotation.x=-Math.PI/2;ocean.position.y=.115;this.scene.add(ocean);
    for(const tile of TILES) {
      const liquid=WATER.has(tile.biome),g=tileSurface(tile,liquid);
      const pick=new THREE.Mesh(g,this.materials.get('terrain'));pick.userData.tileId=tile.id;pick.matrixAutoUpdate=false;this.picking.push(pick);
      if(!liquid) collect('terrain',g.clone());
      else if(tile.biome!=='ocean') collect('water-'+tile.biome,g.clone());
      if(liquid)continue;
      for(let side=0;side<6;side++) {
        const a=side*Math.PI/3,b=(side+1)*Math.PI/3,[dq,dr]=DIRECTIONS[(side+5)%6],next=TILE_MAP.get((tile.q+dq)+','+(tile.r+dr));
        const coastal=!next||WATER.has(next.biome);
        for(let step=0;step<3;step++) {
          const t=step/3,u=(step+1)/3;
          const x1=tile.x+THREE.MathUtils.lerp(Math.sin(a),Math.sin(b),t),z1=tile.z+THREE.MathUtils.lerp(Math.cos(a),Math.cos(b),t);
          const x2=tile.x+THREE.MathUtils.lerp(Math.sin(a),Math.sin(b),u),z2=tile.z+THREE.MathUtils.lerp(Math.cos(a),Math.cos(b),u);
          const y1=landHeightAt(x1,z1),y2=landHeightAt(x2,z2);
          edges.push(x1,y1+.019,z1,x2,y2+.019,z2);
          if(!coastal)continue;
          coasts.push(x1,.14,z1,x2,.14,z2);
          if(!next||next.biome==='ocean') {
            const ox=Math.sin((a+b)/2)*.28,oz=Math.cos((a+b)/2)*.28;
            shoals.push(x1,.123,z1,x1+ox,.123,z1+oz,x2,.123,z2,x2,.123,z2,x1+ox,.123,z1+oz,x2+ox,.123,z2+oz);
          }
          for(let layer=0;layer<3;layer++) {
            const lower=layer/3,upper=(layer+1)/3,c=new THREE.Color(layer===2?'#85856a':layer===1?'#a09274':'#626e65');
            const y=(height:number,v:number)=>THREE.MathUtils.lerp(.09,height-.012,v);
            const verts=[[x1,y(y1,lower),z1],[x2,y(y2,lower),z2],[x1,y(y1,upper),z1],[x2,y(y2,lower),z2],[x2,y(y2,upper),z2],[x1,y(y1,upper),z1]];
            for(const v of verts){walls.push(...v);wallColors.push(c.r,c.g,c.b);}
          }
        }
      }
    }
    for(const [name,list]of batches){const g=mergeGeometries(list)!;const m=new THREE.Mesh(g,this.materials.get(name));m.receiveShadow=name==='terrain';m.castShadow=false;m.matrixAutoUpdate=false;this.scene.add(m);list.forEach(g=>g.dispose());}
    const shore=new THREE.BufferGeometry();shore.setAttribute('position',new THREE.Float32BufferAttribute(shoals,3));this.scene.add(new THREE.Mesh(shore,this.materials.get('water-shallows')));
    const wall=new THREE.BufferGeometry();wall.setAttribute('position',new THREE.Float32BufferAttribute(walls,3));wall.setAttribute('color',new THREE.Float32BufferAttribute(wallColors,3));wall.computeVertexNormals();this.scene.add(new THREE.Mesh(wall,this.materials.get('terrain')));
    for(const [points,color,opacity]of [[edges,'#c3b689',.18],[coasts,'#929e91',.40]]as const){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(points,3));this.scene.add(new THREE.LineSegments(g,new THREE.LineBasicMaterial({color,transparent:true,opacity})));}
  }
  private tree(x:number,y:number,z:number,scale:number,seed:number,snowy=false) {
    this.instance('trunk',this.mat('bark','#776147'),x,y+scale*.35,z,.055*scale,.7*scale,.055*scale);
    if(snowy || random(seed)>.54) {
      for(let n=0;n<3;n++){const s=scale*(.44-n*.09);this.instance('cone',this.mat(snowy?'snow-leaves':'pine-leaves',snowy?'#bac9c2':'#3b6050'),x,y+scale*(.55+n*.25),z,s,scale*.7,s,seed);}
    } else {
      const leaves=this.mat('round-leaves-'+seed%3,['#4a654f','#5c7557','#748364'][Math.abs(seed%3)]);
      this.instance('foliage',leaves,x,y+scale*.88,z,scale*.48,scale*.44,scale*.46,seed);
      // Lobes scattered rather than mirrored left and right, so the canopy outline is irregular.
      for(let k=0;k<3;k++){
        const a=random(seed*3.3+k*29.7)*Math.PI*2,rr=scale*.24+random(seed*11+k*7.1)*scale*.18;
        this.instance('foliage',leaves,x+Math.sin(a)*rr,y+scale*(.58+random(seed+k*5)*.32),z+Math.cos(a)*rr,scale*.27+random(seed+k*3)*scale*.10,scale*.24,scale*.26,seed+k*13);
      }
    }
  }
  private buildProps() {
    const stone=this.materials.get('scanned-stone')!;
    for(const tile of TILES) {
      const {x,z,seed,biome}=tile;
      if(tile.structure)continue;
      if(biome==='forest'||biome==='grass') {
        const count=biome==='forest'?5:2;
        for(let n=0;n<count;n++){
          // Angle and radius both hashed per instance. Stepping the angle by a constant put every
          // plant on one tidy ring, which is what made the ground look arranged rather than grown.
          const a=random(seed*7.3+n*31.7)*Math.PI*2,r=.22+random(seed*13.1+n*57.3)*.66,tx=x+Math.sin(a)*r,tz=z+Math.cos(a)*r;
          if(pathClearance(tile,tx,tz)<.21||tile.landmark)continue;
          if(biome==='forest'||random(seed+n)>.56)this.tree(tx,landHeightAt(tx,tz),tz,.66+random(seed+n*4)*.34,seed+n);
          else {this.instance('foliage',this.mat('shrubs','#8eb469'),tx,landHeightAt(tx,tz)+.10,tz,.20,.15,.18);for(let k=0;k<3;k++)this.instance('bloom',this.mat('flowers','#f1d397'),tx+(random(tx*3.1+k*9.7)-.5)*.2,landHeightAt(tx,tz)+.17+random(tz*5.3+k)*.05,tz+(random(tz*7.1+k*4.3)-.5)*.2,.035,.04,.035);}
        }
      } else if(biome==='snow') {
        if(!tile.walkable) {this.instance('mountain',this.materials.get('mountains')!,x,landHeightAt(x,z)-.05,z,.85,1.3+random(seed)*1.0,.78,seed);}
        else if(!tile.landmark) {const tx=x-.55,tz=z-.24;this.tree(tx,landHeightAt(tx,tz),tz,.64,seed,true);}
      } else if(biome==='cliff') {
        for(let n=0;n<2;n++){const a=random(seed*3.1+n*41.3)*Math.PI*2,r=.24+random(seed*5.7+n*23.9)*.62,tx=x+Math.sin(a)*r,tz=z+Math.cos(a)*r;if(pathClearance(tile,tx,tz)<.24||tile.landmark)continue;for(let k=0;k<3;k++){const r=.34-k*.055;this.instance('hexrock',this.mat('cliff-layer-'+k,['#737f91','#96a3b0','#b5b9ae'][k]),tx,landHeightAt(tx,tz)+.13+k*.22,tz,r,.25,r,seed);}}
      } else if(biome==='desert') {
        if(tile.landmark)continue;
        for(let n=0;n<2;n++){const a=random(seed*3.7+n*29.1)*Math.PI*2,r=.25+random(seed*7.9+n*17.3)*.62,tx=x+Math.sin(a)*r,tz=z+Math.cos(a)*r;if(pathClearance(tile,tx,tz)<.23)continue;this.instance('dune',this.mat('dune-'+n,n?'#e6b86c':'#efd196'),tx,landHeightAt(tx,tz)-.01,tz,.40,.20+random(seed)*.17,.3,a);}
        if(random(seed)>.64){const tx=x-.55,tz=z+.4,y=landHeightAt(tx,tz);this.instance('cylinder',this.mat('cactus','#7a9c70'),tx,y+.25,tz,.06,.5,.06);this.instance('box',this.mat('cactus','#7a9c70'),tx+.09,y+.28,tz,.17,.07,.06);this.instance('cylinder',this.mat('cactus','#7a9c70'),tx+.16,y+.36,tz,.04,.2,.04);}
      } else if(biome==='swamp'&&!tile.landmark) {
        const tx=x+.55,tz=z-.30,y=landHeightAt(tx,tz);
        this.instance('cylinder',this.mat('bog-water','#456f6c'),tx,y+.01,tz,.32,.015,.28);
        const reeds=this.mat('reeds','#b0b27a'),heads=this.mat('reed-head','#716746');
        // A clump of tapered blades that stand up and lean together into the same wind. The first
        // attempt gave every blade its own random lean direction, which read as a heap of loose
        // sticks; reeds in a bed are near-vertical, clustered at the base and of similar height.
        for(let n=0;n<5;n++){
          const a=random(seed*2.3+n*17.1)*Math.PI*2,r=.04+random(seed*3.7+n*9.3)*.11;
          const sx=tx+Math.sin(a)*r,sz=tz+Math.cos(a)*r;
          const h=.28+random(seed*5.1+n*3.7)*.22,lean=.06+random(seed*7.9+n*11.3)*.15;
          this.instance('trunk',reeds,sx+h*lean*.5,y+h*.5,sz,.015,h,.015,0,0,lean);
          if(random(seed*11.7+n*5.3)>.35)this.instance('cylinder',heads,sx+h*lean,y+h*.96,sz,.024,.10,.024,0,0,lean);
        }
        if(random(seed)>.55)this.tree(x-.52,landHeightAt(x-.52,z),z,.70,seed);
      } else if(biome==='volcano') {
        if(tile.caldera){
          // Basin floor: one flat molten plate per tile with darker crust slabs drifting on it, so
          // the lake reads as a single pool rather than a ring of separate cones.
          const lava=this.mat('lava','#f89a53'),rock=this.mat('volcanic-rock','#554d62');
          this.instance('hexrock',lava,x,.46,z,1.02,.05,1.02,seed);
          if(random(seed*5)>.62)this.instance('hexrock',rock,x+(random(seed*3)-.5)*.55,.49,z+(random(seed*7)-.5)*.55,.34+random(seed)*.34,.05,.30+random(seed*2)*.34,seed);
          if(random(seed*11)>.78)this.instance('crystal',this.mat('ember','#ffb066'),x+(random(seed*13)-.5)*.5,.56,z+(random(seed*17)-.5)*.5,.05,.2,.05,seed);
          continue;
        }
        if(tile.landmark)continue;
        const tx=x+.5,tz=z-.35,y=landHeightAt(tx,tz),lava=this.mat('lava','#f89a53');
        // Vents are rare now: the caldera is the landmark, not a field of look-alike cones.
        if(random(seed)>.82){this.instance('crater',this.mat('volcanic-rock','#554d62'),tx,y+.32,tz,.62,.64,.62,seed);this.instance('cylinder',lava,tx,y+.58,tz,.19,.02,.19);}
        for(let n=0;n<2;n++)this.instance('box',lava,x-.50+n*.2,landHeightAt(x-.5+n*.2,z+.4)+.022,z+.4,.22,.018,.045,seed+n);
      } else if(biome==='crystal'&&!tile.landmark) {
        for(let n=0;n<3;n++){const a=random(seed*4.3+n*37.7)*Math.PI*2,r=.24+random(seed*9.1+n*19.7)*.62,tx=x+Math.sin(a)*r,tz=z+Math.cos(a)*r;if(pathClearance(tile,tx,tz)<.24)continue;const h=.35+random(seed+n)*.4,m=this.mat('quartz-'+n,['#c8c2f0','#aaa4dc','#acd8df'][n]);this.instance('crystal',m,tx,landHeightAt(tx,tz)+h/2,tz,.16,h,.16,a);this.instance('cone',m,tx,landHeightAt(tx,tz)+h+.1,tz,.105,.22,.105,a);}
      } else if(biome==='waste'&&!tile.landmark) {
        const tx=x+.53,tz=z-.31,y=landHeightAt(tx,tz);
        if(random(seed)>.58){for(let n=0;n<3;n++)this.instance('rib',this.mat('ivory','#e5d7af'),tx,y+.02,tz+n*.13,.27,.26,.24,seed);}
        else for(let n=0;n<2;n++)this.instance('hexrock',this.mat('mesa-'+n,n?'#c6ac8a':'#a48172'),tx,y+.1+n*.18,tz,.36-n*.09,.22,.31-n*.06,seed);
      } else if(biome==='blood'&&!tile.bridge) {
        if(random(seed)>.55){this.instance('rock',this.mat('obsidian','#4c455f'),x+.2,.25,z-.2,.26,.57,.25,seed);this.instance('peak',this.mat('crystal','#d77692'),x+.2,.75,z-.2,.09,.3,.09,seed);}
      } else if(biome==='ocean'&&!tile.bridge&&random(seed)>.89) {
        this.instance('rock',stone,x,.12,z,.25,.22,.32,seed);
      }
    }
    this.buildFog();
  }
  private buildFog() {
    const geometry = new THREE.PlaneGeometry(4.6, 2.8);
    const material = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { uTime: { value: 0 },uLightTint:{value:new THREE.Color(1,1,1)} }, vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}', fragmentShader: 'varying vec2 vUv; uniform float uTime;uniform vec3 uLightTint; float noise(vec2 p){return sin(p.x*6.0+sin(p.y*4.0))*cos(p.y*7.0+sin(p.x*3.0));} void main(){vec2 p=vUv*2.0-1.0;float edge=pow(max(0.0,1.0-dot(p,p)),1.8);float cloud=0.48+noise(vUv*2.4+vec2(uTime*0.045,uTime*0.023))*0.25;gl_FragColor=vec4(vec3(0.71,0.8,0.85)*uLightTint,edge*cloud*0.3);}' });
    const fogTiles = TILES.filter(t => t.biome === 'fog');
    const fogPlaneCount = Math.max(7, Math.round(fogTiles.length / 3.4));
    for (let i = 0; i < fogPlaneCount; i++) { const tile = fogTiles[(i * 3) % fogTiles.length]; const plane = new THREE.Mesh(geometry, material); plane.rotation.x = -Math.PI / 2; plane.position.set(tile.x, .42 + (i % 3) * .24, tile.z); plane.userData.originX = tile.x; plane.userData.originZ = tile.z; plane.renderOrder = 2; this.fog.push(plane); this.scene.add(plane); }
  }
  private buildLandmarks() {
    for(const site of LANDMARKS){
      const tile=TILE_MAP.get(`${site.q},${site.r}`)!;
      if(site.kind==='main')for(const cell of siteFootprint(site.id).slice(1)){
        const height=({ocean:5.48,fog:5.03,snow:4.8,forest:4.35,volcano:4.2,crystal:3.9} as Record<string,number>)[site.id]||3;
        const geo=new THREE.BoxGeometry(1.45,height,1.45).translate(cell.x,Math.max(cell.height,.62)+height/2,cell.z),pick=new THREE.Mesh(geo,this.materials.get('terrain'));pick.userData.tileId=tile.id;pick.matrixAutoUpdate=false;this.picking.push(pick);
      }
      const beaconMaterial=new THREE.MeshBasicMaterial({color:BIOMES[site.biome].color});beaconMaterial.userData.nightGlow=true;
      const beacon=new THREE.Mesh(new THREE.OctahedronGeometry(site.kind==='main'?.085:.055),beaconMaterial);
      beacon.position.set(tile.x,walkHeight(tile)+(site.kind==='main'?2.63:2.18),tile.z);beacon.userData.baseY=beacon.position.y;beacon.userData.siteId=site.id;beacon.visible=site.kind!=='hidden'&&site.kind!=='event';this.scene.add(beacon);this.beacons.push(beacon);
    }
    const camp=TILE_MAP.get('0,1')!,fire=new THREE.Mesh(new THREE.ConeGeometry(.14,.35,7),new THREE.MeshBasicMaterial({color:'#ffc86d'}));fire.position.set(camp.x+.46,walkHeight(camp)+.17,camp.z-.38);this.scene.add(fire);this.fire=fire;
  }
  private buildKnight() {
    const cloth=this.mat('knightcloth','#273348'),dark=this.mat('knightshadow','#141e2c'),trim=this.mat('knighttrim','#c8a56b'),leather=this.mat('knightleather','#564438');
    const sphere=this.geometry.get('sphere')!,box=this.geometry.get('box')!,cylinder=this.geometry.get('cylinder')!,cone=this.geometry.get('cone')!;
    const add=(parent:THREE.Group,g:THREE.BufferGeometry,m:THREE.Material,x:number,y:number,z:number,sx=1,sy=1,sz=1)=>{const mesh=new THREE.Mesh(g,m);mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);mesh.castShadow=true;parent.add(mesh);return mesh;};
    add(this.body,cone,dark,0,.62,0,.32,.78,.26);
    const hood=new THREE.LatheGeometry([new THREE.Vector2(.245,.96),new THREE.Vector2(.32,1.04),new THREE.Vector2(.35,1.20),new THREE.Vector2(.28,1.43),new THREE.Vector2(.12,1.69),new THREE.Vector2(0,1.84)],20);
    const hoodVertices=hood.getAttribute('position');for(let n=0;n<hoodVertices.count;n++){const bend=Math.max(0,hoodVertices.getY(n)-1.4);hoodVertices.setX(n,hoodVertices.getX(n)-bend*.30);hoodVertices.setZ(n,hoodVertices.getZ(n)-bend*.16);}hood.computeVertexNormals();this.geometry.set('watcher-hood',hood);add(this.body,hood,cloth,0,0,0);
    add(this.body,sphere,dark,0,1.18,.257,.239,.23,.077);
    // A shadowed face, mantle, moon embroidery, left-hand lamp and card case match the cover.
    const mantle=add(this.body,this.geometry.get('torus')!,cloth,0,.96,0,.27,.19,.27);mantle.rotation.x=Math.PI/2;
    const capeMat=new THREE.MeshLambertMaterial({color:'#2c3b50',vertexColors:true,side:THREE.DoubleSide});
    this.cape=add(this.body,cloakGeometry(),capeMat,0,0,0);
    const hem:THREE.Vector3[]=[];for(let n=0;n<=36;n++){const a=.62+n/36*(Math.PI*2-1.24),r=.563*(1+Math.sin(a*7)*.065);hem.push(new THREE.Vector3(Math.sin(a)*r,.24+Math.cos(a*7)*.03,Math.cos(a)*r-.045));}
    const hemGeo=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hem),48,.011,4,false);this.geometry.set('cloak-hem',hemGeo);add(this.body,hemGeo,trim,0,0,0);
    const moonGeo=new THREE.TorusGeometry(.085,.017,5,18,Math.PI*1.55);this.geometry.set('moon-embroidery',moonGeo);add(this.body,moonGeo,trim,0,.7,-.40).rotation.z=-.55;
    for(const x of [-.16,.16]) {const ribbon=add(this.body,box,trim,x,.74,-.395,.014,.46,.015);ribbon.rotation.z=x*.8;}
    add(this.body,box,leather,0,.58,.235,.46,.065,.05);add(this.body,box,trim,0,.58,.272,.08,.075,.015);
    add(this.body,box,leather,-.27,.53,.21,.17,.24,.09);add(this.body,box,trim,-.27,.54,.265,.10,.15,.009);
    add(this.body,box,dark,-.27,.54,.273,.076,.12,.009);
    const blade=add(this.body,box,this.mat('blade','#bccad2'),-.37,.50,.04,.035,.55,.026);blade.rotation.z=-.18;
    add(this.body,box,trim,-.32,.77,.04,.17,.04,.055);
    for(const side of [-1,1]) {
      const leg=new THREE.Group();leg.position.set(side*.135,.39,0);add(leg,box,dark,0,-.12,0,.13,.27,.14);add(leg,sphere,leather,0,-.30,.07,.11,.10,.19);this.knight.add(leg);this.legs.push(leg);
      const arm=new THREE.Group();arm.position.set(side*.32,.91,.01);arm.rotation.z=side*.25;add(arm,box,cloth,0,-.16,0,.16,.32,.16);add(arm,sphere,leather,0,-.32,.04,.085,.09,.09);this.body.add(arm);this.arms.push(arm);
      if(side===1) {
        const lamp=new THREE.Group();lamp.position.set(.065,-.54,.10);arm.add(lamp);
        add(lamp,this.geometry.get('torus')!,trim,0,.17,0,.064,.078,.055);
        add(lamp,cylinder,trim,0,-.115,0,.10,.04,.10);add(lamp,cone,trim,0,.10,0,.115,.13,.115);
        const glass=new THREE.MeshBasicMaterial({color:'#ffd886'});glass.userData.nightGlow=true;this.materials.set('lantern-glass',glass);add(lamp,cylinder,glass,0,-.014,0,.075,.17,.075);
        for(let n=0;n<6;n++){const a=n*Math.PI/3;add(lamp,cylinder,trim,Math.sin(a)*.085,-.013,Math.cos(a)*.085,.009,.22,.009);}
        add(lamp,cone,trim,0,-.165,0,.045,.075,.045).rotation.z=Math.PI;
      }
    }
    // Merge each articulated part by material to keep the character inexpensive to draw.
    const bake=(group:THREE.Group)=>{
      for(const child of [...group.children])if(child instanceof THREE.Group)bake(child);
      const groups=new Map<THREE.Material,THREE.Mesh[]>();
      for(const child of [...group.children])if(child instanceof THREE.Mesh&&child!==this.cape&&!Array.isArray(child.material)){if(!groups.has(child.material))groups.set(child.material,[]);groups.get(child.material)!.push(child);}
      for(const [material,parts]of groups){if(parts.length<2)continue;const copies=parts.map(part=>{part.updateMatrix();return part.geometry.clone().applyMatrix4(part.matrix);});
        // Standardize indexed and non-indexed primitives before batching.
        const normalized=copies.map(g=>{const n=g.index?g.toNonIndexed():g;for(const key of Object.keys(n.attributes))if(key!=='position'&&key!=='normal')n.deleteAttribute(key);return n;});
        const geometry=mergeGeometries(normalized)!;for(const part of parts)group.remove(part);const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=true;group.add(mesh);new Set([...copies,...normalized]).forEach(g=>g.dispose());
      }
    };
    bake(this.body);for(const leg of this.legs)bake(leg);
    this.knight.add(this.body);this.knight.scale.setScalar(.92);this.knight.rotation.y=3.7;this.yaw=3.7;this.scene.add(this.knight);
    const ring=new THREE.Mesh(new THREE.RingGeometry(.36,.41,40),new THREE.MeshBasicMaterial({color:'#ffe2a5',transparent:true,opacity:.8,side:THREE.DoubleSide,depthWrite:false}));ring.rotation.x=-Math.PI/2;ring.position.y=.025;this.knight.add(ring);
  }
  private makeRing(group: THREE.Group, color: string, opacity: number) {
    const geo = new THREE.BufferGeometry(); const points: number[] = [];
    for (let i = 0; i <= 6; i++) { const a = i * Math.PI / 3; points.push(Math.sin(a) * .94, 0, Math.cos(a) * .94); }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3)); group.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity })));
    const inner = new THREE.Mesh(new THREE.RingGeometry(.76, .83, 6), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: opacity * .24, side: THREE.DoubleSide, depthWrite: false })); inner.rotation.x = -Math.PI / 2; inner.rotation.z = Math.PI / 6; group.add(inner);
  }
  setLabels(labels: Map<string, HTMLElement>) { this.labels = labels; this.uiDirty = true; }
  setDiscoveries(ids:string[],encounters:Record<string,number>){this.discovered=ids;this.encounters=encounters;this.lighting.setDiscoveries(ids);this.refreshBeacons();}
  /** Beacons stay dark inside a sealed region until its chapter is claimed. */
  setRegions(regions:RegionProgress){this.regions=regions;this.refreshBeacons();}
  /** Discovery and sealing both gate the same beacon, so they share one calculation. */
  private refreshBeacons(){for(const beacon of this.beacons){const site=LANDMARKS.find(s=>s.id===beacon.userData.siteId)!;const found=site.kind==='hidden'||site.kind==='event'?this.discovered.includes(site.id)&&this.encounters[site.id]===undefined:true;beacon.visible=found&&(!this.regions||isRegionOpen(this.regions,site.biome));}this.renderDirty=true;this.uiDirty=true;}
  setReduced(reduced: boolean) { this.reduced = reduced; this.renderDirty = true; }
  setPaused(paused: boolean) { this.paused = paused; this.controls.enabled = !paused; this.renderDirty = true; this.lastTime = 0; this.renderBudget.resetSamples(); }
  setQuality(quality: WorldQuality) {
    this.renderBudget.setMode(quality,performance.now());this.pendingRenderResize=false;this.resize();
  }
  select(id: string, path: string[]) {
    this.uiDirty = true; this.renderDirty = true;
    this.selectedId = id; const tile = TILE_MAP.get(id)!; this.selection.position.set(tile.x, Math.max(walkHeight(tile), landHeightAt(tile.x,tile.z)) + .035, tile.z); this.selection.visible = true;
    const outline:number[]=[];for(const cell of siteFootprint(tile.structure||''))for(let n=0;n<6;n++)for(const a of [n*Math.PI/3,(n+1)*Math.PI/3])outline.push(cell.x+Math.sin(a)*.95,Math.max(walkHeight(cell),landHeightAt(cell.x,cell.z))+.075,cell.z+Math.cos(a)*.95);this.buildingOutline.geometry.dispose();this.buildingOutline.geometry=new THREE.BufferGeometry();this.buildingOutline.geometry.setAttribute('position',new THREE.Float32BufferAttribute(outline,3));
    this.clearRoute();
    if (path.length > 1) {
      const points: THREE.Vector3[] = [];
      for (let n = 0; n < path.length - 1; n++) { const from = TILE_MAP.get(path[n])!, to = TILE_MAP.get(path[n + 1])!; for (let step = 0; step <= 12; step++) { const t = step / 12, x = THREE.MathUtils.lerp(from.x,to.x,t), z = THREE.MathUtils.lerp(from.z,to.z,t); const y = from.bridge || to.bridge ? THREE.MathUtils.lerp(walkHeight(from),walkHeight(to),t) : landHeightAt(x,z)+.045; points.push(new THREE.Vector3(x,y+.06,z)); } }
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineDashedMaterial({ color: '#ffe0a0', dashSize: .14, gapSize: .12, transparent: true, opacity: .85 })); line.computeLineDistances(); this.routeGroup.add(line);
      for (const key of path.slice(1)) { const tile = TILE_MAP.get(key)!; const dot = new THREE.Mesh(new THREE.RingGeometry(.055, .09, 16), new THREE.MeshBasicMaterial({ color: '#ffe2ac', side: THREE.DoubleSide, depthWrite: false })); dot.position.set(tile.x,(tile.bridge ? walkHeight(tile) : landHeightAt(tile.x,tile.z)+.045)+.06,tile.z); dot.rotation.x = -Math.PI / 2; this.routeGroup.add(dot); }
    }
  }
  walk(path: string[]) { if (path.length < 2 || this.route.length || path[0] !== this.positionId) return false; this.route = path.slice(1); this.stepTime = 0; this.setFollowing(true); this.targetCamera=null; return true; }
  private setFollowing(value:boolean){if(this.following===value)return;this.following=value;this.callbacks.onFollow?.(value);}
  focus(id?:string){if(!id){this.setFollowing(true);this.targetCamera=null;return;}this.setFollowing(false);const tile=TILE_MAP.get(id)!;this.targetCamera=new THREE.Vector3(tile.x,tile.height+.5,tile.z);}
  private overviewZoom(){return (this.host.clientWidth<600?.27:this.host.clientHeight<790?.37:.43)/WORLD_SCALE;}
  home(){this.setFollowing(false);this.controls.target.set(0,.8,0);this.camera.position.copy(this.controls.target).add(new THREE.Vector3(14,26,24));this.camera.zoom=this.overviewZoom();this.camera.updateProjectionMatrix();this.targetCamera=null;this.controls.update();this.uiDirty=true;this.renderDirty=true;this.cameraChangeTime=performance.now();}
  travelTo(id:string){const tile=TILE_MAP.get(id);if(!tile?.walkable||this.route.length)return false;this.positionId=id;this.knight.position.set(tile.x,tile.bridge?walkHeight(tile):landHeightAt(tile.x,tile.z)+.045,tile.z);this.clearRoute();this.setFollowing(true);this.targetCamera=null;this.controls.target.copy(this.knight.position).add(new THREE.Vector3(0,.5,0));this.camera.position.copy(this.controls.target).add(new THREE.Vector3(14,26,24));this.renderer.shadowMap.needsUpdate=true;this.uiDirty=true;this.renderDirty=true;this.callbacks.onStep(id);this.callbacks.onArrive(id);return true;}
  zoom(factor: number) { this.camera.zoom = THREE.MathUtils.clamp(this.camera.zoom * factor, this.controls.minZoom, this.controls.maxZoom); this.camera.updateProjectionMatrix(); this.uiDirty = true; this.renderDirty = true; this.cameraChangeTime = performance.now(); }
  rotate(_direction:number) { /* The illustrated world uses a fixed camera heading. */ }
  private cancelCameraFocus = () => { this.targetCamera = null; };
  private resize() {
    const { width, height } = this.host.getBoundingClientRect(); const aspect = width / Math.max(height, 1); const view = aspect < .85 ? 19 : aspect < 1.3 ? 15 : 11.8;
    this.camera.left = -view * aspect; this.camera.right = view * aspect; this.camera.top = view; this.camera.bottom = -view; this.camera.updateProjectionMatrix();
    const ratio = Math.min(devicePixelRatio, 1.5, Math.sqrt(this.renderBudget.pixels / Math.max(1, width * height)));
    if (Math.abs(ratio - this.renderer.getPixelRatio()) > .001) { this.renderer.setPixelRatio(ratio); }
    this.renderer.setSize(width, height); this.uiDirty = true; this.renderDirty = true;
  }
  private pick(event: PointerEvent) {
    const bounds = this.renderer.domElement.getBoundingClientRect(); const pointer = new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
    this.raycaster.setFromCamera(pointer, this.camera); const id=this.raycaster.intersectObjects(this.picking,false)[0]?.object.userData.tileId as string|undefined;return id?navigationTarget(id):undefined;
  }
  private onPointerDown = (event: PointerEvent) => { this.activePointers.add(event.pointerId); if (this.activePointers.size > 1) this.multitouch = true; if (this.activePointers.size === 1) { this.multitouch = false; this.pointerDown = { x: event.clientX, y: event.clientY, time: performance.now() }; } };
  private onPointerUp = (event: PointerEvent) => { this.activePointers.delete(event.pointerId); const down = this.pointerDown; this.pointerDown = null; if (this.paused || this.multitouch || event.button !== 0 || !down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6 || performance.now() - down.time > 650) return; const id = this.pick(event); if (id) this.callbacks.onSelect(id); };
  private onPointerMove = (event: PointerEvent) => { if(this.paused)return;if(this.activePointers.size){if(this.pointerDown&&Math.hypot(event.clientX-this.pointerDown.x,event.clientY-this.pointerDown.y)>6)this.setFollowing(false);return;}if(event.timeStamp-this.hoverTime<33)return; this.hoverTime = event.timeStamp; const id = this.pick(event); this.hover.visible = !!id; this.renderDirty = true; this.renderer.domElement.style.cursor = id ? 'pointer' : 'grab'; if (id) { const tile = TILE_MAP.get(id)!; this.hover.position.set(tile.x, Math.max(walkHeight(tile),landHeightAt(tile.x,tile.z)) + .04, tile.z); } };
  private onPointerCancel = (event: PointerEvent) => { this.activePointers.delete(event.pointerId); this.pointerDown = null; };
  private onPointerLeave = () => { this.hover.visible = false; this.renderDirty = true; this.pointerDown = null; this.activePointers.clear(); };
  private onContextLost = (event: Event) => { event.preventDefault(); this.paused = true; this.callbacks.onError('三维画面已中断，请重新载入地图。'); };
  private onContextRestored = () => { this.callbacks.onError('图形环境已恢复，请重新载入地图。'); };
  setHarborStage(stage:number){this.harbor.setStage(stage);this.lighting.setHarborStage(stage);this.renderer.shadowMap.needsUpdate=true;this.renderDirty=true;}
  private onVisibility=()=>{this.lastTime=0;this.renderBudget.resetSamples();};
  private clearRoute() { while (this.routeGroup.children.length) { const child = this.routeGroup.children[0] as THREE.Mesh; child.geometry?.dispose(); if (child.material && !Array.isArray(child.material)) child.material.dispose(); this.routeGroup.remove(child); } }
  private animate = (now: number) => {
    if (this.disposed) return; this.frame = requestAnimationFrame(this.animate);
    // Leave GPU headroom for input and browser composition on high-refresh displays.
    if (this.lastTime && now - this.lastTime < 1000 / 60 - .6) return;
    const frameMs = now - (this.lastTime || now), dt = Math.min(frameMs / 1000, .05); this.lastTime = now;
    if (document.hidden) { this.renderBudget.resetSamples(); return; }
    if (!this.paused) {
      this.clock.advance(frameMs/1000);
      if (!this.reduced) this.elapsed += dt;
      const t = this.elapsed;
      for (const uniform of this.waterTimes) uniform.value = t;
      this.windTime.value=t;this.weather.update(t,this.camera.zoom,this.renderer.getPixelRatio());
      this.fog.forEach((cloud, i) => { (cloud.material as THREE.ShaderMaterial).uniforms.uTime.value = t; cloud.position.x = cloud.userData.originX + Math.sin(t * .12 + i) * .35; cloud.position.z = cloud.userData.originZ + Math.cos(t * .08 + i) * .17; });
      this.beacons.forEach((beacon, i) => { beacon.rotation.y = t * .5; beacon.position.y = beacon.userData.baseY + Math.sin(t * 1.6 + i) * .075; });
      this.fireflies.rotation.y = Math.sin(t * .03) * .06; this.fireflies.position.y = Math.sin(t * .35) * .12;
      if (this.fire) this.fire.scale.set(1 + Math.sin(t * 9) * .13, 1 + Math.sin(t * 13) * .22, 1);
      this.lantern.intensity = .055+this.lighting.night.value*1.35+Math.sin(t*5)*.008;
      this.lantern.distance=1.4+this.lighting.night.value*1.5;
      (this.fireflies.material as THREE.PointsMaterial).opacity=.10+this.lighting.night.value*.70;
      const walking = this.route.length > 0;
      if (walking) {
        this.stepTime += dt / (this.reduced ? .2 : .48);
        const from = TILE_MAP.get(this.positionId)!, to = TILE_MAP.get(this.route[0])!, progress = Math.min(this.stepTime, 1);
        const px = THREE.MathUtils.lerp(from.x, to.x, progress), pz = THREE.MathUtils.lerp(from.z, to.z, progress);
        const py = from.bridge || to.bridge ? THREE.MathUtils.lerp(walkHeight(from), walkHeight(to), progress) : landHeightAt(px, pz) + .045;
        this.knight.position.set(px, py, pz);
        const angle = Math.atan2(to.x - from.x, to.z - from.z); this.yaw += Math.atan2(Math.sin(angle - this.yaw), Math.cos(angle - this.yaw)) * Math.min(dt * 14, 1); this.knight.rotation.y = this.yaw;
        const gait = this.reduced ? 0 : Math.sin(this.stepTime * Math.PI * 4); this.legs.forEach((leg, i) => { leg.rotation.x = gait * (i ? -.52 : .52); }); this.arms.forEach((arm, i) => { arm.rotation.x = gait * (i ? .22 : -.22); }); this.body.position.y = Math.abs(gait) * .036;
        if (progress >= 1) { this.positionId = this.route.shift()!; this.stepTime = 0; this.callbacks.onStep(this.positionId); if (!this.route.length) { this.clearRoute(); this.callbacks.onArrive(this.positionId); } }
      } else { this.legs.forEach(leg => { leg.rotation.x *= .75; }); this.arms.forEach(arm => { arm.rotation.x *= .75; }); this.body.position.y = Math.sin(t * 2) * .012; }
      if (this.cape) this.cape.rotation.x = Math.sin(t * 2.1) * .045 + (walking ? .17 : 0);
      if(this.following){const desired=this.knight.position.clone().add(new THREE.Vector3(0,.5,0));const delta=desired.sub(this.controls.target).multiplyScalar(this.reduced?1:1-Math.exp(-dt*5));this.controls.target.add(delta);this.camera.position.add(delta);}
      if (this.targetCamera) { const delta = this.targetCamera.clone().sub(this.controls.target).multiplyScalar(this.reduced ? 1 : 1 - Math.exp(-dt * 5)); this.controls.target.add(delta); this.camera.position.add(delta); if (delta.length() < .001) this.targetCamera = null; }
      // Keep the fixed-angle camera close to the islands while panning.
      const clamped = this.controls.target.clone(); clamped.x = THREE.MathUtils.clamp(clamped.x, -32*WORLD_SCALE, 32*WORLD_SCALE); clamped.z = THREE.MathUtils.clamp(clamped.z, -24*WORLD_SCALE, 24*WORLD_SCALE); const correction = clamped.sub(this.controls.target); this.controls.target.add(correction); this.camera.position.add(correction);
    }
    this.controls.update(dt);
    if(!this.paused){const pixels=this.host.clientHeight*this.camera.zoom/(this.camera.top-this.camera.bottom)*this.renderer.getPixelRatio();if(this.lighting.update(this.clock.totalMinutes,dt,this.elapsed,this.controls.target,pixels,this.reduced))this.renderDirty=true;}

    const animated = !this.paused && (!this.reduced || this.route.length > 0);
    if (animated && this.loaded && this.renderBudget.observe(frameMs, now)) this.pendingRenderResize = true;
    if (this.pendingRenderResize && !this.activePointers.size && now - this.cameraChangeTime > 500) { this.pendingRenderResize = false; this.resize(); }
    if (animated || this.renderDirty) {
      this.renderer.render(this.scene, this.camera);
      this.renderDirty = false;
    }
    this.uiTime += dt;
    if (this.uiDirty && this.uiTime > .05) {
      this.uiTime = 0; this.uiDirty = false;
      const zoom = Math.round(this.camera.zoom * 100), angle = Math.round(this.controls.getAzimuthalAngle() * 1800 / Math.PI) / 10;
      if (zoom !== this.lastUIZoom || angle !== this.lastUIAngle) { this.lastUIZoom = zoom; this.lastUIAngle = angle; this.callbacks.onCamera(this.camera.zoom, angle * Math.PI / 180); }
      const width = this.host.clientWidth, height = this.host.clientHeight;
      const panels=[...this.host.parentElement!.querySelectorAll('.world-header,.world-title,.world-atlas,.world-minimap,.world-camera,.world-bottom,.world-clock,.clock-popover')].map(p=>p.getBoundingClientRect()).filter(r=>r.width&&r.height);
      for(const site of LANDMARKS){
        const label=this.labels.get(site.id);if(!label)continue;const tile=TILE_MAP.get(`${site.q},${site.r}`)!,selected=this.selectedId===tile.id;
        const position=new THREE.Vector3(tile.x,walkHeight(tile)+(site.kind==='main'?1.75:1.45),tile.z-.23).project(this.camera),x=(position.x*.5+.5)*width,y=(-position.y*.5+.5)*height;
        const halfWidth=Math.max(42,site.name.length*6+19),covered=panels.some(r=>x+halfWidth>r.left&&x-halfWidth<r.right&&y>r.top&&y-29<r.bottom);
        const crowded=!selected&&((width<600&&this.camera.zoom<.65)||(site.kind!=='main'&&this.camera.zoom<(width<600?1.15:.60)));
        label.style.transform=`translate(${x}px,${y}px) translate(-50%,-100%)`;label.style.visibility=crowded||covered||x<12||x>width-12||y<20||y>height-20||position.z>1?'hidden':'visible';label.classList.toggle('site-selected',selected);
      }
    }
  };
  dispose() {
    this.disposed = true; clearTimeout(this.loadTimeout); cancelAnimationFrame(this.frame); this.resizeObserver.disconnect(); this.controls.dispose();this.stopClockSubscription();document.removeEventListener('visibilitychange',this.onVisibility);
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown); canvas.removeEventListener('pointerup', this.onPointerUp); canvas.removeEventListener('pointermove', this.onPointerMove); canvas.removeEventListener('pointercancel', this.onPointerCancel); canvas.removeEventListener('pointerleave', this.onPointerLeave); canvas.removeEventListener('webglcontextlost', this.onContextLost); canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    const geometries = new Set<THREE.BufferGeometry>(this.geometry.values()), materials = new Set<THREE.Material>(this.materials.values());
    this.picking.forEach(mesh => geometries.add(mesh.geometry));
    this.scene.traverse(object => { const mesh = object as THREE.Mesh; if (mesh.geometry) geometries.add(mesh.geometry); if (mesh.material) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(mat => materials.add(mat)); });
    geometries.forEach(geo => geo.dispose()); materials.forEach(mat => mat.dispose()); this.lighting.dispose(); this.renderer.dispose(); canvas.remove();
  }
}
