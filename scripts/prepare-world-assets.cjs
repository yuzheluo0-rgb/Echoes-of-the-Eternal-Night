// Re-encode the original generated atlas without modifying it.
// node scripts/prepare-world-assets.cjs <original PNG> [path to sharp module]
const fs = require('node:fs');
const path = require('node:path');
async function main() {
  const source = process.argv[2];
  if (!source || !fs.existsSync(source)) throw new Error('Supply the original atlas PNG path. See docs/world-art-prompts.md.');
  const sharp = require(process.argv[3] || 'sharp');
  const output = path.resolve(__dirname, '../public/assets/world'); fs.mkdirSync(output, { recursive: true });
  const metadata = await sharp(source).metadata(); const width = Math.floor(metadata.width / 4), height = Math.floor(metadata.height / 2);
  const names = ['grass', 'forest', 'desert', 'cliff', 'snow', 'ocean', 'blood', 'fog'];
  for (let i = 0; i < names.length; i++) await sharp(source).extract({ left: (i % 4) * width + 3, top: Math.floor(i / 4) * height + 3, width: width - 6, height: height - 6 }).resize(512, 512).webp({ quality: 88 }).toFile(path.join(output, `terrain-${names[i]}.webp`));
  await sharp(source).resize({ width: 1600 }).webp({ quality: 88 }).toFile(path.join(output, 'terrain-atlas.webp'));
  console.log('Prepared eight local terrain textures and the atlas preview.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
