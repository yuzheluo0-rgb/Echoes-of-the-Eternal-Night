import { useEffect, useRef } from 'react';
import type { Frame } from './engine';

export function Atmosphere({ reduced, enabled, frame }: { reduced: boolean; enabled: boolean; frame: Frame | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const burst = useRef<Frame | null>(null);
  useEffect(() => { burst.current = frame; }, [frame]);
  useEffect(() => {
    const el = canvas.current;
    if (!el || reduced || !enabled) return;
    const ctx = el.getContext('2d'); if (!ctx) return;
    let w = innerWidth; let h = innerHeight; let raf = 0; let previous = 0;
    const particles = Array.from({ length: 55 }, (_, i) => ({ x: (i * 7919 % 101) / 100 * w, y: (i * 3571 % 103) / 102 * h, r: 0.5 + i % 4 * 0.35, speed: 0.08 + (i % 5) * 0.05, phase: i * 0.71 }));
    let sparks: { x: number; y: number; vx: number; vy: number; life: number; color: string }[] = [];
    function resize() {
      w = innerWidth; h = innerHeight; const dpr = Math.min(devicePixelRatio || 1, 1.5);
      el!.width = w * dpr; el!.height = h * dpr; ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function draw(time: number) {
      raf = requestAnimationFrame(draw);
      if (document.hidden || time - previous < 28) return;
      const dt = Math.min(2, (time - previous) / 33); previous = time;
      ctx!.clearRect(0, 0, w, h);
      for (const p of particles) {
        p.y -= p.speed * dt; p.x += Math.sin(time * 0.0003 + p.phase) * 0.15 * dt;
        if (p.y < -10) p.y = h + 10;
        const alpha = (0.13 + (Math.sin(time * 0.001 + p.phase) + 1) * 0.14);
        ctx!.fillStyle = `rgba(222,181,111,${alpha})`;
        ctx!.beginPath(); ctx!.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx!.fill();
      }
      const event = burst.current;
      if (event) {
        burst.current = null;
        if (['damage', 'burn', 'death', 'shield'].includes(event.kind)) {
          const target = event.target ? document.querySelector(`[data-entity="${event.target}"]`) : null;
          const rect = target?.getBoundingClientRect();
          if (rect) {
            for (let i = 0; i < (event.kind === 'death' ? 35 : 16); i++) {
              const angle = i * 2.39996; const force = 1 + i % 5;
              sparks.push({ x: rect.x + rect.width / 2, y: rect.y + rect.height * 0.45, vx: Math.cos(angle) * force, vy: Math.sin(angle) * force, life: 1, color: event.kind === 'shield' ? '159,208,191' : event.suit === 'flame' ? '234,130,72' : '227,203,152' });
            }
          }
        }
      }
      for (const p of sparks) {
        p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 0.04 * dt; p.life -= 0.028 * dt;
        ctx!.fillStyle = `rgba(${p.color},${Math.max(0, p.life)})`;
        ctx!.fillRect(p.x, p.y, 2, 2);
      }
      sparks = sparks.filter(p => p.life > 0);
    }
    resize(); window.addEventListener('resize', resize); raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); ctx.clearRect(0, 0, w, h); };
  }, [reduced, enabled]);
  return <canvas ref={canvas} className="atmosphere-canvas" aria-hidden="true" />;
}

/** Real depth-tested WebGL geometry, gracefully backed by a CSS sigil. */
export function Sigil3D({ reduced, active }: { reduced: boolean; active: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current; if (!el) return;
    const gl = el.getContext('webgl', { alpha: true, antialias: true, powerPreference: 'low-power' });
    if (!gl) return;
    const vert = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vert, `attribute vec3 p; uniform float t; varying float z;
      void main(){ float a=t*.22; float b=.8; vec3 q=vec3(p.x*cos(a)+p.z*sin(a),p.y,-p.x*sin(a)+p.z*cos(a));
      q=vec3(q.x,q.y*cos(b)-q.z*sin(b),q.y*sin(b)+q.z*cos(b)); z=q.z;
      gl_Position=vec4(q.xy*.65, q.z*.3, 1.+q.z*.18); }`);
    gl.compileShader(vert);
    const frag = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(frag, `precision mediump float; varying float z; uniform float active;
      void main(){float light=.4+(z+1.)*.3; gl_FragColor=vec4(mix(vec3(.67,.54,.32),vec3(.75,.91,.79),active)*light,.55+z*.2);}`);
    gl.compileShader(frag);
    const program = gl.createProgram()!; gl.attachShader(program, vert); gl.attachShader(program, frag); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { gl.deleteProgram(program); gl.deleteShader(vert); gl.deleteShader(frag); return; }
    const vertices: number[] = [];
    for (let ring = 0; ring < 3; ring++) {
      for (let i = 0; i < 120; i++) {
        for (const j of [i, i + 1]) {
          const a = j / 120 * Math.PI * 2; const tilt = ring * Math.PI / 3;
          vertices.push(Math.cos(a), Math.sin(a) * Math.cos(tilt), Math.sin(a) * Math.sin(tilt));
        }
      }
    }
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      vertices.push(Math.cos(a) * .72, 0, Math.sin(a) * .72, 0, i % 2 ? .95 : -.95, 0);
    }
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    gl.useProgram(program); const loc = gl.getAttribLocation(program, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.enable(gl.DEPTH_TEST);
    const t = gl.getUniformLocation(program, 't'); gl.uniform1f(gl.getUniformLocation(program, 'active'), active ? 1 : 0);
    el.width = 240; el.height = 240; gl.viewport(0, 0, 240, 240);
    let raf = 0; let previous = 0;
    function render(time: number) {
      if (!reduced) raf = requestAnimationFrame(render);
      if (!reduced && (document.hidden || time - previous < 33)) return;
      previous = time; gl!.clear(gl!.COLOR_BUFFER_BIT | gl!.DEPTH_BUFFER_BIT); gl!.uniform1f(t, reduced ? 3 : time * .001); gl!.drawArrays(gl!.LINES, 0, vertices.length / 3);
    }
    render(100);
    return () => { cancelAnimationFrame(raf); gl.deleteBuffer(buffer); gl.deleteProgram(program); gl.deleteShader(vert); gl.deleteShader(frag); };
  }, [reduced, active]);
  return <canvas ref={canvas} className="sigil-canvas" aria-hidden="true" />;
}
