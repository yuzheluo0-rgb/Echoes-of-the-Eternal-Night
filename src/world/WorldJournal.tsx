import {BookOpen,Check,Flame,Sparkles} from 'lucide-react';
import {BIOMES,LANDMARKS,type WorldSave} from './worldData';
import {ENCOUNTERS} from './worldStories';
import {HarborJournal} from './WorldHarborQuest';

export default function WorldJournal({save,locate}:{save:WorldSave;locate:(id:string)=>void}){
 const quests=LANDMARKS.filter(s=>save.acceptedQuests.includes(s.id)),events=LANDMARKS.filter(s=>save.encounters[s.id]!==undefined);
 return <><HarborJournal save={save} locate={locate}/><div className="journal-stats"><span><Flame size={18}/><strong>{save.embers}</strong>烬火</span><span><Sparkles size={18}/><strong>{save.echoes}</strong>回声</span><span><BookOpen size={18}/><strong>{save.discovered.length}</strong>发现</span></div>
 <p className="journal-section-title">未完的约定 <span>{save.completedQuests.length} / {quests.length} 已完成</span></p>
 {!quests.length&&<p className="journal-empty">各地的药师、船夫和旅人都有自己的故事。抵达图志中的支线地点，听听他们的请求。</p>}
 <div className="journal-quests">{quests.map(site=><article key={site.id} className={save.completedQuests.includes(site.id)?'quest-complete':''}><div><strong>{site.quest!.title}</strong><span>{BIOMES[site.biome].name} · {save.completedQuests.includes(site.id)?'已完成':'进行中'}</span></div><p>{site.lore}</p><ul>{site.quest!.targets.map(id=><li key={id}><Check size={13}/><span className={save.visited.includes(id)?'objective-done':''}>{LANDMARKS.find(s=>s.id===id)!.name}</span><small>{save.visited.includes(id)?'已探访':'待探访'}</small></li>)}</ul><footer>纪念物 · {site.quest!.reward} {save.completedQuests.includes(site.id)?'已收录':'尚未获得'}</footer></article>)}</div>
 <p className="journal-section-title">路上的回声 <span>{events.length} 段奇遇</span></p>
 {!events.length&&<p className="journal-empty">留意树桩里的声音、海边的瓶信，以及没有名字的路标。靠近它们，新的故事会显现。</p>}
 <div className="journal-memories">{events.map(site=><article key={site.id}><Sparkles size={16}/><div><strong>{site.name}</strong><p>{ENCOUNTERS[site.biome].choices[save.encounters[site.id] as 0|1].outcome}</p></div></article>)}</div></>;
}
