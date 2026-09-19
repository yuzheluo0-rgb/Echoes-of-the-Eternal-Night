/** A Dijkstra frontier that reproduces `[...open].reduce((a,b) => costs.get(a) < costs.get(b) ? a : b)`
 *  exactly, but in O(log n) instead of O(n) per pop.
 *
 *  Two properties of the original are load-bearing and easy to get wrong:
 *
 *  1. `open` was a `Set`, so it iterated in insertion order, and `Set.add` on a member is a no-op
 *     that does not move it. Re-keying an id already in the frontier must therefore keep its
 *     original position; only an id that was popped and re-added moves to the back.
 *  2. `reduce` with a strict `<` returns `b` on a tie, so it selected the LAST minimum in iteration
 *     order — the id with the largest insertion sequence, not the smallest.
 *
 *  Both matter because the resulting `came` map decides where bridges are carved. Break ties the
 *  other way and the world is still deterministic but visibly different. */
export class MinCostQueue<T extends string> {
  private ids: T[] = [];
  private pos = new Map<T, number>();
  private costs = new Map<T, number>();
  private seq = new Map<T, number>();
  private tick = 0;

  private less(a: T, b: T) {
    const ca = this.costs.get(a)!, cb = this.costs.get(b)!;
    return ca !== cb ? ca < cb : this.seq.get(a)! > this.seq.get(b)!;
  }
  private swap(i: number, j: number) {
    const a = this.ids[i], b = this.ids[j];
    this.ids[i] = b; this.ids[j] = a;
    this.pos.set(b, i); this.pos.set(a, j);
  }
  private siftUp(i: number) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(this.ids[i], this.ids[parent])) break;
      this.swap(i, parent); i = parent;
    }
  }
  private siftDown(i: number) {
    for (;;) {
      const left = i * 2 + 1;
      if (left >= this.ids.length) break;
      const right = left + 1;
      const best = right < this.ids.length && this.less(this.ids[right], this.ids[left]) ? right : left;
      if (!this.less(this.ids[best], this.ids[i])) break;
      this.swap(i, best); i = best;
    }
  }
  get size() { return this.ids.length; }
  /** Settled distance, or undefined when the id has never been reached. Survives popping. */
  cost(id: T) { return this.costs.get(id); }
  /** Adds a new id at the back, or re-keys an id already in the frontier without moving it.
   *  The generator only ever relaxes downward, but re-sorting in both directions keeps the heap
   *  valid for any caller and is what lets the property test drive arbitrary operations. */
  set(id: T, cost: number) {
    const at = this.pos.get(id);
    if (at === undefined) {
      this.pos.set(id, this.ids.length); this.costs.set(id, cost); this.seq.set(id, this.tick++);
      this.ids.push(id); this.siftUp(this.ids.length - 1);
      return;
    }
    const previous = this.costs.get(id)!;
    this.costs.set(id, cost);
    if (cost < previous) this.siftUp(at); else this.siftDown(at);
  }
  pop(): T | undefined {
    if (!this.ids.length) return undefined;
    const top = this.ids[0];
    this.pos.delete(top);
    const last = this.ids.pop()!;
    if (this.ids.length) { this.ids[0] = last; this.pos.set(last, 0); this.siftDown(0); }
    return top;
  }
}
