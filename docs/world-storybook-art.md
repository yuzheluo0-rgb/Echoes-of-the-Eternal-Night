# 卡通地图原画与原创声音

## 人物原画

本次使用当前会话内置 `image_gen.imagegen`，以原序幕守夜人为衣装参考进行编辑与风格迁移。未指定工具没有公开的模型名称。参考文件 `public/assets/threshold-watcher.webp`。

保留黑色尖兜帽、无面阴影、长披风、旧金色月纹、左手提灯及腰间剑与卡匣。地图中行走的是自建三维角色，生成原画用于信息面板。

生成原图：`C:\Users\21046\.codex\generated_images\01a093c1-a09d-7700-a1bc-1cc5aa17dc59\exec-618f441f-478f-48aa-a6e3-29f3074d55fe.png`。

接入文件：`public/assets/world/watcher-portrait-v3.webp`，缩至 768 × 768，WebP 质量 90。

完整最终提示词：

```text
Use case: style-transfer. Asset type: character portrait / full character reference for the same fantasy game's cartoon world map. Reference image: the supplied original game's cover night watcher, an identity and clothing reference. Make a new polished stylized 3D cartoon version of THIS SAME CHARACTER, preserving its recognizable black / very dark slate-blue pointed hood, face completely hidden in shadow, long layered dark cloak, aged GOLD embroidered crescent moon and celestial hems, leather card case at belt, slender sword at hip, LEFT HAND carrying an ornate warm amber gothic lantern. Preserve the original restrained slate black and antique gold color scheme. No bright teal scarf, no new armor, no glowing eyes, no exposed human face, no new costume. Proportions: small collectible adventure character, head about one third of body height, short boots and arms, wide flowing cloak. Strong, clean silhouette, soft hand-painted sculptural surfaces, crisp elegant edges. Full body centered in a square frame with some padding, three-quarter view facing right so lantern and moon embroidery both visible. Simple plain desaturated dark teal backdrop, studio moon rim light and a warm amber lantern glow. High quality game art, charming and mysterious, no text, no frame, no watermark.
```

## 模型与视觉

地貌、48 套地点、9 种实际桥型、云、鸟、角色和自然景物由 Three.js 程序建模。运行时不读取前两版写实地表、针叶贴图；老素材及其生成记录仍保留。建筑之间不绘制固定小路，只保留选路时的临时导航提示。

## 原创配乐《灯火渡海》

曲谱在 `src/world/WorldSoundscape.ts`，由代码合成，无外部音频下载。D 小调，6/8 拍，四分音符 76 BPM，16 小节约 37.9 秒循环。持续和声、拨弦分解和弦、双泛音玻璃钟旋律构成安静的探索背景。

环境声包括风、潮汐、低鸣、林鸟、苔泽蛙声、晶石清音与炉心脉动，随所在地区平滑变化。首次点击扬声器后启动；音效和配乐复用同一个 AudioContext，包含输出限幅和混响。

浏览器实际波形检查：开启后最大采样窗口 RMS 约 0.01391，关闭后为 0；所有调度音源结束，反复开关没有多建 AudioContext。详见 `docs/validation/world-effects-audio.json`。
