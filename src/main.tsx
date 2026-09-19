import React, { lazy, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './opening/opening.css';
import './opening/cinematic.css';

const Opening = lazy(() => import('./opening/Opening'));
const WorldMap = lazy(() => import('./world/WorldMap'));
function Game() {
  const [route, setRoute] = useState(location.hash);
  useEffect(() => { const change = () => setRoute(location.hash); window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []);
  return <Suspense fallback={<div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', color: '#c8b98e', background: '#102027', fontFamily: 'serif', letterSpacing: 4 }}>正在唤醒永夜</div>}>{route === '#/opening' ? <Opening /> : <WorldMap />}</Suspense>;
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode><Game /></React.StrictMode>,
);
