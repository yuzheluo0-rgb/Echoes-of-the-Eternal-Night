import { useRef, type CSSProperties, type PointerEvent } from 'react';
import { DECK_BY_ID, KEYWORD_BY_ID, TIER_BY_ID, TYPE_LABEL, type CardDefinition, type Deck } from './index';
import { upgradeFor } from '../battle/upgrades.ts';
import './cards.css';

const RANK = { cinder: 0, glimmer: 1, blaze: 2, everburning: 3, starfall: 4 } as const;

/** How many motes a card gets. Only the two top tiers are allowed to move, so an ordinary hand of
 *  cards stays quiet and a 长明 or 星陨 actually announces itself. */
const MOTES: Record<string, number> = { everburning: 6, starfall: 10 };

/**
 * A card face. The photograph is the whole cover — the frame, the plate and the text are laid over
 * it rather than boxing it in, which is what keeps a hundred different photographs reading as one
 * deck instead of a hundred unrelated pictures.
 */
/** Pointer-following tilt, shared by both faces. Written as CSS custom properties so the motion
 *  itself stays in the stylesheet and can be switched off wholesale by `prefers-reduced-motion`. */
function useTilt() {
  const ref = useRef<HTMLElement>(null);
  return {
    ref,
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const node = ref.current;
      if (!node || event.pointerType === 'touch' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const rect = node.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width, y = (event.clientY - rect.top) / rect.height;
      node.style.setProperty('--rx', `${(0.5 - y) * 15}deg`);
      node.style.setProperty('--ry', `${(x - 0.5) * 19}deg`);
      node.style.setProperty('--glow-x', `${x * 100}%`);
      node.style.setProperty('--glow-y', `${y * 100}%`);
    },
    onPointerLeave: () => {
      const node = ref.current;
      if (!node) return;
      node.style.setProperty('--rx', '0deg');
      node.style.setProperty('--ry', '0deg');
      node.style.setProperty('--glow-x', '50%');
      node.style.setProperty('--glow-y', '50%');
    },
  };
}

/**
 * A card face.
 *
 * `upgraded` prints the **打磨**d version of the card: the rules text comes from `upgrades.ts`, the
 * same table the engine adds its deltas from, and the face says 已打磨 rather than leaving the player
 * to spot the difference.
 *
 * It defaults to `false` and the gallery never passes it, which is right twice over: a card in the
 * library has not been polished, and the two texts are the same string in that case anyway. The
 * important half is the other one — **the face must never disagree with the engine.** Before this
 * existed the card printed its base text in every screen, so a 打磨'd 砺石 read 「抽 1 张牌」 while
 * drawing 2. `upgrades.ts` says it outright: when its `text` and its deltas disagree, the text is
 * what the player read.
 */
export function CardFace({ card, selected, compact, upgraded, polishing }: {
  card: CardDefinition; selected?: boolean; compact?: boolean;
  /** Print the 打磨'd rules text and the 已打磨 mark. */
  upgraded?: boolean;
  /** Just polished, in the picker — the mark lands with a flare rather than simply appearing. */
  polishing?: boolean;
}) {
  const tier = TIER_BY_ID.get(card.tier)!, deck = DECK_BY_ID.get(card.deck as never);
  const motes = MOTES[card.tier] ?? 0, tilt = useTilt();
  // `?? card.text` is not defensive padding: an upgraded card with no row in `upgrades.ts` cannot
  // exist — `upgradeCard` refuses to upgrade it — but if one ever did, printing the base text is the
  // safe direction, and `upgrades.test.ts` is what actually holds the two lists together.
  const text = upgraded ? (upgradeFor(card.id, true)?.text ?? card.text) : card.text;
  return <article
    ref={tilt.ref} onPointerMove={tilt.onPointerMove} onPointerLeave={tilt.onPointerLeave}
    className={`cq cq-${card.tier} cq-deck-${card.deck} ${selected ? 'cq-selected' : ''} ${compact ? 'cq-compact' : ''} ${upgraded ? 'cq-upgraded' : ''} ${polishing ? 'cq-polishing' : ''}`}
    style={{ '--accent': tier.accent, '--deck': deck?.accent ?? tier.accent } as CSSProperties}
    data-card={card.id}>
    <div className="cq-inner">
      <div className="cq-art" style={{ backgroundImage: `url(/assets/cards/${card.id}.webp)` }} />
      <div className="cq-scrim" />
      <div className="cq-cost" aria-label={`费用 ${card.cost}`}>{card.cost >= 0 ? card.cost : '—'}</div>
      <div className="cq-tier">{tier.name}</div>
      <div className="cq-body">
        <h3 className="cq-name"><span>{card.name}</span>
          {/* On the name's own row, pushed to the right edge of it — the card is already carrying a
              cost disc top-left, a tier label top-right and four corner brackets, so the mark goes
              where there is a line and not where there is a corner. The name shrinks instead. */}
          {upgraded && <i className="cq-upmark">已打磨</i>}
        </h3>
        <div className="cq-type">{TYPE_LABEL[card.type]}{deck ? ` · ${deck.name}` : ' · 中立'}</div>
        <p className="cq-text">{text}</p>
        <div className="cq-keywords">{card.keywords.map(id => <span key={id} title={KEYWORD_BY_ID.get(id)!.rule}>{KEYWORD_BY_ID.get(id)!.name}</span>)}
          {card.bridge && <span className="cq-bridge" title={`与「${DECK_BY_ID.get(card.bridge)!.name}」联动`}>↔ {DECK_BY_ID.get(card.bridge)!.name}</span>}</div>
      </div>
      <span className="cq-corner tl" /><span className="cq-corner tr" /><span className="cq-corner bl" /><span className="cq-corner br" />
      <span className="cq-bevel" aria-hidden="true" />
      <span className="cq-foil" aria-hidden="true" />
      <span className="cq-sheen" aria-hidden="true" />
      <span className="cq-pointer-glow" aria-hidden="true" />
    </div>
    {motes > 0 && <span className="cq-motes" aria-hidden="true">{Array.from({ length: motes }, (_, i) => <i key={i} style={{ '--mote': i } as CSSProperties} />)}</span>}
    {card.tier === 'starfall' && <span className="cq-holo" aria-hidden="true" />}
  </article>;
}

/** The back is one image per deck, with the deck's plate over it. Uniform by design. */
export function CardBack({ deck, compact }: { deck: Deck; compact?: boolean }) {
  const tilt = useTilt();
  return <article ref={tilt.ref} onPointerMove={tilt.onPointerMove} onPointerLeave={tilt.onPointerLeave}
    className={`cq cq-back cq-deck-${deck.id} ${compact ? 'cq-compact' : ''}`} style={{ '--deck': deck.accent, '--accent': deck.accent } as CSSProperties}>
    <div className="cq-inner">
      <div className="cq-art" style={{ backgroundImage: `url(/assets/cards/back-${deck.id}.webp)` }} />
      <div className="cq-back-veil" />
      <span className="cq-corner tl" /><span className="cq-corner tr" /><span className="cq-corner bl" /><span className="cq-corner br" />
      <span className="cq-bevel" aria-hidden="true" />
      <span className="cq-sheen" aria-hidden="true" />
      <span className="cq-pointer-glow" aria-hidden="true" />
      <div className="cq-back-plate">
        <span className="cq-back-rule" />
        <h3>{deck.name}</h3>
        <small>{deck.subtitle}</small>
        <span className="cq-back-rule" />
      </div>
    </div>
  </article>;
}

/**
 * A card being drawn: it arrives face down and turns over once it has landed in hand. Two layers
 * back to back, so the flip is a real half-turn rather than a cross-fade — the edge of the card
 * actually goes past you, which is what makes a draw feel like a draw.
 *
 * `revealed` is driven by the caller, not by a timer in here, so the battle layer can keep the
 * timing in step with its own animation queue.
 */
export function CardFlip({ card, deck, revealed, delay = 0 }: { card: CardDefinition; deck: Deck; revealed: boolean; delay?: number }) {
  return <div className={`cq-flip ${revealed ? 'is-flipped' : ''}`} style={{ '--flip-delay': `${delay}ms` } as CSSProperties}>
    <div className="cq-flip-inner">
      <div className="cq-flip-face cq-flip-back"><CardBack deck={deck} /></div>
      <div className="cq-flip-face cq-flip-front"><CardFace card={card} /></div>
    </div>
  </div>;
}

export { RANK };
