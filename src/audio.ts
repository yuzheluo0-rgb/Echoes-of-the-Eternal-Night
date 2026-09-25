/** Layered local sound design with cathedral convolution, no external audio requests. */
import { WorldSoundscape } from './world/WorldSoundscape';
import type { Biome } from './world/worldData';
import { BATTLE_SCORES, parseBattleScore, type BattleScore } from './battle/battleScores';
export type SoundKind = 'hover' | 'select' | 'draw' | 'shuffle' | 'play' | 'strike' | 'flame' | 'shield' | 'death' | 'bell' | 'combo' | 'win' | 'relic' | 'relic-set' | 'polish';

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
  { kind: 'polish', label: '打磨', note: '营火边把一张牌磨得更好' },
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
    // A relic turning face up: glass and metal rather than paper. A rising triad with a shimmer over
    // it, so the reveal reads as *an object* and not as one more card being drawn.
    if (kind === 'relic') {
      [392, 523.25, 659.25].forEach((f, i) => tone(ctx, f, f * 1.002, .9, .05 / (i * .4 + 1), i * .07));
      noise(ctx, 4200, .5, .05, 'highpass');
      return;
    }
    // Clicking into the slot: the same triad an octave down, with the body of something heavy
    // settling. Deliberately shorter than the reveal, because it is the second half of one gesture.
    if (kind === 'relic-set') {
      tone(ctx, 196, 146.83, .7, .09);
      tone(ctx, 392, 392, .5, .04, .02);
      noise(ctx, 420, .18, .09, 'lowpass');
      return;
    }
    // 打磨: a blade drawn across a whetstone. The grinding is the sound, so it is the body — three
    // scrapes at a hand's tempo rather than one, because the act is repeated strokes and a single
    // one would read as a card being dealt. The fifth over it is what makes it *finish*: an interval
    // rising to a held note, so the last thing the player hears is the edge, not the stone.
    if (kind === 'polish') {
      for (let i = 0; i < 3; i++) noise(ctx, 1500 + i * 260, .2, .085, 'bandpass', i * .14);
      noise(ctx, 300, .5, .07, 'lowpass');
      tone(ctx, 587.33, 587.33, .75, .045, .36);
      tone(ctx, 880, 880, .85, .035, .42);
      return;
    }
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

// ------------------------------------------------------------ 战斗页的配乐

/**
 * 战斗页的现场合成，和 `WorldSoundscape` 同一套调度：谱面在 `src/battle/battleScores.ts` 里是数据，
 * 这里只负责把音排出去。
 *
 * **为什么不是同一个类。** 那个类是一个乐器（弓弦铺底、玻璃铃、以及按地貌走的虫鸣与风声），它和
 * 地貌、和世界那两首谱子是焊在一起的；这一边要的是另一件乐器：锯齿铺底、方波主奏、钟只在守望者
 * 那一首响。两边真正共用的只有「把一个 MIDI 音排进时间轴」那三行，而为了共享那三行去改一段现在
 * 工作正常的声音，是拿确定的东西换不确定的。
 *
 * 交换的代价是**谱面格式必须一致**（同一个 `Score` 类型），这一点由 `battleScores.test.ts` 守着。
 */
class BattleMusic {
  private sources = new Set<AudioScheduledSourceNode>();
  private bus: GainNode;
  /** 每条音都会额外送一份到这里，再经延迟回到混响。电子乐的空气感几乎全长在这条线上。 */
  private echo: GainNode;
  private timer = 0;
  private tick = 0;
  private nextTime = 0;
  private stopped = false;
  private score: BattleScore;
  constructor(
    private ctx: AudioContext, output: AudioNode, private reverb: AudioNode, private noise: AudioBuffer, track: string,
  ) {
    this.score = BATTLE_SCORES.find(entry => entry.id === parseBattleScore(track))!;
    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    this.bus.gain.setTargetAtTime(.60, ctx.currentTime, 1.1);
    this.bus.connect(output);
    const wet = ctx.createGain(); wet.gain.value = this.score.timbre.space ?? .18;
    this.bus.connect(wet); wet.connect(reverb);
    // 延迟时间**由谱面推出来**：三格 = 十六分音符下的附点八分、八分音符下的附点四分，
    // 两种都是那个「呼吸长度」。所以换曲子不用另配一个延迟时间。
    const delay = ctx.createDelay(2);
    delay.delayTime.value = Math.min(1.9, this.score.step * 3);
    const feedback = ctx.createGain(); feedback.gain.value = .34;
    delay.connect(feedback); feedback.connect(delay);
    delay.connect(reverb);
    this.echo = ctx.createGain(); this.echo.gain.value = this.score.timbre.echo ?? 0;
    this.echo.connect(delay);
    this.nextTime = ctx.currentTime + .12;
    this.schedule();
    this.timer = window.setInterval(() => this.schedule(), 100);
  }
  private track(source: AudioScheduledSourceNode, nodes: AudioNode[]) {
    this.sources.add(source);
    source.onended = () => { this.sources.delete(source); source.disconnect(); nodes.forEach(node => node.disconnect()); };
  }
  private note(midi: number, when: number, duration: number, amplitude: number, type: OscillatorType, attack: number, pan: number) {
    if (this.stopped) return;
    const oscillator = this.ctx.createOscillator(), envelope = this.ctx.createGain(), stereo = this.ctx.createStereoPanner();
    oscillator.type = type;
    oscillator.frequency.value = 440 * 2 ** ((midi - 69) / 12);
    stereo.pan.value = pan;
    envelope.gain.setValueAtTime(0, when);
    envelope.gain.linearRampToValueAtTime(amplitude, when + attack);
    envelope.gain.exponentialRampToValueAtTime(.00001, when + duration);
    oscillator.connect(envelope); envelope.connect(stereo); stereo.connect(this.bus);
    stereo.connect(this.echo);
    oscillator.start(when); oscillator.stop(when + duration + .025);
    this.track(oscillator, [envelope, stereo]);
  }
  /**
   * 鼓。三件都是**噪声加一条极短的包络**，不是采样——谱面里只有一个字符，所以它必须是合成的。
   *
   *   底鼓  正弦从 120Hz 掉到 45Hz。掉音高那一下才是「击」，只压包络会听起来像敲桌子。
   *   军鼓  一段带通噪声叠一个 190Hz 的短音。纯噪声没有「响」，纯音没有「沙」。
   *   镲    高通噪声，极短。开镲（`o`）只是把衰减放长到六倍。
   */
  private drum(kind: string, when: number) {
    if (this.stopped) return;
    const level = .30;
    if (kind === 'k') {
      const oscillator = this.ctx.createOscillator(), envelope = this.ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(120, when);
      oscillator.frequency.exponentialRampToValueAtTime(45, when + .07);
      envelope.gain.setValueAtTime(level * 2.1, when);
      envelope.gain.exponentialRampToValueAtTime(.00001, when + .30);
      oscillator.connect(envelope); envelope.connect(this.bus);
      oscillator.start(when); oscillator.stop(when + .32);
      this.track(oscillator, [envelope]);
      return;
    }
    if (kind === 's' || kind === 'x') {
      const ping = kind === 'x' ? 260 : 190;
      const source = this.ctx.createBufferSource(), filter = this.ctx.createBiquadFilter(), envelope = this.ctx.createGain();
      source.buffer = this.noise; source.loop = true;
      filter.type = 'bandpass'; filter.frequency.value = kind === 'x' ? 2100 : 1750; filter.Q.value = .7;
      envelope.gain.setValueAtTime(level * (kind === 'x' ? 1.3 : 1.5), when);
      envelope.gain.exponentialRampToValueAtTime(.00001, when + .17);
      source.connect(filter); filter.connect(envelope); envelope.connect(this.bus); envelope.connect(this.echo);
      source.start(when, (when * 3.1) % this.noise.duration); source.stop(when + .19);
      this.track(source, [filter, envelope]);
      const body = this.ctx.createOscillator(), bodyGain = this.ctx.createGain();
      body.type = 'triangle'; body.frequency.value = ping;
      bodyGain.gain.setValueAtTime(level * .5, when);
      bodyGain.gain.exponentialRampToValueAtTime(.00001, when + .12);
      body.connect(bodyGain); bodyGain.connect(this.bus);
      body.start(when); body.stop(when + .14);
      this.track(body, [bodyGain]);
      return;
    }
    const source = this.ctx.createBufferSource(), filter = this.ctx.createBiquadFilter(), envelope = this.ctx.createGain();
    source.buffer = this.noise; source.loop = true;
    filter.type = 'highpass'; filter.frequency.value = 7200;
    const decay = kind === 'o' ? .34 : .055;
    envelope.gain.setValueAtTime(level * .5, when);
    envelope.gain.exponentialRampToValueAtTime(.00001, when + decay);
    source.connect(filter); filter.connect(envelope); envelope.connect(this.bus);
    source.start(when, (when * 5.7) % this.noise.duration); source.stop(when + decay + .02);
    this.track(source, [filter, envelope]);
  }
  /** 钟：泛音**故意不成整数倍**。整倍的和弦只会听起来像另一层铺底，偏掉的那几个才是金属。 */
  private bell(root: number, when: number, amplitude: number) {
    const partials: [number, number, number][] = [[1, .052, 4.4], [2.01, .027, 3.3], [2.41, .016, 2.5], [3.02, .010, 1.9], [4.22, .006, 1.3]];
    for (const [ratio, gain, decay] of partials) this.note(root + 12 * Math.log2(ratio), when, decay, gain * amplitude, 'sine', .004, 0);
  }
  private schedule() {
    if (this.stopped) return;
    // 挂起或节流之后不要补播积压的音。
    if (this.nextTime < this.ctx.currentTime - .15) this.nextTime = this.ctx.currentTime + .08;
    const { chords, melody, arpeggio, steps, step, timbre, bass, drums, harmony } = this.score;
    const bar = steps * step;
    while (this.nextTime < this.ctx.currentTime + .28) {
      const index = Math.floor(this.tick / steps) % chords.length, slot = this.tick % steps;
      const chord = chords[index], time = this.nextTime;
      if (slot === 0) {
        chord.forEach((midi, i) => this.note(midi, time, bar + .45, .026, timbre.pad, timbre.swell, (i - 1) * .23));
        // 有低音线的时候**不放持续根音**——两条抢同一个低频，结果是一团糊而不是更厚。
        if (!bass) this.note(chord[0] - 12, time, bar * timbre.pedal, .040, timbre.pad, timbre.swell * .28, 0);
        if (this.score.bells?.includes(index)) this.bell(chord[0] + 24, time, timbre.bell);
      }
      const pluck = arpeggio[slot];
      if (pluck >= 0) this.note(chord[pluck] + 12, time, step * 2.8, .022 * timbre.pluck, timbre.harp, .021, slot % 2 ? .30 : -.30);
      const lead = melody[index][slot];
      if (lead) { this.note(lead, time, 2.1, .056, timbre.lead, .010, .10); this.note(lead + 12, time, 1.08, .008, 'sine', .006, -.14); }
      // 会走的低音：值是**相对该小节根音**的半音数，`-1` 是空拍。
      const low = bass?.[index]?.[slot];
      if (low !== undefined && low >= 0) this.note(chord[0] + low - 12, time, step * 1.9, .075, 'triangle', .008, 0);
      // 对位声部比主奏轻、比主奏靠后，它就是「后面还有东西」。
      const second = harmony?.[index]?.[slot];
      if (second) this.note(second, time, 1.7, .032, timbre.lead, .012, -.22);
      const hit = drums?.[index]?.[slot];
      if (hit && hit !== '-') this.drum(hit, time);
      this.tick++; this.nextTime += step;
    }
  }
  /** 换曲不停机：旧曲子渐下去、新曲子从下一小节淡进来，中间那一下听不出来是「切」的。 */
  setTrack(track: string) {
    if (this.stopped) return;
    const next = BATTLE_SCORES.find(entry => entry.id === track);
    if (!next || next === this.score) return;
    const now = this.ctx.currentTime;
    this.score = next; this.tick = 0;
    this.echo.gain.setTargetAtTime(next.timbre.echo ?? 0, now, .3);
    this.bus.gain.cancelScheduledValues(now);
    this.bus.gain.setValueAtTime(this.bus.gain.value, now);
    this.bus.gain.linearRampToValueAtTime(0, now + .18);
    this.bus.gain.setTargetAtTime(.62, now + .60, .5);
    this.nextTime = now + .60;
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true; clearInterval(this.timer);
    const now = this.ctx.currentTime;
    this.bus.gain.cancelScheduledValues(now);
    this.bus.gain.setTargetAtTime(0, now, .06);
    for (const source of this.sources) try { source.stop(now + .28); } catch { /* 有的音可能已经结束了。 */ }
    window.setTimeout(() => this.bus.disconnect(), 400);
  }
}

let battleMusic: BattleMusic | undefined;

/**
 * 战斗页的配乐开关与换曲。`track` 是 `scoreForMood()` 给出的那一首。
 *
 * ⚠️ **换曲不能重建播放器**：重建会让整条时间轴从头开始，于是「踏进一场战斗」听起来像另一张唱片
 * 启动了，而不是同一座塔的声音变凶了。所以同一条命里只构造一次，之后走 `setTrack`。
 */
export function setBattleAudio(enabled: boolean, track: string) {
  try {
    if (!enabled) { battleMusic?.stop(); battleMusic = undefined; return; }
    const ctx = audio();
    void ctx.resume();
    if (!battleMusic) battleMusic = new BattleMusic(ctx, output, reverb, noiseBuffer, track);
    else battleMusic.setTrack(track);
  } catch { /* 声音受限从不应该挡住玩。 */ }
}
