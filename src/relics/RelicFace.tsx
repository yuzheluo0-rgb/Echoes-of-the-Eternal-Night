import { useRef, type CSSProperties, type PointerEvent } from 'react';
import { RANK_OF, REFINE_LABEL, TIER_BY_ID, type RefineTier, type RelicDefinition } from './relics.ts';
import './relics.css';

/**
 * A relic card.
 *
 * Same family as the playing cards — the photograph is the whole cover, the text lies over it — but
 * deliberately not the same *object*. A relic is never played and never in your hand, so it drops the
 * cost corner and the type line, and picks up the two things that matter for a thing you carry:
 * a **tier ribbon** across the top, and the **double rule** of an equipment frame instead of a card's
 * single bevel. The reference is a 三国杀 equipment card: an object, in a frame, with its rule
 * printed under it.
 *
 * Both slot effects are printed on the face. A relic is the same relic whichever slot it sits in, so
 * hiding the lesser version would make the card a different card depending on where it was — and this
 * page exists to be read, not played.
 */
function useTilt() {
  const ref = useRef<HTMLElement>(null);
  return {
    ref,
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const node = ref.current;
      if (!node || event.pointerType === 'touch' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const rect = node.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width, y = (event.clientY - rect.top) / rect.height;
      node.style.setProperty('--rx', `${(0.5 - y) * 13}deg`);
      node.style.setProperty('--ry', `${(x - 0.5) * 17}deg`);
      node.style.setProperty('--glow-x', `${x * 100}%`);
      node.style.setProperty('--glow-y', `${y * 100}%`);
    },
    onPointerLeave: () => {
      const node = ref.current;
      if (!node) return;
      node.style.setProperty('--rx', '0deg');
      node.style.setProperty('--ry', '0deg');
    },
  };
}

/** How many motes a relic gets. Only the top two rungs move, so a page of 71 stays calm. */
const MOTES: Record<string, number> = { arcanum: 6, echo: 12 };

/**
 * 淬炼 as the face prints it: the tier, and the lines saying what moved.
 *
 * The lines are computed by the **engine** (`refineLines` in `src/battle/relics.ts`) and handed in
 * ready to render, because this module may not import `src/battle/**` — the gallery is meant to open
 * without the battle engine. Passing finished strings keeps the isolation and keeps the arithmetic on
 * the one side allowed to do it.
 */
export interface RefineBadge {
  tier: RefineTier;
  /** 「格挡 1 → 3」, or a hand-written clause for the relics whose rung is not one. */
  lines: string[];
}

export function RelicFace({ relic, compact, showSub = true, refine }: {
  relic: RelicDefinition; compact?: boolean; showSub?: boolean; refine?: RefineBadge;
}) {
  const tier = TIER_BY_ID.get(relic.tier)!;
  const motes = MOTES[relic.tier] ?? 0;
  const tilt = useTilt();
  return <article
    ref={tilt.ref} onPointerMove={tilt.onPointerMove} onPointerLeave={tilt.onPointerLeave}
    className={`rl rl-${relic.tier} ${compact ? 'rl-compact' : ''} ${refine ? 'rl-refined' : ''}`}
    style={{ '--tier': tier.accent } as CSSProperties}
    data-relic={relic.id} data-rank={RANK_OF[relic.tier]}>
    <div className="rl-inner">
      <div className="rl-art" style={{ backgroundImage: `url(/assets/relics/${relic.id}.webp)` }} />
      <div className="rl-scrim" />
      <div className="rl-ribbon"><span className="rl-tier">{tier.name}</span><span className="rl-kind">遗物</span></div>
      <div className="rl-body">
        {/* No 已淬炼 mark on the name line. It would fit for 铁钉 and wrap for 守夜人的提灯, and a
            wrapped name pushes the whole block down by a line — the same staircase this whole layout
            is arranged to avoid. The mark rides the gold strip at the top instead. */}
        <h3 className="rl-name"><span>{relic.name}</span></h3>
        <p className="rl-text">{relic.text}</p>
        {showSub && <div className="rl-sub">
          <span className="rl-sub-tag">副槽</span>
          <p>{relic.sub}</p>
        </div>}
      </div>
      {/* ⚠️ **At the top, under the ribbon — not in the text block.** `.rl-body` is bottom-anchored
          with a fixed height, which is exactly what keeps a row of cards' names on one line; a
          refinement printed *inside* it would make that card's block taller and shove its own name up
          37px, so a row holding one quenched relic and one plain one came out looking like a bug (it
          did — screenshotted and measured). The space under the ribbon is free and costs nothing.
          Both halves' numbers are lifted by 淬炼, so one line covers whichever slot the relic is in. */}
      {refine && <div className="rl-refine">
        <span className="rl-refine-mark">已淬炼 · {REFINE_LABEL[refine.tier]}</span>
        <ul>{refine.lines.map(line => <li key={line}>{line}</li>)}</ul>
      </div>}
      <span className="rl-rule-outer" aria-hidden="true" />
      <span className="rl-rule-inner" aria-hidden="true" />
      <span className="rl-corner tl" /><span className="rl-corner tr" />
      <span className="rl-corner bl" /><span className="rl-corner br" />
      <span className="rl-sheen" aria-hidden="true" />
      <span className="rl-pointer-glow" aria-hidden="true" />
    </div>
    {motes > 0 && <span className="rl-motes" aria-hidden="true">
      {Array.from({ length: motes }, (_, i) => <i key={i} style={{ '--mote': i } as CSSProperties} />)}
    </span>}
    {relic.tier === 'echo' && <span className="rl-holo" aria-hidden="true" />}
  </article>;
}
