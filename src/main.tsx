import React, { lazy, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './opening/opening.css';
import './opening/cinematic.css';

const Opening = lazy(() => import('./opening/Opening'));
const WorldMap = lazy(() => import('./world/WorldMap'));
/** The card library is a standalone page: it pulls in nothing from `src/world/**`, so browsing it
 *  cannot touch world generation or the map's save. */
const CardGallery = lazy(() => import('./cards/CardGallery'));
/** 第一章战斗 demo —— 同样自带样式，不碰地图与它的存档。 */
const BattleDemo = lazy(() => import('./battle/BattleDemo'));
/** 遗物总览页。和卡牌总览同理：只读 `src/relics/`，碰不到地图、run 或存档。 */
const RelicGallery = lazy(() => import('./relics/RelicGallery'));
function Game() {
  const [route, setRoute] = useState(location.hash);
  useEffect(() => { const change = () => setRoute(location.hash); window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []);
  const page = route === '#/opening' ? <Opening />
    : route === '#/cards' ? <CardGallery />
      : route === '#/relics' ? <RelicGallery />
        : route === '#/battle' ? <BattleDemo />
          : <WorldMap />;
  return <Suspense fallback={<div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', color: '#c8b98e', background: '#102027', fontFamily: 'serif', letterSpacing: 4 }}>正在唤醒永夜</div>}>{page}</Suspense>;
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode><Game /></React.StrictMode>,
);
