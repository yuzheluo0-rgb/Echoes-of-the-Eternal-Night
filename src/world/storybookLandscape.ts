import * as THREE from 'three';
import { DIRECTIONS, TILE_MAP, TILES, isWater, type Tile, type Biome } from './worldData';

export const PALETTE: Record<Biome, string> = { grass:'#79805b',forest:'#485e50',desert:'#ad9363',cliff:'#717580',snow:'#bdc8cb',ocean:'#1b2c32',blood:'#663344',fog:'#65727d',swamp:'#556447',volcano:'#4c414e',crystal:'#7c7296',waste:'#97816b' };
const neighborhood = new Map(TILES.map(tile => [tile.id, [tile, ...DIRECTIONS.map(([dq,dr]) => TILE_MAP.get(`${tile.q+dq},${tile.r+dr}`)).filter((t): t is Tile => !!t)]]));
export function nearestTile(x: number, z: number) {
  const q = x / Math.sqrt(3) - z / 3, r = z * 2 / 3;
  let a = Math.round(q), b = Math.round(r); const c = Math.round(-q-r);
  const da = Math.abs(a-q), db = Math.abs(b-r), dc = Math.abs(c+q+r);
  if (da > db && da > dc) a = -b-c; else if (db > dc) b = -a-c;
  return TILE_MAP.get(`${a},${b}`);
}
export function landHeightAt(x: number, z: number, _knownTile?: Tile) {
  const tile = nearestTile(x,z); if (!tile) return .08;
  let sum = 0, weight = 0;
  for (const other of neighborhood.get(tile.id)!) {
    const w = Math.max(0, 1-Math.hypot(x-other.x,z-other.z)/1.8) ** 3;
    sum += other.height*w; weight += w;
  }
  return weight ? sum/weight : tile.height;
}
export function pathClearance(tile: Tile, x: number, z: number) {
  if (!tile.walkable) return 1;
  let distance = Math.hypot(x-tile.x,z-tile.z);
  for (const next of neighborhood.get(tile.id)!) {
    if (next === tile || !next.walkable) continue;
    const dx = next.x-tile.x, dz = next.z-tile.z;
    const t = THREE.MathUtils.clamp(((x-tile.x)*dx+(z-tile.z)*dz)/(dx*dx+dz*dz),0,.5);
    distance = Math.min(distance,Math.hypot(x-tile.x-t*dx,z-tile.z-t*dz));
  }
  return distance;
}
export function tileSurface(tile: Tile, water = false) {
  const positions: number[] = [], colors: number[] = [], normals: number[] = [], indices: number[] = [];
  const base = new THREE.Color(PALETTE[tile.biome]);
  const shade = .97 + Math.sin(tile.seed)*.035;
  const vertex = (x: number,z: number) => {
    positions.push(x,water ? .125 : landHeightAt(x,z),z);
    colors.push(base.r*shade,base.g*shade,base.b*shade);
    if (water) { normals.push(0,1,0); return positions.length/3-1; }
    // Slope of the height field. Each sector owns its own vertices, so computeVertexNormals would
    // average only the faces of one sector and leave a visible crease down every seam; deriving the
    // normal from the underlying field instead makes the duplicates agree exactly.
    const e = .3;
    const gx = landHeightAt(x-e,z) - landHeightAt(x+e,z), gz = landHeightAt(x,z-e) - landHeightAt(x,z+e);
    const len = Math.hypot(gx,2*e,gz);
    normals.push(gx/len,2*e/len,gz/len);
    return positions.length/3-1;
  };
  // Sampling only the centre and the rim averages every hill away between them, which is why the
  // continent used to read as flat plates. Water is flat, so six triangles per hex are exact there.
  const steps = water ? 1 : 3;
  for (let sector = 0; sector < 6; sector++) {
    const a0 = sector*Math.PI/3, a1 = (sector+1)*Math.PI/3;
    const grid: number[][] = [];
    for (let i = 0; i <= steps; i++) {
      grid.push([]);
      for (let j = 0; j <= i; j++) {
        const u = (i-j)/steps, w = j/steps;
        grid[i].push(vertex(tile.x + Math.sin(a0)*u + Math.sin(a1)*w, tile.z + Math.cos(a0)*u + Math.cos(a1)*w));
      }
    }
    for (let i = 0; i < steps; i++) for (let j = 0; j <= i; j++) {
      indices.push(grid[i][j],grid[i+1][j],grid[i+1][j+1]);
      if (j < i) indices.push(grid[i][j],grid[i+1][j+1],grid[i][j+1]);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
  geometry.setIndex(indices);
  return geometry;
}
export function cartoonWater(color: string, opacity = 1) {
  const time = {value: 0};
  const material = new THREE.ShaderMaterial({
    uniforms: {uTime:time,uColor:{value:new THREE.Color(color)},uOpacity:{value:opacity},uLightTint:{value:new THREE.Color(1,1,1)},uNight:{value:0},uHighlight:{value:new THREE.Color('#ffe4b7')},uLightX:{value:0}},
    transparent: opacity < 1, depthWrite: opacity === 1,
    vertexShader: 'varying vec3 vWorld; void main(){vec4 p=modelMatrix*vec4(position,1.);vWorld=p.xyz;gl_Position=projectionMatrix*viewMatrix*p;}',
    fragmentShader: `varying vec3 vWorld; uniform float uTime; uniform vec3 uColor; uniform float uOpacity;uniform vec3 uLightTint;uniform float uNight;uniform vec3 uHighlight;uniform float uLightX;
      void main(){
        vec2 p=vWorld.xz;
        float swell=sin(p.x*.48+p.y*.62+uTime*.30)*.025;
        float wave=sin(p.y*5.+sin(p.x*1.7+uTime*.18)*.65-uTime*.65);
        float breaks=smoothstep(.64,.88,sin(p.x*2.1+p.y*.5));
        float crest=smoothstep(.972-fwidth(wave),.997,wave)*breaks;
        vec3 col=(uColor*(.97+swell)+vec3(.23,.22,.19)*crest*.034)*uLightTint;
        float trail=exp(-pow(p.x*.84+p.y*.52-uLightX*12.,2.)*.018);
        float glitter=pow(max(0.,sin(p.y*18.+sin(p.x*6.+uTime*.6)*1.8-uTime*1.5)),24.);
        float glintBreaks=smoothstep(.62,.96,sin(p.x*3.7+p.y*.8+sin(p.y*1.3-uTime*.21))*.5+.5);
        col+=uHighlight*trail*glitter*glintBreaks*(.012+uNight*.022);
        gl_FragColor=vec4(col,uOpacity);
        #include <colorspace_fragment>
      }`,
  });
  return {material,time};
}
export function cloakGeometry() {
  const p: number[] = [], colors: number[] = [], indices: number[] = [];
  const segments=24,layers=6;
  for (let layer=0;layer<=layers;layer++) for (let n=0;n<=segments;n++) {
    const t=layer/layers, a=.62+n/segments*(Math.PI*2-1.24), r=.20+t*.36;
    const fold=1+Math.sin(a*7)*.065*t;
    p.push(Math.sin(a)*r*fold,1.10-t*.91+(layer===layers ? Math.cos(a*7)*.035 : 0),Math.cos(a)*r*fold-.045);
    const shade=.79+Math.cos(a*7)*.12;colors.push(shade,shade,shade);
    if (layer<layers&&n<segments) { const v=layer*(segments+1)+n; indices.push(v,v+1,v+segments+1,v+1,v+segments+2,v+segments+1); }
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.setIndex(indices);g.computeVertexNormals();return g;
}
