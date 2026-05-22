import { chromium } from 'playwright';
import { pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { skipToPlayableHand } from './verify-helpers.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const htmlUrl = pathToFileURL(join(root, 'harbin-mahjong.html')).href;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(htmlUrl);
await skipToPlayableHand(page);

const report = await page.evaluate(() => {
  const g = G;
  const p0 = g.players[0];
  const handFaces = [...document.querySelectorAll('#human-hand .tile.hand-face')];
  const imgs = handFaces.map(el => el.querySelector('img')).filter(Boolean);
  const loaded = imgs.filter(img => img.complete && img.naturalWidth > 0).length;
  const northTiles = document.querySelectorAll('#top-area .north-hand-row .tile').length;
  return {
    wall: g.wall.length,
    handLen: p0.hand.length,
    handFaces: handFaces.length,
    imgsLoaded: loaded,
    northTiles,
    dealActive: !!g.dealCinemaActive,
  };
});

await browser.close();

let failed = false;
if (report.dealActive) {
  console.error('deal cinema still active');
  failed = true;
}
if (report.wall < 50 || report.wall > 60) {
  console.error(`wall count out of range: ${report.wall}`);
  failed = true;
}
if (report.handLen < 13) {
  console.error(`human hand too short: ${report.handLen}`);
  failed = true;
}
if (report.handFaces < 13) {
  console.error(`human hand-face tiles: ${report.handFaces}`);
  failed = true;
}
if (report.imgsLoaded < 13) {
  console.error(`hand sheet images loaded: ${report.imgsLoaded}/${report.handFaces}`);
  failed = true;
}
if (report.northTiles < 13) {
  console.error(`north hand tiles in DOM: ${report.northTiles}`);
  failed = true;
}

if (failed) process.exit(1);
console.log('post-deal verification passed', report);
