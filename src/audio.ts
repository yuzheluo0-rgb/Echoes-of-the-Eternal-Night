/** Layered local sound design with cathedral convolution, no external audio requests. */
import { WorldSoundscape } from './world/WorldSoundscape';
import type { Biome } from './world/worldData';
export type SoundKind = 'hover' | 'select' | 'draw' | 'strike' | 'flame' | 'shield' | 'death' | 'bell' | 'combo' | 'win';
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
export function setWorldAudio(enabled:boolean,biome:Biome='grass'){
  try{
    if(!enabled){worldSound?.stop();worldSound=undefined;return;}
    const ctx=audio();void ctx.resume();if(!worldSound)worldSound=new WorldSoundscape(ctx,output,reverb,noiseBuffer);worldSound.setBiome(biome);
  }catch{/* Sound restrictions never block exploration. */}
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
    if (kind === 'select') { noise(ctx, 2100, .10, .06); tone(ctx, 540, 340, .14, .04, 0, 'triangle'); return; }
    if (kind === 'draw') { for (let i = 0; i < 3; i++) noise(ctx, 1700 + i * 120, .15, .10, 'bandpass', i * .07); return; }
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
