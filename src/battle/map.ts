/**
 * 爬塔地图 — the chapter as a tower you climb, rather than five fights in a row.
 *
 * The shape is Slay the Spire's, and deliberately so: seven columns, six routes threading upward from
 * the bottom, each route allowed to shift at most one column per floor. Six routes crossing a
 * seven-wide grid is what produces the thing that actually matters — **a map where two players'
 * runs look different and neither can walk every node**.
 *
 * THREE RULES CARRY THE WHOLE DESIGN, and all three are the reference game's:
 *
 *   1. **The row sets the difficulty band, not the node.** The bottom of the tower is fights, the
 *      middle starts offering chests and elites, the top starts offering campfires, and the row
 *      under the boss is always campfires. A player learns the grammar once and can read any map at
 *      a glance — while two routes up the same tower still meet their campfire at different heights.
 *   2. **No two of the same non-combat thing back to back.** Two elites in a row is a death sentence
 *      the player could not have avoided; two campfires is a power spike they did not earn.
 *   3. **A node says what *kind* of thing it is and nothing more.** Which fight stands there is
 *      rolled when the player walks in (`run.ts`'s `encounterFor`), never here — the map is a set of
 *      decisions rather than a list of spoilers, and the same floor is a different fight in a
 *      different run. This file deliberately puts no encounter on a node; `map.test.ts` pins that.
 *      The counts and the monsters' 生命 roll at battle start, off their own stream.
 *
 * Everything here is a pure function of the seed. No `Math.random`, same as everywhere else in
 * `src/battle/**`.
 */


/**
 * Node rows, 1 at the bottom. The boss sits on its own row above these.
 *
 * Sixteen, matching the reference game's fifteen-plus-a-boss closely enough that its pacing numbers
 * transfer. Twelve was a tower you could read in one screenful and it was over before a deck had a
 * shape; the four extra rows are what the middle bands needed to hold a second campfire.
 */
export const MAP_ROWS = 16;
export const MAP_COLS = 7;
export const BOSS_ROW = MAP_ROWS + 1;
/** The column the boss stands in. Middle of the grid, so no route has to bend to reach it. */
export const BOSS_COL = 3;
/** How many routes thread the tower. One column is left with no starting node, as in the original. */
export const ROUTES = 6;
/** A node may carry at most this many routes into it, which is what keeps the tower from bunching. */
const MAX_INCOMING = 3;

export type NodeKind = 'combat' | 'elite' | 'event' | 'rest' | 'treasure' | 'boss';

/** The kinds that may not appear twice in a row along a route. Combat and events are exempt. */
const NO_REPEAT: NodeKind[] = ['elite', 'rest', 'treasure'];

export interface MapNode {
  id: string;
  row: number;
  col: number;
  kind: NodeKind;
  /** Nodes on the row above that can be reached from here. */
  next: string[];
}

/**
 * How far ahead the map is legible.
 *
 * The tower knows every node's kind from the moment it is laid down; the *player* sees this many
 * rows beyond where they stand and nothing further, so climbing is a process of the shape resolving
 * rather than of reading a finished diagram. Two rows is enough to make the next choice informed and
 * short enough that the one after it is still a guess.
 */
export const REVEAL_AHEAD = 2;

/** The highest row the player can currently read. Row 0 while still at the bottom. */
export function revealedThrough(map: TowerMap, at: string | undefined): number {
  const row = at ? (map.byId.get(at)?.row ?? 0) : 0;
  return Math.min(BOSS_ROW, row + REVEAL_AHEAD);
}

/** Is this node's kind visible from where the run is standing? */
export function isRevealed(map: TowerMap, at: string | undefined, id: string): boolean {
  const node = map.byId.get(id);
  if (!node) return false;
  // What you can step on is always legible, however far ahead the rule would otherwise hide it.
  if (reachableFrom(map, at).includes(id)) return true;
  return node.row <= revealedThrough(map, at);
}

export interface TowerMap {
  seed: number;
  nodes: MapNode[];
  byId: Map<string, MapNode>;
  /** Every node on the bottom row. A run starts with a free choice between these. */
  startIds: string[];
  bossId: string;
}

const nodeId = (row: number, col: number) => `n${row}-${col}`;

/** The map's own stream. Same LCG as the engine's, seeded apart so a map never perturbs a fight. */
function stream(seed: number) {
  let state = (Math.imul(seed >>> 0, 0x9e3779b1) ^ 0x85ebca6b) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const pick = <T,>(roll: () => number, items: readonly T[]): T => items[Math.floor(roll() * items.length)];

/**
 * Which kinds a **band** of rows may hold, weighted by repetition.
 *
 * Bands rather than per-row rules. Locking "row 8 is always a chest" made every map readable at a
 * glance and every map the same; a band says the middle of the tower *tends* to hold a chest, and
 * two routes up the same tower can meet theirs at different heights. The pacing survives — the
 * bottom is still almost all fights, because a deck is still being built — but the shape does not.
 *
 * ⚠️ **`rest` was missing from every band until the tower grew to sixteen rows**, so the only
 * campfire a run could ever reach was the guaranteed one under the boss — and a route whose
 * pre-boss node happened to be the odd event out climbed the whole tower without resting. Measured
 * over 200 seeds: 25.2% of routes got zero campfires, the rest got exactly one, mean 0.75.
 *
 * The weights are the reference game's own. Slay the Spire rolls roughly 12% rest / 8% elite over
 * the floors where either is legal, which works out to about two rests per route — one rolled, one
 * guaranteed before the boss. So rest appears in the upper bands, and each of them weights it about
 * one part in seven, which lands on the same mean.
 *
 * The last row is the exception and is handled on its own below.
 */
function bandFor(row: number): NodeKind[] {
  if (row <= 3) return ['combat', 'combat', 'combat', 'combat', 'event'];
  if (row <= 6) return ['combat', 'combat', 'combat', 'event', 'elite'];
  if (row <= 10) return ['combat', 'combat', 'combat', 'combat', 'event', 'elite', 'treasure', 'rest'];
  return ['combat', 'combat', 'combat', 'elite', 'event', 'treasure', 'rest'];
}

/**
 * The row before the boss is **exactly one event and the rest campfires**, not a weighted roll.
 *
 * The brief is a ratio — 「四条线路有三条是营火，另一条为未知事件」 — and a 3:1 weight over four nodes
 * gives two events one time in four. Which node is the odd one out is still the seed's business, so
 * the choice of *which* route ends on a question is the map's, while the promise that only one does
 * is the design's.
 */
function assignLastRow(nodes: MapNode[], roll: () => number) {
  if (!nodes.length) return;
  const odd = Math.floor(roll() * nodes.length);
  nodes.forEach((node, index) => { node.kind = index === odd ? 'event' : 'rest'; });
}

/** Rows where an elite is allowed at all. This is the explicit floor the reference game uses — no
 *  elites in the opening stretch, while a deck is still being built. */
const FIRST_ELITE_ROW = 6;

/**
 * The same floor for campfires, and deliberately the same number.
 *
 * The reference game unlocks elites and rest sites on the same floor, and the reason holds here: the
 * first five rows are where the deck gets built, and a campfire landing in the middle of that is a
 * choice the player has no information to make yet — 打磨 a card you have not drawn, or heal damage
 * you have not taken. Above the opening stretch both become real decisions.
 */
const FIRST_REST_ROW = 6;

/**
 * Whether a campfire is legal on this row at all — the opening stretch is too early, and the row
 * under the boss is too late.
 *
 * ⚠️ **The too-late half is a fix, and it was a live bug the moment `rest` joined the bands.** The
 * last row is campfires for everyone (see `assignLastRow`), and it is assigned *before* the main loop
 * runs — but `NO_REPEAT` only ever compares a node against its predecessors, i.e. the row below. So a
 * row-15 node could not see the campfire already sitting above it, and a route could sit down twice
 * in a row. It stayed hidden only because `rest` was absent from every band, so rows 11 and 12 never
 * met; growing the tower and putting `rest` in the bands is what made it reachable. Seed 1 caught it.
 *
 * The reference game has the identical rule, for the identical reason: its last floor is all rest
 * sites, and it forbids a rest site on the floor directly beneath.
 */
const restAllowedOn = (row: number) => row >= FIRST_REST_ROW && row !== MAP_ROWS - 1;

/**
 * Build the tower.
 *
 * Routes are walked first and the nodes they touch become the map, which is why a tower has holes in
 * it — a column no route needed simply has nothing on that row, and the gaps are what make the
 * branch structure readable.
 */
export function generateMap(seed: number): TowerMap {
  const roll = stream(seed);

  // --- the routes ----------------------------------------------------------------
  const columns = [0, 1, 2, 3, 4, 5, 6];
  // Fisher–Yates with the map's own stream, so the starting columns differ per seed.
  for (let i = columns.length - 1; i > 0; i--) {
    const j = Math.floor(roll() * (i + 1));
    [columns[i], columns[j]] = [columns[j], columns[i]];
  }

  const edges = new Map<string, Set<string>>();
  const touched = new Set<string>();
  /** How many routes have arrived at each node. The cap of three is what keeps the tower spread out. */
  const incoming = new Map<string, number>();
  const link = (from: string, to: string) => {
    if (!edges.has(from)) edges.set(from, new Set());
    edges.get(from)!.add(to);
  };
  const arrive = (id: string) => {
    touched.add(id);
    incoming.set(id, (incoming.get(id) ?? 0) + 1);
  };

  for (const start of columns.slice(0, ROUTES)) {
    let col = start;
    arrive(nodeId(1, col));
    for (let row = 1; row < MAP_ROWS; row++) {
      const from = nodeId(row, col);
      // Up-left, up, or up-right — tried in a random order, and the first one that is not already
      // carrying three routes wins. This is the rule that stops four routes collapsing into one
      // column by the middle of the tower, which is what happened before it was here: the seed-42
      // map had two nodes left on row 5 and the branching was over by the halfway point.
      const options = [col - 1, col, col + 1].filter(next => next >= 0 && next < MAP_COLS);
      for (let i = options.length - 1; i > 0; i--) {
        const j = Math.floor(roll() * (i + 1));
        [options[i], options[j]] = [options[j], options[i]];
      }
      let landed: number | undefined;
      for (const next of options) {
        if ((incoming.get(nodeId(row + 1, next)) ?? 0) >= MAX_INCOMING) continue;
        landed = next;
        break;
      }
      // Every option is full. Go to the *least loaded* one rather than straight up: always taking
      // the same escape piled six routes onto a single node and left the tower lopsided, whereas
      // spreading the overflow keeps any node at most one over the cap. A route is never allowed to
      // break — a slightly over-subscribed node is a far smaller problem than a stranded column.
      col = landed ?? options.reduce((best, next) =>
        (incoming.get(nodeId(row + 1, next)) ?? 0) < (incoming.get(nodeId(row + 1, best)) ?? 0) ? next : best,
      options[0]);
      link(from, nodeId(row + 1, col));
      arrive(nodeId(row + 1, col));
    }
  }

  // Every route ends on its own row-12 node; all of them lead to the one boss.
  const bossId = nodeId(BOSS_ROW, BOSS_COL);
  for (const id of touched) {
    if (id.startsWith(`n${MAP_ROWS}-`)) link(id, bossId);
  }
  touched.add(bossId);

  // --- the kinds ----------------------------------------------------------------
  const nodes: MapNode[] = [...touched].map(id => {
    const [row, col] = id.slice(1).split('-').map(Number);
    return { id, row, col, kind: 'combat' as NodeKind, next: [] as string[] };
  });
  const byId = new Map(nodes.map(node => [node.id, node]));

  // Predecessors, so the no-repeat rule can be checked while walking upward.
  const from = new Map<string, string[]>();
  for (const [source, targets] of edges) {
    for (const target of targets) {
      if (!from.has(target)) from.set(target, []);
      from.get(target)!.push(source);
    }
  }

  // How many of each non-combat kind this row has already spent. Without this, seed 42 rolls four
  // events across rows 3 and 4 and the player climbs five floors without drawing a card.
  const spent = new Map<number, Partial<Record<NodeKind, number>>>();
  // `rest` is capped for the same reason it is in the reference game: the no-repeat rule only looks
  // *down* a route, so nothing else stops a wide row from rolling three campfires side by side. Two
  // is a row that got lucky; three is a power spike nobody earned.
  const ROW_CAP: Partial<Record<NodeKind, number>> = { event: 2, elite: 2, rest: 2 };

  // The last row is assigned as a whole, because its rule is a ratio across the row rather than a
  // choice per node.
  assignLastRow(nodes.filter(node => node.row === MAP_ROWS), roll);

  for (const node of nodes.sort((a, b) => a.row - b.row)) {
    if (node.id === bossId) { node.kind = 'boss'; continue; }
    if (node.row === 1) { node.kind = 'combat'; continue; }
    if (node.row === MAP_ROWS) continue;   // already settled above

    const used = spent.get(node.row) ?? {};
    const allowed = bandFor(node.row).filter(kind =>
      (kind !== 'elite' || node.row >= FIRST_ELITE_ROW)
      && (kind !== 'rest' || restAllowedOn(node.row))
      && (used[kind] ?? 0) < (ROW_CAP[kind] ?? Infinity));
    // Rule 2: never the same restricted kind as anything directly below. Tried a few times before
    // giving up and taking a plain fight, which is always legal.
    let kind: NodeKind = 'combat';
    for (let attempt = 0; attempt < 6; attempt++) {
      const candidate = pick(roll, allowed);
      const blocked = NO_REPEAT.includes(candidate)
        && (from.get(node.id) ?? []).some(source => byId.get(source)?.kind === candidate);
      if (!blocked) { kind = candidate; break; }
    }
    node.kind = kind;
    used[kind] = (used[kind] ?? 0) + 1;
    spent.set(node.row, used);
  }

  // Deliberately **no encounter here.** A floor says what *kind* of thing it is and nothing else,
  // and the fight itself is rolled when the player walks in — so the map is a set of decisions
  // rather than a list of spoilers, and the same floor is a different fight in a different run.
  for (const node of nodes) node.next = [...(edges.get(node.id) ?? [])].sort();

  const startIds = nodes.filter(node => node.row === 1).map(node => node.id).sort();
  return { seed, nodes, byId, startIds, bossId };
}

// ------------------------------------------------------------------- the routes

/** Where a run may go next. No `at` yet means the choice is which column to start in. */
export function reachableFrom(map: TowerMap, at: string | undefined): string[] {
  if (!at) return map.startIds;
  return map.byId.get(at)?.next ?? [];
}

/** The nodes that can reach this one, for the "where did I come from" line. */
export function approachedFrom(map: TowerMap, id: string): MapNode[] {
  return map.nodes.filter(node => node.next.includes(id));
}

/**
 * The tower's own structural check, run by the tests rather than at runtime: every node must be
 * reachable from the bottom and the boss from every node. A map with an orphan is a map with a
 * stranded run.
 */
export function unreachableNodes(map: TowerMap): string[] {
  const seen = new Set(map.startIds);
  // Rows ascend, so one pass from the bottom is enough — there is no downward edge to miss.
  for (const node of [...map.nodes].sort((a, b) => a.row - b.row)) {
    if (!seen.has(node.id)) continue;
    for (const next of node.next) seen.add(next);
  }
  return map.nodes.filter(node => !seen.has(node.id)).map(node => node.id);
}
