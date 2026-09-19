import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronLeft, ChevronRight, Flame, Headphones, Moon, Pause, Play, RotateCcw, Settings2, Shield, Sparkles, Swords, Volume2, VolumeX, X } from 'lucide-react';
import OpeningAtmosphere from './OpeningAtmosphere';
import OpeningLightField from './OpeningLightField';
import { loadOpeningAssets } from './preload';
import { setAmbience, setAudioVolume, sound } from '../audio';

type Phase = 'loading' | 'ready' | 'entering' | 'prologue';
type Panel = 'archive' | 'settings' | null;
interface Preferences { sound: boolean; volume: number; reduced: boolean; particles: boolean }
const PREF_KEY = 'eternal-night-opening-settings-v1';
const ARCHIVE = [
  { numeral: 'I', name: '刃', title: '于寂静中，划开长夜', text: '旧日的锋刃仍记得主人的誓言。每一道寒光，都是尚未熄灭的意志。', art: 'blade', icon: Swords, color: '#d7bb84' },
  { numeral: 'II', name: '焰', title: '最后一缕火，也能照亮归途', text: '火种藏在灰烬之下，等待一次呼吸。不要让黑暗知道，你的手中还有光。', art: 'ember', icon: Flame, color: '#d89466' },
  { numeral: 'III', name: '骨', title: '亡者的骨，生者的墙', text: '有人长眠于此，也有人以白骨守住来时的路。身后的微光，值得你再站一刻。', art: 'shield', icon: Shield, color: '#b6c5b0' },
  { numeral: 'IV', name: '镜', title: '镜中的回响，比你先抵达', text: '破碎的镜面藏着未曾发生的命运。凝视它时，请记住，哪一个才是真正的你。', art: 'mirror', icon: Moon, color: '#99bdc6' },
];
const PROLOGUE = [
  { overline: 'PROLOGUE · THE LAST LIGHT', title: '最后一盏灯', lines: ['世界已经很久没有天亮。', '而你，仍记得光的模样。'], caption: '你从余烬中拾起灯，走向钟声传来的地方。' },
  { overline: 'CHAPTER I · THE FORSAKEN', title: '迷雾墓园', lines: ['石门之后，亡者仍在低语。', '每一步，都唤醒一段被遗忘的回响。'], caption: '刃、焰、骨、镜。四枚印记，四种对抗长夜的方式。' },
  { overline: 'THE NIGHT REMEMBERS', title: '以微光，对抗永夜', lines: ['不必知道长夜的尽头。', '先守住，眼前这一缕光。'], caption: '你的故事，由此启程。' },
];

function loadPreferences(): Preferences {
  const explicitMotion = new URLSearchParams(location.search).get('motion') === 'on';
  const defaults = { sound: false, volume: .55, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, particles: true };
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
    return {
      sound: typeof p.sound === 'boolean' ? p.sound : false,
      volume: typeof p.volume === 'number' && p.volume >= 0 && p.volume <= 1 ? p.volume : .55,
      reduced: explicitMotion ? false : typeof p.reduced === 'boolean' ? p.reduced : defaults.reduced,
      particles: typeof p.particles === 'boolean' ? p.particles : true,
    };
  } catch { return { ...defaults, reduced: explicitMotion ? false : defaults.reduced }; }
}

function Crest({ compact = false }: { compact?: boolean }) {
  return <svg className={`opening-crest ${compact ? 'crest-compact' : ''}`} viewBox="0 0 80 96" fill="none" aria-hidden="true">
    <path d="M40 3 71 48 40 93 9 48Z" stroke="currentColor" strokeWidth=".75" />
    <path d="M40 14 63 48 40 82 17 48Z" stroke="currentColor" strokeWidth=".4" />
    <path d="M40 3v17m0 56v17M9 48h13m36 0h13" stroke="currentColor" />
    <path d="M49 29a20 20 0 1 0 0 36 24 24 0 0 1 0-36Z" fill="currentColor" />
    <path d="m42 37 3 10 9 2-9 2-3 10-3-10-9-2 9-2Z" fill="currentColor" />
    <circle cx="40" cy="8" r="2" fill="currentColor" />
  </svg>;
}

function Overlay({ title, eyebrow, children, onClose, wide = false }: { title: string; eyebrow: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return <dialog className={`opening-dialog ${wide ? 'opening-dialog-wide' : ''}`} ref={ref} aria-label={title}
    onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="opening-dialog-inner">
      <button className="opening-icon opening-dialog-close" aria-label="关闭窗口" onClick={onClose}><X size={19} /></button>
      <p className="opening-overline">{eyebrow}</p><h2>{title}</h2><div className="opening-divider"><span>✧</span></div>
      {children}
    </div>
  </dialog>;
}

export default function Opening() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [progress, setProgress] = useState(0);
  const [failures, setFailures] = useState<string[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [preferences, setPreferences] = useState(loadPreferences);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [archive, setArchive] = useState(0);
  const [chapter, setChapter] = useState(0);
  const [hint, setHint] = useState(0);
  const [cinema, setCinema] = useState(false);
  const [backgroundHidden, setBackgroundHidden] = useState(() => document.hidden);
  const root = useRef<HTMLDivElement>(null);
  const enterButton = useRef<HTMLButtonElement>(null);
  const prologueTitle = useRef<HTMLHeadingElement>(null);
  const cinemaButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const entered = phase === 'entering' || phase === 'prologue';

  useEffect(() => {
    const visibility = () => setBackgroundHidden(document.hidden);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pageshow', visibility);
    window.addEventListener('focus', visibility);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pageshow', visibility);
      window.removeEventListener('focus', visibility);
    };
  }, []);

  useEffect(() => {
    // The explicit play link applies once; subsequent choices continue to be remembered.
    const url = new URL(location.href);
    if (url.searchParams.get('motion') === 'on') {
      url.searchParams.delete('motion');
      history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    }
  }, []);

  useEffect(() => {
    setPhase('loading'); setProgress(0); setFailures([]);
    return loadOpeningAssets(state => {
      setProgress(state.percent); setFailures(state.failures);
      if (state.complete) setPhase('ready');
    });
  }, [attempt]);

  useEffect(() => {
    if (phase !== 'entering') return;
    const timer = setTimeout(() => setPhase('prologue'), preferences.reduced ? 40 : 1500);
    return () => clearTimeout(timer);
  }, [phase, preferences.reduced]);

  useEffect(() => { if (phase === 'prologue') prologueTitle.current?.focus({ preventScroll: true }); }, [phase]);
  useEffect(() => { if (cinema) cinemaButton.current?.focus({ preventScroll: true }); }, [cinema]);
  useEffect(() => {
    if (!restoreFocus.current || cinema || phase === 'entering') return;
    const frame = requestAnimationFrame(() => {
      restoreFocus.current = false;
      (phase === 'prologue' ? prologueTitle.current : enterButton.current)?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [cinema, phase]);
  useEffect(() => {
    if (preferences.reduced || panel || entered) return;
    const timer = setInterval(() => { if (!document.hidden) setHint(i => (i + 1) % 3); }, 8500);
    return () => clearInterval(timer);
  }, [preferences.reduced, panel, entered]);
  useEffect(() => {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(preferences)); } catch { /* Preferences are optional. */ }
    setAudioVolume(preferences.sound && audioUnlocked ? preferences.volume : 0);
  }, [preferences, audioUnlocked]);
  useEffect(() => {
    const update = () => setAmbience(preferences.sound && audioUnlocked && !document.hidden);
    update(); document.addEventListener('visibilitychange', update);
    return () => { document.removeEventListener('visibilitychange', update); setAmbience(false); };
  }, [preferences.sound, audioUnlocked]);

  function playTone(kind: Parameters<typeof sound>[0] = 'select') {
    if (!preferences.sound || (kind === 'hover' && !audioUnlocked)) return;
    setAudioVolume(preferences.volume); setAudioUnlocked(true); sound(kind, true);
  }
  function toggleAudio() {
    const enabled = !preferences.sound;
    setPreferences(p => ({ ...p, sound: enabled }));
    if (enabled) { setAudioUnlocked(true); setAudioVolume(preferences.volume); sound('bell', true); }
  }
  function enter() {
    if (phase !== 'ready' || failures.length || panel) return;
    playTone('bell'); setChapter(0); setCinema(false); setPhase('entering');
  }
  function backToTitle() {
    restoreFocus.current = true;
    setPhase('ready'); setChapter(0); setCinema(false); playTone('select');
  }
  function openPanel(value: Panel) { playTone(); setPanel(value); }
  function changeChapter(direction: number) {
    setChapter(n => Math.max(0, Math.min(PROLOGUE.length - 1, n + direction))); playTone('combo');
  }
  function leaveCinema() {
    restoreFocus.current = true;
    setCinema(false);
  }
  useEffect(() => {
    function keydown(e: KeyboardEvent) {
      if (panel || e.repeat || e.metaKey || e.altKey || e.ctrlKey || (e.target as HTMLElement).closest('input,select,textarea')) return;
      if (e.code === 'Enter' && phase === 'ready' && !cinema && !(e.target as HTMLElement).closest('button,a')) { e.preventDefault(); enter(); }
      if (e.code === 'Space' && phase === 'prologue' && !cinema && !(e.target as HTMLElement).closest('button')) { e.preventDefault(); chapter < 2 ? changeChapter(1) : (location.hash = '/world'); }
      if (e.key === 'ArrowRight' && phase === 'prologue' && !cinema) { e.preventDefault(); changeChapter(1); }
      if (e.key === 'ArrowLeft' && phase === 'prologue' && !cinema) { e.preventDefault(); changeChapter(-1); }
      if (e.key === 'Escape' && (cinema || phase === 'prologue')) { e.preventDefault(); if (cinema) leaveCinema(); else backToTitle(); }
    }
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  });

  const hints = ['长夜会吞噬一切，唯有回响不会消散。', '将微光留在掌心，将命运握在手中。', '每一张牌，都记得一个未竟的故事。'];
  const selectedArchive = ARCHIVE[archive];
  const SelectedIcon = selectedArchive.icon;
  return <div ref={root} className={`opening-root opening-${phase} ${preferences.reduced ? 'opening-reduced' : ''} ${cinema ? 'opening-cinema' : ''} ${backgroundHidden || panel ? 'opening-background-paused' : ''}`} data-phase={phase}
    onPointerMove={e => {
      if (preferences.reduced || e.pointerType === 'touch') return;
      root.current?.style.setProperty('--pointer-x', String(e.clientX / innerWidth - .5));
      root.current?.style.setProperty('--pointer-y', String(e.clientY / innerHeight - .5));
    }} onPointerLeave={() => { root.current?.style.setProperty('--pointer-x', '0'); root.current?.style.setProperty('--pointer-y', '0'); }}>
    <div className="opening-environment" aria-hidden="true">
      <div className="opening-landscape"><div className="opening-scene-drift"><OpeningLightField reduced={preferences.reduced} paused={backgroundHidden || panel !== null} entering={entered} cinema={cinema} /></div></div>
      <div className="opening-world-shade" />
      <div className="opening-godray" /><div className="opening-moon-haze" />
      <div className="opening-watchman"><img src="/assets/threshold-watcher.webp" alt="" decoding="async" /><span className="opening-lantern-spill" /><span className="opening-lantern-glow" /><span className="opening-lantern-reflection" /></div>
      <div className="opening-fog opening-fog-near" /><div className="opening-fog opening-fog-far" />
      <div className="opening-ground-shade" />
    </div>
    <OpeningAtmosphere reduced={preferences.reduced} active={preferences.particles} entering={entered} />
    <div className="opening-grain" aria-hidden="true" /><div className="opening-edge" aria-hidden="true"><i /><i /><i /><i /></div>

    <header className="opening-header" inert={phase === 'entering' || cinema}>
      <button className="opening-brand" onClick={() => { if (phase === 'prologue') backToTitle(); }} aria-label="永夜回响序幕">
        <Crest compact /><span>永夜回响<small>ECHOES OF ETERNAL NIGHT</small></span>
      </button>
      <div className="opening-header-right"><span className="opening-edition"><i /> 序幕 <span>·</span> THE AWAKENING</span>
        <button className="opening-motion-toggle" aria-label={preferences.reduced ? '开启动态背景' : '暂停动态背景'} aria-pressed={!preferences.reduced} title={preferences.reduced ? '背景已静止，点击恢复动态' : '动态背景正在播放，点击暂停'} onClick={() => setPreferences(p => ({ ...p, reduced: !p.reduced }))}>
          {preferences.reduced ? <Play size={13} /> : <Pause size={13} />}<span>{preferences.reduced ? '开启动态' : '动态背景'}</span>
        </button>
        <button className="opening-icon" aria-label={preferences.sound ? '关闭环境音' : '开启环境音'} title={preferences.sound ? '关闭环境音' : '开启环境音'} onClick={toggleAudio}>{preferences.sound ? <Volume2 size={18} /> : <VolumeX size={18} />}</button>
        <button className="opening-icon" aria-label="画面与声音设置" onClick={() => openPanel('settings')}><Settings2 size={18} /></button>
      </div>
    </header>

    <main className="opening-main" inert={entered || cinema}>
      <div className="opening-kicker"><span /> A DARK FANTASY DECKBUILDING JOURNEY</div>
      <div className="opening-title-lockup"><div className="opening-title-ornament" aria-hidden="true"><span /><Crest /><span /></div>
        <p className="opening-title-en">ECHOES OF<br /><span>ETERNAL NIGHT</span></p>
        <h1>永夜回响</h1>
        <div className="opening-title-rule" aria-hidden="true"><i /><span>✧</span><i /></div>
      </div>
      <p className="opening-tagline">当最后一盏灯熄灭<br />你的选择，是黑暗中唯一的回响。</p>
      <div className="opening-menu">
        <button ref={enterButton} className="opening-enter" onClick={enter} onPointerEnter={() => playTone('hover')} disabled={phase !== 'ready' || failures.length > 0} aria-label={phase === 'loading' ? '正在载入' : '踏入永夜'}>
          <span className="opening-enter-ornament" aria-hidden="true">✧</span><span>{phase === 'loading' ? '唤醒回响' : '踏入永夜'}<small>{phase === 'loading' ? 'AWAKENING THE ECHOES' : 'BEGIN YOUR JOURNEY'}</small></span><ArrowRight size={22} strokeWidth={1} /><i className="opening-button-glint" aria-hidden="true" />
        </button>
        <div className="opening-secondary-menu"><button onClick={() => openPanel('archive')}><BookOpen size={14} strokeWidth={1.4} />永夜秘典</button><span /><button onClick={() => openPanel('settings')}><Settings2 size={14} strokeWidth={1.4} />旅途设置</button></div>
      </div>
      <div className="opening-seal-row" aria-label="四种印记">{ARCHIVE.map((seal, i) => <button key={seal.name} style={{ '--seal-color': seal.color } as CSSProperties} aria-label={`查看${seal.name}之印记`} onClick={() => { setArchive(i); openPanel('archive'); }} onPointerEnter={() => playTone('hover')}><seal.icon size={17} strokeWidth={1.05} /><span>{seal.name}</span></button>)}</div>
    </main>

    <div className="opening-world-label" aria-hidden="true"><div className="opening-world-coordinate">01 <span>/</span> THE THRESHOLD</div><span className="opening-world-line" /><span>长夜的彼岸，仍有微光。</span></div>
    <aside className="opening-chapter-marker" aria-label="序章"><span>序</span><i /><p>迷雾之门</p><small>THE GATE OF MIST</small></aside>

    <footer className="opening-footer" inert={entered || cinema}>
      <div className="opening-load-copy"><span className={`opening-load-symbol ${phase === 'ready' ? 'is-ready' : ''}`}>{phase === 'ready' ? <Check size={12} /> : <Sparkles size={13} />}</span><span>{failures.length ? '有一段回响未能抵达' : phase === 'ready' ? '长夜已至 · 静候启程' : '正在唤醒沉睡的世界'}</span><b>{String(progress).padStart(2, '0')}<small>%</small></b></div>
      <div className="opening-load-track" role="progressbar" aria-label="世界载入进度" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress}%` }} /><i style={{ left: `${progress}%` }} /></div>
      <div className="opening-footer-bottom"><div className="opening-loading-lore"><span aria-hidden="true">✧</span><p key={hint}>{hints[hint]}</p></div>
        {failures.length > 0 ? <button className="opening-retry" onClick={() => setAttempt(n => n + 1)}><RotateCcw size={13} />重新载入</button> : <button className="opening-headphones" onClick={toggleAudio}><Headphones size={13} /><span>{preferences.sound ? '正在聆听永夜' : '戴上耳机，听见永夜'}</span><i className={`opening-audio-bars ${preferences.sound && audioUnlocked ? 'playing' : ''}`}><i /><i /><i /><i /></i></button>}
      </div>
    </footer>

    <div className="opening-transition-veil" aria-hidden="true" />
    {phase === 'entering' && <div className="opening-entering-mark" aria-hidden="true"><Crest /><span>循着微光，走入长夜。</span></div>}
    {phase === 'prologue' && <section className="opening-prologue" aria-label="序章过场" inert={cinema}>
      <button className="opening-back" onClick={backToTitle}><ArrowLeft size={15} />返回序幕</button>
      <div className="opening-prologue-story" key={chapter}><p className="opening-overline">{PROLOGUE[chapter].overline}</p><span className="opening-prologue-numeral">{['I', 'II', 'III'][chapter]}</span><h2 ref={prologueTitle} tabIndex={-1}>{PROLOGUE[chapter].title}</h2><div className="opening-divider"><span>✧</span></div><p className="opening-prologue-lines">{PROLOGUE[chapter].lines.map(line => <span key={line}>{line}</span>)}</p><p className="opening-prologue-caption">{PROLOGUE[chapter].caption}</p></div>
      <div className="opening-prologue-controls"><button className="opening-icon" disabled={chapter === 0} onClick={() => changeChapter(-1)} aria-label="上一页序章"><ChevronLeft size={18} /></button><div className="opening-story-dots">{PROLOGUE.map((_, i) => <button key={i} aria-label={`序章第 ${i + 1} 页`} aria-pressed={chapter === i} onClick={() => { setChapter(i); playTone(); }}><i /></button>)}</div><button className="opening-prologue-next" onClick={() => chapter < 2 ? changeChapter(1) : (location.hash = '/world')}>{chapter < 2 ? '循光而行' : '进入主世界'}<ArrowRight size={15} /></button></div>
    </section>}

    {cinema && <button ref={cinemaButton} className="opening-exit-cinema" onClick={leaveCinema}><ArrowLeft size={14} />返回界面 <kbd>ESC</kbd></button>}
    {panel && <Overlay title={panel === 'archive' ? '永夜秘典' : '旅途设置'} eyebrow={panel === 'archive' ? 'THE FOUR ANCIENT SIGILS' : 'MAKE THE NIGHT YOUR OWN'} wide={panel === 'archive'} onClose={() => setPanel(null)}>
      {panel === 'archive' ? <div className="opening-archive"><nav className="opening-archive-tabs" aria-label="印记分类">{ARCHIVE.map((entry, i) => <button key={entry.name} aria-pressed={archive === i} onClick={() => { setArchive(i); playTone('select'); }}><entry.icon size={17} strokeWidth={1.3} /><span>{entry.name}之印记</span></button>)}</nav>
        <div className="opening-archive-content" key={archive}><div className="opening-archive-art"><img src={`/assets/card-${selectedArchive.art}.webp`} alt={`${selectedArchive.name}之印记原画`} /><span>{selectedArchive.numeral}</span></div><div className="opening-archive-text"><SelectedIcon size={29} strokeWidth={1} /><span className="opening-overline">SIGIL {selectedArchive.numeral}</span><h3>{selectedArchive.title}</h3><p>{selectedArchive.text}</p><div className="opening-archive-number">0{archive + 1}<span> / 04</span></div></div></div>
        <div className="opening-archive-paging"><button disabled={archive === 0} onClick={() => { setArchive(i => i - 1); playTone(); }}><ChevronLeft size={15} />上一印记</button><button disabled={archive === 3} onClick={() => { setArchive(i => i + 1); playTone(); }}>下一印记<ChevronRight size={15} /></button></div>
      </div> : <div className="opening-preferences">
        <label><span><Volume2 size={18} /><b>环境与交互音效</b><small>风声、低鸣与远处的古钟</small></span><input type="checkbox" checked={preferences.sound} onChange={toggleAudio} /></label>
        <label className="opening-volume"><span>主音量 <b>{Math.round(preferences.volume * 100)}%</b></span><input aria-label="主音量" type="range" min="0" max="1" step="0.05" value={preferences.volume} onChange={e => setPreferences(p => ({ ...p, volume: Number(e.target.value) }))} /></label>
        <label><span><Sparkles size={18} /><b>空气中的微光</b><small>分层余烬与漂浮灰尘</small></span><input type="checkbox" checked={preferences.particles} onChange={e => setPreferences(p => ({ ...p, particles: e.target.checked }))} /></label>
        <label><span><Moon size={18} /><b>减少动态效果</b><small>关闭景深视差、漂移与镜头推进</small></span><input type="checkbox" checked={preferences.reduced} onChange={e => setPreferences(p => ({ ...p, reduced: e.target.checked }))} /></label>
        <div className="opening-settings-actions"><button onClick={() => { setPanel(null); setCinema(true); }}><Moon size={14} />静赏长夜</button><button disabled={phase === 'loading' || phase === 'entering'} onClick={() => { setPanel(null); setAttempt(n => n + 1); }}><RotateCcw size={14} />重新载入</button></div>
      </div>}
    </Overlay>}
    <div className="opening-sr-only" role="status" aria-live="polite">{failures.length ? '部分图片载入失败，可以重新载入。' : phase === 'ready' ? '载入完成，可以踏入永夜。' : phase === 'prologue' ? PROLOGUE[chapter].title : ''}</div>
  </div>;
}
