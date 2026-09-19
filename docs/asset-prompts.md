# 美术资源记录

使用当前内置 image_gen 图像生成工具制作，未调用外部 API。原图经过切片与 WebP 导出后，全部保存在项目 public/assets 内，运行时无需图片服务。

## 最终资源

- `public/assets/graveyard.webp`：蚀月下的哥特墓园。
- `public/assets/card-*.webp`：六张独立卡牌插画。
- `public/assets/enemy-*.webp`：游尸、骨盾兵、灯蛾立绘。

## 生成提示词

### environment

Use case: stylized-concept. Asset type: one seamless full-width environmental background for a premium dark fantasy tactical card video game titled Eternal Night. Create an exquisitely detailed cinematic matte painting, 16:9 landscape. Scene: an abandoned gothic cathedral courtyard and ancient cemetery in an eternal eclipse, looming cathedral silhouette centered in the far distance, pointed arch ruins framing both edges, gnarled dead trees, weathered stone graves, a broad open cobblestone battle clearing across the foreground. Small candle embers, layered volumetric ground mist, dusty golden light glimmering in a few windows, pale muted green-blue moonlight cutting through haze. Large dim copper eclipse behind the cathedral, mostly obscured by swirling smoky clouds. The center foreground remains open and dark for gameplay overlays, architecture mostly in top two thirds and edges. Premium hand-painted realistic dark fantasy game concept art, tangible aged stone and intricate gothic architectural detailing, painterly brushwork with crisp atmospheric focal depth, tasteful muted charcoal, slate teal, desaturated sepia, copper ember palette. Beautiful ominous mysterious, eerie but readable, fine film grain. No characters, no cards, no lettering, no interface, no borders, no watermark. Avoid saturated purple, avoid cartoon, avoid oversaturated fire. Output a wide 16:9 image.

### card-art

Use case: stylized-concept. Asset type: ONE precisely aligned square game texture atlas containing six card-art tiles, a grid of 3 columns by 2 rows, equal 1:1 square tiles touching edge to edge with no padding, 1536 wide by 1024 high if possible. These six illustrations belong to the same high-end gothic horror deckbuilding game: moody hand-painted realistic oil painting, beautifully intricate ancient metal, chiaroscuro, atmospheric smoke, quiet dramatic rim light, desaturated shadow colors and muted copper/gold highlights. TOP LEFT: a single wickedly curved silver ritual dagger cutting through wisps of smoke in a midnight graveyard (cold pale gold). TOP CENTER: two crossed long antique gothic blades, sharpened steel, baroque hilts, flying embers against stormy shadows (bronze and slate). TOP RIGHT: an ornate black executioner's greatsword falling vertically before a blood-red moon, tiny red wisps (oxblood, pewter). BOTTOM LEFT: a gnarled gloved hand cradling a vivid orange ember and ghostly flame, burned parchment fragments, mysterious warm lighting (deep ember orange). BOTTOM CENTER: an elaborate ancient bone-white shield with a skull relief, ribs and thorn branches, spectral green-blue protective mist (pale bone, muted teal). BOTTOM RIGHT: a cracked ornate antique silver mirror floating, reflecting a crescent and shadowy raven, strange teal light shining through the fractures (desaturated turquoise). Each tile is one complete composition with its subject centered large and high enough to crop to a landscape card art area. No letters, no numbers, no card frames, no labels, no padding, no visible grid lines, no watermark. Texture atlas only.

### enemy-art

Use case: stylized-concept. Asset type: ONE enemy portrait texture atlas for a premium gothic horror card battle video game. Wide image with 3 equal tall vertical portrait panels in one row, touching edge to edge, 1536x1024 landscape if possible. LEFT PANEL: a hollow-eyed undead wanderer in shredded grave wrappings, narrow pale emaciated face, long thin fingers, faint tarnished green eyes, emerging from black fog; shoulders and torso visible. CENTER PANEL: an ominous hooded skeleton knight holding a magnificent ancient circular shield made of sculpted bone and tarnished metal, ceremonial gothic armor, warm dim glowing eyes deep under the hood, realistic dark fantasy oil painting, full upper body. RIGHT PANEL: a monstrous spectral lantern moth, its wings like decomposing antique parchment and gothic stained glass, skull patterns on wings, small intense amber light inside its thorax, facing viewer with elegant symmetrical silhouette suspended in smoky mist. Backgrounds all near-black charcoal with wisps of desaturated teal fog, no hard borders, no panel dividers. All three portraits cinematic highly detailed realistic painterly concept art, delicate bronze and ivory highlights, haunting beauty, sharp focal details and soft edges, atmospheric vignette. No cartoon, no game UI, no text, no watermark, no lettering, no numbers. Each subject stays entirely inside its panel, no overlapping adjacent panels.

