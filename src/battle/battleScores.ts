/**
 * 战斗页的配乐 —— **谱面数据，不是音频文件**，和 `src/world/worldScores.ts` 同一套做法：
 * 一首曲子是一张和弦表、几条音轨和几个音色选择，由 `src/audio.ts` 现场合成。加一首曲子不增加任何下载。
 *
 * 四首曲子按**页面的相位**分：塔上待机 / 寻常的战斗 / 守望者 / 营火。分相位而不是分页面，是因为
 * 玩家在塔上做的事只有这四类，而「在哪儿」这件事对情绪的影响比「点了哪个按钮」大得多。
 *
 * **四首都以 D 为家**（和世界地图那两首一样）：塔上是 D 多利亚、战斗是 D 小调（两个六度都在）、
 * 守望者把 D 压成弗里吉亚（降二度）、营火是 D 大调。共用一个主音，切歌时世界不会突然换到另一个调上。
 *
 * ⚠️ **这个文件必须是纯数据。** `node --experimental-strip-types` 是 strip-only 的，合成器那边迟早
 * 会用上 TS 的参数属性（`WorldSoundscape` 就是这么把谱面拆出去的），所以校验谱面的测试只能 import
 * 这一个文件。类型是 `import type` —— 编译期擦掉，运行时**不解析** `src/world/**`。
 *
 * ⚠️ **第一版这四首是「单调、偏慢、没有氛围」的**，用户听过之后点的。根因不在参数上，在格式上：
 * 世界的谱面只有五层，每小节都是同一个配方（和弦＋持续根音＋琶音＋旋律），所以必然平；而氛围要的那个
 * 附点八分回声，格式里**根本不存在**。`BattleScore` 因此补了四层（见下面那个接口），四首曲子也全部
 * 重写：**快了一档、多了一条会走的低音和一条鼓、并且有了段落**——第八小节和第十二小节把鼓撤掉，
 * 那是电子乐里最省事也最有效的对比。
 */
import type { Score } from '../world/worldScores';

/**
 * 四层在世界的谱面上**不存在**的东西。加在这里而不是改 `Score`，是因为那两首曲子没在写这些层，
 * 一个世界里永远为空的字段会让类型开始说谎：
 *
 *   - **单调**的根因是每小节同一个配方。所以要有**会走的低音**和**鼓**——两条独立的时间线，
 *     而不是把同一条琶音换个音色。段落对比靠**某些小节把鼓撤掉**。
 *   - **没有氛围**的根因是每颗音都只有一条直达通路。所以要有 `space`（混响送出）和 `echo`
 *     （延迟送出）——电子乐的空气感几乎全部来自那条**附点八分的回声**。
 */
export interface BattleScore extends Score {
  /**
   * 低音，每小节 `steps` 格，值是**相对该小节和弦根音的半音数**（0 = 根音，12 = 高八度）。
   * **`-1` 是空拍。** 写相对值而不是绝对音高，是因为低音线九成是「同一个动作换一个和弦」，
   * 写绝对音高等于把同一个型抄十六遍，改一个音要改十六处。
   */
  bass?: number[][];
  /**
   * 鼓，每小节 `steps` 个字符，一格一个：
   *   `k` 底鼓 · `s` 军鼓 · `h` 闭镲 · `o` 开镲 · `x` 拍手 · `-` 空
   * 短于 `steps` 的行按空拍补齐，所以 `''` 就是**这一小节没有鼓**——段落对比最省事的写法。
   */
  drums?: string[];
  /** 第二声部（对位），和 `melody` 一样是绝对音高、按格走。 */
  harmony?: number[][];
  timbre: Score['timbre'] & {
    /** 混响送出量 0..1。 */
    space?: number;
    /** 延迟送出量 0..1。延迟时间由 `step` 推成**附点八分**，那是电子乐默认的呼吸长度。 */
    echo?: number;
  };
}

/** 低音那一轨的写法：相对根音的半音数，`-1` 是空拍。 */
const REST = -1;

/**
 * 燎原 / Emberline. D 小调（两个六度都在），4/4，四分音符 = **152**，十六格（十六分音符），
 * 十六小节。寻常遭遇战的曲子。
 *
 * 它是这套里唯一**有稳定驱动**的：底鼓踩 1、3，军鼓踩 2、4，闭镲走十六分，低音是八分脉冲——
 * 四条线各走各的，所以十六小节不腻。和第一版比，它快了 14 BPM、多了一整条鼓和一条会走的低音，
 * 而**第八与第十二小节把鼓全部撤掉**：音乐一停，玩家才听见自己刚做了什么。
 */
const EMBERLINE: BattleScore = {
  id: 'emberline', name: '燎原', note: 'D 小调 · 4/4 · 152 · 十六分驱动与方波主奏',
  step: 60 / 152 / 4, steps: 16,
  chords: [
    [50, 57, 65], [46, 53, 62], [53, 60, 69], [48, 55, 64],
    [50, 57, 65], [46, 53, 62], [43, 50, 58], [45, 52, 61],
    [50, 57, 65], [46, 53, 62], [53, 60, 69], [48, 55, 64],
    [43, 50, 58], [46, 53, 62], [45, 52, 61], [50, 57, 65],
  ],
  // 八分脉冲，第三拍后半抬八度。
  bass: [
    [0, REST, 0, REST, 0, REST, 0, REST, 0, REST, 0, REST, 12, REST, 0, REST],
    [0, REST, 0, REST, 0, REST, 0, REST, 0, REST, 0, REST, 12, REST, 0, REST],
    [0, REST, 0, REST, 0, REST, 0, REST, 0, REST, 0, REST, 12, REST, 0, REST],
    [0, REST, 0, REST, 0, REST, 0, REST, 0, REST, 0, REST, 12, REST, 7, REST],
    [0, REST, 0, REST, 0, REST, 0, REST, 0, REST, 0, REST, 12, REST, 0, REST],
    [0, REST, 0, REST, 0, REST, 0, REST, 0, REST, 0, REST, 12, REST, 0, REST],
    [0, REST, 0, REST, 0, REST, 0, REST, 0, REST, 0, REST, 12, REST, 7, REST],
    [0, REST, 0, REST, 0, REST, 0, REST, 0, REST, 0, REST, 12, REST, 0, REST],
    // 撤鼓那两小节连低音也放成四分，让「停」是整条节奏线的停，不是少了一层。
    [0, REST, REST, REST, 0, REST, REST, REST, 0, REST, REST, REST, 0, REST, REST, REST],
    [0, REST, 0, REST, 0, REST, 0, REST, 0, REST, 0, REST, 12, REST, 0, REST],
    [0, REST, 0, REST, 0, REST, 0, REST, 0, REST, 0, REST, 12, REST, 0, REST],
    [0, REST, 0, REST, 0, REST, 0, REST, 0, REST, 0, REST, 12, REST, 7, REST],
    [0, REST, 0, REST, 0, REST, 0, REST, 0, REST, 0, REST, 12, REST, 0, REST],
    [0, REST, 0, REST, 0, REST, 0, REST, 0, REST, 0, REST, 12, REST, 0, REST],
    [0, REST, 0, REST, 0, REST, 0, REST, 0, REST, 0, REST, 12, REST, 7, REST],
    [0, REST, 0, REST, 0, REST, 0, REST, 0, REST, 0, REST, 12, REST, 0, REST],
  ],
  drums: [
    'k-hhs-hhk-hhs-hh', 'k-hhs-hhk-hhs-hh', 'k-hhs-hhk-hhs-hh', 'k-hhs-hhk-hhs-so',
    'k-hhs-hhk-hhs-hh', 'k-hhs-hhk-hhs-hh', 'k-hhs-hhk-hhs-hh', 'khhskhhs-khhskhh',
    '', '', 'k-hhs-hhk-hhs-hh', 'k-hhs-hhk-hhs-hh',
    'k-hhs-hhk-hhs-hh', 'k-hhs-hhk-hhs-hh', 'k-hhs-hhk-hhs-hh', 'k-hhs-hhk-hhs-ss',
  ],
  melody: [
    [0, 0, 0, 0, 74, 0, 0, 0, 0, 0, 77, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 72, 0, 0, 0, 74, 0, 0, 0],
    [0, 0, 0, 0, 69, 0, 0, 0, 0, 0, 72, 0, 0, 0, 0, 0],
    [74, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 74, 0, 0, 0, 0, 0, 77, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 79, 0, 0, 0, 81, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 77, 0, 0, 0, 74, 0, 0, 0],
    [72, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 81, 0, 0, 0, 0, 0, 84, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 82, 0, 0, 0, 81, 0, 0, 0],
    [0, 0, 0, 0, 79, 0, 0, 0, 0, 0, 77, 0, 0, 0, 0, 0],
    [76, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 74, 0, 0, 0, 0, 0, 77, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 79, 0, 0, 0, 81, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 82, 0, 0, 0, 79, 0, 0, 0],
    [74, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ],
  // 下半段才进来的对位声部——这是「第二段和第一段不一样」的第二个来源（第一个是鼓）。
  harmony: [
    [], [],
    [], [],
    [], [],
    [], [],
    [69, 0, 0, 0, 0, 0, 0, 0, 0, 0, 72, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 74, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 72, 0, 0, 0, 69, 0, 0, 0],
    [67, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [69, 0, 0, 0, 0, 0, 0, 0, 0, 0, 72, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 74, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 76, 0, 0, 0, 72, 0, 0, 0],
    [74, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ],
  arpeggio: [0, 1, 2, 1, 0, 1, 2, 1, 0, 1, 2, 1, 0, 1, 2, 1],
  // D 小调，两个六度都在（自然六度的 C 与和声六度的 C#）。所以这一首既能落在 C 大三和弦上，
  // 也能让 A 大三和弦去推最后一小节——这一类段落要的正是这个。
  mode: [0, 1, 2, 4, 5, 7, 9, 10],
  timbre: { pad: 'sawtooth', lead: 'square', harp: 'triangle', swell: .05, pedal: .9, pluck: .8, bell: 0, space: .20, echo: .28 },
};

/**
 * 长夜之守 / The Watcher at the Door. D 弗里吉亚，4/4，四分音符 = **118**，十六格，十六小节。
 *
 * 守望者那一场。它和寻常战斗的差别**不是更响，是更慢、更低、更空**：鼓走半拍（底鼓在一、军鼓在三），
 * 低音一小节只落两下，旋律每小节一两个音。降二度（Eb）是这首的脾气：它一次次落回主音上面半音的
 * 位置而永远不解决——那就是「他守了太久」的声音。第一版 96 BPM 实测偏拖，提到 118 之后留白还在，
 * 但不再是慢，而是**重**。
 */
const WATCHER: BattleScore = {
  id: 'watcher', name: '长夜之守', note: 'D 弗里吉亚 · 4/4 · 118 · 半拍鼓与低音锯齿',
  step: 60 / 118 / 4, steps: 16,
  chords: [
    [50, 57, 65], [51, 58, 63], [50, 57, 65], [46, 53, 62],
    [50, 57, 65], [51, 58, 63], [43, 50, 58], [48, 55, 63],
    [50, 57, 65], [51, 58, 63], [46, 53, 62], [48, 55, 63],
    [50, 57, 65], [51, 58, 63], [46, 53, 62], [50, 57, 65],
  ],
  // 一小节两下，落在 1 和 3。低音走得越少，它听起来越像在等。
  bass: [
    [0, REST, REST, REST, REST, REST, REST, REST, 0, REST, REST, REST, REST, REST, REST, REST],
    [0, REST, REST, REST, REST, REST, REST, REST, 0, REST, REST, REST, REST, REST, REST, REST],
    [0, REST, REST, REST, REST, REST, REST, REST, 0, REST, REST, REST, REST, REST, REST, REST],
    [0, REST, REST, REST, REST, REST, REST, REST, 0, REST, REST, REST, REST, REST, 12, REST],
    [0, REST, REST, REST, REST, REST, REST, REST, 0, REST, REST, REST, REST, REST, REST, REST],
    [0, REST, REST, REST, REST, REST, REST, REST, 0, REST, REST, REST, REST, REST, REST, REST],
    [0, REST, REST, REST, REST, REST, REST, REST, 0, REST, REST, REST, REST, REST, 7, REST],
    [0, REST, REST, REST, REST, REST, REST, REST, 0, REST, REST, REST, REST, REST, REST, REST],
    [0, REST, REST, REST, REST, REST, REST, REST, REST, REST, REST, REST, REST, REST, REST, REST],
    [0, REST, REST, REST, REST, REST, REST, REST, 0, REST, REST, REST, REST, REST, REST, REST],
    [0, REST, REST, REST, REST, REST, REST, REST, 0, REST, REST, REST, REST, REST, REST, REST],
    [0, REST, REST, REST, REST, REST, REST, REST, 0, REST, REST, REST, REST, REST, 12, REST],
    [0, REST, REST, REST, REST, REST, REST, REST, 0, REST, REST, REST, REST, REST, REST, REST],
    [0, REST, REST, REST, REST, REST, REST, REST, 0, REST, REST, REST, REST, REST, 7, REST],
    [0, REST, REST, REST, REST, REST, REST, REST, 0, REST, REST, 0, REST, REST, REST, REST],
    [0, REST, REST, REST, REST, REST, REST, REST, 0, REST, REST, REST, REST, REST, REST, REST],
  ],
  // 半拍。第九小节整条撤掉——那是这首唯一的「呼一口气」，然后最后一小节用三连的底鼓收。
  drums: [
    'k-------s-------', 'k-------s-------', 'k-------s---h---', 'k-------s-------',
    'k-------s-------', 'k-------s-------', 'k---h---s-------', 'k-------s-----x-',
    '', '', 'k-------s-------', 'k-------s---h---',
    'k-------s-------', 'k---h---s-------', 'k-k-----s---x-x-', 'k-------s-------',
  ],
  melody: [
    [0, 0, 0, 0, 0, 0, 0, 0, 65, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 63, 0, 0, 0],
    [0, 0, 0, 0, 65, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 62, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 65, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 63, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 58, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 60, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 72, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 70, 0, 0, 0, 0],
    [0, 0, 0, 0, 65, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 67, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 65, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 63, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 62, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ],
  harmony: [
    [], [], [], [], [], [], [], [],
    [0, 0, 0, 0, 0, 0, 0, 0, 60, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 58, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 60, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 62, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 58, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 57, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ],
  // 钟只在四个乐句的末尾响，一次都不多——它是「又过了一个晚上」，不是节拍器。
  arpeggio: [0, -1, -1, 1, -1, -1, 2, -1, 0, -1, -1, 1, -1, -1, 2, -1],
  bells: [3, 7, 11, 15],
  mode: [0, 2, 3, 5, 7, 9, 10],
  timbre: { pad: 'sawtooth', lead: 'triangle', harp: 'sine', swell: .22, pedal: .95, pluck: .5, bell: 1, space: .38, echo: .22 },
};

/**
 * 塔上 / On the Tower. D 多利亚，6/8，四分音符 = **92**，八格，十二小节。
 *
 * 爬塔页的待机音乐。它**不能有驱动**——玩家在这一页停留的时间可能很长，而任何有走向的东西听三遍
 * 就开始催人。所以没有鼓、琶音一大半是空的、低音一小节只落一下。让这十二小节不空的是**空间**：
 * 混响和附点回声开到最大，每颗音都留一条尾巴，塔因此听起来是**高的**。多利亚的大六度（B 自然）
 * 是这里唯一的光。
 */
const ON_TOWER: BattleScore = {
  id: 'tower', name: '塔上', note: 'D 多利亚 · 6/8 · 92 · 大空间与稀疏琶音',
  // ⚠️ 6/8 的一小节就是**六格**。改 `steps` 时忘了旋律与琶音还是六格，测试当场抓到
  // 「琶音有 6 格，一小节是 8 格」——这一首从头到尾就是六格的曲子。
  step: 60 / 92 / 2, steps: 6,
  chords: [
    [50, 57, 65], [43, 50, 59], [45, 52, 60], [48, 55, 64],
    [50, 57, 65], [43, 50, 59], [40, 47, 55], [48, 55, 64],
    [50, 57, 65], [43, 50, 59], [48, 55, 64], [50, 57, 65],
  ],
  bass: [
    [0, REST, REST, REST, REST, REST],
    [0, REST, REST, REST, REST, REST],
    [0, REST, REST, REST, 7, REST],
    [0, REST, REST, REST, REST, REST],
    [0, REST, REST, REST, REST, REST],
    [0, REST, REST, REST, REST, REST],
    [0, REST, REST, REST, 12, REST],
    [0, REST, REST, REST, REST, REST],
    [0, REST, REST, REST, REST, REST],
    [0, REST, REST, REST, 7, REST],
    [0, REST, REST, REST, REST, REST],
    [0, REST, REST, REST, REST, REST],
  ],
  melody: [
    [74, 0, 0, 0, 0, 0], [0, 0, 0, 76, 0, 0], [0, 0, 69, 0, 0, 0], [72, 0, 0, 0, 0, 0],
    [74, 0, 0, 0, 77, 0], [76, 0, 0, 0, 0, 0], [79, 0, 0, 0, 0, 0], [77, 0, 0, 0, 0, 0],
    [74, 0, 0, 0, 0, 0], [81, 0, 0, 0, 0, 0], [79, 0, 0, 76, 0, 0], [74, 0, 0, 0, 0, 0],
  ],
  // 下半段进来的第二个声部，和旋律差三度——单声部的长旋律是另一件会腻的东西。
  harmony: [
    [], [], [], [],
    [], [], [], [],
    [69, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 72, 0, 0], [0, 0, 0, 0, 0, 0],
  ],
  arpeggio: [0, -1, 2, -1, 1, -1],
  mode: [0, 2, 4, 5, 7, 9, 11],
  timbre: { pad: 'triangle', lead: 'sine', harp: 'triangle', swell: .62, pedal: .88, pluck: .45, bell: 0, space: .55, echo: .46 },
};

/**
 * 火边 / By the Fire. D 大调，4/4，四分音符 = **78**，八格，十二小节。
 *
 * 营火那一屏。它是这套里唯一**大调**的，也是唯一没有鼓的——玩家在这里只做一件事，做完了就要继续
 * 往上走，所以这一首是**一口气**，不是一段循环里的等待。低音一小节一下，回声比塔上短（这里不该显得
 * 空旷，该显得近）。I-IV-vi-V 是骨架，最后四小节落回主音。
 */
const BY_THE_FIRE: BattleScore = {
  id: 'campfire', name: '火边', note: 'D 大调 · 4/4 · 78 · 无鼓与近场回声',
  step: 60 / 78 / 2, steps: 8,
  chords: [
    [50, 57, 66], [43, 50, 59], [47, 54, 62], [45, 52, 61],
    [50, 57, 66], [43, 50, 59], [40, 47, 55], [45, 52, 61],
    [50, 57, 66], [47, 54, 62], [43, 50, 59], [50, 57, 66],
  ],
  bass: [
    [0, REST, REST, REST, REST, REST, 12, REST],
    [0, REST, REST, REST, REST, REST, REST, REST],
    [0, REST, REST, REST, 7, REST, REST, REST],
    [0, REST, REST, REST, REST, REST, REST, REST],
    [0, REST, REST, REST, REST, REST, 12, REST],
    [0, REST, REST, REST, REST, REST, REST, REST],
    [0, REST, REST, REST, 7, REST, REST, REST],
    [0, REST, REST, REST, REST, REST, REST, REST],
    [0, REST, REST, REST, REST, REST, 12, REST],
    [0, REST, REST, REST, 7, REST, REST, REST],
    [0, REST, REST, REST, REST, REST, REST, REST],
    [0, REST, REST, REST, REST, REST, REST, REST],
  ],
  melody: [
    [0, 0, 74, 0, 0, 0, 0, 0], [0, 0, 0, 0, 76, 0, 0, 0], [0, 0, 78, 0, 0, 0, 0, 0], [76, 0, 0, 0, 0, 0, 0, 0],
    [74, 0, 0, 0, 0, 0, 81, 0], [79, 0, 0, 0, 0, 0, 0, 0], [78, 0, 0, 0, 0, 0, 0, 0], [76, 0, 0, 0, 0, 0, 0, 0],
    [74, 0, 0, 0, 76, 0, 0, 0], [78, 0, 0, 0, 0, 0, 0, 0], [81, 0, 0, 0, 79, 0, 0, 0], [74, 0, 0, 0, 0, 0, 0, 0],
  ],
  harmony: [
    [0, 0, 0, 0, 0, 0, 0, 0], [66, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0], [71, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0],
    [62, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 73, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0],
  ],
  arpeggio: [0, -1, 2, -1, 1, -1, 2, -1],
  mode: [1, 2, 4, 6, 7, 9, 11],
  timbre: { pad: 'triangle', lead: 'sine', harp: 'triangle', swell: .5, pedal: .92, pluck: .5, bell: 0, space: .30, echo: .34 },
};

export const BATTLE_SCORES: BattleScore[] = [ON_TOWER, EMBERLINE, WATCHER, BY_THE_FIRE];

/** What the battle page is showing, as far as the music is concerned. */
export type BattleMood = 'tower' | 'fight' | 'boss' | 'rest';

/**
 * Which piece belongs to which moment.
 *
 * Keyed on **what the player is looking at**, not on which component is mounted: the tower, a fight, the
 * boss, or a fire. `battle` is called with the encounter's pool rather than its name — 首领战 is the
 * only pool with one member, and a name is a thing a translator can change.
 */
export function scoreForMood(mood: BattleMood): string {
  return mood === 'boss' ? WATCHER.id
    : mood === 'fight' ? EMBERLINE.id
      : mood === 'rest' ? BY_THE_FIRE.id
        : ON_TOWER.id;
}

/** Same contract as the world's: a stale id can never leave the player with silence. */
export function parseBattleScore(id: string | null | undefined): string {
  return BATTLE_SCORES.some(score => score.id === id) ? id! : ON_TOWER.id;
}

/**
 * 换曲时的**位置账本**：把「现在放到哪儿」（`at`，单位是格）记在 `from` 名下，再问 `to` 上次放到
 * 哪儿了——没放过就是 0。
 *
 * 玩家提的是：一首比一场仗长，而每场仗都从头开始，「下次进战斗能不能接着上次放」。这正是那件事的
 * 全部算术，**抽出来只因为它能被测试而播放器不能**：`audio.ts` 拉进了 `WorldSoundscape`，那个类的
 * 参数属性是 `node --experimental-strip-types` 加载不了的（谱面当初拆出来就是这个理由）。
 * 位置在播放器被销毁之后还要活着——离开战斗页会停掉它，下次回来接着放。
 */
export function carryTick(ticks: Map<string, number>, from: string, at: number, to: string): number {
  ticks.set(from, at);
  return ticks.get(to) ?? 0;
}

/** 一首曲子一整圈有多少格。`tick % loopTicks` 决定现在落在哪一小节。 */
export function loopTicks(score: BattleScore): number {
  return score.chords.length * score.steps;
}

/** 一整圈有多少秒——「这一首大概多长」的答案，界面上迟早要印，测试也要拿它对照。 */
export function loopSeconds(score: BattleScore): number {
  return loopTicks(score) * score.step;
}
