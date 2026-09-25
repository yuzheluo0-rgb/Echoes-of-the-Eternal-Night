/**
 * 战斗页配乐的谱面契约，和 `src/world/soundscape.test.ts` 同构。
 *
 * 调度器以 `melody[bar][slot]` 和 `chord[arpeggio[slot]]` 索引，**没有任何边界检查**——所以一行短了
 * 不是「弹错一个音」，是 `undefined` 进振荡器，整条时间轴当场抛错。而一个写错的音高在几百个数字里
 * 是看不出来的，在耳朵里则躲不掉。这两件事都靠这里变成一条红测试。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BATTLE_SCORES, carryTick, loopSeconds, loopTicks, parseBattleScore, scoreForMood, type BattleMood,
} from './battleScores.ts';

/** 最低与最高音。再低笔记本喇叭上只剩糊，再高八度泛音就从「亮」变成「刺」。 */
const FLOOR = 24, CEILING = 96;

test('每一首都是一张完整的谱子', () => {
  for (const score of BATTLE_SCORES) {
    const bars = score.chords.length;
    assert.ok(bars > 0, `${score.id} 一个小节都没有`);
    assert.equal(score.melody.length, bars, `${score.id} 有 ${bars} 个小节却有 ${score.melody.length} 行旋律`);
    assert.equal(score.arpeggio.length, score.steps, `${score.id} 的琶音有 ${score.arpeggio.length} 格，一小节是 ${score.steps} 格`);
    for (let bar = 0; bar < bars; bar++) {
      assert.equal(score.melody[bar].length, score.steps, `${score.id} 第 ${bar + 1} 小节的旋律有 ${score.melody[bar].length} 格`);
      assert.ok(score.chords[bar].length >= 3, `${score.id} 第 ${bar + 1} 小节不是三和弦`);
      for (const tone of score.arpeggio) assert.ok(tone < score.chords[bar].length, `${score.id} 第 ${bar + 1} 小节的琶音伸到和弦外面去了`);
    }
    for (const bar of score.bells ?? []) assert.ok(bar < bars, `${score.id} 在第 ${bar + 1} 小节敲钟，那一小节不存在`);

    // 新加的四层同样没有边界检查：低音和鼓都是一行一行按小节取的，行数对不上就是 `undefined` 进
    // 调度器，而短一行的那一首会在爬过某一个楼层之后突然抛错。
    if (score.bass) {
      assert.equal(score.bass.length, bars, `${score.id} 的低音有 ${score.bass.length} 行，小节是 ${bars}`);
      for (const row of score.bass) assert.equal(row.length, score.steps, `${score.id} 有一行低音是 ${row.length} 格，一小节是 ${score.steps} 格`);
    }
    if (score.drums) {
      assert.equal(score.drums.length, bars, `${score.id} 的鼓有 ${score.drums.length} 行，小节是 ${bars}`);
      for (const row of score.drums) {
        assert.ok(row.length <= score.steps, `${score.id} 有一行鼓是 ${row.length} 格，超过了 ${score.steps}`);
        for (const hit of row) assert.ok('kshox-'.includes(hit), `${score.id} 的鼓里有一个不认识的字符「${hit}」`);
      }
    }
    if (score.harmony) {
      assert.equal(score.harmony.length, bars, `${score.id} 的对位有 ${score.harmony.length} 行，小节是 ${bars}`);
      // 对位和鼓一样允许**短行**：`[]` 就是「这一小节不进来」，而播放器那边是 `?.` 安全索引。
      // 旋律不行——它是 `melody[bar][slot]` 无保护索引，短一格就是 undefined 进振荡器。
      for (const row of score.harmony) assert.ok(row.length <= score.steps, `${score.id} 有一行对位是 ${row.length} 格`);
    }
  }
});

test('每首曲子的每一个音都在它自己声明的调式与音域里', () => {
  for (const score of BATTLE_SCORES) {
    const playable = (midi: number, what: string) => {
      assert.ok(Number.isInteger(midi), `${score.id} 的 ${what} 不是整数音高：${midi}`);
      assert.ok(midi >= FLOOR && midi <= CEILING, `${score.id} 的 ${what} 是 MIDI ${midi}，落在 ${FLOOR}..${CEILING} 之外`);
      assert.ok(score.mode.includes(((midi % 12) + 12) % 12), `${score.id} 的 ${what} 是 MIDI ${midi}，不在它声明的调式里`);
    };
    score.chords.forEach((chord, bar) => chord.forEach((tone, i) => {
      playable(tone, `第 ${bar + 1} 小节和弦第 ${i + 1} 音`);
      // 调度器还会把根音降八度铺成持续低音。
      if (i === 0) playable(tone - 12, `第 ${bar + 1} 小节低音`);
    }));
    score.melody.forEach((bar, index) => bar.forEach((tone, slot) => {
      if (tone) { playable(tone, `第 ${index + 1} 小节第 ${slot + 1} 格`); playable(tone + 12, `第 ${index + 1} 小节第 ${slot + 1} 格的八度泛音`); }
    }));
    score.harmony?.forEach((bar, index) => bar.forEach((tone, slot) => {
      if (tone) playable(tone, `第 ${index + 1} 小节第 ${slot + 1} 格的对位`);
    }));
    // 低音那一轨存的是**相对根音的半音数**，所以真正响出来的音高要先把根音加上去再降八度；
    // 校验的必须是那个**真的会响的音**，否则这一层等于没被守。
    score.bass?.forEach((bar, index) => bar.forEach((offset, slot) => {
      if (offset >= 0) playable(score.chords[index][0] + offset - 12, `第 ${index + 1} 小节第 ${slot + 1} 格的低音`);
    }));
  }
});

test('战斗的曲子有鼓和会走的低音，待机与营火没有鼓', () => {
  // ⚠️ 这一条钉的是用户听过之后提的那个问题：「太单调」。单调的**根因**是每小节同一个配方，
  // 而鼓和一条独立的低音线是最直接的两个解药——所以它们不能被后来的人当装饰删掉。
  const score = (id: string) => BATTLE_SCORES.find(entry => entry.id === id)!;
  for (const id of [scoreForMood('fight'), scoreForMood('boss')]) {
    assert.ok(score(id).drums, `${id} 没有鼓——一场仗会重新变得平`);
    assert.ok(score(id).bass, `${id} 没有低音线`);
    const hits = score(id).drums!.join('').replace(/-/g, '').length;
    assert.ok(hits > 30, `${id} 全曲只有 ${hits} 下鼓，那不叫节奏`);
  }
  // 待机与营火**不该有鼓**：玩家在这两处会停很久，而任何有脉搏的东西听三遍就开始催人。
  assert.equal(score(scoreForMood('tower')).drums, undefined, '塔上待机不该有鼓');
  assert.equal(score(scoreForMood('rest')).drums, undefined, '营火不该有鼓');
});

test('四首都有空间感，塔上最空、营火最近', () => {
  // 「没有氛围」的根因是每颗音只有一条直达通路。混响与回声是那条第二条通路，所以它们必须有值，
  // 而且**不能都一样**——四首都开同一个量，等于四首都不开。
  const space = (id: string) => BATTLE_SCORES.find(entry => entry.id === id)!.timbre.space ?? 0;
  const echo = (id: string) => BATTLE_SCORES.find(entry => entry.id === id)!.timbre.echo ?? 0;
  for (const score of BATTLE_SCORES) {
    assert.ok(space(score.id) > 0, `${score.id} 一点混响都没有`);
    assert.ok(echo(score.id) > 0, `${score.id} 一点回声都没有`);
  }
  assert.ok(space(scoreForMood('tower')) > space(scoreForMood('fight')),
    '塔上应当比战斗更空——那是「高处」的声音');
  assert.ok(echo(scoreForMood('rest')) > echo(scoreForMood('fight')),
    '营火的回声该比战斗更明显：那里安静，尾巴才听得见');
});

test('四首曲子各就各位，而且一个页面都不会静音', () => {
  assert.equal(new Set(BATTLE_SCORES.map(score => score.id)).size, BATTLE_SCORES.length, '曲目 id 不能重复');
  for (const score of BATTLE_SCORES) assert.equal(parseBattleScore(score.id), score.id);

  // 四个相位各有各的曲子，而且**互不相同**——两处放同一首就等于少做了一首。
  const moods: BattleMood[] = ['tower', 'fight', 'boss', 'rest'];
  const picked = moods.map(scoreForMood);
  assert.equal(new Set(picked).size, moods.length, `四个相位里有重复的曲子：${picked.join(' ')}`);
  for (const id of picked) assert.ok(BATTLE_SCORES.some(score => score.id === id), `相位指向了一首不存在的曲子：${id}`);

  // 旧的或手改过的偏好只能回落到一首存在的曲子，否则页面会安静地没有声音，而界面上没有任何解释。
  for (const junk of [null, undefined, '', 'nope', 'tower ']) assert.equal(parseBattleScore(junk), BATTLE_SCORES[0].id);
});

test('战斗的曲子有驱动，待机与营火没有', () => {
  // 这不是风格偏好，是这两类页面**停留时间不同**的后果：一场仗三到六个回合，一段待机可能很久。
  // 有驱动的曲子听三遍开始催人，而玩家在塔上会停很久。
  const driving = (id: string) => {
    const score = BATTLE_SCORES.find(s => s.id === id)!;
    // 「驱动」在这里是一个具体的结构：琶音每一格都在响（一次都不休息）。
    return score.arpeggio.every(tone => tone >= 0);
  };
  assert.equal(driving(scoreForMood('fight')), true, '寻常战斗没有驱动，一场仗会显得没有推进');
  assert.equal(driving(scoreForMood('boss')), false, '守望者那一首不该有稳定的驱动——它是留白，不是推进');
  assert.equal(driving(scoreForMood('tower')), false, '塔上待机不该有驱动');
  assert.equal(driving(scoreForMood('rest')), false, '营火不该有驱动');
});

test('换曲接着上次放，不从头开始', () => {
  // ⚠️ 用户提的：一首比一场仗长，而每场仗都从头开始。这条钉的是**位置的保留**——
  // 它是四行 Map 操作，但错了的表现是「听起来又重来了」，而那是耳朵才抓得到的错。
  const ticks = new Map<string, number>();
  // 塔上放到第 40 格，切进战斗。
  assert.equal(carryTick(ticks, 'tower', 40, 'emberline'), 0, '第一次进战斗应当从头放');
  // 战斗放到第 91 格，回塔上——**接着第 40 格，不是 0**。
  assert.equal(carryTick(ticks, 'emberline', 91, 'tower'), 40, '回塔上时没有接着上次的位置');
  // 再进战斗，接着第 91 格。
  assert.equal(carryTick(ticks, 'tower', 77, 'emberline'), 91, '再进战斗时没有接着上次的位置');
  // 每一首各记各的：上面那两次切换没有把对方的位置冲掉。
  assert.equal(ticks.get('tower'), 77);
  assert.equal(ticks.get('emberline'), 91);
  // 没放过的曲子从 0 开始。
  assert.equal(carryTick(ticks, 'tower', 5, 'campfire'), 0);
});

test('每一首都比一场仗短 —— 所以循环与续放都得靠得住', () => {
  // 「每首大概多长」是有答案的：小节 × 每小节格数 × 每格秒数。这条把答案钉住，也让**改动速度或小节数
  // 而没意识到曲子长度变了**的人能在这里看到。
  const length = (id: string) => loopSeconds(BATTLE_SCORES.find(s => s.id === id)!);
  const report = BATTLE_SCORES.map(s => `${s.name} ${length(s.id).toFixed(1)}s`).join(' · ');
  for (const score of BATTLE_SCORES) {
    const seconds = length(score.id);
    assert.ok(seconds > 18 && seconds < 60, `${score.id} 一圈 ${seconds.toFixed(1)} 秒，落在 18..60 之外（${report}）`);
    assert.equal(loopTicks(score), score.chords.length * score.steps);
  }
  // 战斗那一首不能太短：一场仗通常三到六分钟，二十秒一圈要听十遍。
  assert.ok(length(scoreForMood('fight')) >= 22, `战斗曲只有 ${length(scoreForMood('fight')).toFixed(1)} 秒，一场仗要听太多遍`);
});
