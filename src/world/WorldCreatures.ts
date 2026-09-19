import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { TILE_MAP, hexDistance, isWater, findPath, random, walkHeight } from './worldData';
import { landHeightAt } from './storybookLandscape';
import { SPECIES, SPECIES_BY_ID, habitatTiles, type FaunaRecord, type Species } from './worldFauna.ts';

/** Models are cached by filename, so two species recoloured from one mesh load it once. */
const ASSET_ROOT = '/assets/world/fauna/';

/**
 * Turns a raw imported mesh into the species' silhouette: longest horizontal axis onto +z, scaled
 * to the species' size, feet on y=0, centred on the origin. The source models are authored at
 * wildly different scales (a pug is 2.6 units tall, a zebra 7.1) and six of the seventeen lie
 * along x, so none of this can be assumed.
 */
function normalize(source: THREE.BufferGeometry, species: Species) {
  const geometry = source.index ? source.toNonIndexed() : source.clone();
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  let box = geometry.boundingBox!;
  if (box.max.x - box.min.x > box.max.z - box.min.z) geometry.rotateY(Math.PI / 2);
  if (species.model.stretch) geometry.scale(...species.model.stretch);
  geometry.rotateY(headYaw(geometry) + (species.model.yaw ?? 0));
  geometry.computeBoundingBox(); box = geometry.boundingBox!;
  // A whale scaled by height would be two and a half hexes long, so swimmers and flyers are
  // measured nose to tail instead.
  const extent = species.sizeAxis === 'length' ? box.max.z - box.min.z : box.max.y - box.min.y;
  const scale = species.size / Math.max(.001, extent);
  geometry.scale(scale, scale, scale);
  geometry.computeBoundingBox(); box = geometry.boundingBox!;
  geometry.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  geometry.computeBoundingBox();
  return geometry;
}

/** Which way does the animal face? On a quadruped the head and neck carry more height than the
 *  rump, so the taller end of the long axis wins — that holds for eleven of the seventeen source
 *  meshes. Fish, whales and birds break the rule, and each of those carries an explicit `yaw`.
 *  Returns the rotation that brings the head onto +z, the direction the world walks in. */
function headYaw(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute('position'), box = geometry.boundingBox!;
  const span = Math.max(.001, box.max.z - box.min.z);
  let front = 0, frontCount = 0, back = 0, backCount = 0;
  for (let i = 0; i < position.count; i++) {
    const along = (position.getZ(i) - box.min.z) / span;
    if (along > .78) { front += position.getY(i); frontCount++; }
    else if (along < .22) { back += position.getY(i); backCount++; }
  }
  if (!frontCount || !backCount) return 0;
  return front / frontCount >= back / backCount ? 0 : Math.PI;
}

/**
 * The Quaternius meshes carry one flat material for the whole animal — a single `Kd 0.64` grey for
 * every part. Colour is therefore recovered from the geometry: the lowest band becomes legs, any
 * downward-facing surface becomes belly, and the rest wears the coat. That is what turns a
 * one-tone silhouette back into something with a dark underside and a pale chest.
 */
function tint(geometry: THREE.BufferGeometry, species: Species) {
  const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
  const box = geometry.boundingBox!, height = Math.max(.001, box.max.y - box.min.y);
  const coat = new THREE.Color(species.palette.coat), belly = new THREE.Color(species.palette.belly);
  const dark = new THREE.Color(species.palette.dark);
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const up = (position.getY(i) - box.min.y) / height;
    // Three tones only. `accent` is deliberately not used here — painting the top of the head with
    // it reads as a hat, not as detail. It is reserved for eyes and other small marks.
    let colour = coat;
    if (normal.getY(i) < -.34) colour = belly;
    if (up < .30) colour = dark;
    colors[i * 3] = colour.r; colors[i * 3 + 1] = colour.g; colors[i * 3 + 2] = colour.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  for (const key of Object.keys(geometry.attributes)) if (key !== 'position' && key !== 'normal' && key !== 'color') geometry.deleteAttribute(key);
  return geometry;
}

/** Injects idle, grazing and gait motion into a stock Lambert program, so creatures keep scene
 *  lighting and shadows. Everything is driven off the rest position, which is what lets one
 *  un-split mesh still have a swinging tail, a bobbing head and a lowered muzzle. */
function animate(material: THREE.MeshLambertMaterial, time: { value: number }, box: THREE.Box3) {
  const minZ = box.min.z, spanZ = Math.max(.001, box.max.z - box.min.z);
  const minY = box.min.y, spanY = Math.max(.001, box.max.y - box.min.y);
  const head = (spanY * .34).toFixed(4);
  material.onBeforeCompile = shader => {
    shader.uniforms.uFaunaTime = time;
    shader.vertexShader = `attribute float aPhase;\nattribute float aGait;\nattribute float aGraze;\nuniform float uFaunaTime;\n` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float fRear = smoothstep(.50, .95, (transformed.z - ${minZ.toFixed(4)}) / ${spanZ.toFixed(4)});
      float fTop  = smoothstep(.66, .95, (transformed.y - ${minY.toFixed(4)}) / ${spanY.toFixed(4)});
      float fLeg  = 1.0 - smoothstep(.06, .44, (transformed.y - ${minY.toFixed(4)}) / ${spanY.toFixed(4)});
      transformed.y += sin(uFaunaTime * 1.5 + aPhase) * .011 * (1.0 - fLeg);
      transformed.x += sin(uFaunaTime * .90 + aPhase * 1.7) * .048 * fRear;
      transformed.y += sin(uFaunaTime * 1.9 + aPhase * 2.3) * .014 * fTop;
      transformed.x += sin(uFaunaTime * 2.4 + aPhase) * .012 * fTop;
      // Feeding: the muzzle drops and swings with the neck rather than pivoting on a joint.
      float graze = aGraze * fTop;
      transformed.y -= graze * ${head};
      transformed.z += graze * ${head} * .40;
      transformed.x += sin(uFaunaTime * 1.3 + aPhase) * graze * .030;
      float gait = sin(uFaunaTime * 7.0 + aPhase + transformed.z * 3.2);
      transformed.y += abs(gait) * .050 * aGait;
      transformed.x += gait * .028 * aGait * fLeg * sign(transformed.x + .00001);
    `);
  };
  material.customProgramCacheKey = () => 'fauna-idle-v3';
}

interface Entry { species: Species; mesh: THREE.InstancedMesh; records: FaunaRecord[]; gait: THREE.InstancedBufferAttribute; graze: THREE.InstancedBufferAttribute; }

/** One animal, wandering. Land walkers follow real paths; swimmers cut straight across open water,
 *  because there is no walkable graph out there to follow. */
interface Wanderer {
  entry: Entry; index: number; record: FaunaRecord; species: Species;
  x: number; z: number; y: number; yaw: number;
  mode: 'idle' | 'walk';
  timer: number;
  path: { x: number; z: number; tileId: string }[];
  step: number;
  graze: number;
}

export class WorldCreatures {
  readonly group = new THREE.Group();
  private time = { value: 0 };
  private entries: Entry[] = [];
  private wanderers: Wanderer[] = [];
  /** Normalised model height per species, known only once the mesh is built. */
  private heights = new Map<string, number>();
  private matrix = new THREE.Matrix4();
  private quaternion = new THREE.Quaternion();
  private position = new THREE.Vector3();
  private scale = new THREE.Vector3();

  constructor(private records: FaunaRecord[]) { this.group.name = 'world-creatures'; }

  /** Imported meshes cannot be built in the constructor — the world is assembled synchronously and
   *  the model files have to be fetched. The scene is perfectly valid without them, so this runs
   *  afterwards and fills `group` in; the caller decides whether to wait before showing the map. */
  async load(): Promise<void> {
    const loader = new OBJLoader();
    const sources = new Map<string, THREE.BufferGeometry>();
    await Promise.all([...new Set(SPECIES.map(species => species.model.file))].map(async file => {
      try {
        const object = await loader.loadAsync(ASSET_ROOT + file + '.obj');
        object.traverse(child => {
          const mesh = child as THREE.Mesh;
          if (!sources.has(file) && mesh.isMesh && mesh.geometry) sources.set(file, mesh.geometry as THREE.BufferGeometry);
        });
      } catch (error) { console.warn('fauna model failed to load:', file, error); }
    }));
    for (const species of SPECIES) {
      const source = sources.get(species.model.file);
      if (!source) continue;
      const own = this.records.filter(record => record.species === species.id);
      if (!own.length) continue;
      const geometry = tint(normalize(source, species), species);
      this.heights.set(species.id, geometry.boundingBox!.max.y - geometry.boundingBox!.min.y);
      const material = new THREE.MeshLambertMaterial({ vertexColors: true });
      animate(material, this.time, geometry.boundingBox!);
      const mesh = new THREE.InstancedMesh(geometry, material, own.length);
      mesh.name = 'fauna-' + species.id;
      mesh.receiveShadow = true;
      // Each shadow caster is drawn a second time into the shadow map; only big silhouettes earn it.
      mesh.castShadow = !!species.large;
      const phases = new Float32Array(own.length);
      for (let i = 0; i < own.length; i++) phases[i] = (i * 2.399) % (Math.PI * 2);
      geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
      const gait = new THREE.InstancedBufferAttribute(new Float32Array(own.length), 1);
      gait.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('aGait', gait);
      const graze = new THREE.InstancedBufferAttribute(new Float32Array(own.length), 1);
      graze.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('aGraze', graze);
      const entry: Entry = { species, mesh, records: own, gait, graze };
      own.forEach((record, i) => {
        const y = this.seatY(species, record.tileId, record.x, record.z);
        this.quaternion.setFromEuler(new THREE.Euler(0, record.rot, 0));
        this.matrix.compose(this.position.set(record.x, y, record.z), this.quaternion, this.scale.setScalar(record.scale * (species.model.scale ?? 1)));
        mesh.setMatrixAt(i, this.matrix);
        this.wanderers.push({ entry, index: i, record, species, x: record.x, z: record.z, y, yaw: record.rot, mode: 'idle', timer: 1 + random(record.tileId.length * 7.7) * 4, path: [], step: 0, graze: 0 });
      });
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.userData.species = species.id;
      this.group.add(mesh);
      this.entries.push(entry);
    }
  }

  /** Sits an animal on whatever it is standing on: bridges and plinths use `walkHeight`, open
   *  terrain the sculpted surface, and swimmers float mostly submerged in their own water.
   *  Submersion is a fraction of the model's *height*, never of `size` — for a length-normalised
   *  swimmer those are unrelated, and scaling by size sank the whale a whole unit under the sea. */
  private seatY(species: Species, tileId: string, x: number, z: number) {
    const tile = TILE_MAP.get(tileId)!;
    if (species.habitat === 'water' || isWater(tile.biome)) return walkHeight(tile) - (this.heights.get(species.id) ?? species.size) * .34;
    return tile.bridge ? walkHeight(tile) : landHeightAt(x, z) + .045;
  }

  /** Where this animal may go next: same biome, same habitat, within its wander range, and not the
   *  tile it is already on. */
  private pickTarget(wanderer: Wanderer) {
    const here = TILE_MAP.get(wanderer.record.tileId) ?? TILE_MAP.get(wanderer.path.at(-1)?.tileId ?? '');
    const options = habitatTiles(wanderer.species.id).filter(tile => !here || hexDistance(tile, here) <= wanderer.species.motion.range);
    if (!options.length) return undefined;
    const tile = options[Math.floor(random(wanderer.index * 31.7 + this.time.value * 13.3 + options.length) * options.length) % options.length];
    if (here && tile.id === here.id) return undefined;
    if (wanderer.species.habitat === 'water') return [tile];
    // Land animals follow the real walkable graph, so they round buildings instead of crossing them.
    const ids = findPath(wanderer.record.tileId, tile.id).slice(1);
    return ids.length ? ids.map(id => TILE_MAP.get(id)!) : undefined;
  }

  update(t: number, dt: number, reduced: boolean) {
    this.time.value = t;
    if (reduced) return;
    for (const wanderer of this.wanderers) {
      const { species } = wanderer;
      if (wanderer.mode === 'idle') {
        wanderer.timer -= dt;
        const wants = species.motion.grazes ? 1 : 0;
        wanderer.graze += (wants - wanderer.graze) * Math.min(dt * 2.5, 1);
        if (wanderer.timer <= 0) {
          const path = this.pickTarget(wanderer);
          if (path) { wanderer.path = path.map(tile => ({ x: tile.x, z: tile.z, tileId: tile.id })); wanderer.step = 0; wanderer.mode = 'walk'; }
          else wanderer.timer = 2 + random(t * .37 + wanderer.index) * 3;
        }
      }
      if (wanderer.mode === 'walk') {
        wanderer.graze += (0 - wanderer.graze) * Math.min(dt * 4, 1);
        const goal = wanderer.path[0];
        if (!goal) { wanderer.mode = 'idle'; wanderer.timer = 2 + random(wanderer.index * 3.1 + t) * 4; continue; }
        const distance = Math.hypot(goal.x - wanderer.x, goal.z - wanderer.z);
        const stride = species.motion.speed * dt * .55;
        if (distance <= stride || distance < .001) {
          wanderer.x = goal.x; wanderer.z = goal.z; wanderer.record.tileId = goal.tileId;
          wanderer.path.shift();
          if (!wanderer.path.length) { wanderer.mode = 'idle'; wanderer.timer = 2.5 + random(wanderer.index * 5.3 + t) * 5; }
        } else {
          wanderer.x += (goal.x - wanderer.x) / distance * stride;
          wanderer.z += (goal.z - wanderer.z) / distance * stride;
          const angle = Math.atan2(goal.x - wanderer.x, goal.z - wanderer.z);
          wanderer.yaw += Math.atan2(Math.sin(angle - wanderer.yaw), Math.cos(angle - wanderer.yaw)) * Math.min(dt * 4, 1);
        }
        wanderer.y = this.seatY(species, wanderer.record.tileId, wanderer.x, wanderer.z);
      }
      const moving = wanderer.mode === 'walk' ? 1 : 0;
      this.quaternion.setFromEuler(new THREE.Euler(0, wanderer.yaw, 0));
      this.matrix.compose(this.position.set(wanderer.x, wanderer.y, wanderer.z), this.quaternion, this.scale.setScalar(wanderer.record.scale * (species.model.scale ?? 1)));
      wanderer.entry.mesh.setMatrixAt(wanderer.index, this.matrix);
      wanderer.entry.mesh.instanceMatrix.needsUpdate = true;
      wanderer.entry.gait.setX(wanderer.index, moving);
      wanderer.entry.gait.needsUpdate = true;
      wanderer.entry.graze.setX(wanderer.index, wanderer.graze);
      wanderer.entry.graze.needsUpdate = true;
    }
  }

  /** Nearest creature under the ray, or undefined. Distance is compared against the caller's own
   *  tile hit so that clicking the ground beside an animal still moves the watcher there. */
  hit(raycaster: THREE.Raycaster) {
    const hits = raycaster.intersectObjects(this.entries.map(entry => entry.mesh), false);
    if (!hits.length) return undefined;
    const hit = hits[0];
    const entry = this.entries.find(candidate => candidate.mesh === hit.object);
    if (!entry || hit.instanceId === undefined) return undefined;
    const record = entry.records[hit.instanceId];
    return record ? { species: record.species, tileId: record.tileId, distance: hit.distance } : undefined;
  }

  dispose() {
    for (const entry of this.entries) { entry.mesh.geometry.dispose(); (entry.mesh.material as THREE.Material).dispose(); }
    this.entries = []; this.wanderers = [];
  }
}

export { SPECIES_BY_ID, type Species };
