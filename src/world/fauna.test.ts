import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { BIOMES, TILE_MAP, discoverFauna, isWater, parseSave } from './worldData.ts';
import { SPECIES, SPECIES_BY_ID } from './faunaSpecies.ts';
import { habitatTiles, placeFauna } from './worldFauna.ts';

test('every land is stocked with two or three species that belong to it', () => {
  const byBiome = new Map<string, string[]>();
  for (const species of SPECIES) {
    assert.ok(species.biome in BIOMES, `${species.id} names an unknown biome ${species.biome}`);
    if (!byBiome.has(species.biome)) byBiome.set(species.biome, []);
    byBiome.get(species.biome)!.push(species.id);
  }
  // The brief: two or three animals per biome, and never one from somewhere else. Both halves
  // matter — a fox in the sea would be as wrong as an empty meadow.
  for (const biome of Object.keys(BIOMES)) {
    const pool = byBiome.get(biome) ?? [];
    assert.ok(pool.length >= 2 && pool.length <= 3, `${biome} has ${pool.length} species: ${pool.join(', ')}`);
  }
  assert.equal(new Set(SPECIES.map(species => species.id)).size, SPECIES.length, 'species ids must be unique');
  assert.equal(SPECIES_BY_ID.size, SPECIES.length);
});

test('species sharing a mesh agree on which way it faces', () => {
  // `yaw` corrects a mesh the head-finding rule gets wrong, so it belongs to the file, not to the
  // animal wearing it: a third whale species that forgets to copy the flip swims tail-first.
  const byFile = new Map<string, { id: string; yaw: number }[]>();
  for (const species of SPECIES) {
    const key = species.model.file;
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key)!.push({ id: species.id, yaw: species.model.yaw ?? 0 });
  }
  for (const [file, users] of byFile) {
    const yaw = users[0].yaw;
    for (const user of users) assert.equal(user.yaw, yaw, `${user.id} and ${users[0].id} disagree on ${file}.obj's facing`);
  }
});

test('only the hostile species carry an eye glow', () => {
  // The render layer grows eyes from `palette.accent` alone, so an accent on a friendly animal
  // would give it a pair of burning eyes with nothing else in the game to say why.
  for (const species of SPECIES) {
    assert.equal(!!species.palette.accent, species.temperament === 'hostile',
      `${species.id} is ${species.temperament} but ${species.palette.accent ? 'has' : 'lacks'} an accent`);
  }
});

test('every species can actually reach its own habitat', () => {
  // The bug this guards: a water species in a biome that has no water tiles at all. Placement
  // silently skips it and the biome comes up one animal short with nothing to show for it.
  for (const species of SPECIES) {
    const tiles = habitatTiles(species.id);
    assert.ok(tiles.length > 0, `${species.id} (${species.habitat}) has nowhere to live in ${species.biome}`);
    for (const tile of tiles) {
      assert.equal(tile.biome, species.biome, `${species.id} may not stand on ${tile.biome}`);
      if (species.habitat === 'water') assert.ok(isWater(tile.biome) && !tile.bridge);
      if (species.habitat === 'land') assert.ok(tile.walkable && !isWater(tile.biome) && !tile.structure && !tile.landmark);
    }
  }
});

test('every species points at a model file that is actually on disk', () => {
  // The loader logs and skips a model it cannot fetch, which is the right runtime behaviour but
  // would silently drop an animal from the world. A typo has to fail here instead.
  for (const species of SPECIES) {
    const file = `public/assets/world/fauna/${species.model.file}.obj`;
    assert.ok(existsSync(file), `${species.id} wants ${file}, which does not exist`);
  }
});

test('placement puts one of each species on its own biome, deterministically', () => {
  const records = placeFauna();
  assert.equal(records.length, SPECIES.length, 'one individual per species');
  assert.deepEqual(placeFauna(), records, 'placement must not depend on Math.random');
  for (const record of records) {
    const species = SPECIES_BY_ID.get(record.species)!;
    const tile = TILE_MAP.get(record.tileId)!;
    assert.equal(tile.biome, species.biome, `${record.species} spawned in ${tile.biome}`);
    assert.ok(Math.abs(record.scale - 1) <= .11, 'size jitter stays close to the authored scale');
    assert.ok(Number.isFinite(record.x) && Number.isFinite(record.z) && Number.isFinite(record.rot));
  }
  // Two species of one biome must not start on top of each other, or the map reads as one animal.
  const byBiome = new Map<string, typeof records>();
  for (const record of records) {
    const biome = SPECIES_BY_ID.get(record.species)!.biome;
    if (!byBiome.has(biome)) byBiome.set(biome, []);
    byBiome.get(biome)!.push(record);
  }
  for (const [biome, group] of byBiome) {
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
      const apart = Math.hypot(group[i].x - group[j].x, group[i].z - group[j].z);
      assert.ok(apart > 1.5, `${biome}: ${group[i].species} and ${group[j].species} start ${apart.toFixed(2)} apart`);
    }
  }
});

test('the bestiary records each species once and refuses anything else', () => {
  let save = parseSave(null);
  assert.deepEqual(save.fauna, [], 'a fresh save has seen nothing');
  assert.equal(discoverFauna(save, 'not-a-species'), save, 'unknown ids are refused by identity');
  save = discoverFauna(save, 'wolf');
  assert.deepEqual(save.fauna, ['wolf']);
  assert.equal(discoverFauna(save, 'wolf'), save, 'a second sighting changes nothing');
  save = discoverFauna(save, 'fox');
  assert.deepEqual(save.fauna, ['wolf', 'fox'], 'order is the order they were seen');
  assert.deepEqual(parseSave(JSON.stringify(save)), save, 'the bestiary survives a round trip');
});

test('save loading drops unknown and malformed fauna without touching the rest', () => {
  const save = parseSave(JSON.stringify({ fauna: ['wolf', 'wolf', 'unicorn', 7, null, 'fox'], embers: 9 }));
  assert.deepEqual(save.fauna, ['wolf', 'fox'], 'deduplicated and filtered to real species');
  assert.equal(save.embers, 9);
  assert.deepEqual(parseSave(JSON.stringify({ fauna: 'wolf' })).fauna, [], 'a non-array is discarded');
  assert.deepEqual(parseSave('{bad json').fauna, []);
});
