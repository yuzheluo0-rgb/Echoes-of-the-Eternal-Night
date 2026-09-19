import {Anchor,ArrowLeft,ArrowRight,Check,Compass,Hammer,Sparkles} from 'lucide-react';
import {LANDMARKS,type WorldSave} from './worldData';
import {HARBOR_PROJECT,HARBOR_STAGES,acceptHarborProject,canRepairHarbor,repairHarbor} from './harborQuest';
import {sound} from '../audio';
import './world-harbor.css';

export function HarborJournal({save,locate}:{save:WorldSave;locate?:(id:string)=>void}){
  if(!save.harbor.accepted)return null;
  return <section className="harbor-journal"><p className="harbor-eyebrow"><Anchor size={17}/>主世界 · 修复工程</p><h3>{HARBOR_PROJECT}</h3><p>{save.harbor.stage===3?'航灯重燃，归帆归来。旧港已成为可以免费返回的家园。':`当前工程：${HARBOR_STAGES[save.harbor.stage].title} · ${save.harbor.stage}/3 已完成`}</p>{locate&&<button className="world-secondary" onClick={()=>locate('ocean')}><Compass size={17}/>查看沉潮旧港<ArrowRight size={17}/></button>}</section>;
}
export default function WorldHarborQuest({save,update,close,notify,audioOn,locate}:{save:WorldSave;update:(s:WorldSave)=>void;close:()=>void;notify:(s:string)=>void;audioOn:boolean;locate:(id:string)=>void}){
  const stage=HARBOR_STAGES[save.harbor.stage];
  return <><div className="harbor-story"><span className="harbor-seal"><Anchor size={37} strokeWidth={1}/></span><div><p className="harbor-eyebrow">主世界修复工程 · 9 格旧港</p><h3>{HARBOR_PROJECT}</h3><p>断桥伸进墨色潮水，归帆号的桅杆仍指向天空。老船匠守在废弃的仓库前：“若还有人记得回家的路，这里就不算死去。”</p></div></div>
    <ol className="harbor-stages">{HARBOR_STAGES.map((s,i)=><li key={s.title} className={i<save.harbor.stage?'harbor-done':i===save.harbor.stage?'harbor-current':''}><span>{i<save.harbor.stage?<Check size={17}/>:String(i+1).padStart(2,'0')}</span><strong>{s.title}</strong></li>)}</ol>
    {!save.harbor.accepted?<><p className="dialog-intro">从码头到航灯，再到重新浮起的归帆号。接受工程后，走访各地寻找愿意帮忙的人；已有的探访也会计入援助。每次完成准备后，回港主持修复。</p><div className="harbor-rewards"><Sparkles size={18}/><span>最终解锁：免费归港信标、港口关卡、烬火与回声奖励</span></div><div className="mission-actions"><button className="world-secondary" onClick={close}><ArrowLeft size={17}/>继续探索</button><button className="world-primary" onClick={()=>{update(acceptHarborProject(save));sound('bell',audioOn);notify('修复工程已记入旅途手记：'+HARBOR_PROJECT);}}><Hammer size={18}/>接下修复工程<ArrowRight size={18}/></button></div></>:<>
    <div className="mission-heading"><span>{stage.title}</span><small>老船匠的委托 · 第 {save.harbor.stage+1} 阶段</small></div><p className="dialog-intro">{stage.description}</p><div className="harbor-supplies">{stage.targets.map(target=>{const site=LANDMARKS.find(s=>s.id===target.id)!,done=save.visited.includes(target.id);return <div key={target.id} className={done?'supply-ready':''}><span className="supply-check">{done?<Check size={18}/>:<Compass size={18}/>}</span><div><strong>{target.item}</strong><p>{done?'已取得援助':'探访'} · {site.name}</p></div><button onClick={()=>locate(target.id)} aria-label={`定位${site.name}`}>{done?'重访':'定位'}<ArrowRight size={15}/></button></div>;})}</div>
    <p className="dialog-footnote">援助随探访取得，不额外扣除烬火。修复后，地图上的码头、航灯与船只会逐步改变。</p><div className="mission-actions"><button className="world-secondary" onClick={close}><ArrowLeft size={17}/>继续探索</button><button className="world-primary" disabled={!canRepairHarbor(save)} onClick={()=>{const next=repairHarbor(save,save.harbor.stage);if(next===save)return;update(next);sound('bell',audioOn);notify(stage.outcome);close();}}><Hammer size={18}/>{stage.action}<ArrowRight size={18}/></button></div></>}
  </>;
}
