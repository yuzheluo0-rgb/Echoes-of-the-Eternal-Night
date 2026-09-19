export interface OpeningLoad {
  percent: number;
  complete: boolean;
  failures: string[];
}

export const OPENING_ASSETS = [
  '/assets/threshold-scene.webp',
  '/assets/threshold-watcher.webp',
  '/assets/card-blade.webp',
  '/assets/card-ember.webp',
  '/assets/card-shield.webp',
  '/assets/card-mirror.webp',
];

/** Progress counts successfully decoded images, never a simulated download timer. */
export function loadOpeningAssets(onProgress: (state: OpeningLoad) => void) {
  let cancelled = false;
  let successful = 0;
  let settled = 0;
  const failures: string[] = [];
  const cleanups: (() => void)[] = [];

  onProgress({ percent: 0, complete: false, failures: [] });
  for (const url of OPENING_ASSETS) {
    const img = new Image();
    let done = false;
    const finish = (ok: boolean) => {
      if (done || cancelled) return;
      done = true;
      clearTimeout(timeout);
      img.onload = null;
      img.onerror = null;
      settled++;
      if (ok) successful++;
      else failures.push(url);
      onProgress({
        percent: Math.floor(successful / OPENING_ASSETS.length * 100),
        complete: settled === OPENING_ASSETS.length && failures.length === 0,
        failures: settled === OPENING_ASSETS.length ? [...failures] : [],
      });
    };
    const timeout = window.setTimeout(() => finish(false), 18000);
    img.decoding = 'async';
    img.onload = () => {
      img.decode().then(() => finish(true), () => finish(img.naturalWidth > 0));
    };
    img.onerror = () => finish(false);
    img.src = url;
    cleanups.push(() => { clearTimeout(timeout); img.onload = null; img.onerror = null; });
  }

  return () => { cancelled = true; cleanups.forEach(cleanup => cleanup()); };
}
