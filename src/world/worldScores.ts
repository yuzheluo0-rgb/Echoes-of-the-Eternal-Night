// Pure score data, split out of `WorldSoundscape.ts` for the same reason `faunaSpecies.ts` is split
// out of `worldFauna.ts`: the synthesiser uses TypeScript parameter properties, which node's
// strip-only test runner refuses to load, so a test that wants to check a chart cannot import the
// module that plays it. Nothing here touches the DOM.

/**
 * A score is authored note data, not an audio file. The whole soundtrack is synthesised live, so a
 * piece here is a chord chart, a melody and a few timbre choices — which is also why adding one
 * costs no download.
 */
export interface Score {
  id: string;
  name: string;
  /** One line for the sound menu: key, metre, tempo, and what the arrangement leans on. */
  note: string;
  /** Seconds per step. */
  step: number;
  /** Steps per bar. Every `chords` entry lasts one bar; every `melody` entry holds `steps` slots. */
  steps: number;
  /** One triad per bar. Index 0 is the root, and is also sounded an octave below as the pedal. */
  chords: number[][];
  /** Per bar, `steps` slots of MIDI notes. 0 is a rest. */
  melody: number[][];
  /** Which chord tone the harp plucks on each step of the bar; -1 rests. */
  arpeggio: number[];
  /** Bars whose downbeat rings a bell. */
  bells?: number[];
  /** The pitch classes the piece is allowed to use, 0 = C. Declared so a mistyped note fails the
   *  suite instead of reaching the speakers — a chart this dense is easy to typo. */
  mode: number[];
  timbre: {
    pad: OscillatorType; lead: OscillatorType; harp: OscillatorType;
    /** Pad attack in seconds. Long values are what turn a chord into a swell. */
    swell: number;
    /** Pedal length as a fraction of the bar; below 1 it leaves air, above 1 it overlaps. */
    pedal: number;
    /** How hard the harp and the bell are struck, relative to the pads. */
    pluck: number; bell: number;
  };
}

/** 灯火渡海 / Lanterns Across the Tide. D minor, 6/8, quarter = 76. Sixteen bars: soft bowed pads,
 *  a plucked ostinato and a glass-bell melody. The original score, and the one the world opens on. */
const LANTERNS: Score = {
  id: 'lanterns', name: '灯火渡海', note: 'D 小调 · 6/8 · 弓弦铺底与玻璃铃',
  step: 60 / 76 / 2, steps: 6,
  chords: [[50, 57, 65], [46, 53, 62], [53, 60, 69], [48, 55, 64], [50, 57, 65], [43, 50, 58], [46, 53, 62], [45, 52, 61], [50, 57, 65], [53, 60, 69], [48, 55, 64], [46, 53, 62], [43, 50, 58], [45, 52, 61], [50, 57, 65], [50, 57, 64]],
  melody: [[74, 0, 0, 77, 0, 76], [74, 0, 70, 0, 0, 0], [72, 0, 0, 69, 0, 72], [76, 0, 74, 72, 0, 0], [74, 0, 77, 81, 0, 77], [79, 0, 0, 77, 0, 74], [77, 0, 74, 70, 0, 0], [73, 0, 0, 69, 0, 0], [74, 0, 0, 81, 0, 79], [77, 0, 0, 76, 0, 72], [76, 0, 79, 76, 0, 74], [74, 0, 0, 70, 0, 0], [70, 0, 74, 79, 0, 77], [76, 0, 0, 73, 0, 69], [74, 0, 77, 74, 0, 0], [69, 0, 0, 0, 0, 0]],
  arpeggio: [0, 2, 1, 2, 1, 2],
  // D natural minor, with the C# the melody keeps reaching for.
  mode: [0, 1, 2, 4, 5, 7, 9, 10],
  timbre: { pad: 'sine', lead: 'sine', harp: 'triangle', swell: .43, pedal: .68, pluck: 1, bell: 0 },
};

/**
 * 长夜祷歌 / Litany of the Long Night. D major, 4/4, quarter = 56. A processional in four phrases
 * over an organ pedal, with the harp thinned to half notes and a bell at every phrase end.
 *
 * The tune is D major against the first score's D minor, so the two share a tonic and can be
 * swapped mid-navigation without the world lurching into another key. Sacred colour comes from
 * open fifths (bars 3, 6, 9 and 16 have no third at all), a plagal cadence into bar 16, and two
 * suspensions: the A of bar 8 is a sus4 that the melody resolves, and bar 11 is a Gmaj7 whose F#
 * is left ringing under a D. The final bar ends on a bare fifth — an archaic close rather than a
 * triadic one.
 */
const LITANY: Score = {
  id: 'litany', name: '长夜祷歌', note: 'D 大调 · 4/4 · 管风琴低音与圣咏钟声',
  step: 60 / 56 / 2, steps: 8,
  chords: [
    [50, 57, 66], [55, 62, 71], [47, 54, 66], [45, 52, 61],
    [50, 57, 66], [55, 62, 67], [52, 59, 67], [45, 52, 62],
    [47, 59, 66], [42, 54, 61], [43, 55, 66], [45, 57, 64],
    [50, 57, 66], [55, 62, 71], [45, 57, 62], [50, 62, 69],
  ],
  melody: [
    [0, 0, 78, 0, 81, 0, 79, 0], [79, 0, 0, 0, 78, 0, 76, 0],
    [74, 0, 0, 78, 0, 0, 0, 0], [73, 0, 0, 0, 0, 0, 0, 0],
    [74, 0, 78, 0, 81, 0, 0, 0], [83, 0, 0, 81, 0, 79, 0, 0],
    [79, 0, 0, 0, 76, 0, 0, 0], [78, 0, 0, 76, 0, 0, 0, 0],
    [74, 0, 78, 0, 0, 0, 0, 0], [76, 0, 0, 0, 73, 0, 0, 0],
    [74, 0, 0, 0, 78, 0, 0, 0], [73, 0, 0, 76, 0, 0, 0, 0],
    [78, 0, 0, 0, 0, 0, 0, 0], [79, 0, 0, 78, 0, 76, 0, 0],
    [74, 0, 0, 0, 78, 0, 0, 0], [74, 0, 0, 0, 0, 0, 0, 0],
  ],
  arpeggio: [0, -1, 2, -1, 1, -1, 2, -1],
  bells: [3, 7, 11, 15],
  // D major. No borrowed chords anywhere: the sacred colour is meant to come from voicing — open
  // fifths and suspensions — rather than from chromaticism.
  mode: [1, 2, 4, 6, 7, 9, 11],
  timbre: { pad: 'sine', lead: 'sine', harp: 'triangle', swell: .95, pedal: 1.05, pluck: .62, bell: 1 },
};

export const SCORES: Score[] = [LANTERNS, LITANY];

export const TRACK_KEY = 'eternal-night-world-track-v1';

/** Falls back to the opening score, so a stale or hand-edited preference can never leave the
 *  player with silence and no way to tell why. */
export function parseScore(id: string | null | undefined) {
  return SCORES.some(score => score.id === id) ? id! : SCORES[0].id;
}
