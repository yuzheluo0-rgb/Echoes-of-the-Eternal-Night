/**
 * 道具数据层的契约。和 `src/relics/relics.test.ts` 同构。
 *
 * 这里测的是**静默出错**的那几类：一件没有检索词的道具是一张没图的图标；一件 `deck` 却写着
 * `battle` 的道具会在战斗中途把整张战斗页换成选牌器；一件 `charges` 与 `text` 对不上的道具
 * 会在卡面上说谎。这些都不会抛错，也都能过构建。
 *
 * 行为层（效果真的生效吗）在 `src/battle/props.test.ts`。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROP_KINDS, PROPS, PROP_BY_ID, PROP_SLOTS, afterUse, clearSlot,
  emptyProps, kindCounts, placeIn, propsOfKind, type PropKind,
} from './props.ts';
import { PROP_QUERY } from './art.ts';

/** 件数下限。用户要求「至少三十个」——这条钉住它，也钉住「别在重构里悄悄删掉几件」。 */
const MIN_TOTAL = 30;

/** 九类一个都不能空。空的一类会在验收页上变成一个点了什么都不显示的按钮。 */
const EVERY_KIND: PropKind[] = [
  'convert', 'hand', 'energy', 'control', 'survive', 'rite', 'status', 'gamble', 'tool',
];

test('道具至少有三十件，id 与名称都不重复', () => {
  assert.ok(PROPS.length >= MIN_TOTAL, `只有 ${PROPS.length} 件道具，用户要的是至少 ${MIN_TOTAL} 件`);
  assert.equal(PROP_BY_ID.size, PROPS.length, '有重复的 id');
  assert.equal(new Set(PROPS.map(prop => prop.name)).size, PROPS.length, '有重复的名字');
  for (const prop of PROPS) {
    assert.match(prop.id, /^[a-z0-9-]+$/, `${prop.id} 的 id 不是小写连字符形状——它同时是文件名`);
    assert.ok(prop.name.trim().length >= 1, `${prop.id} 没有名字`);
  }
});

test('每一件都说清了效果与来历，次数也合法', () => {
  for (const prop of PROPS) {
    assert.ok(prop.text.trim().length >= 4, `${prop.id} 的效果文案太短：「${prop.text}」`);
    assert.ok(prop.lore.trim().length >= 4, `${prop.id} 没有来历那一行`);
    assert.ok(Number.isInteger(prop.charges) && prop.charges >= 1, `${prop.id} 的次数是 ${prop.charges}`);
    assert.ok(prop.weight > 0, `${prop.id} 的掉落权重是 ${prop.weight}——它永远掉不出来`);
    assert.ok(PROP_KINDS.some(kind => kind.id === prop.kind), `${prop.id} 的分类「${prop.kind}」不在表上`);
    // 九类各有各的颜色，所以类别必须是九者之一——这条由上一行的查表兜住。
  }
  // ⚠️ **效果文案里不许拿稀有度形容这件道具。** 卡牌有火焰阶梯、遗物有存活阶梯，道具**故意没有**：
  // 它是消耗品，玩家要判断的是「现在用不用」，不是「它有多稀有」。掉率活在 `weight` 里。
  //
  // 「**稀有牌**」是例外，而且必须留：那是**卡牌**那条阶梯上的东西（夜祷书的效果就是拿生命
  // 上限换一张稀有牌，用户原话如此）。所以先把这一类说法摘掉，再看剩下的。
  const cardRarity = /(稀有|罕见)(?=牌)/g;
  for (const prop of PROPS) {
    const text = prop.text.replace(cardRarity, '');
    for (const word of ['稀有', '罕见', '史诗', '传说', '珍稀']) {
      assert.ok(!text.includes(word), `${prop.id} 的效果里印了**这件道具自己**的稀有度「${word}」——道具不印稀有度`);
    }
  }
});

test('九类一类都不空，件数相加等于总数', () => {
  const counts = kindCounts();
  for (const kind of EVERY_KIND) {
    assert.ok(counts[kind] >= 1, `「${kind}」一件道具都没有——验收页上会是一个空按钮`);
    assert.ok(propsOfKind(kind).length === counts[kind]);
    const definition = PROP_KINDS.find(entry => entry.id === kind)!;
    assert.match(definition.accent, /^#[0-9a-f]{6}$/, `${kind} 的颜色不是 #rrggbb`);
    assert.ok(definition.gloss.trim().length >= 4, `${kind} 没有一句说明它回答什么问题`);
  }
  assert.equal(PROP_KINDS.length, EVERY_KIND.length, '分类表和测试里的清单对不上');
  assert.equal(EVERY_KIND.reduce((sum, kind) => sum + counts[kind], 0), PROPS.length, '有道具不属于任何一类');
  assert.equal(new Set(PROP_KINDS.map(kind => kind.accent)).size, PROP_KINDS.length, '两类用了同一个颜色');
});

test('⚠️ 要开选牌器的道具只能是营火用', () => {
  // ⚠️ 这条不是风格偏好，是**界面结构逼出来的硬约束**：战斗页的分派顺序里 `run.cardTask`
  // 排在战斗本体之前，所以战斗进行中一置上它，敌人当场消失、换成一张牌库选牌器。
  // 凡是改 run 牌库的道具（`deck`），因此必须是 `use: 'camp'`。
  for (const prop of PROPS) {
    if (!prop.deck) continue;
    assert.equal(prop.use, 'camp',
      `${prop.id} 要开牌库选牌器，却写着 use:'${prop.use}'——战斗中用它会把整张战斗页换成选牌器`);
  }
  // 反过来也要立得住：一个 `camp` 道具要么改牌库，要么有别的理由不能进战斗。
  // 现在这一档里全部都是改牌库的，所以两边必须严格同集合。
  const camp = PROPS.filter(prop => prop.use === 'camp');
  assert.ok(camp.length > 0, '一件营火道具都没有——那一档就该删掉');
  for (const prop of camp) {
    assert.ok(prop.deck, `${prop.id} 是营火专用，却没有 deck 字段说明为什么不能进战斗`);
  }
});

test('从手牌挑牌的道具必须挑得动', () => {
  for (const prop of PROPS) {
    if (!prop.pick) continue;
    assert.equal(prop.pick.from, 'hand');
    assert.ok(Number.isInteger(prop.pick.count) && prop.pick.count >= 1, `${prop.id} 要从手牌挑 ${prop.pick.count} 张`);
    // 起手是 5 张，挑超过 5 张永远挑不满，那是一件点了会抛错的道具。
    assert.ok(prop.pick.count <= 5, `${prop.id} 要挑 ${prop.pick.count} 张，而起手只有 5 张`);
  }
  // 有 `pick` 的是「从手牌挑」，它**不**打开 run 的选牌器，所以可以进战斗——
  // 这正是它和 `deck` 的区别，见 `PropDefinition.pick` 上的说明。
  assert.ok(PROPS.some(prop => prop.pick && prop.use === 'battle'),
    '没有一件「战斗中从手牌挑牌」的道具，那 pick 这个字段就是多余的');
});

test('道具与检索词一一对应，两个方向都要对得上', () => {
  for (const prop of PROPS) {
    const query = PROP_QUERY[prop.id];
    assert.ok(query, `${prop.id} 没有检索词——这个图标会没有图`);
    assert.ok(query.trim().length >= 3, `${prop.id} 的检索词太短，搜不出东西`);
  }
  const known = new Set(PROPS.map(prop => prop.id));
  for (const id of Object.keys(PROP_QUERY)) {
    assert.ok(known.has(id), `${id} 有检索词但没有对应的道具——这是一张没人要的照片`);
  }
  assert.equal(Object.keys(PROP_QUERY).length, PROPS.length);
});

test('⚠️ 检索词不超过五个词', () => {
  // ⚠️ 这条不是文风要求，是 Unsplash 的行为：它把整串当**短语**搜，太长就直接返回**空**，
  // 而不是返回不太准的结果。实测——
  //
  //     brass whistle dark still life        45 张
  //     brass whistle dark still life macro   0 张
  //
  // 第一轮抓图就是这么卡住的：日志里 20 行 `nothing for "…"`，而 `! search failed` 是 **0** 条——
  // 页面加载完全正常，只是没有结果。当时花了三轮才找到原因，所以这条必须由测试来记着。
  for (const [id, query] of Object.entries(PROP_QUERY)) {
    const words = query.trim().split(/\s+/);
    assert.ok(words.length <= 5, `${id} 的检索词有 ${words.length} 个词（上限 5），Unsplash 会返回空：「${query}」`);
  }
});

test('检索词指向物件，不是风景、人像、也不是人在用它', () => {
  // ⚠️ `holding / wearing / crafting / workbench` 这一组是道具**独有**的风险：道具里一堆工具
  // （袖炉、磨石匣、铅指套、窥管），这些词搜出来的是「一个人在工作台前拿着它」。
  // 遗物那轮真踩过一次（`work-gloves`），所以这里把那一组也拦上。
  const banned = /\b(landscape|scenery|sunset|sunrise|mountain range|portrait|woman|man|person|people|crowd|holding|wearing|crafting|workbench|workshop)\b/;
  const framing = /\b(macro|still life|close ?up|object|dark|table|background|rustic|hanging|lit|glowing|on fire)\b/;
  for (const [id, query] of Object.entries(PROP_QUERY)) {
    assert.match(query, framing, `${id} 的检索词没有说明怎么拍：「${query}」`);
    assert.doesNotMatch(query, banned, `${id} 的检索词会搜到风景、人像或「人在用它」：「${query}」`);
  }
});

test('次数用完了就清空，槽位是定长的三个', () => {
  // 这三条是 `useProp` 与 `isValidBattle` 共用的算术，错了不会抛错，只会看起来像设计。
  assert.equal(PROP_SLOTS, 3, '槽位数是用户拍的三格');
  assert.deepEqual(emptyProps(), [null, null, null]);

  assert.equal(afterUse(1), 0);
  assert.equal(afterUse(2), 1);
  assert.equal(afterUse(0), 0, '用过头不该变成负数——负数的次数会让「还剩几次」永远显示不对');

  const two = placeIn(emptyProps(), 1, 'pocket-forge');
  assert.deepEqual(two, [null, { id: 'pocket-forge', uses: 2 }, null], '放进去应当是满次数');
  // 同一个槽再放一件是**替换**，不是叠加——和 `claimRelic` 同一个语义。
  const replaced = placeIn(two, 1, 'ember-draught');
  assert.deepEqual(replaced[1], { id: 'ember-draught', uses: 1 }, '替换应当给新道具的满次数');
  assert.deepEqual(clearSlot(two, 1), [null, null, null]);

  // 越界不该抛错，也不该改到别处——界面上永远点不到，但手改存档能。
  assert.deepEqual(placeIn(two, 9, 'ember-draught'), two);
  assert.deepEqual(placeIn(two, -1, 'ember-draught'), two);
  assert.deepEqual(clearSlot(two, 9), two);
  // 不认识的 id 一律不放。
  assert.deepEqual(placeIn(two, 0, 'nope'), two);
  // 传入的数组不被就地改动（引擎每次克隆，但这一条能挡住将来的「顺手改一改」）。
  const original = placeIn(emptyProps(), 0, 'pocket-forge');
  const copy = original.map(entry => (entry ? { ...entry } : null));
  clearSlot(original, 0);
  assert.deepEqual(original, copy, 'clearSlot 就地改了传进来的数组');
});

test('一件道具可以同时带两个——消耗品就该能带两个', () => {
  // ⚠️ 遗物的 `isValidRun` 有一条「主槽与副槽不能是同一件」，但**道具不能照抄那一条**：
  // 遗物拒绝的是同一件东西占两个语义不同的槽，而两个燃烧瓶是玩家正当的选择。
  const two = placeIn(placeIn(emptyProps(), 0, 'blood-tap'), 2, 'blood-tap');
  assert.deepEqual(two.filter(Boolean).map(entry => entry!.id), ['blood-tap', 'blood-tap']);
  assert.equal(new Set(two.filter(Boolean).map(entry => entry!.id)).size, 1);
});
