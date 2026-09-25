/**
 * 战斗页配乐的谱面契约，和 `src/world/soundscape.test.ts` 同构。
 *
 * 调度器以 `melody[bar][slot]` 和 `chord[arpeggio[slot]]` 索引，**没有任何边界检查**——所以一行短了
 * 不是「弹错一个音」，是 `undefined` 进振荡器，整条时间轴当场抛错。而一个写错的音高在几百个数字里
 * 是看不出来的，在耳朵里则躲不掉。这两件事都靠这里变成一条红测试。
 *
 * ⚠️ **谱面是「段落 + 曲式」，不是一条长表。** 所以这里几乎每一条都要走 `barsOf()` 摊平之后再查：
 * 材料在 `sections` 里，长度在 `form` 里，**材料的总和不是曲子的长度**。直接 `score.sections.A.chords`
 * 去数小节，量到的是那一段，不是这一首。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BATTLE_SCORES, DRUM_CHARS, barsOf, bassRow, carryTick, drumRow, loopSeconds, loopTicks,
  parseBattleScore, scoreForMood, totalBars, type BattleMood, type BattleScore,
} from './battleScores.ts';

/** 最低与最高音。再低笔记本喇叭上只剩糊，再高八度泛音就从「亮」变成「刺」。 */
const FLOOR = 24, CEILING = 96;

const find = (id: string): BattleScore => {
  const score = BATTLE_SCORES.find(entry => entry.id === id);
  assert.ok(score, `没有一首曲子叫 ${id}`);
  return score;
};

test('每一首都是一张完整的谱子', () => {
  for (const score of BATTLE_SCORES) {
    assert.ok(score.form.length > 0, `${score.id} 没有曲式`);
    for (const name of score.form) {
      assert.ok(score.sections[name], `${score.id} 的曲式里有一个不存在的段落「${name}」`);
    }
    // 写出来却没排进曲式的段落是**死材料**：它不占任何长度，所以不会有别的测试发现它。
    for (const name of Object.keys(score.sections)) {
      assert.ok(score.form.includes(name), `${score.id} 的「${name}」段写出来了却从没被排进曲式`);
    }

    for (const [name, section] of Object.entries(score.sections)) {
      const bars = section.chords.length;
      assert.ok(bars > 0, `${score.id} 的 ${name} 段一个小节都没有`);
      assert.equal(section.melody.length, bars, `${score.id} 的 ${name} 段有 ${bars} 个小节，却有 ${section.melody.length} 行旋律`);
      assert.equal(section.arpeggio.length, score.steps, `${score.id} 的 ${name} 段琶音有 ${section.arpeggio.length} 格，一小节是 ${score.steps} 格`);
      for (let bar = 0; bar < bars; bar++) {
        assert.equal(section.melody[bar].length, score.steps, `${score.id} 的 ${name} 段第 ${bar + 1} 小节旋律有 ${section.melody[bar].length} 格`);
        assert.ok(section.chords[bar].length >= 3, `${score.id} 的 ${name} 段第 ${bar + 1} 小节不是三和弦`);
        // 琶音里 `-1` 是空拍，其余必须是和弦里真的有的那个音。
        for (const tone of section.arpeggio) assert.ok(tone < section.chords[bar].length, `${score.id} 的 ${name} 段第 ${bar + 1} 小节的琶音伸到和弦外面去了`);
      }

      // 低音与鼓**允许两种写法**（一行 = 每小节都用，或逐小节表），所以要归一之后逐小节查——
      // 「一行写法被当成了逐小节表」在播放器里的表现是整段低音消失，而它不会抛任何错。
      for (let bar = 0; bar < bars; bar++) {
        const bass = bassRow(section, bar);
        if (bass) assert.equal(bass.length, score.steps, `${score.id} 的 ${name} 段第 ${bar + 1} 小节低音是 ${bass.length} 格，一小节是 ${score.steps} 格`);
        const drums = drumRow(section, bar);
        if (drums) {
          assert.ok(drums.length <= score.steps, `${score.id} 的 ${name} 段第 ${bar + 1} 小节鼓是 ${drums.length} 格，超过了 ${score.steps}`);
          for (const hit of drums) assert.ok(DRUM_CHARS.includes(hit), `${score.id} 的 ${name} 段鼓里有一个不认识的字符「${hit}」`);
        }
      }

      if (section.harmony) {
        assert.equal(section.harmony.length, bars, `${score.id} 的 ${name} 段对位有 ${section.harmony.length} 行，小节是 ${bars}`);
        // 对位和鼓一样允许**短行**：`[]` 就是「这一段不进来」，而播放器那边是 `?.` 安全索引。
        // 旋律不行——它是 `melody[bar][slot]` 无保护索引，短一格就是 undefined 进振荡器。
        for (const row of section.harmony) assert.ok(row.length <= score.steps, `${score.id} 的 ${name} 段有一行对位是 ${row.length} 格`);
      }
    }

    // 钟记的是**整首曲子里**的小节号（`barsOf` 摊平之后那个），不是段内的。
    for (const bar of score.bells ?? []) assert.ok(bar < totalBars(score), `${score.id} 在第 ${bar + 1} 小节敲钟，那一小节不存在`);
  }
});

test('每首曲子的每一个音都在它自己声明的调式与音域里', () => {
  for (const score of BATTLE_SCORES) {
    const playable = (midi: number, what: string) => {
      assert.ok(Number.isInteger(midi), `${score.id} 的 ${what} 不是整数音高：${midi}`);
      assert.ok(midi >= FLOOR && midi <= CEILING, `${score.id} 的 ${what} 是 MIDI ${midi}，落在 ${FLOOR}..${CEILING} 之外`);
      assert.ok(score.mode.includes(((midi % 12) + 12) % 12), `${score.id} 的 ${what} 是 MIDI ${midi}，不在它声明的调式里`);
    };
    // ⚠️ 走摊平后的曲式：同一段材料在曲式里回来几次，就该被查几次——但**查的是同一次**，
    // 所以这里量不到「某一遍弹错了」这种错（那种错在这里根本不存在，谱面是数据）。
    for (const { section, sectionBar, bar } of barsOf(score)) {
      const chord = section.chords[sectionBar];
      chord.forEach((tone, i) => {
        playable(tone, `第 ${bar + 1} 小节和弦第 ${i + 1} 音`);
        // 调度器还会把根音降八度铺成持续低音。
        if (i === 0) playable(tone - 12, `第 ${bar + 1} 小节低音`);
      });
      section.melody[sectionBar].forEach((tone, slot) => {
        if (tone) { playable(tone, `第 ${bar + 1} 小节第 ${slot + 1} 格`); playable(tone + 12, `第 ${bar + 1} 小节第 ${slot + 1} 格的八度泛音`); }
      });
      section.harmony?.[sectionBar]?.forEach((tone, slot) => {
        if (tone) playable(tone, `第 ${bar + 1} 小节第 ${slot + 1} 格的对位`);
      });
      // 低音那一轨存的是**相对根音的半音数**，所以真正响出来的音高要先把根音加上去再降八度；
      // 校验的必须是那个**真的会响的音**，否则这一层等于没被守。
      bassRow(section, sectionBar)?.forEach((offset, slot) => {
        if (offset >= 0) playable(chord[0] + offset - 12, `第 ${bar + 1} 小节第 ${slot + 1} 格的低音`);
      });
    }
  }
});

test('战斗的曲子有鼓和会走的低音，待机与营火没有鼓', () => {
  // ⚠️ 这一条钉的是用户听过之后提的那个问题：「太单调」。单调的**根因**是每小节同一个配方，
  // 而鼓和一条独立的低音线是最直接的两个解药——所以它们不能被后来的人当装饰删掉。
  for (const id of [scoreForMood('fight'), scoreForMood('boss')]) {
    const score = find(id);
    let hits = 0, lows = 0;
    const characters = new Set<string>();
    for (const { section, sectionBar } of barsOf(score)) {
      const drums = drumRow(section, sectionBar);
      if (drums) for (const hit of drums) if (hit !== '-') { hits++; characters.add(hit); }
      const bass = bassRow(section, sectionBar);
      if (bass) lows += bass.filter(offset => offset >= 0).length;
    }
    assert.ok(hits > 30, `${id} 全曲只有 ${hits} 下鼓，那不叫节奏`);
    assert.ok(lows > 0, `${id} 没有低音线`);
    // 一套鼓组至少要有「踩」和「打」两件，否则那是音效不是节奏。
    assert.ok(characters.has('k') && characters.has('s'), `${id} 的鼓里没有底鼓或军鼓，只有 ${[...characters].join('')}`);
  }
  // 待机与营火**不该有鼓**：玩家在这两处会停很久，而任何有脉搏的东西听三遍就开始催人。
  for (const id of [scoreForMood('tower'), scoreForMood('rest')]) {
    for (const { section, sectionBar, bar } of barsOf(find(id))) {
      assert.equal(drumRow(section, sectionBar), undefined, `${id} 第 ${bar + 1} 小节不该有鼓`);
    }
  }
});

test('四首都有空间感，塔上最空、营火最近', () => {
  // 「没有氛围」的根因是每颗音只有一条直达通路。混响与回声是那条第二条通路，所以它们必须有值，
  // 而且**不能都一样**——四首都开同一个量，等于四首都不开。
  const space = (id: string) => find(id).timbre.space ?? 0;
  const echo = (id: string) => find(id).timbre.echo ?? 0;
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
  //
  // 「驱动」在这里是一个具体的结构：**琶音每一格都在响**（一次都不休息）的小节占多少。
  // 一条长表时它是个布尔，现在曲子有段落了，所以它是**比例**——战斗曲里推进段占大头，
  // 而喘息段本来就不该有驱动，那正是它存在的理由。
  const driving = (id: string) => {
    const bars = barsOf(find(id));
    return bars.filter(({ section }) => section.arpeggio.every(tone => tone >= 0)).length / bars.length;
  };
  assert.ok(driving(scoreForMood('fight')) > .5, `寻常战斗只有 ${(driving(scoreForMood('fight')) * 100).toFixed(0)}% 的小节有驱动，一场仗会显得没有推进`);
  assert.equal(driving(scoreForMood('boss')), 0, '守望者那一首不该有稳定的驱动——它是留白，不是推进');
  assert.equal(driving(scoreForMood('tower')), 0, '塔上待机不该有驱动');
  assert.equal(driving(scoreForMood('rest')), 0, '营火不该有驱动');
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

test('两首战斗曲三分钟以上，塔上与营火仍然是短的一圈', () => {
  // 「每首大概多长」是有答案的：曲式摊平之后的小节 × 每小节格数 × 每格秒数。这条把答案钉住，
  // 也让**改动速度或段落数而没意识到曲子长度变了**的人能在这里看到它。
  //
  // ⚠️ 前两轮的规矩是**反的**：那时要求「每一首都比一场仗短」（18..60 秒），因为曲子只是循环的
  // 氛围。用户后来提的是两首战斗曲要**三分钟以上**，所以战斗那两首的下限在这里，上限已经不在
  // 60 秒。塔上与营火仍然短——玩家在那两处的停留是「一件事」，不是一段推进。
  const report = BATTLE_SCORES.map(s => `${s.name} ${loopSeconds(s).toFixed(1)}s`).join(' · ');

  for (const id of [scoreForMood('tower'), scoreForMood('rest')]) {
    const seconds = loopSeconds(find(id));
    assert.ok(seconds > 18 && seconds < 60, `${id} 一圈 ${seconds.toFixed(1)} 秒，待机与营火该落在 18..60（${report}）`);
  }
  for (const id of [scoreForMood('fight'), scoreForMood('boss')]) {
    const seconds = loopSeconds(find(id));
    assert.ok(seconds >= 180, `${id} 只有 ${seconds.toFixed(1)} 秒，战斗曲要三分钟以上（${report}）`);
    assert.ok(seconds < 480, `${id} 长到 ${seconds.toFixed(1)} 秒，一轮没打完它就要回头重来（${report}）`);
  }

  // 长度必须是**曲式摊平**出来的，不是材料的总和。这一条把 `loopTicks` 与 `barsOf` 钉在一起：
  // 段落写多了而曲式没排，长度不该变。
  for (const score of BATTLE_SCORES) {
    assert.equal(totalBars(score), barsOf(score).length, `${score.id} 的 totalBars 与 barsOf 对不上`);
    assert.equal(loopTicks(score), totalBars(score) * score.steps, `${score.id} 的 loopTicks 与小节数对不上`);
    assert.equal(loopSeconds(score), loopTicks(score) * score.step);
  }
});

test('三分钟不是同一段听八遍 —— 战斗曲是曲式，不是一条长表', () => {
  // 这条是上一轮重写的**全部理由**。二十五秒的表乘八倍还是那八小节听八遍，所以战斗曲换了结构：
  // 材料按段落放，`form` 说怎么排。这里钉住的是「曲式真的在做曲式该做的事」。
  for (const id of [scoreForMood('fight'), scoreForMood('boss')]) {
    const score = find(id);
    const used = new Set(score.form);

    // 一、材料要够。两段材料排三分钟，怎么排都是同一段听八遍。
    assert.ok(used.size >= 3, `${id} 的曲式只用到 ${used.size} 段材料——那是变奏，不是曲式`);

    // 二、**不能是更短的循环重复出来的**。这一条就是「不能是单纯循环」的机检版本：
    // 找得到周期，说明整首曲子是那几段在打转，长度只是把同一件事拉长了。
    const period = (() => {
      for (let p = 1; p < score.form.length; p++) {
        if (score.form.length % p === 0 && score.form.every((name, i) => name === score.form[i % p])) return p;
      }
      return score.form.length;
    })();
    assert.equal(period, score.form.length, `${id} 的曲式是前 ${period} 段的循环——那正是这一轮要摆脱的东西`);

    // 三、**至少要有一次「喘」**：整段没有鼓。没有它，三分钟就是三分钟的响，而一直响等于不响。
    const breathers = score.form.filter(name => !score.sections[name].drums);
    assert.ok(breathers.length >= 1, `${id} 从头响到尾，一次都没停过`);

    // 四、段落之间要**听得出差别**。音色和音量是这里唯一能机检的两样（和弦与鼓的差别太细，
    // 判不出真问题只产噪声）：一条曲式里如果只有一两种音量，它和没有段落是一回事。
    assert.ok(new Set(score.form.map(name => score.sections[name].gain ?? 1)).size >= 3,
      `${id} 的段落音量只有 ${new Set(score.form.map(name => score.sections[name].gain ?? 1)).size} 种，段落之间听不出差别`);
    assert.ok(new Set(score.form.map(name => JSON.stringify(score.sections[name].timbre ?? {}))).size >= 3,
      `${id} 的段落音色变化太少，换段听起来还是同一件乐器`);
  }
});
