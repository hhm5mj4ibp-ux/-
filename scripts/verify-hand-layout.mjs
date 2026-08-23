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
    const scroller = el.closest('.human-rack-scroll') || document.querySelector('.human-rack-scroll');
    const allowX = !!(scroller && (label === 'human-hand' || label === 'human-rack') &&
      ['auto', 'scroll'].includes(getComputedStyle(scroller).overflowX));
    const clipped = tiles.filter(tile => {
      const t = tile.getBoundingClientRect();
      if(t.top < -0.5 || t.bottom > vh + 0.5) return true;
      if(allowX) return false;
      return t.left < -0.5 || t.right > vw + 0.5;
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

async function forceThirteenTileHands(page){
  await page.evaluate(() => {
    if(typeof G === 'undefined' || !G?.players) return;
    G.dealCinemaActive = false;
    for(const p of G.players){
      const hand = p.hand || [];
      while(hand.length < 13) hand.push({ suit: 'z', num: 5 });
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
      if(el.classList?.contains('human-rack-scroll')) return false;
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
    const scroller = document.querySelector('.human-rack-scroll') || document.querySelector('#bottom-area');
    const rr = scroller?.getBoundingClientRect();
    const ox = scroller ? getComputedStyle(scroller).overflowX : 'hidden';
    const allowX = ox === 'auto' || ox === 'scroll';
    const outside = tiles.filter(t => rr && (
      t.top < rr.top - 1 || t.bottom > rr.bottom + 1 ||
      (!allowX && (t.left < rr.left - 1 || t.right > rr.right + 1))
    )).length;
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

function dockHandOverlap(page){
  return page.evaluate(() => {
    const dock = document.querySelector('#action-bar');
    const hand = document.querySelector('#human-hand');
    if(!dock || !hand) return { missing: true, hits: 0 };
    const a = dock.getBoundingClientRect();
    const tiles = [...hand.querySelectorAll('.tile')].map(el => el.getBoundingClientRect());
    let hits = 0;
    for(const t of tiles){
      const ox = Math.min(a.right, t.right) - Math.max(a.left, t.left);
      const oy = Math.min(a.bottom, t.bottom) - Math.max(a.top, t.top);
      if(ox > 0.5 && oy > 0.5) hits++;
    }
    return { missing: false, hits };
  });
}

function promptHandOverlap(page){
  return page.evaluate(() => {
    const prompts = [...document.querySelectorAll('#table-prompt, #table-prompt .message, #table-prompt .callout-tile, .message.mj-slip, .callout-tile')];
    const tiles = [...document.querySelectorAll('#human-hand .tile')].map(el => el.getBoundingClientRect());
    let hits = 0;
    for(const p of prompts){
      const a = p.getBoundingClientRect();
      if(a.width < 1 || a.height < 1) continue;
      for(const t of tiles){
        const ox = Math.min(a.right, t.right) - Math.max(a.left, t.left);
        const oy = Math.min(a.bottom, t.bottom) - Math.max(a.top, t.top);
        if(ox > 0.5 && oy > 0.5) hits++;
      }
    }
    return { hits, promptCount: prompts.length };
  });
}

function riverTileSizeReport(page, sel){
  return page.evaluate((sel) => {
    const tiles = [...document.querySelectorAll(sel)].map(el => el.getBoundingClientRect());
    if(!tiles.length) return { missing: true, minW: 0, minH: 0, count: 0 };
    const minW = tiles.reduce((m, r) => Math.min(m, r.width), 99);
    const minH = tiles.reduce((m, r) => Math.min(m, r.height), 99);
    return { missing: false, minW: Math.round(minW * 10) / 10, minH: Math.round(minH * 10) / 10, count: tiles.length };
  }, sel);
}

function sideMeldReport(page, side){
  return page.evaluate((side) => {
    const root = document.querySelector(side === 'left' ? '#left-area' : '#right-area');
    const hand = root?.querySelector('.side-col');
    const meld = root?.querySelector('.melds-row') || root?.querySelector('.meld-group');
    if(!root || !hand || !meld) return { missing: true };
    const h = hand.getBoundingClientRect();
    const m = meld.getBoundingClientRect();
    const overlapX = Math.min(h.right, m.right) - Math.max(h.left, m.left);
    const gapX = overlapX > 0 ? 0 : (m.left >= h.right ? m.left - h.right : h.left - m.right);
    const handMidY = (h.top + h.bottom) / 2;
    const meldMidY = (m.top + m.bottom) / 2;
    const dy = Math.abs(handMidY - meldMidY);
    const felt = document.querySelector('.table-felt')?.getBoundingClientRect();
    const tableH = felt ? felt.height : window.innerHeight;
    const towardCenter = side === 'left'
      ? m.left + 2 >= h.left
      : m.right <= h.right + 2;
    return {
      missing: false,
      gapX: Math.round(gapX * 10) / 10,
      dy: Math.round(dy * 10) / 10,
      farCorner: dy > tableH * 0.28,
      towardCenter,
      meldLeft: Math.round(m.left),
      handLeft: Math.round(h.left),
    };
  }, side);
}

function riverSelfOverlap(page, sel){
  return page.evaluate((sel) => {
    const tiles = [...document.querySelectorAll(sel)].map(el => el.getBoundingClientRect());
    let hits = 0;
    for(let i = 0; i < tiles.length; i++){
      for(let j = i + 1; j < tiles.length; j++){
        const a = tiles[i], b = tiles[j];
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if(ox > 0.5 && oy > 0.5) hits++;
      }
    }
    return { hits, count: tiles.length };
  }, sel);
}

function riverFillOrder(page, rootSel){
  return page.evaluate((rootSel) => {
    const root = document.querySelector(rootSel);
    if(!root) return { missing: true };
    const cells = [...root.querySelectorAll('.discard-cell:not(.river-ghost)')].map(el => el.getBoundingClientRect());
    if(cells.length < 8) return { missing: false, short: true, n: cells.length };
    const a = cells[0], b = cells[1], g = cells[6];
    return {
      missing: false,
      short: false,
      ltr: b.left > a.left + 1,
      nextRowBelow: g.top > a.top + 2,
      firstTop: Math.round(a.top),
      seventhTop: Math.round(g.top),
      firstLeft: Math.round(a.left),
      secondLeft: Math.round(b.left),
    };
  }, rootSel);
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
  await forceThirteenTileHands(page);

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
    if(pass.name === '13'){
      const thirteen = await humanHandSelfOverlap(page);
      if(thirteen.hits > 0){
        console.error(`[${vp.name}] human-hand self-overlap@13 hits=${thirteen.hits} minW=${thirteen.minW}`);
        failed = true;
      }else if((vp.name === 'iphone-portrait' || vp.name === 'iphone-portrait-safari') && thirteen.minW < 18){
        console.error(`[${vp.name}] human-hand minW=${thirteen.minW} (want >=18)`);
        failed = true;
      }
    }
  }

  const selfOv = await humanHandSelfOverlap(page);
  if(selfOv.hits > 0 || selfOv.outside > 0){
    console.error(`[${vp.name}] human-hand self-overlap hits=${selfOv.hits} outside=${selfOv.outside} minW=${selfOv.minW} n=${selfOv.count}`);
    failed = true;
  }else if((vp.name === 'iphone-portrait' || vp.name === 'iphone-portrait-safari') && selfOv.count <= 13 && selfOv.minW < 18){
    console.error(`[${vp.name}] human-hand minW=${selfOv.minW} (want >=18)`);
    failed = true;
  }else{
    console.log(`[${vp.name}] human-hand tiles separate (minW=${selfOv.minW})`);
  }

  const fourteenClip = await clipReport(page, '#human-hand', 'human-hand-14');
  if(!fourteenClip.missing && fourteenClip.clipped > 0){
    console.error(`[${vp.name}] human-hand-14: ${fourteenClip.clipped}/${fourteenClip.tileCount} tiles clipped`);
    failed = true;
  }else if(!fourteenClip.missing){
    console.log(`[${vp.name}] human-hand-14: ok (${fourteenClip.tileCount} tiles)`);
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
    if(!dock.tall && dock.width < dock.vw * 0.85){
      console.error(`[${vp.name}] landscape dock not full-width w=${dock.width} vw=${dock.vw}`);
      failed = true;
    }
    if(dock.menuClipped){
      console.error(`[${vp.name}] menu button clipped`);
      failed = true;
    }
    if(!dock.inGrid && !dock.clickToDiscard && !dock.menuClipped && !(dock.tall && dock.width < dock.vw * 0.7) && !(!dock.tall && dock.width < dock.vw * 0.85)){
      console.log(`[${vp.name}] dock ok (w=${dock.width})`);
    }
  }

  const dockOv = await dockHandOverlap(page);
  if(dockOv.missing){
    console.error(`[${vp.name}] dock/hand missing for overlap`);
    failed = true;
  }else if(dockOv.hits > 0){
    console.error(`[${vp.name}] action-bar covers human-hand hits=${dockOv.hits}`);
    failed = true;
  }else{
    console.log(`[${vp.name}] dock vs hand: ok`);
  }

  await page.evaluate(() => {
    if(typeof G === 'undefined') return;
    G.msg = 'どうしますか？';
    if(typeof render === 'function') render();
  });
  await page.waitForTimeout(50);
  const promptOv = await promptHandOverlap(page);
  if(promptOv.promptCount < 1){
    console.error(`[${vp.name}] table prompt missing`);
    failed = true;
  }else if(promptOv.hits > 0){
    console.error(`[${vp.name}] prompt covers human-hand hits=${promptOv.hits}`);
    failed = true;
  }else{
    console.log(`[${vp.name}] prompt vs hand: ok`);
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
  for(const [seat, sel] of [
    ['west', '#left-discards .tile'],
    ['east', '#right-discards .tile'],
    ['south', '#human-discards .tile'],
    ['north', '#north-discards .tile'],
  ]){
    const self = await riverSelfOverlap(page, sel);
    if(self.hits > 0){
      console.error(`[${vp.name}] ${seat} river self-overlap hits=${self.hits} n=${self.count}`);
      failed = true;
    }else{
      console.log(`[${vp.name}] ${seat} river tiles separate (${self.count})`);
    }
  }
  for(const [seat, sel] of [
    ['south', '#human-discards'],
    ['north', '#north-discards'],
    ['west', '#left-discards'],
    ['east', '#right-discards'],
  ]){
    const fill = await riverFillOrder(page, sel);
    if(fill.missing){
      console.error(`[${vp.name}] ${seat} river missing for fill order`);
      failed = true;
    }else if(fill.short){
      console.error(`[${vp.name}] ${seat} river fill short n=${fill.n}`);
      failed = true;
    }else if(!fill.ltr || !fill.nextRowBelow){
      console.error(`[${vp.name}] ${seat} river fill not top-left LTR then down ltr=${fill.ltr} below=${fill.nextRowBelow} firstTop=${fill.firstTop} seventhTop=${fill.seventhTop} firstLeft=${fill.firstLeft} secondLeft=${fill.secondLeft}`);
      failed = true;
    }else{
      console.log(`[${vp.name}] ${seat} river fill: ok`);
    }
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
  if(ghosts.south || ghosts.north || ghosts.west || ghosts.east){
    console.error(`[${vp.name}] river ghosts still present: ${JSON.stringify(ghosts)}`);
    failed = true;
  }else{
    console.log(`[${vp.name}] river ghosts: none`);
  }
  for(const [seat, sel] of [
    ['west', '#left-discards .tile'],
    ['east', '#right-discards .tile'],
    ['south', '#human-discards .tile'],
    ['north', '#north-discards .tile'],
  ]){
    const size = await riverTileSizeReport(page, sel);
    if(size.missing || size.count < 1){
      console.error(`[${vp.name}] ${seat} river tiles missing`);
      failed = true;
    }else if((seat === 'west' || seat === 'east') && size.minW < 19.5){
      console.error(`[${vp.name}] ${seat} river minW=${size.minW} (want >=20)`);
      failed = true;
    }else if((seat === 'south' || seat === 'north') && size.minW < 21.5){
      console.error(`[${vp.name}] ${seat} river minW=${size.minW} (want >=22)`);
      failed = true;
    }else if(size.minW >= size.minH){
      console.error(`[${vp.name}] ${seat} river tile not upright ${size.minW}x${size.minH}`);
      failed = true;
    }else{
      console.log(`[${vp.name}] ${seat} river size: ok ${size.minW}x${size.minH}`);
    }
  }

  await page.evaluate(() => {
    if(typeof G === 'undefined' || !G?.players) return;
    const pon = (suit, num) => {
      const t = { suit, num };
      return { type: 'pon', tiles: [t, t, t], calledTile: t, from: 0 };
    };
    G.players[1].melds = [pon('p', 6)];
    G.players[3].melds = [pon('z', 7)];
    if(typeof render === 'function') render();
  });
  await page.waitForTimeout(80);
  for(const side of ['left', 'right']){
    const meld = await sideMeldReport(page, side);
    if(meld.missing){
      console.error(`[${vp.name}] ${side} meld missing beside hand`);
      failed = true;
    }else if(meld.gapX > 16){
      console.error(`[${vp.name}] ${side} meld gapX=${meld.gapX} from hand`);
      failed = true;
    }else if(meld.farCorner){
      console.error(`[${vp.name}] ${side} meld drifted from hand dy=${meld.dy}`);
      failed = true;
    }else{
      console.log(`[${vp.name}] ${side} meld beside hand: ok gapX=${meld.gapX} dy=${meld.dy}`);
    }
  }

  await page.evaluate(() => {
    if(typeof G === 'undefined' || !G?.players) return;
    G.dealCinemaActive = false;
    G.gameOver = false;
    G.phase = 'discard';
    G.turn = 0;
    G.msg = '';
    G.kouTingTreasurePending = false;
    G.kanBranchAOpts = null;
    G.kanTurnEnding = false;
    G.kouTingPick = false;
    G.players[0].kouTing = false;
    if(typeof UI !== 'undefined') UI.handSelectIdx = null;
    const hand = G.players[0].hand || [];
    while(hand.length < 14) hand.push({ suit: 'z', num: 5 });
    G.players[0].hand = hand;
    if(typeof render === 'function') render();
    const el = document.querySelector('#human-hand .tile[data-hand-i="1"]');
    if(el) el.click();
  });
  await page.waitForTimeout(40);
  const tap1 = await page.evaluate(() => ({
    selected: document.querySelector('#human-hand .tile.selected')?.getAttribute('data-hand-i') || null,
    discards: G?.players?.[0]?.discards?.length || 0,
    hasTile: !!document.querySelector('#human-hand .tile[data-hand-i="1"]'),
  }));
  if(!tap1.hasTile){
    console.error(`[${vp.name}] two-tap: hand tile missing`);
    failed = true;
  }else if(tap1.selected !== '1'){
    console.error(`[${vp.name}] two-tap: first tap did not select tile 1 selected=${tap1.selected}`);
    failed = true;
  }else{
    console.log(`[${vp.name}] two-tap select: ok`);
  }

  const dealer = await page.evaluate(() => {
    const marks = [...document.querySelectorAll('.dealer-mark, .dealer-wind-pip')];
    return {
      count: marks.length,
      texts: marks.map(el => (el.textContent || '').trim()),
    };
  });
  if(dealer.count < 1){
    console.error(`[${vp.name}] dealer mark missing`);
    failed = true;
  }else if(dealer.texts.some(t => /^(東|南|西|北|东)$/.test(t))){
    console.error(`[${vp.name}] dealer mark looks like wind: ${JSON.stringify(dealer.texts)}`);
    failed = true;
  }else{
    console.log(`[${vp.name}] dealer mark ok ${JSON.stringify(dealer.texts)}`);
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
