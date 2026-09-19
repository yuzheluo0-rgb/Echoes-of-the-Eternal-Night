import {LANDMARKS,tileId,type Biome,type WorldSave} from './worldData.ts';
import {REGION_ORDER,isRegionOpen} from './worldRegions.ts';
import {phaseAt} from './WorldTime.ts';

export interface RegionChapter {biome:Biome;gate:string;title:string;condition:string;reason:string;action:string;kind:string;targets:string[]}
export const CHAPTERS:RegionChapter[]=[
  {biome:'swamp',gate:'camp',title:'一盏灯的誓言',condition:'在余烬营地立下守夜誓言。',reason:'营地的灯火驱散南方苔水上的第一重封印。',action:'立下誓言，开启沼泽',kind:'oath',targets:[]},
  {biome:'forest',gate:'swamp',title:'听懂苔水的低语',condition:'处理沼泽奇遇「芦苇中的低语」，再回苔泽钟楼敲响引路钟。',reason:'无论你选择交换还是援手，沼泽的旅人都会告诉你穿过幽林的方法。',action:'敲响引路钟，开启森林',kind:'encounter',targets:['event-swamp']},
  {biome:'ocean',gate:'forest',title:'林间的三枚印记',condition:'探访幽林圣所、森林支线和隐秘据点，集齐三枚林印。',reason:'林中人将交给你防潮木料的线索，以及通往南方旧港的潮汐路书。',action:'合拢林印，开启大海',kind:'pilgrimage',targets:['forest','side-forest','hidden-forest']},
  {biome:'desert',gate:'ocean',title:'与老船匠的约定',condition:'在沉潮旧港接下主线修复工程「让沉潮港再次呼吸」。',reason:'船匠把旧商路交给你。第一批线索沿东岸伸向沙海与熔炉；港口工程会伴随整段旅程。',action:'领取商路图，开启沙漠',kind:'project',targets:['ocean']},
  {biome:'volcano',gate:'desert',title:'沙碑上的无影之灯',condition:'在沙海遗迹解开古商路石碑的谜语。',reason:'正确的答案会唤醒通往东北火山的旧炉道；答错可以重新尝试。',action:'解开沙碑，开启火山',kind:'riddle',targets:[]},
  {biome:'blood',gate:'volcano',title:'寻回铸潮之印',condition:'亲自进入火山的隐秘据点，找到失落的铸潮之印。',reason:'旧锻炉留下的印记可以镇住猩红潮水，让北方祭桥重新承认来者。',action:'唤醒铸潮之印，开启血海',kind:'relic',targets:['hidden-volcano']},
  {biome:'snow',gate:'blood',title:'向月亮归还潮声',condition:'夜晚 19:30—04:59，在血潮祭坛举行月潮仪式。',reason:'借月潮冻结北向的浮桥，便能抵达霜冠雪线。可用时间面板等到夜晚。',action:'举行月潮仪式，开启雪山',kind:'night',targets:[]},
  {biome:'waste',gate:'snow',title:'六步穿过白色寂静',condition:'踏过六个不同的可行走雪山格，再回霜冠神殿提交勘路记录。',reason:'雪上的足迹拼出西北古王庭的位置，重复踏同一格不会增加进度。',action:'提交勘路记录，开启荒原',kind:'survey',targets:[]},
  {biome:'cliff',gate:'camp',title:'带着旧王的信物归来',condition:'抵达遗骨王庭取得旧王信物，再带回余烬营地。',reason:'长途北行终于与出发地相连。营地守灯人辨认出信物，为你打开西岸断崖的关隘；返回营地的信标始终免费。',action:'交还旧王信物，开启悬崖',kind:'delivery',targets:['waste']},
  {biome:'fog',gate:'cliff',title:'让哨钟重响',condition:'完成悬崖支线「重响的哨钟」，再回断崖哨塔修复雾海引路钟。',reason:'钟声穿过西岸雾墙，失落灯塔与岛间航路再次显现。',action:'敲响哨钟，开启雾海',kind:'quest',targets:['side-cliff','cliff','hidden-cliff']},
  {biome:'crystal',gate:'fog',title:'从旧港驶向星光',condition:'完成沉潮旧港第一阶段「重铺断港」，再到雾港灯塔领取星镜航图。',reason:'修好的码头让西南晶岛重新接入大陆。晶原的折光晶片，也正是继续修复旧港航灯所需的最后线索。',action:'展开星镜航图，开启晶原',kind:'restoration',targets:['ocean','side-forest','side-cliff']},
];
export const nextChapter=(save:WorldSave)=>CHAPTERS.find(c=>!isRegionOpen(save.regions,c.biome));
export interface GateRequirement {label:string;done:boolean;site?:string}
export function chapterRequirements(chapter:RegionChapter,save:WorldSave,totalMinutes:number):GateRequirement[]{
  const visited=(id:string,label?:string):GateRequirement=>({label:label||'探访'+LANDMARKS.find(s=>s.id===id)!.name,done:save.visited.includes(id),site:id});
  switch(chapter.kind){
    case 'oath':return[{label:'将营地的灯火带向远方',done:true}];
    case 'encounter':return[{label:'处理芦苇中的低语（任一选择）',done:save.encounters['event-swamp']!==undefined,site:'event-swamp'}];
    case 'pilgrimage':return chapter.targets.map(id=>visited(id));
    case 'project':return[{label:'接下沉潮旧港修复工程',done:save.harbor.accepted,site:'ocean'}];
    case 'riddle':return[{label:'回答石碑谜语（无需消耗资源）',done:true}];
    case 'relic':return[visited('hidden-volcano','取得隐秘锻炉中的铸潮之印')];
    case 'night':return[{label:'此刻为夜晚 · 19:30—04:59',done:phaseAt(totalMinutes)==='night'}];
    case 'survey':return[{label:`记录不同雪山格 · ${save.regions.snowTrail.length} / 6`,done:save.regions.snowTrail.length>=6}];
    case 'delivery':return[visited('waste','从遗骨王庭取回旧王信物')];
    case 'quest':return[{label:'完成重响的哨钟',done:save.completedQuests.includes('side-cliff'),site:'side-cliff'},...['cliff','hidden-cliff'].map(id=>visited(id))];
    case 'restoration':return[{label:'沉潮旧港 · 码头与吊机已修复',done:save.harbor.stage>=1,site:'ocean'}];
    default:return[];
  }
}
export const atChapterGate=(chapter:RegionChapter,save:WorldSave)=>{const site=LANDMARKS.find(s=>s.id===chapter.gate)!;return save.position===tileId(site.q,site.r);};
/** Check order, presence and the actual world clock again at commit time. */
export function unlockRegion(save:WorldSave,biome:Biome,totalMinutes:number,answer?:string):WorldSave{
  const chapter=nextChapter(save);
  if(!chapter||chapter.biome!==biome||!atChapterGate(chapter,save)||!chapterRequirements(chapter,save,totalMinutes).every(r=>r.done)||chapter.kind==='riddle'&&answer!=='ember')return save;
  return {...save,embers:save.embers+1,regions:{...save.regions,unlocked:REGION_ORDER.slice(0,save.regions.unlocked.length+1)}};
}
