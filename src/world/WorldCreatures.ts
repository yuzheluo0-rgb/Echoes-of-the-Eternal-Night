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

/** How hard the eyes push past white. They are the one emissive thing in the bestiary, and the
 *  night exposure flattens everything else, so this is deliberately well over 1. */
const EYE_GLOW = 1.7;

/**
 * Two small glowing beads, one per side of the head, welded into the body geometry so thirty
 * eyeballs still cost nothing extra to draw and inherit the head's motion for free.
 *
 * The head is measured off the geometry rather than assumed. The front fifth of the bounding box
 * is muzzle and skull; a wider slice drags the quadruped's front legs in and lands the eyes on its
 * chest, and taking a fraction of `box.max.y` floats them above the ears, because a cat's tallest
 * point is its raised tail. Each bead is then anchored to the nearest real vertex on its own side
 * of the skull and pushed out along that vertex's normal — mirroring one side onto the other would
 * misplace an eye on the meshes that are not symmetric, and the dog is not.
 */
function addEyes(geometry: THREE.BufferGeometry, species: Species) {
  const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
  const box = geometry.boundingBox!;
  const count = position.count;
  const spanY = Math.max(.001, box.max.y - box.min.y), spanZ = Math.max(.001, box.max.z - box.min.z);
  const glow = new Float32Array(count);

  const accent = species.palette.accent;
  const extra: number[] = [], extraNormal: number[] = [], extraColor: number[] = [];
  if (accent) {
    const eye = new THREE.Color(accent);
    // The skull is read from a band behind the muzzle but still ahead of the shoulder. Taking the
    // whole front third instead measures the withers on a short-necked animal, and taking the
    // front fifth measures the bridge of the nose — and on the dog it measures the forelegs, which
    // is how the first attempt put an eye on the shoulder.
    const crown = box.min.z + spanZ * .72, nape = box.min.z + spanZ * .88;
    let skullTop = -Infinity;
    for (let i = 0; i < count; i++) {
      const z = position.getZ(i);
      if (z < crown || z > nape) continue;
      skullTop = Math.max(skullTop, position.getY(i));
    }
    const eyeY = skullTop - spanY * .16, radius = spanY * .055;
    const front = box.min.z + spanZ * .74, back = box.min.z + spanZ * .94;
    const eyeZ = box.min.z + spanZ * .84;
    const wide = [0, 0];
    for (let i = 0; i < count; i++) {
      const z = position.getZ(i);
      if (z < front || z > back) continue;
      if (Math.abs(position.getY(i) - eyeY) > spanY * .18) continue;
      const side = position.getX(i) < 0 ? 1 : 0;
      wide[side] = Math.max(wide[side], Math.abs(position.getX(i)));
    }
    for (const side of [0, 1]) {
      // The widest vertex at eye height *is* the side of the skull. Among the ones that share that
      // width, the one nearest the eye's depth is the one sitting where an eye belongs.
      let score = Infinity, x = 0, y = 0, z = 0, nx = 0, ny = 1, nz = 0;
      for (let i = 0; i < count; i++) {
        const zi = position.getZ(i);
        if (zi < front || zi > back) continue;
        if ((position.getX(i) < 0 ? 1 : 0) !== side) continue;
        if (Math.abs(position.getY(i) - eyeY) > spanY * .18) continue;
        if (Math.abs(position.getX(i)) < wide[side] * .92) continue;
        const near = Math.abs(zi - eyeZ) / spanZ;
        if (near >= score) continue;
        score = near;
        x = position.getX(i); y = position.getY(i); z = zi;
        nx = normal.getX(i); ny = normal.getY(i); nz = normal.getZ(i);
      }
      if (score === Infinity) continue;
      const away = new THREE.Vector3(nx, ny, nz).normalize();
      const centre = new THREE.Vector3(x, y, z).addScaledVector(away, radius * .55);
      // An octahedron rather than a flat quad: a quad facing out of the skull disappears the moment
      // the animal turns its back on the camera, and these are meant to be seen from anywhere.
      const across = new THREE.Vector3(Math.abs(away.x) > .9 ? 0 : 1, Math.abs(away.x) > .9 ? 1 : 0, 0);
      const right = new THREE.Vector3().crossVectors(across, away).normalize().multiplyScalar(radius);
      const up = new THREE.Vector3().crossVectors(away, right).normalize().multiplyScalar(radius);
      const poles = [away.clone().multiplyScalar(radius), right, up];
      const corners = poles.flatMap(pole => [centre.clone().add(pole), centre.clone().sub(pole)]);
      for (const face of [[0, 2, 4], [0, 4, 3], [0, 3, 5], [0, 5, 2], [1, 4, 2], [1, 3, 4], [1, 5, 3], [1, 2, 5]]) {
        for (const index of face) {
          const vertex = corners[index];
          extra.push(vertex.x, vertex.y, vertex.z);
          extraNormal.push(away.x, away.y, away.z);
          extraColor.push(eye.r, eye.g, eye.b);
        }
      }
    }
  }
  const added = extra.length / 3;
  if (added) {
    const grow = (name: string, tail: number[], size: number) => {
      const current = geometry.getAttribute(name);
      const out = new Float32Array((count + added) * size);
      out.set(current.array as Float32Array, 0);
      out.set(tail, count * size);
      geometry.setAttribute(name, new THREE.BufferAttribute(out, size));
    };
    grow('position', extra, 3);
    grow('normal', extraNormal, 3);
    grow('color', extraColor, 3);
    glow.fill(1, count);
  }
  // Always present, even all-zero: the shared shader declares `aGlow`, and a missing attribute
  // falls back to the generic vertex value rather than to "no eye here".
  geometry.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1));
}

/**
 * Injects idle, grazing, walking and eye-glow into a stock Lambert program, so creatures keep scene
 * lighting and shadows. Everything is driven off the rest position, which is what lets one
 * un-split mesh still have a swinging tail, a bobbing head and a lowered muzzle.
 *
 * The per-species constants travel as uniforms rather than as literals spliced into the source.
 * All twenty-nine species share ONE compiled program — `customProgramCacheKey` is a constant here,
 * and three.js keys its program cache on that rather than on the injected source — so a baked
 * literal is silently whatever species compiled first. That was the fox, which `SPECIES` builds
 * before any other animal, so every larger creature animated on a 0.70-unit fox's proportions: a
 * whale's entire body fell inside the "head" band and a rail's inside nothing at all.
 */
function animate(material: THREE.MeshLambertMaterial, time: { value: number }, box: THREE.Box3, species: Species) {
  const minZ = box.min.z, spanZ = Math.max(.001, box.max.z - box.min.z);
  const minY = box.min.y, spanY = Math.max(.001, box.max.y - box.min.y);
  // One gait cycle carries the animal two steps, and it covers `motion.speed * .55` world units a
  // second (see `update`). Deriving the cadence from the stride is what stops the feet skating.
  const stride = spanY * .30;
  const cadence = THREE.MathUtils.clamp(species.motion.speed * .55 / (2 * stride), .7, 3.2);
  const accent = species.palette.accent;
  const eye = new THREE.Color(accent ?? 0x000000);
  material.onBeforeCompile = shader => {
    shader.uniforms.uFaunaTime = time;
    shader.uniforms.uFaunaBox = { value: new THREE.Vector4(minY, spanY, minZ, spanZ) };
    shader.uniforms.uFaunaWalk = { value: new THREE.Vector2(stride, cadence) };
    shader.uniforms.uFaunaLegs = { value: species.habitat === 'land' ? 1 : 0 };
    // `.w` is the glow strength, so a species with no accent contributes none of it.
    shader.uniforms.uFaunaEye = { value: new THREE.Vector4(eye.r, eye.g, eye.b, accent ? EYE_GLOW : 0) };
    shader.vertexShader = `attribute float aPhase;\nattribute float aGait;\nattribute float aGraze;\nattribute float aGlow;\nuniform float uFaunaTime;\nuniform vec4 uFaunaBox;\nuniform vec2 uFaunaWalk;\nuniform float uFaunaLegs;\nvarying float vGlow;\nvarying float vPhase;\n` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      // Every weight reads the rest pose, never the displaced vertex, or the offsets below would
      // compound into one another.
      vec3 rest = transformed;
      float head  = uFaunaBox.y * .34;
      float hUp   = (rest.y - uFaunaBox.x) / uFaunaBox.y;
      float fRear = smoothstep(.50, .95, (rest.z - uFaunaBox.z) / uFaunaBox.w);
      float fTop  = smoothstep(.66, .95, hUp);
      float fLeg  = 1.0 - smoothstep(.06, .44, hUp);
      // 0 at the hip, 1 at the hoof: the leg shears away from the body instead of tearing off it.
      float below = clamp((.40 - hUp) / .36, 0.0, 1.0);
      transformed.y += sin(uFaunaTime * 1.5 + aPhase) * .011 * (1.0 - fLeg);
      transformed.x += sin(uFaunaTime * .90 + aPhase * 1.7) * .048 * fRear;
      transformed.y += sin(uFaunaTime * 1.9 + aPhase * 2.3) * .014 * fTop;
      transformed.x += sin(uFaunaTime * 2.4 + aPhase) * .012 * fTop;
      // Feeding: the muzzle drops and swings with the neck rather than pivoting on a joint.
      float graze = aGraze * fTop;
      transformed.y -= graze * head;
      transformed.z += graze * head * .40;
      transformed.x += sin(uFaunaTime * 1.3 + aPhase) * graze * .030;
      // A diagonal walk: opposite legs pair up, the foot swings fore and aft about the hip, and it
      // only leaves the ground on the forward half of the beat. That lift is what reads as a step
      // rather than as the whole animal sliding along the grass.
      float walk  = aGait * uFaunaLegs;
      float fore  = smoothstep(.38, .62, (rest.z - uFaunaBox.z) / uFaunaBox.w);
      float beat  = uFaunaTime * uFaunaWalk.y + aPhase + fore * PI + step(0.0, rest.x) * PI;
      float swing = sin(beat);
      transformed.z += swing * uFaunaWalk.x * below * walk;
      transformed.y += max(0.0, swing) * uFaunaWalk.x * .34 * below * below * walk;
      // The body rides up twice a cycle, once per landing pair.
      transformed.y += (0.5 - 0.5 * cos(beat * 2.0)) * uFaunaWalk.x * .16 * (1.0 - below) * walk;
      vGlow = aGlow;
      vPhase = aPhase;
    `);
    // Eyes are the one emissive tone in the bestiary, and they are mixed in here rather than set on
    // `emissive` so they follow the same tonemapping, colour space and fog as the rest of the scene.
    shader.fragmentShader = `uniform float uFaunaTime;\nuniform vec4 uFaunaEye;\nvarying float vGlow;\nvarying float vPhase;\n` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      outgoingLight = mix(outgoingLight, uFaunaEye.rgb * uFaunaEye.w * (.86 + .14 * sin(uFaunaTime * 2.3 + vPhase)), vGlow);
      #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => 'fauna-idle-v4';
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
  /** Eased 0..1 walk weight. A hard 0/1 snaps the legs on the instant a path is picked. */
  gait: number;
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
      // `addEyes` appends to the mesh, so the bounding box `tint` left behind is still the body's:
      // the eye beads sit inside the skull, and both `heights` and the walk weights want the body.
      addEyes(geometry, species);
      this.heights.set(species.id, geometry.boundingBox!.max.y - geometry.boundingBox!.min.y);
      const material = new THREE.MeshLambertMaterial({ vertexColors: true });
      animate(material, this.time, geometry.boundingBox!, species);
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
        this.wanderers.push({ entry, index: i, record, species, x: record.x, z: record.z, y, yaw: record.rot, mode: 'idle', timer: 1 + random(record.tileId.length * 7.7) * 4, path: [], step: 0, graze: 0, gait: 0 });
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
      wanderer.gait += ((wanderer.mode === 'walk' ? 1 : 0) - wanderer.gait) * Math.min(dt * 5, 1);
      this.quaternion.setFromEuler(new THREE.Euler(0, wanderer.yaw, 0));
      this.matrix.compose(this.position.set(wanderer.x, wanderer.y, wanderer.z), this.quaternion, this.scale.setScalar(wanderer.record.scale * (species.model.scale ?? 1)));
      wanderer.entry.mesh.setMatrixAt(wanderer.index, this.matrix);
      wanderer.entry.mesh.instanceMatrix.needsUpdate = true;
      wanderer.entry.gait.setX(wanderer.index, wanderer.gait);
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
