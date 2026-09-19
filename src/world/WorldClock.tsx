import {useEffect,useRef,useState,useSyncExternalStore,type CSSProperties} from 'react';
import {Moon,Sun,Sunrise,Sunset,Pause,Play,ChevronDown,X} from 'lucide-react';
import {PHASES,type DayPhase,type TimeSpeed,type WorldTime} from './WorldTime';
import './world-clock.css';

const ICONS={morning:Sunrise,noon:Sun,afternoon:Sun,dusk:Sunset,night:Moon};
export default function WorldClock({clock}:{clock:WorldTime}){
  const time=useSyncExternalStore(clock.subscribe,clock.getSnapshot),[open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),phase=PHASES[time.phase],Icon=ICONS[time.phase];
  useEffect(()=>{if(!open)return;const container=root.current;const outside=(e:PointerEvent)=>{if(!container?.contains(e.target as Node))setOpen(false);};const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();setOpen(false);trigger.current?.focus();}};document.addEventListener('pointerdown',outside);container?.addEventListener('keydown',escape);return()=>{document.removeEventListener('pointerdown',outside);container?.removeEventListener('keydown',escape);};},[open]);
  const progress=time.minute/1440;
  return <div ref={root} className={`world-clock ${open?'clock-open':''}`} style={{'--clock-accent':phase.accent} as CSSProperties}>
    <button ref={trigger} className="clock-face" aria-label={`世界时间：第 ${time.day} 日 ${time.label}，${phase.name}。打开时间设置`} aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(!open)}>
      <span className="clock-orbit" aria-hidden="true"><svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="19"/><circle className="clock-progress" cx="22" cy="22" r="19" strokeDasharray={`${progress*119.38} 119.38`}/></svg><Icon size={19} strokeWidth={1.45}/></span>
      <span className="clock-reading"><span className="clock-date">第 {String(time.day).padStart(2,'0')} 日 <i/> {phase.name}</span><span className="clock-hour">{time.label}<small>{time.paused?<Pause size={10}/>:time.speed===1?'时光流转':`${time.speed} 倍流速`}</small></span></span><ChevronDown className="clock-chevron" size={12}/>
    </button>
    {open&&<div className="clock-popover" role="dialog" aria-label="时间设置"><div className="clock-popover-heading"><span>日月轮转</span><button aria-label="关闭时间设置" onClick={()=>{setOpen(false);trigger.current?.focus();}}><X size={15}/></button></div><p>{phase.description}</p>
      <div className="clock-speed-row"><button className="clock-pause" aria-label={time.paused?'恢复时间流动':'暂停时间流动'} aria-pressed={time.paused} onClick={()=>clock.setPaused(!time.paused)}>{time.paused?<Play size={13}/>:<Pause size={13}/>}<span>{time.paused?'继续流转':'驻足此刻'}</span></button><div role="group" aria-label="时间流速">{([1,3,6] as TimeSpeed[]).map(speed=><button key={speed} aria-pressed={time.speed===speed} onClick={()=>clock.setSpeed(speed)}>{speed}×</button>)}</div></div>
      <span className="clock-wait-label">等到下一个时刻</span><div className="clock-phases">{(Object.keys(PHASES) as DayPhase[]).map(key=>{const item=PHASES[key],PhaseIcon=ICONS[key];return <button key={key} aria-label={`等到${item.name}`} onClick={()=>clock.waitUntil(item.hour)}><PhaseIcon size={17} strokeWidth={1.4}/><span>{item.name}</span><small>{String(item.hour).padStart(2,'0')}:00</small></button>;})}</div>
      <p className="clock-footnote">正常流速下，现实 24 分钟为游戏一天。<br/>离开页面时，时间会为你停留。</p>
    </div>}
  </div>;
}
