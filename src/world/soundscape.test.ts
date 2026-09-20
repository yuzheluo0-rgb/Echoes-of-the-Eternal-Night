import test from 'node:test';
import assert from 'node:assert/strict';
import { SCORES, parseScore } from './worldScores.ts';

/** The lowest and highest note any chart may use. Below this the pedal turns to mud on a laptop
 *  speaker; above it the octave shimmer stops being audible and starts being shrill. */
const FLOOR = 24, CEILING = 96;

test('every score is a well-formed chart', () => {
  // The scheduler indexes `melody[bar][slot]` and `chord[arpeggio[slot]]` with no guards, so a short
  // row is not a wrong note — it is an undefined note, and the whole schedule throws.
  for (const score of SCORES) {
    const bars = score.chords.length;
    assert.ok(bars > 0, `${score.id} has no bars`);
    assert.equal(score.melody.length, bars, `${score.id} has ${score.melody.length} melody rows for ${bars} chords`);
    assert.equal(score.arpeggio.length, score.steps, `${score.id} arpeggio has ${score.arpeggio.length} slots for ${score.steps} steps`);
    for (let bar = 0; bar < bars; bar++) {
      assert.equal(score.melody[bar].length, score.steps, `${score.id} bar ${bar + 1} has ${score.melody[bar].length} slots`);
      assert.ok(score.chords[bar].length >= 3, `${score.id} bar ${bar + 1} is not a triad`);
      for (const tone of score.arpeggio) assert.ok(tone < score.chords[bar].length, `${score.id} arpeggio reaches past the chord in bar ${bar + 1}`);
    }
    for (const bar of score.bells ?? []) assert.ok(bar < bars, `${score.id} rings a bell at bar ${bar + 1}, which does not exist`);
  }
});

test('every note in every score stays in its declared mode and range', () => {
  // A typo in a 128-slot chart is invisible in review and unmissable in the ears — this is the
  // check that turns it into a red test. `mode` is the score's own claim about its key.
  for (const score of SCORES) {
    const playable = (midi: number, what: string) => {
      assert.ok(Number.isInteger(midi), `${score.id} ${what} is not a whole note: ${midi}`);
      assert.ok(midi >= FLOOR && midi <= CEILING, `${score.id} ${what} is MIDI ${midi}, outside ${FLOOR}..${CEILING}`);
      assert.ok(score.mode.includes(((midi % 12) + 12) % 12), `${score.id} ${what} is MIDI ${midi}, which is not in the declared mode`);
    };
    score.chords.forEach((chord, bar) => chord.forEach((tone, i) => {
      playable(tone, `chord ${bar + 1}.${i + 1}`);
      // The scheduler also sounds every root an octave down as the pedal.
      if (i === 0) playable(tone - 12, `pedal ${bar + 1}`);
    }));
    score.melody.forEach((bar, index) => bar.forEach((tone, slot) => {
      if (tone) { playable(tone, `bar ${index + 1}.${slot + 1}`); playable(tone + 12, `bar ${index + 1}.${slot + 1} octave`); }
    }));
  }
});

test('the track list is addressable and the stored preference cannot silence the world', () => {
  assert.equal(new Set(SCORES.map(score => score.id)).size, SCORES.length, 'score ids must be unique');
  for (const score of SCORES) assert.equal(parseScore(score.id), score.id);
  // A stale id from an older build has to fall back to a track that exists, or the world comes up
  // silent with nothing in the interface to explain it.
  for (const junk of [null, undefined, '', 'not-a-track', 'lanterns ']) assert.equal(parseScore(junk), SCORES[0].id);
});
