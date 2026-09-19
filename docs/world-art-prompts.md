# 前两版主世界地图美术记录

当前卡通版使用的原画和提示词见 [本版美术记录](world-storybook-art.md)。以下纹理在当前地图中不再加载，保留作历史资料。

生成日期：2026-09-14。

工具：本会话可用的内置 `image_gen.imagegen`。先生成八区地表材质图，本轮另生成透明针叶枝条，用于重新搭建三维树冠。没有调用替代图像 API，也没有挪用《文明》或其他游戏的美术资产。

原始生成文件（保留）：

`C:\Users\21046\.codex\generated_images\01a093c1-a09d-7700-a1bc-1cc5aa17dc59\exec-6555094a-dc26-4e0d-a3f2-a2cb1ba363e6.png`

原图尺寸 1774 × 887。图集为 4 列 × 2 行，依次为草地、森林地表、沙地、岩石、雪地、大海、血海、云雾。裁剪每个分区内部，去掉边缘 3 像素，统一为 512 × 512 WebP（质量 88）用于三维材质。图集预览保存在 `public/assets/world/terrain-atlas.webp`，运行时按地貌加载 `terrain-*.webp`。裁剪与编码没有改绘图像内容。

该图集提供地表纹理。三维模型、山体雪线、沙丘起伏、水面波纹、云雾、粒子、光影和所有交互由项目代码制作。守夜人面板肖像复用此前生成的 `threshold-watcher.webp`，出处见 `opening-art-prompts.md`。

中文界面使用本地 Noto Serif SC 字体子集（468 字符，TrueType）；字体许可证保存在 `public/fonts/Noto-Serif-SC-OFL.txt`。

## 实际生成提示词

```text
Use case: texture generation. Asset type: one 4-column by 2-row PBR-style diffuse texture atlas for a high-quality miniature fantasy world game, overall 2:1 landscape, ideally 2048x1024. Eight equal square cells, edge-to-edge with absolutely no gaps, frames, labels or text. Each square is a detailed seamlessly tileable top-down orthographic material surface, uniformly lit, no horizon, no scenery, no buildings, no trees or raised objects, no strong directional cast shadows. TOP ROW left to right: 1) lush muted olive and fern green meadow turf with extremely fine grass detail and tiny earth flecks; 2) deep green forest floor moss, small pine needles, fern fragments and dark rich earth; 3) warm pale ochre desert sand with delicately rippled wind-sculpted fine grains, subtle tonal variation; 4) slate gray weathered cliff rock with naturally fractured strata and mineral flecks. BOTTOM ROW left to right: 5) pristine cold ivory snow and blue-white glacial ice with very subtle crystalline details; 6) deep blue-green ocean water viewed straight down, delicate turquoise wave caustics, no land; 7) mysterious wine-red fantasy sea, deep oxblood red with restrained dark crimson liquid swirls, elegant ominous texture, no gore or body parts; 8) soft silver-blue dense cloud and mist material, delicate smoothly billowing contours, no sky horizon. Palette is rich yet restrained, suitable for sophisticated handcrafted scale-model terrain lit at dusk. Exquisite physically plausible fine material detail, sharp neutral albedo photography style, each cell filled completely, seamless full bleed, no vignettes, no text, no watermark. This is a technical texture atlas, NOT an illustration of eight landscapes.
```


## 第二版针叶资产

针对模型粗糙的反馈，再次调用本会话内置 `image_gen.imagegen`，生成可从不同角度观看的树冠所需枝条素材。

原图保留于：

`C:\Users\21046\.codex\generated_images\01a093c1-a09d-7700-a1bc-1cc5aa17dc59\exec-f6680b82-6ef5-4919-b5b7-283147b1d510.png`

原图为 1536 × 1024 RGBA PNG，含真实透明通道。仅缩放和编码为 1024 × 683 WebP（质量 93、透明通道质量 100），保存为 `public/assets/world/detail/pine-branch-v2.webp`。枝条按多个高度、方向与倾角排列成三维树冠，并加入有厚度的树干、分枝、风动和对应的阴影。

实际提示词：

```text
Create a production-quality game foliage cutout asset: one isolated Scots pine / spruce branch spray, photographed as a flat botanical specimen viewed directly from above, occupying most of a 3:2 landscape canvas. TRUE TRANSPARENT BACKGROUND with alpha, no white or checkerboard painted background. A slender brown woody stem starts at the extreme left center and extends horizontally toward the right, branching repeatedly into a dense irregular tapered spray of extremely fine forest-green and olive-green evergreen needles. The silhouette is airy, feathery and organically uneven, many tiny negative spaces between needle tufts, fine individual needles clearly resolved, a few muted yellow-green growing tips. The needle canopy is fullest in the middle and naturally narrows at its right tip. Diffuse neutral overcast illumination with subtle natural self shading, no external cast shadow, no spotlight, no plastic shine, no ornaments, no flowers, no text, no border. Photoreal botanical detail for alpha-tested branch cards on a physically lit three-dimensional tree. The entire branch remains within the canvas with 5 percent transparent margin. One branch only, no tree trunk or complete tree, no scenery. Save as transparent PNG.
```

## 岩石材质来源

岩层细节使用 Poly Haven 的 [Aerial Rocks 01](https://polyhaven.com/a/aerial_rocks_01)，作者 Rob Tuytel，按 [CC0 许可](https://polyhaven.com/license)使用。来源和派生文件详见 [素材许可记录](../public/assets/world/detail/ASSET-LICENSES.md)。山体、分层岩壁、海岸、沙丘和树木几何仍由项目代码生成，未使用外部现成地形模型。
