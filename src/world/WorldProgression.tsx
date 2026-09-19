import {useState,useSyncExternalStore} from 'react';
import {ArrowRight,Check,Compass,Flame,Lock,MapPin,Moon,Unlock} from 'lucide-react';
import {BIOMES,LANDMARKS,type Biome,type WorldSave} from './worldData';
import {REGION_ORDER,isRegionOpen} from './worldRegions';
import {CHAPTERS,atChapterGate,chapterRequirements,nextChapter,type RegionChapter} from './worldProgression';
import type {WorldTime} from './WorldTime';
import './world-progression.css';

interface GateProps {chapter:RegionChapter;save:WorldSave;clock:WorldTime;locate:(id:string)=>void;unlock:(biome:Biome,answer?:string)=>void}
export function RegionGate({chapter,save,clock,locate,unlock}:GateProps){
  const now=useSyncExternalStore(clock.subscribe,clock.getSnapshot);
  const [answer,setAnswer]=useState(''),[wrong,setWrong]=useState(false);
  const next=nextChapter(save),active=next?.biome===chapter.biome,open=isRegionOpen(save.regions,chapter.biome),local=atChapterGate(chapter,save);
  const gate=LANDMARKS.find(s=>s.id===chapter.gate)!,requirements=chapterRequirements(chapter,save,now.minute),ready=requirements.every(r=>r.done);
  return <section className={`region-gate ${open?'gate-complete':''}`} aria-label={`${BIOMES[chapter.biome].name}解锁条件`}>
    <div className="gate-heading"><span className="gate-sigil">{open?<Unlock size={23}/>:<Lock size={23}/>}</span><div><p>开拓之路 · {String(REGION_ORDER.indexOf(chapter.biome)+1).padStart(2,'0')} / 12</p><h3>{chapter.title}</h3></div><span className="gate-state">{open?'已开启':active?'下一片风土':'封印中'}</span></div>
    <p className="gate-condition">{chapter.condition}</p><p className="gate-story">{chapter.reason}</p>
    {!open&&<><ul className="gate-checklist">{requirements.map((req,i)=><li key={i} className={req.done?'is-done':''}><Check size={17}/><span>{req.label}</span>{req.site&&isRegionOpen(save.regions,LANDMARKS.find(s=>s.id===req.site)!.biome)&&<button aria-label={'定位'+LANDMARKS.find(s=>s.id===req.site)!.name} onClick={()=>locate(req.site!)}><MapPin size={15}/><span>定位</span></button>}</li>)}</ul>
    {!active&&<p className="gate-prerequisite"><Lock size={15}/>需先完成前序章节。当前目标：{next?.title}</p>}
    {active&&chapter.kind==='riddle'&&local&&<fieldset className="gate-riddle"><legend>「王冠终将蒙尘，月亮终将隐去。<br/>长夜之后，哪一物仍能重新燃起？」</legend><div>{[['crown','金冠'],['ember','余烬'],['moon','月影']].map(([id,label])=><button key={id} aria-pressed={answer===id} onClick={()=>{setAnswer(id);setWrong(false);}}>{label}</button>)}</div>{wrong&&<p role="status">石碑没有回应。想想你从哪里出发，以及灯火为何还能延续。</p>}</fieldset>}
    {active&&chapter.kind==='night'&&local&&!ready&&<button className="world-secondary gate-wait" onClick={()=>clock.waitUntil(22)}><Moon size={17}/>在此候至夜晚</button>}
    <div className="gate-actions">{active&&local?<button className="world-primary" disabled={!ready||chapter.kind==='riddle'&&!answer} onClick={()=>{if(chapter.kind==='riddle'&&answer!=='ember'){setWrong(true);return;}unlock(chapter.biome,answer);}}><Flame size={17}/>{chapter.action}<ArrowRight size={17}/></button>:<button className="world-secondary" onClick={()=>locate(active?chapter.gate:next!.gate)}><Compass size={17}/>{active?'前往'+gate.name+'完成解锁':'追踪当前开拓目标'}<ArrowRight size={17}/></button>}</div>
    <p className="gate-footnote">{active&&local?'点亮信标后，烬火 +1。':`完成地点 · ${gate.name}`} 开启后，本区域的关卡、支线与隐秘据点均可探索。</p></>}
  </section>;
}

export function WorldRoute({save,inspect,locate}:{save:WorldSave;inspect:(biome:Biome)=>void;locate:(id:string)=>void}){
  const next=nextChapter(save);
  return <><div className="route-intro"><Compass size={29}/><div><strong>{save.regions.unlocked.length} <span>/ 12 片风土已开启</span></strong><p>从一簇余烬出发，经南岸、东境、北冠与西海，将大陆的灯火连成一线。</p></div></div>
  <div className="region-route">{REGION_ORDER.map((biome,index)=>{const chapter=CHAPTERS.find(c=>c.biome===biome),site=LANDMARKS.find(s=>s.kind==='main'&&s.biome===biome)!,open=isRegionOpen(save.regions,biome),active=next?.biome===biome;return <button key={biome} className={`route-chapter ${open?'is-open':''} ${active?'is-next':''}`} onClick={()=>open?locate(site.id):inspect(biome)}><span className="route-node">{open?<Check size={17}/>:active?<Flame size={17}/>:<Lock size={16}/>}</span><span className="route-copy"><span className="route-region">{String(index+1).padStart(2,'0')} · {BIOMES[biome].name}<small>{open?'已开启':active?'下一站':'封印中'}</small></span><strong>{site.name}</strong><span>{chapter?.condition||'最初的灯火。营地与周围草原可以自由探索。'}</span></span><ArrowRight size={16}/></button>;})}</div>
  {!next&&<p className="route-finale"><Flame size={21}/>大陆的十二道封印已解除。继续完成旧港工程，让航灯照亮你的归途。</p>}</>;
}
