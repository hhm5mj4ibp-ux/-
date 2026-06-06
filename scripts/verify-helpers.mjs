/** Playwright: ルーレット→ダイス→配牌演出をスキップして対局可能状態まで進める */
export async function skipToPlayableHand(page){
  await page.evaluate(() => {
    try { localStorage.setItem('hm_rules_primer_skip', '1'); } catch (_e) {}
  });
  await page.waitForSelector('button.btn-new', { state: 'visible', timeout: 15000 });
  await page.click('button.btn-new');
  await page.waitForFunction(
    () => document.getElementById('dealer-roulette')?.classList.contains('hidden'),
    null,
    { timeout: 25000 }
  );

  for (let i = 0; i < 8; i++) {
    const visible = await page.$('#deal-dice:not(.hidden)');
    if (!visible) break;
    const btn = await page.$('#deal-dice-roll-btn');
    if (!btn) break;
    await btn.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
  }

  await page.waitForSelector('#deal-cinema:not(.hidden)', { timeout: 12000 }).catch(() => {});
  await page.evaluate(() => {
    if (typeof DEAL_CINEMA_SKIP !== 'undefined') DEAL_CINEMA_SKIP = true;
    const ov = document.getElementById('deal-cinema');
    if (ov && !ov.classList.contains('hidden')) ov.click();
  });

  await page.waitForFunction(
    () => {
      const g = typeof G !== 'undefined' && G;
      return g && !g.dealCinemaActive && g.players?.[0]?.hand?.length >= 13;
    },
    null,
    { timeout: 30000 }
  );
}
