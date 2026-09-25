/**
 * 三个道具槽，排成一行。
 *
 * 从 `BattleDemo.tsx` 里抬出来，是因为**营火边也要有同一排**：那三件 `camp` 道具
 * （净灯 / 灰誓 / 袖炉）唯一合法的使用地点就是营火与战前准备，而战斗里那排只在战斗 JSX 里，
 * 于是它们一度「捡得到、用不掉」。
 *
 * ⚠️ **它不 import `src/battle/**`。** 所以「能不能用」与「为什么不能用」都是**调用方给的回调**，
 * 而不是这里去问引擎——战斗那边读的是 `state.props` 与 `canUseProp`，营火那边读的是
 * `run.props` 与 `canRunUseProp`，两边问的东西不一样。
 */
import { PROP_BY_ID, emptyProps, type PropSlotState } from './props.ts';
import { PropIcon } from './PropIcon';

export function PropRail({ slots, canUse, reasonFor, onUse, pick }: {
  /** 三个槽，定长。空槽画虚线洞。 */
  slots: PropSlotState[];
  canUse: (slot: number) => boolean;
  /** 灰掉的原因。一件点不动的道具读起来像 bug，除非它说自己为什么动不了。 */
  reasonFor?: (slot: number) => string | undefined;
  onUse: (slot: number) => void;
  /** 正在为哪一格挑手牌（磨石匣那种）。不传就是没有挑牌态。 */
  pick?: { slot: number; uids: string[] } | null;
}) {
  const filled = slots.length ? slots : emptyProps();
  return <div className="bd-hand-props">
    {filled.map((entry, slot) => {
      const prop = entry ? PROP_BY_ID.get(entry.id) : undefined;
      // 空槽只画虚线洞，**不写字**：68px 的格子里放不下可读的说明，而小号深色字在缩放的
      // 截图里会糊成一个叉——看不见的字比没有字更糟。语义交给 `title`。
      if (!prop || !entry) {
        return <span key={slot} className="bd-hand-prop bd-hand-prop-blank" title="空格 · 打赢一场有机会捡到道具" />;
      }
      const picking = pick?.slot === slot;
      return <div key={slot} className={`bd-hand-prop ${picking ? 'is-picking' : ''}`}>
        <PropIcon prop={prop} uses={entry.uses} compact disabled={!canUse(slot) && !picking}
          reason={picking ? `挑 ${prop.pick?.count ?? 0} 张牌（已挑 ${pick?.uids.length ?? 0} 张）` : reasonFor?.(slot)}
          onUse={() => onUse(slot)} />
      </div>;
    })}
  </div>;
}
