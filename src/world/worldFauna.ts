// Only `worldData` — which uses explicit `.ts` specifiers and therefore loads under node's
// strip-types runner. `storybookLandscape` (terrain sampling) is extensionless and render-only, so
// this module deliberately stays out of it and leaves seating creatures on the ground to the
// render layer. NOTE: the render layer is `WorldCreatures.ts`, never `WorldFauna.ts` — on Windows
// that name and this one resolve to the same file, and one would silently overwrite the other.
import { TILES, isWater, random, type Biome, type Tile } from './worldData.ts';
import { SPECIES, SPECIES_BY_ID, type Species } from './faunaSpecies.ts';

export * from './faunaSpecies.ts';

export interface FaunaRecord {
  species: string;
  /** The tile it was placed on, and the one its wander is measured from. */
  tileId: string;
  /** Ground-plane spawn position. Height is left to the render layer, which is the only place that
   *  can sample the sculpted terrain and knows about bridges and the water line. */
  x: number; z: number;
  /** Facing in radians, matching the knight's convention: forward is +z. */
  rot: number;
  /** Per-instance size jitter, so two of a kind do not read as clones. */
  scale: number;
}

/** Mixed into the spawn roll so animals scatter independently of the vegetation the tile's own
 *  seed already drives. */
const FAUNA_SALT = 5171;

/** A creature may only stand where its habitat allows. This is also what keeps a fox out of the sea
 *  and a whale off the meadow: spawn tiles are filtered by the species' own biome, so the two can
 *  never meet. */
function fits(species: Species, tile: Tile) {
  if (tile.biome !== species.biome) return false;
  const water = isWater(tile.biome);
  if (species.habitat === 'water') return water && !tile.bridge;
  if (species.habitat === 'air') return true;
  return !water && tile.walkable && !tile.structure && !tile.landmark;
}

/** Every tile a species is allowed to stand on, in a stable order. Cached because the wander loop
 *  re-reads it at runtime and the list never changes after generation. */
const habitatCache = new Map<string, Tile[]>();
export function habitatTiles(speciesId: string): Tile[] {
  const cached = habitatCache.get(speciesId);
  if (cached) return cached;
  const species = SPECIES_BY_ID.get(speciesId);
  const tiles = species ? TILES.filter(tile => fits(species, tile)) : [];
  habitatCache.set(speciesId, tiles);
  return tiles;
}

/**
 * Two to three animals per land, one per species in the biome's row, each placed on a tile that
 * belongs to that biome. Deterministic: every roll comes from `random(seed + salt)`, never
 * `Math.random`, so the same build always puts the same animal in the same place.
 */
export function placeFauna(): FaunaRecord[] {
  const byBiome = new Map<Biome, Species[]>();
  for (const species of SPECIES) {
    if (!byBiome.has(species.biome)) byBiome.set(species.biome, []);
    byBiome.get(species.biome)!.push(species);
  }
  const records: FaunaRecord[] = [];
  for (const [, pool] of byBiome) {
    // Claimed tiles are dropped as we go, so a biome's animals start spread across its map rather
    // than stacked on whichever tile the roll happened to favour.
    const taken = new Set<string>();
    for (const species of pool) {
      const options = habitatTiles(species.id).filter(tile => !taken.has(tile.id));
      if (!options.length) continue;
      const seed = options[0].seed + FAUNA_SALT;
      const tile = options[Math.min(options.length - 1, Math.floor(random(seed) * options.length))];
      for (const other of options) if (Math.abs(other.q - tile.q) <= 1 && Math.abs(other.r - tile.r) <= 1) taken.add(other.id);
      const angle = random(seed + 11) * Math.PI * 2, radius = .10 + random(seed + 23) * .26;
      records.push({
        species: species.id, tileId: tile.id,
        x: tile.x + Math.sin(angle) * radius, z: tile.z + Math.cos(angle) * radius,
        rot: random(seed + 31) * Math.PI * 2,
        scale: .90 + random(seed + 53) * .20,
      });
    }
  }
  return records;
}
