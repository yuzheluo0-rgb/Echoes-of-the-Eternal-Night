/** A deterministic, presentation-independent slice of the v1.0 combat rules. */
export type Suit = 'blade' | 'flame' | 'bone' | 'mirror';
export type Lane = 0 | 1 | 2;
export type CardId = 'C01' | 'C02' | 'C03' | 'C07' | 'C13' | 'C19';
export type EnemyId = 'E01' | 'E02' | 'E03' | 'E05';

export interface CardDefinition {
  id: CardId; name: string; suit: Suit; rank: number;
  description: string; lore: string; art: string;
}
export const SUITS: Record<Suit, { name: string; color: string; weapon: string }> = {
  blade: { name: '刃', color: '#cdb484', weapon: '回旋刃' },
  flame: { name: '焰', color: '#d58b68', weapon: '灰烬灯' },
  bone: { name: '骨', color: '#b6c7b5', weapon: '骨卫' },
  mirror: { name: '镜', color: '#88b9c0', weapon: '鸦镜' },
};
export const CARDS: Record<CardId, CardDefinition> = {
  C01: { id: 'C01', name: '割线', suit: 'blade', rank: 1, description: '造成 6 点伤害。', lore: '细如命线，利如终夜。', art: 'blade' },
  C02: { id: 'C02', name: '双刃', suit: 'blade', rank: 2, description: '连续攻击 2 次，每次造成 4 点伤害。', lore: '第一刃问路，第二刃送行。', art: 'twin' },
  C03: { id: 'C03', name: '终斩', suit: 'blade', rank: 5, description: '造成 8 点伤害。目标生命不高于一半时，造成 16 点伤害。', lore: '此后，再无回声。', art: 'execution' },
  C07: { id: 'C07', name: '火种', suit: 'flame', rank: 1, description: '造成 4 点伤害，并施加 2 层燃烧。', lore: '留一缕火，照见归途。', art: 'ember' },
  C13: { id: 'C13', name: '架盾', suit: 'bone', rank: 3, description: '获得 8 点护盾。', lore: '亡者的骨，生者的墙。', art: 'shield' },
  C19: { id: 'C19', name: '镜片', suit: 'mirror', rank: 4, description: '造成 5 点伤害。下一轮换牌上限 +1。', lore: '镜中那人，比你先回了头。', art: 'mirror' },
};
export interface CardInstance { uid: string; id: CardId }
export interface Enemy {
  uid: string; id: EnemyId; lane: Lane; hp: number; maxHp: number;
  armor: number; attack: number; burn: number; dead: boolean;
}
export const ENEMIES: Record<EnemyId, { name: string; hp: number; armor: number; attack: number; art: string; note: string }> = {
  E01: { name: '游尸', hp: 12, armor: 0, attack: 5, art: 'wanderer', note: '近战 · 仅前排行动' },
  E02: { name: '骨盾兵', hp: 20, armor: 2, attack: 4, art: 'guardian', note: '守卫 · 保护同路后排' },
  E03: { name: '灯蛾', hp: 8, armor: 0, attack: 3, art: 'moth', note: '远程 · 后排仍可攻击' },
  E05: { name: '瘟囊', hp: 10, armor: 0, attack: 0, art: 'wanderer', note: '死亡时对同路敌人造成 4 点伤害' },
};
export interface Wave { round: number; units: { id: EnemyId; lane: Lane }[]; entered: boolean }
export type EventKind = 'card' | 'damage' | 'shield' | 'burn' | 'weapon' | 'echo' | 'enemy' | 'death' | 'round' | 'info' | 'victory' | 'defeat';
export interface LogEntry { id: number; round: number; kind: EventKind; text: string }
export interface CombatState {
  version: 1; seed: number; rng: number; round: number;
  hp: number; maxHp: number; shield: number; echo: number;
  coins: number; xp: number; hand: CardInstance[]; draw: CardInstance[]; discard: CardInstance[];
  enemies: Enemy[]; waves: Wave[]; intentIds: string[];
  swapped: boolean; rung: boolean; swapBonus: number; nextSwapBonus: number;
  status: 'playing' | 'won' | 'lost'; log: LogEntry[];
}
export interface Plan { cards: string[]; lane: Lane; target?: string; keep?: string; frenzy: boolean }
export interface Formation { name: string; base: number; multiplier: number; pattern: string; shield: number; sameSuit?: Suit; whetstone: boolean }
export interface Frame { state: CombatState; kind: EventKind; text: string; target?: string; value?: number; beat?: number; suit?: Suit }

const clone = <T,>(v: T): T => structuredClone(v);
function random(s: CombatState): number {
  s.rng = (Math.imul(s.rng, 1664525) + 1013904223) >>> 0;
  return s.rng / 4294967296;
}
function shuffle(s: CombatState, cards: CardInstance[]): CardInstance[] {
  const out = [...cards];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random(s) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
function drawCards(s: CombatState, count: number) {
  for (let n = 0; n < count; n++) {
    if (!s.draw.length && s.discard.length) {
      s.draw = shuffle(s, s.discard); s.discard = [];
    }
    const card = s.draw.shift();
    if (card) s.hand.push(card);
  }
}
function log(s: CombatState, kind: EventKind, text: string) {
  s.log.push({ id: (s.log.at(-1)?.id ?? 0) + 1, round: s.round, kind, text });
  if (s.log.length > 160) s.log = s.log.slice(-160);
}
export function living(s: CombatState, lane?: Lane) {
  return s.enemies.filter(e => !e.dead && e.hp > 0 && (lane === undefined || e.lane === lane));
}
export function legalTargets(s: CombatState) {
  return living(s).filter(e => {
    const front = living(s, e.lane)[0];
    return front?.id !== 'E02' || front.uid === e.uid;
  });
}
function publishIntents(s: CombatState) {
  s.intentIds = living(s).filter(e => e.id === 'E03' || living(s, e.lane)[0]?.uid === e.uid).map(e => e.uid);
}
function enterWave(s: CombatState, wave: Wave, index: number) {
  wave.entered = true;
  wave.units.forEach((u, n) => {
    const def = ENEMIES[u.id];
    s.enemies.push({ uid: `w${index}-${n}`, id: u.id, lane: u.lane, hp: def.hp, maxHp: def.hp, armor: def.armor, attack: def.attack, burn: 0, dead: false });
  });
}
export function createCombat(seed = 7): CombatState {
  const s: CombatState = {
    version: 1, seed, rng: seed >>> 0, round: 1, hp: 60, maxHp: 60, shield: 0, echo: 0, coins: 50, xp: 0,
    hand: [], draw: [], discard: [], enemies: [], intentIds: [], swapped: false, rung: false,
    swapBonus: 0, nextSwapBonus: 0, status: 'playing', log: [],
    waves: [
      { round: 1, entered: false, units: ([0, 1, 2] as Lane[]).map(lane => ({ id: 'E01', lane })) },
      { round: 2, entered: false, units: [{ id: 'E03', lane: 0 }, { id: 'E02', lane: 1 }, { id: 'E03', lane: 2 }] },
      { round: 3, entered: false, units: ([0, 1, 2] as Lane[]).flatMap(lane => [{ id: 'E01' as const, lane }, { id: 'E05' as const, lane }]) },
    ],
  };
  const deck = (Object.keys(CARDS) as CardId[]).flatMap(id => [{ uid: `${id}-0`, id }, { uid: `${id}-1`, id }]);
  s.draw = shuffle(s, deck);
  drawCards(s, 6);
  s.hand.sort((a, b) => a.id.localeCompare(b.id));
  enterWave(s, s.waves[0], 0); publishIntents(s);
  log(s, 'round', '第 1 轮 · 灰烬中的脚步声渐近。');
  log(s, 'info', '三路游尸已入场。编排三拍，唤醒武器共鸣。');
  return s;
}
export function getFormation(cards: CardDefinition[]): Formation {
  let name = '散牌'; let base = 100;
  let pattern = '无印记奖励'; let shield = 0; let sameSuit: Suit | undefined;
  if (cards.length === 3) {
    const ranks = cards.map(c => c.rank).sort((a, b) => a - b);
    const count = new Set(ranks).size;
    if (count === 1) { name = '三同号'; base = 180; }
    else if (count === 2) { name = '对子'; base = 120; }
    else if (ranks[2] - ranks[0] === 2) { name = '顺阶'; base = 150; }
    const suits = new Set(cards.map(c => c.suit));
    if (suits.size === 3) { pattern = '三不同印'; shield = 8; }
    if (suits.size === 1) { pattern = '三同印'; sameSuit = cards[0].suit; }
  }
  const whetstone = cards.filter(c => c.suit === 'blade').length >= 2;
  return { name, base: base / 100, multiplier: (base + (whetstone ? 30 : 0)) / 100, pattern, shield, sameSuit, whetstone };
}
export function exchangeCards(source: CombatState, ids: string[]): CombatState {
  if (source.status !== 'playing' || source.swapped || !ids.length || ids.length > Math.min(4, 2 + source.swapBonus) || new Set(ids).size !== ids.length || ids.some(id => !source.hand.some(c => c.uid === id))) throw new Error('当前换牌选择无效。');
  const s = clone(source);
  const removed = s.hand.filter(c => ids.includes(c.uid));
  s.hand = s.hand.filter(c => !ids.includes(c.uid));
  drawCards(s, removed.length); // Returned instances are excluded until replacement finishes.
  s.discard.push(...removed); s.swapped = true;
  log(s, 'info', `换牌 ${removed.length} 张 · 本轮换牌机会已用完。`);
  return s;
}
export function ringBell(source: CombatState): CombatState {
  const index = source.waves.findIndex(w => !w.entered);
  if (source.status !== 'playing' || source.rung || index < 0) throw new Error('没有可以提前召入的波次。');
  const s = clone(source);
  enterWave(s, s.waves[index], index); s.rung = true; publishIntents(s);
  log(s, 'info', `敲钟 · 第 ${index + 1} 波提前入场，胜利额外获得 12 金币与 4 经验。`);
  return s;
}

export function resolveRound(source: CombatState, plan: Plan): { state: CombatState; frames: Frame[] } {
  if (source.status !== 'playing') throw new Error('战斗已经结束。');
  if (plan.cards.length > 3 || new Set(plan.cards).size !== plan.cards.length || plan.cards.some(id => !source.hand.some(c => c.uid === id))) throw new Error('最多编排三张不同实例的手牌。');
  if (plan.frenzy && source.echo < 12) throw new Error('狂奏需要 12 点回响。');
  if (plan.keep && (!source.hand.some(c => c.uid === plan.keep) || plan.cards.includes(plan.keep))) throw new Error('只能保留一张未使用的手牌。');
  if (![0, 1, 2].includes(plan.lane)) throw new Error('请选择合法主攻路。');
  if (plan.target && !legalTargets(source).some(e => e.uid === plan.target)) throw new Error('当前目标受到守卫保护或已经离场。');
  const s = clone(source); const frames: Frame[] = [];
  const selected = plan.cards.map(uid => CARDS[s.hand.find(c => c.uid === uid)!.id]);
  const formation = getFormation(selected);
  const multiplier100 = Math.round(formation.multiplier * 100);
  let roundEcho = 0; let beat: number | undefined;
  function emit(kind: EventKind, text: string, extra: Partial<Frame> = {}) {
    log(s, kind, text); frames.push({ state: clone(s), kind, text, beat, ...extra });
  }
  function gainShield(value: number, reason: string) {
    const actual = Math.min(value, 40 - s.shield); s.shield += actual;
    emit('shield', `${reason} · 护盾 +${actual}`, { value: actual, target: 'player' });
  }
  function target(): Enemy | undefined {
    const all = legalTargets(s);
    return all.find(e => e.uid === plan.target) ?? all.find(e => e.lane === plan.lane) ??
      all.filter(e => living(s, e.lane)[0]?.uid === e.uid).sort((a, b) => a.hp - b.hp || a.lane - b.lane)[0];
  }
  function deaths() {
    // Iterative ordered queue: each enemy is marked once, including explosion chains.
    const queue = s.enemies.filter(e => e.hp <= 0 && !e.dead).sort((a, b) => a.lane - b.lane);
    while (queue.length) {
      const enemy = queue.shift()!;
      if (enemy.dead) continue;
      enemy.dead = true; s.xp += 1;
      emit('death', `${ENEMIES[enemy.id].name} 消散 · 经验 +1`, { target: enemy.uid });
      if (enemy.id === 'E05') {
        const victims = living(s, enemy.lane);
        for (const e of victims) {
          const amount = Math.min(4, e.hp); e.hp -= amount;
          emit('damage', `瘟囊爆裂 · ${ENEMIES[e.id].name} 受到 ${amount} 点伤害`, { target: e.uid, value: amount, suit: 'flame' });
        }
        for (const e of victims) if (e.hp <= 0 && !e.dead) queue.push(e);
      }
    }
  }
  function hit(e: Enemy | undefined, raw: number, label: string, suit?: Suit) {
    if (!e) return { actual: 0, overflow: 0 };
    const adjusted = Math.max(0, raw - e.armor);
    const actual = Math.min(e.hp, adjusted); const overflow = Math.max(0, adjusted - e.hp);
    e.hp -= actual;
    emit('damage', `${label} → ${ENEMIES[e.id].name} · ${actual} 点伤害`, { target: e.uid, value: actual, suit });
    deaths(); return { actual, overflow };
  }
  function weapon(suit: 'blade' | 'bone', isEcho = false, ratio = 100) {
    const title = SUITS[suit].weapon;
    emit(isEcho ? 'echo' : 'weapon', `${title} · ${isEcho ? '回声' : beat === undefined ? '终奏' : '共鸣'}`, { suit });
    if (suit === 'bone' && !isEcho) gainShield(4, '骨卫');
    const damage = Math.floor((suit === 'blade' ? 6 : 4) * multiplier100 / 100);
    let dealt = false; let overflow = false;
    for (let i = 0; i < (suit === 'blade' ? 2 : 1); i++) {
      const result = hit(target(), Math.floor(damage * ratio / 100), title, suit);
      dealt ||= result.actual > 0; overflow ||= result.overflow >= 6;
    }
    if (!isEcho && dealt) {
      const gain = Math.min((overflow ? 2 : 1), 8 - roundEcho, 12 - s.echo);
      s.echo += gain; roundEcho += gain;
      if (gain) emit('info', `武器主奏 · 回响 +${gain}`);
    }
  }
  if (plan.frenzy) { s.echo -= 12; emit('echo', '狂奏发动 · 终奏后重放 50% 伤害回声'); }
  emit('info', `牌阵锁定 · ${formation.name} ×${formation.multiplier.toFixed(2)}${formation.shield ? ' · 三不同印' : ''}`);
  if (formation.shield) gainShield(formation.shield, '三不同印');
  for (let i = 0; i < 3; i++) {
    beat = i; const card = selected[i];
    if (!card) { gainShield(3, '空拍'); continue; }
    emit('card', `第 ${i + 1} 拍 · ${card.name}`, { suit: card.suit });
    switch (card.id) {
      case 'C01': hit(target(), 6, card.name, card.suit); break;
      case 'C02': hit(target(), 4, card.name, card.suit); hit(target(), 4, card.name, card.suit); break;
      case 'C03': { const e = target(); hit(e, e && e.hp <= e.maxHp / 2 ? 16 : 8, card.name, card.suit); break; }
      case 'C07': {
        const e = target(); hit(e, 4, card.name, card.suit);
        if (e && !e.dead) { e.burn = Math.min(30, e.burn + 2); emit('burn', `${ENEMIES[e.id].name} · 燃烧 +2`, { target: e.uid, value: 2, suit: 'flame' }); }
        break;
      }
      case 'C13': gainShield(8, card.name); break;
      case 'C19': hit(target(), 5, card.name, card.suit); s.nextSwapBonus = 1; break;
    }
    if (card.suit === 'blade' || card.suit === 'bone') weapon(card.suit);
  }
  beat = undefined;
  weapon('blade'); weapon('bone');
  if (formation.sameSuit) {
    if (formation.sameSuit === 'blade' || formation.sameSuit === 'bone') weapon(formation.sameSuit, true);
    else gainShield(6, '三同印返场 · 未装备对应武器');
  }
  if (plan.frenzy) { weapon('blade', true, 50); weapon('bone', true, 50); }
  const burning = living(s).filter(e => e.burn > 0);
  for (const e of burning) {
    const amount = Math.min(e.hp, e.burn); e.hp -= amount;
    emit('burn', `燃烧 → ${ENEMIES[e.id].name} · ${amount} 点伤害`, { target: e.uid, value: amount, suit: 'flame' });
  }
  deaths(); for (const e of burning) if (!e.dead) e.burn = Math.floor(e.burn / 2);
  for (const uid of s.intentIds) {
    const e = living(s).find(enemy => enemy.uid === uid);
    if (!e || !e.attack) continue;
    const blocked = Math.min(s.shield, e.attack); s.shield -= blocked;
    const hurt = e.attack - blocked; s.hp = Math.max(0, s.hp - hurt);
    emit('enemy', `${ENEMIES[e.id].name} 攻击 ${e.attack} · 护盾抵挡 ${blocked}${hurt ? ` · 生命 -${hurt}` : ''}`, { target: 'player', value: hurt });
    if (s.hp === 0) { s.status = 'lost'; emit('defeat', '灯火熄灭，长夜再临。'); break; }
  }
  if (s.status !== 'lost' && s.round >= 7) {
    const amount = 6 * (s.round - 6); s.hp = Math.max(0, s.hp - amount);
    emit('enemy', `灰潮侵袭 · 生命 -${amount}`, { target: 'player', value: amount });
    if (s.hp === 0) { s.status = 'lost'; emit('defeat', '灰潮吞没了最后一缕灯火。'); }
  }
  if (s.status !== 'lost' && !living(s).length && s.waves.every(w => w.entered)) {
    s.status = 'won'; s.coins += 24 + (s.rung ? 12 : 0); s.xp += s.rung ? 4 : 0;
    emit('victory', `长夜暂歇 · 获得 ${24 + (s.rung ? 12 : 0)} 金币${s.rung ? '与额外 4 经验' : ''}`);
  }
  const keep = s.hand.find(c => c.uid === plan.keep);
  s.discard.push(...s.hand.filter(c => c.uid !== keep?.uid)); s.hand = keep ? [keep] : [];
  return { state: s, frames };
}
export function beginNextRound(source: CombatState): CombatState {
  if (source.status !== 'playing') return clone(source);
  const s = clone(source); s.round++; s.shield = 0; s.swapped = false;
  s.swapBonus = s.nextSwapBonus; s.nextSwapBonus = 0;
  if (!living(s).length) {
    const future = s.waves.find(w => !w.entered);
    if (future && future.round > s.round) s.round = future.round;
  }
  s.waves.forEach((w, i) => { if (!w.entered && w.round <= s.round) enterWave(s, w, i); });
  drawCards(s, 6 - s.hand.length); publishIntents(s);
  log(s, 'round', `第 ${s.round} 轮 · 护盾清零，补足手牌。`);
  return s;
}

export function isValidSave(value: unknown): value is CombatState {
  if (!value || typeof value !== 'object') return false;
  const s = value as CombatState;
  if (s.version !== 1 || !Number.isInteger(s.round) || s.round < 1 || !Number.isInteger(s.hp) || s.hp < 0 || s.hp > 60 || s.maxHp !== 60 || !Number.isInteger(s.rng) || !['playing', 'won', 'lost'].includes(s.status)) return false;
  if (![s.shield, s.echo, s.xp, s.coins, s.seed, s.swapBonus, s.nextSwapBonus].every(Number.isInteger) || s.shield < 0 || s.shield > 40 || s.echo < 0 || s.echo > 12 || s.xp < 0 || s.coins < 0) return false;
  if (![s.hand, s.draw, s.discard, s.enemies, s.intentIds, s.waves, s.log].every(Array.isArray) || s.hand.length > 6 || s.waves.length !== 3) return false;
  const cards = [...s.hand, ...s.draw, ...s.discard];
  return cards.length === 12 && new Set(cards.map(c => c?.uid)).size === 12 && cards.every(c => c && typeof c.uid === 'string' && Object.hasOwn(CARDS, c.id)) &&
    s.enemies.every(e => e && Object.hasOwn(ENEMIES, e.id) && [0, 1, 2].includes(e.lane) && Number.isFinite(e.hp) && e.hp >= 0 && Number.isFinite(e.maxHp) && e.maxHp > 0 && typeof e.uid === 'string') &&
    s.waves.every(w => w && Array.isArray(w.units) && typeof w.entered === 'boolean' && w.units.every(u => u && Object.hasOwn(ENEMIES, u.id) && [0, 1, 2].includes(u.lane))) &&
    s.log.every(e => e && typeof e.text === 'string' && Number.isInteger(e.id));
}
