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
每个地貌有独立建筑造型且已统一放大 1.5 倍。测试全绿，构建干净。

### 待办

1. **建筑细节翻新** —— 只做了 1.5 倍放大（`WorldArchitecture.ts` 的 `BUILDING_SCALE`），
   细节层次还没补：屋面分层、尖顶旗饰、窗棂、围栏台阶、附属物。
2. **每个地貌新增 1~2 座三格以上特殊建筑**（主神要求"精致"）。
   难点：`siteFootprint()` 目前只认 `MAIN_SITES`，支线/隐秘/奇遇地点全是单格小屋。
   要扩展占地系统到派生地点，会牵动 footprint 生长、连通性划路、拾取盒。
3. **更多隐秘据点与路边奇遇**。`worldStories.ts` 的 `STORIES`/`ENCOUNTERS` 是
   每地貌单例，需改为数组。**现有 id 必须保持稳定**（`side-cliff`、`hidden-volcano`
   等被章节链和玩家存档依赖），新地点只能追加新 id。

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
