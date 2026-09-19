export type WorldQuality = 'auto' | 'high' | 'performance';
export const QUALITY_KEY = 'eternal-night-world-quality';
export function parseQuality(value: string | null): WorldQuality {
  return value === 'high' || value === 'performance' ? value : 'auto';
}

/** Adjust the 3D buffer, leaving text and controls at the display's native resolution. */
export class WorldRenderBudget {
  mode: WorldQuality = 'auto';
  pixels = 1400000;
  private samples: number[] = [];
  private lastChange = 0;
  setMode(mode: WorldQuality, now = 0) {
    this.mode = mode; this.pixels = mode === 'high' ? 2400000 : mode === 'performance' ? 650000 : 1400000;
    this.samples = []; this.lastChange = now;
  }
  resetSamples() { this.samples = []; }
  observe(milliseconds: number, now: number): boolean {
    if (this.mode !== 'auto' || milliseconds <= 0 || milliseconds > 150) return false;
    this.samples.push(milliseconds); if (this.samples.length < 90) return false;
    const sorted = this.samples.sort((a, b) => a - b); this.samples = [];
    const p75 = sorted[Math.floor(sorted.length * .75)], p90 = sorted[Math.floor(sorted.length * .9)];
    if (now - this.lastChange < 4500) return false;
    let next = this.pixels;
    if (p75 > 24) next = Math.max(650000, Math.round(this.pixels * .82));
    else if (p90 < 17.5 && now - this.lastChange > 15000) next = Math.min(1400000, Math.round(this.pixels * 1.1));
    if (next === this.pixels) return false;
    this.pixels = next; this.lastChange = now; return true;
  }
}
