import * as THREE from 'three';
import { TILES, TILE_MAP, DIRECTIONS, random, type Tile } from './worldData';

export const smooth = (a: number, b: number, n: number) => { const t = Math.max(0, Math.min(1, (n - a) / (b - a))); return t * t * (3 - 2 * t); };
function hash(x: number, y: number) { const f = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return f - Math.floor(f); }
export function noise(x: number, z: number) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(hash(ix, iz), hash(ix + 1, iz), u), THREE.MathUtils.lerp(hash(ix, iz + 1), hash(ix + 1, iz + 1), u), v) * 2 - 1;
}
export function fbm(x: number, z: number, octaves = 4) { let sum = 0, amplitude = .5; for (let n = 0; n < octaves; n++) { sum += noise(x, z) * amplitude; const nx = x * 1.73 + z * 1.08 + 7.3; z = z * 1.73 - x * 1.08 + 9.1; x = nx; amplitude *= .5; } return sum; }
export function nearestTile(x: number, z: number) {
  const q = Math.sqrt(3) / 3 * x - z / 3, r = z * 2 / 3;
  let rq = Math.round(q), rr = Math.round(r); const rs = Math.round(-q - r), dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs + q + r);
  if (dq > dr && dq > ds) rq = -rr - rs; else if (dr > ds) rr = -rq - rs;
  return TILE_MAP.get(`${rq},${rr}`);
}
const peaks = TILES.filter(t => t.biome === 'snow' && !t.walkable).map(t => ({ x: t.x + (random(t.seed + 4) - .5) * .85, z: t.z + (random(t.seed + 8) - .5) * .85, height: 1.5 + random(t.seed) * 1.5, radius: 1.65 + random(t.seed + 3) * .65 }));
const neighbors = new Map(TILES.map(tile => [tile.id, [tile, ...DIRECTIONS.map(([dq, dr]) => TILE_MAP.get(`${tile.q + dq},${tile.r + dr}`)).filter((t): t is Tile => !!t)]]));
export function pathClearance(tile: Tile, x: number, z: number) {
  if (!tile.walkable || tile.bridge) return 1;
  let distance = Math.hypot(x - tile.x, z - tile.z);
  for (const next of neighbors.get(tile.id)!) {
    if (next.id === tile.id || !next.walkable) continue;
    const dx = next.x - tile.x, dz = next.z - tile.z;
    const t = THREE.MathUtils.clamp(((x - tile.x) * dx + (z - tile.z) * dz) / (dx * dx + dz * dz), 0, .5);
    distance = Math.min(distance, Math.hypot(x - tile.x - t * dx, z - tile.z - t * dz));
  }
  return distance;
}
export function landHeightAt(x: number, z: number, knownTile?: Tile): number {
  const tile = knownTile || nearestTile(x, z);
  if (!tile) return -.38;
  let base = 0, total = 0, snow = 0, cliff = 0, sand = 0, dry = 0;
  for (const other of neighbors.get(tile.id)!) {
    const distance = Math.hypot(x - other.x, z - other.z), weight = Math.pow(Math.max(0, 1 - distance / 1.84), 3);
    const liquid = ['ocean', 'blood', 'fog'].includes(other.biome);
    base += (liquid ? -.29 : other.height) * weight; total += weight;
    if (other.biome === 'snow') snow += weight;
    if (other.biome === 'cliff') cliff += weight;
    if (other.biome === 'desert') sand += weight;
    if (!liquid) dry += weight;
  }
  if (!total) return -.29;
  base /= total; snow /= total; cliff /= total; sand /= total; dry /= total;
  const free = snow > .1 ? smooth(.15, .43, pathClearance(tile, x, z)) : tile.landmark ? smooth(.32, .7, Math.hypot(x - tile.x, z - tile.z)) : 1;
  let alpine = 0;
  if (snow > .001) for (const peak of peaks) {
    const dx = x - peak.x, dz = z - peak.z;
    const distance = Math.sqrt(Math.pow(dx * .89 + dz * .21, 2) + Math.pow(dz * 1.12 - dx * .35, 2));
    const envelope = Math.pow(Math.max(0, 1 - distance / peak.radius), 1.22);
    alpine = Math.max(alpine, envelope * peak.height);
  }
  const erosion = .16 * fbm(x * 5.4, z * 5.4, 5) + .07 * Math.abs(noise(x * 12, z * 12));
  alpine = Math.max(0, alpine * (1 + fbm(x * 2.2, z * 2.2, 3) * .18) + erosion * smooth(.05, .6, alpine));
  const cliffRise = Math.max(0, .14 + fbm(x * 1.1, z * 1.1) * .25 + noise(x * 4, z * 4) * .03) * cliff;
  const dunes = (Math.pow(.5 + .5 * Math.sin(x * 3.1 + z * 2.3 + fbm(x, z) * 1.7), 2) * .22 + fbm(x * 2, z * 2) * .06) * sand;
  return base + (alpine * snow + cliffRise + dunes + fbm(x * 2.7, z * 2.7) * .075 * dry) * free;
}
export function terrainNormal(x: number, z: number, tile?: Tile) {
  const e = .015;
  return new THREE.Vector3(landHeightAt(x - e, z, tile) - landHeightAt(x + e, z, tile), e * 2, landHeightAt(x, z - e, tile) - landHeightAt(x, z + e, tile)).normalize();
}
// Cache CPU geometry only. Scene-owned clones may be disposed independently on retry.
const terrainCache = new Map<string, THREE.BufferGeometry>();
/** Tessellated hex surfaces share a continuous height function along their edges. */
export function detailedHex(tile: Tile, water = false, lowDetail = false) {
  const cacheKey = `${tile.id}:${water ? 'water' : 'land'}:${lowDetail}`;
  const cached = terrainCache.get(cacheKey); if (cached) return cached.clone();
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], depths: number[] = [], colors: number[] = [], indices: number[] = [];
  const resolution = lowDetail ? (water ? 8 : 12) : water ? 13 : tile.biome === 'snow' || tile.biome === 'cliff' ? 24 : 15;
  for (let sector = 0; sector < 6; sector++) {
    const start = positions.length / 3;
    const a = sector * Math.PI / 3, b = (sector + 1) * Math.PI / 3;
    const ax = Math.sin(a), az = Math.cos(a), bx = Math.sin(b), bz = Math.cos(b);
    const rows: number[] = [];
    for (let i = 0; i <= resolution; i++) {
      rows.push(positions.length / 3 - start);
      for (let j = 0; j <= resolution - i; j++) {
        const x = tile.x + (ax * i + bx * j) / resolution, z = tile.z + (az * i + bz * j) / resolution;
        const ground = landHeightAt(x, z, tile), y = water ? .2 : ground;
        positions.push(x, y, z); uvs.push(x * .58, z * .58); depths.push(.2 - ground);
        const normal = water ? new THREE.Vector3(0, 1, 0) : terrainNormal(x, z, tile); normals.push(normal.x, normal.y, normal.z);
        const ambient = .78 + .22 * smooth(-.3, .8, fbm(x * 2, z * 2));
        colors.push(ambient, ambient, ambient);
      }
    }
    for (let i = 0; i < resolution; i++) for (let j = 0; j < resolution - i; j++) {
      const v = start + rows[i] + j, next = start + rows[i + 1] + j;
      indices.push(v, next, v + 1);
      if (j < resolution - i - 1) indices.push(v + 1, next, next + 1);
    }
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geometry.setAttribute('shoreDepth', new THREE.Float32BufferAttribute(depths, 1)); geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.setIndex(indices); geometry.computeBoundingSphere(); terrainCache.set(cacheKey, geometry); return geometry.clone();
}
export function erodedRock(seed = 0, widthSegments = 28, heightSegments = 18) {
  const geo = new THREE.SphereGeometry(1, widthSegments, heightSegments), position = geo.attributes.position;
  for (let n = 0; n < position.count; n++) {
    const x = position.getX(n), y = position.getY(n), z = position.getZ(n);
    const crack = fbm(x * 3 + seed, z * 3 + y * 2, 5) * .15 + noise(x * 11 + y * 7, z * 11) * .027;
    const silhouette = 1 + noise(x * 1.7 + seed, z * 1.7 + y) * .23;
    position.setXYZ(n, x * (silhouette + crack), y * (silhouette + crack) + Math.sin(x * 4 + z * 2) * .06, z * (silhouette + crack));
  }
  geo.computeVertexNormals(); return geo;
}
export function carvedCliff(seed = 0, lowDetail = false) {
  const geo = new THREE.BoxGeometry(1, 1, 1, lowDetail ? 8 : 16, lowDetail ? 12 : 24, lowDetail ? 8 : 16), pos = geo.attributes.position;
  const colors: number[] = [];
  for (let n = 0; n < pos.count; n++) {
    const x = pos.getX(n), y = pos.getY(n), z = pos.getZ(n);
    const strata = Math.sin(y * 46 + noise(x * 3 + seed, z * 3) * 2) * .024 + fbm(x * 5 + y * 3 + seed, z * 5, 4) * .085;
    pos.setXYZ(n, x * (1 + strata * 2) + noise(y * 6, z * 2 + seed) * .036, y + fbm(x * 4 + seed, z * 4) * .07, z * (1 + strata * 2));
    const shade = .79 + .21 * smooth(-.6, .6, Math.sin(y * 46 + noise(x * 3 + seed, z * 3) * 2)); colors.push(shade, shade * .99, shade * .94);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geo.computeVertexNormals(); return geo;
}
export function grassTuft(seed: number, lowDetail = false) {
  const positions: number[] = [], uvs: number[] = [], colors: number[] = [], indices: number[] = [];
  const base = new THREE.Color('#284930'), tip = new THREE.Color('#a7aa64');
  for (let blade = 0; blade < (lowDetail ? 5 : 14); blade++) {
    const angle = random(seed + blade * 4) * Math.PI * 2, height = .065 + random(seed + blade * 7) * .12;
    const cx = Math.sin(blade * 2.4) * .045 * random(seed + blade), cz = Math.cos(blade * 2.4) * .045 * random(seed + blade);
    const first = positions.length / 3;
    for (let layer = 0; layer < 4; layer++) {
      const t = layer / 3, width = .011 * (1 - t) + .0004, bend = t * t * .055;
      const color = base.clone().lerp(tip, t * .85);
      for (const side of [-1, 1]) { positions.push(cx + Math.cos(angle) * width * side + Math.sin(angle) * bend, t * height, cz - Math.sin(angle) * width * side + Math.cos(angle) * bend); uvs.push(side > 0 ? 1 : 0, t); colors.push(color.r, color.g, color.b); }
      if (layer < 3) { const v = first + layer * 2; indices.push(v, v + 1, v + 2, v + 1, v + 3, v + 2); }
    }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geo.setIndex(indices); geo.computeVertexNormals(); return geo;
}
export function pineCrown(seed: number) {
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [], colors: number[] = [];
  for (let layer = 0; layer < 11; layer++) {
    const t = layer / 11, y = .23 + t * 1.05;
    for (let branch = 0; branch < 7; branch++) {
      const angle = branch * Math.PI * 2 / 7 + layer * 2.399 + random(seed) * 6.28;
      const length = (.5 * (1 - t) + .07) * (.8 + random(seed + layer * 17 + branch) * .35);
      for (const sheet of [-1, 1]) {
        const start = positions.length / 3, tilt = sheet * .55 + .08;
        for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const radial = u * length, lateral = (v - .5) * length * .74;
          positions.push(Math.sin(angle) * radial + Math.cos(angle) * lateral * Math.cos(tilt), y - u * .065 + lateral * Math.sin(tilt), Math.cos(angle) * radial - Math.sin(angle) * lateral * Math.cos(tilt));
          uvs.push(u, v); const c = new THREE.Color('#dee5c4').multiplyScalar(.72 + t * .22 + random(seed + branch * 6 + layer) * .09); colors.push(c.r, c.g, c.b);
        }
        indices.push(start, start + 1, start + 2, start + 1, start + 3, start + 2);
      }
    }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geo.setIndex(indices); geo.computeVertexNormals(); return geo;
}
