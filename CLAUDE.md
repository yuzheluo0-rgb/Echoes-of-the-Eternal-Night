# 永夜回响 · 余烬之境

React 19 + TypeScript + Vite 7 + Three.js 的卡牌肉鸽游戏。当前入口是主世界探索（`src/world/`），
卡牌战斗原型保留在 `src/App.tsx` / `src/engine.ts`，尚未接入地图。

## 命令

```sh
npm run dev      # http://127.0.0.1:5173/#/world
npm test         # 45 项，node --experimental-strip-types --test
npm run build    # tsc -b && vite build
```

## 当前状态（2026-09-19）

主世界已扩至 **2315 格**（面积 ×3），地形有噪声驱动的起伏，植被重做过，
每个地貌有独立建筑造型且已统一放大 1.5 倍。细节层已补齐：分层屋面、尖顶旗饰、
窗棂十字、台阶栏杆、围栏、附属棚屋。12 个支线地点与 12 个隐秘据点各占 3 格，
是「前庭 + 两间偏屋」的小建筑群（偏屋造型随地貌而变）；12 个路边奇遇保持单格。
测试全绿，构建干净。

### 待办

1. **更多隐秘据点与路边奇遇**。`worldStories.ts` 的 `STORIES`/`ENCOUNTERS` 是
   每地貌单例，需改为数组。**现有 id 必须保持稳定**（`side-cliff`、`hidden-volcano`
   等被章节链和玩家存档依赖），新地点只能追加新 id。连带要改
   `WorldLocation.tsx` / `WorldJournal.tsx` 里 `ENCOUNTERS[site.biome]` 的取法。
2. **主世界河流没有实体**。`WorldWeather.ts` 只画河面缎带，河不参与寻路也不挡路，
   建筑可以压在河上。若要"真正的河"，得让河格不可走并重划桥。

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
- **`WorldLocation.tsx` / `WorldJournal.tsx` 用 `ENCOUNTERS[site.biome]` 取奇遇内容**，
  加第二个奇遇就会撞车，需改为按地点 id 取。
- **熔岩池用 `tile.caldera` 标记**，地形塑形与渲染共用该判据。
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

浏览器加载有 WebGL，无头模式可正常渲染。**改完视觉务必自己截图核对**，
不要凭推断下结论——这个项目里出现过"看到河口变宽就以为已通海"的误判。

## 玩家存档

`eternal-night-world-v1`（localStorage）。地形布局变更后旧存档会失效（坐标对不上），
新存档不受影响。
