# 永夜回响 · 余烬之境

React 19 + TypeScript + Vite 7 + Three.js 的卡牌肉鸽游戏。当前入口是主世界探索（`src/world/`），
卡牌战斗原型保留在 `src/App.tsx` / `src/engine.ts`，尚未接入地图。

## 命令

```sh
npm run dev      # http://127.0.0.1:5173/#/world
npm test         # 56 项，node --experimental-strip-types --test
npm run build    # tsc -b && vite build
```

## 当前状态（2026-09-19）

主世界已扩至 **2315 格**（面积 ×3），地形有噪声驱动的起伏，植被重做过，
每个地貌有独立建筑造型且已统一放大 1.5 倍。细节层已补齐：分层屋面、尖顶旗饰、
窗棂十字、台阶栏杆、围栏、附属棚屋。12 个支线地点与 12 个隐秘据点各占 3 格，
是「前庭 + 两间偏屋」的小建筑群（偏屋造型随地貌而变）；12 个路边奇遇保持单格。
测试全绿，构建干净。

每个地貌另有 **2~3 只自由活动的动物**（共 29 种，模型来自 CC0 素材，见下）。
8 个敌对种有自发光眼睛，陆生动物走对角步态（腿前后摆、抬蹄、身体随步点起伏）。

### 待办

1. **更多隐秘据点与路边奇遇**。`worldStories.ts` 的 `STORIES`/`ENCOUNTERS` 是
   每地貌单例，需改为数组。**现有 id 必须保持稳定**（`side-cliff`、`hidden-volcano`
   等被章节链和玩家存档依赖），新地点只能追加新 id。连带要改
   `WorldLocation.tsx` / `WorldJournal.tsx` 里 `ENCOUNTERS[site.biome]` 的取法。
2. **主世界河流没有实体**。`WorldWeather.ts` 只画河面缎带，河不参与寻路也不挡路，
   建筑可以压在河上。若要"真正的河"，得让河格不可走并重划桥。
3. **敌对生物目前只是气氛**。它们不会靠近、不会挡路、不触发遭遇，只有图鉴里的
   `temperament` 标签与配色区分。要做"会追人的狼"得接 `WorldCreatures` 的 wander
   状态机与 `canEnterTile`，工程量另算。
4. **生物只有"走"，没有别的状态**。没有奔跑、受惊、进食以外的行为，转身也只是一条
   插值曲线。要做"会追人的狼"见第 3 条。

## 动手前必读的坑

这些都是这个项目里踩过的，改之前先看一眼：

- **`worldProgression.ts` 与 `WorldProgression.tsx` 只差大小写**。在 Windows 上
  `'./WorldProgression'` 会解析到 `.ts` 逻辑文件而非 `.tsx` 组件，导入必须写显式扩展名。
- **生成期用堆而非线性扫描**。`worldData.ts` 的 `connect()` 与区域遍历用
  `MinCostQueue`，且可达性结果按 `walkVersion` 缓存。改成"可续跑的增量 BFS"是错的——
  返回集合内容相同但迭代顺序不同，会导致不同的划桥位置和不同的世界。
- **平局规则是有意义的**。原 `[...open].reduce()` 用严格小于，平局取迭代序最后一个。
  堆已精确复刻，改动前先看 `priorityQueue.ts` 的注释。
- **布局摘要测试**（`worldData.test.ts` 的 `LAYOUT_DIGEST`）是海岸线与划桥的冻结基线。
  有意改地图时才重新生成，否则它一失败就说明世界被意外改动了。
- **世界尺寸用 `WORLD_SCALE` 派生**。相机钳制、阴影正交盒、雾、小地图 viewBox、
  缩放档位、天气范围全部乘以它，不要写回字面量。
- **建筑改尺寸要同步三处**：`WorldScene.ts` 的拾取盒高度表（否则点屋顶穿透）、
  信标浮空高度、以及 `WorldLighting.ts` 找灯塔光束的 `dy` 阈值。
- **生物三个文件分工，缺一不可，且名字不能只差大小写**：
  `faunaSpecies.ts`（纯物种表，只有一个 type-only import）、`worldFauna.ts`（摆放，
  只依赖 worldData）、`WorldCreatures.ts`（渲染，OBJ 加载 + 实例化 + 游荡）。
  拆开是为了让 `worldData.parseSave` 能校验 `fauna` 存档字段而不 import 摆放层
  （摆放层 import 了 worldData，会成环）。
  **这个坑已经真踩过**：一开始渲染层叫 `WorldFauna.ts`，与 `worldFauna.ts` 只差大小写，
  Write 时在 Windows 上**直接静默覆盖**了数据文件，代码整个消失。别再用这种名字。
- **配乐是谱面数据，不是音频文件**。`worldScores.ts` 是纯数据（和弦、旋律、调式、音色），
  `WorldSoundscape.ts` 现场合成。加分轨只要往 `SCORES` 里加一首，右上角面板自动列出来。
  注意 `worldScores.ts` 的 `mode` 字段是调式白名单，`soundscape.test.ts` 拿它校验每个音——
  写错一个音会直接红，这比事后用耳朵发现强。
- **纯数据必须和合成器分文件**。`WorldSoundscape.ts` 的构造函数用了 TS 参数属性
  （`constructor(private ctx: AudioContext, ...)`），而 `node --experimental-strip-types`
  是 strip-only，**加载这种语法直接抛错**。所以谱面数据拆在 `worldScores.ts` 里，
  测试只 import 那个。和 `faunaSpecies.ts` / `worldFauna.ts` 的拆法同一个理由。
- **`WorldLocation.tsx` / `WorldJournal.tsx` 用 `ENCOUNTERS[site.biome]` 取奇遇内容**，
  加第二个奇遇就会撞车，需改为按地点 id 取。
- **熔岩池用 `tile.caldera` 标记**，地形塑形与渲染共用该判据。
- **生物模型是异步加载的，`onReady` 被它挡住了**。`WorldScene.settle()` 要等
  `pendingLoads` 归零才回调 `onReady`，否则加载遮罩撤掉时动物还没出现，会看到一段
  "先没动物、再突然冒出来"。加载失败只记录并跳过（世界照常打开），
  但**每个物种的模型文件是否存在有测试兜底**——否则打错文件名会静默少一只动物。
- **导入的生物是单色平涂，颜色是按几何算出来的**。`WorldCreatures.tint()` 按高度分三段
  （最低段=腿、朝下的面=腹、其余=外套色）。头部朝向也是推断的：头颈更高的一端是头，
  四足动物上都对，但**鱼和鲸不行**（见下一条）。
- **`piranha.obj` 与 `whale.obj` 是反的，必须给 `model.yaw: Math.PI`**。这两个网格尾鳍
  比吻部还高，`headYaw()` 判反，少了 `yaw` 它们就**倒着游**——piranha / bloodfin /
  whale / bonewhale / mistwhale 五条都吃这个。`fauna.test.ts` 有一条要求共用同一网格的
  物种 `yaw` 一致，加第三种鲸时忘抄会直接红。
- **着色器里的每物种常量必须走 uniform，不能拼进源码**。29 个物种共用**一个**编译结果：
  `shaderID` 存在时 three.js 只按 `material.customProgramCacheKey()` 认程序，而它是常量，
  **`onBeforeCompile` 改过的源码根本不参与缓存键**。早先把 `minY/spanY/minZ/spanZ` 用
  `toFixed(4)` 拼进顶点着色器，后果是**第一个编译的物种（狐狸）的比例被全部 29 只共用**：
  鲸的全身落进"头部"带，秧鸡的落进任何带之外（小到 `fTop` 恒为 0，头颈完全不动）。
  现在统一走 `uFaunaBox` / `uFaunaWalk` / `uFaunaLegs` / `uFaunaEye`，程序数仍然是 1。
  加新的每物种动画量时照做，别再用模板字符串。
- **眼睛是焊进身体几何的**（追加 2 个八面体 + `aGlow` 顶点属性），不是子 mesh，
  所以 draw call 不变。用八面体而不是朝外的面片，是因为面片在动物背对镜头时会整个消失。
  有 `palette.accent` 才有眼睛，`accent` ⇔ `temperament: 'hostile'`，测试钉住了这条。
  眼睛位置全由几何推：头带取 z 的 [72%, 88%]（取前 1/5 会量到鼻梁、取前 1/3 会量到肩背，
  狗还会量到前腿，第一次就栽在这），高度 = 该带最高点 − 16% 身高，宽度 = 眼高处的最大 |x|。
  猫要特别注意：它的最高点是**竖起来的尾巴**，所以眼睛高度绝不能取整体身高的比例。
- **步态是"髋部不动、蹄子位移最大"的剪切**，不是整体平移：`below` 从髋的 0 渐变到蹄的 1，
  腿才不会从身上撕下来。步频由步幅反推（`speed*.55 / (2*stride)`），两者绑死才不会滑步，
  改 `motion.speed` 不用手动调频率。
- **水生与飞行种按"体长"归一化，不是身高**（`sizeAxis: 'length'`），否则鲸鱼按身高
  缩放会有两个半格长。游动生物的入水深度必须用**模型高度**算，不能用 `size`——
  这两个量对鲸鱼毫无关系，用 `size` 会把整条鲸沉到海面下一整个单位。
- **生物不进 `Tile`，所以布局摘要不受影响**。加生物不需要重算 `LAYOUT_DIGEST`。
- **`tileRegion` 依赖地点 id 的命名契约**。`worldRegions.ts` 从 `structure` 里取章节：
  主建筑 id 恰好等于地貌名（`camp` 归 `grass`），派生据点则是 `<kind>-<biome>` 取后缀。
  **给主建筑加带连字符的 id 会踩坑。** 这条不能靠 import LANDMARKS 解决——
  `worldRegions.ts` 只有 type-only import，加运行时依赖会与世界生成循环互引。
  早先直接把 `structure` 断言成 `Biome`，派生据点的前庭会被判成"封印区域"，
  玩家走不进去、存档还会被重置回营地。
- **派生据点的生长循环必须排在主建筑循环之后**（`worldData.ts` 的 `createWorld`）。
  两个循环的候选过滤都排除 `t.landmark`，而派生入口早有 landmark 标记，
  所以排在后面就只能捡主循环剩下的格子，主建筑 footprint 逐字节不变。调换顺序会改整张地图。
  循环里两件事不能漏：`walkVersion++`（否则可达性缓存失效，被切断的据点会静默不可达）
  和 `next.bridge=false`（否则 `WorldBridges` 会把栈桥画进建筑里）。
- **`siteFootprint()` 有记忆化，返回共享数组**，只能读不能改。标签层逐帧要读它，
  不缓存就是每帧 48 × 2315 次过滤。
- **偏屋用 `WINGS` + `scaled()` 画**。`add()` 是唯一的缩放闸口，所以 `WING_SCALE`
  会自动作用到 `window()` / `crystal()` / `lantern()` / `boat()` 上——但 `beam()`
  绕开 `add()`，不吃任何缩放（既有的桅杆、根须、帐篷杆其实都还是 1×，历史遗留）。
  新细节一律走 `add()`，不要用 `beam()`。
- **旗舰/旗饰一律不能是 `glow`**。`add()` 里 `color==='glow'` 会注册 emitter，
  灯塔光束靠 `activeSite.id==='fog' && dy>1.35` 挑最高那个，在雾港主塔的灯室之上
  再加 glow 会把光束挪走。

## 验证

项目留有 Playwright + 本机 Chrome 的无头截图管线，运行时在
`~/.cache/codex-runtimes/.../node_modules/playwright`，Chrome 在
`C:/Program Files/Google/Chrome/Application/chrome.exe`。

- `.work/world-final-perf.cjs` —— 性能基准，跑 overview/pan/zoom/walking/volcano
  五场景，输出帧时间、绘制调用、三角形数、实际 GPU 型号。**动手前后各跑一次对比。**
  （`.work/world-perf-bench.cjs` 与 `world-performance-check.cjs` 已过时，不要用。）
- `.work/world-closeup.cjs <tag> "<名称>:<格id>:<缩放>;..."` —— 按坐标拍近景。
  注意视角之间用 `;` 分隔，因为格坐标本身含逗号。
- `.work/world-shot.cjs <tag> [1]` —— 整图与总览。
  （`world-final-perf.cjs` 的 volcano 场景目前是坏的：`samples:-20`、没有任何 draws，
  改动前后都一样，不是回归。）
- `.work/fauna-eyes.cjs <tag> [zoom]` —— 8 个敌对种各拍一张头颈近景，冻结在确定性出生
  姿态，两次跑可以直接 A/B。`.work/fauna-walk.cjs <物种> <帧数>` 是同一套的自然行走连拍。
- `.work/fauna-pose.cjs <物种> [zoom] [裁切宽]` —— 把一只钉在 yaw 0/90/180/270 各拍一张。
  **判断"头朝哪边"就靠它**：相机固定在 +x+z，yaw=90 时局部 +z 落在屏幕右侧，
  所以哪端是头一眼可辨。鱼和鲸的朝向 bug 就是这么查出来的。
- `.work/fauna-gait.cjs <物种> [帧数]` —— 侧对镜头 + 把 `aGait` 钉在 1 的走姿连拍。
  注意它**包住 `creatures.update` 来钉实例矩阵**：用 rAF 会和场景自己的循环抢，
  大约一半的帧会拍到没钉住的状态。也别指望 reduced-motion 下能看动画——
  `WorldScene` 在 `reduced` 时根本不推进 `elapsed`，整条时间轴是冻的。
- `.work/fauna-programs.cjs` —— 打印着色器程序数与每物种的 fauna uniform，
  用来验证上面那条"29 个物种共用一个程序"的坑没有复发。
- `.work/world-audio.cjs <曲目id> [秒数]` —— **没法"听"的时候用它**：把 AnalyserNode 接到
  主输出上，平均若干帧的频谱，列出峰值并判断每个峰是否在谱面上。改配乐后跑一次，
  比对 `matched N/N`。目前两首都是 22/22，音分误差基本在 ±5 以内。
- `.work/world-score-shot.cjs <tag> [曲目] [宽] [高]` —— 右上角声音面板关闭/展开的截图。
  注意脚本是**在出错时也 process.exit** 的：只写 `process.exitCode` 的话，浏览器没关，
  进程会一直挂着不返回。

浏览器加载有 WebGL，无头模式可正常渲染。**改完视觉务必自己截图核对**，
不要凭推断下结论——这个项目里出现过"看到河口变宽就以为已通海"的误判。

## 卡牌层（`src/cards/`）

`#/cards` 是卡牌总览页。这一整块**不 import `src/world/**` 的任何东西**，所以看牌、
改牌、跑卡牌测试都不会碰到地图生成或存档；`main.tsx` 里也只多了一个路由分支。

- **四副牌组**，各 46 张（32 种）：断罪之刃 / 燎原余烬 / 长明壁垒 / 千面回廊。
  跨组联动是一个环：刃产**余烬** → 焰烧它施加**灼烧** → 骨把灼烧与格挡变成**壁垒** →
  镜把壁垒复制成**映照** → 喂回刃。另有 10 张中立牌，每副带其中 4 张。
- **机制分两类**（`types.ts` 的 `KEYWORDS`）：5 个**流派资源**（各有 owner），
  和 15 个**通用机制**（蓄火/爆燃/祭火/焚尽/拾回/返照/引爆/刻印/连缀/空明/回响/迟滞/
  反震/烙印/流转）。加牌时优先用通用机制——只有资源和伤害的牌库等于只有一张牌。
- **`pattern` 字段是防重复的关键**，不是装饰。上一版效果同质化的根因是我给的规范太窄
  （"1 费攻击 6~7 伤害"这种基准表），照着填必然一样。现在 `cards.test.ts` 有三条硬检查：
  同牌组同一 pattern ≤3 次且 ≥14 种、整副（含中立）≥16 种、**同牌组内两张牌的 text
  去掉数字后不能是同一句话**。加牌时这三条会直接挡住偷懒。
- **`text` 里出现的机制名必须与 `keywords` 数组完全一致**（有测试，双向比对）。
- 卡牌模块的 import **必须写显式 `.ts` 扩展名**——它要被 node 的 strip-types 跑测试，
  而 strip-only 模式也不支持 TS 的参数属性（这就是 `WorldSoundscape` 要把谱面拆出去的原因）。
- 新增测试文件**必须登记进 `package.json` 的 test 脚本**，否则会被静默跳过。
- **卡面是真实的 Unsplash 摄影**，逐张按牌名与功能检索取图，不是画的（见下）。
  取图表和出处分别在 `src/cards/art.ts` 与 `public/assets/cards/CREDITS.md`。

### 效果设计的依据（重做过一次，别再退回同质化）

第一版效果同质化，根因是我给的规范太窄——"1 费攻击 6~7 伤害、1 费技能 5~6 格挡"
这种基准表，照着填必然一百张牌长得一样。重做时去读了杀戮尖塔 / 万智牌 / Monster Train /
Balatro 的设计资料，下面几条是真正起作用的原则，`cards.test.ts` 已经把能机检的都钉住了：

- **别怕无聊，比怕失败更重要**（Rosewater）。万智牌内部有 Rare Poll：**两极分化的牌
  （有人打 1~2 分、有人打 9~10 分）比人人打 7 分的牌更受欢迎**。九张星陨就该是有人爱有人恨的。
- **"没有废牌"** 是 Mega Crit 公开的目标：每张牌都要在卡池生态里有独特位置。
  填数牌玩家转头就忘，只会记住有"想法"的那几张。
- **转化牌是趣味密度最高的东西**（万智牌的 Body Slam：伤害 = 格挡）。把一个维度的资源
  变成另一个维度，是牌与牌之间的结缔组织。每副牌组至少要有 3 张。
- **状态要简单、可叠加**：一个名词 + 一个整数（余烬/锋锐/灼烧/壁垒/映照都是这样）。
  简单的东西组合起来才有惊喜——3 层灼烧和 100 层灼烧是同一句话。
- **循环牌抬高组合上限**：抽、弃、拾回、返照、回响。牌在手里的流转比数值更能产生连招。
- **"防御很无聊"** 是公认的设计难题，解法是反击 / 格挡转攻击 / 过量格挡的奖励——长明壁垒三条都占了。
- **数值上守 vanilla test**：能力强，身材就要低于基准；否则既强又便宜。
- **构筑锚点**：每副牌组需要 2~3 张"值得为它构筑"的牌 + 一批安全牌 + 少量高风险高回报牌。

## 玩家存档

`eternal-night-world-v1`（localStorage）。地形布局变更后旧存档会失效（坐标对不上），
新存档不受影响。

## 卡牌美术的取图管线

`.work/cards-fetch-photos.cjs [deck前缀|all] [--cards-only] [--force]`

Unsplash 的搜索接口有机器人防护，所以脚本**驱动真 Chrome**（curl 和 npx 都不行）。
图片直接从 CDN 取**已经裁成卡面比例、已经编码成 webp** 的版本，因此本地不需要任何图像处理
（系统里的 `convert` 是 Windows 的磁盘工具不是 ImageMagick，Python 是商店占位版）。

- **关键词搜图会返回大量垃圾**（纯色渐变、平面金属贴图、黑白快照），所以每张候选先用缩略图
  在浏览器里算饱和度/层次/边缘密度打分，取最高分的那张下全尺寸。没有这一步，
  大概一半的卡面是不能用的。
- 三个标签页并行 —— 每张牌要一次搜索导航，导航就是全部成本，串行要跑一个多小时。
- 会跳过已存在的文件，可断点续跑。改 `art.ts` 里某个检索词后，删掉对应 webp 再跑即可。
- `.work/cards-contact-sheet.cjs <tag> [格宽] [目录] [扩展名]` 把整个目录拼成一页截图，
  一次 Read 就能看几十张图。注意它把图片**内联成 base64**——`setContent` 出来的页面是
  about:blank 源，Chrome 会拒绝加载 `file://` 子资源。
