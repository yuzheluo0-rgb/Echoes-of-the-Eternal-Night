/**
 * 道具总览 — the review page at `#/prop`.
 *
 * Like the card library and the relic gallery this page pulls in nothing from `src/world/**` or
 * `src/battle/**`. It is a window onto `props.ts`, its search phrases, and the squares those
 * photographs are filling in: reading the set can never disturb the map, a run, or a save.
 *
 * 它存在的理由和另外两页一样：**几十件道具在真正的界面上一次只看得见三件**。三个槽是设计
 * （稀缺才产生取舍），但没有一面墙能一次看完，就没有人判断得了那一整套是不是真的分了工。
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { KIND_BY_ID, PROP_KINDS, PROPS, PROP_SLOTS, kindCounts, propsUsableIn, type PropDefinition, type PropKind } from './props.ts';
import { PROP_QUERY } from './art.ts';
import { PropIcon, USE_LABEL } from './PropIcon.tsx';
import './prop-gallery.css';

type KindFilter = PropKind | 'all';

export default function PropGallery() {
  const [kind, setKind] = useState<KindFilter>('all');
  const [open, setOpen] = useState<PropDefinition | null>(null);
  /** 示意那一排点了什么。这一页没有 run，所以点击只需要一个看得见的回声。 */
  const [fired, setFired] = useState<string | null>(null);

  const counts = useMemo(() => kindCounts(), []);
  const battleReady = useMemo(() => propsUsableIn('battle').length, []);
  const shown = useMemo(
    () => (kind === 'all' ? PROPS : PROPS.filter(prop => prop.kind === kind)),
    [kind],
  );
  /** 有不止一次的那几件——只有它们画得出「还剩几次」。 */
  const multi = useMemo(() => PROPS.filter(prop => prop.charges > 1), []);
  const oneShot = useMemo(() => PROPS.find(prop => prop.charges === 1) ?? null, []);
  const active = kind === 'all' ? null : KIND_BY_ID.get(kind)!;

  return <div className="pg">
    <header className="pg-top">
      <div>
        <p className="pg-kicker">PROPS · 永夜回响</p>
        <h1>道具总览<small>共 {PROPS.length} 件 · 九类 · {PROP_SLOTS} 个槽</small></h1>
        <p className="pg-sub">
          道具<b>不进牌组，也不挂在身上</b>——它是你花掉的那样东西。所以方图标上只有图与名字，
          效果文案悬停才展开。<b>颜色是分类</b>，右上角的凹口是还剩几次，除此之外什么都不印。
        </p>
      </div>
      <dl className="pg-facts">
        <div><dt>总数</dt><dd>{PROPS.length}</dd></div>
        <div><dt>战斗可用</dt><dd>{battleReady}</dd></div>
        <div><dt>分类</dt><dd>{PROP_KINDS.length}</dd></div>
        <div><dt>槽位</dt><dd>{PROP_SLOTS}</dd></div>
      </dl>
    </header>

    <section className="pg-intro">
      <h2 className="pg-intro-title">道具是第三条轴<small>THE THIRD AXIS</small></h2>
      <div className="pg-axis">
        <article className="pg-axis-card">
          <span className="pg-axis-num">一</span>
          <h3>牌组不稳定 · 遗物固定 · 道具一次性</h3>
          <p>
            <b>牌组</b>是你做什么：每次都重新洗，你得接受抽到的那几张。<b>遗物</b>是你是什么：
            装上就不再变。道具是第三样——<b>你花掉的那样</b>，它只为一种感觉存在：
            「我什么都没抽到，而我要因此死了。」
          </p>
        </article>
        <article className="pg-axis-card">
          <span className="pg-axis-num">二</span>
          <h3>只有 {PROP_SLOTS} 个槽，因为稀缺才产生取舍</h3>
          <p>
            {PROP_SLOTS} 个格，{PROPS.length} 件道具，所以你<b>永远带不上想要的第四件</b>。
            如果一件道具能一直用，它就不是道具，是一条多绕几步的第二条遗物轨——
            真正的张力在于<b>用掉它就等于放弃了以后再用它</b>。
          </p>
        </article>
        <article className="pg-axis-card">
          <span className="pg-axis-num">三</span>
          <h3>没有稀有度，因为第三条阶梯是多余的一条</h3>
          <p>
            卡牌有火焰阶梯（残烬 → 星陨），遗物有存活阶梯（残片 → 绝响）。再加一条意思同样是
            「更稀有」的阶梯，就是<b>一条多余的阶梯</b>。道具是消耗品：玩家要判断的是
            「现在用不用」，不是「它有多稀有」——掉率只活在数据里。
            真正印出来的是<b>分类</b>：九种颜色，就是你带的是哪几类答案。
          </p>
        </article>
      </div>
    </section>

    <section className="pg-strip">
      <h2 className="pg-strip-title">战斗里那一排<small>IN BATTLE · 示意</small></h2>
      <p className="pg-strip-note">
        真打起来时它在手牌行的最左边、遗物轨旁边，一次只显示带上的那几件。这一节是<b>示意</b>——
        用来验收外面那一页看不到的两个状态：次数用掉一个、以及灰掉的一格（原因印在展开面板上）。
      </p>
      <div className="pg-strip-row">
        {multi[0] && <figure className="pg-strip-cell">
          <PropIcon prop={multi[0]} uses={multi[0].charges} compact onUse={() => setFired(multi[0].name)} />
          <figcaption>满次数：{multi[0].charges} 个凹口</figcaption>
        </figure>}
        {multi[1] && <figure className="pg-strip-cell">
          <PropIcon prop={multi[1]} uses={1} compact onUse={() => setFired(multi[1].name)} />
          <figcaption>用掉一次：灭一个</figcaption>
        </figure>}
        {multi[0] && <figure className="pg-strip-cell">
          <PropIcon prop={multi[0]} uses={multi[0].charges} compact disabled
            onUse={() => setFired(multi[0].name)} reason="这一格现在点不动——灰掉的原因就印在这里。" />
          <figcaption>灰掉：悬停看原因</figcaption>
        </figure>}
        {oneShot && <figure className="pg-strip-cell">
          <PropIcon prop={oneShot} compact onUse={() => setFired(oneShot.name)} />
          <figcaption>一次性：不画凹口</figcaption>
        </figure>}
      </div>
      <p className="pg-strip-fired">
        {fired ? `（示意）你用了「${fired}」——真的用掉一次会走 run 的道具槽。` : '点一下方格试试（这一页只是示意，不消耗任何东西）。'}
      </p>
    </section>

    <nav className="pg-kinds" aria-label="分类">
      <button className={kind === 'all' ? 'on' : ''} onClick={() => setKind('all')}>全部 {PROPS.length}</button>
      {PROP_KINDS.map(entry => <button key={entry.id} className={kind === entry.id ? 'on' : ''}
        style={{ '--kind': entry.accent } as CSSProperties} title={entry.gloss}
        onClick={() => setKind(entry.id)}>
        <i />{entry.name} {counts[entry.id]}
      </button>)}
    </nav>
    {/* `gloss` 是一句「这一类回答什么问题」，光放在 title 里等于没写——选中之后必须看得见。 */}
    <p className="pg-kind-note">
      {active ? <><b style={{ color: active.accent }}>{active.name}</b>{active.gloss}</> : '九类各自回答一个不同的问题。点一个分类看这一类。'}
    </p>

    <section className="pg-grid">
      {shown.map(prop => <button key={prop.id} className="pg-item"
        aria-label={`${prop.name}（${KIND_BY_ID.get(prop.kind)!.name}）`} onClick={() => setOpen(prop)}>
        <PropIcon prop={prop} />
      </button>)}
      {!shown.length && <p className="pg-empty">这一类还没有东西。</p>}
    </section>

    {open && <div className="pg-modal" role="dialog" aria-label={open.name}
      onClick={event => { if (event.target === event.currentTarget) setOpen(null); }}>
      <div className="pg-modal-inner">
        {/* ⚠️ 两层：外层**占位**，内层**放大**。方格是固定 176 的，`transform: scale()` 不改布局——
            直接把 scale 加在方格那一层，外层仍然只按 176 排，放大的方格会盖住右边的文字。
            也没有别的做法：`.pp` 自己那条 `transform` 就是指针倾斜，往同一个元素上再叠一个
            scale 会把它顶掉。229 = 176 × 1.3，`transform-origin: top left` 所以是从左上角长出去的。 */}
        <div className="pg-modal-icon"><div className="pg-modal-scale">
          <PropIcon prop={open} />
        </div></div>
        <div className="pg-modal-copy">
          <h3>{open.name}<small>{KIND_BY_ID.get(open.kind)!.name}</small></h3>
          <p className="pg-modal-text">{open.text}</p>
          <p className="pg-modal-lore">{open.lore}</p>
          <dl className="pg-modal-stats">
            <div><dt>分类</dt><dd>{KIND_BY_ID.get(open.kind)!.name} · {KIND_BY_ID.get(open.kind)!.gloss}</dd></div>
            <div><dt>可用</dt><dd>{USE_LABEL[open.use]}</dd></div>
            <div><dt>次数</dt><dd>
              {open.charges > 1
                // ⚠️ 上限是**数据**（`charges`），剩余是**槽位**上的值（`PropSlot.uses`）——
                // 两根轴，这里只有数据层的那一根。验收页没有 run，所以画的是满次数。
                ? `上限 ${open.charges} 次 · 右上角那排凹口就是剩余，用掉一个灭一个（这一页按满次数画）`
                : '一次性，用过就没了（所以方图标不画凹口）'}
            </dd></div>
            {open.target === 'enemy' && <div><dt>需要目标</dt><dd>要点一个敌人</dd></div>}
            {open.pick && <div><dt>需要挑牌</dt><dd>从手牌里挑 {open.pick.count} 张</dd></div>}
            {open.deck && <div><dt>改动牌库</dt><dd>
              {open.deck === 'remove' ? '从牌库里移除一张牌' : '打磨牌库里的一张牌'}（要开选牌器，所以只能在营火边用）
            </dd></div>}
            <div><dt>封面取材</dt><dd>{PROP_QUERY[open.id] ?? '—'}</dd></div>
          </dl>
        </div>
        <button className="pg-modal-close" onClick={() => setOpen(null)} aria-label="关闭">✕</button>
      </div>
    </div>}
  </div>;
}
