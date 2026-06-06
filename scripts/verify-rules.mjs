/**
 * 哈尔滨ルールの回帰テスト（嵌張・開門・宝中宝判定）。牌デザイン・レイアウトは対象外。
 */
import { chromium } from 'playwright';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const htmlUrl = pathToFileURL(join(root, 'harbin-mahjong.html')).href;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(htmlUrl);

const report = await page.evaluate(() => {
  const t = (s, n) => ({ suit: s, num: n });
  const notes = [];
  let pass = 0;
  const TOTAL = 7;

  const assert = (name, ok) => {
    if (ok) pass++;
    else notes.push(name);
  };

  const sampleMeld = [
    { type: 'chi', tiles: [t('p', 5), t('p', 6), t('p', 7)], calledTile: t('p', 6), from: 1 },
  ];

  // 単騎＋他待ち混在 → 嵌張限定で待ちなし
  const mixedHand = [
    t('m', 1), t('m', 1),
    t('m', 4), t('m', 5), t('m', 6),
    t('p', 2), t('p', 3), t('p', 4),
    t('s', 7), t('s', 8), t('s', 9),
    t('z', 5), t('z', 5),
  ];
  assert('mixed-waits-not-katan-only', standardWaits(mixedHand).length > 0 && getKatanWaits(mixedHand).length === 0);

  // 嵌張のみ待ち（探索で検証済みの10枚手牌）
  const katanOnlyHand = [
    t('m', 3), t('p', 1), t('s', 7), t('m', 9), t('m', 4),
    t('m', 8), t('m', 7), t('p', 1), t('s', 5), t('m', 5),
  ];
  const katanWait = t('s', 6);
  const katanWaits = getKatanWaits(katanOnlyHand);
  assert('katan-only-wait', katanWaits.length === 1 && katanWaits[0].suit === 's' && katanWaits[0].num === 6);

  const katanPlayer = { hand: katanOnlyHand, melds: sampleMeld, kouTing: true };
  assert('checkWin-katan', checkWin(katanPlayer, katanWait));

  // 開門なしは和了不可
  assert('checkWin-requires-meld', !checkWin({ hand: katanOnlyHand, melds: [], kouTing: true }, katanWait));

  // 扣聴入口も鳴き必須
  assert('shouldEnterKouTing-no-meld', !shouldEnterKouTing({ melds: [], hand: katanOnlyHand, kouTing: false }, katanWait));

  // 宝中宝: 待ちに宝が無いときは false
  G = { treasure: t('p', 9) };
  const handWithBaoDraw = [...katanOnlyHand, katanWait];
  const treasurePlayer = { kouTing: true, hand: handWithBaoDraw, melds: sampleMeld };
  assert('treasure-win-needs-wait', !playerWaitsForTreasure(treasurePlayer, t('p', 9)));

  // 待ちに宝を含む
  G.treasure = katanWait;
  assert('treasure-win-when-wait-matches', playerWaitsForTreasure(treasurePlayer, katanWait));

  return { pass, total: TOTAL, notes };
});

await browser.close();

if (report.notes.length) {
  console.error('rule verification failed:', report.notes);
  process.exit(1);
}
console.log(`rule verification passed (${report.pass}/${report.total})`);
