/**
 * 奇遇 — the `?` floors.
 *
 * An event is a **choice with a cost**, not a random gift. Everything here takes something to give
 * something: 生命 for gold, gold for a relic, a card for a card. A `?` node that just handed out 40
 * coins would be a worse treasure chest.
 *
 * THREE RULES SHAPE THE TABLE
 *
 *   1. **A floor has to be more than a payout.** An event that always hands over its best answer for
 *      nothing is a slower treasure chest, and 「值不值得」 only exists if some answers cost something.
 *      Each entry carries `lean` saying what its answers are like — see the field's own note. Only
 *      **four of the twenty-four** are a clean profit, and that is the number this table is aiming
 *      at: a tower where a `?` is usually a gift is a tower with no decisions in it.
 *   2. **Every cost is paid before the effect.** `requires` is checked first, so an event can never
 *      be the thing that kills the run and can never let the player spend coin they do not have.
 *   3. **The outcome line is written, not generated.** 「你失去 6 点生命」 is a spreadsheet;
 *      「你把手伸进去，指尖被什么咬了一口」 is an event.
 *
 * Written from the grassland's own furniture — the caravan that never arrived, the hollow tree, the
 * watch that has not stopped, the fire that is still burning — so the events read as things that
 * were already out there rather than as a separate fiction bolted on.
 */

import { REFINE_LABEL, type RefineTier } from '../relics/relics.ts';
import { JUNK, isHazard } from './enemies.ts';

/** The printed name of a hazard, for the line that says what an option cost you. */
function hazardName(cardId: string): string {
  return isHazard(cardId) ? JUNK[cardId].name : cardId;
}

export type EventEffect =
  /** Coin, positive or negative. */
  | { kind: 'gold'; amount: number }
  /** 生命, positive or negative. */
  | { kind: 'hp'; amount: number }
  /** 生命上限, positive or negative. */
  | { kind: 'maxHp'; amount: number }
  /** A relic draw. */
  | { kind: 'relic' }
  /** Choose a card to burn. */
  | { kind: 'remove' }
  /** Choose a card to 打磨. */
  | { kind: 'polish' }
  /** Choose a card to copy. */
  | { kind: 'duplicate' }
  /** Three cards, take one. */
  | { kind: 'cards'; count: number }
  /**
   * 淬炼 one of the relics you are carrying — **and the relic can be destroyed by it**.
   *
   * The only effect in the table with a chance of going wrong, which is why it is its own kind rather
   * than a rider on `relic`. Everything else here is a price you can read before you pay; this one is
   * a price you *might* pay. `chance` is a percentage, and it is on the option rather than in the
   * engine so the two tiers can be visibly, readably different bets.
   *
   * The relic itself is chosen by the player afterwards (see `ChapterRun.relicTask`), because with two
   * slots there is a real decision about which one to risk and the event has no way to know it.
   */
  | { kind: 'refine'; tier: RefineTier; chance: number }
  /**
   * A **hazard** card forced into the deck: 「你拿走了它，它也跟着你走」.
   *
   * The only effect whose payoff is a *cost*, and it lives on the option that also pays well — an
   * option with nothing but this on it is just a worse `nothing`. It is what makes 「换一条更近的路」
   * a real question: the shortcut is real, and so is what you picked up on it.
   */
  | { kind: 'junk'; cardId: string; with?: EventEffect }
  /**
   * A trade: **one of your cards leaves the deck and one arrives**, both at random.
   *
   * ⚠️ This exists because the prose got ahead of the mechanic. 「和他换一张」 has always read
   * 「他挑走一张，塞给你一张」, and its effect was `cards(3)` — the player picked one of three and
   * nothing was ever taken. The card was lying, in the one direction a card must never lie: it said
   * something had *cost* you and nothing had.
   *
   * Random rather than chosen, because the sentence says **他**挑走一张 — he picks. The reveal screen
   * shows both halves; a swap the player cannot see the losing half of is a swap they will not
   * believe happened.
   */
  | { kind: 'swap' }
  /** Nothing at all, which is sometimes the right answer. */
  | { kind: 'nothing' };

export interface EventOption {
  /** The button. */
  label: string;
  /** What the player is told will happen, before they commit. Never a lie. */
  hint: string;
  /** The line printed once it resolves. */
  outcome: string;
  /**
   * A cost that must be payable, or the option is disabled. Absent means always available.
   *
   * `relic` is not a cost but the same thing operationally: 淬炼 needs something to quench, and an
   * option that opens a picker with nothing in it reads as a broken button rather than as an answer.
   */
  requires?: { gold?: number; hp?: number; relic?: boolean };
  effect: EventEffect;
}

export interface EventSpec {
  id: string;
  name: string;
  blurb: string;
  /**
   * What this floor's answers are like, as one of three shapes. Drives the balance test.
   *
   * It was two values, and two was not enough: sixteen of the twenty-four floors have **both a price
   * and a catch** — 「三张牌，但那张纸你不知道有什么用」 is neither a clean profit nor a loss, and
   * filing it under either one is how the label stops meaning anything. So:
   *
   *   `gain` — 某个选项白拿。There is an answer with nothing attached to it, and you can just take it.
   *   `cost` — 有代价，也有不用付的。「慢一点，但不会伤到自己」 against 「徒手挖开，土是热的」. The
   *            floor is a question about how much you want it, and walking away is a real answer.
   *   `loss` — 每个选项都要付，或者白跑。Nothing here is free: the best you can do is pay, and the
   *            worst is lose a night for it.
   *
   * Every one of the three is checked mechanically in `events.test.ts`, which is the point of
   * splitting them — a label nobody can test is a label that drifts.
   */
  lean: 'gain' | 'cost' | 'loss';
  options: EventOption[];
}

/** Shorthands, so the table below reads as prose rather than as object literals. */
const gold = (amount: number): EventEffect => ({ kind: 'gold', amount });
const hp = (amount: number): EventEffect => ({ kind: 'hp', amount });
const maxHp = (amount: number): EventEffect => ({ kind: 'maxHp', amount });
const relic = (): EventEffect => ({ kind: 'relic' });
const burn = (): EventEffect => ({ kind: 'remove' });
const polish = (): EventEffect => ({ kind: 'polish' });
const copy = (): EventEffect => ({ kind: 'duplicate' });
const cards = (count: number): EventEffect => ({ kind: 'cards', count });
const swap = (): EventEffect => ({ kind: 'swap' });
const nothing = (): EventEffect => ({ kind: 'nothing' });
const quench = (tier: RefineTier, chance: number): EventEffect => ({ kind: 'refine', tier, chance });
/**
 * A hazard, forced on you as the price of something else.
 *
 * `with` is not decoration: a hazard **on its own is never worth an option** — it would be a strictly
 * worse `nothing`, and 「白跑一趟」 is already the thing `lean:'loss'` exists for. The card is the price
 * of the payoff beside it, which is what makes 「近路」 a question worth asking.
 */
const jinx = (cardId: string, with_?: EventEffect): EventEffect =>
  ({ kind: 'junk', cardId, with: with_ });

export const EVENTS: EventSpec[] = [
  // ---------------------------------------------------------------- the caravan
  {
    id: 'lost-caravan', name: '失落的商队',
    blurb: '货车还停在原地，轮子陷进泥里。货主不在，货还在。',
    lean: 'gain',
    options: [
      { label: '拆开货箱', hint: '拿走能拿的，会被留下的人记恨。', outcome: '你搬走了半箱铜器。回头看时，货车后面似乎有什么动了一下。', effect: gold(90) },
      { label: '只拿药品', hint: '少拿一点，少欠一点。', outcome: '你只取了绷带和一小瓶烈酒。剩下的原封不动。', effect: hp(14) },
      { label: '在车边生一堆火', hint: '好好歇一晚。', outcome: '你在车边坐到天亮。风吹过帆布，像有人还在赶路。', effect: polish() },
    ],
  },
  {
    id: 'cargo-manifest', name: '货单',
    blurb: '一张钉在车厢上的纸，列着这批货该送到哪。收件人那一栏被划掉了。',
    lean: 'cost',
    options: [
      { label: '按着货单找剩下的车', hint: '路很远。', outcome: '你走了很久，找到两辆翻掉的车和一小箱没被发现的铜钱。脚上全是泡。', requires: { hp: 6 }, effect: gold(120) },
      { label: '把纸撕下来收好', hint: '不知道有什么用。', outcome: '你把它折起来放进怀里。它硌着你，走了一路。', effect: cards(3) },
      { label: '烧了它', hint: '没人会来了。', outcome: '纸烧得很慢。你看着收件人那一栏变成灰。', effect: nothing() },
    ],
  },
  {
    id: 'beast-of-burden', name: '还在等的驮兽',
    blurb: '一头驮兽站在路边，背上的货没卸，绳子也没解。它在等一个不会回来的命令。',
    lean: 'cost',
    options: [
      { label: '解开绳子放它走', hint: '货掉下来就是你的。', outcome: '它站了很久才明白自己可以走了。货箱摔开，里面是行军口粮。', effect: hp(18) },
      { label: '骑上去试试', hint: '它可能不认生人。', outcome: '它把你甩下来，但没有走远。你摔得很痛，可它驮着的箱子开了。', requires: { hp: 8 }, effect: gold(95) },
      { label: '远远绕开', hint: '有些东西不该打扰。', outcome: '你绕了很远。回头时它还站在那儿，像一块石头。', effect: nothing() },
    ],
  },
  {
    id: 'merchant-ghost', name: '还在做生意的影子',
    blurb: '一个没有脸的人坐在摊子后面，摊上什么也没有，但它比划着让你出价。',
    lean: 'loss',
    options: [
      { label: '把铜板放上去', hint: '买一个说不清是什么的东西。', outcome: '它收下钱，从怀里掏出一样东西推给你。你没有看清它收钱的手。', requires: { gold: 60 }, effect: relic() },
      { label: '摇头走开', hint: '不做没有货的买卖。', outcome: '它没有拦你。走出很远之后，你才想起来摊子上其实摆满了东西。', effect: nothing() },
      { label: '掀开摊子看看', hint: '也许下面有别的。', outcome: '摊子底下是空的，只有一层很厚的灰。你吸进去不少。', requires: { hp: 4 }, effect: cards(3) },
    ],
  },

  // ------------------------------------------------------------------ the tree
  {
    id: 'hollow-tree', name: '萤火树洞',
    blurb: '古树的空心里浮着光，一直升到够不着的地方。',
    lean: 'gain',
    options: [
      { label: '把手伸进去', hint: '光会咬人，也会留下东西。', outcome: '指尖被灼了一下。你抽回手时，掌心里多了一样东西。', effect: relic() },
      { label: '在洞口等到光散', hint: '耐心换一点别的东西。', outcome: '你等了很久。光慢慢沉下去，你在灰里摸到几枚铜钱。', effect: gold(55) },
      { label: '把洞口堵上', hint: '有些东西不该再升起来。', outcome: '你用石头压住了洞口。这一夜安静了许多。', effect: maxHp(4) },
    ],
  },
  {
    id: 'firefly-letters', name: '没写完的信',
    blurb: '树皮内侧刻着字，是有人在很多年里一句一句刻上去的。最后一句只刻了一半。',
    lean: 'cost',
    options: [
      { label: '把剩下的刻完', hint: '你不知道该写什么。', outcome: '你刻了一个自己也不认识的字。刻完之后，手稳了很多。', effect: polish() },
      { label: '照着刻一遍', hint: '临摹不会有什么坏处。', outcome: '你一行一行描过去。描到一半，你发现这些字其实是一份牌序表。', effect: cards(3) },
      { label: '把树皮整个剥下来带走', hint: '带着它，就得一直带着。', outcome: '树皮很重。你背了一路，肩膀磨破了。', requires: { hp: 5 }, effect: relic() },
    ],
  },
  {
    id: 'nested-light', name: '光下面的东西',
    blurb: '萤火升起来的地方，地上有一圈烧焦的痕迹，中间埋着半个箱子。',
    lean: 'cost',
    options: [
      { label: '徒手挖开', hint: '土是热的。', outcome: '你挖到一半就后悔了。掌心烫掉一层皮，箱子终于开了。', requires: { hp: 7 }, effect: relic() },
      { label: '找根棍子来撬', hint: '慢一点，但不会伤到自己。', outcome: '你用树枝撬了半天，撬出几件还能用的东西。', effect: gold(70) },
      { label: '记住这个位置，先走', hint: '回头再来。', outcome: '你往上走了一段，回头时那个位置已经找不到了。', effect: nothing() },
    ],
  },

  // --------------------------------------------------------------- the watch
  {
    id: 'night-watch', name: '还没有停下的巡夜',
    blurb: '前面有人提着灯在走。你喊了一声，它没回头，也没停。',
    lean: 'gain',
    options: [
      { label: '跟上去', hint: '它走过的路，通常是最安全的。', outcome: '你跟了半夜。它在一处岔口消失，而岔口通向的地方比你想的近得多。', effect: hp(22) },
      { label: '叫住它', hint: '用掉一点精神去问一个可能没有答案的问题。', outcome: '它停下来，转过身。你看见灯下什么也没有，但灯自己还在亮着。', effect: relic() },
      { label: '绕开', hint: '不一定每次都要弄明白。', outcome: '你换了一条路。灯光在身后越来越小，最后和别的东西一样黑。', effect: nothing() },
    ],
  },
  {
    id: 'watch-roster', name: '值班表',
    blurb: '钉在木桩上的一张纸，写着名字和时段。最后一个名字后面没有换班的人。',
    lean: 'cost',
    options: [
      { label: '把名字划掉', hint: '让它下班。', outcome: '你划掉那个名字。夜里安静下来，但你一整晚都听见有人在数数。', effect: maxHp(-4) },
      { label: '在旁边刻上自己的名字', hint: '接它的班。', outcome: '刻完那一刻，你觉得肩上多了点什么，也说不上是重量还是别的。', effect: relic() },
      { label: '把纸取下来收好', hint: '一张纸而已。', outcome: '你把它折起来。第二天它还在你怀里，边角已经磨圆了。', effect: cards(3) },
    ],
  },
  {
    id: 'relief-round', name: '换岗的路上',
    blurb: '一串脚印，去的时候很深，回来的时候没有。',
    lean: 'loss',
    options: [
      { label: '顺着脚印走', hint: '看看它走到了哪。', outcome: '脚印一直通向一片烧过的空地，然后就没有了。你站了很久，风很大。', requires: { hp: 6 }, effect: relic() },
      { label: '在原地等它回来', hint: '也许它只是走得慢。', outcome: '你等到天亮。脚印还在，去的时候还是很深。', effect: hp(-8) },
      { label: '把自己的脚印也踩上去', hint: '让它知道有人来过。', outcome: '你在旁边踩了一串平行的脚印，一直踩到自己累了为止。', effect: nothing() },
    ],
  },
  {
    id: 'lamp-oil', name: '灯油',
    blurb: '路边的石台上放着一盏灯，油快见底了，但还亮着。',
    lean: 'cost',
    options: [
      { label: '给它添上自己的油', hint: '你的口粮里有能烧的东西。', outcome: '你把随身带的油倒进去。灯亮了不少，你只剩半份口粮。', requires: { gold: 25 }, effect: hp(20) },
      { label: '把灯拿走', hint: '总有人会需要它。', outcome: '你提着它走了一段。走了很远之后它才灭，而你已经看清了路。', effect: cards(3) },
      { label: '就让它亮着', hint: '有些人靠它认路。', outcome: '你没有碰它。往上爬的时候，那点光一直在你身后。', effect: maxHp(3) },
    ],
  },

  // --------------------------------------------------------------- the burn
  {
    id: 'ash-pit', name: '烧过的地方',
    blurb: '这片草烧过，灰还是温的。中间留着一圈没烧完的东西。',
    lean: 'cost',
    options: [
      { label: '翻一翻', hint: '灰里什么都可能有，包括还不该碰的。', outcome: '你扒开灰，找到几张没烧透的纸。指尖烫掉了一层皮。', requires: { hp: 5 }, effect: cards(3) },
      { label: '把火彻底埋掉', hint: '让它凉透。', outcome: '你花了很久把最后一颗火星踩灭。手稳了一些。', effect: polish() },
      { label: '在这儿歇一晚', hint: '灰是暖的。', outcome: '你靠着余温睡了一会儿。醒来时天没亮，但身体轻了。', effect: hp(18) },
    ],
  },
  {
    id: 'unburned-ring', name: '没烧掉的一圈',
    blurb: '火烧到这里就停了，停得整整齐齐，像一个圆规画的。',
    lean: 'loss',
    options: [
      { label: '站进圈里', hint: '你想知道为什么。', outcome: '你站了进去。什么也没有发生，只是你花了很久才想起来该走出来。', effect: hp(-10) },
      { label: '把圈外的东西搬进来', hint: '也许这里安全。', outcome: '你搬了些柴进来。第二天柴不见了，圈还在。', effect: nothing() },
      { label: '沿着圈的边挖一圈沟', hint: '既然火停在这，就让它停在这。', outcome: '你挖了半夜的沟。天亮时手上全是口子，但那条线更深了。', requires: { hp: 6 }, effect: maxHp(6) },
    ],
  },
  {
    id: 'firebreak', name: '防火带',
    blurb: '有人早就把这片草割倒过，割出一条很宽的带子。割它的人没有留下名字。',
    lean: 'cost',
    options: [
      { label: '顺着带子走', hint: '它通向哪里，割的人最清楚。', outcome: '带子尽头是一间塌了一半的棚屋，棚屋里堆着没来得及用的东西。', effect: gold(65) },
      { label: '把割倒的草收起来', hint: '都是干透的。', outcome: '你捆了一大捆。背着它走路很累，但晚上生火的时候值了。', requires: { hp: 4 }, effect: hp(20) },
      { label: '坐在带子中间', hint: '火到这儿就会停。', outcome: '你在带子中间坐了很久。这是你很久以来第一次觉得两边都是安全的。', effect: maxHp(4) },
    ],
  },

  // -------------------------------------------------------------- the ground
  {
    id: 'root-cellar', name: '地窖口',
    blurb: '一块木板盖在地上，掀开是一段向下的梯子。里面是黑的。',
    lean: 'cost',
    options: [
      { label: '下去', hint: '火光够不到底。', outcome: '你摸下去，摸到一排陶罐。上来的时候膝盖磕在梯子上，但罐子是满的。', requires: { hp: 8 }, effect: gold(110) },
      { label: '把木板盖回去，压上石头', hint: '里面有什么，不该由你放出来。', outcome: '你压了三块石头才觉得稳妥。夜里听见下面有声音，也可能是风。', effect: nothing() },
      { label: '把洞口当据点，先睡一觉', hint: '至少背后是实的。', outcome: '你靠着木板睡了一夜。醒来时木板是热的。', effect: hp(12) },
    ],
  },
  {
    id: 'sinkhole', name: '陷下去的草皮',
    blurb: '一整块草皮陷了下去，露出下面的空洞。空洞里有风。',
    lean: 'cost',
    options: [
      { label: '跳下去看看', hint: '风从某个地方来。', outcome: '你落在一层松土上，没受伤，但爬上来花了很久。洞底有一堆被风刮进来的东西。', effect: cards(3) },
      { label: '用绳子把自己放下去', hint: '稳妥，但绳子得留下。', outcome: '你放下去取了东西，绳子卡在石缝里收不回来了。', requires: { gold: 30 }, effect: relic() },
      { label: '填上它', hint: '谁知道下面连着哪里。', outcome: '你搬了半天的土。填到最后，风停了。', requires: { hp: 6 }, effect: maxHp(5) },
    ],
  },
  {
    id: 'old-well', name: '一口老井',
    blurb: '井沿被绳子磨出了很深的槽。往下看，看不见水，只看见一面镜子。',
    lean: 'gain',
    options: [
      { label: '打一桶上来', hint: '摇把还能转。', outcome: '桶上来的时候是满的，水很凉，能喝。你把水袋灌满了。', effect: hp(16) },
      { label: '对着井底说话', hint: '回声会晚一拍。', outcome: '你说了句话。回声比预想的晚很多，而且不是你的声音。', effect: relic() },
      { label: '往里面丢一块石头', hint: '听个响。', outcome: '石头落下去，没有响。你等了很久，然后走了。', effect: nothing() },
    ],
  },
  {
    id: 'frozen-creek', name: '结了冰的溪',
    blurb: '水面冻得很实，冰下面还看得见水草在动。',
    lean: 'cost',
    options: [
      { label: '凿开一个洞取水', hint: '冰很厚。', outcome: '你凿了很久，手冻得发麻。水很干净，你喝饱了。', requires: { hp: 4 }, effect: hp(22) },
      { label: '沿着冰面走过去', hint: '比绕路快得多。', outcome: '冰面在你身后裂开了一道缝，但你已经到了对岸。对岸有一条更近的路。', effect: gold(45) },
      { label: '在冰上坐一会儿', hint: '这里安静。', outcome: '你坐着听了一会儿水声。起身的时候，脑子里清楚了很多。', effect: polish() },
    ],
  },

  // ----------------------------------------------------------------- people
  {
    id: 'deserter', name: '逃兵',
    blurb: '一个人蹲在石头后面，怀里抱着一副牌，看见你之后没有跑，也没有站起来。',
    lean: 'cost',
    options: [
      { label: '分他一点口粮', hint: '他看起来饿了很久。', outcome: '他吃完了，把怀里的牌抽出一张递给你，然后往反方向走了。', requires: { gold: 20 }, effect: cards(3) },
      { label: '问他要不要一起走', hint: '多一个人，多一份口粮。', outcome: '他摇头。他说他走过一次了，不想再走第二次。', effect: nothing() },
      { label: '把他怀里的牌拿走', hint: '他不会拦你。', outcome: '你抽走了一半。他一直没有抬头。走出去很远之后你才觉得那副牌很沉。', effect: relic() },
    ],
  },
  {
    id: 'quiet-pilgrim', name: '不说话的人',
    blurb: '一个人坐在路边磨刀。你经过的时候他抬起头，指了指你的牌，又指了指自己的。',
    lean: 'gain',
    options: [
      // The hint now warns about **both** halves. It used to say only 「你不知道他会给你什么」, which is
      // half a warning about a trade that takes as well as gives — and the losing half is the one the
      // player cannot undo.
      { label: '和他换一张', hint: '他会抽走一张，然后塞给你一张。两边你都不知道是哪个。', outcome: '他挑走一张，塞给你一张。那张牌你从来没见过，但握在手里很服帖。', effect: swap() },
      { label: '摇头', hint: '不做看不清的交换。', outcome: '他点点头，继续磨刀。你走出去一段路，才想起来没有听见磨刀的声音。', effect: nothing() },
      { label: '坐下来一起磨', hint: '你的刀也该磨了。', outcome: '你们默默磨了半夜。走的时候，你的手比来的时候稳。', effect: polish() },
    ],
  },
  {
    id: 'child-lantern', name: '提着灯的小孩',
    blurb: '一个孩子站在路中间，灯比他的人还高。他不说话，只是举着灯照你的脸。',
    lean: 'loss',
    options: [
      { label: '把自己知道的告诉他', hint: '他好像在等一个答案。', outcome: '你说了很久。他听完，把灯留给你就走了。灯很沉。', requires: { hp: 6 }, effect: relic() },
      { label: '把灯接过来送他回家', hint: '你知道营地在哪。', outcome: '你牵着他在黑暗里走了很久，走到一半他说到了。那里什么也没有。', effect: maxHp(-3) },
      { label: '绕开他', hint: '不该由你来回答。', outcome: '你绕过他。他没有回头，灯一直亮着，照着你走远。', effect: nothing() },
    ],
  },
  {
    id: 'gravedigger', name: '挖坑的人',
    blurb: '一个人在挖坑，坑已经比他深了，他还在挖。',
    lean: 'cost',
    options: [
      { label: '帮他挖一会儿', hint: '两个人快一些。', outcome: '你下去挖了很久。他没有说这是给谁挖的，你也没有问。上来时手抖得握不住东西。', requires: { hp: 10 }, effect: maxHp(8) },
      { label: '问他给谁挖的', hint: '总得有人问。', outcome: '他停下来，说了个名字。你不认识那个名字，但你记住了。', effect: cards(3) },
      { label: '把他的铲子拿走', hint: '他不需要了。', outcome: '你拿走铲子。他没有拦。走了很远之后，你听见后面又响起了挖土的声音。', effect: gold(50) },
    ],
  },
  {
    id: 'mute-minstrel', name: '哑了的琴手',
    blurb: '一个抱着琴的人坐在石头上，琴弦断了两根。他张了张嘴，没有声音出来。',
    lean: 'cost',
    options: [
      { label: '给他一副新弦', hint: '你的行囊里有。', outcome: '他换好弦，弹了一小段。你听不懂，但听完之后你觉得心里的东西被理顺了一点。', requires: { gold: 40 }, effect: polish() },
      { label: '坐在旁边听他比划', hint: '没有声音也是一种听法。', outcome: '他比划了很久。你大概明白了他想说什么：往北走，别走那条有灯的路。', effect: hp(15) },
      { label: '把断了的弦收起来', hint: '也许有用。', outcome: '你把两根断弦绕在手指上。它们很勒，但你走夜路的时候不再觉得身后有东西。', effect: nothing() },
    ],
  },
  {
    id: 'cartographer', name: '画地图的人',
    blurb: '一个人趴在一张大纸上画线，纸的边缘已经画到了外面。他抬头看你一眼，又低下头。',
    lean: 'cost',
    options: [
      { label: '把自己走过的路告诉他', hint: '他会画上去。', outcome: '他听得很仔细，把你说的每一段都补上了。画完之后他撕下一角给你。', effect: cards(3) },
      { label: '看看他的图', hint: '也许能认出自己在哪。', outcome: '你看了很久。图上有很多地方你都去过，但连不起来。你记住了几个名字。', effect: gold(60) },
      { label: '买他一角纸', hint: '他不收钱，只收东西。', outcome: '你把随身的干粮推过去。他挑了一角撕下来，上面画着一条你没见过的路。', requires: { gold: 35 }, effect: relic() },
    ],
  },

  // ------------------------------------------------------------- the fire again
  // 淬炼. The only thing in the table that can **take something away and give nothing back** — which is
  // why the odds are printed on the option: a gamble the player cannot price is not a decision.
  {
    id: 'quench-stone', name: '淬火石',
    blurb: '一块烧得发白的石头半埋在土里，周围的草早就焦了。靠近时，你带着的东西开始发烫。',
    lean: 'loss',
    options: [
      { label: '把它贴上去，慢慢来', hint: '火候小，成算大。', outcome: '你把东西按在石头上，等了很久。它慢慢红起来，但一直没有裂。', requires: { relic: true }, effect: quench('small', 78) },
      { label: '架到最烫的那一面', hint: '出来要么更好，要么没有。', outcome: '石头白得刺眼。你听见一声很细的响，像冰在裂——但还没断。', requires: { relic: true }, effect: quench('large', 45) },
      { label: '把土推回去', hint: '不该由你动它。', outcome: '你用脚把土踩实。走出去很远，手心还是烫的。', effect: nothing() },
    ],
  },
  {
    id: 'cold-anvil', name: '冷铁砧',
    blurb: '一个铁砧立在路边，砧面是凉的，底下却还有没烧透的炭。',
    lean: 'cost',
    options: [
      { label: '扒开炭，把东西搁上去', hint: '费时间，也烫手。', outcome: '你用树枝把炭拨开。砧面慢慢热起来，你的手背起了泡。', requires: { relic: true, hp: 7 }, effect: quench('large', 62) },
      { label: '敲一块铁下来带走', hint: '卖得掉，但碎屑会跟你一路。', outcome: '你敲下一块。铁屑嵌进衣服里，怎么拍都拍不干净，往后一路都在硌你。', effect: jinx('ballast', gold(75)) },
      { label: '绕过去', hint: '砧子不是给你用的。', outcome: '你从旁边走过去。走了一段才想起来，一路上没听见有人打铁。', effect: nothing() },
    ],
  },

  // ------------------------------------------------------------- the deck
  {
    id: 'burn-pit', name: '焚坑',
    blurb: '一个方方正正的坑，坑底还有没烧完的东西。有人在这儿按规矩处理过什么。',
    lean: 'cost',
    options: [
      { label: '把自己的东西也丢进去', hint: '轻一点走路。', outcome: '你把一张牌扔进坑里。它烧得很快，像是早就想走了。', effect: burn() },
      { label: '把没烧完的捞出来', hint: '烫，而且不知道是什么。', outcome: '你捞出一张边角焦掉的牌。手指上留下一道印子，很久没消。', requires: { hp: 5 }, effect: cards(3) },
      { label: '在坑边站一会儿', hint: '有人在这儿站过很久。', outcome: '你站着看火。火很小，但一直没灭。起身的时候腿麻了。', effect: nothing() },
    ],
  },
  {
    id: 'same-face', name: '一模一样的两张',
    blurb: '地上并排摆着两张完全一样的牌，摆得很齐，像是特意给谁看的。',
    lean: 'gain',
    options: [
      { label: '照着自己已有的做一张', hint: '同样的东西，再要一份。', outcome: '你把手上的一张和地上的并在一起对。它们严丝合缝，像本来就是一张。', effect: copy() },
      { label: '把地上那张也拿走', hint: '放着也是放着。', outcome: '你把它收进怀里。走了很远才发现，它比看上去沉得多。', requires: { hp: 6 }, effect: gold(85) },
      { label: '从两张中间跨过去', hint: '摆得太整齐了。', outcome: '你一步跨了过去，没有踩到。之后一路都很安静。', effect: nothing() },
    ],
  },
  {
    id: 'shortcut', name: '近路',
    blurb: '一条踩出来的小路斜插过草甸，比大路近得多。路上有几处被踩塌的地方。',
    lean: 'cost',
    options: [
      { label: '走小路', hint: '近。路上有什么不好说。', outcome: '你抄了近路，省下大半天。走到一半时，脚踝上多了一圈灰，拍不掉。', effect: jinx('dross', gold(70)) },
      { label: '先把拖累的东西留在路边', hint: '轻装才走得快。', outcome: '你把一张牌用石头压住，留在路边。走出去很远，还在想它。', requires: { hp: 4 }, effect: burn() },
      { label: '还是走大路', hint: '慢一点。', outcome: '你沿着大路走，多花了半天。路上什么也没发生。', effect: nothing() },
    ],
  },
];

export const EVENT_BY_ID = new Map(EVENTS.map(event => [event.id, event]));

/**
 * Can this option be taken at all?
 *
 * Two clauses, and the second is the one that matters. The first is the obvious one — an option
 * costing 120 gold is not on the table when the purse holds 90. The second forbids a cost that would
 * **leave the player at zero**: 生命 is checked `>` rather than `>=`, so no event can ever be the
 * thing that ends a run. An event that kills you is a bug, not a difficulty, and it is much cheaper
 * to make it impossible here than to remember it at every effect.
 *
 * Callers pass `run.hp` / `run.maxHp` as they stand *before* the cost, which is also what the run
 * pays against — both sides of the deal read the same number.
 */
export function canAfford(option: EventOption, gold: number, hp: number, relics = 0): boolean {
  const needs = option.requires;
  if (!needs) return true;
  if (needs.gold !== undefined && gold < needs.gold) return false;
  if (needs.hp !== undefined && hp <= needs.hp) return false;
  if (needs.relic && relics < 1) return false;
  return true;
}

// ------------------------------------------------------------- saying it in numbers

/**
 * What an effect does, as a number rather than as a sentence.
 *
 * **The outcome line is deliberately prose and this is the other half of it.** 「你站了很久，风很大」
 * is what the floor is like; it is not allowed to be 「你失去 6 点生命」 — see rule 3 at the top of
 * this file. But a table where *every* line is prose has no way to say what changed, and that is
 * exactly what happened: `gold`, `hp` and `maxHp` were rendered **nowhere in the entire flow**. The
 * player paid 6 生命 for 「顺着脚印走」 and the screen went on reading 「生命 60/60」 — the footer is
 * drawn from the run as it stands *before* the answer is committed.
 *
 * So the prose stays prose and this says the ledger. Two lines, two jobs.
 *
 * It lives here rather than in `NodeScreen.tsx` because `node --experimental-strip-types` cannot
 * parse JSX, so a helper defined next to its screen is a helper no test can reach — and this one has
 * to be testable, because the whole point is that no effect may ever go undescribed again.
 */
export function describeEffect(effect: EventEffect): string {
  switch (effect.kind) {
    case 'gold': return `金币 ${signed(effect.amount)}`;
    case 'hp': return `生命 ${signed(effect.amount)}`;
    case 'maxHp': return `生命上限 ${signed(effect.amount)}`;
    case 'relic': return '抽取一件遗物';
    case 'remove': return '焚掉牌组里的一张牌';
    case 'polish': return '打磨牌组里的一张牌';
    case 'duplicate': return '复制牌组里的一张牌';
    case 'cards': return `从 ${effect.count} 张牌里挑一张`;
    // The odds are printed. A gamble the player cannot price is not a decision, and this is the only
    // option in the table where the stake is not knowable from the label.
    case 'refine': return `${REFINE_LABEL[effect.tier]}一件遗物 · ${effect.chance}% 成功，失败则碎`;
    case 'swap': return '换走一张牌，换来一张牌';
    case 'junk': {
      const cost = `牌组里多一张「${hazardName(effect.cardId)}」`;
      return effect.with ? `${describeEffect(effect.with)} · ${cost}` : cost;
    }
    // Not an empty string. 「你换了一条路」 reads as an outcome, and the player is owed the plain
    // fact that it left them nothing — a blank line here would be the same silence this fixes.
    case 'nothing': return '没有收获';
  }
}

/**
 * The whole exchange on one line, cost first: 「生命 −6 · 抽取一件遗物」.
 *
 * Paid-before-gained is the order the event actually settles in (see `resolveEvent`), so the line
 * reads in the order it happened. An option with no cost prints only its gain, and one whose only
 * content is a price prints only the price.
 */
export function outcomeLine(option: EventOption): string {
  const parts: string[] = [];
  if (option.requires?.gold) parts.push(`金币 ${signed(-option.requires.gold)}`);
  if (option.requires?.hp) parts.push(`生命 ${signed(-option.requires.hp)}`);
  parts.push(describeEffect(option.effect));
  return parts.join(' · ');
}

/** `+90` / `−6`. The minus is U+2212, matching how the keyword rules are written. */
function signed(amount: number): string {
  return amount < 0 ? `−${Math.abs(amount)}` : `+${amount}`;
}

/**
 * The event a floor turned out to hold.
 *
 * **Derived from the node id, not rolled and stored.** The run's `rng` stream is the wrong tool here:
 * an event's identity has to survive a reload, a repaint and a hundred re-renders of the same screen,
 * and `rng` advances on every call. Hashing the id gives all three for free — the same floor is the
 * same event every time anyone asks, and nothing about it has to be persisted or validated.
 *
 * That is also why it is *not* `enterNode`'s business: nothing is decided here that the player did
 * not walk into. They walked onto 「奇遇」 and this is what was standing there.
 *
 * The hash is FNV-1a followed by an xorshift finaliser, the usual pairing — the raw FNV output of two
 * ids that differ in one character differs mostly in its low bits, and it is the low bits that take
 * the modulo. Without the scramble, `n7-2` and `n7-3` would tend to land on neighbouring events.
 */
export function eventForNode(nodeId: string): EventSpec {
  let hash = 2166136261;
  for (let i = 0; i < nodeId.length; i++) {
    hash = Math.imul(hash ^ nodeId.charCodeAt(i), 16777619);
  }
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 2246822507);
  hash ^= hash >>> 13;
  return EVENTS[(hash >>> 0) % EVENTS.length];
}
