export const CLOCK_KEY='eternal-night-world-clock-v1';
export const DAY_MINUTES=1440;
export const REAL_DAY_SECONDS=24*60;
export type TimeSpeed=1|3|6;
export type DayPhase='morning'|'noon'|'afternoon'|'dusk'|'night';
export const PHASES:Record<DayPhase,{name:string;hour:number;accent:string;description:string}>={
  morning:{name:'清晨',hour:7,accent:'#e9c5a0',description:'晨雾初散，长影向西'},
  noon:{name:'中午',hour:12,accent:'#f5d995',description:'日光高悬，万物明朗'},
  afternoon:{name:'下午',hour:15,accent:'#eac183',description:'暖阳西移，树影渐长'},
  dusk:{name:'傍晚',hour:18,accent:'#e2a6af',description:'霞光入海，灯火初醒'},
  night:{name:'夜晚',hour:22,accent:'#a9c2ed',description:'月色如水，循灯而行'},
};
export interface TimeSave{totalMinutes:number;speed:TimeSpeed;paused:boolean}
export interface TimeSnapshot{day:number;minute:number;phase:DayPhase;speed:TimeSpeed;paused:boolean;label:string}
export function minuteOfDay(total:number){return((total%DAY_MINUTES)+DAY_MINUTES)%DAY_MINUTES;}
export function phaseAt(total:number):DayPhase{
  const hour=minuteOfDay(total)/60;
  return hour<5||hour>=19.5?'night':hour<11?'morning':hour<13?'noon':hour<17?'afternoon':'dusk';
}
export function parseTime(raw:string|null):TimeSave{
  const defaults:TimeSave={totalMinutes:7*60,speed:1,paused:false};
  try{const value=JSON.parse(raw||'null');return{totalMinutes:typeof value?.totalMinutes==='number'&&Number.isFinite(value.totalMinutes)&&value.totalMinutes>=0&&value.totalMinutes<DAY_MINUTES*1000000?value.totalMinutes:defaults.totalMinutes,speed:[1,3,6].includes(value?.speed)?value.speed:1,paused:value?.paused===true};}catch{return defaults;}
}
/** Simulation time is independent of display frame rate and never catches up off-screen. */
export class WorldTime{
  private state:TimeSave;
  private view:TimeSnapshot;
  private listeners=new Set<()=>void>();
  constructor(state:TimeSave=parseTime(null)){this.state=parseTime(JSON.stringify(state));this.view=this.makeSnapshot();}
  get totalMinutes(){return this.state.totalMinutes;}
  getSave(){return{...this.state};}
  getSnapshot=()=>this.view;
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private makeSnapshot():TimeSnapshot{const minute=Math.floor(minuteOfDay(this.state.totalMinutes));return{day:Math.floor(this.state.totalMinutes/DAY_MINUTES)+1,minute,phase:phaseAt(this.state.totalMinutes),speed:this.state.speed,paused:this.state.paused,label:`${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`};}
  private publish(){const next=this.makeSnapshot();if(next.minute===this.view.minute&&next.day===this.view.day&&next.speed===this.view.speed&&next.paused===this.view.paused&&next.phase===this.view.phase)return;this.view=next;this.listeners.forEach(listener=>listener());}
  advance(seconds:number,suspended=false){if(suspended||this.state.paused||!Number.isFinite(seconds)||seconds<=0)return;this.state.totalMinutes+=seconds*DAY_MINUTES/REAL_DAY_SECONDS*this.state.speed;this.publish();}
  setSpeed(speed:TimeSpeed){if(![1,3,6].includes(speed))return;this.state.speed=speed;this.publish();}
  setPaused(paused:boolean){this.state.paused=paused;this.publish();}
  waitUntil(hour:number){if(!Number.isFinite(hour)||hour<0||hour>=24)return;const target=Math.floor(this.state.totalMinutes/DAY_MINUTES)*DAY_MINUTES+hour*60;this.state.totalMinutes=target>=this.state.totalMinutes?target:target+DAY_MINUTES;this.publish();}
}
