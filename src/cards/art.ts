/**
 * One search phrase per card, chosen so the photograph reads as the card's name and function rather
 * than as generic mood. `public/assets/cards/<id>.webp` is produced from it once by
 * `.work/cards-fetch-photos.cjs`; changing a phrase means re-running that script for that deck.
 *
 * Photographs come from Unsplash (Unsplash License: free for commercial use, no attribution
 * required). The one exception is the deck backs, which are searched the same way but are allowed
 * to be reused across a deck's cards — a back is meant to be uniform.
 */
export const CARD_QUERY: Record<string, string> = {
  // 断罪之刃 — blade work, sparks, forges, and the moment before a strike.
  'blade-01': 'katana blade edge macro dark moody',
  'blade-02': 'two crossed swords metal',
  'blade-03': 'antique dagger on dark wood',
  'blade-04': 'crossed swords dramatic light',
  'blade-05': 'glowing embers close up',
  'blade-06': 'scratched old iron surface rust',
  'blade-07': 'sword in leather scabbard dark',
  'blade-08': 'sparks flying metal grinding',
  'blade-09': 'campfire embers night',
  'blade-10': 'row of swords museum dark',
  'blade-11': 'broken sword blade',
  'blade-12': 'burning torch flame night',
  'blade-13': 'medieval armour detail',
  'blade-14': 'silhouette in fog dark',
  'blade-15': 'campfire watch night',
  'blade-16': 'heavy axe blade dark moody',
  'blade-17': 'rain drops on steel blade',
  'blade-18': 'blacksmith forge anvil sparks',
  'blade-19': 'broken armour plate',
  'blade-20': 'blood red fabric dark',
  'blade-21': 'sword and shield',
  'blade-22': 'collection of old knives dark',
  'blade-23': 'fire sacrifice ritual',
  'blade-24': 'long night sky stars',
  'blade-25': 'broken chain iron',
  'blade-26': 'eternal flame memorial',
  'blade-27': 'explosion fire blast',
  'blade-28': 'knives arranged on dark wall',

  // 燎原余烬 — ignition, wildfire, ash, and things that keep burning.
  'flame-01': 'match spark in darkness',
  'flame-02': 'stacked firewood logs',
  'flame-03': 'sparkler sparks night',
  'flame-04': 'candle flame macro',
  'flame-05': 'match igniting strike',
  'flame-06': 'smouldering embers covered',
  'flame-07': 'wildfire wind smoke',
  'flame-08': 'grass fire field night',
  'flame-09': 'falling ash particles',
  'flame-10': 'hands around campfire',
  'flame-11': 'candle flame close up dark',
  'flame-12': 'burning silhouette person',
  'flame-13': 'charred wood texture',
  'flame-14': 'kindling small fire',
  'flame-15': 'fire blast combustion',
  'flame-16': 'wall of fire dramatic',
  'flame-17': 'dramatic burning sky smoke',
  'flame-18': 'passing torch flame',
  'flame-19': 'burnt ashes grey texture',
  'flame-20': 'glowing furnace fire',
  'flame-21': 'burning coals red',
  'flame-22': 'old oil lamp lit',
  'flame-23': 'fire breathing dragon statue',
  'flame-24': 'blast furnace molten',
  'flame-25': 'stacked logs timber',
  'flame-26': 'charcoal pieces close up',
  'flame-27': 'inferno hellfire',
  'flame-28': 'everlasting flame lamp',
  // The twelve that fill the deck's four holes. Queries are literal, because the scoring pass
  // rewards saturation and edge density and a phrase like 「灰烬」 alone returns sunset skies.
  'flame-29': 'burnt wood ashes grey',
  'flame-30': 'hands warming by campfire close up',
  'flame-31': 'glowing charcoal embers bed',
  'flame-32': 'burning grass field wildfire',
  'flame-33': 'dark storm clouds dramatic sky',
  'flame-34': 'explosion fire burst sparks dark',
  'flame-35': 'burned forest aftermath blackened trees',
  'flame-36': 'forging hot steel glowing',
  'flame-37': 'feeding logs into fire',
  'flame-38': 'intense bright flames close up',
  'flame-39': 'match igniting flame start',
  'flame-40': 'dying embers last glow',

  // 长明壁垒 — stone, bone, fortification, and things that do not move.
  'bone-01': 'ornate round shield',
  'bone-02': 'animal bone spike',
  'bone-03': 'stacked stone cairn',
  'bone-04': 'battering ram timber',
  'bone-05': 'heavy stone wall moss',
  'bone-06': 'split stone close up',
  'bone-07': 'whetstone sharpening',
  'bone-08': 'stacked bones dark',
  'bone-09': 'weathered stone statue',
  'bone-10': 'embers in hand',
  'bone-11': 'wooden barricade stakes',
  'bone-12': 'falling rocks landslide',
  'bone-13': 'sharpening blade stone',
  'bone-14': 'thorn branch close',
  'bone-15': 'charred skull bone',
  'bone-16': 'shockwave dust impact',
  'bone-17': 'mirror reflecting wall',
  'bone-18': 'standing stone megalith dark',
  'bone-19': 'dry bone close up dark',
  'bone-20': 'iron gate rivets dark',
  'bone-21': 'molten metal casting',
  'bone-22': 'giant boulder rock',
  'bone-23': 'crumbling castle ruins',
  'bone-24': 'thorny branches close up',
  'bone-25': 'two silhouettes facing',
  'bone-26': 'siege castle ruins night',
  'bone-27': 'storm clouds breaking sky',
  'bone-28': 'ancient stone monument',

  // 千面回廊 — mirrors, reflections, glass, and doubled things.
  'mirror-01': 'broken mirror shards dark',
  'mirror-02': 'still water reflection dark lake',
  'mirror-03': 'stone corridor arches',
  'mirror-04': 'old forgotten objects dusty',
  'mirror-05': 'light through window dark room',
  'mirror-06': 'hands passing object',
  'mirror-07': 'mirror on old wall',
  'mirror-08': 'shadow cast long wall dark',
  'mirror-09': 'looking into mirror',
  'mirror-10': 'shattered mirror pieces',
  'mirror-11': 'motion blur double exposure',
  'mirror-12': 'circular stone corridor',
  'mirror-13': 'kaleidoscope pattern',
  'mirror-14': 'infinity mirror lights',
  'mirror-15': 'shadow cast on wall',
  'mirror-16': 'layered glass reflections abstract',
  'mirror-17': 'embers reflecting in water',
  'mirror-18': 'steel blade reflecting light',
  'mirror-19': 'two faces profile facing',
  'mirror-20': 'shattered glass impact',
  'mirror-21': 'glass shards scattered dark',
  'mirror-22': 'kaleidoscope colourful pattern',
  'mirror-23': 'twins silhouette dark',
  'mirror-24': 'sunset reflection lake',
  'mirror-25': 'pouring liquid splash dark',
  'mirror-26': 'hall of mirrors ornate',
  'mirror-27': 'infinite corridor perspective',
  'mirror-28': 'nebula deep space colourful',

  // 中立 — carried by every deck, so the art stays on the mechanic rather than on a mood.
  'neutral-01': 'gathering firewood kindling hands',
  'neutral-02': 'balanced stacked stones',
  'neutral-03': 'whetstone sharpening knife blade',
  'neutral-04': 'sparks flying dark fire',
  'neutral-05': 'dark reflection in glass',
  'neutral-06': 'breath steam cold air',
  'neutral-07': 'old brass horn dark',
  'neutral-08': 'stone wall with flames',
  'neutral-09': 'molten metal pouring',
  'neutral-10': 'afterglow sunset dramatic sky',

  // 照壁's echo. Not a library card — it is conjured by 回响 and lives in `OFF_DECK_CARDS` — but the
  // player holds it in their hand and looks at it, so it gets a face like any other. The search is
  // deliberately literal: a wall that has come apart, which is what 「残壁」 means.
  'echo-01': 'broken stone wall rubble collapse',
};

/**
 * A deck's back is one image, reused by every card in that deck — a back is meant to be uniform, and
 * it is the only thing a player sees before the card is drawn. The brief was cosmic and prismatic
 * rather than another dark texture, so each back is a mineral or celestial form that suits its
 * archetype: shattered glass for the blade, a nebula for the flame, ice for the wall, and a
 * kaleidoscope for the hall of mirrors.
 */
export const BACK_QUERY: Record<string, string> = {
  blade: 'shattered glass shards macro blue',
  flame: 'nebula galaxy orange pink stars',
  bone: 'ice crystal macro dark blue',
  mirror: 'kaleidoscope prism light refraction',
};
