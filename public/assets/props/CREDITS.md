# 道具美术素材出处 / Prop art credits

全部道具图标都是真实摄影作品，来自 [Unsplash](https://unsplash.com)，按
[Unsplash License](https://unsplash.com/license) 使用：可免费用于商业用途，不强制署名。
此处仍记录出处，便于日后追溯与替换。

每件道具的检索词写在 `src/props/art.ts`；重新抓取用 `.work/props-fetch-photos.cjs`
（会跳过已存在的文件，可断点续跑；候选图先按层次/饱和度/边缘密度**以及中心聚焦**打分，
不合格就换下一张）。重取一批：`node .work/props-fetch-photos.cjs "a,b,c" --force`。

⚠️ 这个文件是脚本生成的，且**出处记录是增量合并的**——不要手改，
也不要让脚本退回成「每次从空数组重写」（前两套美术的出处就是这么丢的）。

| 文件 | Unsplash 图片 ID | 检索词 |
| --- | --- | --- |
| `bastion-shard` | `photo-1666035223996-8a0546714d56` | stone wall fragment brick dark still life |
| `blank-slip` | `photo-1586957960772-3e526c5e7cbd` | blank paper note dark |
| `blood-tap` | `photo-1779598991841-333ceb64af89` | glass dropper bottle dark still life macro |
| `bone-dice` | `photo-1683742541644-9a1380d5a604` | bone dice dark still life |
| `brass-whistle` | `photo-1648775270556-115b4076e54f` | brass whistle dark still life |
| `cinder-flask` | `photo-1707827915006-1dc90407bd6f` | small flask dark glass still life |
| `clean-lamp` | `photo-1778376644716-8a8c5ced01da` | kerosene lamp dark |
| `ember-draught` | `photo-1668066827088-96f030655bf8` | small bottle liquid dark still life |
| `ember-heart` | `photo-1628076946555-567c64ad99ce` | glowing red stone ember macro dark |
| `ember-scale` | `photo-1769791650061-3870c39b73b5` | antique brass balance scale dark still life |
| `frost-nail` | `photo-1748160389781-751bd196bcc6` | rusty nails macro |
| `gold-ash` | `photo-1789754731214-57f457cadebc` | gold coins ashes burnt dark still life |
| `grave-penny` | `photo-1534951009808-766178b47a4f` | stack of coins dark |
| `grindstone-dust` | `photo-1671754206770-795c5fc3bb93` | stone dust powder dark |
| `hollow-tooth` | `photo-1722837766894-ab72c7ed8507` | tooth fossil dark |
| `index-card` | `photo-1785088561596-a22c8ade7fc1` | library card catalog dark |
| `iron-comb` | `photo-1598195801625-b0a0c99342e9` | antique comb dark table |
| `lead-thimble` | `photo-1663888673842-e9d7a6473aa8` | silver thimble macro |
| `long-wager` | `photo-1600240936896-5d167000276f` | old contract paper dark still life |
| `pocket-forge` | `photo-1668066826178-2f54acb43166` | small portable brass stove dark still life |
| `rust-knife` | `photo-1560848935-ac4acb7444dc` | rusty knife blade macro dark |
| `sealed-letter` | `photo-1581438395625-215c5c2c6f2e` | sealed envelope wax letter dark table |
| `shield-splinter` | `photo-1606514133761-8088a9c36447` | broken shield fragment metal dark still life |
| `slow-coal` | `photo-1703359905448-6ceada4db44e` | single charcoal lump macro dark |
| `spyglass` | `photo-1764605357421-6bd96a1f9991` | brass spyglass telescope dark still life |
| `staunch-moss` | `photo-1656921593721-2750b03a91d7` | moss clump macro dark green |
| `tailwind-flag` | `photo-1599927004038-5ff86725900c` | torn cloth flag dark |
| `twin-needle` | `photo-1601125611205-9a5e6f292abf` | needle and thread dark |
| `whetstone-kit` | `photo-1625497334603-223c5a64f2df` | sharpening stone table |
