import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { skipToPlayableHand } from './verify-helpers.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const htmlUrl = pathToFileURL(join(root, 'harbin-mahjong.html')).href;
mkdirSync(join(root, 'scripts', 'screenshots'), { recursive: true });

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

function overlapReport(page){
  return page.evaluate(() => {
    const boxes = (sel) => [...document.querySelectorAll(sel)].map(el => {
      const r = el.getBoundingClientRect();
      return { t: r.top, b: r.bottom, l: r.left, r: r.right };
    });
    const hits = (a, b) => {
      let n = 0;
      for(const x of a){
        for(const y of b){
          const ox = Math.min(x.r, y.r) - Math.max(x.l, y.l);
          const oy = Math.min(x.b, y.b) - Math.max(x.t, y.t);
          if(ox > 0.5 && oy > 0.5) n++;
        }
      }
      return n;
    };
    const left = boxes('#left-area .side-col .tile');
    const right = boxes('#right-area .side-col .tile');
    const north = boxes('#top-area .north-hand-row .tile');
    const human = boxes('#human-hand .tile');
    return {
      leftHuman: hits(left, human),
      rightHuman: hits(right, human),
      northHuman: hits(north, human),
      leftNorth: hits(left, north),
      rightNorth: hits(right, north),
      counts: { left: left.length, right: right.length, north: north.length, human: human.length },
    };
  });
}

async function forceFourteenTileHands(page){
  await page.evaluate(() => {
    if(typeof G === 'undefined' || !G?.players) return;
    for(const p of G.players){
      const hand = p.hand || [];
      while(hand.length < 14) hand.push({ suit: 'z', num: 5 });
      p.hand = hand;
    }
    if(typeof render === 'function') render();
  });
  await page.waitForTimeout(80);
}

function sampleTiles(n){
  const pool = [
    ['m',1],['m',9],['p',3],['p',7],['s',2],['s',8],['z',5],['m',4],['p',5],['s',6],['m',6],['p',1],
  ];
  return Array.from({ length: n }, (_, i) => {
    const [suit, num] = pool[i % pool.length];
    return { tile: { suit, num }, claimed: false };
  });
}

async function injectCenteredRivers(page){
  await page.evaluate((discards) => {
    if(typeof G === 'undefined' || !G?.players) return;
    G.dealCinemaActive = false;
    G.gameOver = false;
    for(let i = 0; i < 4; i++) G.players[i].discards = discards;
    if(typeof render === 'function') render();
  }, sampleTiles(12));
  await page.waitForTimeout(80);
}

function riverOverlapReport(page){
  return page.evaluate(() => {
    const boxes = (sel) => [...document.querySelectorAll(sel)].map(el => {
      const r = el.getBoundingClientRect();
      return { t: r.top, b: r.bottom, l: r.left, r: r.right };
    });
    const hits = (a, b) => {
      let n = 0;
      for(const x of a){
        for(const y of b){
          const ox = Math.min(x.r, y.r) - Math.max(x.l, y.l);
          const oy = Math.min(x.b, y.b) - Math.max(x.t, y.t);
          if(ox > 0.5 && oy > 0.5) n++;
        }
      }
      return n;
    };
    const n = boxes('#north-discards .tile, .felt-heart .north-discards .tile');
    const s = boxes('#human-discards .tile');
    const w = boxes('#left-discards .tile, .west-discards .tile');
    const e = boxes('#right-discards .tile, .east-discards .tile');
    const heart = document.querySelector('#center-area.felt-heart');
    const humanRiver = document.querySelector('#human-discards');
    const inHeart = !!(heart && humanRiver && heart.contains(humanRiver));
    const grid = heart ? getComputedStyle(heart).gridTemplateAreas.replace(/\s+/g, ' ').trim() : '';
    return {
      northWest: hits(n, w),
      northEast: hits(n, e),
      southWest: hits(s, w),
      southEast: hits(s, e),
      counts: { n: n.length, s: s.length, w: w.length, e: e.length },
      inHeart,
      grid,
    };
  });
}

function scrollbarReport(page){
  return page.evaluate(() => {
    const nodes = [
      document.documentElement,
      document.body,
      document.querySelector('#app'),
      document.querySelector('.mj-table'),
      document.querySelector('.table-felt'),
      document.querySelector('.felt-play-column'),
      document.querySelector('#center-area'),
      document.querySelector('#human-discards'),
      document.querySelector('.north-discards'),
    ];
    const vw = window.innerWidth;
    const overflow = nodes.filter(Boolean).filter(el => {
      const ox = getComputedStyle(el).overflowX;
      if(ox === 'hidden' || ox === 'clip') return false;
      return el.scrollWidth > el.clientWidth + 1;
    }).map(el => ({
      name: el.id || el.className?.toString?.().split(' ')[0] || el.tagName,
      sw: Math.round(el.scrollWidth),
      cw: Math.round(el.clientWidth),
      ox: getComputedStyle(el).overflowX,
    }));
    const docOverflow = document.documentElement.scrollWidth > vw + 1;
    return { docOverflow, vw, overflow };
  });
}

function humanHandSelfOverlap(page){
  return page.evaluate(() => {
    const tiles = [...document.querySelectorAll('#human-hand .tile')].map(el => el.getBoundingClientRect());
    let hits = 0;
    for(let i = 0; i < tiles.length; i++){
      for(let j = i + 1; j < tiles.length; j++){
        const a = tiles[i], b = tiles[j];
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if(ox > 0.5 && oy > 0.5) hits++;
      }
    }
    const minW = tiles.reduce((m, r) => Math.min(m, r.width), 99);
    const rack = document.querySelector('#bottom-area');
    const rr = rack?.getBoundingClientRect();
    const outside = tiles.filter(t => rr && (t.left < rr.left - 1 || t.right > rr.right + 1)).length;
    return { hits, count: tiles.length, minW: Math.round(minW * 10) / 10, outside };
  });
}

function dockReport(page){
  return page.evaluate(() => {
    const dock = document.querySelector('#action-bar');
    const col = document.querySelector('.felt-play-column');
    const menu = document.querySelector('#action-bar .btn-menu');
    if(!dock) return { missing: true };
    const r = dock.getBoundingClientRect();
    const mr = menu?.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const inGrid = !!(col && col.contains(dock));
    const menuClipped = !!(mr && (mr.left < -0.5 || mr.right > vw + 0.5 || mr.bottom > vh + 0.5));
    return {
      missing: false,
      inGrid,
      width: Math.round(r.width),
      left: Math.round(r.left),
      vw,
      tall: vh >= vw,
      menuClipped,
      clickToDiscard: /クリックして捨てる/.test(dock.textContent || ''),
    };
  });
}

const viewports = [
  { width: 390, height: 844, name: 'iphone-portrait' },
  { width: 390, height: 810, name: 'iphone-portrait-safari' },
  { width: 844, height: 390, name: 'iphone-landscape' },
  { width: 360, height: 780, name: 'android-narrow' },
];

const browser = await chromium.launch();
let failed = false;

for(const vp of viewports){
  const page = await browser.newPage({ viewport: vp });
  await page.goto(htmlUrl);
  await skipToPlayableHand(page);
  await page.waitForSelector('#human-hand .tile.hand-face', { timeout: 8000 });

  const reports = await Promise.all([
    clipReport(page, '#left-area .side-col', 'left-hand'),
    clipReport(page, '#right-area .side-col', 'right-hand'),
    clipReport(page, '#top-area .north-hand-row', 'north-hand'),
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
    if(report.label === 'north-hand' && report.tileCount < 13){
      console.error(`[${vp.name}] ${report.label}: only ${report.tileCount} tiles (expected >=13)`);
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

  const overlapPasses = [
    { name: '13', setup: null },
    { name: '14', setup: () => forceFourteenTileHands(page) },
  ];
  for(const pass of overlapPasses){
    if(pass.setup) await pass.setup();
    const ov = await overlapReport(page);
    const pairs = ['leftHuman', 'rightHuman', 'northHuman', 'leftNorth', 'rightNorth'];
    const bad = pairs.filter(k => ov[k] > 0);
    if(bad.length){
      console.error(`[${vp.name}] overlap ${pass.name}: ${bad.map(k => `${k}=${ov[k]}`).join(' ')} counts=${JSON.stringify(ov.counts)}`);
      failed = true;
    }else{
      console.log(`[${vp.name}] overlap ${pass.name}: ok (${ov.counts.left}/${ov.counts.north}/${ov.counts.right}/${ov.counts.human})`);
    }
  }

  const selfOv = await humanHandSelfOverlap(page);
  if(selfOv.hits > 0 || selfOv.outside > 0){
    console.error(`[${vp.name}] human-hand self-overlap hits=${selfOv.hits} outside=${selfOv.outside} minW=${selfOv.minW} n=${selfOv.count}`);
    failed = true;
  }else{
    console.log(`[${vp.name}] human-hand tiles separate (minW=${selfOv.minW})`);
  }

  const dock = await dockReport(page);
  if(dock.missing){
    console.error(`[${vp.name}] action-bar missing`);
    failed = true;
  }else{
    if(dock.inGrid){
      console.error(`[${vp.name}] action-bar is inside .felt-play-column`);
      failed = true;
    }
    if(dock.clickToDiscard){
      console.error(`[${vp.name}] clickToDiscard still in dock`);
      failed = true;
    }
    if(dock.tall && dock.width < dock.vw * 0.7){
      console.error(`[${vp.name}] portrait dock too narrow w=${dock.width} vw=${dock.vw}`);
      failed = true;
    }
    if(dock.menuClipped){
      console.error(`[${vp.name}] menu button clipped`);
      failed = true;
    }
    if(!dock.inGrid && !dock.clickToDiscard && !dock.menuClipped && !(dock.tall && dock.width < dock.vw * 0.7)){
      console.log(`[${vp.name}] dock ok (w=${dock.width})`);
    }
  }

  await injectCenteredRivers(page);
  const rivers = await riverOverlapReport(page);
  if(!rivers.inHeart){
    console.error(`[${vp.name}] human-discards is not inside #center-area.felt-heart`);
    failed = true;
  }else{
    console.log(`[${vp.name}] rivers in heart: ok`);
  }
  const riverPairs = ['northWest', 'northEast', 'southWest', 'southEast'];
  const riverHits = riverPairs.filter(k => rivers[k] > 0);
  if(rivers.counts.n < 12 || rivers.counts.s < 12 || rivers.counts.w < 12 || rivers.counts.e < 12){
    console.error(`[${vp.name}] river counts short: ${JSON.stringify(rivers.counts)}`);
    failed = true;
  }
  if(riverHits.length){
    console.error(`[${vp.name}] river overlap: ${riverHits.map(k => `${k}=${rivers[k]}`).join(' ')} counts=${JSON.stringify(rivers.counts)}`);
    failed = true;
  }else{
    console.log(`[${vp.name}] river overlap: ok (${rivers.counts.n}/${rivers.counts.w}/${rivers.counts.e}/${rivers.counts.s})`);
  }
  const scroll = await scrollbarReport(page);
  if(scroll.docOverflow || scroll.overflow.length){
    console.error(`[${vp.name}] horizontal overflow: doc=${scroll.docOverflow} nodes=${JSON.stringify(scroll.overflow)}`);
    failed = true;
  }else{
    console.log(`[${vp.name}] no horizontal overflow`);
  }
  const handAfter = await overlapReport(page);
  const handBad = ['leftHuman', 'rightHuman', 'northHuman', 'leftNorth', 'rightNorth'].filter(k => handAfter[k] > 0);
  if(handBad.length){
    console.error(`[${vp.name}] overlap after rivers: ${handBad.map(k => `${k}=${handAfter[k]}`).join(' ')}`);
    failed = true;
  }

  await page.evaluate((discards) => {
    if(typeof G === 'undefined' || !G?.players) return;
    for(let i = 0; i < 4; i++) G.players[i].discards = discards;
    if(typeof render === 'function') render();
  }, sampleTiles(2));
  await page.waitForTimeout(80);
  const ghosts = await page.evaluate(() => ({
    south: document.querySelectorAll('#human-discards .discard-cell.river-ghost').length,
    north: document.querySelectorAll('#north-discards .discard-cell.river-ghost').length,
    west: document.querySelectorAll('#left-discards .discard-cell.river-ghost').length,
    east: document.querySelectorAll('#right-discards .discard-cell.river-ghost').length,
  }));
  if(ghosts.south < 4 || ghosts.north < 4 || ghosts.west < 4 || ghosts.east < 4){
    console.error(`[${vp.name}] river ghosts short: ${JSON.stringify(ghosts)}`);
    failed = true;
  }else{
    console.log(`[${vp.name}] river mats: ok ${JSON.stringify(ghosts)}`);
  }

  if(vp.name === 'iphone-portrait' || vp.name === 'iphone-portrait-safari' || vp.name === 'iphone-landscape'){
    const shotPath = join(root, 'scripts', 'screenshots', `rivers-${vp.name}.png`);
    await page.screenshot({ path: shotPath, fullPage: false });
    console.log(`[${vp.name}] screenshot ${shotPath}`);
  }
  await page.close();
}

await browser.close();
if(failed) process.exit(1);
console.log('hand layout verification passed');
