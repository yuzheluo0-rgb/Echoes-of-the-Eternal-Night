/**
 * The screens a non-combat floor opens: 战利品, 营火, 奇遇, and the card picker they share.
 *
 * These are the places the run stops being a fight and becomes a decision, so they are built the
 * opposite way round from the battle page: **one thing at a time, at a size you can read from a
 * sofa.** The first version reused the battle page's panel scale — 12.5px labels and 13px body — and
 * a reward screen you have to lean in to read is a reward screen nobody reads. Title 46px, body 18px,
 * buttons 17px, and the card picker shows the real card faces rather than a list of names.
 *
 * Every screen is the same shell: a scene behind, one panel in front, a row of actions at the bottom.
 * They differ only in what fills the middle, which is why they are one file.
 */

import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { sound } from '../audio';
import { CardBack, CardFace } from '../cards/CardFace';
import { CARD_BY_ID, DECK_BY_ID } from '../cards/index.ts';
import { RARITY_COLOR, RARITY_LABEL, type CardOffer, type RewardSpec } from './rewards.ts';
import { isUpgradable } from './upgrades.ts';
import { canAfford, outcomeLine, type EventOption, type EventSpec } from './events.ts';
import { canPayWith, shopRerollCost, type PayWith, type ShopSlot } from './shop.ts';
import { RELIC_PRICE } from './relicDraw.ts';
import { sceneArt, SCENE_BY_KEY } from './scenes.ts';
import { deckCounts, holdsRelic, resolveEvent, shopRemoveCost, type ChapterRun } from './run.ts';
import { unlockGroups } from './cardUnlocks.ts';
import { REFINE_LABEL, RELIC_BY_ID } from '../relics/relics.ts';
import { RelicFace } from '../relics/RelicFace';
import { PropIcon } from '../props/PropIcon';
import { emptyProps, PROP_BY_ID, type PropSlotState } from '../props/props.ts';
import { PropRail } from '../props/PropRail';
import { refineLines } from './relics.ts';
import type { NodeKind } from './map.ts';
import './node.css';

// --------------------------------------------------------------------- shell

/**
 * The frame every node screen shares. `scene` is the floor's own backdrop, so walking from the tower
 * into a campfire keeps the same picture behind it.
 */
export function NodeShell({ kind, scene, title, kicker, children, actions, footer }: {
  kind: NodeKind;
  scene: string;
  title: string;
  kicker: string;
  children?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
}) {
  const plate = SCENE_BY_KEY.get(scene as never);
  return <div className={`nd nd-${kind}`}>
    <div className="nd-bg" aria-hidden="true">
      <span style={{ backgroundImage: `url(${sceneArt(scene)})` }} />
      <span className="nd-shade" />
    </div>
    <div className="nd-panel">
      <header className="nd-head">
        <p className="nd-kicker">{kicker}</p>
        <h1 className="nd-title">{title}</h1>
      </header>
      <div className="nd-body">{children}</div>
      {actions && <div className="nd-actions">{actions}</div>}
      {footer && <p className="nd-footer">{footer}{plate && <i>· {plate.name}</i>}</p>}
    </div>
  </div>;
}

/** One big choice. Used by the campfire, the events and the shop alike. */
export function NodeChoice({ label, hint, tone, disabled, onClick, onHover, children }: {
  label: string; hint?: string; tone?: string; disabled?: boolean;
  onClick: () => void; onHover?: () => void; children?: ReactNode;
}) {
  return <button className={`nd-choice ${disabled ? 'off' : ''}`}
    style={tone ? { '--tone': tone } as CSSProperties : undefined}
    disabled={disabled} onClick={onClick} onPointerEnter={onHover}>
    <span className="nd-choice-label">{label}</span>
    {hint && <span className="nd-choice-hint">{hint}</span>}
    {children}
  </button>;
}

// -------------------------------------------------------------------- reward

/** 战利品 — one rolled reward, shown large, claimed once. */
export function RewardScreen({ reward, run, onClaim, audioOn, from }: {
  reward: RewardSpec; run: ChapterRun; onClaim: () => void; audioOn: boolean; from: string;
}) {
  return <NodeShell kind="treasure" scene={rewardScene(reward)} kicker={`${from} · ${RARITY_LABEL[reward.rarity]}`}
    title={reward.name}
    actions={<button className="nd-primary" onPointerEnter={() => sound('hover', audioOn)}
      onClick={() => { sound('relic-set', audioOn); onClaim(); }}>
      收下
    </button>}
    footer={`生命 ${run.hp}/${run.maxHp} · 金币 ${run.gold}`}>
    <p className="nd-copy" style={{ color: RARITY_COLOR[reward.rarity] }}>{reward.blurb}</p>
    <p className="nd-effect">{describeReward(reward)}</p>
  </NodeShell>;
}

/** The line under the flavour: what this row actually does, in plain words. */
export function describeReward(reward: RewardSpec): string {
  const e = reward.effect;
  switch (e.kind) {
    case 'gold': return `获得 ${e.amount} 金币`;
    case 'heal': return `回复 ${e.amount} 点生命`;
    case 'maxHp': return `生命上限 +${e.amount}，并立即回复同样多`;
    case 'relic': return '抽取一件遗物';
    case 'prop': return '得到一件道具';
    case 'remove': return '焚掉牌组里的一张牌';
    case 'polish': return '打磨牌组里的一张牌';
    case 'duplicate': return '复制牌组里的一张牌';
    case 'cards': return e.pick ? `从 ${e.count} 张牌里挑一张` : `直接获得 ${e.count} 张牌`;
  }
}

/** A reward has no scene of its own; the flavour picks one. */
function rewardScene(reward: RewardSpec): string {
  if (reward.effect.kind === 'relic') return 'treasure';
  // 道具和遗物同一个场景：它们都是**捡到的东西**，只是一件带着走、一件用掉。
  if (reward.effect.kind === 'prop') return 'treasure';
  if (reward.effect.kind === 'gold') return 'caravan';
  if (reward.effect.kind === 'cards' || reward.effect.kind === 'remove'
    || reward.effect.kind === 'polish' || reward.effect.kind === 'duplicate') return 'event';
  return 'rest';
}

// ------------------------------------------------------------------ campfire

export type CampfirePick = 'rest' | 'burn' | 'polish' | 'quench';

/**
 * 营火 — what a night at the fire buys. All of them final, and 淬炼 only if you have something to
 * put in.
 *
 * **淬炼 是这里唯一「有可能赔本」的选择**（`ND_QUENCH` 那屏会说清成算），而这正是它该在营火上的
 * 原因：营火是**每条路线都一定会经过**的地方，奇遇不是——实测一半的地图上连一个淬炼奇遇都没有。
 * 稳妥的那一注放在必经之路上，赌大的那一注留在奇遇里。
 */
export function CampfireScreen({ run, onPick, audioOn, quenchChance, props }: {
  run: ChapterRun; onPick: (choice: CampfirePick) => void; audioOn: boolean; quenchChance: number;
  /**
   * 那一排道具槽。⚠️ **营火是 `camp` 类道具唯一能用的地方**（净灯 / 灰誓 / 袖炉）——
   * 在它存在之前，那三件「捡得到、用不掉」。传 `undefined` 就不画这一排。
   */
  props?: {
    slots: PropSlotState[];
    canUse: (slot: number) => boolean;
    reasonFor: (slot: number) => string | undefined;
    onUse: (slot: number) => void;
    /** 袖炉那种二选一：给了就画两个按钮，玩家自己挑哪一半。 */
    halves?: { slot: number; name: string; onPick: (half: 'task' | 'effect') => void };
  };
}) {
  const heal = Math.round(run.maxHp * .3);
  const held = (['main', 'sub'] as const).filter(slot => run.relics[slot]);
  return <NodeShell kind="rest" scene="rest" kicker="营火 · 停下来" title="营地的火"
    footer="无论选哪个，这一层就过去了。">
    <p className="nd-copy">火还在烧。你有时间做一件事。</p>
    {/* 道具排在选项**上面**：`run.ts` 把道具定义为「回答营火之前做的事」，
        所以它读起来是前置动作，而不是第五个选项。 */}
    {props && <div className="nd-prop-rail">
      <p className="nd-prop-rail-head">身上的东西</p>
      <PropRail slots={props.slots} canUse={props.canUse} onUse={props.onUse} reasonFor={props.reasonFor} />
      {/* 袖炉是**二选一**的：回血与打磨是两条不同的路，界面上必须给两个按钮，
          而不是替玩家挑一个默认值。（`PropHalf` / `EITHER_OR_PROPS` 在 `run.ts` 里。） */}
      {props.halves && <div className="nd-prop-halves">
        <p className="nd-prop-halves-head">{props.halves.name} · 要做哪一件？</p>
        <div className="nd-choices">
          <NodeChoice label="回 15 点生命" tone="#8fae7c" hint="当场补上"
            onHover={() => sound('hover', audioOn)} onClick={() => props.halves!.onPick('effect')} />
          <NodeChoice label="打磨一张牌" tone="#d9bc80" hint="开牌库，挑一张磨得更好"
            onHover={() => sound('hover', audioOn)} onClick={() => props.halves!.onPick('task')} />
        </div>
      </div>}
    </div>}
    <div className="nd-choices">
      <NodeChoice label="休息" tone="#e08a52" hint={`回复 ${heal} 点生命`}
        onHover={() => sound('hover', audioOn)} onClick={() => onPick('rest')} />
      <NodeChoice label="焚牌" tone="#e3948c" hint="把牌组里的一张牌投进火里，永远拿掉"
        onHover={() => sound('hover', audioOn)} onClick={() => onPick('burn')} />
      <NodeChoice label="打磨" tone="#d9bc80" hint="把一张牌磨得更好，本局永久生效"
        onHover={() => sound('hover', audioOn)} onClick={() => onPick('polish')} />
      {/* 身上没有遗物时置灰并**说明原因**：一个点了没反应的按钮读起来像坏了，不像一个你暂时没有的东西。 */}
      <NodeChoice label="淬炼" tone="#e0b45f" disabled={!held.length}
        hint={held.length
          ? `把一件遗物的数值往上推一档 · 成算 ${quenchChance}%，失败则碎`
          : '身上没有遗物可以往里放'}
        onHover={() => sound('hover', audioOn)} onClick={() => onPick('quench')} />
    </div>
  </NodeShell>;
}

// ------------------------------------------------------------------- 商店

/**
 * 商店 —— 一屏五格货，三种付法。
 *
 * **定价的锚点是用户给的真实金币曲线**：半程约 300~400，登顶前约 700~800。一条塔 2~3 家店，
 * 所以一家店要能买走**一到两件**——买不起是常态、全扫光是意外，两者之间的那个位置才对。
 *
 * 三种付法的分工：**金币**是常规，**生命**在钱不够而血够的时候打开一扇门，**遗物**是「我带着
 * 一件用不上的东西」。第三种是这一版最像这个世界的一条——营地里的东西本来就是拿东西换的。
 *
 * ⚠️ 界面**不自己算价格**：`price` / `hpPrice` / `relicPrice` 全由 `shop.ts` 定好，
 * 这里只负责印出来与把玩家的选择递回去。价格算两遍必然分叉。
 */
export function ShopScreen({ run, onBuy, onReroll, onRemove, onLeave, audioOn }: {
  run: ChapterRun; audioOn: boolean;
  onBuy: (index: number, payWith: PayWith, relicSlot?: 'main' | 'sub') => void;
  onReroll: () => void;
  /** 焚牌服务。**一家店只有一次**——`shop.removed` 是那个「已经用掉了」的记号。 */
  onRemove: () => void;
  onLeave: () => void;
}) {
  const shop = run.shop;
  // 正在为哪一格挑「拿哪件遗物去换」。`null` 就是没在挑。
  const [trading, setTrading] = useState<number | null>(null);
  if (!shop) return null;

  const rerollCost = shopRerollCost(run);
  const removeCost = shopRemoveCost(run);
  const held = (['main', 'sub'] as const).filter(slot => run.relics[slot]);
  const affordable = shop.slots.filter((slot, index) => !slot.sold && canPayWith(run, index, 'gold')).length;

  return <NodeShell kind="shop" scene="shop" kicker="路边 · 有人在这里摆摊" title="行脚商"
    actions={<>
      <button className="nd-primary" onPointerEnter={() => sound('hover', audioOn)} onClick={onLeave}>
        走了
      </button>
      {/* 焚牌：**一家店限一次**，价格跨商店递增（照杀戮尖塔的 75/100/125）。
          它不占货架——它是一项服务，所以长在按钮行里。 */}
      <button className="nd-secondary" disabled={shop.removed || run.gold < removeCost}
        onPointerEnter={() => sound('hover', audioOn)} onClick={onRemove}>
        {shop.removed ? '焚过了' : `焚掉一张牌 · ${removeCost} 金`}
      </button>
      {/* 刷新价实时印在按钮上，买不起就置灰——一个点了没反应的按钮读起来像坏了。 */}
      <button className="nd-secondary" disabled={run.gold < rerollCost}
        onPointerEnter={() => sound('hover', audioOn)} onClick={onReroll}>
        换一批货 · {rerollCost} 金
      </button>
    </>}
    footer={`生命 ${run.hp}/${run.maxHp} · 金币 ${run.gold}${shop.warded ? ' · 身上有一道保险' : ''}`}>
    <p className="nd-copy">
      {affordable ? '摊子上的东西不多。看上了就拿，钱、血、或者你身上那件用不着的。'
        : '他看了看你的钱袋，又看了看你。摊子上的东西你都拿不走。'}
    </p>
    <div className="nd-shop">
      {shop.slots.map((slot, index) => <ShopTile key={index} slot={slot} index={index} run={run}
        audioOn={audioOn} onBuy={onBuy} trading={trading === index}
        onTrade={() => { sound('select', audioOn); setTrading(current => (current === index ? null : index)); }} />)}
    </div>
    {/* 拿遗物换：把身上那两件摆出来让玩家挑，而不是替他挑一件最便宜的。 */}
    {trading !== null && <div className="nd-shop-trade">
      <p className="nd-shop-trade-head">拿哪一件换？</p>
      <div className="nd-choices">
        {held.map(slot => {
          const relicDef = RELIC_BY_ID.get(run.relics[slot]!);
          // 「等价值」是按**品阶**标定的内置价格（`RELIC_PRICE` 本来就是为商店留的）。
          const worth = relicDef ? RELIC_PRICE[relicDef.tier] : 0;
          const enough = worth >= (shop.slots[trading]?.relicPrice ?? Infinity);
          return <NodeChoice key={slot} label={relicDef?.name ?? slot}
            tone={slot === 'main' ? '#d4bd87' : '#b6c3b2'}
            hint={enough ? `值 ${worth} 金 · 换得动` : `值 ${worth} 金 · 不够换这一件`}
            disabled={!enough}
            onHover={() => sound('hover', audioOn)}
            onClick={() => { onBuy(trading, 'relic', slot); setTrading(null); }} />;
        })}
      </div>
    </div>}
  </NodeShell>;
}

/** 一格货。面用**它自己那种**：道具是图标、卡牌是卡面、遗物是遗物面、属性与免死各一张小面。 */
function ShopTile({ slot, index, run, audioOn, onBuy, onTrade, trading }: {
  slot: ShopSlot; index: number; run: ChapterRun; audioOn: boolean;
  onBuy: (index: number, payWith: PayWith, relicSlot?: 'main' | 'sub') => void;
  onTrade: () => void; trading: boolean;
}) {
  const prop = slot.kind === 'prop' && slot.id ? PROP_BY_ID.get(slot.id) : undefined;
  const card = slot.kind === 'card' && slot.id ? CARD_BY_ID.get(slot.id) : undefined;
  const relic = slot.kind === 'relic' && slot.id ? RELIC_BY_ID.get(slot.id) : undefined;
  const onSale = slot.price < slot.fullPrice;
  const gold = canPayWith(run, index, 'gold');
  const hp = canPayWith(run, index, 'hp');
  const trade = canPayWith(run, index, 'relic');

  return <div className={`nd-shop-tile ${slot.sold ? 'is-sold' : ''}`}>
    {onSale && !slot.sold && <span className="nd-shop-sale">半价</span>}
    {/* ⚠️ **一律用紧凑面。** 全尺寸的卡面 236 / 遗物面 240 宽，而五列每列只有约 200——
        第一版五格排不下，第五格直接被挤出屏幕。紧凑面（卡 150 / 遗物 168 / 道具 108）刚好，
        而「字大」这件事由下面的货名与价格负责，不是靠把卡面撑大。 */}
    <div className="nd-shop-face">
      {prop && <PropIcon prop={prop} compact />}
      {card && <CardFace card={card} compact />}
      {relic && <RelicFace relic={relic} compact />}
      {slot.kind === 'stat' && <StatFace id={slot.id ?? ''} />}
      {slot.kind === 'life' && <LifeFace />}
      {slot.sold && <span className="nd-shop-sold">已售</span>}
    </div>
    <p className="nd-shop-name">{shopName(slot)}</p>
    {!slot.sold && <>
      <p className="nd-shop-detail">{shopDetail(slot)}</p>
      <div className="nd-shop-pay">
        <button className={`nd-pay ${gold ? '' : 'off'}`} disabled={!gold}
          onPointerEnter={() => sound('hover', audioOn)} onClick={() => onBuy(index, 'gold')}>
          <b>{slot.price}</b><i>金币{onSale && <s>{slot.fullPrice}</s>}</i>
        </button>
        {/* 生命价：**付完必须还剩至少 1 点**——判据是 `>` 不是 `>=`，和奇遇的 `canAfford` 同一条。 */}
        <button className={`nd-pay ${hp ? '' : 'off'}`} disabled={!hp}
          onPointerEnter={() => sound('hover', audioOn)} onClick={() => onBuy(index, 'hp')}>
          <b>{slot.hpPrice}</b><i>生命</i>
        </button>
        <button className={`nd-pay ${trade ? '' : 'off'}`} disabled={!trade}
          onPointerEnter={() => sound('hover', audioOn)} onClick={onTrade}>
          <b>{slot.relicPrice}</b><i>{trading ? '挑一件…' : '遗物'}</i>
        </button>
      </div>
    </>}
  </div>;
}

/**
 * 属性格：**不画图**。
 *
 * 道具、卡牌、遗物都是「一件东西」，所以它们有照片；「生命上限 +8」不是一件东西，
 * 给它配一张照片只会是张不相干的图。所以这一格是排版本身：一个大字 + 名字与说明由下面那两行负责。
 */
function StatFace({ id }: { id: string }) {
  return <div className="nd-shop-stat"><span>{id === 'heal' ? '补' : '厚'}</span></div>;
}

/** 免死：唯一能救命的一格，所以它自己有一张脸。 */
function LifeFace() {
  return <div className="nd-shop-life">
    <span className="nd-shop-life-mark">命</span>
    <i>下一次致命伤害<br />为你留下 1 点生命</i>
  </div>;
}

/**
 * 货架上那一格的**名字**与**一句说明**。
 *
 * 四种货各有各的数据源——道具、卡牌、遗物都读各自的表，属性与免死是商店自己的概念
 * （它们不对应任何一件已有东西）。所以这段是显示层的事，不在 `shop.ts` 里。
 */
function shopName(slot: ShopSlot): string {
  if (slot.kind === 'prop' && slot.id) return PROP_BY_ID.get(slot.id)?.name ?? '道具';
  if (slot.kind === 'card' && slot.id) return CARD_BY_ID.get(slot.id)?.name ?? '一张牌';
  if (slot.kind === 'relic' && slot.id) return RELIC_BY_ID.get(slot.id)?.name ?? '遗物';
  if (slot.kind === 'life') return '一条命';
  return slot.id === 'heal' ? '缝合' : '加厚';
}

function shopDetail(slot: ShopSlot): string {
  if (slot.kind === 'prop' && slot.id) return PROP_BY_ID.get(slot.id)?.text ?? '';
  if (slot.kind === 'card' && slot.id) return CARD_BY_ID.get(slot.id)?.text ?? '';
  if (slot.kind === 'relic' && slot.id) return RELIC_BY_ID.get(slot.id)?.text ?? '';
  if (slot.kind === 'life') return '本局内，下一次本该要你命的伤害留你 1 点生命。';
  return slot.id === 'heal' ? '把你现在缺的那些补上一部分。' : '把根往下扎一尺，人能多站一会儿。';
}

// ------------------------------------------------------------- 捡到的道具

/**
 * 宝箱与奇遇里捡到的那件道具该放哪儿。
 *
 * ⚠️ **它必须是一个顶层早返回，不能长在别的屏里面。** 战后掉落是反过来的——那一件必须渲染在
 * 战果面板**内部**，因为 `state` 那时候还在、整条分派链会先撞上战斗 JSX。塔上拾取时 `state`
 * 是空的，`floor && resolved !== at` 那一支会先接管，所以这条排在它前面。
 *
 * 三格按钮走的是营火/奇遇同一套 `NodeChoice`（它文件头的注释就写着「营火、奇遇与商店共用」），
 * 所以这一屏一行新样式都不用写。
 */
export function PropDropScreen({ run, from, onPlace, onDismiss, audioOn }: {
  run: ChapterRun; from: string; audioOn: boolean;
  onPlace: (slot: number) => void; onDismiss: () => void;
}) {
  const task = run.propTask;
  const prop = task ? PROP_BY_ID.get(task.id) : undefined;
  if (!task || !prop) return null;
  const slots = run.props ?? emptyProps();
  return <NodeShell kind="treasure" scene="treasure" kicker={`${from} · 一件道具`} title={prop.name}
    footer={`生命 ${run.hp}/${run.maxHp} · 金币 ${run.gold}`}>
    <div className="nd-prop-found">
      <PropIcon prop={prop} />
      <div className="nd-prop-found-copy">
        <p className="nd-copy">{prop.text}</p>
        {/* 来历那一行：道具的身份一半在效果上，一半在它是从哪儿来的。 */}
        <p className="nd-effect">{prop.lore}</p>
      </div>
    </div>
    <div className="nd-choices">
      {slots.map((entry, slot) => {
        const held = entry ? PROP_BY_ID.get(entry.id) : undefined;
        return <NodeChoice key={slot} label={`放进第 ${slot + 1} 格`}
          tone={held ? '#d9a45f' : '#8fae7c'}
          hint={held ? `换下「${held.name}」` : '空格'}
          onHover={() => sound('hover', audioOn)} onClick={() => onPlace(slot)} />;
      })}
      {/* 「不要」是真答案，不是放弃：三格都称手的时候，多带一件等于少带一件。 */}
      <NodeChoice label="不要" hint="三格都称手时，这是个真答案"
        onHover={() => sound('hover', audioOn)} onClick={onDismiss} />
    </div>
  </NodeShell>;
}

// ------------------------------------------------------------- the unlock

/**
 * 击破守望者解锁了什么 —— **摆出牌，不是列出名字**。
 *
 * The unlock has been a line of names inside the victory panel since it was written, and a list of
 * names is not feedback: 「万刃」 and 「千刃」 are the same three characters to a player who has never
 * seen either card, and the panel they sat in was about the *fight* — health carried, gold paid. The
 * cards are the reward, so the cards are what has to be on screen.
 *
 * Grouped by deck, because that is how a player reads them: they have been carrying two of these
 * decks for a whole chapter and the question 「这六张是给我哪副牌的」 is the first one they will ask.
 */
/** The unlocked cards, by deck — the body both the unlock screen and the cleared screen share. */
export function UnlockGroups({ cards }: { cards: string[] }) {
  // Grouped by `cardUnlocks.ts` rather than here: `strip-types` cannot parse JSX, so the rule for
  // 「which six are whose, in what order」 is testable only if it lives outside this file.
  const groups = unlockGroups(cards).map(group => ({ deck: DECK_BY_ID.get(group.deck)!, ids: group.ids }));
  return <>{groups.map(({ deck, ids }) => <section key={deck.id} className="nd-unlock-group">
    <p className="nd-unlock-deck" style={{ '--tone': deck.accent } as CSSProperties}>
      {deck.name}<i>{ids.length} 张</i>
    </p>
    <div className="nd-unlock-grid">
      {ids.map(id => {
        const card = CARD_BY_ID.get(id);
        return card ? <CardFace key={id} card={card} compact /> : null;
      })}
    </div>
  </section>)}</>;
}

/**
 * 通关之后回到塔上时要看到的东西 —— **一个出口，也是一份交代**。
 *
 * ⚠️ Without it the page is a dead end. `outcome` is component state and is not saved, so a reload
 * after the boss shows the tower, with no results panel and no unlock screen; and the boss node is
 * behind you with no outgoing edges, so `reachableFrom` is empty and **nothing on the map can be
 * stepped on**. Reported as 「打完 boss 没有反馈面板，刷新以后还是这个已经通关的爬塔路线」.
 *
 * The victory panel's own numbers (营火回血, 带进下一场) are **not** reconstructed here — the heal was
 * rolled and spent in the session that won, and inventing them for a reload would be exactly the kind
 * of plausible-looking lie this project keeps finding. What is recoverable is what was unlocked, and
 * that is the part worth coming back for.
 */
export function ChapterClearedScreen({ cards, cleared, progress, total, onLeave, audioOn }: {
  cards: string[]; cleared: boolean; progress: number; total: number;
  onLeave: () => void; audioOn: boolean;
}) {
  return <NodeShell kind="treasure" scene="boss"
    kicker={cleared ? '第一章 · 已通关' : '塔顶 · 守望者倒下了'}
    title={cleared ? '这一章打完了' : '这一座塔到头了'}
    actions={<button className="nd-primary" onPointerEnter={() => sound('hover', audioOn)}
      onClick={() => { sound('bell', audioOn); onLeave(); }}>回到开场</button>}
    footer={cards.length ? `明焰阶的 ${cards.length} 张牌已经在往后每一局的战利品池里。` : undefined}>
    {/* ⚠️ **两种话，因为两种都是真的。** 塔从池子里发牌，所以打倒守望者**不等于**把那一章的五场
        章节战都打过——写死「这一章打完了」会在那种存档上变成谎话。进度照实报，玩家才知道差在哪。 */}
    <p className="nd-copy">
      {cleared
        ? '长夜塔还在那儿，但这一座已经空了。火还亮着，下一章会从别处点起来。'
        : `守望者守了很久，久到忘了可以换班。它在塔顶站着，塔上再没有别的路了——这一章的 ${total} 场里，你打过 ${progress} 场。`}
    </p>
    {!!cards.length && <UnlockGroups cards={cards} />}
  </NodeShell>;
}

export function UnlockScreen({ cards, fresh = true, onDone, audioOn }: {
  cards: string[];
  /** 这次的 26 张是**新拿到**的，还是**早就在池子里**的。两种都要摆，话不一样。 */
  fresh?: boolean;
  onDone: () => void; audioOn: boolean;
}) {
  return <NodeShell kind="treasure" scene="boss" kicker="击破守望者 · 明焰阶"
    title={fresh ? '火换了一种烧法' : '你早就把它们带来了'}
    actions={<button className="nd-primary" onPointerEnter={() => sound('hover', audioOn)}
      onClick={() => { sound('bell', audioOn); onDone(); }}>继续</button>}
    footer={fresh
      ? `${cards.length} 张牌加入了往后每一局的战利品池。`
      : `这 ${cards.length} 张从第一次击破起就一直在池子里。`}>
    {/* ⚠️ **重复击破也要说一句。** 判定原来只看「这次新解锁了什么」，重复击破就整屏不出现，
        表现是「打完 boss 没有任何反馈」——而打赢 boss 是整章的收尾，它不该第二次就沉默。
        但也**不能说谎**：牌早就是人家的了，「从今往后会出现」在这时候是假话。 */}
    <p className="nd-copy">
      {fresh
        ? '守望者倒下的地方，火还在烧。这些牌从今往后会出现——不是在这一次，是在每一次。'
        : '又一位守望者倒下。这些牌在你第一次打赢的时候就进了战利品池，它们还在那儿。'}
    </p>
    <UnlockGroups cards={cards} />
  </NodeShell>;
}

// -------------------------------------------------------------- the reveal

/**
 * 这一层对你的牌组做了什么 —— 摆出真的那几张牌。
 *
 * A `pick` shows its cards by definition: the choosing *is* the display. **Every other way a card
 * moves does not.** 「一捆牌」 printed 「直接获得 2 张牌」 and the two cards arrived unseen; 「和他换一张」
 * read 「他挑走一张」 for a whole round while its effect took nothing at all. The player is owed a look
 * at both halves — the screen exists for the same reason 打磨's does, and stays until 继续 for the same
 * reason too (a result that closes itself is a result nobody sees).
 */
export function CardRevealScreen({ run, onDone, audioOn }: {
  run: ChapterRun; onDone: () => void; audioOn: boolean;
}) {
  const reveal = run.cardReveal!;
  const lostCard = reveal.lost ? CARD_BY_ID.get(reveal.lost) : undefined;
  return <NodeShell kind="treasure" scene={lostCard ? 'rest' : 'event'}
    kicker={`${reveal.from} · 牌组`}
    title={lostCard ? '换了一张' : reveal.gained.length > 1 ? `多了 ${reveal.gained.length} 张` : '多了一张'}
    actions={<button className="nd-primary" onPointerEnter={() => sound('hover', audioOn)}
      onClick={() => { sound('bell', audioOn); onDone(); }}>继续</button>}
    footer={`牌组现在 ${run.deck.length} 张。`}>
    <p className="nd-copy">
      {lostCard ? '他挑走一张，塞给你一张。两边都在这儿了。' : '已经进牌组了。先看一眼是什么。'}
    </p>
    <div className="nd-reveal-row">
      {reveal.gained.map((offer, index) => {
        const card = CARD_BY_ID.get(offer.cardId);
        if (!card) return null;
        return <div key={`${offer.cardId}-${index}`} className="nd-reveal-card">
          <CardFace card={card} upgraded={!!offer.upgraded} />
          {offer.beyond && <span className="nd-card-beyond">未解锁</span>}
        </div>;
      })}
      {/* 换走的那一张摆在同一行、同一个尺寸。缩小或者挪到角落，就是在替玩家决定哪一半不重要。 */}
      {lostCard && <div className="nd-reveal-card is-lost">
        <CardFace card={lostCard} />
        <span className="nd-reveal-lost">换走了</span>
      </div>}
    </div>
  </NodeShell>;
}

// -------------------------------------------------------------------- 淬炼

/**
 * 淬炼 — the one gamble in the run, played out in the open in two beats.
 *
 * **Pick which relic goes in the fire, then watch what comes out.** The second beat is not decoration.
 * The first version of 打磨's screen closed itself after 660ms with a gold flash and players did not
 * notice it had happened at all — 「看不见的停顿不是反馈，是延迟」. Here the stake is a relic, so a silent
 * result is the worst version of that mistake: the player would have to go and read the deck screen to
 * find out whether they still owned the thing.
 *
 * The outcome comes from `run.relicTask.done` and is never re-derived. The run has already applied it
 * by the time this renders, so there is exactly one place that knows what happened.
 */
export function RefineScreen({ run, onPick, onDismiss, audioOn }: {
  run: ChapterRun; onPick: (relicId: string) => void; onDismiss: () => void; audioOn: boolean;
}) {
  const task = run.relicTask!;
  const done = task.done;
  const held = (['main', 'sub'] as const).filter(slot => run.relics[slot]);

  if (!done) {
    return <NodeShell kind="event" scene="rest" kicker="淬炼 · 押上去"
      title={REFINE_LABEL[task.tier]}
      footer={`成算 ${task.chance}%。失败的话，那件东西就没了。`}>
      <p className="nd-copy">火已经旺了。挑一件放进——<b>它可能回不来</b>。</p>
      <div className="nd-choices">
        {held.map(slot => {
          const relic = RELIC_BY_ID.get(run.relics[slot]!)!;
          return <NodeChoice key={slot} label={relic.name} tone="#e08a52"
            hint={`${slot === 'main' ? '主槽' : '副槽'} · ${relic.text}`}
            onHover={() => sound('hover', audioOn)} onClick={() => onPick(relic.id)} />;
        })}
      </div>
    </NodeShell>;
  }

  const relic = RELIC_BY_ID.get(done.relicId)!;
  // From `done`, not from the run: on a failure the relic is already gone and `run.relics` no longer
  // names it, so looking it up here reported 副槽 for a relic that had been in 主槽. See `done.slot`.
  const slot = done.slot;
  // Failure means the relic is gone; there is no face left to show, so the frame keeps the name and
  // the empty slot underneath. Success shows the same card it always was, with the gold strip on it.
  return <NodeShell kind="event" scene="rest" kicker="淬炼 · 出火" title={done.won ? '成了' : '碎了'}
    actions={<button className="nd-primary" onPointerEnter={() => sound('hover', audioOn)}
      onClick={() => { sound('bell', audioOn); onDismiss(); }}>继续</button>}
    footer={done.won ? `${relic.name} · 已淬炼` : `${relic.name} 不在了`}>
    <p className="nd-copy nd-outcome">
      {done.won
        ? '它从火里出来的时候还是热的，但比进去的时候沉了一点。'
        : '你听见一声很脆的响。捞出来的只有几块认不出是什么的碎片。'}
    </p>
    <div className={`nd-quench ${done.won ? 'is-won' : 'is-lost'}`}>
      {done.won
        ? <div className="nd-quench-card"><RelicFace relic={relic}
            refine={{ tier: task.tier, lines: refineLines(relic.id, slot, task.tier) }} /></div>
        : <div className="nd-quench-ghost">
          <span className="nd-quench-name">{relic.name}</span>
          <span className="nd-quench-slot">{slot === 'main' ? '主槽' : '副槽'} 空了</span>
        </div>}
      <span className="nd-quench-flash" aria-hidden="true" />
    </div>
  </NodeShell>;
}

// -------------------------------------------------------------------- events

/**
 * 奇遇 — the question, then the answer.
 *
 * **Two steps, and the second one is why this is not a one-liner.** Answering an event sets the run's
 * `resolved`, and the moment that happens the page stops being an event screen at all: the dispatcher
 * moves on to the card picker or the relic draw the answer asked for. Committing the answer on the
 * click therefore skipped the outcome line entirely — the player picked 「徒手挖开」 and was looking at
 * a relic draw one frame later, with the sentence written for that exact choice never rendered
 * anywhere. `resolved` here is the local, uncommitted answer; `onContinue` is what hands it to the run.
 */
export function EventScreen({ event, run, onContinue, audioOn }: {
  event: EventSpec; run: ChapterRun; onContinue: (option: EventOption) => void; audioOn: boolean;
}) {
  const [answer, setAnswer] = useState<EventOption | null>(null);

  if (answer) {
    /**
     * The run as it will be **once 继续 is pressed** — not as it stands now.
     *
     * Two things were wrong with showing the current run here. The footer read 「生命 60/60」 on the
     * screen that had just cost the player 6 of them, and `outcome` is prose by design, so it never
     * said the number either — which left `金币` / `生命` / `生命上限` printed **nowhere at all**.
     *
     * Computed through `resolveEvent` rather than by hand: it is the same function `commitEvent`
     * calls, so this screen and the run cannot drift apart about what an option does. It is pure and
     * the result is only read, never stored — the run still moves exactly once, on the click.
     */
    const settled = resolveEvent(run, answer);
    return <NodeShell kind="event" scene="event" kicker="奇遇" title={event.name}
      actions={<button className="nd-primary" onPointerEnter={() => sound('hover', audioOn)}
        onClick={() => { sound('bell', audioOn); onContinue(answer); }}>
        继续
      </button>}
      footer={`生命 ${settled.hp}/${settled.maxHp} · 金币 ${settled.gold}`}>
      <p className="nd-copy nd-outcome">{answer.outcome}</p>
      <p className="nd-delta">{outcomeLine(answer)}</p>
    </NodeShell>;
  }

  return <NodeShell kind="event" scene="event" kicker="奇遇" title={event.name}
    footer={`生命 ${run.hp}/${run.maxHp} · 金币 ${run.gold}`}>
    <p className="nd-copy">{event.blurb}</p>
    <div className="nd-choices">
      {event.options.map((option, index) => {
        const affordable = canAfford(option, run.gold, run.hp);
        return <NodeChoice key={index} label={option.label} hint={option.hint} disabled={!affordable}
          onHover={() => sound('hover', audioOn)}
          onClick={() => { sound('select', audioOn); setAnswer(option); }}>
          {/* What it costs, printed. The `hint` says it in the floor's own voice — 「路很远」,
              「土是热的」 — and that voice is deliberately not a number, so the number has to come
              from somewhere. Without this line a greyed-out option reads as a bug rather than as a
              price the player cannot meet yet. */}
          {option.requires && <span className="nd-choice-cost">{costLine(option)}</span>}
        </NodeChoice>;
      })}
    </div>
  </NodeShell>;
}

/** 「需要 30 金币 · 6 生命」, from the option's own numbers. */
function costLine(option: EventOption): string {
  const parts: string[] = [];
  if (option.requires?.gold) parts.push(`${option.requires.gold} 金币`);
  if (option.requires?.hp) parts.push(`${option.requires.hp} 生命`);
  return `需要 ${parts.join(' · ')}`;
}

// --------------------------------------------------------------- card picker

export type CardTask = 'pick' | 'remove' | 'polish' | 'duplicate';

const TASK_COPY: Record<CardTask, { title: string; kicker: string; hint: string; cta: string }> = {
  pick: { title: '挑一张带走', kicker: '战利品', hint: '只有这一张会进牌组。', cta: '拿走' },
  remove: { title: '投进火里', kicker: '焚牌', hint: '它会被彻底拿走，这一局再也不会出现。', cta: '烧掉' },
  polish: { title: '磨一磨', kicker: '打磨', hint: '同一张牌，数值更高。', cta: '打磨' },
  duplicate: { title: '再要一份', kicker: '复制', hint: '牌组里会多出完全一样的一张。', cta: '复制' },
};

/**
 * The card picker, shared by every reward that asks for a card.
 *
 * `pick` chooses from cards the run does *not* have yet; the other three choose from the deck itself.
 * Both are shown as real card faces — a picker that lists names would be asking the player to
 * remember what a card does at the exact moment they are deciding whether they want it.
 */
export function CardPicker({ task, run, options, onChoose, onDismiss, onPass, audioOn }: {
  task: CardTask; run: ChapterRun; options: CardOffer[];
  onChoose: (index: number) => void;
  /** Settle the task and close the picker. Only 打磨 keeps it open past the choice. */
  onDismiss?: () => void;
  onPass?: () => void; audioOn: boolean;
}) {
  const copy = TASK_COPY[task];
  const [picked, setPicked] = useState<number | null>(null);
  /**
   * The card that was just polished, held up on its own.
   *
   * **Two screens, one decision.** The deck is updated the moment 打磨 is pressed, but the picker does
   * not close: it turns into a reveal of the one card that changed, and waits for 继续. The first
   * version committed and closed on a 660ms timer, and the player sat through it with no idea whether
   * anything had happened — a beat nobody can see is not feedback, it is a delay.
   *
   * Everything here is local state. The run moves exactly once, on the click, and `onChoose` is what
   * moves it — this only decides how long the result stays on screen.
   */
  const [struck, setStruck] = useState<number | null>(null);

  function commitPolish(index: number) {
    onChoose(index);
    setStruck(index);
    sound('polish', audioOn);
  }
  /** 继续 — the reveal is over. */
  function finishPolish() {
    setStruck(null);
    onDismiss?.();
  }

  // For `pick` the source is the offer; for the rest it is the deck, shown grouped so a deck of
  // twenty-eight does not read as twenty-eight separate decisions.
  const entries = useMemo(() => {
    // An offer carries whether it is 已打磨 and whether it comes from outside the run's pool, and both
    // have to reach the face — the whole reason they exist is that the player can see them.
    if (task === 'pick') {
      return options.map((offer, index) => ({
        cardId: offer.cardId, index, upgraded: !!offer.upgraded, count: 1,
        beyond: !!offer.beyond, hidden: !!offer.hidden,
      }));
    }
    return deckCounts(run).map(entry => ({
      cardId: entry.cardId,
      index: run.deck.findIndex(card => card.cardId === entry.cardId && !!card.upgraded === entry.upgraded),
      upgraded: entry.upgraded,
      count: entry.count,
      beyond: false,
      hidden: false,
    }));
  }, [task, options, run]);

  // 打磨 only offers cards that *can* be polished and have not been already, rather than letting the
  // player pick one and then silently doing nothing.
  const offered = task === 'polish'
    ? entries.filter(entry => !entry.upgraded && isUpgradable(entry.cardId))
    : entries;

  /**
   * The reveal.
   *
   * A card that has just been polished is *no longer on offer* — 「牌组里没有还能打磨的牌」 is the
   * correct filter, and it is why the first version of this screen showed nothing at all: the card
   * that had just changed **vanished from the row**, leaving the mark, the new text and the glow with
   * nowhere to land. The player pressed 打磨 and a card disappeared.
   *
   * So the picker gives way to the one card that changed, at full size, with 继续 underneath. Nothing
   * times out and nothing auto-closes: the screen stays until it is dismissed.
   */
  const struckEntry = struck === null ? null : entries.find(entry => entry.index === struck);
  if (struckEntry) {
    const card = CARD_BY_ID.get(struckEntry.cardId);
    return <NodeShell kind="treasure" scene="event" kicker="打磨 · 完成" title="它比原来更好用了"
      footer="数值已经写进这张牌，本局一直有效。"
      actions={<button className="nd-primary" onPointerEnter={() => sound('hover', audioOn)}
        onClick={() => { sound('bell', audioOn); finishPolish(); }}>
        继续
      </button>}>
      <div className="nd-reveal">
        {card && <CardFace card={card} upgraded polishing />}
      </div>
    </NodeShell>;
  }

  return <NodeShell kind="treasure" scene={task === 'remove' ? 'rest' : 'event'}
    kicker={copy.kicker} title={copy.title}
    footer={copy.hint}
    actions={<>
      <button className="nd-primary" disabled={picked === null}
        onPointerEnter={() => sound('hover', audioOn)}
        onClick={() => {
          if (picked === null) return;
          if (task === 'polish') { commitPolish(picked); return; }
          sound('relic-set', audioOn); onChoose(picked);
        }}>
        {picked === null ? '先点一张牌' : copy.cta}
      </button>
      {task === 'pick' && onPass && <button className="nd-ghost"
        onClick={() => { sound('select', audioOn); onPass(); }}>不要</button>}
    </>}>
    <div className="nd-cards">
      {offered.map(entry => {
        const card = CARD_BY_ID.get(entry.cardId);
        if (!card) return null;
        // 背面朝上的一张牌：**牌组自己的背面**，所以玩家知道这是哪一副牌、不知道是哪一张。
        // 那个「知道一半」正是这个设计的工作——完全看不见是抽奖，完全看得见就没有了随机性。
        const deck = entry.hidden ? DECK_BY_ID.get(card.deck as never) : undefined;
        return <button key={`${entry.cardId}${entry.upgraded ? '+' : ''}`}
          className={`nd-card ${picked === entry.index ? 'on' : ''} ${entry.hidden ? 'is-hidden' : ''}`}
          aria-label={entry.hidden ? `${deck?.name ?? ''}的一张牌，背面朝上` : card.name}
          onPointerEnter={() => sound('hover', audioOn)}
          onClick={() => { sound('select', audioOn); setPicked(entry.index); }}>
          {/* The face carries its own 已打磨 mark, so the wrapper only adds what the face cannot say:
              how many copies this is. Two marks saying the same thing on one card read as two
              different facts. */}
          {deck
            ? <CardBack deck={deck} />
            : <CardFace card={card} selected={picked === entry.index} upgraded={entry.upgraded} />}
          {entry.count > 1 && <span className="nd-card-count">×{entry.count}</span>}
          {/* 未解锁 has to be *said*. A card the player has never seen, offered with no mark, reads as
              a card they simply do not remember — and the point of the tease is that it is a glimpse
              of what the rest of the library holds. It is also suppressed on a face-down offer: there
              is nothing to label. */}
          {entry.beyond && !entry.hidden && <span className="nd-card-beyond">未解锁</span>}
          {entry.hidden && <span className="nd-card-facedown">背面朝上</span>}
        </button>;
      })}
      {!offered.length && <p className="nd-empty">
        {task === 'polish' ? '牌组里没有还能打磨的牌。' : '牌组是空的。'}
      </p>}
    </div>
  </NodeShell>;
}
