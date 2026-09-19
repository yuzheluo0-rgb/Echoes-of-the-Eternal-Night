// Lossless atlas extraction followed by optimized WebP export. No visual retouching.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require(process.env.ART_MODULES ? path.join(process.env.ART_MODULES, 'sharp') : 'sharp');
const [environment, cards, enemies] = process.argv.slice(2);
async function main() {
  const out = path.resolve('public/assets');
  fs.mkdirSync(out, { recursive: true });
  await sharp(environment).webp({ quality: 90 }).toFile(path.join(out, 'graveyard.webp'));
  const cardMeta = await sharp(cards).metadata();
  const enemyMeta = await sharp(enemies).metadata();
  for (const [i, name] of ['blade', 'twin', 'execution', 'ember', 'shield', 'mirror'].entries()) {
    const w = Math.floor(cardMeta.width / 3); const h = Math.floor(cardMeta.height / 2);
    await sharp(cards).extract({ left: (i % 3) * w, top: Math.floor(i / 3) * h, width: w, height: h }).webp({ quality: 92 }).toFile(path.join(out, `card-${name}.webp`));
  }
  for (const [i, name] of ['wanderer', 'guardian', 'moth'].entries()) {
    const w = Math.floor(enemyMeta.width / 3);
    await sharp(enemies).extract({ left: i * w, top: 0, width: w, height: enemyMeta.height }).webp({ quality: 92 }).toFile(path.join(out, `enemy-${name}.webp`));
  }
  console.log('Exported 10 optimized scene, card, and enemy assets.');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
