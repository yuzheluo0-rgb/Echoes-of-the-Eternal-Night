import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canPlay, cardCost, cardName, cardRules, endTurn, intentFor, intentText, isValidBattle,
  livingEnemies, playCard, startBattle, type BattleCard, type BattleState,
} from './engine.ts';
import { ENCOUNTERS, ENEMY_BY_ID, OATH } from './enemies.ts';
import { starterDeck } from './chapter.ts';
import type { DeckId } from '../cards/index.ts';

/** The two decks chapter I hands out. */
const DECKS: DeckId[] = ['blade', 'bone'];
/** Piled everywhere a card can be, hand included. */
const pile = (s: BattleState): BattleCard[] => [...s.hand, ...s.draw, ...s.discard, ...s.exhaust];
const count = (s: BattleState): number => pile(s).length;

/** A state whose hand is exactly these cards, with a full tank of energy. */
function withHand(state: BattleState, cardIds: string[], energy = 3): BattleState {
  const s = structuredClone(state);
  s.hand = cardIds.map((cardId, index) => ({ uid: `rig-${index}`, cardId }));
  s.player.energy = energy;
  return s;
}
function endTurns(s: BattleState, times: number): BattleState {
  let out = s;
  for (let i = 0; i < times; i++) out = endTurn(out);
  return out;
}
/** The engine never uses Math.random, and neither do the tests. */
function lcg(seed: number) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

// --------------------------------------------------------------- 1. determinism

test('同种子同操作序列产生完全相同的结果', () => {
  const play = (seed: number) => {
    let s = startBattle('ch1-3', 'bone', seed);
    let steps = 0;
    while (s.phase === 'player' && steps < 24) {
      steps += 1;
      const playable = s.hand.filter(card => canPlay(s, card.uid));
      if (playable.length) s = playCard(s, playable[0].uid, livingEnemies(s)[0]?.uid);
      else s = endTurn(s);
    }
    return s;
  };
  const a = play(4242);
  const b = play(4242);
  assert.deepEqual(structuredClone(a), structuredClone(b));
  assert.equal(a.rng, b.rng);
  assert.deepEqual(a.log.map(line => line.text), b.log.map(line => line.text));
  const other = play(4243);
  assert.notDeepEqual(other.log.map(line => line.text), a.log.map(line => line.text));
});

// ------------------------------------------------------------------ 2. purity

test('playCard / endTurn 绝不修改输入', () => {
  const s = startBattle('ch1-2', 'blade', 11);
  const before = structuredClone(s);
  const card = s.hand.find(entry => canPlay(s, entry.uid))!;
  const played = playCard(s, card.uid, livingEnemies(s)[0].uid);
  assert.deepEqual(s, before, 'playCard 动了输入');
  assert.notDeepEqual(played, before);

  const beforeTurn = structuredClone(played);
  const ended = endTurn(played);
  assert.deepEqual(played, beforeTurn, 'endTurn 动了输入');
  assert.notDeepEqual(ended, played);

  assert.throws(() => playCard(s, 'nope'), /手牌里没有这张牌/);
  assert.throws(() => playCard(s, card.uid, 'ghost'), /目标无效/);
  assert.deepEqual(s, before, '抛错也要先掷回不修改输入的承诺');
});

// --------------------------------------------------------------- 3. the shuffle

test('抽牌堆耗尽时弃牌堆洗回抽牌堆，牌的总数守恒', () => {
  const base = startBattle('ch1-1', 'blade', 5);
  const size = count(base);
  assert.equal(size, starterDeck('blade').length);

  // 把抽牌堆掏空到只剩 1 张，其余塞进弃牌堆，逼出一次洗回
  const drained = structuredClone(base);
  drained.draw = base.draw.slice(0, 1);
  drained.discard = [...base.discard, ...base.draw.slice(1)];
  assert.equal(count(drained), size, '搬家不改牌数');

  const next = endTurn(drained);
  assert.equal(next.hand.length, 5, '抽满 5 张：先抽走仅剩的 1 张，洗回后再抽 4 张');
  assert.equal(next.draw.length, size - 5, '洗完的牌堆扣掉抽走的 5 张');
  assert.equal(count(next), size);
  assert.ok(next.log.some(line => line.text.includes('洗回')), '洗牌要有日志');
});

// ------------------------------------------------------------------ 4. energy

test('能量不足时 canPlay 为 false，playCard 抛错', () => {
  const s = withHand(startBattle('ch1-1', 'blade', 3), ['blade-01', 'blade-02'], 0);
  assert.equal(cardCost('blade-01'), 1);
  assert.equal(cardCost('blade-02'), 0);
  assert.equal(canPlay(s, 'rig-0'), false);
  assert.equal(canPlay(s, 'rig-1'), true, '0 费牌没有能量也能打');
  assert.throws(() => playCard(s, 'rig-0'), /能量不足/);
  assert.equal(canPlay(s, 'missing'), false);

  const funded = { ...s, player: { ...s.player, energy: 1 } };
  assert.equal(canPlay(funded, 'rig-0'), true);
  assert.equal(playCard(funded, 'rig-0').player.energy, 0);

  const over = { ...s, phase: 'won' as const };
  assert.equal(canPlay(over, 'rig-1'), false);
  assert.throws(() => playCard(over, 'rig-1'), /战斗已经结束/);
});

// ------------------------------------------------------- 5. block absorbs first

test('伤害先扣格挡再扣血', () => {
  const s = withHand(startBattle('ch1-1', 'blade', 8), ['blade-04']); // 掩刃：6 点格挡
  const shielded = playCard(s, 'rig-0');
  assert.equal(shielded.player.block, 6);
  const after = endTurn(shielded);
  // 两只影狼各 5 + 聚群 2 = 7，共 14：6 点被格挡吃下，生命 −8
  assert.equal(after.player.hp, 60 - 8);
  assert.equal(after.player.block, 0);
});

test('聚群按出手时的存活数结算：杀掉一只，另一只就咬得轻', () => {
  const rig = withHand(startBattle('ch1-1', 'blade', 12), ['blade-01']);
  rig.enemies[0].hp = 1;
  const killed = playCard(rig, 'rig-0', rig.enemies[0].uid);
  assert.equal(killed.enemies[0].dead, true);
  assert.equal(intentText(intentFor(killed, killed.enemies[1])[0]), '攻击 5');
  const after = endTurn(killed);
  assert.equal(after.player.hp, 60 - 5, '没有同伴的影狼只咬 5');
});

test('intentFor 把聚群与力量算进显示的攻击力，原始 intent 保持脚本数值', () => {
  const s = startBattle('ch1-1', 'blade', 13);
  const wolf = s.enemies[0];
  assert.equal(intentText(wolf.intent[0]), '攻击 5');
  assert.equal(intentText(intentFor(s, wolf)[0]), '攻击 7', '两只影狼，聚群 +2');
  const alone = { ...s, enemies: [s.enemies[0]] };
  assert.equal(intentText(intentFor(alone, alone.enemies[0])[0]), '攻击 5');
});

// --------------------------------------------------- 6. edge / mark / first hit

test('锋锐与烙印每次命中都加伤，多段牌按次数乘', () => {
  const rig = withHand(startBattle('ch1-5', 'blade', 21), ['blade-02']); // 双刃 3 伤害 2 次
  rig.player.statuses.edge = 2;
  rig.enemies[0].statuses.mark = 1;
  const hit = playCard(rig, 'rig-0', rig.enemies[0].uid);
  assert.equal(hit.enemies[0].hp, 126 - (3 + 2 + 3) * 2, '每次命中 +2 锋锐 +3 烙印');
  assert.equal(hit.enemies[0].statuses.mark, 1, '烙印不会因为挨打而消耗');

  const plain = structuredClone(rig);
  delete plain.enemies[0].statuses.mark;
  assert.equal(playCard(plain, 'rig-0', plain.enemies[0].uid).enemies[0].hp, 126 - (3 + 2) * 2);
});

test('淬刃只强化本回合第一张攻击牌', () => {
  const rig = withHand(startBattle('ch1-5', 'blade', 22), ['blade-01', 'blade-01', 'blade-04']);
  rig.powers.firstAttackBonus = 3;
  const first = playCard(rig, 'rig-0', rig.enemies[0].uid);
  assert.equal(first.enemies[0].hp, 126 - 10, '7 + 3');
  const second = playCard(first, 'rig-1', first.enemies[0].uid);
  assert.equal(second.enemies[0].hp, 126 - 10 - 7, '第二张攻击牌不再加成');
  const skill = playCard(second, 'rig-2');
  assert.equal(skill.enemies[0].hp, 126 - 17);
  assert.equal(skill.player.block, 6);
});

test('攒烬每次命中给余烬，并在下个回合开始时清零', () => {
  const rig = withHand(startBattle('ch1-5', 'blade', 23), ['blade-08', 'blade-02']);
  const powered = playCard(rig, 'rig-0'); // 攒烬
  assert.equal(powered.powers.emberPerHit, 1);
  const hit = playCard(powered, 'rig-1', powered.enemies[0].uid); // 双刃 2 次命中
  assert.equal(hit.player.statuses.ember, 2);
  const after = endTurn(hit);
  assert.equal(after.powers.emberPerHit, 0);
  assert.equal(after.player.statuses.ember, 2, '余烬本身不会消退');
});

test('多段牌的目标中途死亡时，剩下的命中转给下一个敌人', () => {
  const rig = withHand(startBattle('ch1-1', 'blade', 24), ['blade-02']);
  rig.enemies[0].hp = 2;
  const after = playCard(rig, 'rig-0', rig.enemies[0].uid);
  assert.equal(after.enemies[0].dead, true);
  assert.equal(after.enemies[1].hp, 11 - 3, '第二下落在另一只影狼身上');
});

// ------------------------------------------------------------------- 7. scorch

test('灼烧在敌人回合开始时结算并递减，归零移除', () => {
  const rig = withHand(startBattle('ch1-1', 'blade', 31), []);
  rig.enemies[0].statuses.scorch = 3;
  const one = endTurn(rig);
  assert.equal(one.enemies[0].hp, 11 - 3);
  assert.equal(one.enemies[0].statuses.scorch, 2);
  const two = endTurn(one);
  assert.equal(two.enemies[0].hp, 11 - 3 - 2);
  assert.equal(two.enemies[0].statuses.scorch, 1);
  const three = endTurn(two);
  assert.equal(three.enemies[0].hp, 11 - 3 - 2 - 1);
  assert.equal(three.enemies[0].statuses.scorch, undefined, '归零就移除');
});

// ---------------------------------------------- 8. keepBlock, shatter (patched)

test('潜草者的格挡跨回合保留，其它敌人的格挡在自己回合开始时清空', () => {
  let s = startBattle('ch1-4', 'blade', 41);
  const stalker = () => s.enemies.find(enemy => enemy.id === 'stalker')!;
  assert.equal(intentText(stalker().intent[0]), '潜伏 · 格挡 4');
  s = endTurn(s);
  assert.equal(stalker().block, 4);
  s = endTurn(s);
  assert.equal(stalker().block, 8, '上个回合的 4 点没有消失，新的 4 点叠上去');

  let c = startBattle('ch1-3', 'blade', 42);
  const guard = () => c.enemies.find(enemy => enemy.id === 'caravanguard')!;
  assert.equal(intentText(guard().intent[0]), '攻击 9');
  c = endTurn(c);
  assert.equal(intentText(guard().intent[0]), '清点货物 · 格挡 10');
  c = endTurn(c);
  assert.equal(guard().block, 10);
  c = endTurn(c);
  assert.equal(guard().block, 0, '寻常敌人回合开始时会清空自己的格挡');
});

test('shatter：单次打穿格挡时自身受伤，磨穿不算', () => {
  const def = ENEMY_BY_ID.get('shadewolf')!;
  ENEMY_BY_ID.set('shadewolf', { ...def, traits: [...(def.traits ?? []), { id: 'shatter', amount: 5 }] });
  try {
    const rig = withHand(startBattle('ch1-1', 'blade', 51), ['blade-01']); // 割线 7
    rig.enemies[0].block = 4;
    const broken = playCard(rig, 'rig-0', rig.enemies[0].uid);
    assert.equal(broken.enemies[0].block, 0);
    assert.equal(broken.enemies[0].hp, 11 - 3 - 5, '3 点溢出 + 5 点碎裂');

    const chip = withHand(startBattle('ch1-1', 'blade', 52), ['blade-02']); // 3 伤害 2 次
    chip.enemies[0].block = 10;
    const chipped = playCard(chip, 'rig-0', chip.enemies[0].uid);
    assert.equal(chipped.enemies[0].block, 4);
    assert.equal(chipped.enemies[0].hp, 11, '两次都没打穿，不碎');
  } finally {
    ENEMY_BY_ID.set('shadewolf', def);
  }
});

// ------------------------------------------------------- 9. deathBurst chains

test('deathBurst 死亡时炸到其它单位（含玩家），并且能连锁', () => {
  const def = ENEMY_BY_ID.get('shadewolf')!;
  ENEMY_BY_ID.set('shadewolf', { ...def, traits: [{ id: 'deathBurst', amount: 4 }] });
  try {
    const rig = withHand(startBattle('ch1-1', 'blade', 61), ['blade-01']);
    rig.enemies[0].hp = 1;
    rig.enemies[1].hp = 2;
    const after = playCard(rig, 'rig-0', rig.enemies[0].uid);
    assert.equal(after.enemies[0].dead, true);
    assert.equal(after.enemies[1].dead, true, '第一只炸死了第二只');
    assert.equal(after.enemies[1].hp, 0);
    assert.equal(after.player.hp, 60 - 4 - 4, '两轮爆炸都打到玩家');
    assert.equal(after.phase, 'won');
  } finally {
    ENEMY_BY_ID.set('shadewolf', def);
  }
});

// ------------------------------------------------------ 10. devour, steal, ward

test('吞光：吃下玩家的余烬与锋锐，变成自己的格挡', () => {
  const rig = withHand(startBattle('ch1-1', 'blade', 71), []);
  rig.player.statuses.ember = 4;
  rig.player.statuses.edge = 2;
  rig.enemies[0].block = 3;
  rig.enemies[0].intent = [{ kind: 'devour' }];
  const after = endTurn(rig);
  assert.equal(after.enemies[0].block, 12, '先清空自己的 3 点，再把 6 层换成 12 点');
  assert.equal(after.player.statuses.ember, undefined);
  assert.equal(after.player.statuses.edge, undefined);
});

test('落灰、枯竭、翻找、窃取、守御、special 都能跑', () => {
  const rig = withHand(startBattle('ch1-1', 'blade', 81), ['blade-01']);
  rig.player.statuses.ember = 5;
  rig.enemies[1].hp = 999;
  rig.enemies[1].maxHp = 999;
  rig.enemies[1].intent = [
    { kind: 'pollute', amount: 2 },
    { kind: 'drain', amount: 1 },
    { kind: 'bury', amount: 1 },
    { kind: 'steal', status: 'ember' },
    { kind: 'ward', amount: 3 },
    { kind: 'special', note: '什么也没有发生' },
  ];
  const after = endTurn(rig);
  assert.equal(pile(after).filter(card => card.cardId === 'ash').length, 2, '落灰塞了两张灰烬');
  assert.equal(after.exhaust.length, 1, '翻找把一张牌埋出了本场战斗');
  assert.equal(after.exhaust[0].cardId, 'blade-01', '埋掉的是回合结束弃下来的那张');
  assert.equal(after.discard.length, 0, '弃牌堆里那张被吃掉了');
  assert.equal(after.player.energy, 2, '枯竭在下个回合扣掉 1 点能量');
  assert.equal(after.player.statuses.drained, undefined, '扣完就清掉');
  assert.equal(after.player.statuses.ember, undefined, '余烬被偷光');
  assert.equal(after.enemies[1].statuses.strength, 2, '5 层换 2 点力量');
  assert.equal(after.enemies[0].block, 3, '守御加在同僚身上');
  assert.ok(after.log.some(line => line.text.includes('什么也没有发生')));
  assert.equal(count(after), count(rig) + 2, '只有落灰会加牌');
});

// ------------------------------------------------------ 11. encounters and decks

test('第一章五场遭遇战都能开局，牌数守恒', () => {
  for (const encounter of ENCOUNTERS) {
    for (const deck of DECKS) {
      const s = startBattle(encounter.id, deck, 2026);
      assert.equal(s.turn, 1);
      assert.equal(s.phase, 'player');
      assert.equal(s.player.hp, 60);
      assert.equal(s.player.energy, 3);
      assert.equal(s.hand.length, 5);
      assert.deepEqual(s.enemies.map(enemy => enemy.id), encounter.units);
      assert.ok(s.enemies.every(enemy => enemy.hp === enemy.maxHp && !enemy.dead && enemy.intent.length > 0));
      assert.equal(count(s), starterDeck(deck).length, `${encounter.id}/${deck} 牌数不对`);
      assert.equal(new Set(pile(s).map(card => card.uid)).size, count(s));
      assert.equal(s.targetUid, s.enemies[0].uid);
      assert.ok(isValidBattle(s));
      // 残烬是三张一叠，牌组里一定有重复
      assert.ok(starterDeck(deck).length > new Set(starterDeck(deck)).size);
    }
  }
  assert.throws(() => startBattle('nope', 'blade'), /没有这场战斗/);
  assert.throws(() => startBattle('ch1-1', 'flame'), /不能携带/);
  assert.throws(() => startBattle('ch1-1', 'mirror'), /不能携带/);
});

// ------------------------------------------------------------- 12. random play

test('40 局随机对局：不变量恒成立，且必然分出胜负', () => {
  const check = (s: BattleState, size: number) => {
    assert.ok(isValidBattle(s), '存档必须始终合法');
    assert.ok(s.player.hp >= 0 && s.player.hp <= s.player.maxHp, `生命越界：${s.player.hp}`);
    assert.ok(s.hand.length <= 10, '手牌不能超过 10 张');
    for (const [id, value] of Object.entries(s.player.statuses)) {
      assert.ok(Number.isInteger(value) && (value as number) >= 0, `玩家 ${id} 层数非法`);
    }
    for (const enemy of s.enemies) {
      assert.ok(enemy.hp >= 0 && enemy.hp <= enemy.maxHp, `${enemy.id} 生命越界`);
      assert.ok(enemy.block >= 0, `${enemy.id} 格挡为负`);
      if (enemy.dead) assert.equal(enemy.hp, 0);
      for (const [id, value] of Object.entries(enemy.statuses)) {
        assert.ok(Number.isInteger(value) && (value as number) >= 0, `${enemy.id} 的 ${id} 层数非法`);
      }
    }
    const cards = pile(s);
    assert.equal(cards.length, size + cards.filter(card => card.cardId === 'oath').length, '只有换岗会加牌');
    assert.equal(new Set(cards.map(card => card.uid)).size, cards.length, 'uid 不能重复');
    if (s.phase === 'won') assert.equal(livingEnemies(s).length, 0);
  };

  let wins = 0;
  let losses = 0;
  let longest = 0;
  for (const encounter of ENCOUNTERS) {
    for (const deck of DECKS) {
      for (let round = 0; round < 4; round++) {
        const seed = 900 + round * 137 + encounter.units.length * 7;
        const roll = lcg(seed);
        let s = startBattle(encounter.id, deck, seed);
        const size = count(s);
        check(s, size);
        let steps = 0;
        while (s.phase === 'player' && steps < 400) {
          steps += 1;
          const playable = s.hand.filter(card => canPlay(s, card.uid));
          if (playable.length && roll() < 0.85) {
            const card = playable[Math.floor(roll() * playable.length)];
            const targets = livingEnemies(s);
            s = playCard(s, card.uid, targets[Math.floor(roll() * targets.length)]?.uid);
          } else {
            s = endTurn(s);
          }
          check(s, size);
        }
        longest = Math.max(longest, steps);
        assert.ok(s.phase === 'won' || s.phase === 'lost', `${encounter.id}/${deck}/${seed} 打不完（${steps} 步）`);
        if (s.phase === 'won') wins += 1; else losses += 1;
      }
    }
  }
  assert.equal(wins + losses, 40);
  assert.ok(longest < 400, '没有一局是靠步数上限停下来的');
});

// ------------------------------------------------------------ optional systems

test('蓄火把没用完的能量带到下回合，枯竭扣能量', () => {
  const rig = withHand(startBattle('ch1-1', 'blade', 121), ['blade-25']); // 敛刃 2 费：8 伤害 + 蓄火
  const banked = playCard(rig, 'rig-0', rig.enemies[0].uid);
  assert.equal(banked.player.energy, 1);
  const next = endTurn(banked);
  assert.equal(next.player.energy, 3 + 1);
  assert.equal(next.player.statuses.bank, undefined, '蓄火转成能量后就用掉了');

  const drained = structuredClone(next);
  drained.player.statuses.drained = 2;
  assert.equal(endTurn(drained).player.energy, 1);
});

test('缠布让下回合少抽牌，最少抽 1 张', () => {
  const rig = withHand(startBattle('ch1-1', 'blade', 131), []);
  rig.player.statuses.shrouded = 2;
  const after = endTurn(rig);
  assert.equal(after.hand.length, 3);
  assert.equal(after.player.statuses.shrouded, undefined);

  const smothered = withHand(startBattle('ch1-1', 'blade', 132), []);
  smothered.player.statuses.shrouded = 9;
  assert.equal(endTurn(smothered).hand.length, 1);
});

test('回合结束弃掉整手牌，下回合重新抽 5 张（缠布则更少）', () => {
  const rig = withHand(startBattle('ch1-1', 'blade', 301), ['blade-25', 'blade-25', 'blade-25']);
  const after = endTurn(rig);
  assert.equal(after.hand.some(card => card.uid.startsWith('rig-')), false, '手牌不会跨回合留下');
  assert.equal(after.discard.filter(card => card.uid.startsWith('rig-')).length, 3, '弃进弃牌堆');
  assert.equal(after.hand.length, 5, '下回合抽满 5 张');
  assert.equal(count(after), count(rig), '只是换个堆待着，牌数不变');
  assert.ok(after.log.some(line => line.text.includes('弃掉 3 张手牌')));

  const shrouded = withHand(startBattle('ch1-1', 'blade', 302), ['blade-25']);
  shrouded.player.statuses.shrouded = 2;
  assert.equal(endTurn(shrouded).hand.length, 3, '缠布 2 层就只抽 3 张');
});

test('拾荒犬的翻找把弃牌堆里的一张牌埋进 exhaust，牌数守恒', () => {
  let s = startBattle('ch1-2', 'blade', 311);
  const size = count(s);
  s = endTurns(s, 2); // 萤火 3/拾荒犬 6、再一轮，第三拍才是翻找
  assert.equal(s.exhaust.length, 0);
  assert.ok(s.discard.length >= 5, '每回合弃下来的手牌就是它的食物');
  // 这一手在下个回合结束时也会进弃牌堆，被埋的只可能出自这些牌里
  const edible = new Set([...s.hand, ...s.discard].map(card => card.uid));
  const after = endTurn(s);
  assert.equal(after.exhaust.length, 1);
  const buried = after.exhaust[0];
  assert.ok(edible.has(buried.uid), '埋的是弃牌堆里的牌');
  assert.equal([...after.hand, ...after.draw, ...after.discard].some(card => card.uid === buried.uid), false,
    '埋掉的牌不在任何还能抽到的地方');
  assert.equal(count(after), size, '牌数守恒');
  assert.ok(after.log.some(line => line.text.includes('翻找')));
});

test('壁垒每层保留 1 点格挡，不动每回合补上格挡与壁垒', () => {
  const rig = withHand(startBattle('ch1-1', 'blade', 141), []);
  rig.player.block = 30; // 14 点伤害吃不完，回合开始时还剩 16
  rig.player.statuses.rampart = 2;
  assert.equal(endTurn(rig).player.block, 2);

  const still = withHand(startBattle('ch1-1', 'blade', 142), []);
  still.powers.turnBlock = 2;
  still.powers.turnRampart = 1;
  const after = endTurn(still);
  assert.equal(after.player.block, 2, '不动之力在抽牌之后结算');
  assert.equal(after.player.statuses.rampart, 1);
});

test('反震每次被命中都反击，多段攻击按次数算，攻击者会被打死', () => {
  const rig = withHand(startBattle('ch1-1', 'blade', 151), []);
  rig.player.statuses.retaliate = 4;
  rig.enemies[0].hp = 5;
  rig.enemies[0].intent = [{ kind: 'attack', amount: 2, times: 3 }];
  rig.enemies[1].intent = [];
  const after = endTurn(rig);
  assert.equal(after.enemies[0].dead, true, '5 点生命吃不住两次反震');
  // 每次 2 + 聚群 2 = 4；第二段之后攻击者就死了，所以第三段没有打出来
  assert.equal(after.player.hp, 60 - 4 * 2);
  assert.equal(after.player.statuses.retaliate, undefined, '反震在整轮结束后清零');
});

test('萤火的馈赠在它回合开始时发放，然后才动手', () => {
  const s = startBattle('ch1-2', 'blade', 161);
  assert.equal(s.player.statuses.ember, undefined);
  const after = endTurn(s);
  assert.equal(after.player.statuses.ember, 1);
  assert.equal(after.player.hp, 60 - 3 - 6, '萤火 3 点 + 拾荒犬 6 点');
  assert.equal(after.player.statuses.drained, undefined);
});

test('换岗把「未熄的誓言」洗进抽牌堆；打出它会给守望者回血与力量', () => {
  const rig = structuredClone(startBattle('ch1-5', 'blade', 171));
  rig.enemies[0].intent = [{ kind: 'special', note: '换岗 · 将一张「未熄的誓言」放入你的牌堆' }];
  const shuffledIn = endTurn(rig);
  assert.equal(shuffledIn.draw.filter(card => card.cardId === 'oath').length, 1);
  assert.equal(shuffledIn.enemies[0].hp, 126, '这一拍不打人');

  const oath = structuredClone(shuffledIn);
  oath.enemies[0].hp = 100;
  oath.hand = [{ uid: 'rig-oath', cardId: 'oath' }];
  oath.player.energy = 3;
  const played = playCard(oath, 'rig-oath', oath.enemies[0].uid);
  assert.equal(played.player.statuses.ember, 3);
  assert.equal(played.enemies[0].hp, 106, '回复 6 点，不超过生命上限');
  assert.equal(played.enemies[0].statuses.strength, 1);
  assert.equal(played.discard.filter(card => card.cardId === 'oath').length, 1);
  assert.equal(cardCost(OATH.id), 0);
  assert.equal(cardName(OATH.id), '未熄的誓言');
  assert.ok(cardRules(OATH.id).includes('余烬'));
});

test('played() 数的是这张牌之前的张数，handSize() 不含正在打出的这张', () => {
  const rig = withHand(startBattle('ch1-5', 'blade', 181), ['blade-09', 'blade-09']); // 三叠 2×3，连缀时 2×4
  const first = playCard(rig, 'rig-0', rig.enemies[0].uid);
  assert.equal(first.enemies[0].hp, 126 - 6);
  const second = playCard(first, 'rig-1', first.enemies[0].uid);
  assert.equal(second.enemies[0].hp, 126 - 12, '第二张时 played() 只有 1，还没到连缀');

  const empty = withHand(startBattle('ch1-5', 'bone', 182), ['bone-08']); // 白骨墙：空明 14 点
  assert.equal(playCard(empty, 'rig-0').player.block, 14);
  const stocked = withHand(startBattle('ch1-5', 'bone', 183), ['bone-08', 'bone-08']);
  assert.equal(playCard(stocked, 'rig-0').player.block, 9, '手里还有牌就不算空明');
});

test('不在玩家回合时，endTurn / playCard 抛中文错误', () => {
  const base = startBattle('ch1-1', 'blade', 191);
  const won = { ...base, phase: 'won' as const };
  assert.throws(() => endTurn(won), /战斗已经结束/);
  assert.throws(() => playCard(won, base.hand[0].uid), /战斗已经结束/);
  const enemy = { ...base, phase: 'enemy' as const };
  assert.throws(() => endTurn(enemy), /敌人正在行动/);
  assert.throws(() => playCard(enemy, base.hand[0].uid), /敌人正在行动/);
});

test('intentText 覆盖每一种意图', () => {
  assert.equal(intentText({ kind: 'attack', amount: 6 }), '攻击 6');
  assert.equal(intentText({ kind: 'attack', amount: 5, times: 2 }), '攻击 5×2');
  assert.equal(intentText({ kind: 'attack', amount: 15, note: '冲撞' }), '冲撞 · 攻击 15');
  assert.equal(intentText({ kind: 'block', amount: 6 }), '格挡 6');
  assert.equal(intentText({ kind: 'buff', status: 'strength', amount: 2 }), '力量 +2');
  assert.equal(intentText({ kind: 'debuff', status: 'drained', amount: 2, note: '巡视' }), '巡视 · 你 +2 枯竭');
  assert.equal(intentText({ kind: 'pollute', amount: 1 }), '落灰');
  assert.equal(intentText({ kind: 'pollute', amount: 3 }), '落灰 ×3');
  assert.equal(intentText({ kind: 'drain', amount: 2 }), '枯竭 2');
  assert.equal(intentText({ kind: 'ward', amount: 3 }), '同僚格挡 3');
  assert.equal(intentText({ kind: 'bury', amount: 1, note: '翻找' }), '翻找 · 掩埋 1');
  assert.equal(intentText({ kind: 'summon', id: 'shadewolf', note: '嚎叫' }), '嚎叫 · 召唤 影狼');
  assert.equal(intentText({ kind: 'devour', note: '吞光 · 吃下 4 层' }), '吞光 · 吃下 4 层');
  assert.equal(intentText({ kind: 'devour' }), '吞光');
  assert.equal(intentText({ kind: 'steal', status: 'ember', note: '窃火' }), '窃火 · 窃取 余烬');
  assert.equal(intentText({ kind: 'special', note: '换岗' }), '换岗');
});

test('isValidBattle 拒绝损坏的存档', () => {
  const s = startBattle('ch1-1', 'blade', 201);
  assert.equal(isValidBattle(s), true);
  for (const broken of [
    null, undefined, 42, 'battle', {},
    { ...s, version: 2 },
    { ...s, encounterId: 'ch9-9' },
    { ...s, deck: 'lantern' },
    { ...s, phase: 'drawing' },
    { ...s, turn: 0 },
    { ...s, seed: 1.5 },
    { ...s, player: { ...s.player, hp: 61 } },
    { ...s, player: { ...s.player, hp: -1 } },
    { ...s, player: { ...s.player, maxHp: 99 } },
    { ...s, player: { ...s.player, energyPerTurn: 4 } },
    { ...s, player: { ...s.player, statuses: { ember: -2 } } },
    { ...s, player: { ...s.player, statuses: { nope: 1 } } },
    { ...s, enemies: [] },
    { ...s, enemies: [{ ...s.enemies[0], id: 'nosuchwolf' }] },
    { ...s, enemies: [{ ...s.enemies[0], hp: 99 }] },
    { ...s, hand: [...s.hand, ...Array.from({ length: 6 }, (_, i) => ({ uid: `extra-${i}`, cardId: 'ash' }))] },
    { ...s, draw: [...s.draw, { ...s.draw[0] }] },
    { ...s, hand: [{ uid: 'x', cardId: 'not-a-card' }] },
    { ...s, log: [{ id: 1, text: 'x', tone: 'silly' }] },
    { ...s, powers: { ...s.powers, turnBlock: -1 } },
  ]) {
    assert.equal(isValidBattle(broken), false, `本该拒绝：${JSON.stringify(broken)?.slice(0, 60)}`);
  }
});
