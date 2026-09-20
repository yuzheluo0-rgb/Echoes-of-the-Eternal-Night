import type { Biome } from './worldData';
import { SCORES, parseScore, type Score } from './worldScores';

type Bed = { source: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode; lfo: OscillatorNode; depth: GainNode };
const MOODS: Record<Biome, [number, number, number, number]> = {
  grass: [.040, .011, .004, 620], forest: [.030, .012, .004, 870], desert: [.084, .002, .009, 1150], cliff: [.095, .009, .007, 760], snow: [.081, .003, .009, 1300], ocean: [.037, .15, .018, 660], blood: [.034, .070, .065, 430], fog: [.073, .055, .021, 540], swamp: [.031, .076, .013, 690], volcano: [.033, .009, .15, 470], crystal: [.039, .007, .024, 990], waste: [.080, .002, .027, 810],
};
export class WorldSoundscape {
  private bus: GainNode;
  private wet: GainNode;
  /** The score rides its own bus, so switching tracks never ducks the biome beds. */
  private music: GainNode;
  private sources = new Set<AudioScheduledSourceNode>();
  private timer = 0;
  private tick = 0;
  private nextTime: number;
  private stopped = false;
  private beds: Bed[] = [];
  private biome: Biome = 'grass';
  private score: Score;
  constructor(private ctx: AudioContext, output: AudioNode, private reverb: AudioNode, noise: AudioBuffer, track?: string) {
    this.score = SCORES.find(score => score.id === parseScore(track))!;
    this.bus = ctx.createGain(); this.bus.gain.value = 0; this.bus.gain.setTargetAtTime(.80, ctx.currentTime, .9); this.bus.connect(output); this.wet = ctx.createGain(); this.wet.gain.value = .18; this.bus.connect(this.wet); this.wet.connect(reverb);
    this.music = ctx.createGain(); this.music.gain.value = 1; this.music.connect(this.bus);
    for (const [i, frequency] of [620, 1600, 110].entries()) {
      const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain(), lfo = ctx.createOscillator(), depth = ctx.createGain();
      source.buffer = noise; source.loop = true; filter.type = i === 2 ? 'lowpass' : 'bandpass'; filter.frequency.value = frequency; filter.Q.value = i === 1 ? .35 : .55; gain.gain.value = 0; lfo.frequency.value = [.087, .13, .063][i]; depth.gain.value = 0;
      source.connect(filter); filter.connect(gain); gain.connect(this.bus); lfo.connect(depth); depth.connect(gain.gain); source.start(ctx.currentTime, (i * .87) % noise.duration); lfo.start();
      this.track(source, [filter, gain]); this.track(lfo, [depth]); this.beds.push({ source, filter, gain, lfo, depth });
    }
    this.nextTime = ctx.currentTime + .10; this.setBiome('grass'); this.schedule(); this.timer = window.setInterval(() => this.schedule(), 100);
  }
  private track(source: AudioScheduledSourceNode, nodes: AudioNode[]) { this.sources.add(source); source.onended = () => { this.sources.delete(source); source.disconnect(); nodes.forEach(n => n.disconnect()); }; }
  private voice(frequency: number, when: number, duration: number, amplitude: number, type: OscillatorType = 'sine', attack = .015, pan = 0, endFrequency = frequency) {
    if (this.stopped) return;
    const oscillator = this.ctx.createOscillator(), envelope = this.ctx.createGain(), stereo = this.ctx.createStereoPanner();
    oscillator.type = type; oscillator.frequency.setValueAtTime(frequency, when); oscillator.frequency.exponentialRampToValueAtTime(endFrequency, when + duration); stereo.pan.value = pan;
    envelope.gain.setValueAtTime(0, when); envelope.gain.linearRampToValueAtTime(amplitude, when + attack); envelope.gain.exponentialRampToValueAtTime(.00001, when + duration);
    oscillator.connect(envelope); envelope.connect(stereo); stereo.connect(this.music);
    // The wet send passes through the music bus too, so mute and track changes silence the score.
    oscillator.start(when); oscillator.stop(when + duration + .025); this.track(oscillator, [envelope, stereo]);
  }
  private note(midi: number, when: number, duration: number, amplitude: number, type: OscillatorType = 'sine', attack = .015, pan = 0) { this.voice(440 * 2 ** ((midi - 69) / 12), when, duration, amplitude, type, attack, pan); }
  /** A struck bell. The partials are deliberately inharmonic — whole multiples of the fundamental
   *  would just sound like another pad, and it is the detuned ones that read as metal. */
  private bell(root: number, when: number, amplitude: number) {
    const partials: [number, number, number][] = [[1, .052, 4.4], [2.01, .027, 3.3], [2.41, .016, 2.5], [3.02, .010, 1.9], [4.22, .006, 1.3]];
    for (const [ratio, gain, decay] of partials) this.note(root + 12 * Math.log2(ratio), when, decay, gain * amplitude, 'sine', .004, 0);
  }
  private schedule() {
    if (this.stopped) return;
    // Do not replay a backlog after suspension or throttling.
    if (this.nextTime < this.ctx.currentTime - .15) this.nextTime = this.ctx.currentTime + .08;
    const { chords, melody, arpeggio, steps, step, timbre } = this.score;
    const bar = steps * step;
    while (this.nextTime < this.ctx.currentTime + .28) {
      const index = Math.floor(this.tick / steps) % chords.length, slot = this.tick % steps, chord = chords[index], time = this.nextTime;
      if (slot === 0) {
        chord.forEach((n, i) => this.note(n, time, bar + .45, .029, timbre.pad, timbre.swell, (i - 1) * .23));
        this.note(chord[0] - 12, time, bar * timbre.pedal, .038, timbre.pad, timbre.swell * .28);
        if (this.score.bells?.includes(index)) this.bell(chord[0] + 24, time, timbre.bell);
      }
      const pluck = arpeggio[slot];
      if (pluck >= 0) this.note(chord[pluck] + 12, time, step * 2.8, .024 * timbre.pluck, timbre.harp, .023, slot % 2 ? .30 : -.30);
      const lead = melody[index][slot];
      if (lead) { this.note(lead, time, 2.1, .061, timbre.lead, .011, .10); this.note(lead + 12, time, 1.08, .009, 'sine', .006, -.14); }
      if (slot === 0 && index % 3 === 2) this.wildlife(time + .38);
      this.tick++; this.nextTime += step;
    }
  }
  private wildlife(time: number) {
    if (['grass', 'forest', 'swamp'].includes(this.biome)) {
      const frog = this.biome === 'swamp', f = frog ? 340 : 1820;
      for (let i = 0; i < 3; i++) this.voice(f + i * (frog ? 12 : 190), time + i * .19, frog ? .12 : .10, frog ? .027 : .010, 'sine', .013, i % 2 ? .48 : -.45, f * (frog ? .72 : 1.35));
    } else if (this.biome === 'ocean') this.voice(1280, time, .55, .009, 'sine', .12, -.6, 960);
    else if (this.biome === 'crystal') { this.note(86, time, 2.7, .010, 'sine', .006, -.45); this.note(93, time + .33, 2.4, .007, 'sine', .008, .43); }
    else if (this.biome === 'volcano') this.voice(68, time, 1.6, .048, 'sine', .15, 0, 37);
  }
  /** Swaps the chart without stopping the world: the notes are cut and faded back in on the new
   *  piece, while wind, tide and birds keep their own bus and never duck. */
  setScore(track: string) {
    if (this.stopped) return;
    const next = SCORES.find(score => score.id === track);
    if (!next || next === this.score) return;
    const now = this.ctx.currentTime;
    this.score = next; this.tick = 0;
    this.music.gain.cancelScheduledValues(now);
    this.music.gain.setValueAtTime(this.music.gain.value, now);
    this.music.gain.linearRampToValueAtTime(0, now + .16);
    this.music.gain.setTargetAtTime(1, now + .55, .5);
    this.nextTime = now + .55;
  }
  setBiome(biome: Biome) {
    if (this.stopped) return; this.biome = biome; const [wind, water, rumble, frequency] = MOODS[biome];
    [wind, water, rumble].forEach((v, i) => { this.beds[i].gain.gain.setTargetAtTime(v, this.ctx.currentTime, 1.4); this.beds[i].depth.gain.setTargetAtTime(v * .28, this.ctx.currentTime, 1.4); }); this.beds[0].filter.frequency.setTargetAtTime(frequency, this.ctx.currentTime, 1.2);
  }
  stop() {
    if (this.stopped) return; this.stopped = true; clearInterval(this.timer); const now = this.ctx.currentTime; this.bus.gain.cancelScheduledValues(now); this.bus.gain.setTargetAtTime(0, now, .055);
    for (const source of this.sources) try { source.stop(now + .26); } catch { /* A note may already have ended. */ }
    window.setTimeout(() => { this.bus.disconnect(); this.wet.disconnect(); this.music.disconnect(); }, 360);
  }
}
