/**
 * 爬塔地图 — the chapter as a tower you climb.
 *
 * Three things carry the screen, and each one is doing a job rather than decorating:
 *
 *   1. **The backdrop is the floor you are looking at.** Hovering a wolf shows you the wolves. Two
 *      layers cross-fade between scenes, because a `background-image` cannot be animated and a hard
 *      cut between two photographs reads as a glitch rather than as a place changing.
 *   2. **The route is drawn, not implied.** Connectors are real lines between real nodes, walked ones
 *      are lit, and the nodes you can step on next pulse. Everything else is dimmed, so the decision
 *      is the only bright thing on the screen.
 *   3. **The layout is the tower's own geometry** — column x row, absolutely placed — so the branch
 *      structure the generator produced is what you actually see, gaps and all.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ENEMY_BY_ID } from './enemies.ts';
import {
  BOSS_ROW, MAP_COLS, MAP_ROWS, isRevealed, type MapNode, type NodeKind, type TowerMap,
} from './map.ts';
import { sceneArt, SCENE_BY_KEY, type SceneKey } from './scenes.ts';
import type { ChapterRun } from './run.ts';
import type { Encounter } from './enemies.ts';
import './tower.css';

const CELL = 118;
const ROW = 116;
/** Half a cell, so a node sits centred on its (col, row) point. */
const HALF = 20;

const KIND: Record<NodeKind, { label: string; glyph: string; tone: string; blurb: string }> = {
  combat: { label: '战斗', glyph: '⚔', tone: '#c8b98e', blurb: '一场寻常的遭遇。' },
  elite: { label: '精英', glyph: '☠', tone: '#e0b45f', blurb: '风险更大，回报也更大。' },
  event: { label: '事件', glyph: '?', tone: '#93c6d8', blurb: '说不清会遇到什么。' },
  rest: { label: '营火', glyph: '🔥', tone: '#e08a52', blurb: '歇一口气，或者做点别的。' },
  treasure: { label: '宝箱', glyph: '🎁', tone: '#d9a45f', blurb: '有人把东西留在了这里。' },
  boss: { label: '首领', glyph: '👑', tone: '#e2564f', blurb: '这一章的最后一件事。' },
};

/** Where a node sits, in container pixels. Row 1 at the bottom. */
function place(node: MapNode) {
  return { left: node.col * CELL + HALF, bottom: (node.row - 1) * ROW + HALF };
}

export interface TowerMapViewProps {
  run: ChapterRun;
  encounters: Map<string, Encounter>;
  onEnter: (nodeId: string) => void;
  onLeave?: () => void;
}

export default function TowerMapView({ run, encounters, onEnter, onLeave }: TowerMapViewProps) {
  const map = run.map!;
  const [hovered, setHovered] = useState<string | null>(null);
  const choices = useMemo(() => new Set(nextOf(map, run)), [map, run]);
  const walked = useMemo(() => {
    const edges = new Set<string>();
    for (let i = 1; i < run.path.length; i++) edges.add(`${run.path[i - 1]}>${run.path[i]}`);
    return edges;
  }, [run.path]);

  // --- the backdrop ------------------------------------------------------------------
  // The scene of whatever the player is looking at: the node under the cursor, or failing that the
  // one they are standing on, or the bottom of the tower.
  const focused = hovered ?? run.at;
  const focusedNode = focused ? map.byId.get(focused) : undefined;
  const focusedRevealed = focusedNode ? isRevealed(map, run.at, focusedNode.id) : false;
  const sceneKey = focusedNode && focusedRevealed ? sceneFor(focusedNode) : 'grass';
  const scene = SCENE_BY_KEY.get(sceneKey)!;

  // One state object rather than two: the layer to write and the layer to bring forward have to move
  // together, and `setFront(1 - front)` off a captured `front` misplaces the fade when two floors are
  // crossed in quick succession.
  const [fade, setFade] = useState(() => ({ layers: [sceneArt(sceneKey), sceneArt(sceneKey)] as [string, string], front: 0 }));
  useEffect(() => {
    setFade(prev => {
      const next = sceneArt(sceneKey);
      if (prev.layers[prev.front] === next) return prev;
      const back = 1 - prev.front;
      const layers: [string, string] = back === 0 ? [next, prev.layers[1]] : [prev.layers[0], next];
      return { layers, front: back };
    });
  }, [sceneKey]);
  const { layers, front } = fade;

  const width = MAP_COLS * CELL;
  const height = (BOSS_ROW - 1) * ROW + ROW;
  const focusNode = focusedRevealed ? focusedNode : undefined;

  // The whole page scrolls (see `tower.css` — scrolling the tower's own column put its scrollbar in
  // the middle of the screen), so these sit on the root and the header rather than on the view.
  const rootRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLElement>(null);
  // The run starts at the bottom, so the map opens at the bottom. Opening on the boss and making the
  // player scroll down past the whole tower to find out where they are is the wrong first frame.
  useEffect(() => {
    const node = rootRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, []);
  // The panel sticks directly under the header, whose height is not fixed — it wraps on narrow
  // screens — so it is measured rather than guessed at.
  useEffect(() => {
    const publish = () => {
      const height = headRef.current?.offsetHeight;
      if (height) rootRef.current?.style.setProperty('--tw-head', `${height}px`);
    };
    publish();
    window.addEventListener('resize', publish);
    return () => window.removeEventListener('resize', publish);
  }, []);

  return <div className="tw" ref={rootRef}>
    <div className="tw-bg" aria-hidden="true">
      {/* `.tw-plate`, not a bare `span`: the shade, grain and corner brackets are spans too, and a
          `> span` rule hid all three along with the photographs. */}
      {layers.map((image, index) => <span key={index} className={`tw-plate ${index === front ? 'on' : ''}`}
        style={{ backgroundImage: `url(${image})` }} />)}
      <span className="tw-shade" />
      <span className="tw-grain" />
      <span className="tw-edge" />
    </div>

    <header className="tw-top" ref={headRef}>
      <div>
        <p className="tw-kicker"><span />草原 · 余烬营地<span /></p>
        <h1>长夜塔</h1>
      </div>
      <dl className="tw-stats">
        <div><dt>层</dt><dd>{run.at ? map.byId.get(run.at)!.row : 0}<i>/{BOSS_ROW}</i></dd></div>
        {/* `run.maxHp`, not the 60 it used to print — a run carrying 生命上限 +N read 「66/60」
            here, which is the same lie the prep screen's health bar was telling. */}
        <div><dt>生命</dt><dd>{run.hp}<i>/{run.maxHp}</i></dd></div>
        <div><dt>金币</dt><dd>{run.gold}</dd></div>
        <div><dt>牌组</dt><dd>{run.deck.length}</dd></div>
      </dl>
      {onLeave && <button className="tw-leave" onClick={onLeave}>回到营地</button>}
    </header>

    <div className="tw-main">
    <div className="tw-view">
      <div className="tw-stage" style={{ width, height }}>
        <svg className="tw-links" width={width} height={height} aria-hidden="true">
          {map.nodes.flatMap(node => node.next.map(to => {
            const target = map.byId.get(to)!;
            const a = place(node), b = place(target);
            const walkedEdge = walked.has(`${node.id}>${to}`);
            const live = choices.has(to) && run.at === node.id;
            return <line key={`${node.id}>${to}`}
              x1={a.left} y1={height - a.bottom} x2={b.left} y2={height - b.bottom}
              className={`tw-link ${walkedEdge ? 'walked' : ''} ${live ? 'live' : ''}`} />;
          }))}
          {/* The boss has no single predecessor, so its own stem is drawn from the row below. */}
        </svg>

        {map.nodes.map(node => {
          const reachable = choices.has(node.id);
          const here = run.at === node.id;
          const seen = run.path.includes(node.id);
          // The generator decided every floor's kind when the tower was laid down; the *player* only
          // reads a couple of rows ahead, so the rest are a shape rather than a plan. What you can
          // step on is always legible, however far ahead the rule would otherwise hide it.
          const revealed = isRevealed(map, run.at, node.id);
          const kind = KIND[node.kind];
          return <button key={node.id}
            className={`tw-node ${revealed ? node.kind : 'fogged'} ${reachable ? 'reachable' : ''} ${here ? 'here' : ''} ${seen ? 'seen' : ''}`}
            style={{ ...place(node), '--tone': revealed ? kind.tone : '#5d6a66' } as CSSProperties}
            disabled={!reachable}
            onPointerEnter={() => setHovered(node.id)}
            onPointerLeave={() => setHovered(current => (current === node.id ? null : current))}
            onClick={() => onEnter(node.id)}
            aria-label={`第 ${node.row} 层 ${kind.label}`}>
            <i className="tw-pin" />
            <span className="tw-glyph">{revealed ? kind.glyph : '?'}</span>
            <span className="tw-row">{node.row}</span>
          </button>;
        })}
      </div>
    </div>

    <aside className={`tw-panel ${focusNode ? 'on' : ''}`} aria-live="polite">
      {focusNode ? <>
        <p className="tw-panel-kicker">第 {focusNode.row} 层 · {KIND[focusNode.kind].label}</p>
        <h2>{titleFor(focusNode)}</h2>
        <p className="tw-panel-blurb">{blurbFor(focusNode)}</p>

        {/* No portraits and no name here, on purpose. The floor has not rolled its fight yet — that
            happens when the player steps on it — so printing 「影狼」 now would be inventing one. */}
        {focusNode.kind !== 'rest' && focusNode.kind !== 'treasure' && <p className="tw-panel-unknown">
          这一层具体是什么，走上去才知道。
        </p>}

        <dl className="tw-panel-foot">
          <div><dt>场景</dt><dd>{scene.name}</dd></div>
          <div><dt>状态</dt><dd>{run.path.includes(focusNode.id) ? '已经走过' : choices.has(focusNode.id) ? '可以前往' : '这条路到不了'}</dd></div>
        </dl>
      </> : <p className="tw-panel-idle">
        {hovered && !focusedRevealed
          ? '那还在雾里。往上爬两层就看得到了。'
          : '把鼠标停在某一层上，这里会说明那一层是什么。'}
      </p>}
    </aside>
    </div>

    <p className="tw-hint">
      {run.at ? '点亮的是下一步能去的地方。' : '从最下面一层选一个地方开始。'}
    </p>
  </div>;
}

// ------------------------------------------------------------------ helpers

function nextOf(map: TowerMap, run: ChapterRun): string[] {
  return run.at ? (map.byId.get(run.at)?.next ?? []) : map.startIds;
}

/**
 * The backdrop for a floor, by **kind** and never by encounter.
 *
 * The map cannot show a wolf behind 战斗, because the fight on that floor has not been rolled yet —
 * it is decided at the threshold. Showing one would be a promise the floor has not made.
 */
function sceneFor(node: MapNode): SceneKey {
  if (node.kind === 'rest' || node.kind === 'treasure' || node.kind === 'event') return node.kind;
  if (node.kind === 'boss') return 'boss';
  if (node.kind === 'elite') return 'caravan';
  return 'grass';
}

function titleFor(node: MapNode): string {
  return KIND[node.kind].label;
}

function blurbFor(node: MapNode): string {
  return KIND[node.kind].blurb;
}

export { MAP_ROWS };
