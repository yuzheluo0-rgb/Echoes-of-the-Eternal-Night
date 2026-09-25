/**
 * The tower's own contract.
 *
 * A map is the one piece of content a player cannot check: if the generator strands a column, or
 * puts an elite on the second floor, or rolls a route that cannot reach the boss, the run is broken
 * in a way nobody sees until they are thirty minutes into it. So the rules the generator claims to
 * follow are all checked here, over a few hundred seeds rather than one.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOSS_ROW, MAP_COLS, MAP_ROWS, generateMap, reachableFrom, unreachableNodes,
  type NodeKind, type TowerMap,
} from './map.ts';
import { POOLS } from './enemies.ts';
import { SCENE_BY_KEY } from './scenes.ts';
import { ALL_ENCOUNTERS } from './enemies.ts';

const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);
const ENCOUNTER_IDS = new Set(ALL_ENCOUNTERS.map(entry => entry.id));
const RESTRICTED: NodeKind[] = ['elite', 'rest', 'treasure'];

test('同种子同地图，不同种子不同地图', () => {
  const shape = (seed: number) => JSON.stringify(generateMap(seed).nodes.map(n => `${n.id}:${n.kind}`));
  assert.equal(shape(11), shape(11), '同一个种子必须给出同一张地图');
  const shapes = new Set(SEEDS.map(shape));
  assert.ok(shapes.size > SEEDS.length * .9, `200 个种子只产出 ${shapes.size} 张不同的地图`);
});

test('每个节点都走得到，boss 一定可达', () => {
  for (const seed of SEEDS) {
    const map = generateMap(seed);
    assert.deepEqual(unreachableNodes(map), [], `种子 ${seed}：有节点从底层走不到`);
    const seen = new Set(map.startIds);
    for (const node of [...map.nodes].sort((a, b) => a.row - b.row)) {
      if (seen.has(node.id)) for (const next of node.next) seen.add(next);
    }
    assert.ok(seen.has(map.bossId), `种子 ${seed}：boss 不可达`);
  }
});

test('行规则：首行必是战斗，首领前那一排三营火一事件，boss 单节点', () => {
  for (const seed of SEEDS) {
    const map = generateMap(seed);
    for (let row = 1; row <= MAP_ROWS; row++) {
      const nodes = map.nodes.filter(n => n.row === row);
      assert.ok(nodes.length > 0, `种子 ${seed}：第 ${row} 行是空的`);
      if (row === 1) {
        assert.deepEqual([...new Set(nodes.map(n => n.kind))], ['combat'], `种子 ${seed}：首行只能是战斗`);
      }
    }
    // 首领前那一排：三营火一事件 —— 多数是火，少数是别的，且只有这两种。
    const preBoss = map.nodes.filter(n => n.row === MAP_ROWS);
    const fires = preBoss.filter(n => n.kind === 'rest').length;
    const events = preBoss.filter(n => n.kind === 'event').length;
    // 恰好奇数一个事件——这是**比例**而不是加权掷，加权掷在四个节点上会有四分之一的概率掷出两个。
    assert.equal(fires + events, preBoss.length, `种子 ${seed}：首领前只有营火和事件`);
    assert.equal(events, 1, `种子 ${seed}：首领前该恰好一个事件，实际 ${events} 个`);
    assert.equal(fires, preBoss.length - 1, `种子 ${seed}：其余都该是营火`);
    const boss = map.nodes.filter(n => n.kind === 'boss');
    assert.equal(boss.length, 1, `种子 ${seed}：boss 只能有一个`);
    assert.equal(boss[0].id, map.bossId);
    assert.equal(boss[0].row, BOSS_ROW);
  }
});

test('前 5 行没有精英，且同一路径上不连精英/营火/宝箱', () => {
  for (const seed of SEEDS) {
    const map = generateMap(seed);
    for (const node of map.nodes) {
      if (node.kind === 'elite') assert.ok(node.row >= 6, `种子 ${seed}：第 ${node.row} 行不该有精英`);
      for (const id of node.next) {
        const above = map.byId.get(id)!;
        if (!RESTRICTED.includes(node.kind)) continue;
        assert.notEqual(node.kind, above.kind,
          `种子 ${seed}：${node.id}(${node.kind}) 上面直接连着同类的 ${id}`);
      }
    }
  }
});

/**
 * 每条路线上的营火数分布：`分布[k] = 路上有 k 个营火的路线条数`。
 *
 * 从 boss 往下 DP，把「走到这里、路上有 k 个营火」精确累加——**枚举而不是抽样**。抽样会漏掉
 * 少见但真实的地图，而少见的地图正是这条测试要挡的东西。
 */
function restCounts(map: TowerMap): number[] {
  const memo = new Map<string, number[]>();
  const walk = (id: string): number[] => {
    const hit = memo.get(id);
    if (hit) return hit;
    const node = map.byId.get(id)!;
    const out: number[] = [];
    if (!node.next.length) out[0] = 1;
    else for (const next of node.next) {
      const below = walk(next);
      for (let k = 0; k < below.length; k++) if (below[k]) out[k] = (out[k] ?? 0) + below[k];
    }
    // 这个节点自己是一口火，整条路的营火数整体 +1。
    if (node.kind === 'rest') {
      for (let k = out.length - 1; k >= 0; k--) { out[k + 1] = out[k] ?? 0; out[k] = 0; }
    }
    memo.set(id, out);
    return out;
  };
  const total: number[] = [];
  for (const id of map.startIds) {
    const dist = walk(id);
    for (let k = 0; k < dist.length; k++) if (dist[k]) total[k] = (total[k] ?? 0) + dist[k];
  }
  return total;
}

test('中段真的长着营火 —— 每条路线都遇得到', () => {
  // 这条挡的是「整座塔只有 boss 前那一排有火」。`bandFor` 的四条 band 里曾经**一条都没有
  // `rest`**，于是唯一能到的营火就是那一排的保底火，而那一排有一个节点是事件——踩在上面的
  // 路线整座塔一觉没睡。实测 200 个种子：25.2% 的路线零营火、其余恰好一个、均值 0.75，
  // 而当时**223 项测试全绿**。地图上有火不等于走得到，所以这里数的是**路线上的营火**。
  //
  // 判据是一条带而不是一个点：调权重不该误伤，但「一条中段营火都没有」会立刻红。
  let routes = 0;
  let fires = 0;
  let barren = 0;
  for (const seed of SEEDS) {
    const dist = restCounts(generateMap(seed));
    for (let k = 0; k < dist.length; k++) { routes += dist[k] ?? 0; fires += k * (dist[k] ?? 0); }
    const most = dist.reduce((best, count, k) => (count ? k : best), 0);
    if (most <= 1) barren++;
  }
  const mean = fires / routes;
  assert.ok(mean > 1.4 && mean < 2.6,
    `每条路线平均 ${mean.toFixed(2)} 个营火，落在 [1.4, 2.6] 之外（杀戮尖塔掷出来的是约 1.1 次）`);
  assert.ok(barren < SEEDS.length * .12, `${barren}/${SEEDS.length} 个种子里，没有任何一条路线遇到中段营火`);
});

test('每个节点最多 3 条进边、3 条出边（boss 除外）', () => {
  // Boss 是**故意**豁免的：它是所有路线的汇合点，每一条第 12 行的路都通向它，所以它的进边数
  // 就等于第 12 行的节点数。实测 500 张地图里唯一超标的节点永远只有它。
  for (const seed of SEEDS) {
    const map = generateMap(seed);
    const incoming = new Map<string, number>();
    for (const node of map.nodes) {
      assert.ok(node.next.length <= 3, `种子 ${seed}：${node.id} 有 ${node.next.length} 条出边`);
      for (const id of node.next) incoming.set(id, (incoming.get(id) ?? 0) + 1);
    }
    for (const [id, count] of incoming) {
      if (id === map.bossId) continue;
      assert.ok(count <= 3, `种子 ${seed}：${id} 有 ${count} 条进边`);
    }
  }
});

test('地图铺得开：每一行都留得下选择', () => {
  // 这条挡的是「六条路径挤成一列」。加进边上限之前，seed 42 的第 5 行只剩两个节点，
  // 一半的分支在中途就没了。
  for (const seed of SEEDS) {
    const map = generateMap(seed);
    for (let row = 2; row < MAP_ROWS; row++) {
      const nodes = map.nodes.filter(n => n.row === row);
      assert.ok(nodes.length >= 2, `种子 ${seed}：第 ${row} 行只剩 ${nodes.length} 个节点`);
    }
  }
});

test('地图不预先定下任何一场战斗——那是踏进去才掷的', () => {
  // 这一条钉的是一个**刻意的设计**，不是实现细节：节点只说自己是什么类型，具体打谁要等玩家
  // 站上去。所以 `MapNode` 上不该有 encounterId，`encounterFor` 才是唯一的下发口。
  const map = generateMap(7);
  for (const node of map.nodes) {
    assert.equal('encounterId' in node, false, `${node.id} 不该预先带着遭遇战`);
  }
});

test('每个节点都有一张背景图，否则会有一层是空白的', () => {
  const byKind: Record<string, string> = { rest: 'rest', treasure: 'treasure', event: 'event' };
  for (const seed of SEEDS) {
    for (const node of generateMap(seed).nodes) {
      // 地图上看到的背景按**类型**给：具体是哪一场还没掷出来，就不该显示某一场的照片。
      const scene = byKind[node.kind] ?? 'grass';
      assert.ok(SCENE_BY_KEY.has(scene as never), `种子 ${seed}：${node.id}（${node.kind}）没有对应的场景`);
    }
  }
  // 每一场真实遭遇战的场景也必须存在，否则踏进去时背景是空的。
  for (const encounter of ALL_ENCOUNTERS) {
    assert.ok(SCENE_BY_KEY.has(encounter.scene), `${encounter.id} 的场景 ${encounter.scene} 不存在`);
  }
});

test('精英池与首领池都非空，且池子里的每一场都有场景', () => {
  assert.ok(POOLS.elite.length >= 3, '精英至少要三种，否则连续两次都是同一只');
  assert.ok(POOLS.boss.length >= 1);
  for (const encounter of [...POOLS.elite, ...POOLS.boss, ...POOLS.weak, ...POOLS.strong]) {
    assert.ok(ENCOUNTER_IDS.has(encounter.id));
  }
});

test('起点与可达：没落地时可选的只有第一行，落地后只走本节点的出边', () => {
  const map = generateMap(7);
  const starts = reachableFrom(map, undefined);
  assert.deepEqual(starts, map.startIds);
  assert.equal(starts.length, 6, '七个列里留一列没有起点，和原版一样');
  for (const id of starts) assert.equal(map.byId.get(id)!.row, 1);
  const first = map.byId.get(starts[0])!;
  assert.deepEqual(reachableFrom(map, first.id), first.next);
  assert.ok(first.next.every(id => map.byId.get(id)!.row === 2), '只能往上走一层');
  assert.ok(first.next.every(id => Math.abs(map.byId.get(id)!.col - first.col) <= 1), '每层最多横移一列');
});

test('地图不会把节点放到网格外', () => {
  for (const seed of SEEDS) {
    for (const node of generateMap(seed).nodes) {
      assert.ok(node.col >= 0 && node.col < MAP_COLS, `种子 ${seed}：${node.id} 的列越界`);
      assert.ok(node.row >= 1 && node.row <= BOSS_ROW, `种子 ${seed}：${node.id} 的行越界`);
    }
  }
});
