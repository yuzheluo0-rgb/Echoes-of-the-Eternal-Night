import { useEffect, useRef, useState } from 'react';
import { Check, Music, Volume2, VolumeX, X } from 'lucide-react';
import { SCORES } from './worldScores';
import './world-score.css';

/** The sound button in the top-right rail, and the panel behind it. Both scores are synthesised live
 *  from note data, so the menu is a track list rather than a file picker. */
export default function WorldScoreMenu({ on, track, onToggle, onPick }: {
  on: boolean;
  track: string;
  onToggle: () => void;
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false), root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const container = root.current;
    const outside = (e: PointerEvent) => { if (!container?.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', outside);
    container?.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); container?.removeEventListener('keydown', escape); };
  }, [open]);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  return <div ref={root} className={`world-score ${open ? 'score-open' : ''}`}>
    <button ref={trigger} className="world-icon" aria-haspopup="dialog" aria-expanded={open} aria-label={on ? '声音已开启，打开配乐选择' : '声音已关闭，打开配乐选择'} onClick={() => setOpen(!open)}>{on ? <Volume2 size={18} /> : <VolumeX size={18} />}</button>
    {open && <div className="score-popover" role="dialog" aria-label="配乐与环境声"><div className="score-heading"><span>声景</span><button aria-label="关闭配乐选择" onClick={close}><X size={15} /></button></div>
      <p>全部由网页实时合成，没有音频文件。地貌环境声随所在风土变化，配乐随时可换。</p>
      <button className="score-power" aria-pressed={on} onClick={onToggle}>{on ? <Volume2 size={14} /> : <VolumeX size={14} />}<span>{on ? '声音已开启' : '声音已关闭'}</span><small>{on ? '点击静音' : '点击开启'}</small></button>
      <span className="score-label">原创配乐</span>
      {SCORES.map(score => <button key={score.id} className="score-item" aria-pressed={on && track === score.id} disabled={!on} onClick={() => onPick(score.id)}>
        <Music size={14} />
        <span className="score-copy"><strong>{score.name}</strong><small>{score.note}</small></span>
        {on && track === score.id && <Check className="score-check" size={13} />}
      </button>)}
      <p className="score-footnote">切换时环境声不会中断，曲目循环播放。关闭声音后仍会记住你的选择。</p>
    </div>}
  </div>;
}
