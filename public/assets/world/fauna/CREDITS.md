# 主世界生物模型出处

这 17 个低模动物来自 **Quaternius** 的 CC0 素材包，经 OpenGameArt 分发。

## 许可

**CC0 1.0 Universal（公有领域奉献）** —— 可商用、可修改、可再分发，**无需署名**。
这里保留出处只是出于礼貌与可追溯性，不是许可要求。

- 许可全文：https://creativecommons.org/publicdomain/zero/1.0/
- 作者：Quaternius — https://quaternius.com/

## 来源包

| 包 | 下载地址 |
| --- | --- |
| Animals Pack | https://opengameart.org/content/5-low-poly-animals |
| Animal Pack Vol.2 | https://opengameart.org/content/animated-animales-low-poly |
| Farm Animals | https://opengameart.org/content/lowpoly-animated-farm-animal-pack |

## 本地文件对应

| 文件 | 原模型 | 来源包 |
| --- | --- | --- |
| `wolf.obj` / `dog.obj` / `cat.obj` / `eagle.obj` / `piranha.obj` | Wolf / Dog / Cat / Eagle / Piranha | Animal Pack Vol.2 |
| `fox.obj` / `bird.obj` / `chick.obj` / `fish.obj` / `whale.obj` | Red Fox / bird / Chick / Fish / Whale | Animals Pack |
| `cow.obj` / `horse.obj` / `llama.obj` / `pig.obj` / `pug.obj` / `sheep.obj` / `zebra.obj` | Cow / Horse / Llama / Pig / Pug / Sheep / Zebra | Farm Animals |

原包同时提供 FBX 与 Blender 源文件，这里只取体积最小的 OBJ（合计约 640 KB）。

## 在游戏里做了什么

原模型每只只有**一个平涂材质**（整只共用 `Kd 0.64` 的灰）。游戏在加载时按几何程序化补色：
最低的一段染成腿的深色、朝下的面染成腹部浅色、其余用外套色，于是单色剪影恢复成
「深腿 + 浅腹 + 背毛」三层。朝向也由几何推断（四足动物头颈更高的一端为头部），
鱼类、鲸与鸟类这类不适用该规律的由物种表里的 `yaw` 显式指定。
