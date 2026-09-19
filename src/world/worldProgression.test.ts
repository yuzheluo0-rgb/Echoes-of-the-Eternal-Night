import test from 'node:test';
import assert from 'node:assert/strict';
import { LANDMARKS, TILES, advanceJourney, acceptSideQuest, parseSave, resolveEncounter, tileId, type Biome, type WorldSave } from './worldData.ts';
import { REGION_ORDER, isRegionOpen } from './worldRegions.ts';
import { CHAPTERS, atChapterGate, chapterRequirements, nextChapter, unlockRegion, type RegionChapter } from './worldProgression.ts';
import { acceptHarborProject, harborPosition, repairHarbor } from './harborQuest.ts';

/** 22:00 and 09:00, either side of the 19:30—04:59 night window. */
const NIGHT = 22 * 60, DAY = 9 * 60;
const site = (id: string) => LANDMARKS.find(s => s.id === id)!;
const goTo = (save: WorldSave, id: string) => advanceJourney(save, tileId(site(id).q, site(id).r));
const snowTiles = () => TILES.filter(t => t.biome === 'snow' && t.walkable).map(t => t.id);
/** A walkable grass tile that is not the camp gate, for "must stand on the gate" cases. */
const awayFromCamp = () => TILES.find(t => t.walkable && !t.landmark && t.biome === 'grass' && t.id !== '0,1')!.id;

test('the chapter chain is linear and every gate and target resolves', () => {
  assert.equal(CHAPTERS.length, REGION_ORDER.length - 1, 'one chapter opens each land after grass');
  CHAPTERS.forEach((chapter, index) => {
    assert.equal(chapter.biome, REGION_ORDER[index + 1], 'chapters must follow REGION_ORDER');
    assert.ok(LANDMARKS.some(s => s.id === chapter.gate), chapter.gate);
    for (const target of chapter.targets) assert.ok(LANDMARKS.some(s => s.id === target), chapter.biome + ' -> ' + target);
  });
});

test('nextChapter walks forward and every claim grants one ember', () => {
  const save = parseSave(null);
  assert.deepEqual(save.regions.unlocked, ['grass']);
  assert.equal(nextChapter(save)!.biome, 'swamp');
  assert.equal(atChapterGate(nextChapter(save)!, save), true, 'the camp is the first gate');
  const claimed = unlockRegion(save, 'swamp', DAY);
  assert.deepEqual(claimed.regions.unlocked, ['grass', 'swamp']);
  assert.equal(claimed.embers, 4, 'claiming a land grants one ember');
  assert.equal(nextChapter(claimed)!.biome, 'forest');
  assert.equal(unlockRegion(claimed, 'swamp', DAY), claimed, 'a claimed land cannot be claimed twice');
});

test('unlockRegion refuses the wrong land, the wrong place and unmet conditions', () => {
  const camp = parseSave(null);
  assert.equal(unlockRegion(camp, 'forest', DAY), camp, 'cannot skip ahead of the next chapter');
  assert.equal(unlockRegion(camp, 'ocean', DAY), camp, 'cannot reach a land two chapters away');
  const away = advanceJourney(camp, awayFromCamp());
  assert.notEqual(away.position, camp.position);
  assert.equal(unlockRegion(away, 'swamp', DAY), away, 'the oath is sworn at the camp gate');
  const swamp = goTo(unlockRegion(camp, 'swamp', DAY), 'swamp');
  assert.equal(unlockRegion(swamp, 'forest', DAY), swamp, 'the forest chapter needs the swamp encounter');
  const chapter = nextChapter(unlockRegion(camp, 'swamp', DAY))!;
  assert.deepEqual(chapterRequirements(chapter, swamp, DAY).map(r => r.done), [false], 'the encounter is outstanding');
  assert.deepEqual(chapterRequirements(chapter, advanceJourney(swamp, awayFromCamp()), DAY).map(r => r.done), [false]);
});

test('the sand stele riddle accepts only the ember answer', () => {
  const atGate = goTo(advanceTo('desert'), 'desert');
  assert.equal(nextChapter(atGate)!.biome, 'volcano');
  assert.equal(unlockRegion(atGate, 'volcano', DAY), atGate, 'silence is not an answer');
  assert.equal(unlockRegion(atGate, 'volcano', DAY, 'crown'), atGate, 'the crown is wrong');
  assert.equal(unlockRegion(atGate, 'volcano', DAY, 'moon'), atGate, 'the moon is wrong');
  assert.notEqual(unlockRegion(atGate, 'volcano', DAY, 'ember'), atGate, 'the ember is the answer');
});

test('the moon ritual only opens the snow line at night', () => {
  const blood = goTo(advanceTo('blood'), 'blood');
  assert.equal(nextChapter(blood)!.biome, 'snow');
  assert.equal(unlockRegion(blood, 'snow', DAY), blood, 'daylight cannot freeze the causeway');
  assert.equal(unlockRegion(blood, 'snow', 19 * 60 + 29), blood, '19:29 is still dusk');
  assert.notEqual(unlockRegion(blood, 'snow', 19 * 60 + 30), blood, '19:30 has crossed into night');
  assert.notEqual(unlockRegion(blood, 'snow', 4 * 60 + 59), blood, '04:59 is still night');
  assert.equal(unlockRegion(blood, 'snow', 5 * 60), blood, '05:00 has broken into morning');
});

test('the snow survey counts six distinct tiles and never twice', () => {
  let save = goTo(advanceTo('snow'), 'snow');
  assert.equal(nextChapter(save)!.biome, 'waste');
  assert.equal(save.regions.snowTrail.length, 1, 'standing on the snow line is the first entry');
  const repeated = advanceJourney(save, save.position);
  assert.equal(repeated.regions.snowTrail.length, 1, 'the same tile never counts twice');
  for (const id of snowTiles()) { if (save.regions.snowTrail.length >= 5) break; save = advanceJourney(save, id); }
  assert.equal(save.regions.snowTrail.length, 5);
  const early = goTo(save, 'snow');
  assert.equal(unlockRegion(early, 'waste', DAY), early, 'five tiles is not a survey');
  save = advanceJourney(save, snowTiles().find(id => !save.regions.snowTrail.includes(id))!);
  assert.equal(save.regions.snowTrail.length, 6);
  const filed = goTo(save, 'snow');
  assert.notEqual(unlockRegion(filed, 'waste', DAY), filed, 'the temple submits the record');
});

test('a lone watcher can light all twelve lands by following the chapter chain', () => {
  const save = advanceTo('crystal');
  assert.deepEqual(save.regions.unlocked, [...REGION_ORDER], 'all twelve lands are open');
  assert.equal(nextChapter(save), undefined, 'the chain ends after the twelfth land');
  assert.ok(save.embers > 3, 'the journey earns embers along the way');
  assert.ok(save.harbor.stage >= 1, 'the harbor project ran alongside the chain');
  assert.ok(save.visited.length > 12, 'the journey actually visited the landmarks');
});

/** Follow the chain from the camp until `biome` is open, playing each chapter as a traveller would. */
function advanceTo(biome: Biome): WorldSave {
  let save = parseSave(null);
  for (let guard = 0; guard <= CHAPTERS.length && !isRegionOpen(save.regions, biome); guard++) {
    const chapter = nextChapter(save)!;
    const minutes = chapter.kind === 'night' ? NIGHT : DAY;
    const stepped = playChapter(save, chapter);
    const opened = unlockRegion(stepped, chapter.biome, minutes, chapter.kind === 'riddle' ? 'ember' : undefined);
    assert.notEqual(opened, stepped, 'the chain stalled at ' + chapter.biome);
    save = opened;
  }
  assert.ok(isRegionOpen(save.regions, biome), 'never reached ' + biome);
  return save;
}

/** Reach the chapter's gate and meet its condition the way a player would, then stand on the gate. */
function playChapter(save: WorldSave, chapter: RegionChapter): WorldSave {
  switch (chapter.kind) {
    case 'encounter': {
      const event = site(chapter.targets[0]);
      save = advanceJourney(save, tileId(event.q, event.r));
      save = resolveEncounter(save, event.id, 0);
      break;
    }
    case 'pilgrimage': case 'relic': case 'delivery':
      for (const id of chapter.targets) save = goTo(save, id);
      break;
    case 'project':
      save = acceptHarborProject(advanceJourney(save, harborPosition()));
      break;
    case 'survey':
      for (const id of snowTiles().slice(0, 6)) save = advanceJourney(save, id);
      break;
    case 'quest':
      save = acceptSideQuest(goTo(save, 'side-cliff'), 'side-cliff');
      for (const id of chapter.targets) save = goTo(save, id);
      break;
    case 'restoration':
      save = repairHarbor(advanceJourney(save, harborPosition()), 0);
      break;
    default: break;
  }
  return goTo(save, chapter.gate);
}
