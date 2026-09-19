import { useEffect, useRef } from 'react';
import { createLightField } from './cinematicLight';
import type { LightField } from './cinematicLight';

export default function OpeningLightField({ reduced, paused, entering, cinema }: {
  reduced: boolean; paused: boolean; entering: boolean; cinema: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const field = useRef<LightField | null>(null);
  useEffect(() => {
    if (!canvas.current) return;
    const renderer = createLightField(canvas.current);
    field.current = renderer;
    return () => { renderer.dispose(); field.current = null; };
  }, []);
  useEffect(() => { field.current?.configure({ reduced, paused, entering }); }, [reduced, paused, entering, cinema]);
  return <canvas ref={canvas} className="opening-lightfield" data-renderer="loading" aria-hidden="true" />;
}
