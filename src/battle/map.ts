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
 * Twenty-one. Twelve was a tower you could read in one screenful and it was over before a deck had a
 * shape; sixteen was the reference game's fifteen-plus-a-boss, whose pacing numbers transfer; the
 * last five are the stretch the late game was missing — a route now has room for a second rolled
 * campfire, a shop it can actually afford by the time it reaches, and a run of `?` floors to spend
 * the coin and the health it accumulated. See `bandFor` for how those five floors are apportioned.
 *
 * ⚠️ **GROWING THIS NUMBER INVALIDATES EVERY IN-PROGRESS SAVE, AND SILENTLY REINTERPRETS SOME.**
 *
 * Node ids are `n<row>-<col>` counted from the bottom (`nodeId`), and a run stores `path` / `at` as
 * those ids rather than the map itself (`run.ts`'s `rebuildMap` regenerates from the seed).
 * `isValidRun` only checks that those ids **exist** in the rebuilt tower — membership, nothing more.
 *
 * Appending rows at the top looks like it should leave rows 1..16 alone. It does not. The routes are
 * walked one after another and **share one roll stream**: route 1 now consumes five extra rows before
 * route 2 draws its first number, so routes 2..6 land on different columns for their whole length.
 * Only **row 1** is byte-identical; rows 2..21 change for essentially every seed.
 *
 * Measured on 200 seeds going 16 → 21 (`.work/tower-id-compare.ts`):
 *   - rows 1..16 byte-identical: **0/200** maps (row 1 alone: 200/200)
 *   - a complete old route (17 ids): **193/200 dropped** by `isValidRun`, and **7/200 accepted** —
 *     the dangerous half, where the ids happened to survive and the run is teleported onto a tower
 *     that is not the one it was climbing (a save on the old 第 16 行 campfire lands five floors down,
 *     on an ordinary 战斗 floor).
 *   - the boss id moves `n17-3` → `n22-3`; the old id still names *a* node in 127/200 maps and names
 *     the boss in **0** of them.
 *
 * The only save that survives intact is one sitting on row 1 (nothing walked yet). There is no
 * migration available here — the version field lives in `run.ts` — so this is a **one-time world
 * change**: ships as "your run restarts", not as "your run reloads somewhere odd". Anything that
 * grows the tower again owes the player the same warning.
 */
export const MAP_ROWS = 21;
export const MAP_COLS = 7;
export const BOSS_ROW = MAP_ROWS + 1;
/** The column the boss stands in. Middle of the grid, so no route has to bend to reach it. */
export const BOSS_COL = 3;
/** How many routes thread the tower. One column is left with no starting node, as in the original. */
export const ROUTES = 6;
/** A node may carry at most this many routes into it, which is what keeps the tower from bunching. */
const MAX_INCOMING = 3;

export type NodeKind = 'combat' | 'elite' | 'event' | 'rest' | 'treasure' | 'shop' | 'boss';

/**
 * The kinds that may not appear twice in a row along a route. Combat and events are exempt.
 *
 * ⚠️ **`shop` is here for the same reason as `rest`** — and it is the reason `shopAllowedOn` below has
 * to exist at all. Two shops back to back is two shelves in a row, which is one shelf too many; the
 * interesting decision is *which* shop you spend at, and that needs space between them.
 */
const NO_REPEAT: NodeKind[] = ['elite', 'rest', 'treasure', 'shop'];

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
  /**
   * 商店只在这两个 band 里，各占一条。
   *
   * ⚠️ **上面那条 `combat` 是补回来的，不是原来就有的，而且它是被一条测试钉住的。**
   *
   * 商店插进一个等权 band，等于把这条 band 里**每一种**都稀释一遍——包括战斗。而中段能遇到的仗
   * 少一处，`run.test.ts` 那条「走一条路线一定遇得到全部五场章节战」就会红：实测 200 个种子、
   * 每条路线走一遍，插进去之后**种子 156 只遇到 4/5**（它那条路线第八行往上只剩一个能站锚点的
   * 战斗格）。而 `isChapterCleared` 要的是五场都打赢过——凑不齐就是那一局永远通不了关。
   *
   * 所以商店占掉的那一条用一条战斗补回来，中段的战斗占比**回到基线的 50%**。代价落在奇遇、精英、
   * 宝箱与营火各 −2.5 个点：营火均值 1.77 → 1.63、一条随机营火都没有的地图 1/200 → 5/200，两条都
   * 还在 `map.test.ts` 那条带宽里。别的几种摆法都量过（`.work/tower-cadence.ts` 与
   * `.work/anchor-coverage.ts`）：只放 11~15 行是绿的但一座塔只有 1.68 家店（用户要 2~3 家）、
   * 40% 的路线一家都遇不到；11~15 行补战斗仍然红。
   */
  if (row <= 10) {
    return ['combat', 'combat', 'combat', 'combat', 'combat', 'event', 'elite', 'treasure', 'rest', 'shop'];
  }
  /**
   * 中后段（11~16）——**原来那个 `else`**，仍是唯一一条「什么都可能有、而且战斗已经不到一半」的
   * 带：战斗 3/8、其余五种各 1/8。六行，不是原来的五行：塔长到 21 行之后，这一条带如果一直铺到
   * 第 20 行就是**十行一模一样**，那正是 `bandFor` 当初要避免的「每张地图一眼读完」。
   */
  if (row <= 16) {
    return ['combat', 'combat', 'combat', 'elite', 'event', 'treasure', 'rest', 'shop'];
  }
  /**
   * 尾段（17~20）——加高的那五层里**真正参与掷点**的四层（第 21 行是 `assignLastRow` 的保底火）。
   *
   * 用户要的是「预留给战斗 1-2 层、营火 1-2 层、商店 1 层、奇遇或宝箱 1-2 层」。那是一句**按层**
   * 说的话，而这里**不能写成按层**：把某一行锁成营火，每张地图一眼就读完了。所以翻译成**权重**——
   * 「一条路线走过这四层，路上大概有几层是营火」。一条路线上每层恰好站一个节点，所以
   * 「期望几层」= 那种的权重 × 4。权重表（12 条）：
   *
   *   | 种类 | 权重 | 每层概率 | 四层期望 | 用户要的 |
   *   |---|---|---|---|---|
   *   | 战斗 | 4 | 33% | 1.33 | 1~2 层 ✓ |
   *   | 营火 | 2 | 17% | 0.67 | 1~2 层 ✓（+ 第 21 行那口保底火 = 1.4） |
   *   | 奇遇 | 2 | 17% | 0.67 | 1~2 层 ✓（+ 宝箱合计 1.3） |
   *   | 宝箱 | 2 | 17% | 0.67 | 同上 |
   *   | 商店 | 1 |  8% | 0.33 | 见下 |
   *   | 精英 | 1 |  8% | 0.33 | — |
   *
   * **营火与奇遇·宝箱各从 1/8 抬到 1/6**，战斗从 3/8 降到 1/3，这是尾段和中后段唯一的区别：
   * 越往上越不像「再打一场」，越像「进去之前把手里这点东西花掉」。精英也降了一档——20 行处再塞
   * 一个精英，玩家已经没有空间去绕开它了，而精英的用处是**逼一个提前的取舍**，不是压死。
   *
   * ⚠️ **商店那一条 1/12 是量出来的，而且「一条路线一层商店」这个读法在这套规则下做不到。**
   * 商店有三重上限：一行最多一家（`ROW_CAP.shop = 1`）、上下相邻两层不能都是（`NO_REPEAT`）、
   * 第 20 行不许有（`shopAllowedOn`）。所以一条路线走过这四层，遇到商店的**上限是隔层各一家、
   * 还得正好踩在上面**，算下来 0.5 封顶——谁来做都一样。实测 1/12 权重下是 **0.28 家 / 条路线**、
   * **0.90 家 / 座塔**，68.5% 的塔在尾段有店（`.work/tower-cadence.ts` 的商店栏）。
   *
   * 那个「1 层」于是只能读成**每座塔**：尾段这几层里有没有一家店。整座塔因此从 3.06 家涨到
   * **4.83 家**，一条路线遇到商店的期望从 0.74 涨到 **1.18**（见 `.work/tower-cadence.ts` 的商店栏
   * 与 `.work/shop-probe.ts`）。**这一条越过了 CLAUDE.md 记下的「塔上 2~3 家」**——那是在 16 行的塔上
   * 量的数，塔高 31% 之后按密度折算就该是 4.0 家，多出来的约 0.8 家正是这里给尾段的那一档。
   * 要收回去，调的是中后段那一条带的 `shop` 权重（or `ROW_CAP.shop`），**不是这里**。
   */
  return ['combat', 'combat', 'combat', 'combat', 'elite', 'event', 'event', 'treasure', 'treasure', 'rest', 'rest', 'shop'];
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
 * `MAP_ROWS - 1` node could not see the campfire already sitting above it, and a route could sit down
 * twice in a row. It stayed hidden only because `rest` was absent from every band, so rows 11 and 12
 * never met; growing the tower and putting `rest` in the bands is what made it reachable. Seed 1
 * caught it — and it is exactly the row 16 → 17 boundary that re-opens when the tower grows, which is
 * why this is written against `MAP_ROWS` and never against a number.
 *
 * The reference game has the identical rule, for the identical reason: its last floor is all rest
 * sites, and it forbids a rest site on the floor directly beneath.
 */
const restAllowedOn = (row: number) => row >= FIRST_REST_ROW && row !== MAP_ROWS - 1;

/**
 * 商店从这一行起才有。比营火晚一行，是**故意的**：第 6 行上的人身上通常还没几个钱（一条路线的
 * 金币大头在精英与强敌身上，而它们从第 6 行才出现），摆一家店在那里等于摆一个玩家买不起的橱窗。
 */
export const FIRST_SHOP_ROW = 7;

/**
 * 商店能不能长在这一行上。
 *
 * ⚠️ **`row !== MAP_ROWS - 1` 这半条是 `restAllowedOn` 那个洞的第三个实例，必须显式写。**
 * boss 前那一排（`MAP_ROWS`）是 `assignLastRow` 在**主循环之前**就定好的（三条营火 + 一个事件），
 * 而生成循环里那条「同类不连续」查的是 `from.get(node.id)`——**前驱**，也就是下面那一行。所以
 * `MAP_ROWS - 1` 掷点时**看不见上方已经是营火**，当年正是这样让「营火连营火」从写下起就一直在、
 * 只是 `rest` 没进过任何 band 才没炸。商店同理：它一旦落在 `MAP_ROWS - 1`，那条路线就是
 * 「商店 → 营火」，而这一排的语义是「boss 之前的最后一次补给」。
 *
 * ⚠️ **这一条原来没有测试兜着，而且它上面的注释在说谎。** 原话是「`map.test.ts` 那条『首领前那一排
 * 只有营火和事件』会当场红」——不会：那条测的是第 `MAP_ROWS` 行，商店长在 `MAP_ROWS - 1` 上行
 * `MAP_ROWS` 一个字节都不变。实测把这里的 `row !== MAP_ROWS - 1` 删掉，**200 个种子里 63 张地图会
 * 在 `MAP_ROWS - 1` 长出商店，而 319 项测试全绿**。现在由 `map.test.ts` 的「boss 前那一排的下面
 * 一行：不许长营火，也不许长商店」显式钉住——**改这一行之前先看那条测试**。
 *
 * ⚠️ 这里写的是 `MAP_ROWS - 1` 而**不是**任何字面行号：塔从 16 行长到 21 行，这一条跟着走到了
 * 第 20 行。写死 15 的那一版会当场失效——而且失效得**无声**：第 20 行与第 21 行营火相连，
 * `NO_REPEAT` 从下面看不到上面，只有玩家会坐两次火。
 */
const shopAllowedOn = (row: number) => row >= FIRST_SHOP_ROW && row !== MAP_ROWS - 1;

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

  // Every route ends on its own `MAP_ROWS` node; all of them lead to the one boss.
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
  //
  // ⚠️ `shop: 1` 不加的话，一行里能滚出三家店——九分之一的权重在四五个节点的一行上并不是「很稀」，
  // 而「塔上只有 2~3 家」是设计承诺，不是平均值。
  const ROW_CAP: Partial<Record<NodeKind, number>> = { event: 2, elite: 2, rest: 2, shop: 1 };

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
      && (kind !== 'shop' || shopAllowedOn(node.row))
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
