import type { Biome } from './worldData';

// Original score: 灯火渡海 / Lanterns Across the Tide. D minor, 6/8, quarter = 76.
// Sixteen authored bars, soft bowed pads, a plucked ostinato and a glass-bell melody.
const EIGHTH=60/76/2;
const CHORDS=[[50,57,65],[46,53,62],[53,60,69],[48,55,64],[50,57,65],[43,50,58],[46,53,62],[45,52,61],[50,57,65],[53,60,69],[48,55,64],[46,53,62],[43,50,58],[45,52,61],[50,57,65],[50,57,64]];
const MELODY=[[74,0,0,77,0,76],[74,0,70,0,0,0],[72,0,0,69,0,72],[76,0,74,72,0,0],[74,0,77,81,0,77],[79,0,0,77,0,74],[77,0,74,70,0,0],[73,0,0,69,0,0],[74,0,0,81,0,79],[77,0,0,76,0,72],[76,0,79,76,0,74],[74,0,0,70,0,0],[70,0,74,79,0,77],[76,0,0,73,0,69],[74,0,77,74,0,0],[69,0,0,0,0,0]];
type Bed={source:AudioBufferSourceNode;filter:BiquadFilterNode;gain:GainNode;lfo:OscillatorNode;depth:GainNode};
const MOODS:Record<Biome,[number,number,number,number]>={
  grass:[.040,.011,.004,620],forest:[.030,.012,.004,870],desert:[.084,.002,.009,1150],cliff:[.095,.009,.007,760],snow:[.081,.003,.009,1300],ocean:[.037,.15,.018,660],blood:[.034,.070,.065,430],fog:[.073,.055,.021,540],swamp:[.031,.076,.013,690],volcano:[.033,.009,.15,470],crystal:[.039,.007,.024,990],waste:[.080,.002,.027,810],
};
export class WorldSoundscape{
  private bus:GainNode;
  private wet:GainNode;
  private sources=new Set<AudioScheduledSourceNode>();
  private timer=0;
  private tick=0;
  private nextTime:number;
  private stopped=false;
  private beds:Bed[]=[];
  private biome:Biome='grass';
  constructor(private ctx:AudioContext,output:AudioNode,private reverb:AudioNode,noise:AudioBuffer){
    this.bus=ctx.createGain();this.bus.gain.value=0;this.bus.gain.setTargetAtTime(.80,ctx.currentTime,.9);this.bus.connect(output);this.wet=ctx.createGain();this.wet.gain.value=.18;this.bus.connect(this.wet);this.wet.connect(reverb);
    for(const [i,frequency]of [620,1600,110].entries()){
      const source=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),gain=ctx.createGain(),lfo=ctx.createOscillator(),depth=ctx.createGain();
      source.buffer=noise;source.loop=true;filter.type=i===2?'lowpass':'bandpass';filter.frequency.value=frequency;filter.Q.value=i===1?.35:.55;gain.gain.value=0;lfo.frequency.value=[.087,.13,.063][i];depth.gain.value=0;
      source.connect(filter);filter.connect(gain);gain.connect(this.bus);lfo.connect(depth);depth.connect(gain.gain);source.start(ctx.currentTime,(i*.87)%noise.duration);lfo.start();
      this.track(source,[filter,gain]);this.track(lfo,[depth]);this.beds.push({source,filter,gain,lfo,depth});
    }
    this.nextTime=ctx.currentTime+.10;this.setBiome('grass');this.schedule();this.timer=window.setInterval(()=>this.schedule(),100);
  }
  private track(source:AudioScheduledSourceNode,nodes:AudioNode[]){this.sources.add(source);source.onended=()=>{this.sources.delete(source);source.disconnect();nodes.forEach(n=>n.disconnect());};}
  private voice(frequency:number,when:number,duration:number,amplitude:number,type:OscillatorType='sine',attack=.015,pan=0,endFrequency=frequency){
    if(this.stopped)return;
    const oscillator=this.ctx.createOscillator(),envelope=this.ctx.createGain(),stereo=this.ctx.createStereoPanner();
    oscillator.type=type;oscillator.frequency.setValueAtTime(frequency,when);oscillator.frequency.exponentialRampToValueAtTime(endFrequency,when+duration);stereo.pan.value=pan;
    envelope.gain.setValueAtTime(0,when);envelope.gain.linearRampToValueAtTime(amplitude,when+attack);envelope.gain.exponentialRampToValueAtTime(.00001,when+duration);
    oscillator.connect(envelope);envelope.connect(stereo);stereo.connect(this.bus);
    // The wet send also passes through the fading bus, so mute stops the whole score.
    oscillator.start(when);oscillator.stop(when+duration+.025);this.track(oscillator,[envelope,stereo]);
  }
  private note(midi:number,when:number,duration:number,amplitude:number,type:OscillatorType='sine',attack=.015,pan=0){this.voice(440*2**((midi-69)/12),when,duration,amplitude,type,attack,pan);}
  private schedule(){
    if(this.stopped)return;
    // Do not replay a backlog after suspension or throttling.
    if(this.nextTime<this.ctx.currentTime-.15)this.nextTime=this.ctx.currentTime+.08;
    while(this.nextTime<this.ctx.currentTime+.28){
      const bar=Math.floor(this.tick/6)%16,step=this.tick%6,chord=CHORDS[bar],time=this.nextTime;
      if(step===0){chord.forEach((n,i)=>this.note(n,time,6*EIGHTH+.45,.029,'sine',.43,(i-1)*.23));this.note(chord[0]-12,time,4*EIGHTH,.038,'sine',.12);}
      const arpeggio=[0,2,1,2,1,2][step];this.note(chord[arpeggio]+12,time,EIGHTH*2.8,.024,'triangle',.023,step%2?.30:-.30);
      const melody=MELODY[bar][step];if(melody){this.note(melody,time,2.1,.061,'sine',.011,.10);this.note(melody+12,time,1.08,.009,'sine',.006,-.14);}
      if(step===0&&bar%3===2)this.wildlife(time+.38);
      this.tick++;this.nextTime+=EIGHTH;
    }
  }
  private wildlife(time:number){
    if(['grass','forest','swamp'].includes(this.biome)){
      const frog=this.biome==='swamp',f=frog?340:1820;
      for(let i=0;i<3;i++)this.voice(f+i*(frog?12:190),time+i*.19,frog?.12:.10,frog?.027:.010,'sine',.013,i%2?.48:-.45,f*(frog?.72:1.35));
    }else if(this.biome==='ocean')this.voice(1280,time,.55,.009,'sine',.12,-.6,960);
    else if(this.biome==='crystal'){this.note(86,time,2.7,.010,'sine',.006,-.45);this.note(93,time+.33,2.4,.007,'sine',.008,.43);}
    else if(this.biome==='volcano')this.voice(68,time,1.6,.048,'sine',.15,0,37);
  }
  setBiome(biome:Biome){
    if(this.stopped)return;this.biome=biome;const [wind,water,rumble,frequency]=MOODS[biome];
    [wind,water,rumble].forEach((v,i)=>{this.beds[i].gain.gain.setTargetAtTime(v,this.ctx.currentTime,1.4);this.beds[i].depth.gain.setTargetAtTime(v*.28,this.ctx.currentTime,1.4);});this.beds[0].filter.frequency.setTargetAtTime(frequency,this.ctx.currentTime,1.2);
  }
  stop(){
    if(this.stopped)return;this.stopped=true;clearInterval(this.timer);const now=this.ctx.currentTime;this.bus.gain.cancelScheduledValues(now);this.bus.gain.setTargetAtTime(0,now,.055);
    for(const source of this.sources)try{source.stop(now+.26);}catch{/* A note may already have ended. */}
    window.setTimeout(()=>{this.bus.disconnect();this.wet.disconnect();},360);
  }
}
