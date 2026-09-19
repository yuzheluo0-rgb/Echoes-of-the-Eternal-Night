import {MAIN_SITES,tileId,type WorldSave} from './worldData.ts';
import {isRegionOpen} from './worldRegions.ts';
export const HARBOR_PROJECT='让沉潮港再次呼吸';
export const HARBOR_STAGES=[
  {title:'重铺断港',description:'找回防潮木料与旧船索，修起主码头，扶正岸边的吊机。',targets:[{id:'side-forest',item:'防潮木料'},{id:'side-cliff',item:'旧船索'}],action:'修复码头与吊机',outcome:'断裂的栈桥重新接合，吊机已扶正。港口终于有了可以卸货的地方。',embers:2,echoes:0},
  {title:'重燃航灯',description:'将不灭炉芯与折光晶片送回港口，让海上的旅人重新看见这束光。',targets:[{id:'volcano',item:'耐潮炉芯'},{id:'crystal',item:'折光晶片'}],action:'点亮旧港航灯',outcome:'炉芯在灯室里苏醒，航灯与沿岸的窗灯再次亮起。',embers:0,echoes:1},
  {title:'唤回归帆',description:'带回旧航图与沉船的龙骨铭牌，修复船坞和归帆号，重启港湾。',targets:[{id:'fog',item:'雾海航图'},{id:'hidden-ocean',item:'龙骨铭牌'}],action:'重启船坞与归帆号',outcome:'归帆号重新浮起。沉潮旧港成为守夜人的免费归港信标，三条港口关卡可供探索。',embers:8,echoes:3},
] as const;
export const harborPosition=()=>{const site=MAIN_SITES.find(s=>s.id==='ocean')!;return tileId(site.q,site.r);};
export function acceptHarborProject(save:WorldSave):WorldSave {
  if(!isRegionOpen(save.regions,'ocean')||save.position!==harborPosition()||save.harbor.accepted)return save;
  return {...save,harbor:{accepted:true,stage:0}};
}
export function canRepairHarbor(save:WorldSave){const stage=HARBOR_STAGES[save.harbor.stage];return isRegionOpen(save.regions,'ocean')&&!!stage&&save.harbor.accepted&&save.position===harborPosition()&&stage.targets.every(target=>save.visited.includes(target.id));}
/** Expected stage makes repeated clicks idempotent even if supplies for later steps exist. */
export function repairHarbor(save:WorldSave,expectedStage:number):WorldSave {
  if(expectedStage!==save.harbor.stage||!canRepairHarbor(save))return save;
  const stage=HARBOR_STAGES[expectedStage];return {...save,harbor:{accepted:true,stage:expectedStage+1},embers:save.embers+stage.embers,echoes:save.echoes+stage.echoes};
}
