/**
 * 東西席の手牌・鳴き・捨てが自家 hand-face と同系（90度回転・同寸）かを計測し 0-100 で採点。
 * チー/ポン混在、左右捨て牌、チー選択中 UI も含めて見る。
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { pathToFileURL } from 'url';
import { skipToPlayableHand } from './verify-helpers.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const htmlUrl = pathToFileURL(join(root, 'harbin-mahjong.html')).href;
const shotDir = join(root, 'scripts', 'screenshots');
mkdirSync(shotDir, { recursive: true });

const PASS_SCORE = 90;

function pctClose(a, b, tolPct = 8){
  if(!a || !b) return false;
  const tol = Math.max(1.5, b * (tolPct / 100));
  return Math.abs(a - b) <= tol;
}

async function injectSideMeldsAndDiscards(page){
  await page.evaluate(() => {
    const t = (suit, num) => ({ suit, num });
    G.gameOver = false;
    G.roundOver = false;
    G.dealCinemaActive = false;
    G.handsRevealed = false;
    G.ktReveal = false;
    G.turn = 0;
    G.players[0].isHuman = true;
    G.players[0].kouTing = false;
    G.players[0].hand = [
      t('m', 1), t('m', 2), t('m', 3), t('m', 4),
      t('p', 2), t('p', 3), t('p', 4), t('p', 5),
      t('s', 2), t('s', 3), t('s', 4), t('s', 5), t('z', 5),
    ];
    G.players[1].melds = [
      { type: 'chi', tiles: [t('m', 1), t('m', 2), t('m', 3)], calledTile: t('m', 2), from: 0 },
      { type: 'pon', tiles: [t('s', 8), t('s', 8), t('s', 8)], calledTile: t('s', 8), from: 0 },
    ];
    G.players[3].melds = [
      { type: 'chi', tiles: [t('p', 3), t('p', 4), t('p', 5)], calledTile: t('p', 4), from: 0 },
      { type: 'pon', tiles: [t('z', 5), t('z', 5), t('z', 5)], calledTile: t('z', 5), from: 0 },
    ];
    G.players[1].discards = [t('m', 9), t('s', 1), t('p', 7), t('z', 5), t('m', 4)].map((tile, i) => ({ tile, claimed: i === 2 }));
    G.players[3].discards = [t('p', 1), t('m', 6), t('s', 9), t('p', 8), t('z', 5)].map((tile, i) => ({ tile, claimed: i === 1 }));
    G.pendingFrom = 1;
    G.pendingDiscard = t('m', 2);
    G.phase = 'after_discard';
    G.humanOptions = ['chi', 'skip'];
    G.chiOpts = [[t('m', 1), t('m', 3)]];
    render();
  });
  await page.waitForTimeout(250);
}

async function measure(page){
  return page.evaluate(() => {
    if (typeof G !== 'undefined' && G) {
      const t = (suit, num) => ({ suit, num });
      G.gameOver = false;
      G.roundOver = false;
      G.dealCinemaActive = false;
      G.turn = 0;
      G.phase = 'after_discard';
      G.pendingFrom = 1;
      G.pendingDiscard = t('m', 2);
      G.humanOptions = ['chi', 'skip'];
      G.chiOpts = [[t('m', 1), t('m', 3)]];
      if (typeof render === 'function') render();
    }
    const dims = (el) => {
      if(!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        w: r.width,
        h: r.height,
        x: r.left,
        y: r.top,
        cls: el.className,
        back: el.classList.contains('back'),
        handFace: el.classList.contains('hand-face'),
        oppHand: el.classList.contains('opp-hand'),
        has7198: !!el.querySelector('.tile-art .tile-art-img'),
        rotLeft: el.classList.contains('opp-rot-left'),
        rotRight: el.classList.contains('opp-rot-right'),
        transform: cs.transform,
      };
    };
    const pick = (sel) => dims(document.querySelector(sel));
    const all = (sel) => [...document.querySelectorAll(sel)].map(dims);
    const pairGaps = (sel) => {
      const tiles = [...document.querySelectorAll(sel)];
      const gaps = [];
      for(let i = 1; i < tiles.length; i++){
        const a = tiles[i - 1].getBoundingClientRect();
        const b = tiles[i].getBoundingClientRect();
        const horizontal = Math.max(0, b.left - a.right, a.left - b.right);
        const vertical = Math.max(0, b.top - a.bottom, a.top - b.bottom);
        gaps.push(Math.min(horizontal, vertical));
      }
      return gaps;
    };
    const groupInfo = (sel) => {
      const g = document.querySelector(sel);
      if(!g) return null;
      const cs = getComputedStyle(g);
      return { flexDir: cs.flexDirection, gap: cs.gap, count: g.querySelectorAll('.tile.hand-face.opp-hand').length };
    };
    const rowInfo = (sel) => {
      const row = document.querySelector(sel);
      if(!row) return null;
      const cs = getComputedStyle(row);
      const groups = [...row.querySelectorAll('.meld-group')].map(g => {
        const r = g.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
      });
      return { flexDir: cs.flexDirection, gap: cs.gap, groups };
    };
    return {
      human: pick('#human-hand .tile.hand-face:not(.back)'),
      chiButtons: document.querySelectorAll('.btn-chi').length,
      leftHand: pick('#left-area .side-col .tile.hand-face.opp-hand.back'),
      rightHand: pick('#right-area .side-col .tile.hand-face.opp-hand.back'),
      leftMelds: all('#left-area .side-rack .meld-group .tile.hand-face.opp-hand:not(.back)'),
      rightMelds: all('#right-area .side-rack .meld-group .tile.hand-face.opp-hand:not(.back)'),
      leftDiscards: all('#left-area .side-discards-zone .tile.hand-face.opp-hand.opp-disc:not(.back)'),
      rightDiscards: all('#right-area .side-discards-zone .tile.hand-face.opp-hand.opp-disc:not(.back)'),
      leftMeldGaps: pairGaps('#left-area .side-rack .meld-group:first-child .tile.hand-face.opp-hand'),
      rightMeldGaps: pairGaps('#right-area .side-rack .meld-group:first-child .tile.hand-face.opp-hand'),
      leftDiscardGaps: pairGaps('#left-area .side-discards-zone .tile.hand-face.opp-hand.opp-disc'),
      rightDiscardGaps: pairGaps('#right-area .side-discards-zone .tile.hand-face.opp-hand.opp-disc'),
      leftGroup: groupInfo('#left-area .side-rack .meld-group:first-child'),
      rightGroup: groupInfo('#right-area .side-rack .meld-group:first-child'),
      leftMeldRow: rowInfo('#left-area .side-rack .melds-row'),
      rightMeldRow: rowInfo('#right-area .side-rack .melds-row'),
    };
  });
}

function tileLikeHuman(tile, human, label, notes, options = {}){
  if(!tile){
    notes.push(`${label}: 要素なし`);
    return 0;
  }
  let score = 0;
  const artOk = options.faceDown ? true : tile.has7198;
  if(tile.handFace && tile.oppHand && artOk) score += 8;
  else notes.push(`${label}: hand-face/opp-hand/7198 不足 (${tile.cls})`);
  const hShort = Math.min(human.w, human.h);
  const hLong = Math.max(human.w, human.h);
  const tShort = Math.min(tile.w, tile.h);
  const tLong = Math.max(tile.w, tile.h);
  if(pctClose(tShort, hShort)) score += 5;
  else notes.push(`${label}: 短辺 ${tShort.toFixed(1)}px != 自家 ${hShort.toFixed(1)}px`);
  if(pctClose(tLong, hLong)) score += 5;
  else notes.push(`${label}: 長辺 ${tLong.toFixed(1)}px != 自家 ${hLong.toFixed(1)}px`);
  if(options.rotated){
    if(pctClose(tile.w, human.h, 4)) score += 3;
    else notes.push(`${label}: 回転後の横幅 ${tile.w.toFixed(1)}px != 自家高さ ${human.h.toFixed(1)}px`);
    if(pctClose(tile.h, human.w, 4)) score += 3;
    else notes.push(`${label}: 回転後の高さ ${tile.h.toFixed(1)}px != 自家幅 ${human.w.toFixed(1)}px`);
  }else{
    score += 6;
  }
  return score;
}

function scoreReport(m){
  const notes = [];
  let score = 0;
  if(!m.human){
    return { score: 0, notes: ['自家手牌(hand-face)が見つからない'] };
  }

  if(m.chiButtons > 0) score += 8;
  else notes.push('チー選択中 UI が作れていない');

  score += tileLikeHuman(m.leftHand, m.human, '左伏せ手牌', notes, { faceDown: true, rotated: true });
  score += tileLikeHuman(m.rightHand, m.human, '右伏せ手牌', notes, { faceDown: true, rotated: true });
  score += tileLikeHuman(m.leftMelds[0], m.human, '左チー鳴き', notes, { rotated: true });
  score += tileLikeHuman(m.rightMelds[0], m.human, '右チー鳴き', notes, { rotated: true });
  score += tileLikeHuman(m.leftDiscards[0], m.human, '左捨て牌', notes, { rotated: true });
  score += tileLikeHuman(m.rightDiscards[0], m.human, '右捨て牌', notes, { rotated: true });

  const expect = [
    ['左鳴き', m.leftMelds, m.leftGroup, m.leftMeldGaps, 'left', m.leftMeldRow],
    ['右鳴き', m.rightMelds, m.rightGroup, m.rightMeldGaps, 'right', m.rightMeldRow],
    ['左捨て', m.leftDiscards, null, m.leftDiscardGaps, 'left'],
    ['右捨て', m.rightDiscards, null, m.rightDiscardGaps, 'right'],
  ];
  for(const [label, tiles, group, gaps, rot, row] of expect){
    if(tiles.length >= 3) score += 4;
    else notes.push(`${label}: 牌数 ${tiles.length} (<3)`);
    if(group){
      // 鳴き面子は手牌列と同じ向きの縦積み（自家のように手牌の左へ伸びる1列）
      if(group.flexDir === 'column' && group.count >= 3) score += 3;
      else notes.push(`${label}: 面子グループ不正 ${JSON.stringify(group)}`);
    }
    if(row){
      const stackedV = row.groups.length >= 2 && Math.abs(row.groups[1].y - row.groups[0].y) > 4;
      if(row.flexDir === 'column' && (row.groups.length < 2 || stackedV)) score += 6;
      else notes.push(`${label}: 鳴き面子が縦積みではない ${JSON.stringify(row)}`);
    }
    const badGap = gaps.find(g => g > 3.5);
    if(badGap == null) score += 3;
    else notes.push(`${label}: 牌間 ${badGap.toFixed(1)}px (>3.5)`);
    const allRotOk = tiles.every(t => rot === 'left' ? t.rotLeft : t.rotRight);
    if(allRotOk) score += 3;
    else notes.push(`${label}: 回転クラス不一致`);
  }

  return { score: Math.min(100, score), notes };
}

const viewports = [
  { width: 390, height: 844, name: 'iphone-portrait' },
  { width: 844, height: 390, name: 'iphone-landscape' },
  { width: 360, height: 780, name: 'android-narrow' },
];

const browser = await chromium.launch();
const reports = [];
let failed = false;

for(const viewport of viewports){
  const page = await browser.newPage({ viewport });
  await page.goto(htmlUrl);
  await skipToPlayableHand(page);
  await page.waitForSelector('#human-hand .tile.hand-face', { timeout: 8000 });
  await injectSideMeldsAndDiscards(page);

  const measures = await measure(page);
  const { score, notes } = scoreReport(measures);
  const shotPath = join(shotDir, `side-parity-${viewport.name}.png`);
  await page.screenshot({ path: shotPath, fullPage: false });
  const report = { viewport: viewport.name, score, pass: score >= PASS_SCORE, measures, notes, screenshot: shotPath };
  reports.push(report);
  if(score < PASS_SCORE) failed = true;
  await page.close();
}

writeFileSync(join(shotDir, 'side-parity-report.json'), JSON.stringify(reports, null, 2));
console.log(JSON.stringify(reports, null, 2));
await browser.close();
process.exit(failed ? 1 : 0);
