import { useMemo, useState, type CSSProperties } from 'react';
import { CARD_SOUNDS, sound } from '../audio';
import { CardBack, CardFace, CardFlip } from './CardFace';
import { CARDS, CARD_BY_ID, DECKS, DECK_BY_ID, KEYWORDS, MAIN_SHARE, PATTERN_LABEL, TIERS, tierCounts, type CardDefinition, type DeckId, type PatternId, type TierId } from './index';
import { CARD_QUERY } from './art';
import './gallery.css';

const TYPE_ORDER = ['attack', 'skill', 'power', 'rite'] as const;
const TYPE_LABEL: Record<string, string> = { attack: '攻击', skill: '技能', power: '能力', rite: '仪式' };
type DeckFilter = DeckId | 'all';

export default function CardGallery() {
  const [deck, setDeck] = useState<DeckFilter>('all');
  const [tier, setTier] = useState<TierId | 'all'>('all');
  const [type, setType] = useState<string>('all');
  const [keyword, setKeyword] = useState<string>('all');
  const [pattern, setPattern] = useState<PatternId | 'all'>('all');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<CardDefinition | null>(null);
  const [main, setMain] = useState<DeckId>('blade');
  const [sub, setSub] = useState<DeckId>('bone');
  const [hand, setHand] = useState<{ card: CardDefinition; key: number; revealed: boolean }[]>([]);
  const [audioOn, setAudioOn] = useState(true);

  const shown = useMemo(() => CARDS.filter(card =>
    (deck === 'all' || card.deck === deck) &&
    (tier === 'all' || card.tier === tier) &&
    (type === 'all' || card.type === type) &&
    (keyword === 'all' || card.keywords.includes(keyword as never)) &&
    (pattern === 'all' || card.pattern === pattern) &&
    (!query || (card.name + card.text + card.lore).includes(query))), [deck, tier, type, keyword, pattern, query]);

  const spread = useMemo(() => {
    const counts = Object.fromEntries(TIERS.map(t => [t.id, 0])) as Record<TierId, number>;
    for (const card of shown) counts[card.tier] += 1;
    return counts;
  }, [shown]);

  const active = deck === 'all' ? null : DECK_BY_ID.get(deck)!;
  const chosen = active ? tierCounts(active.id) : null;
  const mainDeck = DECK_BY_ID.get(main)!, subDeck = DECK_BY_ID.get(sub)!;

  /** Draws for real: the main deck supplies 80% of the cards and the sub deck the rest, exactly as
   *  `drawSource` splits it in battle. A drawn card lands face down and turns over a beat later. */
  function draw() {
    const fromSub = Math.random() >= MAIN_SHARE;
    const source = fromSub ? subDeck : mainDeck;
    const entry = source.cards[Math.floor(Math.random() * source.cards.length)];
    const key = Date.now() + Math.random();
    sound('draw', audioOn);
    setHand(current => [{ card: CARD_BY_ID.get(entry.id)!, key, revealed: false }, ...current].slice(0, 6));
    window.setTimeout(() => setHand(current => current.map(item => item.key === key ? { ...item, revealed: true } : item)), 430);
  }
  /** Playing a card takes it out of hand and puts it down on the table. */
  function play() {
    if (!hand.length) return;
    sound('play', audioOn);
    setHand(current => current.slice(0, -1));
  }
  function shuffle() {
    sound('shuffle', audioOn);
    window.setTimeout(() => setHand([]), 260);
  }

  return <div className="cg">
    <header className="cg-top">
      <div>
        <p className="cg-kicker">永夜回响 · 对战牌库</p>
        <h1>卡牌总览 <small>{CARDS.length} 张 · 四副牌组</small></h1>
      </div>
      <nav className="cg-decks" aria-label="牌组">
        <button className={deck === 'all' ? 'on' : ''} onClick={() => setDeck('all')}>全部</button>
        {DECKS.map(item => <button key={item.id} className={deck === item.id ? 'on' : ''} style={{ '--deck': item.accent } as CSSProperties} onClick={() => setDeck(item.id)}>{item.name}</button>)}
      </nav>
    </header>

    <section className="cg-deckbar">
      {active && chosen ? <article className="cg-deck-card" style={{ '--deck': active.accent } as CSSProperties}>
        <CardBack deck={active} compact />
        <div className="cg-deck-copy">
          <h2>{active.name}<small>{active.subtitle}</small></h2>
          <p>{active.blurb}</p>
          <dl className="cg-deck-stats">
            <div><dt>携带</dt><dd>{active.size} 张</dd></div>
            <div><dt>种类</dt><dd>{active.cards.length} 种</dd></div>
            <div><dt>中立</dt><dd>{active.cards.filter(entry => CARD_BY_ID.get(entry.id)!.deck === 'neutral').length} 种</dd></div>
            <div><dt>形状</dt><dd>{new Set(active.cards.map(entry => CARD_BY_ID.get(entry.id)!.pattern)).size} 种</dd></div>
          </dl>
          <div className="cg-spread">{TIERS.map(t => chosen[t.id] ? <span key={t.id} style={{ '--tier': t.accent, flexGrow: chosen[t.id] } as CSSProperties} title={`${t.name} ${chosen[t.id]} 张`}><i style={{ background: t.accent }} />{t.name} {chosen[t.id]}</span> : null)}</div>
          <div className="cg-copies">残烬层每种 3 张（{chosen.cinder} 张），其余每种 1 张（{active.size - chosen.cinder} 张）</div>
        </div>
      </article> : <article className="cg-deck-card cg-deck-all">
        <div className="cg-deck-copy">
          <h2>四副牌组如何互相咬合<small>HOW THE DECKS INTERLOCK</small></h2>
          <p>每副牌组产出一个共享机制，消费另一副的：<b>刃</b>产余烬 → <b>焰</b>烧余烬施加灼烧 → <b>骨</b>把灼烧与格挡变成壁垒 → <b>镜</b>把壁垒和一切都复制成映照 → 再喂回刃。此外每副牌组都能带 4 张中立牌，那才是跨牌组流通最多的地方。</p>
          <div className="cg-chain">{['刃 余烬', '焰 灼烧', '骨 壁垒', '镜 映照', '刃'].map((label, i) => <span key={i}>{label}{i < 4 && <i>→</i>}</span>)}</div>
        </div>
      </article>}
      <article className="cg-draw" style={{ '--deck': mainDeck.accent } as CSSProperties}>
        <h2>每场战斗带牌<small>MAIN &amp; SUB DECK</small></h2>
        <label>主牌组 <select value={main} onChange={e => { const id = e.target.value as DeckId; setMain(id); if (id === sub) setSub(DECKS.find(d => d.id !== id)!.id); }}>{DECKS.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label>副牌组 <select value={sub} onChange={e => setSub(e.target.value as DeckId)}>{DECKS.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <div className="cg-draw-bar"><span style={{ flexGrow: MAIN_SHARE }}>{Math.round(MAIN_SHARE * 100)}%</span><span style={{ flexGrow: 1 - MAIN_SHARE }}>{Math.round((1 - MAIN_SHARE) * 100)}%</span></div>
        <p>每次抽牌有 <b>{Math.round(MAIN_SHARE * 100)}%</b> 来自《{mainDeck.name}》（{mainDeck.size} 张），<b>{Math.round((1 - MAIN_SHARE) * 100)}%</b> 来自《{subDeck.name}》（{subDeck.size} 张）。副牌组是细的第二股流，用来掺第二套流派而不稀释主牌组。</p>
      </article>
    </section>

    <section className="cg-draw-demo">
      <div className="cg-draw-head">
        <h2>抽牌<small>DRAWING A CARD</small></h2>
        <p>牌抽到手上之前是背面朝上的，落进手里才翻成正面。点下面的按钮从当前的主/副牌组抽一张试试。</p>
        <div className="cg-draw-actions">
          <button className="cg-draw-button" onClick={draw}>抽一张</button>
          <button className="cg-draw-clear" onClick={play} disabled={!hand.length}>打出一张</button>
          <button className="cg-draw-clear" onClick={shuffle} disabled={!hand.length}>洗回牌堆</button>
        </div>
        <div className="cg-sfx">
          <span className="cg-sfx-label">音效试听</span>
          <div>{CARD_SOUNDS.map(item => <button key={item.kind} title={item.note} onClick={() => sound(item.kind, audioOn)}>{item.label}</button>)}
            <button className={`cg-sfx-toggle ${audioOn ? 'on' : ''}`} onClick={() => { setAudioOn(!audioOn); sound('select', !audioOn); }}>{audioOn ? '音效开' : '音效关'}</button></div>
        </div>
      </div>
      <div className="cg-hand">
        <div className="cg-hand-pile" title={`${mainDeck.name} 牌堆`}><div className="cg-hand-back" style={{ backgroundImage: `url(/assets/cards/back-${mainDeck.id}.webp)` }} /><span>{mainDeck.size} 张</span></div>
        <div className="cg-hand-row">
          {hand.map(item => <CardFlip key={item.key} card={item.card} revealed={item.revealed}
            deck={DECK_BY_ID.get(item.card.deck === 'neutral' ? mainDeck.id : item.card.deck as DeckId)!} />)}
          {!hand.length && <p className="cg-hand-empty">手牌区是空的。</p>}
        </div>
      </div>
    </section>

    <section className="cg-prob">
      <h2>稀有度与出现概率<small>RARITY &amp; DROP WEIGHT</small></h2>
      <div className="cg-prob-row">{TIERS.map(t => <button key={t.id} className={tier === t.id ? 'on' : ''} style={{ '--tier': t.accent } as CSSProperties} onClick={() => setTier(tier === t.id ? 'all' : t.id)}>
        <span className="cg-prob-name">{t.name}</span>
        <span className="cg-prob-bar"><i style={{ height: `${Math.max(6, t.weight)}%` }} /></span>
        <span className="cg-prob-weight">{t.weight}%</span>
        <span className="cg-prob-count">{CARDS.filter(c => c.tier === t.id).length} 张</span>
        <small>{t.gloss}</small>
      </button>)}</div>
      <p className="cg-note">权重用于战斗后的选牌与商店：每张牌先抽稀有度再抽牌，所以 星陨 约每 50 次掉落出现一次（{TIERS[4].weight}%），一副牌组里也只有 2 张。</p>
    </section>

    <section className="cg-keywords">
      <h2>流派资源<small>ARCHETYPE RESOURCES</small><span className="cg-h2-note">每副牌组产出一个、消耗另一个的</span></h2>
      <div>{KEYWORDS.filter(k => k.kind === 'resource').map(k => <button key={k.id} className={keyword === k.id ? 'on' : ''} onClick={() => setKeyword(keyword === k.id ? 'all' : k.id)}>
        <b>{k.name}</b><span>{k.owner ? DECK_BY_ID.get(k.owner)!.name : ''}</span><p>{k.rule}</p>
      </button>)}</div>
    </section>

    <section className="cg-keywords">
      <h2>通用机制<small>UNIVERSAL MECHANICS</small><span className="cg-h2-note">任何牌组都能用——这才是让每张牌不一样的东西</span></h2>
      <div>{KEYWORDS.filter(k => k.kind === 'mechanic').map(k => <button key={k.id} className={keyword === k.id ? 'on' : ''} onClick={() => setKeyword(keyword === k.id ? 'all' : k.id)}>
        <b>{k.name}</b><span>{CARDS.filter(c => c.keywords.includes(k.id)).length} 张</span><p>{k.rule}</p>
      </button>)}</div>
    </section>

    <section className="cg-filters">
      <div className="cg-types"><button className={type === 'all' ? 'on' : ''} onClick={() => setType('all')}>全部</button>{TYPE_ORDER.map(t => <button key={t} className={type === t ? 'on' : ''} onClick={() => setType(t)}>{TYPE_LABEL[t]}</button>)}</div>
      <label className="cg-patterns">形状 <select value={pattern} onChange={e => setPattern(e.target.value as PatternId | 'all')}>
        <option value="all">全部形状</option>
        {(Object.keys(PATTERN_LABEL) as PatternId[]).map(id => <option key={id} value={id}>{PATTERN_LABEL[id]}（{CARDS.filter(c => c.pattern === id).length}）</option>)}
      </select></label>
      <label className="cg-search"><input placeholder="搜索牌名、规则或风味文本…" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <div className="cg-spread-mini">{TIERS.map(t => <span key={t.id} style={{ '--tier': t.accent } as CSSProperties}>{t.name} <b>{spread[t.id]}</b></span>)}<span className="cg-total">共 <b>{shown.length}</b> 张 · <b>{new Set(shown.map(c => c.pattern)).size}</b> 种形状</span></div>
    </section>

    <section className="cg-grid">{shown.map(card => <button key={card.id} className="cg-slot" onPointerEnter={() => sound('hover', audioOn)} onClick={() => { sound('select', audioOn); setOpen(card); }} aria-label={`查看 ${card.name}`}><CardFace card={card} /></button>)}</section>
    {!shown.length && <p className="cg-empty">没有符合条件的牌。</p>}

    {open && <div className="cg-modal" role="dialog" aria-label={open.name} onClick={e => { if (e.target === e.currentTarget) setOpen(null); }}>
      <div className="cg-modal-inner">
        <CardFace card={open} />
        <div className="cg-detail">
          <h3>{open.name}<small>{open.id} · {DECK_BY_ID.get(open.deck as never)?.name ?? '中立'}</small></h3>
          <p className="cg-detail-text">{open.text}</p>
          <blockquote>「{open.lore}」</blockquote>
          <dl>
            <div><dt>稀有度</dt><dd>{TIERS.find(t => t.id === open.tier)!.name}（掉落 {TIERS.find(t => t.id === open.tier)!.weight}%）</dd></div>
            <div><dt>费用</dt><dd>{open.cost >= 0 ? open.cost : '不可直接打出'}</dd></div>
            <div><dt>类型</dt><dd>{TYPE_LABEL[open.type]}</dd></div>
            <div><dt>形状</dt><dd>{PATTERN_LABEL[open.pattern]}</dd></div>
            <div><dt>机制</dt><dd>{open.keywords.length ? open.keywords.map(k => KEYWORDS.find(w => w.id === k)!.name).join(' · ') : '无'}</dd></div>
            {open.bridge && <div><dt>跨组联动</dt><dd>{DECK_BY_ID.get(open.bridge)!.name}</dd></div>}
            <div><dt>封面取材</dt><dd>{CARD_QUERY[open.id] ?? '—'}</dd></div>
          </dl>
          <div className="cg-in-decks">{DECKS.filter(d => d.cards.some(e => e.id === open.id)).map(d => <span key={d.id} style={{ '--deck': d.accent } as CSSProperties}>{d.name}</span>)}</div>
        </div>
        <button className="cg-close" onClick={() => setOpen(null)} aria-label="关闭">✕</button>
      </div>
    </div>}
  </div>;
}
