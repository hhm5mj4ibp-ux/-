import { chromium } from 'playwright';
import { pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const htmlUrl = pathToFileURL(join(root, 'harbin-mahjong.html')).href;

function clipReport(page, selector, label){
  return page.evaluate(({ selector, label }) => {
    const el = document.querySelector(selector);
    if(!el) return { label, missing: true };
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const tiles = [...el.querySelectorAll('.tile')];
    const clipped = tiles.filter(tile => {
      const t = tile.getBoundingClientRect();
      return t.top < -0.5 || t.left < -0.5 || t.bottom > vh + 0.5 || t.right > vw + 0.5;
    }).length;
    return {
      label,
      missing: false,
      box: { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
      tileCount: tiles.length,
      clipped,
    };
  }, { selector, label });
}

const viewports = [
  { width: 390, height: 844, name: 'iphone-portrait' },
  { width: 844, height: 390, name: 'iphone-landscape' },
  { width: 360, height: 780, name: 'android-narrow' },
];

const browser = await chromium.launch();
let failed = false;

for(const vp of viewports){
  const page = await browser.newPage({ viewport: vp });
  await page.goto(htmlUrl);
  await page.click('button.btn-new');
  await page.waitForFunction(() => document.getElementById('dealer-roulette')?.classList.contains('hidden'), null, { timeout: 15000 });
  await page.waitForSelector('#human-hand .tile', { timeout: 5000 });

  const reports = await Promise.all([
    clipReport(page, '#left-area .side-col', 'left-hand'),
    clipReport(page, '#right-area .side-col', 'right-hand'),
    clipReport(page, '#human-hand', 'human-hand'),
    clipReport(page, '.human-rack', 'human-rack'),
  ]);

  for(const report of reports){
    if(report.missing){
      console.error(`[${vp.name}] ${report.label}: element missing`);
      failed = true;
      continue;
    }
    if(report.tileCount === 0){
      console.error(`[${vp.name}] ${report.label}: no tiles rendered`);
      failed = true;
      continue;
    }
    if(report.clipped > 0){
      console.error(`[${vp.name}] ${report.label}: ${report.clipped}/${report.tileCount} tiles clipped`);
      failed = true;
    }else{
      console.log(`[${vp.name}] ${report.label}: ok (${report.tileCount} tiles)`);
    }
  }
  await page.close();
}

await browser.close();
if(failed) process.exit(1);
console.log('hand layout verification passed');
