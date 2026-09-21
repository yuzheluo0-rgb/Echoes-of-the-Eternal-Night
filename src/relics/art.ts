/**
 * One search phrase per relic, chosen so the photograph reads as the object the relic *is*.
 *
 * Every phrase here is written to land on a **still life or a macro of a physical thing** — an
 * object, lit and photographed on its own. A relic is a thing you carry, so a photograph of a
 * landscape or a person would say nothing about it: 罗盘 has to be a compass on a table, not a
 * horizon. That is also why the abstract names in `relics.ts` (长夜之瞳, 织夜者, 长夜终章) all point
 * at concrete objects — a glass eye, a spindle, a book — rather than at the idea they stand for.
 *
 * Keywording follows the same rule as the card art: name the object first, then the lighting and the
 * framing. `.work/relics-fetch-photos.cjs` searches these, scores the candidates and keeps the best.
 */
export const RELIC_QUERY: Record<string, string> = {
  // 残片 — small found objects, the kind that live in a pocket.
  flint: 'dark stones rocks macro still life',
  whetstone: 'sharpening stone on table',
  'hemp-rope': 'rope coil natural fiber macro dark',
  'iron-nail': 'rusty iron nails macro dark',
  'dry-ration': 'dried bread loaf rustic dark still life',
  'copper-coin': 'old copper coins macro dark',
  'candle-stub': 'candle stub melted wax dark still life',
  'empty-vial': 'small glass vial bottle dark still life',
  'fish-bone': 'fish skeleton bones macro dark',
  'stone-shard': 'grey rock stone macro',
  'rope-knot': 'knotted rope macro dark',
  'wood-whistle': 'carved wooden whistle object dark',
  'dead-wick': 'burnt candle wick smoke macro dark',
  'chipped-bowl': 'empty ceramic bowl dark table',

  // 旧物 — working tools with a history.
  'brass-watch': 'antique brass pocket watch macro dark',
  'brass-key': 'old brass key macro dark still life',
  compass: 'vintage brass compass dark still life',
  hourglass: 'hourglass sand dark still life',
  'iron-bell': 'old metal bell dark rustic',
  'broken-comb': 'wooden hair comb dark',
  waterskin: 'leather flask bottle dark still life',
  'bone-whistle': 'carved bone object macro dark',
  'brass-mirror': 'round mirror frame still life',
  'salt-jar': 'small ceramic jar dark still life',
  'iron-tongs': 'blacksmith tongs tools dark',
  'work-gloves': 'leather gloves on table still life',
  'clay-lamp': 'clay oil lamp lit dark still life',
  'chain-link': 'heavy iron chain macro dark',
  'dry-herbs': 'dried herbs hanging dark rustic',
  'musket-balls': 'lead musket balls antique dark',
  'leather-bracer': 'leather armour straps dark still life',
  'charred-block': 'charred wood block macro dark',
  'old-map': 'old worn paper map dark still life',
  'tin-cup': 'old tin cup metal dark still life',
  'dog-tag': 'metal tag chain still life',
  'tar-lamp': 'oil lamp flame dark still life',

  // 珍品 — the first things worth carrying on purpose.
  'night-lantern': 'vintage lantern glowing dark still life',
  'ash-urn': 'ceramic urn vessel dark still life',
  ledger: 'old leather ledger book dark still life',
  'ember-seed': 'glowing ember macro dark',
  'broken-edge': 'knife blade macro dark',
  'twin-mirrors': 'mirror still life dark',
  'smith-hammer': 'old hammer tool dark still life',
  'hair-shirt': 'leather strap buckle dark macro',
  spyglass: 'antique brass telescope dark still life',
  'bone-ring': 'carved bone ring macro dark',
  'moss-jar': 'moss terrarium glass jar dark',
  'storm-wood': 'split wood grain macro dark',
  'brass-hand': 'carved wooden hand sculpture dark',
  'iron-mask': 'plain metal mask dark background',
  'burning-book': 'book on fire dark background',
  'bell-clapper': 'metal bell clapper object dark',

  // 秘宝 — objects that are obviously not from around here.
  'long-eye': 'glass eye marble macro dark',
  'endless-hourglass': 'wooden hourglass antique dark still life',
  'ember-heart': 'red gemstone macro',
  'mirror-throne': 'antique wooden chair dark',
  'watcher-oath': 'carved stone inscription dark macro',
  'verdict-scales': 'antique brass scales balance dark',
  'echo-box': 'wooden box lid closed dark',
  'cinder-furnace': 'cast iron brazier stove dark',
  'bone-crown': 'animal skull dark still life',
  'starfall-shard': 'meteorite stone fragment dark macro',
  'twin-souls': 'candles dark still life',
  'night-weaver': 'spool of thread dark still life',

  // 绝响 — one of one.
  'eternal-heart': 'black stone macro',
  'world-fire': 'burning coals macro dark',
  'thousand-mirror': 'kaleidoscope mirror macro dark',
  'unquenched-oath': 'eternal flame lamp dark still life',
  'sand-of-time': 'pouring sand macro dark',
  'watcher-remains': 'ancient bones remains macro dark',
  'final-chapter': 'closed old leather book dark',
};
