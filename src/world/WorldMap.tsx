import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Lock, BookOpen, Gem, Droplets, Skull, Zap, ArrowLeft, ArrowRight, Check, ChevronRight, Compass, Crown, Flag, Flame, Footprints, HelpCircle, Home, LocateFixed, MapPin, Maximize, Minus, Mountain, Plus, RotateCcw, RotateCw, Snowflake, Sparkles, Sun, Trees, Volume2, VolumeX, Waves, Wind, X } from 'lucide-react';
import { footstep, setWorldAudio, setAudioVolume, sound } from '../audio';
import { advanceJourney, travelByBeacon, MAIN_SITES, BIOMES, DIRECTIONS, LANDMARKS, SAVE_KEY, TILE_MAP, TILES, findPath, parseSave, tileId, navigationTarget, SITE_SIZE, siteFootprint, discoverFauna, type Biome, type Landmark, type WorldSave } from './worldData';
import { SPECIES_BY_ID, HABITAT_LABEL, TEMPERAMENT_LABEL } from './faunaSpecies';
import { WorldScene } from './WorldScene';
import { parseQuality, QUALITY_KEY, type WorldQuality } from './WorldQuality';
import './world.css';
import './storybook.css';
import WorldMinimap from './WorldMinimap';
import WorldLocation from './WorldLocation';
import WorldJournal from './WorldJournal';
import WorldClock from './WorldClock';
import {WorldTime,CLOCK_KEY,parseTime} from './WorldTime';
import './world-readability.css';
import './world-nocturne.css';
import {REGION_ORDER,isRegionOpen,isTileSealed,tileRegion} from './worldRegions';
import {CHAPTERS,nextChapter,unlockRegion} from './worldProgression.ts';
import {RegionGate,WorldRoute} from './WorldProgression.tsx';

const ICONS = { grass: Flame, forest: Trees, desert: Sun, cliff: Mountain, snow: Snowflake, ocean: Waves, blood: Crown, fog: Wind, swamp:Droplets,volcano:Flame,crystal:Gem,waste:Skull };
function readSave() { try { return parseSave(localStorage.getItem(SAVE_KEY)); } catch { return parseSave(null); } }
function Dialog({ title, subtitle, children, close }: { title: string; subtitle: string; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; const previous = document.activeElement as HTMLElement | null; dialog?.showModal(); return () => { dialog?.close(); previous?.focus(); }; }, []);
  return <dialog className="world-dialog" ref={ref} aria-label={title} onCancel={e => { e.preventDefault(); close(); }} onClick={e => { if (e.target === e.currentTarget) close(); }}>
    <div className="world-dialog-inner"><header className="world-dialog-header"><div><p className="world-kicker">{subtitle}</p><h2>{title}</h2></div><button className="world-icon dialog-close" onClick={close} aria-label="关闭窗口"><X size={23} /></button></header><div className="world-dialog-body">{children}</div></div>
  </dialog>;
}
export default function WorldMap() {
  const [clock]=useState(()=>{try{return new WorldTime(parseTime(localStorage.getItem(CLOCK_KEY)));}catch{return new WorldTime();}});
  const host = useRef<HTMLDivElement>(null), scene = useRef<WorldScene | null>(null), labels = useRef(new Map<string, HTMLElement>());
  const [save, setSave] = useState<WorldSave>(readSave), saveRef = useRef(save);
  const [selected, setSelected] = useState(save.position), selectedRef = useRef(selected);
  const [walking, setWalking] = useState(false), walkingRef = useRef(false);
  const [ready, setReady] = useState(false), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const [panel, setPanel] = useState<'help' | 'atlas' | 'journal' | 'beacons' | 'route' | null>(null), [site, setSite] = useState<Landmark | null>(null);
  const [creature, setCreature] = useState<string | null>(null);
  const [sealed,setSealed]=useState<Biome|null>(null);
  const [missionIndex, setMissionIndex] = useState(0), [toast, setToast] = useState('');
  const [audioOn, setAudioOn] = useState(false), audioRef = useRef(false);
  const [reduced, setReduced] = useState(() => new URLSearchParams(location.search).get('motion') === 'on' ? false : matchMedia('(prefers-reduced-motion: reduce)').matches);
  const zoomLabel = useRef<HTMLSpanElement>(null), compass = useRef<SVGSVGElement>(null);
  const [labelsOn, setLabelsOn] = useState(true);
  const [atlasTab,setAtlasTab]=useState<'main'|'side'|'hidden'>('main');
  const [following, setFollowing] = useState(true);
  const [atlasOpen, setAtlasOpen] = useState(true);
  const [quality, setQuality] = useState<WorldQuality>(() => { try { return parseQuality(localStorage.getItem(QUALITY_KEY)); } catch { return 'auto'; } });
  const knownSites=LANDMARKS.filter(s=>s.kind==='main'||isRegionOpen(save.regions,s.biome)&&(s.kind==='side'||save.discovered.includes(s.id))).sort((a,b)=>REGION_ORDER.indexOf(a.biome)-REGION_ORDER.indexOf(b.biome));
  const chapter=nextChapter(save);
  const atlasSites=knownSites.filter(s=>atlasTab==='hidden'?s.kind==='hidden'||s.kind==='event':s.kind===atlasTab);
  const commitSave=(next:WorldSave)=>{saveRef.current=next;setSave(next);};
  const selectedTile = TILE_MAP.get(selected)!, currentTile = TILE_MAP.get(save.position)!;
  const selectedSite = knownSites.find(l => l.id === selectedTile.landmark);
  const selectedSealed=isTileSealed(save.regions,selectedTile);
  const path = findPath(save.position, selected,save.regions), steps = Math.max(path.length - 1, 0);
  const Icon = ICONS[selectedTile.biome];
  saveRef.current = save; selectedRef.current = selected; walkingRef.current = walking; audioRef.current = audioOn;
  useEffect(() => { const url = new URL(location.href); if (url.searchParams.has('motion')) { url.searchParams.delete('motion'); history.replaceState(history.state, '', url.pathname + url.search + url.hash); } }, []);
  const showSite = useCallback((id: string) => { const landmark = LANDMARKS.find(l => l.id === TILE_MAP.get(id)?.landmark); if (landmark&&!isRegionOpen(saveRef.current.regions,landmark.biome)){setSealed(landmark.biome);return;} if (landmark) { setSite(landmark); setMissionIndex(0); sound('bell', audioRef.current); } }, []);
  const moveTo = useCallback((id: string) => {
    if (walkingRef.current) return;
    const tile=TILE_MAP.get(id);if(tile&&isTileSealed(saveRef.current.regions,tile)){setSealed(tileRegion(tile));return;}
    const path = findPath(saveRef.current.position, id,saveRef.current.regions);
    if (!path.length) { setToast(TILE_MAP.get(id)?.biome === 'snow' ? '陡峭的雪峰无法攀越，请从山峰之间的隘口通行。' : '这里无法落脚。请沿栈桥前往海域据点。'); return; }
    if (path.length === 1) { showSite(id); return; }
    if (scene.current?.walk(path)) { walkingRef.current = true; setWalking(true); sound('select', audioRef.current); }
  }, [showSite]);
  const chooseTile = useCallback((id: string) => {
    if (walkingRef.current) { setToast('守夜人正在行进，抵达后可规划下一段旅程。'); return; }
    const tile=TILE_MAP.get(id);if(tile&&isTileSealed(saveRef.current.regions,tile)){setSelected(id);selectedRef.current=id;setSealed(tileRegion(tile));return;}
    if (selectedRef.current === id) { moveTo(id); return; }
    setSelected(id); selectedRef.current = id; sound('hover', audioRef.current);
  }, [moveTo]);

  useEffect(() => {
    if (!host.current) return;
    let disposed = false; setReady(false); setError('');
    try {
      const engine = new WorldScene(host.current, saveRef.current.position, {
        onSelect: chooseTile,
        // Clicking an animal logs it rather than moving there; clicking the ground beside it still
        // walks, which is why the scene only reports a creature when the ray actually struck one.
        onCreature: (species) => {
          if (disposed) return;
          const known = SPECIES_BY_ID.get(species); if (!known) return;
          if (!saveRef.current.fauna.includes(species)) {
            const next = discoverFauna(saveRef.current, species); saveRef.current = next; setSave(next);
            setToast('发现了「' + known.name + '」，已录入生物图鉴。');
          }
          setCreature(species); sound('bell', audioRef.current);
        },
        onStep: id => {
          if(disposed)return;
          const old=saveRef.current,next=advanceJourney(old,id);saveRef.current=next;setSave(next);
          const discovered=next.discovered.find(key=>!old.discovered.includes(key)),completed=next.completedQuests.find(key=>!old.completedQuests.includes(key));
          if(completed)setToast('约定已完成：'+LANDMARKS.find(s=>s.id===completed)!.quest!.title+' · 烬火 +4');
          else if(discovered)setToast('附近发现了「'+LANDMARKS.find(s=>s.id===discovered)!.name+'」，已标记在图志中。');
          const tile=TILE_MAP.get(id)!;footstep(tile.bridge?'wood':tile.biome==='desert'?'sand':tile.biome==='snow'?'snow':tile.biome==='grass'||tile.biome==='forest'?'grass':'stone',audioRef.current);
        },
        onArrive: id => { if (disposed) return; walkingRef.current = false; setWalking(false); const landmark = TILE_MAP.get(id)?.landmark; if (landmark) setSave(previous => ({ ...previous, visited: [...new Set([...previous.visited, landmark])] })); showSite(id); },
        onReady: failed => { if (disposed) return; setReady(true); if (failed) setToast('部分地表材质未能载入，可刷新页面重新加载。'); },
        onError: message => { if (!disposed) { setError(message); walkingRef.current = false; setWalking(false); } },
        onFollow: value => { if (!disposed) setFollowing(value); },
        onCamera: (value, angle) => { if (disposed) return; if (zoomLabel.current) zoomLabel.current.textContent = `${Math.round(value * 100)}%`; if (compass.current) compass.current.style.transform = `rotate(${-angle * 180 / Math.PI}deg)`; },
      },clock);
      scene.current = engine; engine.setRegions(saveRef.current.regions); engine.setLabels(labels.current); engine.select(selectedRef.current, findPath(saveRef.current.position, selectedRef.current,saveRef.current.regions));
    } catch { setError('浏览器暂时无法创建三维画面。请启用浏览器图形加速后重试。'); }
    return () => { disposed = true; scene.current?.dispose(); scene.current = null; };
  }, [attempt, chooseTile, showSite]);
  useEffect(() => { scene.current?.setReduced(reduced); }, [reduced, attempt]);
  useEffect(()=>{scene.current?.setDiscoveries(save.discovered,save.encounters);},[save.discovered,save.encounters,attempt]);
  useEffect(()=>{scene.current?.setRegions(save.regions);},[save.regions.unlocked.length,attempt]);
  useEffect(()=>{scene.current?.setHarborStage(save.harbor.stage);},[save.harbor.stage,attempt]);
  useEffect(() => { scene.current?.setQuality(quality); try { localStorage.setItem(QUALITY_KEY, quality); } catch { /* The current preference still applies without storage. */ } }, [quality, attempt]);
  useEffect(() => { scene.current?.setPaused(!!panel || !!site || !!sealed || !!error); }, [panel, site, sealed, error, attempt]);
  useEffect(() => { if (!walking) scene.current?.select(selected, findPath(save.position, selected,save.regions)); }, [selected, save.position, save.regions.unlocked.length, walking, attempt]);
  useEffect(() => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* Exploration remains available when storage is disabled. */ } }, [save]);
  useEffect(()=>{const persist=()=>{try{localStorage.setItem(CLOCK_KEY,JSON.stringify(clock.getSave()));}catch{/* Time still runs without storage. */}};const timer=setInterval(persist,5000);document.addEventListener('visibilitychange',persist);window.addEventListener('pagehide',persist);const unsubscribe=clock.subscribe(()=>{const now=clock.getSnapshot();if(now.paused||now.minute%5===0)persist();});return()=>{persist();clearInterval(timer);unsubscribe();document.removeEventListener('visibilitychange',persist);window.removeEventListener('pagehide',persist);};},[clock]);
  useEffect(() => { if (!toast) return; const timeout = setTimeout(() => setToast(''), 4200); return () => clearTimeout(timeout); }, [toast]);
  useEffect(() => { setAudioVolume(.36);const update=()=>setWorldAudio(audioOn&&!document.hidden,TILE_MAP.get(saveRef.current.position)!.biome);update();document.addEventListener('visibilitychange',update);return()=>{document.removeEventListener('visibilitychange',update);setWorldAudio(false);};},[audioOn]);
  useEffect(()=>{if(audioOn&&!document.hidden)setWorldAudio(true,currentTile.biome);},[currentTile.biome,audioOn]);
  useEffect(() => {
    const keys: Record<string, number> = { d: 0, e: 1, w: 2, a: 3, q: 4, s: 5 };
    const onKey = (event: KeyboardEvent) => {
      if (panel || site || sealed || walkingRef.current || error || !ready || event.ctrlKey || event.metaKey || event.altKey || (event.target as HTMLElement)?.closest('.world-clock') || /INPUT|TEXTAREA|SELECT/.test((event.target as HTMLElement)?.tagName || '')) return;
      const direction = keys[event.key.toLowerCase()];
      if (direction !== undefined) { event.preventDefault(); const current = TILE_MAP.get(saveRef.current.position)!; const [dq, dr] = DIRECTIONS[direction]; const id = tileId(current.q + dq, current.r + dr); if (TILE_MAP.get(id)?.walkable) { setSelected(id); moveTo(id); } else setToast('前方无法通行，试试沿地块或栈桥绕行。'); }
      if (event.key === ' ' && !(event.target as HTMLElement)?.closest('button,a')) { event.preventDefault(); scene.current?.focus(); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [panel, site, sealed, error, ready, moveTo]);
  const chooseSite = (landmark: Landmark) => { setPanel(null);setSealed(isRegionOpen(saveRef.current.regions,landmark.biome)?null:landmark.biome); const id = tileId(landmark.q, landmark.r); if (!walkingRef.current) { setSelected(id); selectedRef.current = id; scene.current?.focus(id); sound('select', audioOn); } };
  const locateSite=(id:string)=>{const landmark=LANDMARKS.find(s=>s.id===id);if(landmark){setSite(null);setSealed(null);chooseSite(landmark);}};
  const openSeal=(biome:Biome)=>{setSite(null);setPanel(null);setSealed(biome);};
  const claimRegion=(biome:Biome,answer?:string)=>{const previous=saveRef.current,next=unlockRegion(previous,biome,clock.totalMinutes,answer);if(next===previous)return;commitSave(next);scene.current?.setRegions(next.regions);setSite(null);setSealed(null);setPanel(null);const destination=MAIN_SITES.find(s=>s.biome===biome)!;chooseSite(destination);sound('bell',audioOn);setToast('封印消散 · '+BIOMES[biome].name+'已开启。烬火 +1，新的关卡与故事等待你的脚步。');};
  const routeButton=<button className="atlas-route-button" onClick={()=>{setSite(null);setSealed(null);setPanel('route');}}><Compass size={17}/><span>开拓之路</span><strong>{save.regions.unlocked.length} / 12</strong><ChevronRight size={16}/></button>;
  const useBeacon=(id:string)=>{
    if(walkingRef.current)return;
    const previous=saveRef.current,next=travelByBeacon(previous,id);if(next===previous)return;
    commitSave(next);setPanel(null);setSelected(next.position);selectedRef.current=next.position;
    if(!scene.current?.travelTo(next.position)){commitSave(previous);return;}
    sound('bell',audioOn);setToast('灯火相连，已抵达「'+MAIN_SITES.find(s=>s.id===id)!.name+'」。');
  };
  const atlasTabs=<div className="atlas-tabs" role="group" aria-label="图志分类">{(['main','side','hidden'] as const).map((value,index)=><button key={value} aria-pressed={atlasTab===value} onClick={()=>setAtlasTab(value)}>{['区域','支线','发现'][index]}</button>)}</div>;
  const actionLabel = walking ? '正在行进' : selectedSealed ? '查看解锁条件' : !selectedTile.walkable ? selectedTile.biome === 'snow' ? '雪峰无法攀越' : '水域无法落脚' : steps ? '前往此处' : selectedSite ? '探索此地' : '已抵达此处';
  const siteList = (compact = false) => atlasSites.map((landmark, i) => { const locked=!isRegionOpen(save.regions,landmark.biome);const SiteIcon = locked?Lock:landmark.kind==='side'?Flag:landmark.kind==='event'?Sparkles:landmark.kind==='hidden'?Gem:ICONS[landmark.biome]; return <button key={landmark.id} className={`atlas-site ${locked?'region-locked':''} ${selectedSite?.id === landmark.id ? 'active' : ''}`} onClick={() => chooseSite(landmark)} disabled={walking} style={{ '--biome': BIOMES[landmark.biome].color } as CSSProperties}>
    <span className="atlas-site-icon"><SiteIcon size={compact ? 15 : 18} /></span><span className="atlas-site-copy"><span>{landmark.name}</span><small>{locked?'封印中 · 点击查看条件':landmark.id==='ocean'?'主线修复 · '+save.harbor.stage+'/3':BIOMES[landmark.biome].name}{!compact && ` · ${landmark.difficulty}`}</small></span><span className="atlas-site-state">{locked?<Lock size={13}/>:save.visited.includes(landmark.id) ? <Check size={13} /> : String(i + 1).padStart(2, '0')}</span>
  </button>; });
  return <main className={`world-page ${reduced ? 'world-reduced' : ''}`}>
    <div className="world-atmosphere" aria-hidden="true" /><div className="world-canvas" ref={host} />
    <div className={`world-labels ${labelsOn ? '' : 'labels-off'}`} aria-label="地图上的关卡地点">{knownSites.map(landmark => { const locked=!isRegionOpen(save.regions,landmark.biome),SiteIcon = locked?Lock:ICONS[landmark.biome]; return <button key={landmark.id} ref={element => { if (element) labels.current.set(landmark.id, element); else labels.current.delete(landmark.id); }} className={`world-site-label site-${landmark.kind} ${locked?'region-locked':''}`} style={{ '--biome': BIOMES[landmark.biome].color } as CSSProperties} onClick={() => chooseSite(landmark)} disabled={!ready || walking} aria-label={`定位${landmark.name}`}><span className="site-pin"><SiteIcon size={12} /></span><span className="site-label-name">{landmark.name}</span>{!locked&&save.visited.includes(landmark.id) && <i />}</button>; })}</div>
    <header className="world-header">
      <a className="world-brand" href="#/opening" aria-label="返回永夜回响序幕"><span className="brand-sigil">✧</span><span>永夜回响<small>ECHOES OF ETERNAL NIGHT</small></span></a>
      <WorldClock clock={clock}/>
      <div className="world-wallet" aria-label={`烬火 ${save.embers}，回声 ${save.echoes}`}><span><Flame size={13}/>{save.embers}</span><span><Sparkles size={13}/>{save.echoes}</span></div><nav className="world-top-actions" aria-label="地图设置"><button className="world-icon" aria-label="旅途手记" onClick={()=>setPanel('journal')}><BookOpen size={18}/></button><button className="world-icon" aria-label="信标传送" disabled={walking} onClick={()=>setPanel('beacons')}><Zap size={18}/></button><button className="world-icon" title='原创配乐《灯火渡海》与地貌环境声' aria-label={audioOn ? '关闭环境音' : '开启环境音'} aria-pressed={audioOn} onClick={() => { sound('select', !audioOn); setAudioOn(!audioOn); }}>{audioOn ? <Volume2 size={18} /> : <VolumeX size={18} />}</button><button className="world-icon" aria-label="地图操作说明" onClick={() => setPanel('help')}><HelpCircle size={18} /></button><a className="world-icon" href="#/opening" aria-label="返回序幕"><Home size={17} /></a></nav>
    </header>
    <section className="world-title"><p className="world-kicker"><span /> THE OVERWORLD <span /></p><h1>余烬之境</h1><p className="world-subtitle">长夜尚未结束，而旅途才刚刚开始。</p><div className="world-title-rule"><i /><span>主世界 · {save.regions.unlocked.length} / 12 片风土已开启</span><i /></div></section>
    <aside className={`world-atlas ${atlasOpen ? '' : 'atlas-collapsed'}`} aria-label="世界地貌与地点">
      <button className="atlas-heading" onClick={() => setAtlasOpen(!atlasOpen)} aria-expanded={atlasOpen}><Compass size={16} /><span>世界图志</span><ChevronRight size={14} /></button>
      <div className="atlas-content"><div className="atlas-progress"><span>探索印记</span><strong>{String(save.visited.length).padStart(2, '0')} <small>/ {LANDMARKS.length}</small></strong></div>{routeButton}{atlasTabs}<div className="atlas-sites">{siteList(true)}{!atlasSites.length&&<p className="atlas-empty">有些地方只在你靠近时显现。沿着六边格走走，留意路边的微光。</p>}</div><p className="atlas-note"><span />灯火所至，长夜退散。</p></div>
    </aside>
    <button className="mobile-atlas world-icon" aria-label="打开世界图志" onClick={() => setPanel('atlas')}><Compass size={19} /></button>
    <WorldMinimap regions={save.regions} position={save.position} selected={selected} onChoose={raw=>{if(walkingRef.current)return;const id=navigationTarget(raw);setSelected(id);selectedRef.current=id;scene.current?.focus(id);}}/>
    <aside className="world-camera" aria-label="镜头控制">
      <div className="world-compass"><span>N</span><Compass ref={compass} size={40} strokeWidth={.8} /></div>
      <div className="camera-group"><button className="world-icon" aria-label="放大地图" onClick={() => scene.current?.zoom(1.2)}><Plus size={18} /></button><span ref={zoomLabel} className="zoom-value" aria-live="off">100%</span><button className="world-icon" aria-label="缩小地图" onClick={() => scene.current?.zoom(1 / 1.2)}><Minus size={18} /></button></div>
      <div className="camera-group"><button className={`world-icon ${following ? 'camera-follow-active' : ''}`} aria-label="定位守夜人" aria-pressed={following} title={following ? '镜头正在跟随人物' : '回到人物并跟随'} onClick={() => scene.current?.focus()}><LocateFixed size={18} /></button><button className="world-icon" aria-label="查看完整地图" title="查看完整地图" onClick={() => scene.current?.home()}><Maximize size={17} /></button></div>
      <span className="camera-mode">{following ? '跟随人物' : '自由查看'}</span>
    </aside>
    <div className="world-bottom">
      <div className="world-control-hint"><span><span className="mouse-outline" />拖动查看</span><i /><span>滚轮缩放</span><i /><span>固定 2.5D 视角</span><i /><span>再次点击六边格出发</span></div>
      <section className="world-travel" aria-label="行走与地点信息">
        <div className="traveler-identity"><div className="traveler-portrait"><img src="/assets/world/watcher-portrait-v3.webp" alt="黑色尖兜帽、月纹披风与金色提灯的守夜人" /><span /></div><div><p className="world-kicker">THE WAYFARER</p><h2>提灯守夜人</h2><p><span className={`traveler-dot ${walking ? 'walking' : ''}`} />{walking ? '正在前往目的地' : `驻足于${BIOMES[currentTile.biome].name}`}</p></div></div>
        <div className="travel-destination" style={{ '--biome': BIOMES[selectedTile.biome].color } as CSSProperties}><span className="destination-icon"><Icon size={23} strokeWidth={1.3} /></span><div><p className="destination-eyebrow">{steps ? '下一站' : '当前选中'} <span>· {BIOMES[selectedTile.biome].name}</span></p><h3>{selectedSite?.name || `${BIOMES[selectedTile.biome].name}地块`}</h3><p className={`destination-description ${selectedSealed?'seal-description':''}`}>{selectedSealed?CHAPTERS.find(c=>c.biome===tileRegion(selectedTile))?.condition:selectedSite ? selectedSite.id==='ocean'?'9 格港口 · 修复 '+save.harbor.stage+'/3':selectedSite.kind==='side'?siteFootprint(selectedSite.id).length+' 格建筑群 · '+selectedSite.quest!.npc:selectedSite.kind==='event'?'一个等待回应的故事':selectedSite.kind==='main'?SITE_SIZE[selectedSite.id]+' 格建筑群 · 前庭入口 · 3 个关卡':siteFootprint(selectedSite.id).length+' 格隐秘建筑群 · 前庭入口' : BIOMES[selectedTile.biome].description}</p></div></div>
        <div className="travel-action"><span className="travel-distance"><Footprints size={13} />{walking ? '循光而行…' : selectedSealed ? '封印尚未解除' : steps ? `${steps} 格 · 约 ${Math.ceil(steps * .48)} 秒` : selectedTile.walkable ? '脚下的世界，仍有回响' : selectedTile.biome === 'snow' ? '沿隘口穿越雪山' : '沿栈桥探索海域'}</span><button className="world-primary" aria-label={actionLabel} onClick={() => moveTo(selected)} disabled={!ready || !!error || walking || !selectedSealed&&(!selectedTile.walkable || (!steps && !selectedSite))}>{walking ? <span className="walking-dots" aria-hidden="true">···</span> : <Footprints size={16} />}<span>{actionLabel}</span><ArrowRight size={17} /></button></div>
      </section>
      <footer className="world-footer"><span><span className="status-dot" /> {save.mission ? `已选关卡 · ${save.mission}` : chapter?'开拓目标 · '+chapter.title:'全境已开启 · 进度自动保存'}</span><span>永夜历 · 第七纪元 <b>✧</b> WORLD 01</span></footer>
    </div>
    {toast && <div className="world-toast" role="status"><Sparkles size={15} />{toast}</div>}
    {!ready && !error && <div className="world-loading" role="status"><div className="loading-compass"><Compass size={42} strokeWidth={.9} /></div><p>正在展开世界图卷</p><span>地形 · 光影 · 远方的灯火</span></div>}
    {error && <div className="world-loading world-error" role="alert"><Mountain size={38} strokeWidth={1} /><p>{error}</p><button className="world-primary" onClick={() => setAttempt(attempt + 1)}><RotateCcw size={16} />重新载入地图</button></div>}
    {panel === 'help' && <Dialog title="循光而行" subtitle="A GUIDE TO THE REALM" close={() => setPanel(null)}><p className="dialog-intro">最初只有余烬营地所在的草原开放。在「开拓之路」查看条件，亲自完成每一段旅程，逐步解封十二片风土。开放区域可以自由探索，区域间的栈桥随对应章节开启。镜头保持固定 2.5D 角度，行走时自动跟随人物。抵达有灯火标记的地点，即可选择当地关卡。</p><dl className="world-help"><div><dt>查看地图</dt><dd>鼠标或单指拖动，暂时离开跟随</dd></div><div><dt>缩放地图</dt><dd>鼠标滚轮 / 双指捏合</dd></div><div><dt>平移镜头</dt><dd>按住右键拖动 / 双指拖动</dd></div><div><dt>前往地块</dt><dd>点击预览路线，再点击一次出发</dd></div><div><dt>逐格行走</dt><dd>W / E / D / S / Q / A 对应六个方向</dd></div><div><dt>恢复跟随</dt><dd>空格键 / 人物定位按钮</dd></div></dl><div className="world-options"><label><span>画面质量</span><select aria-label="画面质量" value={quality} onChange={e => setQuality(parseQuality(e.target.value))}><option value="auto">自动 · 推荐</option><option value="performance">流畅</option><option value="high">精细</option></select></label><label><span>显示地点名称</span><input type="checkbox" checked={labelsOn} onChange={e => setLabelsOn(e.target.checked)} /></label><label><span>减少环境动画</span><input type="checkbox" checked={reduced} onChange={e => setReduced(e.target.checked)} /></label></div><p className="dialog-footnote">点击声音按钮，聆听原创配乐《灯火渡海》与随地貌变化的风声、潮汐、鸟鸣和炉火。主建筑群占用 3～9 格，支线与隐秘据点各占 3 格，路边奇遇只有 1 格；点击任意一格都会定位到前庭入口，角色会绕开实体建筑。</p></Dialog>}
    {panel === 'atlas' && <Dialog title="世界图志" subtitle="TWELVE LANDS, COUNTLESS STORIES" close={() => setPanel(null)}>{routeButton}{atlasTabs}<div className="dialog-atlas">{siteList()}{!atlasSites.length&&<p className="atlas-empty">靠近路边的异常微光，可以发现秘境与奇遇。</p>}</div></Dialog>}
    {panel==='journal'&&<Dialog title="旅途手记" subtitle="EVERY LIGHT HAS A STORY" close={()=>setPanel(null)}>{routeButton}<WorldJournal save={save} locate={locateSite}/></Dialog>}
    {panel==='beacons'&&<Dialog title="循光信标" subtitle="WHERE THE LIGHT REMEMBERS YOU" close={()=>setPanel(null)}><p className="dialog-intro">亲自抵达主要据点后，信标会记住你的灯火。传送消耗 1 点烬火，返回余烬营地免费。</p><div className="beacon-grid">{MAIN_SITES.map(beacon=>{const unlocked=isRegionOpen(save.regions,beacon.biome)&&save.visited.includes(beacon.id),current=save.position===tileId(beacon.q,beacon.r),Icon=ICONS[beacon.biome];return <button key={beacon.id} disabled={!unlocked||current||(beacon.id!=='camp'&&!(beacon.id==='ocean'&&save.harbor.stage===3)&&save.embers<1)} onClick={()=>useBeacon(beacon.id)}><Icon size={20}/><span><strong>{beacon.name}</strong><small>{current?'你在这里':!isRegionOpen(save.regions,beacon.biome)?'区域封印中':!unlocked?'尚未点亮':beacon.id==='camp'||beacon.id==='ocean'&&save.harbor.stage===3?'免费返回':'烬火 ×1'}</small></span>{unlocked?<Check size={14}/>:<span className="locked-beacon">·</span>}</button>;})}</div></Dialog>}
    {panel==='route'&&<Dialog title="开拓之路" subtitle="ONE LIGHT, TWELVE LANDS" close={()=>setPanel(null)}><WorldRoute save={save} inspect={openSeal} locate={locateSite}/></Dialog>}
    {sealed&&<Dialog title={BIOMES[sealed].name+' · 区域封印'} subtitle="THE LIGHT HAS NOT REACHED HERE" close={()=>setSealed(null)}><RegionGate key={sealed} chapter={CHAPTERS.find(c=>c.biome===sealed)!} save={save} clock={clock} locate={locateSite} unlock={claimRegion}/></Dialog>}
    {creature && (() => { const species = SPECIES_BY_ID.get(creature)!; return <Dialog title={species.name} subtitle={species.latin.toUpperCase()} close={()=>setCreature(null)}>
      <div className="fauna-entry">
        <div className="fauna-tags">
          <span className={`fauna-temperament fauna-${species.temperament}`}>{TEMPERAMENT_LABEL[species.temperament]}</span>
          <span>{BIOMES[species.biome].name}</span>
          <span>{HABITAT_LABEL[species.habitat]}</span>
        </div>
        <p className="fauna-lore">{species.lore}</p>
        <p className="dialog-footnote">生物会在自己的风土内自由活动。已收录 {save.fauna.length} 种，共 {SPECIES_BY_ID.size} 种。</p>
      </div>
    </Dialog>; })()}
    {site && <Dialog title={site.name} subtitle={site.subtitle} close={()=>setSite(null)}>{chapter&&chapter.gate===site.id&&<RegionGate key={chapter.biome} chapter={chapter} save={save} clock={clock} locate={locateSite} unlock={claimRegion}/>}<WorldLocation key={site.id} site={site} save={save} update={commitSave} close={()=>setSite(null)} notify={setToast} audioOn={audioOn} locate={locateSite}/></Dialog>}
  </main>;
}
