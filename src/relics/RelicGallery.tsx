/**
 * 遗物总览 — the review page at `#/relics`.
 *
 * Like the card library this page pulls in nothing from `src/world/**` or `src/battle/**`: it is a
 * window onto `relics.ts` and the photographs beside it, so reading the set can never disturb the
 * map, a run, or a save.
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { RelicFace } from './RelicFace';
import { RELICS, RELIC_TIERS, RANK_OF, tierCounts, type RelicDefinition, type RelicTier } from './relics.ts';
import './relic-gallery.css';

const CHAPTER_1_POOL = RELICS.filter(relic => relic.chapter <= 1).length;

export default function RelicGallery() {
  const [tier, setTier] = useState<RelicTier | 'all'>('all');
  const [detail, setDetail] = useState<RelicDefinition | null>(null);

  const counts = useMemo(() => tierCounts(), []);
  const shown = useMemo(
    () => (tier === 'all' ? RELICS : RELICS.filter(relic => relic.tier === tier))
      .slice().sort((a, b) => RANK_OF[a.tier] - RANK_OF[b.tier] || a.id.localeCompare(b.id)),
    [tier],
  );

  return <div className="rg">
    <header className="rg-top">
      <div>
        <p className="rg-kicker">RELICS · 永夜回响</p>
        <h1>遗物总览<small>共 {RELICS.length} 件 · 五阶</small></h1>
        <p className="rg-sub">
          遗物从不进入手牌，也不会被打出——它只是<b>一直在那里</b>。所以每一件都得作为常驻效果站得住：
          这套牌全部咬在已经存在的机制上（余烬 / 锋锐 / 壁垒 / 映照 / 灼烧 / 烙印 / 反震 / 蓄火 / 连缀 / 空明），
          而不是给数字加数字。
        </p>
      </div>
      <dl className="rg-facts">
        <div><dt>总数</dt><dd>{RELICS.length}</dd></div>
        <div><dt>第一章可出</dt><dd>{CHAPTER_1_POOL}</dd></div>
        <div><dt>品阶</dt><dd>{RELIC_TIERS.length}</dd></div>
      </dl>
    </header>

    <section className="rg-slots">
      <article className="rg-slot main">
        <h2>主遗物槽<small>MAIN</small></h2>
        <p>每个首领节点之前的那场战斗打完，你会抽取一次。抽到的那件给的是卡面上印的<b>完整效果</b>。</p>
      </article>
      <article className="rg-slot sub">
        <h2>副遗物槽<small>SUB</small></h2>
        <p>主遗物抽完之后，<b>小概率</b>还能再抽一次，落进副槽。副槽的那件只给卡面下半部分印的折扣效果。</p>
      </article>
      <article className="rg-slot any">
        <h2>奇遇 / 商店 / 奖励<small>ELSEWHERE</small></h2>
        <p>这些地方也能碰到遗物，拿到之后由你决定装进哪个槽——装进主槽就是完整效果，装进副槽就是折扣效果。</p>
      </article>
    </section>

    <section className="rg-ladder">
      <h2 className="rg-ladder-title">五个品阶<small>THE LADDER</small></h2>
      <p className="rg-ladder-note">
        这条阶梯量的是<b>一件东西在长夜里活了多久</b>，所以它和卡牌的火焰阶梯（残烬 → 星陨）不是同一条。
        两条都叫「更稀有」、都听着像在烧的阶梯，是多余的一条。
      </p>
      <ol className="rg-rungs">
        {RELIC_TIERS.map((entry, index) => <li key={entry.id} className="rg-rung" style={{ '--tier': entry.accent } as CSSProperties}>
          <span className="rg-rung-num">{index + 1}</span>
          <div>
            <h3>{entry.name}<small>{counts[entry.id]} 件 · 权重 {entry.weight}</small></h3>
            <p>{entry.gloss}</p>
          </div>
        </li>)}
      </ol>
    </section>

    <nav className="rg-tiers" aria-label="品阶">
      <button className={tier === 'all' ? 'on' : ''} onClick={() => setTier('all')}>全部 {RELICS.length}</button>
      {RELIC_TIERS.map(entry => <button key={entry.id} className={tier === entry.id ? 'on' : ''}
        style={{ '--tier': entry.accent } as CSSProperties} onClick={() => setTier(entry.id)}>
        {entry.name} {counts[entry.id]}
      </button>)}
    </nav>

    <section className="rg-grid">
      {shown.map(relic => <button key={relic.id} className="rg-slot-card" onClick={() => setDetail(relic)}
        aria-label={`${relic.name}（${relic.tier}）`}>
        <RelicFace relic={relic} />
      </button>)}
      {!shown.length && <p className="rg-empty">这一阶还没有东西。</p>}
    </section>

    {detail && <div className="rg-modal" role="dialog" aria-label={detail.name}
      onClick={event => { if (event.target === event.currentTarget) setDetail(null); }}>
      <div className="rg-modal-inner">
        {/* ⚠️ 两层：外层**占位**，内层**放大**。
            卡面是固定 240×380 的，`transform: scale()` 不改变布局——直接把 scale 加在卡面那一层，
            外层仍然只按 240 宽排，放大的卡面会盖住右边的文字。也没有别的做法：`.rl` 自己那条
            `transform` 就是指针倾斜，往同一个元素上再叠一个 scale 会把它顶掉。 */}
        <div className="rg-modal-face"><div className="rg-modal-scale">
          <RelicFace relic={detail} />
        </div></div>
        <div className="rg-modal-copy">
          <h3>{detail.name}<small>{RELIC_TIERS.find(t => t.id === detail.tier)!.name}</small></h3>
          <p className="rg-modal-lore">{detail.lore}</p>
          <dl className="rg-modal-stats">
            <div><dt>主遗物</dt><dd>{detail.text}</dd></div>
            <div><dt>副遗物</dt><dd>{detail.sub}</dd></div>
            <div><dt>首次出现</dt><dd>第 {detail.chapter} 章</dd></div>
          </dl>
        </div>
        <button className="rg-modal-close" onClick={() => setDetail(null)} aria-label="关闭">✕</button>
      </div>
    </div>}
  </div>;
}
