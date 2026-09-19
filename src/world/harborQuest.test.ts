import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSave,advanceJourney,MAIN_SITES,LANDMARKS,tileId,travelByBeacon,siteFootprint} from './worldData.ts';
import {acceptHarborProject,repairHarbor,HARBOR_STAGES,harborPosition} from './harborQuest.ts';

test('the abandoned harbor has nine cells and accepts its project only at the forecourt',()=>{
  assert.equal(siteFootprint('ocean').length,9);let save=parseSave(null);assert.equal(acceptHarborProject(save),save);
  save=advanceJourney(save,harborPosition());const accepted=acceptHarborProject(save);assert.deepEqual(accepted.harbor,{accepted:true,stage:0});assert.equal(acceptHarborProject(accepted),accepted);assert.equal(repairHarbor(accepted,0),accepted);
});
test('three harbor repairs require local attendance and supplies, change stage, and reward only once',()=>{
  let save=acceptHarborProject(advanceJourney(parseSave(null),harborPosition()));
  for(const [index,step]of HARBOR_STAGES.entries()){
    for(const target of step.targets){const site=LANDMARKS.find(s=>s.id===target.id)!;save=advanceJourney(save,tileId(site.q,site.r));}
    assert.equal(repairHarbor(save,index),save,'cannot repair remotely');save=advanceJourney(save,harborPosition());const before=save;
    save=repairHarbor(save,index);assert.equal(save.harbor.stage,index+1);assert.equal(save.embers,before.embers+step.embers);assert.equal(save.echoes,before.echoes+step.echoes);assert.equal(repairHarbor(save,index),save,'stale click cannot advance again');assert.deepEqual(parseSave(JSON.stringify(save)),save);
  }
  assert.equal(save.embers,13);assert.equal(save.echoes,4);assert.equal(repairHarbor(save,3),save);
  save=travelByBeacon({...save,embers:0},'camp');const returned=travelByBeacon(save,'ocean');assert.equal(returned.position,harborPosition());assert.equal(returned.embers,0,'completed harbor has free return even with no currency');
});
test('old and malformed saves migrate harbor state without awarding any rewards',()=>{
  const old=parseSave(JSON.stringify({embers:9,visited:['ocean']}));assert.deepEqual(old.harbor,{accepted:false,stage:0});assert.equal(old.embers,9);
  for(const stage of [-1,4,1.2,'3',null])assert.deepEqual(parseSave(JSON.stringify({visited:['ocean'],harbor:{accepted:true,stage}})).harbor,{accepted:true,stage:0});
  assert.deepEqual(parseSave(JSON.stringify({harbor:{accepted:true,stage:3}})).harbor,{accepted:false,stage:0});
  const notStarted=advanceJourney(parseSave(null),harborPosition());assert.equal(repairHarbor({...notStarted,visited:MAIN_SITES.map(s=>s.id)},0).harbor.stage,0);
});
