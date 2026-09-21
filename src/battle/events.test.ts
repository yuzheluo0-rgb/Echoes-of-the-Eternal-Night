/**
 * 奇遇's contract, and the two things about it that are easy to get quietly wrong.
 *
 * The first is the **cost**. An event is the only place in the run where the player pays something
 * before finding out what it bought, so it is the only place where a mistake is unrecoverable: an
 * option that can be taken at 1 生命 is an option that can end a run from inside a text box, and no
 * playthrough would ever report it. `canAfford` and `resolveEvent` therefore have to agree about
 * every option in the table, and the second test below runs them against each other rather than
 * trusting that they were written consistently.
 *
 * The second is the **selection**. `eventForNode` is called from render — several times per screen,
 * across reloads — and the run's `rng` stream is emphatically not usable for it. A version of this
 * that rolled off `rng` would give a different event on every repaint, and would desynchronise the
 * whole run besides. So the property being checked is exactly the one that mistakes break:
 * *the same floor is always the same event*.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { EVENTS, EVENT_BY_ID, canAfford, eventForNode, type EventEffect } from './events.ts';
import { generateMap, reachableFrom, type MapNode } from './map.ts';
import { canEnterNode, enterNode, newRun, resolveEvent, type ChapterRun } from './run.ts';

const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);

/** A small deterministic stream, so the randomised checks below are still reproducible. */
function lcg(seed: number) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

/**
 * The effects that can only ever add. Used by the `lean` check.
 *
 * `nothing` is in here on purpose, and it is the entry that makes the check mean something. Refusing
 * to take anything is not a cost the run pays in numbers — it is the floor spent for no return, and
 * 「烧了它」 on the caravan's manifest is exactly that. A `lean:'loss'` event is one where the *best*
 * answer is still not a profit, and "walk away" is usually the answer that makes it true.
 */
const GAINING: EventEffect['kind'][] = ['gold', 'hp', 'maxHp', 'relic', 'remove', 'polish', 'duplicate', 'cards', 'nothing'];

/** Does taking this option leave the player better off, in a way the run can actually count? */
function isGain(effect: EventEffect): boolean {
  if (effect.kind === 'nothing') return false;         // costs nothing, gains nothing — not a gain
  if (effect.kind === 'gold' || effect.kind === 'hp' || effect.kind === 'maxHp') return effect.amount > 0;
  return GAINING.includes(effect.kind);
}

/**
 * Is a price attached, whichever way the event charges it?
 *
 * Two ways, and both are in use: `requires` is the toll paid at the door, and a negative 生命 effect
 * is the bill that arrives afterwards (值班表's 「把名字划掉」 costs 4 上限 and asks nothing up front).
 */
function hasPrice(option: (typeof EVENTS)[number]['options'][number]): boolean {
  const needs = option.requires;
  if (needs && ((needs.gold ?? 0) > 0 || (needs.hp ?? 0) > 0)) return true;
  const effect = option.effect;
  return (effect.kind === 'hp' || effect.kind === 'maxHp') && effect.amount < 0;
}

/** A payoff that arrives with nothing attached. */
function isFreeGain(option: (typeof EVENTS)[number]['options'][number]): boolean {
  return !hasPrice(option) && isGain(option.effect);
}

// ------------------------------------------------------------------- the table

test('奇遇表：id 唯一，每一条都写全了', () => {
  assert.ok(EVENTS.length >= 20, `只有 ${EVENTS.length} 个奇遇，太少了`);
  const ids = new Set<string>();
  for (const event of EVENTS) {
    assert.ok(event.id && !ids.has(event.id), `奇遇 id 重复或为空：${event.id}`);
    ids.add(event.id);
    assert.equal(EVENT_BY_ID.get(event.id), event, `${event.id} 没进 EVENT_BY_ID`);

    assert.ok(event.name.trim(), `${event.id} 没有名字`);
    // The blurb is the whole event as far as the screen is concerned — an empty one is a blank page.
    assert.ok(event.blurb.trim().length >= 10, `${event.id} 的 blurb 太短，读起来不像一件事`);
    assert.equal(event.options.length, 3, `${event.id} 不是三个选项`);
  }
});

test('奇遇表：每个选项的文案都写完了，不会漏字', () => {
  for (const event of EVENTS) {
    const labels = new Set<string>();
    for (const option of event.options) {
      assert.ok(option.label.trim(), `${event.id}：有选项没有按钮文字`);
      assert.ok(!labels.has(option.label), `${event.id}：两个选项同名「${option.label}」`);
      labels.add(option.label);
      // Out of 24 events this is 72 labels/hints/outcomes, all of which the player reads verbatim.
      assert.ok(option.hint.trim().length >= 2, `${event.id} / ${option.label}：hint 是空的`);
      assert.ok(option.outcome.trim().length >= 8, `${event.id} / ${option.label}：outcome 太短`);

      // A count of zero or a negative "you gain" would print as nonsense on the outcome line.
      const effect = option.effect;
      if (effect.kind === 'cards') assert.ok(effect.count > 0, `${event.id}：抽 ${effect.count} 张牌`);
      if (effect.kind !== 'cards' && effect.kind !== 'relic' && effect.kind !== 'remove'
        && effect.kind !== 'polish' && effect.kind !== 'duplicate' && effect.kind !== 'nothing') {
        assert.notEqual(effect.amount, 0, `${event.id} / ${option.label}：+0 是个不存在的效果`);
      }
      if (option.requires?.hp !== undefined) {
        assert.ok(option.requires.hp > 0, `${event.id}：生命代价要写成正数，它不是治疗`);
      }
    }
  }
});

test('奇遇表：lean 三档各自成立，标签不会说谎', () => {
  // Each of the three claims something different about the same three options, and each is checked
  // against the mechanics rather than the prose — a label nobody can test is a label that drifts.
  const check = {
    // Some answer is free and pays. This is the rarest shape on purpose: a `?` that is usually a gift
    // is a `?` with no decision in it.
    gain: (event: (typeof EVENTS)[number]) => event.options.some(isFreeGain),
    // There is a price somewhere on this floor, and there is also an answer that avoids it. The
    // second half is what separates it from `loss` — 值不值得 is only a question if 不要 is an option.
    cost: (event: (typeof EVENTS)[number]) =>
      event.options.some(hasPrice) && event.options.some(option => !hasPrice(option)),
    // Nothing here is free. Every answer is paid for, or is a wasted floor.
    loss: (event: (typeof EVENTS)[number]) =>
      event.options.every(option => hasPrice(option) || option.effect.kind === 'nothing'),
  };

  for (const event of EVENTS) {
    assert.ok(check[event.lean](event), `奇遇「${event.id}」标了 lean:'${event.lean}'，但它的选项不是这个形状`);
  }

  // The table is mostly *not* a payout, which is the design claim in the file header. If this ever
  // inverts — most floors handing out a free relic — the tower has quietly become a loot run.
  const gains = EVENTS.filter(event => event.lean === 'gain').length;
  assert.ok(gains <= EVENTS.length * .3, `${gains}/${EVENTS.length} 条是白拿的，奇遇快变成宝箱了`);
  assert.ok(gains >= 2, '一个白拿的奇遇都没有，learner 第一次踩到 ? 就会被惩罚');
  for (const kind of ['cost', 'loss'] as const) {
    assert.ok(EVENTS.some(event => event.lean === kind), `一条 lean:'${kind}' 的奇遇都没有`);
  }
});

// --------------------------------------------------------------- canAfford

test('canAfford：刚好够能付，差一点就不能', () => {
  for (const event of EVENTS) {
    for (const option of event.options) {
      const needs = option.requires ?? {};
      const gold = needs.gold ?? 0;
      const hp = needs.hp ?? 0;
      // Comfortably above every requirement: always affordable.
      assert.equal(canAfford(option, gold + 500, hp + 500), true, `${event.id} / ${option.label}`);
      if (gold > 0) {
        assert.equal(canAfford(option, gold, hp + 500), true, `${event.id}：金币刚好够却被挡住`);
        assert.equal(canAfford(option, gold - 1, hp + 500), false, `${event.id}：金币不够却能选`);
      }
      if (hp > 0) {
        // Strictly greater, and this is the line that keeps an event from ever being lethal.
        assert.equal(canAfford(option, gold + 500, hp + 1), true, `${event.id}：付完还剩 1 点血，应当允许`);
        assert.equal(canAfford(option, gold + 500, hp), false,
          `${event.id}：付完正好 0 血，必须挡住——奇遇不能是杀死玩家的东西`);
      }
    }
  }
});

// -------------------------------------------------------------- the selection

test('eventForNode：同一层永远是同一个奇遇，且来自奇遇表', () => {
  const ids = new Set(EVENTS.map(event => event.id));
  const picks = new Map<string, string>();
  for (const seed of SEEDS) {
    for (const node of generateMap(seed).nodes) {
      const event = eventForNode(node.id);
      assert.ok(ids.has(event.id), `${node.id} 选出了表外的奇遇 ${event.id}`);
      const seen = picks.get(node.id);
      if (seen === undefined) picks.set(node.id, event.id);
      else assert.equal(event.id, seen, `${node.id} 两次选出了不同的奇遇——重绘会换一件事`);
    }
  }
  // A hundred floors all landing on the same event would pass the loop above and be useless.
  assert.ok(new Set(picks.values()).size >= 10,
    `${picks.size} 个节点只落到了 ${new Set(picks.values()).size} 个奇遇上`);
});

test('地图上的奇遇层都取得到奇遇，且走进去不会自己结算', () => {
  let visited = 0;
  for (const seed of SEEDS) {
    const map = generateMap(seed);
    const eventNodes: MapNode[] = map.nodes.filter(node => node.kind === 'event');
    assert.ok(eventNodes.length, `种子 ${seed}：整张地图一个奇遇都没有`);

    // Every route starts at row 1, so a fresh run can reach an event node by walking the map.
    for (const target of eventNodes.slice(0, 1)) {
      let run: ChapterRun = newRun('blade', 'bone', seed);
      for (let step = 0; step < 12; step++) {
        if (run.at === target.id) break;
        // Prefer a step that closes in on the target; the tower only ever ascends.
        const here = run.at ? map.byId.get(run.at)!.row : 0;
        const choices = reachableFrom(map, run.at);
        const forward = choices.filter(id => map.byId.get(id)!.row <= target.row);
        const pick = forward.find(id => id === target.id)
          ?? forward[forward.length - 1] ?? choices[choices.length - 1];
        assert.ok(canEnterNode(run, pick), `种子 ${seed}：${pick} 走不过去`);
        run = enterNode(run, pick);
        assert.ok(map.byId.get(pick)!.row > here, `种子 ${seed}：从第 ${here} 行走到了第 ${map.byId.get(pick)!.row} 行`);
      }
      if (run.at !== target.id) continue;   // this route did not pass through the node
      visited++;

      // Standing on the event, the question is owed but not answered: `resolved` unset means the
      // screen is shown, and nothing has been charged yet.
      assert.equal(run.resolved, undefined, `${target.id}：还没答就把自己结算了`);
      assert.equal(run.cardTask, undefined, `${target.id}：还没答就开了选牌器`);
      assert.ok(EVENTS.some(event => event.id === eventForNode(target.id).id));
    }
  }
  assert.ok(visited > 0, '两百张地图没有一次走到奇遇层上，这个测试什么都没验');
});

// ---------------------------------------------------------------- resolution

test('resolveEvent：先付后拿，付不起的字面量不会被执行', () => {
  for (const event of EVENTS) {
    for (const option of event.options) {
      const run: ChapterRun = { ...newRun('blade', 'bone', 3), gold: 500, hp: 60 };
      const next = resolveEvent(run, option);
      const needs = option.requires ?? {};
      const effect = option.effect;

      // The cost is taken exactly once, and only when there is no card task to interrupt the flow.
      if (effect.kind === 'gold') {
        assert.equal(next.gold, 500 - (needs.gold ?? 0) + effect.amount, `${event.id} / ${option.label}：金币不对`);
      }
      if (effect.kind !== 'relic' && effect.kind !== 'remove' && effect.kind !== 'polish'
        && effect.kind !== 'duplicate' && effect.kind !== 'cards') {
        assert.ok(next.hp >= 1, `${event.id} / ${option.label}：奇遇把玩家打到了 ${next.hp} 血`);
      }
      // Answering always marks the floor done, whatever the answer was.
      assert.equal(next.resolved, run.at, `${event.id}：答完没有标记这一层已处理`);
    }
  }
});

test('resolveEvent：每种效果都接得上，不会留一个开着没做的步骤', () => {
  const run: ChapterRun = { ...newRun('blade', 'bone', 5), gold: 500, hp: 60 };
  const cases: [EventEffect, (next: ChapterRun) => boolean][] = [
    [{ kind: 'cards', count: 3 }, next => next.cardTask === 'pick' && next.cardOptions?.length === 3],
    [{ kind: 'remove' }, next => next.cardTask === 'remove'],
    [{ kind: 'polish' }, next => next.cardTask === 'polish'],
    [{ kind: 'duplicate' }, next => next.cardTask === 'duplicate'],
    [{ kind: 'relic' }, next => next.drawDue !== undefined && next.nextSlot !== undefined],
  ];
  for (const [effect, check] of cases) {
    const option = { label: 'x', hint: 'x', outcome: 'x', effect };
    const next = resolveEvent(run, option);
    assert.ok(check(next), `效果 ${effect.kind} 结算完没有留下任何该做的下一步——玩家会卡在这儿`);
    // A task that is owed must be clearable, or the screen it opens is a trap.
    assert.equal(next.resolved, run.at, `效果 ${effect.kind}：结算后没有标记这一层已完成`);
  }
});

test('整张表都能在随机血量金币下安全结算', () => {
  const roll = lcg(20260921);
  for (const event of EVENTS) {
    for (const option of event.options) {
      for (let trial = 0; trial < 40; trial++) {
        const gold = Math.floor(roll() * 200);
        const hp = 1 + Math.floor(roll() * 60);
        const run: ChapterRun = { ...newRun('blade', 'bone', 9), gold, hp };
        const affordable = canAfford(option, run.gold, run.hp);
        const next = resolveEvent(run, option);

        if (!affordable) continue;   // the screen disables it; nothing to assert about a click that cannot happen
        const needs = option.requires ?? {};
        assert.ok(next.hp >= 1, `${event.id} / ${option.label}：${hp} 血付 ${needs.hp ?? 0} 之后成了 ${next.hp}`);
        assert.ok(next.gold >= 0, `${event.id} / ${option.label}：金币成了 ${next.gold}`);
        assert.ok(next.hp <= next.maxHp, `${event.id} / ${option.label}：治疗越过了上限`);
        assert.ok(next.maxHp >= 60, `${event.id} / ${option.label}：生命上限被压到了 ${next.maxHp}`);
      }
    }
  }
});
