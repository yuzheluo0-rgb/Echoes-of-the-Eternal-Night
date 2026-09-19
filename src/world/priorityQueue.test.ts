import test from 'node:test';
import assert from 'node:assert/strict';
import { MinCostQueue } from './priorityQueue.ts';

/** The loop the heap replaces, written out literally so the two can be compared op for op. */
class Reference {
  private frontier = new Set<string>();
  private costs = new Map<string, number>();
  cost(id: string) { return this.costs.get(id); }
  get size() { return this.frontier.size; }
  set(id: string, cost: number) { this.costs.set(id, cost); this.frontier.add(id); }
  pop(): string | undefined {
    let best: string | undefined;
    for (const id of this.frontier) if (best === undefined || !(this.costs.get(best)! < this.costs.get(id)!)) best = id;
    if (best === undefined) return undefined;
    this.frontier.delete(best);
    return best;
  }
}

test('pops in ascending cost', () => {
  const queue = new MinCostQueue<string>();
  queue.set('c', 30); queue.set('a', 10); queue.set('d', 40); queue.set('b', 20);
  assert.deepEqual([queue.pop(), queue.pop(), queue.pop(), queue.pop(), queue.pop()], ['a', 'b', 'c', 'd', undefined]);
});

test('breaks ties toward the most recently added, as the strict reduce did', () => {
  const queue = new MinCostQueue<string>();
  queue.set('a', 1); queue.set('b', 1); queue.set('c', 1);
  assert.deepEqual([queue.pop(), queue.pop(), queue.pop()], ['c', 'b', 'a']);
});

test('a settled cost survives popping and never counts as a reachable id again', () => {
  const queue = new MinCostQueue<string>();
  queue.set('a', 7); queue.pop();
  assert.equal(queue.cost('a'), 7);
  assert.equal(queue.size, 0);
});

test('relaxing an id already in the frontier keeps its place, matching Set.add', () => {
  const queue = new MinCostQueue<string>();
  queue.set('a', 1); queue.set('b', 1); queue.set('c', 1);
  queue.set('a', 1);
  assert.deepEqual([queue.pop(), queue.pop(), queue.pop()], ['c', 'b', 'a'], 'a must not jump the queue');
});

test('relaxing to a lower cost re-sorts the frontier', () => {
  const queue = new MinCostQueue<string>();
  queue.set('a', 1); queue.set('b', 9); queue.set('c', 5);
  queue.set('c', 0);
  assert.deepEqual([queue.pop(), queue.pop(), queue.pop()], ['c', 'a', 'b']);
});

test('matches the reference selection under random operations', () => {
  let seed = 20260919;
  const next = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return Math.floor(seed / 4294967296 * n); };
  const heap = new MinCostQueue<string>(), reference = new Reference();
  const ids = Array.from({ length: 12 }, (_, i) => 'n' + i);
  const seen: string[] = [], expected: string[] = [];
  for (let op = 0; op < 20000; op++) {
    if (next(3) === 0) {
      const a = heap.pop(), b = reference.pop();
      if (a !== b) assert.fail(`pop mismatch at op ${op}: heap=${a} reference=${b}`);
      if (a !== undefined) { seen.push(a); expected.push(b!); }
    } else {
      const id = ids[next(ids.length)], cost = next(50);
      heap.set(id, cost); reference.set(id, cost);
    }
    assert.equal(heap.size, reference.size, `size mismatch at op ${op}`);
  }
  assert.ok(seen.length > 1000, 'the run must actually pop a lot');
  assert.deepEqual(seen, expected);
});
