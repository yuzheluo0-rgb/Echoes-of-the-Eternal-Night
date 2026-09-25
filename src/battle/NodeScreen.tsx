/**
 * The screens a non-combat floor opens: 战利品, 营火, 奇遇, and the card picker they share.
 *
 * These are the places the run stops being a fight and becomes a decision, so they are built the
 * opposite way round from the battle page: **one thing at a time, at a size you can read from a
 * sofa.** The first version reused the battle page's panel scale — 12.5px labels and 13px body — and
 * a reward screen you have to lean in to read is a reward screen nobody reads. Title 46px, body 18px,
 * buttons 17px, and the card picker shows the real card faces rather than a list of names.
 *
 * Every screen is the same shell: a scene behind, one panel in front, a row of actions at the bottom.
 * They differ only in what fills the middle, which is why they are one file.
 */

import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { sound } from '../audio';
import { CardFace } from '../cards/CardFace';
import { CARD_BY_ID } from '../cards/index.ts';
import { RARITY_COLOR, RARITY_LABEL, type RewardSpec } from './rewards.ts';
import { isUpgradable } from './upgrades.ts';
import { canAfford, outcomeLine, type EventOption, type EventSpec } from './events.ts';
import { sceneArt, SCENE_BY_KEY } from './scenes.ts';
import { deckCounts, holdsRelic, resolveEvent, type ChapterRun } from './run.ts';
import { REFINE_LABEL, RELIC_BY_ID } from '../relics/relics.ts';
import { RelicFace } from '../relics/RelicFace';
import { refineLines } from './relics.ts';
import type { NodeKind } from './map.ts';
import './node.css';

// --------------------------------------------------------------------- shell

/**
 * The frame every node screen shares. `scene` is the floor's own backdrop, so walking from the tower
 * into a campfire keeps the same picture behind it.
 */
export function NodeShell({ kind, scene, title, kicker, children, actions, footer }: {
  kind: NodeKind;
  scene: string;
  title: string;
  kicker: string;
  children?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
}) {
  const plate = SCENE_BY_KEY.get(scene as never);
  return <div className={`nd nd-${kind}`}>
    <div className="nd-bg" aria-hidden="true">
      <span style={{ backgroundImage: `url(${sceneArt(scene)})` }} />
      <span className="nd-shade" />
    </div>
    <div className="nd-panel">
      <header className="nd-head">
        <p className="nd-kicker">{kicker}</p>
        <h1 className="nd-title">{title}</h1>
      </header>
      <div className="nd-body">{children}</div>
      {actions && <div className="nd-actions">{actions}</div>}
      {footer && <p className="nd-footer">{footer}{plate && <i>· {plate.name}</i>}</p>}
    </div>
  </div>;
}

/** One big choice. Used by the campfire, the events and the shop alike. */
export function NodeChoice({ label, hint, tone, disabled, onClick, onHover, children }: {
  label: string; hint?: string; tone?: string; disabled?: boolean;
  onClick: () => void; onHover?: () => void; children?: ReactNode;
}) {
  return <button className={`nd-choice ${disabled ? 'off' : ''}`}
    style={tone ? { '--tone': tone } as CSSProperties : undefined}
    disabled={disabled} onClick={onClick} onPointerEnter={onHover}>
    <span className="nd-choice-label">{label}</span>
    {hint && <span className="nd-choice-hint">{hint}</span>}
    {children}
  </button>;
}

// -------------------------------------------------------------------- reward

/** 战利品 — one rolled reward, shown large, claimed once. */
export function RewardScreen({ reward, run, onClaim, audioOn, from }: {
  reward: RewardSpec; run: ChapterRun; onClaim: () => void; audioOn: boolean; from: string;
}) {
  return <NodeShell kind="treasure" scene={rewardScene(reward)} kicker={`${from} · ${RARITY_LABEL[reward.rarity]}`}
    title={reward.name}
    actions={<button className="nd-primary" onPointerEnter={() => sound('hover', audioOn)}
      onClick={() => { sound('relic-set', audioOn); onClaim(); }}>
      收下
    </button>}
    footer={`生命 ${run.hp}/${run.maxHp} · 金币 ${run.gold}`}>
    <p className="nd-copy" style={{ color: RARITY_COLOR[reward.rarity] }}>{reward.blurb}</p>
    <p className="nd-effect">{describeReward(reward)}</p>
  </NodeShell>;
}

/** The line under the flavour: what this row actually does, in plain words. */
export function describeReward(reward: RewardSpec): string {
  const e = reward.effect;
  switch (e.kind) {
    case 'gold': return `获得 ${e.amount} 金币`;
    case 'heal': return `回复 ${e.amount} 点生命`;
    case 'maxHp': return `生命上限 +${e.amount}，并立即回复同样多`;
    case 'relic': return '抽取一件遗物';
    case 'remove': return '焚掉牌组里的一张牌';
    case 'polish': return '打磨牌组里的一张牌';
    case 'duplicate': return '复制牌组里的一张牌';
    case 'cards': return e.pick ? `从 ${e.count} 张牌里挑一张` : `直接获得 ${e.count} 张牌`;
  }
}

/** A reward has no scene of its own; the flavour picks one. */
function rewardScene(reward: RewardSpec): string {
  if (reward.effect.kind === 'relic') return 'treasure';
  if (reward.effect.kind === 'gold') return 'caravan';
  if (reward.effect.kind === 'cards' || reward.effect.kind === 'remove'
    || reward.effect.kind === 'polish' || reward.effect.kind === 'duplicate') return 'event';
  return 'rest';
}

// ------------------------------------------------------------------ campfire

export type CampfirePick = 'rest' | 'burn' | 'polish';

/** 营火 — three ways to spend a night, all of them final. */
export function CampfireScreen({ run, onPick, audioOn }: {
  run: ChapterRun; onPick: (choice: CampfirePick) => void; audioOn: boolean;
}) {
  const heal = Math.round(run.maxHp * .3);
  return <NodeShell kind="rest" scene="rest" kicker="营火 · 停下来" title="营地的火"
    footer="无论选哪个，这一层就过去了。">
    <p className="nd-copy">火还在烧。你有时间做一件事。</p>
    <div className="nd-choices">
      <NodeChoice label="休息" tone="#e08a52" hint={`回复 ${heal} 点生命`}
        onHover={() => sound('hover', audioOn)} onClick={() => onPick('rest')} />
      <NodeChoice label="焚牌" tone="#e3948c" hint="把牌组里的一张牌投进火里，永远拿掉"
        onHover={() => sound('hover', audioOn)} onClick={() => onPick('burn')} />
      <NodeChoice label="打磨" tone="#d9bc80" hint="把一张牌磨得更好，本局永久生效"
        onHover={() => sound('hover', audioOn)} onClick={() => onPick('polish')} />
    </div>
  </NodeShell>;
}

// -------------------------------------------------------------------- 淬炼

/**
 * 淬炼 — the one gamble in the run, played out in the open in two beats.
 *
 * **Pick which relic goes in the fire, then watch what comes out.** The second beat is not decoration.
 * The first version of 打磨's screen closed itself after 660ms with a gold flash and players did not
 * notice it had happened at all — 「看不见的停顿不是反馈，是延迟」. Here the stake is a relic, so a silent
 * result is the worst version of that mistake: the player would have to go and read the deck screen to
 * find out whether they still owned the thing.
 *
 * The outcome comes from `run.relicTask.done` and is never re-derived. The run has already applied it
 * by the time this renders, so there is exactly one place that knows what happened.
 */
export function RefineScreen({ run, onPick, onDismiss, audioOn }: {
  run: ChapterRun; onPick: (relicId: string) => void; onDismiss: () => void; audioOn: boolean;
}) {
  const task = run.relicTask!;
  const done = task.done;
  const held = (['main', 'sub'] as const).filter(slot => run.relics[slot]);

  if (!done) {
    return <NodeShell kind="event" scene="rest" kicker="淬炼 · 押上去"
      title={REFINE_LABEL[task.tier]}
      footer={`成算 ${task.chance}%。失败的话，那件东西就没了。`}>
      <p className="nd-copy">火已经旺了。挑一件放进——<b>它可能回不来</b>。</p>
      <div className="nd-choices">
        {held.map(slot => {
          const relic = RELIC_BY_ID.get(run.relics[slot]!)!;
          return <NodeChoice key={slot} label={relic.name} tone="#e08a52"
            hint={`${slot === 'main' ? '主槽' : '副槽'} · ${relic.text}`}
            onHover={() => sound('hover', audioOn)} onClick={() => onPick(relic.id)} />;
        })}
      </div>
    </NodeShell>;
  }

  const relic = RELIC_BY_ID.get(done.relicId)!;
  // From `done`, not from the run: on a failure the relic is already gone and `run.relics` no longer
  // names it, so looking it up here reported 副槽 for a relic that had been in 主槽. See `done.slot`.
  const slot = done.slot;
  // Failure means the relic is gone; there is no face left to show, so the frame keeps the name and
  // the empty slot underneath. Success shows the same card it always was, with the gold strip on it.
  return <NodeShell kind="event" scene="rest" kicker="淬炼 · 出火" title={done.won ? '成了' : '碎了'}
    actions={<button className="nd-primary" onPointerEnter={() => sound('hover', audioOn)}
      onClick={() => { sound('bell', audioOn); onDismiss(); }}>继续</button>}
    footer={done.won ? `${relic.name} · 已淬炼` : `${relic.name} 不在了`}>
    <p className="nd-copy nd-outcome">
      {done.won
        ? '它从火里出来的时候还是热的，但比进去的时候沉了一点。'
        : '你听见一声很脆的响。捞出来的只有几块认不出是什么的碎片。'}
    </p>
    <div className={`nd-quench ${done.won ? 'is-won' : 'is-lost'}`}>
      {done.won
        ? <div className="nd-quench-card"><RelicFace relic={relic}
            refine={{ tier: task.tier, lines: refineLines(relic.id, slot, task.tier) }} /></div>
        : <div className="nd-quench-ghost">
          <span className="nd-quench-name">{relic.name}</span>
          <span className="nd-quench-slot">{slot === 'main' ? '主槽' : '副槽'} 空了</span>
        </div>}
      <span className="nd-quench-flash" aria-hidden="true" />
    </div>
  </NodeShell>;
}

// -------------------------------------------------------------------- events

/**
 * 奇遇 — the question, then the answer.
 *
 * **Two steps, and the second one is why this is not a one-liner.** Answering an event sets the run's
 * `resolved`, and the moment that happens the page stops being an event screen at all: the dispatcher
 * moves on to the card picker or the relic draw the answer asked for. Committing the answer on the
 * click therefore skipped the outcome line entirely — the player picked 「徒手挖开」 and was looking at
 * a relic draw one frame later, with the sentence written for that exact choice never rendered
 * anywhere. `resolved` here is the local, uncommitted answer; `onContinue` is what hands it to the run.
 */
export function EventScreen({ event, run, onContinue, audioOn }: {
  event: EventSpec; run: ChapterRun; onContinue: (option: EventOption) => void; audioOn: boolean;
}) {
  const [answer, setAnswer] = useState<EventOption | null>(null);

  if (answer) {
    /**
     * The run as it will be **once 继续 is pressed** — not as it stands now.
     *
     * Two things were wrong with showing the current run here. The footer read 「生命 60/60」 on the
     * screen that had just cost the player 6 of them, and `outcome` is prose by design, so it never
     * said the number either — which left `金币` / `生命` / `生命上限` printed **nowhere at all**.
     *
     * Computed through `resolveEvent` rather than by hand: it is the same function `commitEvent`
     * calls, so this screen and the run cannot drift apart about what an option does. It is pure and
     * the result is only read, never stored — the run still moves exactly once, on the click.
     */
    const settled = resolveEvent(run, answer);
    return <NodeShell kind="event" scene="event" kicker="奇遇" title={event.name}
      actions={<button className="nd-primary" onPointerEnter={() => sound('hover', audioOn)}
        onClick={() => { sound('bell', audioOn); onContinue(answer); }}>
        继续
      </button>}
      footer={`生命 ${settled.hp}/${settled.maxHp} · 金币 ${settled.gold}`}>
      <p className="nd-copy nd-outcome">{answer.outcome}</p>
      <p className="nd-delta">{outcomeLine(answer)}</p>
    </NodeShell>;
  }

  return <NodeShell kind="event" scene="event" kicker="奇遇" title={event.name}
    footer={`生命 ${run.hp}/${run.maxHp} · 金币 ${run.gold}`}>
    <p className="nd-copy">{event.blurb}</p>
    <div className="nd-choices">
      {event.options.map((option, index) => {
        const affordable = canAfford(option, run.gold, run.hp);
        return <NodeChoice key={index} label={option.label} hint={option.hint} disabled={!affordable}
          onHover={() => sound('hover', audioOn)}
          onClick={() => { sound('select', audioOn); setAnswer(option); }}>
          {/* What it costs, printed. The `hint` says it in the floor's own voice — 「路很远」,
              「土是热的」 — and that voice is deliberately not a number, so the number has to come
              from somewhere. Without this line a greyed-out option reads as a bug rather than as a
              price the player cannot meet yet. */}
          {option.requires && <span className="nd-choice-cost">{costLine(option)}</span>}
        </NodeChoice>;
      })}
    </div>
  </NodeShell>;
}

/** 「需要 30 金币 · 6 生命」, from the option's own numbers. */
function costLine(option: EventOption): string {
  const parts: string[] = [];
  if (option.requires?.gold) parts.push(`${option.requires.gold} 金币`);
  if (option.requires?.hp) parts.push(`${option.requires.hp} 生命`);
  return `需要 ${parts.join(' · ')}`;
}

// --------------------------------------------------------------- card picker

export type CardTask = 'pick' | 'remove' | 'polish' | 'duplicate';

const TASK_COPY: Record<CardTask, { title: string; kicker: string; hint: string; cta: string }> = {
  pick: { title: '挑一张带走', kicker: '战利品', hint: '只有这一张会进牌组。', cta: '拿走' },
  remove: { title: '投进火里', kicker: '焚牌', hint: '它会被彻底拿走，这一局再也不会出现。', cta: '烧掉' },
  polish: { title: '磨一磨', kicker: '打磨', hint: '同一张牌，数值更高。', cta: '打磨' },
  duplicate: { title: '再要一份', kicker: '复制', hint: '牌组里会多出完全一样的一张。', cta: '复制' },
};

/**
 * The card picker, shared by every reward that asks for a card.
 *
 * `pick` chooses from cards the run does *not* have yet; the other three choose from the deck itself.
 * Both are shown as real card faces — a picker that lists names would be asking the player to
 * remember what a card does at the exact moment they are deciding whether they want it.
 */
export function CardPicker({ task, run, options, onChoose, onDismiss, onPass, audioOn }: {
  task: CardTask; run: ChapterRun; options: string[];
  onChoose: (index: number) => void;
  /** Settle the task and close the picker. Only 打磨 keeps it open past the choice. */
  onDismiss?: () => void;
  onPass?: () => void; audioOn: boolean;
}) {
  const copy = TASK_COPY[task];
  const [picked, setPicked] = useState<number | null>(null);
  /**
   * The card that was just polished, held up on its own.
   *
   * **Two screens, one decision.** The deck is updated the moment 打磨 is pressed, but the picker does
   * not close: it turns into a reveal of the one card that changed, and waits for 继续. The first
   * version committed and closed on a 660ms timer, and the player sat through it with no idea whether
   * anything had happened — a beat nobody can see is not feedback, it is a delay.
   *
   * Everything here is local state. The run moves exactly once, on the click, and `onChoose` is what
   * moves it — this only decides how long the result stays on screen.
   */
  const [struck, setStruck] = useState<number | null>(null);

  function commitPolish(index: number) {
    onChoose(index);
    setStruck(index);
    sound('polish', audioOn);
  }
  /** 继续 — the reveal is over. */
  function finishPolish() {
    setStruck(null);
    onDismiss?.();
  }

  // For `pick` the source is the offer; for the rest it is the deck, shown grouped so a deck of
  // twenty-eight does not read as twenty-eight separate decisions.
  const entries = useMemo(() => {
    if (task === 'pick') return options.map((cardId, index) => ({ cardId, index, upgraded: false, count: 1 }));
    return deckCounts(run).map(entry => ({
      cardId: entry.cardId,
      index: run.deck.findIndex(card => card.cardId === entry.cardId && !!card.upgraded === entry.upgraded),
      upgraded: entry.upgraded,
      count: entry.count,
    }));
  }, [task, options, run]);

  // 打磨 only offers cards that *can* be polished and have not been already, rather than letting the
  // player pick one and then silently doing nothing.
  const offered = task === 'polish'
    ? entries.filter(entry => !entry.upgraded && isUpgradable(entry.cardId))
    : entries;

  /**
   * The reveal.
   *
   * A card that has just been polished is *no longer on offer* — 「牌组里没有还能打磨的牌」 is the
   * correct filter, and it is why the first version of this screen showed nothing at all: the card
   * that had just changed **vanished from the row**, leaving the mark, the new text and the glow with
   * nowhere to land. The player pressed 打磨 and a card disappeared.
   *
   * So the picker gives way to the one card that changed, at full size, with 继续 underneath. Nothing
   * times out and nothing auto-closes: the screen stays until it is dismissed.
   */
  const struckEntry = struck === null ? null : entries.find(entry => entry.index === struck);
  if (struckEntry) {
    const card = CARD_BY_ID.get(struckEntry.cardId);
    return <NodeShell kind="treasure" scene="event" kicker="打磨 · 完成" title="它比原来更好用了"
      footer="数值已经写进这张牌，本局一直有效。"
      actions={<button className="nd-primary" onPointerEnter={() => sound('hover', audioOn)}
        onClick={() => { sound('bell', audioOn); finishPolish(); }}>
        继续
      </button>}>
      <div className="nd-reveal">
        {card && <CardFace card={card} upgraded polishing />}
      </div>
    </NodeShell>;
  }

  return <NodeShell kind="treasure" scene={task === 'remove' ? 'rest' : 'event'}
    kicker={copy.kicker} title={copy.title}
    footer={copy.hint}
    actions={<>
      <button className="nd-primary" disabled={picked === null}
        onPointerEnter={() => sound('hover', audioOn)}
        onClick={() => {
          if (picked === null) return;
          if (task === 'polish') { commitPolish(picked); return; }
          sound('relic-set', audioOn); onChoose(picked);
        }}>
        {picked === null ? '先点一张牌' : copy.cta}
      </button>
      {task === 'pick' && onPass && <button className="nd-ghost"
        onClick={() => { sound('select', audioOn); onPass(); }}>不要</button>}
    </>}>
    <div className="nd-cards">
      {offered.map(entry => {
        const card = CARD_BY_ID.get(entry.cardId);
        if (!card) return null;
        return <button key={`${entry.cardId}${entry.upgraded ? '+' : ''}`}
          className={`nd-card ${picked === entry.index ? 'on' : ''}`}
          onPointerEnter={() => sound('hover', audioOn)}
          onClick={() => { sound('select', audioOn); setPicked(entry.index); }}>
          {/* The face carries its own 已打磨 mark, so the wrapper only adds what the face cannot say:
              how many copies this is. Two marks saying the same thing on one card read as two
              different facts. */}
          <CardFace card={card} selected={picked === entry.index} upgraded={entry.upgraded} />
          {entry.count > 1 && <span className="nd-card-count">×{entry.count}</span>}
        </button>;
      })}
      {!offered.length && <p className="nd-empty">
        {task === 'polish' ? '牌组里没有还能打磨的牌。' : '牌组是空的。'}
      </p>}
    </div>
  </NodeShell>;
}
