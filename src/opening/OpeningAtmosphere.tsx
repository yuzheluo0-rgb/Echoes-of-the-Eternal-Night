import { useEffect, useRef } from 'react';

interface Particle { x: number; y: number; z: number; phase: number; kind: number }

/** A single capped-DPR canvas paints all airborne depth layers at 30 fps. */
export default function OpeningAtmosphere({ reduced, active, entering }: { reduced: boolean; active: boolean; entering: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const approach = useRef(0);
  useEffect(() => { approach.current = entering ? 1 : 0; }, [entering]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || reduced || !active) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let width = innerWidth;
    let height = innerHeight;
    let raf = 0;
    let previous = 0;
    let mouseX = 0;
    let mouseY = 0;
    const particles: Particle[] = Array.from({ length: 68 }, (_, i) => ({
      x: ((i * 7193 + 293) % 1009) / 1009,
      y: ((i * 3181 + 187) % 1013) / 1013,
      z: .2 + ((i * 29) % 89) / 89 * .8,
      phase: i * 2.39996,
      kind: i % 5 === 0 ? 1 : 0,
    }));
    function resize() {
      width = innerWidth; height = innerHeight;
      const dpr = Math.min(devicePixelRatio || 1, 1.5);
      canvas!.width = Math.floor(width * dpr); canvas!.height = Math.floor(height * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function move(e: PointerEvent) {
      if (e.pointerType === 'touch') return;
      mouseX = (e.clientX / width - .5) * 20;
      mouseY = (e.clientY / height - .5) * 12;
    }
    function draw(time: number) {
      raf = requestAnimationFrame(draw);
      if (document.hidden || time - previous < 32) return;
      const delta = Math.min((time - previous) / 33, 2);
      previous = time;
      ctx!.clearRect(0, 0, width, height);
      for (const p of particles) {
        p.y -= (.00008 + p.z * .00028) * delta * (1 + approach.current * 2);
        p.x += Math.sin(time * .0002 + p.phase) * .00008 * delta;
        if (p.y < -.04) p.y = 1.04;
        const x = p.x * width + mouseX * p.z;
        const y = p.y * height + mouseY * p.z;
        const opacity = (.08 + p.z * .25) * (.7 + Math.sin(time * .0008 + p.phase) * .3);
        const radius = p.kind ? 1.1 + p.z * 1.8 : .35 + p.z;
        if (p.kind) {
          const gradient = ctx!.createRadialGradient(x, y, 0, x, y, radius * 6);
          gradient.addColorStop(0, `rgba(235,164,77,${opacity})`);
          gradient.addColorStop(.16, `rgba(217,148,68,${opacity * .65})`);
          gradient.addColorStop(1, 'rgba(203,144,69,0)');
          ctx!.fillStyle = gradient;
          ctx!.fillRect(x - radius * 6, y - radius * 6, radius * 12, radius * 12);
        } else {
          ctx!.fillStyle = `rgba(205,206,198,${opacity})`;
          ctx!.beginPath(); ctx!.ellipse(x, y, radius, radius * .5, p.phase, 0, Math.PI * 2); ctx!.fill();
        }
      }
    }
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', move, { passive: true });
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', move);
      ctx.clearRect(0, 0, width, height);
    };
  }, [reduced, active]);

  return <canvas ref={ref} className="opening-particles" aria-hidden="true" />;
}
