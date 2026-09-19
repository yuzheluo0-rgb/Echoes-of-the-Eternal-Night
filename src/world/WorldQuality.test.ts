import assert from 'node:assert/strict';
import test from 'node:test';
import { parseQuality, WorldRenderBudget } from './WorldQuality.ts';

function sample(budget: WorldRenderBudget, ms: number, start: number) {
  let changes = 0;
  for (let i = 0; i < 90; i++) if (budget.observe(ms, start + i * ms)) changes++;
  return changes;
}
test('saved quality is validated and manual modes do not drift under load', () => {
  assert.equal(parseQuality('high'), 'high'); assert.equal(parseQuality('performance'), 'performance');
  for (const raw of [null, '', 'broken', '{}']) assert.equal(parseQuality(raw), 'auto');
  for (const mode of ['high', 'performance'] as const) {
    const budget = new WorldRenderBudget(); budget.setMode(mode); const pixels = budget.pixels;
    assert.equal(sample(budget, 40, 20000), 0); assert.equal(budget.pixels, pixels);
  }
});
test('sustained slow frames reduce pixels within a floor without rapid resize oscillation', () => {
  const budget = new WorldRenderBudget(), initial = budget.pixels;
  assert.equal(sample(budget, 33, 0), 0, 'allow the scene to settle');
  assert.equal(sample(budget, 33, 5000), 1); assert.ok(budget.pixels < initial);
  const reduced = budget.pixels; assert.equal(sample(budget, 33, 8100), 0); assert.equal(budget.pixels, reduced);
  for (let i = 2; i < 15; i++) sample(budget, 45, i * 10000);
  assert.ok(budget.pixels >= 650000); assert.ok(budget.pixels < initial);
});
test('pauses discard stale timings and recovery requires sustained headroom', () => {
  const budget = new WorldRenderBudget(); sample(budget, 40, 5000); const reduced = budget.pixels;
  for (let i = 0; i < 80; i++) budget.observe(70, 10000 + i);
  budget.resetSamples(); for (let i = 0; i < 10; i++) assert.equal(budget.observe(16.7, 20000 + i), false);
  assert.equal(budget.pixels, reduced);
  for (let i = 0; i < 20; i++) sample(budget, 16.7, 30000 + i * 20000);
  assert.ok(budget.pixels > reduced); assert.ok(budget.pixels <= 1400000);
  assert.equal(budget.observe(2000, 999999), false, 'ignore a suspended tab gap');
});
