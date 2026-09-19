import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, DragEvent, ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Bell, BookOpen, Bookmark, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Coins, Crosshair, Diamond, Eye, Flame, Gem, Heart, Layers3, Map, Maximize2, Moon, RotateCcw, ScrollText, Search, Settings2, Shield, Skull, Sparkles, Swords, Volume2, VolumeX, Wind, X, Zap } from 'lucide-react';
import { CARDS, ENEMIES, SUITS, beginNextRound, createCombat, exchangeCards, getFormation, isValidSave, legalTargets, living, resolveRound, ringBell } from './engine';
import type { CardDefinition, CardInstance, CombatState, Enemy, Frame, Lane, Suit } from './engine';
import { Atmosphere, Sigil3D } from './effects';
import { setAmbience, setAudioVolume, sound } from './audio';

const SAVE_KEY = 'eternal-night-combat-v1';
const SETTINGS_KEY = 'eternal-night-settings-v1';
type Modal = 'library' | 'map' | 'help' | 'settings' | 'bell' | 'log' | 'draw' | 'discard' | 'inspect' | 'restart' | 'result' | 'relic' | null;
interface Preferences { sound: boolean; reduced: boolean; particles: boolean; speed: number; volume: number }
function loadCombat(): CombatState {
  try { const data: unknown = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); if (isValidSave(data)) return data; } catch { /* New expedition after invalid storage. */ }
  return createCombat();
}
function loadPreferences(): Preferences {
  const defaults = { sound: false, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, particles: true, speed: 1, volume: .65 };
  try {
    const p = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return { sound: typeof p.sound === 'boolean' ? p.sound : defaults.sound, reduced: typeof p.reduced === 'boolean' ? p.reduced : defaults.reduced, particles: typeof p.particles === 'boolean' ? p.particles : true, speed: [1, 2].includes(p.speed) ? p.speed : 1, volume: typeof p.volume === 'number' && p.volume >= 0 && p.volume <= 1 ? p.volume : .65 };
  } catch { return defaults; }
}
function SuitIcon({ suit, size = 18 }: { suit: Suit; size?: number }) {
  const Icon = suit === 'blade' ? Swords : suit === 'flame' ? Flame : suit === 'bone' ? Shield : Diamond;
  return <Icon size={size} strokeWidth={1.45} />;
}
function Mark({ className = '' }: { className?: string }) {
  return <svg className={className} viewBox="0 0 60 72" fill="none" aria-hidden="true"><path d="M30 2 55 36 30 70 5 36Z" stroke="currentColor" strokeWidth="1" /><path d="M30 11 47 36 30 61 13 36Z" stroke="currentColor" strokeWidth=".6" /><path d="M37 22a16 16 0 1 0 0 28 20 20 0 0 1 0-28Z" fill="currentColor"/><path d="M30 2v12m0 44v12M5 36h11m28 0h11" stroke="currentColor"/><circle cx="31" cy="36" r="2.3" fill="currentColor" /></svg>;
}
function Dialog({ title, eyebrow, children, onClose, wide = false }: { title: string; eyebrow?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current; if (!dialog) return;
    dialog.showModal();
    return () => { dialog.close(); };
  }, []);
  return <dialog className={`dialog ${wide ? 'dialog-wide' : ''}`} ref={ref} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) onClose(); }} aria-label={title}>
    <div className="dialog-inner"><button className="icon-button dialog-close" onClick={onClose} aria-label="关闭窗口"><X size={20} /></button>
      <div className="eyebrow">{eyebrow || 'ECHOES OF ETERNAL NIGHT'}</div><h2>{title}</h2><div className="ornament-rule"><span>◆</span></div>{children}
    </div>
  </dialog>;
}
function GameCard({ card, index = 0, selected = false, order, swap = false, kept = false, disabled = false, reduced = false, audioEnabled = false, onSelect, onInspect, onKeep, onDrag }: {
  card: CardDefinition; index?: number; selected?: boolean; order?: number; swap?: boolean; kept?: boolean; disabled?: boolean; reduced?: boolean; audioEnabled?: boolean;
  onSelect?: () => void; onInspect?: () => void; onKeep?: () => void; onDrag?: (e: DragEvent) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  return <article ref={ref} className={`game-card suit-${card.suit} ${selected ? 'selected' : ''} ${swap ? 'swap-chosen' : ''} ${kept ? 'kept' : ''}`}
    style={{ '--card-index': index, '--suit-color': SUITS[card.suit].color } as CSSProperties}
    onPointerEnter={() => { if (!disabled) sound('hover', audioEnabled); }} onPointerMove={e => {
      if (reduced || e.pointerType === 'touch') return;
      const r = e.currentTarget.getBoundingClientRect();
      e.currentTarget.style.setProperty('--rx', `${(0.5 - (e.clientY - r.top) / r.height) * 9}deg`);
      e.currentTarget.style.setProperty('--ry', `${((e.clientX - r.left) / r.width - 0.5) * 13}deg`);
      e.currentTarget.style.setProperty('--glow-x', `${(e.clientX - r.left) / r.width * 100}%`);
    }} onPointerLeave={() => { ref.current?.style.setProperty('--rx', '0deg'); ref.current?.style.setProperty('--ry', '0deg'); }}>
    <button className="card-select" aria-label={`${card.name}，${SUITS[card.suit].name}${card.rank}，${card.description}${selected ? '，已选中' : ''}`} aria-pressed={selected || swap} onClick={onSelect || onInspect} disabled={disabled} draggable={!!onDrag && !disabled} onDragStart={onDrag} onContextMenu={e => { e.preventDefault(); onInspect?.(); }}>
      <div className="card-art" style={{ backgroundImage: `url(/assets/card-${card.art}.webp)` }} />
      <div className="card-rank"><b>{card.rank}</b><SuitIcon suit={card.suit} size={14} /></div>
      {selected && <span className="selection-order">第 {order} 拍</span>}
      {swap && <span className="selection-order"><RotateCcw size={12} /> 换出</span>}
      <div className="card-name"><span className="card-name-line" /><h3>{card.name}</h3><span className="card-name-line" /></div>
      <div className="card-description">{card.description}</div>
      <div className="card-type"><SuitIcon suit={card.suit} size={11} /><span>{SUITS[card.suit].name}印 · 战术</span><span className="card-rarity">◇</span></div>
      <span className="card-corner corner-tl" /><span className="card-corner corner-tr" /><span className="card-corner corner-bl" /><span className="card-corner corner-br" />
      <span className="card-shine" />
    </button>
    <span className="card-aura" aria-hidden="true" /><span className="hover-motes" aria-hidden="true">{[0,1,2,3,4,5,6,7].map(i => <i key={i} style={{ '--mote': i } as CSSProperties} />)}</span>
    {onKeep && <button className={`keep-button ${kept ? 'is-kept' : ''}`} title="保留到下一轮" aria-label={`${kept ? '取消保留' : '保留'}${card.name}`} aria-pressed={kept} onClick={onKeep} disabled={disabled || selected}><Bookmark size={12} fill={kept ? 'currentColor' : 'none'} /></button>}
    {onInspect && <button className="inspect-button" aria-label={`查看${card.name}详情`} onClick={onInspect}><Maximize2 size={11} /></button>}
    {onSelect && <span className="card-key">{index + 1}</span>}
  </article>;
}

export default function App() {
  const [game, setGame] = useState(loadCombat);
  const [preferences, setPreferences] = useState(loadPreferences);
  const [selected, setSelected] = useState<string[]>([]);
  const [lane, setLane] = useState<Lane>(1);
  const [target, setTarget] = useState<string | undefined>(undefined);
  const [keep, setKeep] = useState<string | undefined>();
  const [frenzy, setFrenzy] = useState(false);
  const [swapMode, setSwapMode] = useState(false);
  const [swapIds, setSwapIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false); const playback = useRef(0);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [modal, setModal] = useState<Modal>(() => game.status === 'playing' ? null : 'result');
  const [inspect, setInspect] = useState<CardDefinition>(CARDS.C01);
  const [filter, setFilter] = useState<Suit | 'all'>('all');
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [saved, setSaved] = useState(true);
  const [relicView, setRelicView] = useState<'relic' | 'blade' | 'bone'>('relic');
  const arenaRef = useRef<HTMLDivElement>(null);
  const selectedCards = selected.map(uid => game.hand.find(c => c.uid === uid)).filter((c): c is CardInstance => !!c).map(c => CARDS[c.id]);
  const formation = getFormation(selectedCards);
  const enemies = living(game);
  const totalIntent = enemies.filter(e => game.intentIds.includes(e.uid)).reduce((sum, e) => sum + e.attack, 0);
  const pendingWaves = game.waves.filter(w => !w.entered);
  const canAct = !busy && game.status === 'playing';

  useEffect(() => {
    if (busy) return;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(game)); setSaved(true); } catch { setSaved(false); }
  }, [game, busy]);
  useEffect(() => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(preferences)); } catch { /* Optional preference storage. */ } }, [preferences]);
  useEffect(() => { setAudioVolume(preferences.sound ? preferences.volume : 0); }, [preferences.volume, preferences.sound]);
  useEffect(() => {
    const update = () => setAmbience(preferences.sound && !document.hidden);
    update(); document.addEventListener('visibilitychange', update);
    return () => { document.removeEventListener('visibilitychange', update); setAmbience(false); };
  }, [preferences.sound]);
  useEffect(() => { if (!notice) return; const id = setTimeout(() => setNotice(''), 3400); return () => clearTimeout(id); }, [notice]);
  useEffect(() => () => { playback.current++; }, []);
  function notify(text: string) { setNotice(text); }
  function selectCard(uid: string) {
    if (!canAct) return;
    sound('select', preferences.sound);
    if (swapMode) {
      if (swapIds.includes(uid)) setSwapIds(ids => ids.filter(id => id !== uid));
      else if (swapIds.length < Math.min(4, 2 + game.swapBonus)) setSwapIds(ids => [...ids, uid]);
      else notify(`本轮最多可换 ${Math.min(4, 2 + game.swapBonus)} 张牌。`);
      return;
    }
    if (selected.includes(uid)) setSelected(ids => ids.filter(id => id !== uid));
    else if (selected.length < 3) { setSelected(ids => [...ids, uid]); if (keep === uid) setKeep(undefined); }
    else notify('三拍已满。点击已选卡牌可取消，也可拖入牌位替换。');
  }
  function dropCard(e: DragEvent, index: number) {
    e.preventDefault();
    if (!canAct || swapMode) return;
    const uid = e.dataTransfer.getData('text/plain');
    if (!game.hand.some(c => c.uid === uid)) return;
    const next = [...selected]; const old = next.indexOf(uid);
    if (old !== -1) next.splice(old, 1);
    else if (next.length === 3) next.splice(index, 1);
    next.splice(Math.min(index, next.length), 0, uid);
    setSelected(next.slice(0, 3)); if (keep === uid) setKeep(undefined);
    sound('select', preferences.sound);
  }
  function swapCards() {
    if (!canAct || game.swapped) return;
    if (!swapMode) { setSwapMode(true); setSelected([]); notify('选择要换出的手牌，然后确认换牌。'); return; }
    if (!swapIds.length) { setSwapMode(false); return; }
    try {
      setGame(exchangeCards(game, swapIds)); if (keep && swapIds.includes(keep)) setKeep(undefined);
      setSwapIds([]); setSwapMode(false); sound('draw', preferences.sound);
    } catch (error) { notify((error as Error).message); }
  }
  async function playRound() {
    if (busyRef.current || !canAct || swapMode) return;
    busyRef.current = true;
    let result: ReturnType<typeof resolveRound>;
    try { result = resolveRound(game, { cards: selected, lane, target, keep, frenzy }); }
    catch (error) { busyRef.current = false; notify((error as Error).message); return; }
    setBusy(true); const token = ++playback.current;
    const duration: Record<string, number> = { card: 430, damage: 210, weapon: 260, shield: 170, death: 410, burn: 230, enemy: 380, round: 360, info: 65, echo: 400, victory: 750, defeat: 750 };
    for (const next of result.frames) {
      if (token !== playback.current) return;
      setGame(next.state); setFrame(next);
      if (next.kind === 'damage') sound(next.suit === 'flame' ? 'flame' : 'strike', preferences.sound);
      if (next.kind === 'burn') sound('flame', preferences.sound);
      if (next.kind === 'death') sound('death', preferences.sound);
      if (next.kind === 'card') sound('draw', preferences.sound);
      if (next.kind === 'enemy') sound(next.value ? 'strike' : 'shield', preferences.sound);
      if (next.kind === 'echo') sound('combo', preferences.sound);
      if (next.kind === 'shield') sound('shield', preferences.sound);
      await new Promise(resolve => setTimeout(resolve, preferences.reduced ? 25 : (duration[next.kind] || 120) / preferences.speed));
    }
    if (token !== playback.current) return;
    const next = beginNextRound(result.state); setGame(next); setFrame(null);
    setSelected([]); setKeep(undefined); setFrenzy(false); setTarget(undefined);
    setBusy(false); busyRef.current = false;
    if (next.status !== 'playing') { sound(next.status === 'won' ? 'win' : 'bell', preferences.sound); setModal('result'); }
  }
  function restart(newSeed = false) {
    playback.current++; busyRef.current = false;
    setGame(createCombat(newSeed ? (Date.now() >>> 0) : 7));
    setSelected([]); setTarget(undefined); setLane(1); setKeep(undefined); setFrenzy(false); setSwapMode(false); setSwapIds([]); setBusy(false); setFrame(null); setModal(null);
    notify('灯火重燃。新的长夜，新的选择。');
  }
  useEffect(() => {
    function keyboard(e: KeyboardEvent) {
      if (modal || e.repeat || e.altKey || e.ctrlKey || e.metaKey || (e.target as HTMLElement)?.closest('input, textarea, select')) return;
      if (/^[1-6]$/.test(e.key)) { const card = game.hand[Number(e.key) - 1]; if (card) selectCard(card.uid); }
      if (e.code === 'Space') { e.preventDefault(); void playRound(); }
      if (e.key.toLowerCase() === 'r') swapCards();
      if (e.key.toLowerCase() === 'h') setModal('help');
      if (e.key === 'Escape') { setSelected([]); setSwapMode(false); setSwapIds([]); }
    }
    window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard);
  });

  function enemyButton(enemy: Enemy, back = false) {
    const def = ENEMIES[enemy.id];
    const selectable = legalTargets(game).some(e => e.uid === enemy.uid);
    const focused = target ? target === enemy.uid : enemy.lane === lane && living(game, lane)[0]?.uid === enemy.uid;
    const struck = frame?.target === enemy.uid && ['damage', 'burn'].includes(frame.kind);
    const acting = game.intentIds.includes(enemy.uid);
    return <button key={enemy.uid} data-entity={enemy.uid} className={`enemy ${back ? 'enemy-back' : ''} ${focused ? 'focused' : ''} ${struck ? 'struck' : ''} ${enemy.hp <= 0 ? 'enemy-dying' : ''} enemy-${def.art}`} aria-label={`${def.name}，生命${enemy.hp}，${selectable ? '可选为目标' : '受守卫保护'}，${acting ? `攻击${enemy.attack}` : '本轮不行动'}`}
      disabled={!canAct || !selectable} onClick={() => { setTarget(enemy.uid); setLane(enemy.lane); sound('select', preferences.sound); }} title={`${def.note} · 护甲 ${enemy.armor}`}>
      <div className={`enemy-intent ${enemy.attack === 0 ? 'passive' : ''}`}>{acting && enemy.attack ? <><Swords size={13} /><b>{enemy.attack}</b></> : <><Wind size={13} /><span>{enemy.attack ? '待机' : '爆裂'}</span></>}</div>
      <div key={struck ? `hit-${game.log.at(-1)?.id}` : enemy.uid} className="enemy-portrait" style={{ backgroundImage: `url(/assets/enemy-${def.art}.webp)` }} />
      {struck && <span key={`slash-${game.log.at(-1)?.id}`} className={`impact-slash slash-${frame.suit || 'blade'}`} aria-hidden="true"><i /><i /></span>}
      <div className="enemy-focus-corners" /><div className="enemy-ground" />
      {focused && <span className="focus-label"><Crosshair size={12} /> 集火目标</span>}
      <div className="enemy-details"><h3>{def.name}{enemy.armor > 0 && <span className="armor-pill"><Shield size={11} />{enemy.armor}</span>}</h3>
        <div className="enemy-health"><span style={{ width: `${enemy.hp / enemy.maxHp * 100}%` }} /></div><div className="enemy-health-value">{enemy.hp}<span> / {enemy.maxHp}</span>{enemy.burn > 0 && <em><Flame size={10} />{enemy.burn}</em>}</div>
      </div>
      {struck && <span className={`floating-damage ${frame.suit === 'flame' ? 'fire-damage' : ''}`} key={game.log.at(-1)?.id}>−{frame.value}</span>}
    </button>;
  }

  const closeModal = () => setModal(null);
  return <div className={`app ${preferences.reduced ? 'reduce-motion' : ''} ${frenzy ? 'frenzy-armed' : ''}`}>
    <div className="scene-background" aria-hidden="true" /><div className="scene-vignette" aria-hidden="true" />
    <div className="mist mist-one" aria-hidden="true" /><div className="mist mist-two" aria-hidden="true" />
    <Atmosphere reduced={preferences.reduced} enabled={preferences.particles} frame={frame} />
    <header className="topbar">
      <a className="brand" href="#" onClick={e => { e.preventDefault(); closeModal(); }} aria-label="永夜回响战场"><Mark /><div><strong>永夜回响</strong><span>ECHOES OF ETERNAL NIGHT</span></div></a>
      <nav aria-label="主导航"><button className={!modal ? 'nav-active' : ''} onClick={closeModal}><Swords size={16} />战场</button><button className={modal === 'map' ? 'nav-active' : ''} onClick={() => setModal('map')}><Map size={16} />永夜行记</button><button className={modal === 'library' ? 'nav-active' : ''} onClick={() => setModal('library')}><BookOpen size={16} />藏牌室</button></nav>
      <div className="header-tools"><span className="chapter-badge"><Moon size={14} /> 第一章 <span> / </span> 迷雾墓园</span><span className="gold-count"><Coins size={17} /><b data-testid="coins">{game.coins}</b></span><span className="header-divider" />
        <button className={`icon-button ${preferences.sound ? 'tool-active' : ''}`} onClick={() => { const enabled = !preferences.sound; setPreferences(p => ({ ...p, sound: enabled })); sound('bell', enabled); }} aria-label={preferences.sound ? '关闭音效' : '开启音效'} title={preferences.sound ? '关闭音效' : '开启音效'}>{preferences.sound ? <Volume2 size={18} /> : <VolumeX size={18} />}</button>
        <button className="icon-button" onClick={() => setModal('settings')} aria-label="设置"><Settings2 size={18} /></button>
      </div>
    </header>

    <main>
      <section className="location-row"><div><div className="eyebrow"><span className="tiny-line" /> CHAPTER I · THE FORSAKEN</div><h1>灰烬墓园<span>普通遭遇</span></h1><p>钟声未止，长夜未明。</p></div>
        <div className="encounter-progress"><span>迷雾墓园</span><div className="route-dots">{Array.from({ length: 7 }, (_, i) => <span key={i} className={i === 0 ? 'current' : ''}>{i === 0 ? <Swords size={12} /> : i === 6 ? <Skull size={12} /> : <i />}</span>)}</div><button className="text-button" onClick={() => setModal('map')}>查看行程 <ArrowRight size={13} /></button></div>
      </section>

      <div className="battle-layout">
        <aside className="player-column">
          <section className={`player-status ${frame?.target === 'player' && frame.kind === 'enemy' ? 'player-hit' : ''}`} data-entity="player" aria-label="玩家状态">
            <div className="player-heading"><div className="player-emblem"><Moon size={24} strokeWidth={1} /><span>Ⅰ</span></div><div><span className="mini-label">THE NIGHT WATCHER</span><h2>守夜人</h2></div><span className="level-label">Lv. 1</span></div>
            <div className="resource-label"><span><Heart size={13} /> 生命</span><b data-testid="player-hp">{game.hp}<small> / {game.maxHp}</small></b></div><div className="health-bar"><span style={{ width: `${game.hp / game.maxHp * 100}%` }} /></div>
            <div className="sub-resources"><span><Shield size={13} />护盾 <b data-testid="player-shield">{game.shield}</b><small>/40</small></span><span title="当前累计经验"><Sparkles size={13} />经验 <b>{game.xp}</b></span></div>
          </section>
          <section className="weapon-section"><div className="section-caption"><span>共鸣武器</span><span>02 <i>/ 04</i></span></div>
            {(['blade', 'bone'] as const).map((suit, i) => <button key={suit} className={`weapon-row ${frame?.suit === suit && (frame.kind === 'weapon' || frame.kind === 'echo') ? 'weapon-active' : ''}`} onClick={() => { setRelicView(suit); setModal('relic'); }}>
              <div className={`weapon-art weapon-${suit}`} style={{ backgroundImage: `url(/assets/card-${suit === 'blade' ? 'blade' : 'shield'}.webp)` }} /><div><h3>{SUITS[suit].weapon}<span>Ⅰ</span></h3><p>{suit === 'blade' ? '连射 · 6 × 2' : '护盾 4 · 伤害 4'}</p></div><span className="weapon-order">0{i + 1}</span>
            </button>)}
            <div className="empty-weapons"><span><span>＋</span>未装备</span><span><span>＋</span>未装备</span></div>
          </section>
          <section className="relic-section"><div className="section-caption"><span>随行遗物</span><span>01 <i>/ 05</i></span></div><div className="relic-slots"><button title="磨刀石" onClick={() => { setRelicView('relic'); setModal('relic'); }} className={formation.whetstone ? 'relic-triggered' : ''}><Gem size={22} strokeWidth={1.25} /></button>{[1, 2, 3, 4].map(i => <span key={i}><Diamond size={11} strokeWidth={1} /></span>)}</div><p className="relic-note">磨刀石 <span>{formation.whetstone ? '共鸣已激活 · 倍率 +0.30' : '两张刃牌，唤醒锋芒。'}</span></p></section>
          <button className="guide-link" onClick={() => setModal('help')}><CircleHelp size={15} /><span>初入永夜？</span><ArrowRight size={14} /></button>
        </aside>

        <section className={`battlefield ${busy ? 'is-playing' : ''}`} ref={arenaRef} aria-label="三路战场" onPointerMove={e => {
          if (preferences.reduced || e.pointerType === 'touch') return;
          const r = e.currentTarget.getBoundingClientRect();
          e.currentTarget.style.setProperty('--scene-x', `${((e.clientX - r.left) / r.width - .5) * 8}px`);
          e.currentTarget.style.setProperty('--scene-y', `${((e.clientY - r.top) / r.height - .5) * 4}px`);
        }} onPointerLeave={e => { e.currentTarget.style.setProperty('--scene-x', '0px'); e.currentTarget.style.setProperty('--scene-y', '0px'); }}>
          <div className="compact-battle-tools"><span title="当前预告伤害"><Swords size={11} />来袭 {totalIntent}</span><button aria-label={game.rung ? '钟声已响' : '提前敲钟'} disabled={!canAct || game.rung || !pendingWaves.length} onClick={() => setModal('bell')}><Bell size={12} />{game.rung ? '钟声已响' : '敲钟引潮'}</button></div>
          <div className="round-label"><span className="round-line" /><div><span>ROUND</span><strong>{String(game.round).padStart(2, '0')}</strong></div><span className="round-line" /></div>
          <div className="battle-stage"><div className="ritual-floor" aria-hidden="true"><span /><span /><span /></div>
            {([0, 1, 2] as Lane[]).map((l, i) => {
              const all = game.enemies.filter(e => e.lane === l && ((!e.dead && e.hp > 0) || (e.uid === frame?.target && ['damage', 'burn', 'death'].includes(frame.kind))));
              return <div key={l} className={`lane lane-${l} ${lane === l ? 'lane-selected' : ''}`}>
                <button className="lane-title" onClick={() => { if (canAct) { setLane(l); setTarget(undefined); } }} disabled={!canAct}><span>{['左', '中', '右'][i]} 路</span>{lane === l && <Crosshair size={11} />}</button>
                <div className="lane-enemies">{all.slice(0, 2).reverse().map(e => enemyButton(e, all.indexOf(e) !== 0))}{!all.length && <div className="cleared-lane"><Wind size={30} strokeWidth={.7} /><span>迷雾暂退</span></div>}</div>
                {all.length > 2 && <button className="queue-more" onClick={() => setModal('log')}>后方还有 {all.length - 2} 名敌人</button>}
              </div>;
            })}
          </div>
          <div className="stage-status">{busy ? <span key={game.log.at(-1)?.id} className={`live-event event-${frame?.kind}`}><Sparkles size={13} />{frame?.text}</span> : <><span className="status-light" />{game.status === 'playing' ? '你的回合' : game.status === 'won' ? '战斗胜利' : '长夜降临'}<i />{game.status === 'playing' ? '编排手牌，奏响回击' : '每一次回响，都曾照亮长夜'}</>}</div>
        </section>

        <aside className="encounter-column"><section className="wave-panel"><div className="section-caption"><span>暗潮涌动</span><span>波次 <b>{game.waves.filter(w => w.entered).length}</b> / 3</span></div>
          <div className="wave-track">{game.waves.map((w, i) => <div key={i} className={w.entered ? 'wave-entered' : ''}><span>{w.entered ? <Flame size={12} /> : <Diamond size={10} />}</span><small>{['初临', '逼近', '群潮'][i]}</small></div>)}</div>
          <div className="incoming"><div><Wind size={14} /><span>{pendingWaves.length ? '下一波预告' : '全部波次已入场'}</span><small>{pendingWaves.length ? `第 ${pendingWaves[0].round} 轮` : '最终清场'}</small></div><p>{pendingWaves.length ? pendingWaves[0].units.map(u => ENEMIES[u.id].name).filter((v, i, a) => a.indexOf(v) === i).join(' · ') : '消灭余下敌人，穿过这片墓园。'}</p></div>
          <button className="bell-button" aria-label={game.rung ? '钟声已响' : '提前敲钟'} disabled={!canAct || game.rung || !pendingWaves.length} onClick={() => setModal('bell')}><Bell size={16} /><span>{game.rung ? '钟声已响' : '提前敲钟'}</span><span aria-hidden="true">＋</span></button><p className="bell-note">{game.rung ? '胜利额外获得 12 金币 / 4 经验' : '唤来下一波，换取更丰厚的战利品'}</p>
        </section>
        <section className="intent-panel"><div className="section-caption"><span>敌方意图</span><Eye size={13} /></div><div className="intent-total"><Swords size={20} strokeWidth={1.2} /><strong>{totalIntent}</strong><span>预告伤害</span></div><p>只有存活且已预告的敌人会行动。</p></section>
        <section className="battle-log"><div className="section-caption"><span>回响记录</span><button className="icon-button" aria-label="展开战斗记录" onClick={() => setModal('log')}><ScrollText size={14} /></button></div><div className="log-lines">{game.log.slice(-3).map(entry => <p key={entry.id} className={`log-${entry.kind}`}><span>·</span>{entry.text}</p>)}</div></section>
        </aside>
      </div>

      <section className="orchestration" aria-label="三拍编排">
        <div className="echo-meter"><div className={`echo-orb ${game.echo >= 12 ? 'echo-ready' : ''}`}><Sigil3D reduced={preferences.reduced} active={game.echo >= 12} /><div><b data-testid="echo-count">{game.echo}</b><span>/ 12</span></div></div><div className="echo-copy"><h3>回响</h3><button disabled={!canAct || game.echo < 12} className={frenzy ? 'frenzy-selected' : ''} aria-pressed={frenzy} onClick={() => { setFrenzy(v => !v); sound('bell', preferences.sound); }}><Zap size={12} />{frenzy ? '狂奏已蓄势' : game.echo >= 12 ? '发动狂奏' : '蓄满可发动狂奏'}</button></div></div>
        <div className="three-beats">{[0, 1, 2].map(i => {
          const c = selectedCards[i];
          return <div key={i} className={`beat-slot ${c ? 'filled' : ''} ${busy && frame?.beat === i ? 'beat-playing' : ''}`} onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }} onDrop={e => dropCard(e, i)}>
            <div className="beat-number">{['I', 'II', 'III'][i]}</div>
            {c ? <><button className="beat-card" draggable={!busy} onDragStart={e => e.dataTransfer.setData('text/plain', selected[i])} disabled={busy} onClick={() => selectCard(selected[i])}><SuitIcon suit={c.suit} size={17} /><span>{c.name}</span><small>{c.rank}阶</small><X size={10} /></button><div className="beat-reorder"><button disabled={busy || i === 0} aria-label={`将第${i + 1}拍前移`} onClick={() => setSelected(ids => { const a = [...ids]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; return a; })}><ChevronLeft size={10} /></button><span>{SUITS[c.suit].name}印共鸣</span><button disabled={busy || i === selected.length - 1} aria-label={`将第${i + 1}拍后移`} onClick={() => setSelected(ids => { const a = [...ids]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; return a; })}><ChevronRight size={10} /></button></div></> : <div className="beat-placeholder"><span>选择或拖入手牌</span><small>空拍获得 3 护盾</small></div>}
          </div>;
        })}<span className="beat-arrow"><ChevronRight size={19} strokeWidth={1} /></span></div>
        <div className={`formation-summary ${selected.length === 3 ? 'formation-complete' : ''}`}><span className="mini-label">本轮牌阵</span><div><h3>{formation.name}</h3><strong>×{formation.multiplier.toFixed(2)}</strong></div><p>{formation.shield ? <><Shield size={11} />三不同印 · 护盾 +8</> : formation.sameSuit ? <><Sparkles size={11} />三同印 · 终奏返场</> : formation.whetstone ? <><Gem size={11} />磨刀石 · 倍率 +0.30</> : '数字定倍率，印记唤共鸣'}</p></div>
        <div className="play-action"><button className="primary-button play-button" aria-label={busy ? "正在结算" : "奏响三拍"} disabled={!canAct || swapMode} onClick={() => void playRound()}><span className="button-flourish">◇</span><span>{busy ? '回响奏鸣中' : '奏响三拍'}</span><ArrowRight size={17} /></button><span>{busy ? '命运正在展开…' : <>{selected.length} / 3 已编排 <i>·</i> <kbd>SPACE</kbd> 结算</>}</span></div>
      </section>

      <section className="hand-area" aria-label="手牌">
        <div className="hand-heading"><span><Layers3 size={14} />你的手牌 <b>{game.hand.length}</b><i> / 6</i></span><p>{swapMode ? `选择要换出的牌 · ${swapIds.length} / ${Math.min(4, 2 + game.swapBonus)}` : '每张牌都是一句低语，三拍汇成你的命运。'}</p><button className="text-button" onClick={() => setModal('help')}>牌阵指引 <CircleHelp size={13} /></button></div>
        <div className="hand-content"><button className="deck-pile draw-pile" onClick={() => setModal('draw')} aria-label={`查看抽牌堆，${game.draw.length}张`}><div className="deck-back"><Mark /><span>{game.draw.length}</span></div><div>抽牌堆 <Layers3 size={12} /></div></button>
          <div className="hand-cards">{game.hand.map((instance, i) => <GameCard key={instance.uid} card={CARDS[instance.id]} index={i} selected={selected.includes(instance.uid)} order={selected.indexOf(instance.uid) + 1} swap={swapIds.includes(instance.uid)} kept={keep === instance.uid} disabled={!canAct} reduced={preferences.reduced} audioEnabled={preferences.sound}
            onSelect={() => selectCard(instance.uid)} onInspect={() => { setInspect(CARDS[instance.id]); setModal('inspect'); }} onKeep={() => { setKeep(value => value === instance.uid ? undefined : instance.uid); sound('select', preferences.sound); }} onDrag={e => e.dataTransfer.setData('text/plain', instance.uid)} />)}
            {game.status !== 'playing' && <div className="hand-result"><Moon size={30} /><h3>{game.status === 'won' ? '这一夜，你守住了灯火。' : '灯灭了，回响还在。'}</h3><button className="text-button" onClick={() => setModal('result')}>查看战果 <ArrowRight size={14} /></button></div>}
          </div>
          <div className="hand-right"><button className={`exchange-button ${swapMode ? 'exchange-active' : ''}`} aria-label={game.swapped ? '已换牌' : swapMode ? swapIds.length ? `确认换牌 ${swapIds.length}` : '取消换牌' : '换牌'} disabled={!canAct || game.swapped} onClick={swapCards}><RotateCcw size={17} /><span>{game.swapped ? '已换牌' : swapMode ? swapIds.length ? `确认换牌 ${swapIds.length}` : '取消换牌' : '换牌'}</span><kbd>R</kbd></button><span className="exchange-note">{game.swapped ? '本轮机会已用完' : `每轮 1 次 · 最多 ${Math.min(4, 2 + game.swapBonus)} 张`}</span>
            <button className="discard-pile" onClick={() => setModal('discard')} aria-label={`查看弃牌堆，${game.discard.length}张`}><Layers3 size={24} strokeWidth={1} /><b>{game.discard.length}</b><span>弃牌堆</span></button>
          </div>
        </div>
      </section>
    </main>
    <footer><span className="footer-motto"><span>◆</span> 以微光，对抗永夜。</span><span className="keyboard-hints"><kbd>1–6</kbd> 选牌 <i /> 拖动调整顺序 <i /> <Bookmark size={11} /> 保留一张手牌</span><span className="save-indicator"><span className={saved ? 'saved-dot' : 'unsaved-dot'} />{busy ? '回合结算中' : saved ? '旅程已保存' : '存储不可用'}</span></footer>
    <div className="sr-only" role="status" aria-live="polite">{notice || (frame?.kind === 'card' || frame?.kind === 'round' ? frame.text : '')}</div>
    {notice && <div className="toast"><Sparkles size={15} />{notice}<button aria-label="关闭提示" onClick={() => setNotice('')}><X size={13} /></button></div>}
    {modal && <Dialog title={modal === 'library' ? '藏牌室' : modal === 'map' ? '永夜行记' : modal === 'help' ? '三拍，唤醒回响' : modal === 'settings' ? '长夜设置' : modal === 'bell' ? '要让钟声提前响起吗' : modal === 'log' ? '回响记录' : modal === 'draw' ? '抽牌堆' : modal === 'discard' ? '弃牌堆' : modal === 'inspect' ? inspect.name : modal === 'restart' ? '重新点亮灯火' : modal === 'result' ? game.status === 'won' ? '长夜暂歇' : '灯火熄灭' : relicView === 'relic' ? '磨刀石' : SUITS[relicView].weapon} onClose={closeModal} wide={['library', 'map', 'help'].includes(modal)}>
      {modal === 'help' && <div className="help-content"><p className="dialog-lead">你不必快。想好这三张牌，剩下的交给回响。</p><div className="help-steps">{[{ icon: Layers3, title: '编排三拍', text: '点击手牌，或拖到上方牌位。最多选择三张，点击已选牌可以取消；箭头和拖动可以调整顺序。空拍获得 3 护盾。' }, { icon: Swords, title: '牌与武器共鸣', text: '每张牌先执行自身效果，再让同印记的已装备武器主奏。三拍之后，回旋刃和骨卫依次终奏。' }, { icon: Sparkles, title: '让组合改变战局', text: '三不同印在锁牌时获得 8 护盾。三同印在终奏后追加对应武器的伤害回声。满 12 回响可手动发动狂奏。' }].map((item, i) => <div key={item.title}><span>0{i + 1}</span><item.icon size={25} strokeWidth={1} /><h3>{item.title}</h3><p>{item.text}</p></div>)}</div><div className="formation-guide">{[['散牌', '任意组合 / 不足三张', '×1.00'], ['对子', '两张相同牌阶', '×1.20'], ['顺阶', '三个连续牌阶', '×1.50'], ['三同号', '三张相同牌阶', '×1.80']].map(([name, rule, value]) => <div key={name}><h4>{name}</h4><span>{rule}</span><b>{value}</b></div>)}</div><p className="help-footnote">牌阵倍率只放大武器伤害。护盾在下一轮清零；可用卡牌书签保留一张未用牌。第 7 轮起，灰潮每轮直接造成递增生命伤害。</p><button className="primary-button" onClick={closeModal}>我已准备好 <ArrowRight size={16} /></button></div>}
      {modal === 'library' && <><p className="dialog-lead">守夜人的起始藏牌 · 每种两张，共十二张</p><div className="library-controls"><div className="filter-buttons">{(['all', 'blade', 'flame', 'bone', 'mirror'] as const).map(s => <button className={filter === s ? 'active' : ''} key={s} onClick={() => setFilter(s)}>{s === 'all' ? '全部' : <><SuitIcon suit={s} size={13} />{SUITS[s].name}印</>}</button>)}</div><label className="search-field"><Search size={15} /><input placeholder="寻找一张牌…" value={query} onChange={e => setQuery(e.target.value)} /></label></div><div className="library-grid">{Object.values(CARDS).filter(c => (filter === 'all' || c.suit === filter) && (c.name + c.description).includes(query)).map(card => <GameCard key={card.id} card={card} reduced={preferences.reduced} onInspect={() => { setInspect(card); setModal('inspect'); }} />)}</div>{Object.values(CARDS).filter(c => (filter === 'all' || c.suit === filter) && (c.name + c.description).includes(query)).length === 0 && <p className="empty-message">迷雾中没有找到这张牌。</p>}</>}
      {modal === 'map' && <><p className="dialog-lead">第一章 · 迷雾墓园<span className="map-caption">当前可探索：灰烬墓园</span></p><div className="journey-map">{[{ name: '灰烬墓园', type: '普通战', Icon: Swords }, { name: '无声长街', type: '普通战', Icon: Swords }, { name: '断头之庭', type: '精英 / 普通', Icon: Skull }, { name: '无声市场', type: '商店', Icon: Coins }, { name: '白骨回廊', type: '普通战', Icon: Swords }, { name: '最后的微光', type: '营火', Icon: Flame }, { name: '敲钟人', type: '首领战', Icon: Bell }].map((node, i) => <div className={`journey-node ${i === 0 ? 'current' : ''}`} key={node.name}><span className="node-number">0{i + 1}</span><div><node.Icon size={25} strokeWidth={1.1} /></div><h3>{node.name}</h3><span>{node.type}</span>{i === 0 ? <b>你在这里</b> : <small>尚未开放</small>}</div>)}</div><p className="help-footnote">前方的路仍隐没在雾中。先在墓园学会编排、共鸣与终奏。</p><button className="primary-button" onClick={closeModal}><ArrowLeft size={15} />返回战场</button></>}
      {modal === 'settings' && <div className="settings-list"><label><span><Volume2 size={18} /><b>战斗音效</b><small>低鸣、金属与钟声</small></span><input type="checkbox" checked={preferences.sound} onChange={e => { setPreferences(p => ({ ...p, sound: e.target.checked })); sound('bell', e.target.checked); }} /></label><label><span><Sparkles size={18} /><b>环境粒子</b><small>漂浮余烬与命中碎光</small></span><input type="checkbox" checked={preferences.particles} onChange={e => setPreferences(p => ({ ...p, particles: e.target.checked }))} /></label><label><span><Wind size={18} /><b>减少动态效果</b><small>关闭视差、持续动画与震动</small></span><input type="checkbox" checked={preferences.reduced} onChange={e => setPreferences(p => ({ ...p, reduced: e.target.checked }))} /></label><label className="volume-setting"><span>音量 {Math.round(preferences.volume * 100)}%</span><input aria-label="主音量" type="range" min="0" max="1" step="0.05" value={preferences.volume} onChange={e => setPreferences(p => ({ ...p, volume: Number(e.target.value) }))} /></label><div className="speed-setting"><span>结算速度</span>{[1, 2].map(n => <button key={n} className={preferences.speed === n ? 'active' : ''} onClick={() => setPreferences(p => ({ ...p, speed: n }))}>{n}×</button>)}</div><button className="secondary-button" disabled={busy} onClick={() => setModal('restart')}><RotateCcw size={15} />重新开始遭遇</button></div>}
      {modal === 'bell' && <><div className="large-modal-icon"><Bell size={42} strokeWidth={1} /></div><p className="dialog-lead">下一波敌人将立即进入战场，并可能在本轮行动。</p><div className="bell-preview">{pendingWaves[0]?.units.map((u, i) => <div key={i}><span>{['左', '中', '右'][u.lane]}路</span><b>{ENEMIES[u.id].name}</b><span><Heart size={12} />{ENEMIES[u.id].hp}</span></div>)}</div><div className="bell-reward"><Coins size={17} />胜利额外获得 <b>12 金币</b><span>＋</span><b>4 经验</b></div><p className="help-footnote">每场仅一次，敲钟后无法撤销，不会重抽手牌。</p><div className="dialog-actions"><button className="secondary-button" onClick={closeModal}>让他们再等一会</button><button className="primary-button" disabled={!canAct || game.rung || !pendingWaves.length} onClick={() => { try { setGame(ringBell(game)); setTarget(undefined); sound('bell', preferences.sound); closeModal(); } catch (error) { notify((error as Error).message); } }}><Bell size={15} />敲响古钟</button></div></>}
      {modal === 'log' && <><p className="dialog-lead">第 {game.round} 轮 · 每一道伤害，都有迹可循。</p><div className="full-log">{game.log.map(entry => <div key={entry.id} className={`log-${entry.kind}`}><span>{String(entry.id).padStart(3, '0')}</span><small>第 {entry.round} 轮</small><p>{entry.text}</p></div>)}</div></>}
      {(modal === 'draw' || modal === 'discard') && <><p className="dialog-lead">{modal === 'draw' ? '按名称查看剩余卡牌，抽取顺序仍藏在迷雾中。' : '弃牌堆将在抽牌堆耗尽后重新洗入。'}</p><div className="pile-list">{[...(modal === 'draw' ? game.draw : game.discard)].sort((a, b) => a.id.localeCompare(b.id)).map(c => <button key={c.uid} onClick={() => { setInspect(CARDS[c.id]); setModal('inspect'); }}><SuitIcon suit={CARDS[c.id].suit} /><b>{CARDS[c.id].name}</b><span>{CARDS[c.id].rank} 阶</span><ChevronRight size={14} /></button>)}</div>{!(modal === 'draw' ? game.draw : game.discard).length && <p className="empty-message">此处暂时空无一物。</p>}</>}
      {modal === 'inspect' && <div className="inspect-content"><GameCard card={inspect} reduced={preferences.reduced} /><blockquote>「{inspect.lore}」</blockquote><div className="inspect-details"><span><SuitIcon suit={inspect.suit} />{SUITS[inspect.suit].name}印 · {inspect.rank} 阶</span><p>{inspect.description}</p><p className="muted">{inspect.suit === 'blade' || inspect.suit === 'bone' ? `打出后，${SUITS[inspect.suit].weapon}额外主奏一次。` : `装备${SUITS[inspect.suit].weapon}后，可触发对应武器共鸣。`}</p></div></div>}
      {modal === 'restart' && <><p className="dialog-lead">当前遭遇的进度将被替换。你可以重新演绎同一个夜晚，也可以走入未知。</p><div className="dialog-actions"><button className="secondary-button" onClick={() => restart(false)}><RotateCcw size={15} />相同牌序重试</button><button className="primary-button" onClick={() => restart(true)}>新的随机牌序 <ArrowRight size={15} /></button></div></>}
      {modal === 'result' && <div className="result-content"><div className="result-emblem">{game.status === 'won' ? <Mark /> : <Moon size={62} strokeWidth={.8} />}</div><p className="dialog-lead">{game.status === 'won' ? '墓园重归寂静。你又为世界，守住了一缕微光。' : '每个失落的回响，都会成为下一次启程的路标。'}</p><div className="result-stats"><div><span>战斗轮数</span><b>{game.round}</b></div><div><span>剩余生命</span><b>{game.hp}</b></div><div><span>累计经验</span><b>{game.xp}</b></div></div>{game.status === 'won' && <div className="bell-reward"><Coins size={17} />战利品已入袋 <b>＋{game.rung ? 36 : 24} 金币</b></div>}<div className="dialog-actions"><button className="secondary-button" onClick={() => setModal('log')}>回顾这场战斗</button><button className="primary-button" onClick={() => restart(true)}>再入长夜 <ArrowRight size={15} /></button></div></div>}
      {modal === 'relic' && <div className="relic-detail"><div className="large-modal-icon">{relicView === 'relic' ? <Gem size={54} strokeWidth={1} /> : <SuitIcon suit={relicView} size={54} />}</div><span className="mini-label">{relicView === 'relic' ? '普通遗物 · 万刃轮进化媒介' : '基础武器 · 等级 I'}</span><p className="dialog-lead">{relicView === 'relic' ? '本轮编排至少两张刃牌时，武器伤害倍率 +0.30。' : relicView === 'blade' ? '连射两段，每段基础伤害 6。目标死亡后，后续伤害会自动转移。' : '先获得 4 护盾，再对单体造成 4 点基础伤害。'}</p><p className="help-footnote">{relicView === 'relic' ? '在牌阵锁定时判断。此加值会计入上方的本轮牌阵预览。' : '每张同印记卡牌触发一次共鸣；三拍结束后再终奏一次。护盾不受牌阵倍率放大，伤害按段向下取整。'}</p></div>}
    </Dialog>}
  </div>;
}
