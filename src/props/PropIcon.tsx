import { useId, useRef, type CSSProperties, type PointerEvent } from 'react';
import { KIND_BY_ID, type PropDefinition, type PropUse } from './props.ts';
import './props.css';

/**
 * 道具图标 —— 一个**正方形**，上面只有两样东西：**图**，和**名字**。
 *
 * 效果文案 `prop.text` 只在**悬停**（或键盘 focus）时从旁边展开的一块面板里出现。这是用户
 * 点名的形状，也是这个文件里最容易写错的地方：把 `text` 顺手印在方格上，几十件道具就变成一个
 * 读不完的列表——而「现在用不用」这个判断恰恰需要一眼扫过整排才做得出来。
 *
 * ⚠️ **道具没有稀有度**（见 `props.ts` 文件头）。所以这里没有绶带、没有阶梯角标、没有角标数字，
 * `weight` 一个字符都不许出现在界面上。颜色编码的是**分类**：`prop.kind` 的颜色用在边框和
 * 名字底板上，所以扫一眼三个槽就知道自己带的是哪几类答案。
 *
 * ⚠️ **`.pp` 自身的 `transform` 被指针倾斜占用了**（`useTilt`，和 `RelicFace` 同一段代码）。
 * 任何缩放都必须另起一层——悬停的抬起做在 `.pp-inner` 上，验收页弹窗的放大做在它外面包的一层上。
 * 往 `.pp` 上再叠一个 `scale` 会把倾斜顶掉。
 *
 * ⚠️ **只读用法的调用方要自己补一条 focus 规则。** 展开面板由 `.pp:hover / .pp:focus-within`
 * 打开，而只读时焦点落在**外面包着它的那个按钮**上——`focus-within` 只认后代、不认祖先，
 * 键盘用户于是永远看不到效果文案。验收页那一条写在 `prop-gallery.css` 的 `.pg-item:focus-visible`
 * 上（两行：opacity + visibility），别的调用方包一层就欠一条。
 */

/** 能用在哪。印在展开面板上；验收页的弹窗读同一张表，所以两处不可能说岔。
 *  战斗层决定要不要禁用某一格，图标只负责说明自己是什么。 */
export const USE_LABEL: Record<PropUse, string> = {
  battle: '战斗内',
  camp: '营火边',
  anywhere: '战斗与营火',
};

/** 照抄 `RelicFace`：指针跟随倾斜，尊重 reduced-motion，touch 跳过。 */
function useTilt() {
  const ref = useRef<HTMLElement>(null);
  return {
    ref,
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const node = ref.current;
      if (!node || event.pointerType === 'touch' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const rect = node.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width, y = (event.clientY - rect.top) / rect.height;
      node.style.setProperty('--rx', `${(0.5 - y) * 11}deg`);
      node.style.setProperty('--ry', `${(x - 0.5) * 15}deg`);
      node.style.setProperty('--glow-x', `${x * 100}%`);
      node.style.setProperty('--glow-y', `${y * 100}%`);
    },
    onPointerLeave: () => {
      const node = ref.current;
      if (!node) return;
      node.style.setProperty('--rx', '0deg');
      node.style.setProperty('--ry', '0deg');
    },
  };
}

export function PropIcon({ prop, uses, compact, onUse, disabled, reason }: {
  prop: PropDefinition;
  /** 还剩几次。不给就当作满次数（验收页用）。 */
  uses?: number;
  compact?: boolean;
  /** 给了就是可点的（战斗里那一排）；不给就是只读的（验收页网格）。 */
  onUse?: () => void;
  disabled?: boolean;
  /** 灰掉的原因，会印在展开面板上。 */
  reason?: string;
}) {
  const kind = KIND_BY_ID.get(prop.kind)!;
  // 验收页不给 `uses`，那里没有 run——所以缺省是满次数，而不是 0（0 会画成一件用完的道具）。
  const left = Math.max(0, Math.min(prop.charges, uses ?? prop.charges));
  const spent = left <= 0;
  const dead = Boolean(disabled) || spent;
  const interactive = Boolean(onUse);
  const popId = useId();
  const tilt = useTilt();

  return <article
    ref={tilt.ref} onPointerMove={tilt.onPointerMove} onPointerLeave={tilt.onPointerLeave}
    className={`pp ${compact ? 'pp-compact' : ''} ${dead ? 'pp-dead' : ''} ${interactive ? 'pp-live' : ''}`}
    style={{ '--kind': kind.accent } as CSSProperties}
    data-prop={prop.id}>
    <div className="pp-inner">
      <div className="pp-art" style={{ backgroundImage: `url(/assets/props/${prop.id}.webp)` }} />
      <div className="pp-scrim" />
      {/* 名字坐在**分类色**的底板上：一排方格里最先被读到的东西就是这九种颜色。 */}
      <div className="pp-name"><span>{prop.name}</span></div>
      {/* 右上角一排凹口：用掉一个灭一个。**一次性道具不画**——`charges === 1` 时那一个点
          没有信息量，它只是让每个方格都多一个装饰。 */}
      {prop.charges > 1 && <div className="pp-pips" aria-hidden="true">
        {Array.from({ length: prop.charges }, (_, i) => <i key={i} className={i < left ? 'on' : ''} />)}
      </div>}
      <span className="pp-frame" aria-hidden="true" />
      <span className="pp-sheen" aria-hidden="true" />
      <span className="pp-pointer-glow" aria-hidden="true" />
    </div>
    {/* ⚠️ 用 `aria-disabled` 而不是 `disabled`：`disabled` 的按钮**不可聚焦**，
        于是键盘用户永远走不到 `.pp:focus-within`，被灰掉的道具连原因都读不到。 */}
    {interactive && <button type="button" className="pp-hit" aria-disabled={dead || undefined}
      aria-label={prop.name} aria-describedby={popId}
      onClick={() => { if (!dead) onUse?.(); }} />}
    <div className="pp-pop" id={popId}>
      <div className="pp-pop-head"><i /><span>{kind.name}</span><em>{USE_LABEL[prop.use]}</em>
        {prop.charges > 1 && <em className="pp-pop-uses">还剩 {left}/{prop.charges}</em>}
      </div>
      <p className="pp-pop-text">{prop.text}</p>
      {reason && <p className="pp-pop-reason">{reason}</p>}
    </div>
  </article>;
}
