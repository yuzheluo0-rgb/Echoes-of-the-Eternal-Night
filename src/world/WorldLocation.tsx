import {useState,type CSSProperties} from 'react';
import {ArrowLeft,ArrowRight,Check,ChevronRight,Flag,Flame,Sparkles} from 'lucide-react';
import {sound} from '../audio';
import {BIOMES,LANDMARKS,acceptSideQuest,resolveEncounter,type Landmark,type WorldSave} from './worldData';
import {ENCOUNTERS} from './worldStories';
import WorldHarborQuest from './WorldHarborQuest';

export default function WorldLocation({site,save,update,close,notify,audioOn,locate}:{site:Landmark;save:WorldSave;update:(next:WorldSave)=>void;close:()=>void;notify:(text:string)=>void;audioOn:boolean;locate:(id:string)=>void}){
 const [missionIndex,setMissionIndex]=useState(0);
 const completed=save.completedQuests.includes(site.id),accepted=save.acceptedQuests.includes(site.id);
 if(site.id==='ocean'&&save.harbor.stage<3)return <WorldHarborQuest save={save} update={update} close={close} notify={notify} audioOn={audioOn} locate={locate}/>;
 return <><div className="site-dialog-banner" style={{'--biome':BIOMES[site.biome].color} as CSSProperties}><Flag size={26}/><span>{site.id==='ocean'?'港口已复苏':site.kind==='hidden'?'发现隐秘据点':site.kind==='event'?'路边的奇遇':'你已抵达'} · {BIOMES[site.biome].name}</span><p>{site.id==='ocean'?'归帆号轻轻触碰码头，旧港的航灯再次照亮潮水。修复工程已完成，你可以免费返回这座港口，继续探索港口的三条关卡。':site.lore}</p></div>
 {site.quest?<>
   <div className="mission-heading"><span>{site.quest.title}</span><small>{site.quest.npc}</small></div>
   <div className="quest-objectives">{site.quest.targets.map(id=><div key={id} className={save.visited.includes(id)?'objective-done':''}><Check size={15}/><span>探访{LANDMARKS.find(s=>s.id===id)!.name}</span><small>{save.visited.includes(id)?'已完成':'待探访'}</small></div>)}</div>
   <p className="quest-reward"><Sparkles size={15}/>纪念物 · {site.quest.reward}<span>烬火 +4</span></p>
   <div className="mission-actions"><button className="world-secondary" onClick={close}><ArrowLeft size={15}/>继续探索</button><button className="world-primary" disabled={accepted} onClick={()=>{update(acceptSideQuest(save,site.id));sound('bell',audioOn);notify('已接取「'+site.quest!.title+'」，线索已记入旅途手记。');}}><Flag size={15}/>{completed?'支线已完成':accepted?'已记入手记':'接取支线'}<ArrowRight size={16}/></button></div>
 </>:site.kind==='event'?<>
   {save.encounters[site.id]!==undefined?<div className="encounter-resolved"><Sparkles size={24}/><p>{ENCOUNTERS[site.biome].choices[save.encounters[site.id] as 0|1].outcome}</p><small>这段奇遇已经收录在旅途手记中。</small></div>:<div className="encounter-choices">{ENCOUNTERS[site.biome].choices.map((choice,index)=><button key={choice.label} className="mission-card" disabled={save.embers+choice.embers<0} onClick={()=>{update(resolveEncounter(save,site.id,index));sound('bell',audioOn);notify(choice.outcome);}}><span className="mission-number">{index===0?'I':'II'}</span><span><strong>{choice.label}</strong><small>{choice.embers?`烬火 ${choice.embers>0?'+':''}${choice.embers}`:''}{choice.echoes?` 回声 +${choice.echoes}`:''}</small></span><ChevronRight size={16}/></button>)}</div>}
   <div className="mission-actions"><button className="world-secondary" onClick={close}><ArrowLeft size={15}/>继续探索</button><span className="encounter-wallet"><Flame size={14}/>{save.embers} 烬火 · {save.echoes} 回声</span></div>
 </>:<>
   <div className="mission-heading"><span>{site.kind==='hidden'?'揭开此地的秘密':'选择此地的关卡'}</span><small>{site.difficulty}</small></div>
   <div className="world-missions">{site.levels.map((level,i)=><button key={level} className={`mission-card ${missionIndex===i?'mission-active':''}`} onClick={()=>{setMissionIndex(i);sound('select',audioOn);}} aria-pressed={missionIndex===i}><span className="mission-number">{['I','II','III'][i]}</span><span><strong>{level}</strong><small>{['探索 · 普通遭遇','深入 · 精英挑战','终章 · 首领关卡'][i]}</small></span>{missionIndex===i?<Check size={17}/>:<ChevronRight size={17}/>}</button>)}</div>
   <p className="dialog-footnote">选定后会记入旅程，你可以继续探索主世界。</p>
   <div className="mission-actions"><button className="world-secondary" onClick={close}><ArrowLeft size={15}/>继续探索</button><button className="world-primary" onClick={()=>{const mission=site.levels[missionIndex];update({...save,mission});notify('已选定「'+mission+'」，旅程目标已记录。');sound('bell',audioOn);close();}}><Flag size={15}/>选择关卡<ArrowRight size={16}/></button></div>
 </>}</>;
}
