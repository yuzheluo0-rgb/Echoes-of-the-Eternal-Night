/**
 * 道具行为层的契约。和 `src/battle/relics.test.ts` 同构，核心是同一条：
 *
 * > **每一件能用出来的道具，都必须真的改变什么。**
 *
 * 一件效果没接上的道具不会抛错、不会红构建，它只是**点了没反应**——而玩家会以为是自己点错了。
 * 所以这里拿一份固定脚本跑一遍，逐字段比对「用了」和「没用」的两个状态，完全相同的就是可疑的。
 *
 * 需要特定场面的道具（要被致命一击打中、要有灼烧层数、要有格挡可拆）走一张**显式白名单**，
 * 每一条都要写明理由。⚠️ **那张表不是藏东西的地方**：一件停止工作的道具会立刻以失败出现，
 * 逼你解释它或者修它。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  endTurn, isValidBattle, playCard, startBattle, useProp, canUseProp, validProps,
  type BattleState, type PropChoice,
} from './engine.ts';
import { PROP_EFFECTS, RUN_PROPS, IMPLEMENTED_PROPS } from './props.ts';
import { PROPS, PROP_BY_ID, PROP_SLOTS, emptyProps, placeIn, type PropDefinition } from '../props/props.ts';

/**
 * 两套执行者，**一件道具只属于其中一边**。
 *
 *   `PROP_EFFECTS`  战斗引擎执行。`useProp` 认它们。
 *   `RUN_PROPS`     改 run（牌库、生命上限、遗物），由 `run.ts` 的 `useRunProp` 执行。
 *
 * 界面按「有没有战斗效果」分流，所以一件道具同时出现在两边会让「点下去谁干活」变成一个
 * 取决于代码顺序的问题——下面有一条专门钉住这件事。
 *
 * 注意这和 `use` 是**两条轴**：`use` 说玩家能在哪儿点它，这里说点了之后谁干活。
 * 金烬（花 80 金币换一张牌）是 `anywhere`，但它的活是 run 干的。
 */
const FIGHT_PROPS = PROPS.filter(prop => PROP_EFFECTS[prop.id]);
const RUN_ONLY = PROPS.filter(prop => !PROP_EFFECTS[prop.id]);

/**
 * 一份固定脚本：定种子、定遭遇战、带伤进（让「生命低于一半」之类的判据从第一回合就是活的）。
 * 和 `relics.test.ts` 的 `fingerprint` 同一个出发点。
 */
function withProp(prop?: PropDefinition): BattleState {
  const props = prop ? placeIn(emptyProps(), 0, prop.id) : emptyProps();
  const s = startBattle('ch1-2', 'blade', 9, { hp: 26, props });
  // 固定的一手牌顺序，避免洗牌差异掩盖道具的效果。
  const order = ['blade-25', 'blade-14', 'blade-01', 'blade-04', 'blade-02', 'blade-03'];
  let out = s;
  for (const cardId of order.slice(0, 2)) {
    const card = out.hand.find(entry => entry.cardId === cardId);
    if (card) out = playCard(out, card.uid);
  }
  return out;
}

/** 这件道具要玩家先决定什么，就替它决定好——引擎只校验，不做交互。 */
function choiceFor(prop: PropDefinition, s: BattleState): PropChoice {
  const choice: PropChoice = {};
  if (prop.target === 'enemy') choice.targetUid = s.enemies.find(e => !e.dead)?.uid;
  if (prop.pick) choice.handUids = s.hand.slice(0, prop.pick.count).map(card => card.uid);
  return choice;
}

/** 状态里所有会被效果碰到的字段，拼成一个字符串。 */
function fingerprint(s: BattleState): string {
  return JSON.stringify([
    s.player.hp, s.player.block, s.player.energy, s.player.statuses, s.powers,
    s.enemies.map(e => [e.hp, e.block, e.statuses, e.intent]),
    s.hand.map(c => [c.cardId, c.upgraded ?? false, s.costMarks?.[c.uid] ?? 0]),
    s.draw.length, s.discard.length,
    s.log.map(line => line.text),
    s.marks,
  ]);
}

/**
 * 用了之后**反而看不出区别**的那种，逐条写明理由。
 *
 * ⚠️ 加一条之前先问：它是真的需要这个场面，还是它坏了？「需要被致命一击打中」是真理由；
 * 「我懒得搭那个场面」不是。
 */
const NEEDS_A_SCENE: Record<string, string> = {
  'stub-candle': '要真的挨一次致死伤害才会显形，而脚本里打不死自己',
  'long-wager': '五成的那一半取决于种子；这一条的另外一半由下面的专项测试兜',
};

test('每一件道具都恰好有一个执行者，没有白板也没有双头', () => {
  for (const prop of PROPS) {
    const fight = !!PROP_EFFECTS[prop.id], run = !!RUN_PROPS[prop.id];
    assert.ok(fight || run, `${prop.id}（${prop.name}）两边都没有实现——玩家会为一件点了没反应的东西占掉一格`);
    assert.ok(!(fight && run), `${prop.id} 同时有战斗效果和 run 效果，那「点下去谁干活」就取决于代码顺序了`);
  }
  // 反向：效果表里不能有数据层不认识的东西（改名字时漏改一边就会这样）。
  for (const id of [...IMPLEMENTED_PROPS, ...Object.keys(RUN_PROPS)]) {
    assert.ok(PROP_BY_ID.has(id), `${id} 有实现但不在道具表里`);
  }
  // ⚠️ 要开牌库选牌器的必须是营火专用：战斗进行中一置上 `cardTask`，整张战斗页会被选牌器顶掉。
  for (const [id, effect] of Object.entries(RUN_PROPS)) {
    if (effect.task) assert.equal(PROP_BY_ID.get(id)?.use, 'camp', `${id} 要开选牌器，却不是营火专用`);
  }
  // 反过来，`camp` 的判据是 `deck` 字段（数据层那条测试已经在管），两边要一致。
  for (const prop of RUN_ONLY) {
    if (prop.deck) assert.equal(prop.use, 'camp', `${prop.id} 改牌库却不是 camp`);
  }
});

test('每一件道具用下去，都必须真的改变什么', () => {
  const baseline = fingerprint(withProp());
  const unexplained: string[] = [];
  for (const prop of FIGHT_PROPS) {
    if (NEEDS_A_SCENE[prop.id]) continue;
    const before = withProp(prop);
    const after = useProp(before, 0, choiceFor(prop, before));
    if (fingerprint(after) === baseline) unexplained.push(`${prop.id}（${prop.name}）`);
  }
  assert.deepEqual(unexplained, [],
    '这些道具用下去和一个「什么都没带的对照」逐字段完全相同——它们没有接上引擎');
});

test('白名单里没有一条是废话', () => {
  // 每一条都要真的在表里，而且理由不能是空的——这张表不是「先放进去以后再说」的地方。
  for (const [id, reason] of Object.entries(NEEDS_A_SCENE)) {
    assert.ok(PROP_BY_ID.has(id), `白名单里的 ${id} 不是一件存在的道具`);
    assert.ok(reason.length >= 8, `${id} 的白名单理由太短，等于没写`);
  }
});

test('用掉一次就少一次，用完那格就空了', () => {
  const two = startBattle('ch1-2', 'blade', 9, { props: placeIn(emptyProps(), 0, 'pocket-forge') });
  assert.equal(two.props?.[0]?.uses, 2, '放进去应当是满次数');
  // 袖炉是营火专用的，战斗里用不了 —— 所以这里换一件两次的都行，窥管是 2 次。
  const glass = startBattle('ch1-2', 'blade', 9, { props: placeIn(emptyProps(), 1, 'spyglass') });
  const once = useProp(glass, 1);
  assert.equal(once.props?.[1]?.uses, 1, '两发的工具用过一次应当还剩一次');
  const twice = useProp(once, 1);
  assert.equal(twice.props?.[1], null, '用完最后一次，槽位要空出来');
  // 空槽再点会抛，而不是静默什么都不做。
  assert.throws(() => useProp(twice, 1), /没有东西/);
});

test('战斗属性与营火专用的界线：营火那几件在战斗里用不了', () => {
  const s = startBattle('ch1-2', 'blade', 9, { props: placeIn(emptyProps(), 0, 'clean-lamp') });
  assert.equal(canUseProp(s, 0), false, '界面应当把它置灰');
  // ⚠️ 而**置灰只是提示**——真正的拒绝必须在引擎里再发生一次（存档是可以手改的）。
  assert.throws(() => useProp(s, 0), /战斗外/);
});

test('用法不对一律抛错，而不是静默什么都不做', () => {
  const s = startBattle('ch1-2', 'blade', 9, { props: placeIn(emptyProps(), 0, 'frost-nail') });
  assert.throws(() => useProp(s, 9), /没有东西/, '越界的槽位');
  assert.throws(() => useProp(s, 1), /没有东西/, '空槽');
  // 没给目标时回退到「上一个瞄过的敌人」，和出牌同一条路；给了一个不存在的才是错。
  assert.throws(() => useProp(s, 0, { targetUid: 'nope' }), /目标无效/, '指了一个不存在的敌人');
  assert.equal(useProp(s, 0).enemies[0].statuses.frozen, 1, '没给目标时应当落到第一个活着的敌人身上');
  // 敌人回合里不能用。⚠️ 拿不到「正在进行中的敌人相位」——`endTurn` 跑到最后会自己开下一回合，
  // 所以这里直接造一个相位是 `enemy` 的状态，测的是那道守卫本身。
  assert.throws(() => useProp({ ...s, phase: 'enemy' }, 0), /敌人正在行动/);
  assert.throws(() => useProp({ ...s, phase: 'won' }, 0), /战斗已经结束/);
  // 挑牌挑错了也不行。
  const kit = startBattle('ch1-2', 'blade', 9, { props: placeIn(emptyProps(), 0, 'whetstone-kit') });
  assert.throws(() => useProp(kit, 0, { handUids: kit.hand.slice(0, 2).map(c => c.uid) }), /选中的牌不对/, '数量不够');
  assert.throws(() => useProp(kit, 0, { handUids: [kit.hand[0].uid, kit.hand[0].uid, kit.hand[0].uid] }), /选中的牌不对/, '有重复');
  assert.throws(() => useProp(kit, 0, { handUids: ['nope', 'nope2', 'nope3'] }), /选中的牌不对/, '不在手上');
});

test('磨石匣真的把那三张磨快了', () => {
  const s = startBattle('ch1-2', 'blade', 9, { props: placeIn(emptyProps(), 0, 'whetstone-kit') });
  const picked = s.hand.slice(0, 3).map(card => card.uid);
  const after = useProp(s, 0, { handUids: picked });
  for (const uid of picked) {
    assert.equal(after.hand.find(card => card.uid === uid)?.upgraded, true, `${uid} 没有被打磨`);
  }
  for (const card of after.hand) {
    if (picked.includes(card.uid)) continue;
    assert.ok(!card.upgraded, `${card.uid} 不该被打磨`);
  }
});

test('霜钉真的拿走了那个敌人的一次行动', () => {
  // 这是本轮唯一**新增**的机制（`frozen` 状态），所以它值得一条点名测试：
  // 「少挨一次」必须是真的少挨，而不是界面上写着冻结、敌人照打。
  const armed = startBattle('ch1-2', 'blade', 9, { props: placeIn(emptyProps(), 0, 'frost-nail') });
  const target = armed.enemies.find(enemy => !enemy.dead)!;
  const after = useProp(armed, 0, { targetUid: target.uid });
  assert.equal(after.enemies.find(e => e.uid === target.uid)?.statuses.frozen, 1, '冻结没有挂上');
  const rolled = endTurn(after);
  assert.equal(rolled.enemies.find(e => e.uid === target.uid)?.statuses.frozen, undefined, '跳过之后冻结应当消散');
  assert.ok(rolled.log.some(line => line.text.includes('一动不动')), '日志里没有写明它没动');
});

test('日志说的是「道具」，不是「遗物」', () => {
  // ⚠️ 遗物的许愿清单把「遗物 · 」硬编码在五处日志里，而道具与它共用同一份实现。
  // 这条挡住的是「用一次墙种，日志印一行『遗物 · 你获得 14 点格挡』」。
  const s = startBattle('ch1-2', 'blade', 9, { props: placeIn(emptyProps(), 0, 'wall-seed') });
  const after = useProp(s, 0);
  const mine = after.log.filter(line => line.text.includes('格挡'));
  assert.ok(mine.length > 0, '墙种什么都没写');
  for (const line of mine) {
    assert.ok(!line.text.startsWith('遗物 · '), `道具的日志印成了遗物：${line.text}`);
    assert.ok(line.text.startsWith('道具 · '), `道具的日志没有署名：${line.text}`);
  }
});

test('道具不是牌：不花能量、不推进连缀、也不推进引导', () => {
  // 三条都是「顺手改一下」会踩的：引火读 `playedThisTurn === 0`，连缀数它，
  // 而战斗页的引导用日志前缀判断玩家出没出过牌。
  const s = startBattle('ch1-2', 'blade', 9, { props: placeIn(emptyProps(), 0, 'ember-draught') });
  const after = useProp(s, 0);
  assert.equal(after.playedThisTurn, s.playedThisTurn, '用道具不该算作打出一张牌');
  assert.equal(after.player.energy, s.player.energy + 2, '烬饮该给 2 点能量');
  const line = after.log.find(entry => entry.text.includes('使用「烬饮」'))!;
  assert.ok(line, '没有写出「使用「烬饮」」这一行');
  assert.ok(!line.text.startsWith('打出「'), '用道具的日志不能以「打出「」开头——那会推进新手引导');
});

test('存档校验：脏的道具槽一律拒绝，但两格带同一件是合法的', () => {
  const ok = startBattle('ch1-2', 'blade', 9, { props: placeIn(emptyProps(), 0, 'blood-tap') });
  assert.ok(isValidBattle(ok), '一份干净的状态不该被拒');
  assert.ok(validProps(emptyProps()), '三个空槽合法');
  // ⚠️ 两格同一件**必须合法**——消耗品就该能带两个。遗物那条「主副不能同件」不能照抄过来。
  assert.ok(validProps(placeIn(placeIn(emptyProps(), 0, 'blood-tap'), 2, 'blood-tap')), '两件一样的道具应当合法');

  assert.equal(validProps([]), false, '长度不对');
  assert.equal(validProps([null, null]), false, '长度不对');
  assert.equal(validProps([null, null, null, null]), false, '长度不对');
  assert.equal(validProps([null, null, { id: 'nope', uses: 1 }]), false, '不存在的 id');
  assert.equal(validProps([null, null, { id: 'blood-tap', uses: 0 }]), false, '用完了的槽位该是 null');
  assert.equal(validProps([null, null, { id: 'blood-tap', uses: 99 }]), false, '次数超过上限');
  assert.equal(validProps([null, null, { id: 'spyglass', uses: 3 }]), false, '窥管只有 2 次');
  assert.equal(validProps([null, null, { id: 'spyglass' }]), false, '没有 uses');
  assert.equal(validProps([null, null, 'blood-tap']), false, '槽位不是对象');
});

test('进战斗时复制一份，不别名 run 里那个数组', () => {
  // ⚠️ 这条挡的是一个会静默发生的 bug：别名进来之后战斗就地扣次数，
  // 等到 `finishBattle` 再结算一次，战绩面板就会显示「这一场什么都没用」。
  const carried = placeIn(emptyProps(), 0, 'spyglass');
  const s = startBattle('ch1-2', 'blade', 9, { props: carried });
  useProp(s, 0);
  assert.equal(carried[0]?.uses, 2, 'run 里那一份不该被战斗改动');
  assert.notEqual(s.props, carried, '不该是同一个数组');
});

test('槽位数就是三格', () => {
  assert.equal(PROP_SLOTS, 3);
  assert.equal(emptyProps().length, 3);
  assert.equal(startBattle('ch1-2', 'blade', 9).props?.length, 3, '没带道具也该有三个空槽');
});
