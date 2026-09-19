# 永夜回响 · 载入界面原画

生成日期：2026-09-13。使用当前会话内置 `image_gen.imagegen` 图像生成工具。

## 雾海教堂

本地资源：`public/assets/threshold-scene.webp`，1672 × 941。原始文件保留于图像生成目录；WebP 为无构图修改的质量 94 编码。64 像素低清预览用于首帧铺底。

```text
Use case: stylized-concept. Asset type: ultra-premium dark fantasy video game title and loading-screen environment, one cinematic 16:9 landscape matte painting, ideally 2560x1440 pixels, exceptional fine detail, no UI or text. Art direction: a solemn, haunting and beautiful world in eternal night, tangible sculptural gothic architecture, realistic high-end game key art, sumptuous blacks, weathered gold, warm ivory light, dark ink blue, a very restrained ember orange. Composition: reserve the LEFT 42 PERCENT as atmospheric negative space of dark slate clouds and shadowy ruined walls, low contrast enough for a large title added in code. At the RIGHT 65 PERCENT, an immense ruined cathedral rises from a windswept cliff and a sea of white mist, a grand luminous circular eclipse or shattered gold celestial ring behind its pinnacles. A monumental ornate pointed arch and faintly glowing antique-gold doors are the focal point at x=72%, y=40%. The right foreground has broken stone balustrades, old thorn vines and a procession of small candles. A broad wet stone bridge curves from the bottom center towards the distant door with detailed carved stone and tiny amber reflections. Far foreground very dark, architecture silhouette layers recede clearly in volumetric fog. Moonbeams behind clouds, intricate sharp architectural silhouette, beautiful subtle gold glints on aged metal. Keep usable empty space at the bottom 18 percent for loading controls. The composition is intentional, arresting, beautiful and ominous, NOT just murky. Rich precise texture and strongly separated depth layers, restrained editorial composition. No characters or people, no giant creature, no cards, no letters, no words, no watermark, no logos, no artificial game border. Full bleeding illustration.
```

## 提灯守夜人

本地资源：`public/assets/threshold-watcher.webp`，1024 × 1536，保留生成图像的透明通道。使用 CSS 独立图层合成、景深位移和提灯光晕；未进行程序化重绘或背景移除。

```text
Use case: stylized-concept. Asset type: ONE transparent foreground character cutout for a premium dark fantasy game opening screen. Full body solitary mysterious night watcher, BACK VIEW facing slightly to the right, wearing elaborately layered weather-worn black and dark slate-blue wool cloak, hood hiding the face, a few embroidered aged-gold occult hems, slender antique blade and leather-bound card case hanging from belt. Left hand holds a beautifully ornate small gothic lantern, amber flame illuminating the glove and the nearby folds only. Cloak dramatically drifts out slightly to the right, tactile fabric and fine tailoring. Elegant narrow strong silhouette, mysterious dignified human traveler, not a hulking warrior. Full body with boots, stand naturally on invisible ground, centered in frame, no cropping of cloak, head or feet. Detailed hand-painted realistic AAA dark fantasy key art, physically convincing materials, cinematic moon rim lighting from upper right, warm lantern glow versus cool ink-blue shadow, beautifully restrained color, soft delicate silhouette edges with a few loose cloth strands. Portrait aspect ratio 2:3, highest possible detail. MUST have a genuinely transparent background with alpha, completely isolated character. No environment, no scenery, no gray checkerboard drawn in the picture, no floor, no words, no interface, no watermark.
```

## 画面实现

文字、标识、边框、按钮和载入进度均为原生 HTML / SVG / CSS；不是生成图中的文字。场景、人物和空气粒子以不同速度响应鼠标，形成 2.5D 景深。原画不含用户界面。

后续动态背景以原有原画为基础，通过独立 WebGL 光雾层和 CSS 镜头运动实现。包括云影与雾海流动、日蚀辉光、穿雾光束、门廊与烛火照明、桥面暖色反射及提灯呼吸光；未重新生成或覆盖原始图片。
