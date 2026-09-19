import test from 'node:test';
import assert from 'node:assert/strict';
import {WorldTime,parseTime,phaseAt,minuteOfDay,REAL_DAY_SECONDS,DAY_MINUTES} from './WorldTime.ts';

test('a day takes 24 real minutes at normal speed, independently of frame rate',()=>{
  const slow=new WorldTime(),fast=new WorldTime();
  for(let n=0;n<240;n++)slow.advance(.05);
  for(let n=0;n<1440;n++)fast.advance(1/120);
  assert.ok(Math.abs(slow.totalMinutes-fast.totalMinutes)<1e-7);
  const day=new WorldTime();day.advance(REAL_DAY_SECONDS);assert.equal(day.totalMinutes,7*60+DAY_MINUTES);assert.equal(day.getSnapshot().day,2);assert.equal(day.getSnapshot().label,'07:00');
});
test('all five named phases have defined boundaries including midnight',()=>{
  for(const [hour,phase]of [[0,'night'],[4.99,'night'],[5,'morning'],[10.99,'morning'],[11,'noon'],[12.99,'noon'],[13,'afternoon'],[16.99,'afternoon'],[17,'dusk'],[19.49,'dusk'],[19.5,'night'],[24,'night']] as const)assert.equal(phaseAt(hour*60),phase);
  assert.equal(minuteOfDay(-1),1439);assert.equal(minuteOfDay(1440),0);
});
test('waiting only moves forward and pauses or hidden time never advance the clock',()=>{
  const clock=new WorldTime();clock.waitUntil(22);assert.equal(clock.getSnapshot().day,1);assert.equal(clock.getSnapshot().label,'22:00');clock.waitUntil(7);assert.equal(clock.getSnapshot().day,2);assert.equal(clock.getSnapshot().label,'07:00');
  const before=clock.totalMinutes;clock.setPaused(true);clock.advance(100);assert.equal(clock.totalMinutes,before);clock.setPaused(false);clock.advance(100,true);assert.equal(clock.totalMinutes,before);
  clock.setSpeed(6);clock.advance(10);assert.equal(clock.totalMinutes,before+60);
  clock.advance(NaN);clock.advance(-100);clock.waitUntil(24);assert.equal(clock.totalMinutes,before+60);
  const fractional=new WorldTime({totalMinutes:421.0799999999999,speed:1,paused:false});
  for(const hour of [22,7,12,15,18]){fractional.advance(.013);fractional.waitUntil(hour);assert.equal(fractional.totalMinutes%1440,hour*60);assert.equal(fractional.getSnapshot().label,String(hour).padStart(2,'0')+':00');}
});
test('time saves validate and recover from malformed or out-of-range settings',()=>{
  for(const raw of ['bad','null','[]','{"totalMinutes":-8,"speed":20}'])assert.deepEqual(parseTime(raw),{totalMinutes:420,speed:1,paused:false});
  const clock=new WorldTime();clock.waitUntil(18);clock.setPaused(true);clock.setSpeed(3);assert.deepEqual(new WorldTime(parseTime(JSON.stringify(clock.getSave()))).getSnapshot(),clock.getSnapshot());
  assert.deepEqual(parseTime('{"totalMinutes":1e99,"speed":3,"paused":"yes"}'),{totalMinutes:420,speed:3,paused:false});
});
test('display subscribers update on minute or control changes, not every frame',()=>{
  const clock=new WorldTime();let calls=0;const original=clock.getSnapshot(),unsubscribe=clock.subscribe(()=>calls++);
  clock.advance(.2);assert.equal(clock.getSnapshot(),original);assert.equal(calls,0);clock.advance(.81);assert.equal(calls,1);clock.setPaused(true);assert.equal(calls,2);unsubscribe();clock.setSpeed(6);assert.equal(calls,2);
});
