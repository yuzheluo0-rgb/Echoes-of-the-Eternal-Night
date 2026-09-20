/** Layered local sound design with cathedral convolution, no external audio requests. */
import { WorldSoundscape } from './world/WorldSoundscape';
import type { Biome } from './world/worldData';
export type SoundKind = 'hover' | 'select' | 'draw' | 'shuffle' | 'play' | 'strike' | 'flame' | 'shield' | 'death' | 'bell' | 'combo' | 'win';

/** One card sliding off the top of a deck: paper has almost no body, so the whole sound is a short
 *  band of filtered noise with a fast attack. Two bands, the second slightly later and brighter — a
 *  card is two surfaces leaving each other, not one. */
function slide(ctx: AudioContext, delay: number, amplitude: number, spread = 1) {
  noise(ctx, 2400 * spread, .16, amplitude, 'bandpass', delay);
  noise(ctx, 3900 * spread, .10, amplitude * .55, 'bandpass', delay + .022);
}
export const CARD_SOUNDS: { kind: SoundKind; label: string; note: string }[] = [
  { kind: 'shuffle', label: '洗牌', note: '把弃牌堆洗回抽牌堆' },
  { kind: 'draw', label: '抽牌', note: '从牌堆顶滑出一张' },
  { kind: 'select', label: '选牌', note: '拿起 / 查看一张牌' },
  { kind: 'play', label: '出牌', note: '把牌拍在桌上' },
];
let context: AudioContext | undefined;
let output: GainNode;
let reverb: ConvolverNode;
let room: GainNode;
let noiseBuffer: AudioBuffer;
let ambience: { gain: GainNode; sources: AudioScheduledSourceNode[] } | undefined;
let level = 0.65;
let worldSound:WorldSoundscape|undefined;

function audio() {
  if (context) return context;
  const ctx = new AudioContext(); context = ctx;
  output = ctx.createGain(); output.gain.value = level;
  const limiter = ctx.createDynamicsCompressor(); limiter.threshold.value = -16; limiter.knee.value = 12; limiter.ratio.value = 5; limiter.attack.value = .004; limiter.release.value = .2;
  output.connect(limiter); limiter.connect(ctx.destination);
  reverb = ctx.createConvolver(); room = ctx.createGain(); room.gain.value = .24;
  const impulse = ctx.createBuffer(2, Math.floor(ctx.sampleRate * 1.8), ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3.8) * .65;
  }
  reverb.buffer = impulse; reverb.connect(room); room.connect(output);
  noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return ctx;
}
export function setAudioVolume(volume: number) {
  level = Math.max(0, Math.min(1, volume));
  if (context && output) output.gain.setTargetAtTime(level, context.currentTime, .05);
}
export function setWorldAudio(enabled:boolean,biome:Biome='grass',track?:string){
  try{
    if(!enabled){worldSound?.stop();worldSound=undefined;return;}
    const ctx=audio();void ctx.resume();if(!worldSound)worldSound=new WorldSoundscape(ctx,output,reverb,noiseBuffer,track);worldSound.setBiome(biome);if(track)worldSound.setScore(track);
  }catch{/* Sound restrictions never block exploration. */}
}
/** Switching tracks is a no-op while the world is silent; the choice is applied when sound returns. */
export function setWorldTrack(track:string){
  try{worldSound?.setScore(track);}catch{/* A missing track never blocks exploration. */}
}
function tone(ctx: AudioContext, frequency: number, endFrequency: number, duration: number, amplitude: number, delay = 0, type: OscillatorType = 'sine') {
  const osc = ctx.createOscillator(); const envelope = ctx.createGain(); const now = ctx.currentTime + delay;
  osc.type = type; osc.frequency.setValueAtTime(frequency, now); osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), now + duration);
  envelope.gain.setValueAtTime(0, now); envelope.gain.linearRampToValueAtTime(amplitude, now + .005); envelope.gain.exponentialRampToValueAtTime(.0001, now + duration);
  osc.connect(envelope); envelope.connect(output); envelope.connect(reverb);
  osc.start(now); osc.stop(now + duration + .02);
  osc.onended = () => { osc.disconnect(); envelope.disconnect(); };
}
function noise(ctx: AudioContext, frequency: number, duration: number, amplitude: number, filterType: BiquadFilterType = 'bandpass', delay = 0) {
  const source = ctx.createBufferSource(); source.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter(); filter.type = filterType; filter.frequency.value = frequency; filter.Q.value = .65;
  const envelope = ctx.createGain(); const now = ctx.currentTime + delay;
  envelope.gain.setValueAtTime(0, now); envelope.gain.linearRampToValueAtTime(amplitude, now + .007); envelope.gain.exponentialRampToValueAtTime(.0001, now + duration);
  source.connect(filter); filter.connect(envelope); envelope.connect(output); envelope.connect(reverb);
  source.start(now); source.stop(now + duration + .02);
  source.onended = () => { source.disconnect(); filter.disconnect(); envelope.disconnect(); };
}
export function sound(kind: SoundKind, enabled: boolean) {
  if (!enabled) return;
  try {
    const ctx = audio(); void ctx.resume();
    if (kind === 'hover') { tone(ctx, 940, 810, .08, .009); return; }
    // Picking a card up: a light tap with a little wood under it, short enough to fire on every
    // press without turning into a drone when the player is clicking through a hand.
    if (kind === 'select') { slide(ctx, 0, .030, 1.15); tone(ctx, 620, 400, .09, .022, .004, 'triangle'); return; }
    if (kind === 'draw') { slide(ctx, 0, .058); return; }
    // Shuffling: the same slide, a dozen times, rattling at an uneven tempo. Evenly spaced clicks
    // read as a machine; the jitter is what makes it sound like two hands.
    if (kind === 'shuffle') {
      let at = 0;
      for (let i = 0; i < 13; i++) { slide(ctx, at, .026 + Math.random() * .016, .82 + Math.random() * .5); at += .042 + Math.random() * .048; }
      noise(ctx, 700, .28, .022, 'lowpass', .05);
      return;
    }
    // Playing a card: it lands. A paper slap for the surface, a low thump for the table underneath,
    // and a short bright tick for the corner hitting first.
    if (kind === 'play') { noise(ctx, 1500, .13, .16, 'bandpass'); noise(ctx, 320, .11, .13, 'lowpass'); tone(ctx, 190, 74, .13, .085); tone(ctx, 3100, 2200, .045, .030, .002, 'triangle'); return; }
    if (kind === 'strike') { noise(ctx, 3200, .12, .33, 'highpass'); tone(ctx, 130, 42, .19, .22); tone(ctx, 1730, 730, .12, .035, .015, 'triangle'); return; }
    if (kind === 'flame') { noise(ctx, 660, .42, .48, 'lowpass'); noise(ctx, 3400, .16, .08); tone(ctx, 85, 30, .28, .17); return; }
    if (kind === 'shield') { [554.37, 830.61, 1108.73].forEach((f, i) => tone(ctx, f, f, .55, .055 / (i + 1), i * .01)); noise(ctx, 1600, .10, .07); return; }
    if (kind === 'death') { noise(ctx, 750, .7, .15, 'lowpass'); tone(ctx, 78, 25, .6, .09); return; }
    if (kind === 'bell') { [164.81, 329.63, 452.0, 656.5, 876.4].forEach((f, i) => tone(ctx, f, f * .998, 3 - i * .35, .12 / (i + 1))); tone(ctx, 58, 43, .55, .13); return; }
    if (kind === 'combo' || kind === 'win') {
      const notes = kind === 'win' ? [164.81, 196, 246.94, 329.63] : [110, 164.81, 220, 329.63];
      notes.forEach((f, i) => tone(ctx, f, f, 1.5, .045, i * .085));
      noise(ctx, 950, .6, .06, 'lowpass');
    }
  } catch { /* Audio context restrictions never prevent a combat action. */ }
}
export function footstep(surface: 'stone' | 'wood' | 'sand' | 'snow' | 'grass', enabled: boolean) {
  if (!enabled) return;
  try {
    const ctx = audio();
    const frequency = { stone: 1500, wood: 650, sand: 2600, snow: 3300, grass: 1900 }[surface];
    noise(ctx, frequency * (.92 + Math.random() * .16), surface === 'snow' ? .16 : .1, .035, 'lowpass');
    if (surface === 'wood' || surface === 'stone') tone(ctx, surface === 'wood' ? 170 : 250, 65, .085, .021, 0, 'triangle');
  } catch { /* Movement does not depend on audio availability. */ }
}
export function setAmbience(enabled: boolean) {
  try {
    if (!enabled) {
      if (ambience && context) {
        const old = ambience; ambience = undefined; old.gain.gain.setTargetAtTime(0, context.currentTime, .12);
        old.sources.forEach(s => { try { s.stop(context!.currentTime + .5); } catch { /* Already stopped. */ } });
        setTimeout(() => old.gain.disconnect(), 750);
      }
      return;
    }
    if (ambience) return;
    const ctx = audio(); const gain = ctx.createGain(); gain.gain.value = 0; gain.gain.setTargetAtTime(.2, ctx.currentTime, 1.2); gain.connect(output);
    const sources: AudioScheduledSourceNode[] = [];
    for (const frequency of [55, 82.41, 110.13]) {
      const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = frequency;
      const quiet = ctx.createGain(); quiet.gain.value = .034; osc.connect(quiet); quiet.connect(gain); osc.start(); sources.push(osc);
      osc.onended = () => { osc.disconnect(); quiet.disconnect(); };
    }
    const wind = ctx.createBufferSource(); wind.buffer = noiseBuffer; wind.loop = true;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 380;
    const quiet = ctx.createGain(); quiet.gain.value = .11;
    wind.connect(filter); filter.connect(quiet); quiet.connect(gain); wind.start(); sources.push(wind);
    wind.onended = () => { wind.disconnect(); filter.disconnect(); quiet.disconnect(); };
    ambience = { gain, sources };
  } catch { /* Visual experience remains complete without audio. */ }
}
