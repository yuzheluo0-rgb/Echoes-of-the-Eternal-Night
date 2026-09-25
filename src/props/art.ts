/**
 * One search phrase per prop, chosen so the photograph reads as the object the prop *is*.
 *
 * Same rule as the relics and the cards: **name the object first, then the lighting and the
 * framing.** A prop is a small thing you carry and then spend, so the picture has to be a still
 * life or a macro of a physical object — a landscape or a person would say nothing about it.
 *
 * ⚠️ **Five words, no more.** Unsplash treats the whole string as a *phrase*, not as keywords, and a
 * long phrase comes back empty rather than merely imprecise. Measured directly:
 *
 *     brass whistle dark still life        45 photos
 *     brass whistle dark still life macro   0 photos
 *     bone dice dark still life            45 photos
 *     bone dice dark still life macro       0 photos
 *
 * Those two queries are what stalled the first pass: the fetch logged `nothing for "…"` with **zero
 * search errors**, because the page loaded fine and simply had no results. `props.test.ts` now
 * asserts the five-word ceiling so the next person finds out at test time instead of at fetch time.
 * A rare compound noun does the same thing at any length (`grindstone macro dark` → 0), so when one
 * of these comes back empty the fix is a more literal, more common word — not a longer phrase.
 *
 * ⚠️ **This set is more exposed to the "wrong subject" failure than the relics were.** Props are
 * tools: 袖炉, 磨石匣, 铅指套, 窥管. Every one of those words pulls up photographs of *people using
 * the thing* — hands, workbenches, a workshop, someone holding a compass. The relic round already
 * ate this once (`work-gloves` returned "a person at a workbench"), which is why `props.test.ts`
 * bans `holding / wearing / crafting / workbench` on top of the relic round's list, and why
 * `.work/props-fetch-photos.cjs` keeps the centre-focus score.
 *
 * `.work/props-fetch-photos.cjs` searches these, scores the candidates and keeps the best.
 */
export const PROP_QUERY: Record<string, string> = {
  // 转化 — one resource becoming another. The object is the *instrument* of the exchange.
  'blood-tap': 'dropper bottle dark still life',
  'shield-splinter': 'broken shield fragment dark',
  'ember-scale': 'brass balance scale dark',
  'gold-ash': 'gold coins ashes dark',
  'scorch-salve': 'tin salve jar dark',

  // 手牌 — things that reshape what is in your hand.
  'whetstone-kit': 'sharpening stone table',
  'blank-slip': 'blank paper note dark',
  'twin-needle': 'needle and thread dark',
  'lead-thimble': 'silver thimble macro',
  'index-card': 'library card catalog dark',
  'iron-comb': 'antique comb dark table',

  // 能量 — the small hot things.
  'ember-draught': 'glass bottle dark still life',
  'tailwind-flag': 'torn cloth flag dark',
  'slow-coal': 'charcoal lump macro dark',

  // 控制 — things that stop something else from moving.
  'frost-nail': 'rusty nails macro',
  'rust-knife': 'rusty knife blade macro dark',
  'brass-whistle': 'brass whistle dark still life',
  'binding-cord': 'coiled rope knot macro dark',

  // 生存 — the things you reach for when it is going badly.
  'staunch-moss': 'moss clump macro dark',
  'wall-seed': 'seed pod macro dark',
  'stub-candle': 'candle stub wax dark',
  'deep-root': 'tree root macro dark',

  // 仪祭 — objects that ask for something back.
  'night-office': 'old prayer book dark',
  'ash-oath': 'burnt paper ash dark',
  reliquary: 'wooden box dark still life',
  'hollow-tooth': 'tooth fossil dark',
  'grave-penny': 'stack of coins dark',

  // 状态 — the things that stack.
  'cinder-flask': 'flask dark glass still life',
  'ember-heart': 'glowing ember stone macro',
  'grindstone-dust': 'stone dust powder dark',
  'bastion-shard': 'stone wall fragment dark',

  // 赌 — you know the odds and you roll anyway.
  'sealed-letter': 'sealed envelope wax dark',
  'bone-dice': 'bone dice dark still life',
  'long-wager': 'old contract paper dark',

  // 工具 — the ones with more than one use left in them.
  'pocket-forge': 'portable brass stove dark',
  spyglass: 'brass spyglass dark',
  'clean-lamp': 'kerosene lamp dark'
};
