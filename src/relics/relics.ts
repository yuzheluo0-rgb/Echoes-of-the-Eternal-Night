// Explicit `.ts` specifiers throughout: `relics.test.ts` runs under node's strip-types runner, which
// does no extensionless resolution and parses neither JSX nor CSS. Keep this file data-only.

/**
 * 遗物 — the things the long night left lying around.
 *
 * Cards are what you *do*; relics are what you *are*. A relic is never played and never drawn, so
 * every one of them has to earn its place as a passive that changes how a fight reads. The rule the
 * whole set is built on: **a relic must bite into a mechanic that already exists** — 余烬, 锋锐,
 * 壁垒, 映照, 灼烧, 烙印, 反震, 蓄火, 连缀, 空明 — rather than adding a number to a number. A
 * relic that says "+2 伤害" is a card that forgot it was supposed to be interesting.
 *
 * The ladder is about *how long a thing has survived the night*, which is why it runs 残片 → 旧物 →
 * 珍品 → 秘宝 → 绝响 rather than reusing the cards' fire ladder (残烬 → 星陨). Two ladders that
 * both mean "rarer" and both sound like burning would be one ladder too many.
 *
 * **The two slots.** A 主遗物 gives the effect printed on the card. A 副遗物 gives the *lesser*
 * effect — written out per relic rather than scaled by a formula, because not every effect has a
 * number to halve: "灼烧不再递减" has no smaller version of itself, it has a different one.
 */

export type RelicTier = 'shard' | 'relic' | 'treasure' | 'arcanum' | 'echo';

export interface RelicTierDef {
  id: RelicTier;
  name: string;
  /** One line, shown on hover: what this rung of the ladder means. */
  gloss: string;
  accent: string;
  /** Relative draw weight when a slot rolls for a relic. */
  weight: number;
}

/** Lowest rung first. The gallery, the draw and the picker all read the ladder in this order. */
export const RELIC_TIERS: RelicTierDef[] = [
  { id: 'shard', name: '残片', gloss: '有一点用，仅此而已。', accent: '#7f8a84', weight: 34 },
  { id: 'relic', name: '旧物', gloss: '上一个守夜人留下的，还能用。', accent: '#b6c3b2', weight: 30 },
  { id: 'treasure', name: '珍品', gloss: '值得为它改一改打法。', accent: '#d4bd87', weight: 20 },
  { id: 'arcanum', name: '秘宝', gloss: '它改的不是数值，是这仗怎么打。', accent: '#e08a52', weight: 11 },
  { id: 'echo', name: '绝响', gloss: '长夜里只此一件，此后再无。', accent: '#e2564f', weight: 5 },
];
export const TIER_BY_ID = new Map(RELIC_TIERS.map(tier => [tier.id, tier]));
export const RANK_OF: Record<RelicTier, number> = { shard: 0, relic: 1, treasure: 2, arcanum: 3, echo: 4 };

export interface RelicDefinition {
  id: string;
  name: string;
  tier: RelicTier;
  /** The 主遗物 effect, in full. */
  text: string;
  /** The 副遗物 effect — the same idea, held more loosely. */
  sub: string;
  /** Which chapter first offers it. Chapter I is the grassland; later chapters add more. */
  chapter: number;
  /** One line of provenance for the compendium. */
  lore: string;
  /**
   * 这件东西**只能装在主槽**。
   *
   * Every other relic in the set is one object with two ways to carry it: the 主 slot gives the
   * printed effect and the 副 slot a lesser version of the same idea. These are not that — they are a
   * thing that only works when it leads. Writing a fake "lesser version" for a slot they can never
   * occupy would be the 副槽 lying about a slot it does not have, so `sub` says the true reason
   * instead and this flag carries the rule everywhere it has to be enforced:
   * `claimRelic`, `isValidRun`, the draw panel, and the card face.
   */
  mainOnly?: boolean;
}

const R = (
  id: string, name: string, tier: RelicTier, text: string, sub: string, chapter: number, lore: string,
): RelicDefinition => ({ id, name, tier, text, sub, chapter, lore });

/** 只能装在主槽的那几件 —— see `RelicDefinition.mainOnly`. */
const R1 = (
  id: string, name: string, tier: RelicTier, text: string, chapter: number, lore: string,
): RelicDefinition => ({ id, name, tier, text, sub: '不可置于副槽。', chapter, lore, mainOnly: true });

/**
 * The set. Grouped by rung so the shape of the ladder stays legible when editing.
 *
 * Chapter I (草地 · 余烬营地) unlocks `残片` and `旧物` in full plus a handful of `珍品`, so the
 * first chapter's relic pool is 42 deep. `秘宝` and `绝响` are held back — they are the things a
 * second chapter is *for*.
 */
export const RELICS: RelicDefinition[] = [
  // ---------------------------------------------------------------- 残片 · 14
  // Small, unconditional, and always welcome. These are the ones a player is happy to see and never
  // builds around — which is exactly what the bottom rung is for.
  R('flint', '打火石', 'shard', '战斗开始时，获得 1 层余烬。', '战斗开始时，获得 1 层余烬；若已有余烬，改为获得 1 点格挡。', 1, '敲两下就有的东西，营地里最不缺，也最先用完。'),
  R('whetstone', '磨石', 'shard', '战斗开始时，获得 1 层锋锐。', '战斗开始时，获得 1 层锋锐；若已有锋锐，改为获得 1 点格挡。', 1, '守夜人磨刀的时间比睡觉长。'),
  R('hemp-rope', '麻绳', 'shard', '战斗开始时，获得 1 层壁垒。', '战斗开始时，获得 1 层壁垒；若已有壁垒，改为获得 2 点格挡。', 1, '捆过帐篷、捆过柴、也捆过人。'),
  R('iron-nail', '铁钉', 'shard', '你的攻击牌伤害 +1。', '你的攻击牌每第 3 次命中伤害 +1。', 1, '从塌掉的房梁上拔下来的。'),
  R('dry-ration', '干粮', 'shard', '每场战斗胜利后，额外回复 3 点生命。', '每场战斗胜利后，额外回复 1 点生命。', 1, '硬得能砸开核桃，也能砸开别的东西。'),
  R('copper-coin', '铜板', 'shard', '每场战斗胜利后，额外获得 5 金币。', '每场战斗胜利后，额外获得 2 金币。', 1, '上面的人像已经磨平了，谁也没认出来过。'),
  // The sub used to be 「若手牌少于 4 张」, and the opening hand is always five — so it never fired.
  // A lesser slot that cannot trigger is worse than a smaller number: the card prints an effect and
  // the effect does not exist.
  R('candle-stub', '蜡头', 'shard', '战斗开始时，抽 1 张牌。', '战斗开始时，抽 1 张牌，然后弃 1 张手牌。', 1, '烧到只剩一截，还能再点一个晚上。'),
  R('empty-vial', '空瓶', 'shard', '战斗开始时，回复 2 点生命。', '战斗开始时，若生命低于一半，回复 2 点生命。', 1, '里面的东西早就喝完了，瓶子舍不得扔。'),
  R('fish-bone', '鱼骨', 'shard', '回合结束时若手牌为空，获得 2 点格挡。', '回合结束时若手牌为空，获得 1 点格挡。', 1, '河早就冻上了，这副骨头比河活得久。'),
  R('stone-shard', '石片', 'shard', '每场战斗的第一张攻击牌伤害 +3。', '每场战斗的第一张攻击牌伤害 +1。', 1, '断口很新，说明有人刚用过它。'),
  R('rope-knot', '绳结', 'shard', '每场战斗的第一个回合，能量 +1。', '每场战斗的第一个回合，能量 +1，但抽牌少 1 张。', 1, '打了七个结，据说第八个是用来记事的。'),
  R('wood-whistle', '木哨', 'shard', '每场战斗的第一个回合，所有敌人攻击 -1。', '每场战斗的第一个回合，随机一个敌人攻击 -1。', 1, '吹不响，但它出现在那里本身就够吓人了。'),
  R('dead-wick', '熄芯', 'shard', '生命低于一半时，每回合开始时获得 1 层余烬。', '生命低于四分之一时，每回合开始时获得 1 层余烬。', 1, '灯灭了，芯还在。'),
  R('chipped-bowl', '缺口碗', 'shard', '战斗开始时，获得 1 层反震。', '战斗开始时，获得 1 层反震；若已有反震，改为获得 2 点格挡。', 1, '缺口朝向自己，是吃饭的人自己磕的。'),

  // ---------------------------------------------------------------- 旧物 · 22
  // The middle of the ladder: a real effect with a real condition. These are what most of a run's
  // relic slots end up holding.
  R('brass-watch', '黄铜怀表', 'relic', '每场战斗第 5 回合开始时，能量 +1。', '每场战斗第 7 回合开始时，能量 +1。', 1, '停在某个时刻，没人知道那是几点。'),
  // Was 「从弃牌堆取回 1 张牌」, which is a no-op: the discard pile is empty at battle start, so the
  // relic did nothing at all. A key should open the draw pile instead.
  R('brass-key', '铜钥匙', 'relic', '战斗开始时，从抽牌堆中找出 1 张攻击牌加入手牌。', '战斗开始时，从抽牌堆中找出 1 张技能牌加入手牌。', 1, '锁早就没了，钥匙还在。'),
  R('compass', '罗盘', 'relic', '战斗开始时，为第一个敌人附加 1 层烙印。', '战斗开始时，为随机一个敌人附加 1 层烙印。', 1, '不指北，一直指着营地的方向。'),
  R('hourglass', '沙漏', 'relic', '每场战斗第 3 回合开始时，抽 2 张牌。', '每场战斗第 3 回合开始时，抽 1 张牌。', 1, '沙是新的，玻璃是旧的。'),
  R('iron-bell', '铁铃', 'relic', '战斗开始时，所有敌人获得 1 层灼烧。', '战斗开始时，随机一个敌人获得 1 层灼烧。', 1, '巡夜用的，摇一次代表一切正常。'),
  R('broken-comb', '断齿梳', 'relic', '每回合第一张技能牌费用 -1。', '每回合第一张技能牌费用 -1，每场战斗只生效两次。', 1, '少了三根齿，正好够用。'),
  R('waterskin', '皮水袋', 'relic', '战斗胜利后回复的生命翻倍。', '战斗胜利后回复的生命 +50%。', 1, '皮子比人耐用。'),
  R('bone-whistle', '骨哨', 'relic', '战斗开始时，随机一张手牌费用 -1。', '战斗开始时，随机一张手牌费用 -1，最低为 1。', 1, '吹出来的声音不像鸟，也不像风。'),
  // 映照 has no implementation in the battle engine yet — `types.ts` declares the status and the
  // 千面回廊 deck's cards reference it, but nothing spends or applies it, because that deck is
  // locked and has never been playable. A relic that handed out 映照 would hand out nothing, so
  // 铜镜 and 双生镜 both do their doubling in a way the engine can actually carry out.
  R('brass-mirror', '铜镜', 'relic', '战斗开始时，复制手牌中随机 1 张牌。', '战斗开始时，复制手牌中随机 1 张牌，复制品的费用 +1。', 1, '照出来的人比本人老。'),
  R('salt-jar', '盐罐', 'relic', '灼烧每次结算的伤害 +1。', '灼烧每次结算的伤害 +1，但只对第一个敌人生效。', 1, '营地最贵的东西，比刀还贵。'),
  R('iron-tongs', '铁夹', 'relic', '每场战斗第一次受到攻击时，格挡 +4。', '每场战斗第一次受到攻击时，格挡 +2。', 1, '用来夹烧红的铁，也用来夹别的东西。'),
  R('work-gloves', '麻布手套', 'relic', '每回合第一张攻击牌伤害 +2。', '每回合第一张攻击牌伤害 +1。', 1, '掌心磨穿了，指节还在。'),
  R('clay-lamp', '陶灯', 'relic', '回合结束时若剩余能量 ≥2，获得 1 层余烬。', '回合结束时若剩余能量 ≥2，获得 1 层余烬，每场战斗只生效三次。', 1, '灯油烧的是草甸上割下来的东西。'),
  R('chain-link', '铁链节', 'relic', '战斗开始时，获得 2 层壁垒。', '战斗开始时，获得 1 层壁垒。', 1, '链子断了，这一节留了下来。'),
  R('dry-herbs', '干草药', 'relic', '战斗开始时，回复 4 点生命。', '战斗开始时，回复 2 点生命。', 1, '什么也治不好，但闻着让人安心。'),
  R('musket-balls', '燧发枪弹', 'relic', '每场战斗的第一张攻击牌额外命中一次。', '每场战斗的第一张攻击牌额外命中一次，伤害减半。', 1, '枪早就不在了，弹还留着。'),
  R('leather-bracer', '皮革护腕', 'relic', '每回合第一次被攻击时，反震 +2。', '每场战斗第一次被攻击时，反震 +2。', 1, '内侧有一道很深的咬痕。'),
  R('charred-block', '焦木块', 'relic', '每当有敌人因灼烧死亡，获得 2 层余烬。', '每当有敌人因灼烧死亡，获得 1 层余烬。', 1, '从烧塌的房梁上掰下来的。'),
  R('old-map', '旧地图', 'relic', '战斗开始时，抽 2 张牌，然后弃 2 张牌。', '战斗开始时，抽 1 张牌，然后弃 1 张牌。', 1, '画的是这片草甸，但河的位置不对。'),
  R('tin-cup', '锡杯', 'relic', '每场战斗胜利后，额外回复 6 点生命。', '每场战斗胜利后，额外回复 3 点生命。', 1, '凹了一块，正好握得住。'),
  R('dog-tag', '犬牌', 'relic', '战斗开始时，为所有敌人附加 1 层烙印。', '战斗开始时，为生命最高的敌人附加 1 层烙印。', 1, '上面刻的不是名字，是一个编号。'),
  R('tar-lamp', '沥青灯', 'relic', '每回合开始时，若你的格挡为 0，获得 3 点格挡。', '每回合开始时，若你的格挡为 0，获得 2 点格挡。', 1, '烧起来很臭，但很亮。'),

  // ---------------------------------------------------------------- 珍品 · 16
  // The first rung that asks something of the player: almost every one of these has a downside, a
  // condition, or a decision attached.
  R('night-lantern', '守夜人的提灯', 'treasure', '每回合第一张攻击牌伤害 +3。', '每回合第一张攻击牌伤害 +2。', 1, '提着它的人走完了十二片地。'),
  R('ash-urn', '灰烬瓮', 'treasure', '每场战斗开始时，移除手牌与抽牌堆中所有「灰烬」。', '每场战斗开始时，移除手牌中所有「灰烬」。', 1, '装的是谁，没有人问过。'),
  R('ledger', '商队账本', 'treasure', '战斗胜利后获得的金币 +50%。', '战斗胜利后获得的金币 +25%。', 1, '最后一页记着「再清点一遍就出发」。'),
  R('ember-seed', '未熄的火种', 'treasure', '每回合开始时，获得 1 层余烬。', '每场战斗的第 1、4、7 回合开始时，获得 1 层余烬。', 1, '放在水里也在烧。'),
  // The sub used to keep the same 「第一张牌费用 +1」 tax as the main slot, which made the lesser
  // slot's *downside* identical to the greater one's — a discount that only discounts the upside.
  R('broken-edge', '断刃', 'treasure', '攻击牌伤害 +3，但每回合第一张牌费用 +1。', '攻击牌伤害 +2。', 1, '断口朝向握它的人。'),
  R('twin-mirrors', '双生镜', 'treasure', '每场战斗第一次打出的牌，回到手牌而不是进入弃牌堆。', '每场战斗第一次打出的攻击牌，回到手牌而不是进入弃牌堆。', 1, '两面镜子对着放，里面没有尽头。'),
  R('smith-hammer', '铁匠锤', 'treasure', '每场战斗第一张能力牌费用 -2。', '每场战斗第一张能力牌费用 -1。', 1, '柄上缠的布被汗浸成了黑色。'),
  R('hair-shirt', '苦修带', 'treasure', '每回合开始时失去 1 点生命，获得 2 层锋锐。', '每回合开始时失去 1 点生命，获得 1 层锋锐。', 1, '穿上它的人说自己是在还债。'),
  R('spyglass', '观星镜', 'treasure', '战斗开始时，看抽牌堆顶 3 张，并抽其中 1 张。', '战斗开始时，看抽牌堆顶 2 张并抽其中 1 张，但该牌本场费用 +1。', 1, '守夜的人靠它熬过最长的那些夜。'),
  R('bone-ring', '骨戒', 'treasure', '每回合第一次打出攻击牌时，获得 1 层余烬。', '每场战斗的前两次攻击牌，各获得 1 层余烬。', 1, '内圈刻着一个已经认不出的字。'),
  R('moss-jar', '苔藓罐', 'treasure', '战斗胜利后额外回复 8 点生命。', '战斗胜利后额外回复 4 点生命。', 1, '苔藓在里面长得比外面好。'),
  R('storm-wood', '雷击木', 'treasure', '引火的折扣提高 1 点（本回合第一张牌 -2）。', '引火的折扣提高 1 点，但每场战斗只在前三个回合生效。', 1, '被劈开的那年，草甸烧了整整一个月。'),
  R('brass-hand', '铜制假肢', 'treasure', '战斗开始时，获得等同于已损失生命 20% 的格挡。', '战斗开始时，获得等同于已损失生命 10% 的格挡。', 1, '做得比真手还精细。'),
  R('iron-mask', '铁面具', 'treasure', '每场战斗第一次受到致命伤害时，保留 1 点生命。', '每场战斗第一次受到致命伤害时，保留 1 点生命，但你下回合少 1 点能量。', 1, '里面没有脸，外面也没有表情。'),
  R('burning-book', '焚书', 'treasure', '回合结束时，随机一张手牌费用在本场战斗中永久 -1。', '每场战斗的前两个回合结束时，随机一张手牌费用永久 -1。', 1, '烧到一半被人抢了下来。'),
  R('bell-clapper', '铃舌', 'treasure', '每场战斗开始时，所有敌人失去 2 点格挡并各获得 1 层烙印。', '每场战斗开始时，随机一个敌人失去 2 点格挡并获得 1 层烙印。', 1, '铃没了，舌头还在响。'),

  // ---------------------------------------------------------------- 秘宝 · 12
  // The rung where a relic stops being a bonus and starts being a plan. Everything here changes the
  // shape of a fight rather than its numbers.
  R('long-eye', '长夜之瞳', 'arcanum', '每回合第一张攻击牌命中两次（第二次伤害减半）。', '每场战斗第一张攻击牌命中两次（第二次伤害减半）。', 2, '睁着的时候看不见东西，闭上才看得见。'),
  R('endless-hourglass', '无尽沙漏', 'arcanum', '每场战斗第 4 回合起，每回合能量 +1。', '每场战斗第 6 回合起，每回合能量 +1。', 2, '沙落完了，翻过来接着落。'),
  R('ember-heart', '余烬之心', 'arcanum', '每回合结束时，余烬 +2。', '每回合结束时，若本回合打出过攻击牌，余烬 +2。', 2, '还在跳，虽然已经没有东西给它供血了。'),
  R('mirror-throne', '镜像王座', 'arcanum', '每场战斗第一次打出的牌，会被复制一份加入手牌。', '每场战斗第一次打出的攻击牌，会被复制一份加入手牌。', 2, '坐上去的人会看见另一个自己站起来。'),
  R('watcher-oath', '守望者之誓', 'arcanum', '生命上限 +15，并在战斗开始时获得 8 点格挡。', '生命上限 +8，并在战斗开始时获得 4 点格挡。', 2, '一段念不完的誓词，念到一半就天亮了。'),
  R('verdict-scales', '断罪之秤', 'arcanum', '对满血敌人造成的伤害翻倍。', '对满血敌人造成的伤害 +50%。', 2, '两边永远不平，除非把一边砍掉。'),
  R('echo-box', '回响之匣', 'arcanum', '每场战斗一次：打出的牌不进弃牌堆，而是回到手牌。', '每场战斗一次：打出的攻击牌不进弃牌堆，而是回到手牌。', 2, '对着它说话，它会晚一拍才回答。'),
  R('cinder-furnace', '焚炉', 'arcanum', '灼烧不再递减。', '灼烧每两回合才递减一次。', 2, '营地的火就是从这儿引出去的。'),
  R('bone-crown', '骨王冠', 'arcanum', '每击杀一个敌人，获得 3 层锋锐。', '每击杀一个敌人，获得 1 层锋锐。', 2, '戴过它的人都不肯摘下来。'),
  R('starfall-shard', '星陨碎片', 'arcanum', '战斗开始时，对所有敌人造成 8 点伤害。', '战斗开始时，对随机一个敌人造成 8 点伤害。', 2, '掉下来的那天，整片草甸都听见了。'),
  R('twin-souls', '双生魂', 'arcanum', '战斗开始时生命减半，但每回合能量 +1。', '战斗开始时生命减半，但每场战斗前三个回合能量 +1。', 2, '两根蜡烛，一簇火。'),
  R('night-weaver', '织夜者', 'arcanum', '每 3 回合，抽牌堆里随机一张牌在本回合免费打出。', '每 4 回合，抽牌堆里随机一张牌在本回合费用 -2。', 2, '它织的不是网，是夜本身。'),

  // ---------------------------------------------------------------- 绝响 · 7
  // One run should meet at most one or two of these. Each is a whole build.
  R('eternal-heart', '永夜之心', 'echo', '每回合能量 +1。', '每场战斗第 3 回合起，每回合能量 +1。', 3, '长夜不是从天上开始的，是从这颗心开始的。'),
  R('world-fire', '焚世之焰', 'echo', '攻击牌伤害 +6，但每回合结束时失去 3 点生命。', '攻击牌伤害 +3，但每回合结束时失去 2 点生命。', 3, '它烧过的地方，第二年什么也不长。'),
  R('thousand-mirror', '千面之镜', 'echo', '映照不再被消耗。', '每回合第一次使用映照时不消耗。', 3, '你看着它，它也看着你，然后你们交换了位置。'),
  R('unquenched-oath', '不熄之誓', 'echo', '每场战斗一次：生命降到 0 时，以 30% 生命复活。', '每场战斗一次：生命降到 0 时，以 15% 生命复活。', 3, '说出口的誓，火没灭就不算完。'),
  R('sand-of-time', '时间之砂', 'echo', '每回合抽 7 张牌。', '每回合抽 6 张牌。', 3, '抓一把，能听见很多年前的风声。'),
  R('watcher-remains', '守夜人遗骨', 'echo', '战斗开始时，抽牌堆中随机一张牌在本回合免费打出。', '战斗开始时，抽牌堆中随机一张牌在本回合费用 -1。', 3, '他到底守到了第几个晚上，没人记得。'),
  R('final-chapter', '长夜终章', 'echo', '每场战斗第 10 回合起，你造成的所有伤害翻倍。', '每场战斗第 12 回合起，你造成的所有伤害翻倍。', 3, '最后一页，字迹和前面完全不同。'),

  // ---------------------------------------------------------- 绝响 · 无名之物
  // The two below are **主槽 only** (`mainOnly`), and they are the only relics in the set that are.
  // A relic's two slots exist so the same object can be carried two ways; these two are not two ways
  // of carrying anything — they are a thing that only does what it does when it is the one you lead
  // with. The sub line therefore says so instead of pretending to be a lesser version of the same
  // effect, which is what every other relic's sub line is.
  // ⚠️ 文案被卡面**截断过一次**：`.rl-text` 是固定三行，第一版写了 66 个字，在卡面上显示成
  // 「…受到致命伤时改为吸收血雾、」。数字一个都不能少，所以只能把句子收紧——这一整套遗物的
  // 文案都是这个长度，不是它们特别短。
  R1('blood-mist', '血云雾霭之卷', 'echo',
    '你造成的伤害按 20% 回复生命。生命高于六成的敌人多受 30% 伤害。'
    + '致命伤时改为回复 15% 生命，卷轴焚毁。',
    3, '它从一个人的身体里升起来，那人死了很久，雾还没有散。'),
  R1('hunter-mark', '猎魔人之证', 'echo',
    '每回合第一张造成伤害的牌翻倍，并抽 1 张。'
    + '若它直接击杀，退还该牌的全部能量。',
    3, '发证的人一个也没回来过，证件倒是陆续回来了。'),
];

export const RELIC_BY_ID = new Map(RELICS.map(relic => [relic.id, relic]));

// ------------------------------------------------------------------- 淬炼

/**
 * 淬炼 — how far a relic's numbers have been pushed up.
 *
 * 打磨 is the card's version of this: the same card, larger numbers. 淬炼 is the relic's version, and
 * it is **purely numeric**: it does not change which branch of a relic is live, does not move it
 * between slots, and does not touch its rules. Every number the relic prints simply gets bigger.
 *
 *   小强化   该遗物印出来的每一个数 **+1**
 *   大强化   **+2**
 *
 * Which number that is depends on the relic and on which slot it sits in — 干粮 pays 3 生命 in the
 * main slot and 1 in the sub — so the bump is applied wherever the relic reads its number, through
 * `ctx.n` / `ctx.v` in `src/battle/relics.ts`. Nothing is scaled in the engine afterward, so the two
 * can never drift apart.
 *
 * The vocabulary lives **here**, in the data module, rather than beside the behaviour, because both
 * sides need it and only one direction of import is allowed: `src/relics/**` may not reach into
 * `src/battle/**` (the whole gallery is meant to be openable without the battle engine), so the card
 * face reads the tier from here and the engine reads it from here too.
 *
 * A handful of relics do not want a flat +1 — see `REFINE_TEXT` below, and the test that keeps the
 * two lists honest.
 */
export type RefineTier = 'small' | 'large';

/** How much every printed number goes up. The single place the two tiers are told apart. */
export function refineSteps(tier: RefineTier | undefined): number {
  return tier === 'large' ? 2 : tier === 'small' ? 1 : 0;
}

/** The tier's name as the player reads it. `undefined` is the unrefined relic, which needs no label. */
export const REFINE_LABEL: Record<RefineTier, string> = { small: '小强化', large: '大强化' };

/** What a relic's two slot numbers become once quenched. Exported so the tests can assert it directly. */
export function refinedPair(main: number, sub: number, refine: RefineTier | undefined): [number, number] {
  const steps = refineSteps(refine);
  return [main + steps, sub + steps];
}

/**
 * 淬炼文案 — for the relics whose rung is **not** one point.
 *
 * Forty-seven of the fifty-two relics scale by exactly +1 per tier (`ctx.n` / `ctx.v`), and their card
 * faces can say so generically: 「本件印出的每一个数 +1」 is true, checkable, and needs no authoring.
 * These five cannot say that, because +1 would be meaningless or backwards on them:
 *
 *   皮水袋 / 商队账本   the number is a **percentage** — 回血加成 50% + 1% would be invisible
 *   黄铜手             the number multiplies a fraction, so its rung is ten points of ceiling
 *   黄铜怀表           the number is a **turn**, and bigger is *later* — this one's rung runs backwards
 *   熄芯               the thresholds are **fractions**, and 0.25 + 1 would be a condition that is
 *                      always true, which is a different relic rather than a better one
 *
 * `relics.test.ts` enforces the split **behaviourally**: it runs each relic's own handlers at both
 * tiers and requires that every relic whose numbers do not move by exactly one is listed here, and
 * that everything listed here really does move by something other than one. A relic that is added to
 * this table by mistake fails; so does one that needed to be and was forgotten.
 */
export const REFINE_TEXT: Record<string, { small: string; large: string }> = {
  waterskin: {
    small: '营火回血加成再 +15%。',
    large: '营火回血加成再 +30%。',
  },
  ledger: {
    small: '战后金币加成再 +15%。',
    large: '战后金币加成再 +30%。',
  },
  'brass-hand': {
    small: '按已损失生命换算的格挡，上限 +10 点。',
    large: '按已损失生命换算的格挡，上限 +20 点。',
  },
  'brass-watch': {
    small: '提前一回合：主槽第 4 回合、副槽第 6 回合给能量。',
    large: '提前两回合：主槽第 3 回合、副槽第 5 回合给能量。',
  },
  'dead-wick': {
    small: '触发线抬高 10%：主槽六成生命、副槽三成半。',
    large: '触发线抬高 20%：主槽七成生命、副槽四成半。',
  },
};

export function relicsOfTier(tier: RelicTier): RelicDefinition[] {
  return RELICS.filter(relic => relic.tier === tier);
}
/** What a chapter's pool actually contains. Chapter I is the bottom two rungs plus a few 珍品. */
export function relicsForChapter(chapter: number): RelicDefinition[] {
  return RELICS.filter(relic => relic.chapter <= chapter);
}
export function tierCounts() {
  const counts = { shard: 0, relic: 0, treasure: 0, arcanum: 0, echo: 0 } as Record<RelicTier, number>;
  for (const relic of RELICS) counts[relic.tier] += 1;
  return counts;
}
