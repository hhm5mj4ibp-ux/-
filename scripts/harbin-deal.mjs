/**
 * ハルビン麻雀（112枚）の配牌（ディール）
 * - 親から反時計回り
 * - 6枚（上下二段×三列）を1塊として2巡
 * - 親チョンチョン: 1枚 + 牌山2枚スキップ + 1枚
 * - 閑家各1枚補牌
 */

/** @param {number} seat 0..3 */
export function nextSeatCounterClockwise(seat) {
  return (seat + 3) % 4;
}

/** 親を先頭にした反時計回りの席順 */
export function dealOrderFromDealer(dealer) {
  const order = [];
  let s = dealer;
  for (let i = 0; i < 4; i++) {
    order.push(s);
    s = nextSeatCounterClockwise(s);
  }
  return order;
}

const CHUNK_SIZE = 6;
const CHUNK_ROUNDS = 2;
const AFTER_CHUNK = CHUNK_SIZE * CHUNK_ROUNDS; // 12
const DEALER_CHON_EXTRA = 2;
const CHILD_BU = 1;

/**
 * 牌山から各席へ配牌（wall は破壊的に先頭から消費）
 * @param {Array} wall 配牌用牌山（宝牌を除いた残り）
 * @param {number} dealer 親の real seat 0..3
 * @returns {{ hands: Array<Array>, wall: Array }}
 */
export function dealHarbinHands(wall, dealer) {
  const hands = [[], [], [], []];
  const order = dealOrderFromDealer(dealer);

  // 1–3. 6枚×2巡（各席12枚）
  for (let round = 0; round < CHUNK_ROUNDS; round++) {
    for (const seat of order) {
      if (wall.length < CHUNK_SIZE) {
        throw new Error(`wall_underflow_chunk round=${round} seat=${seat}`);
      }
      hands[seat].push(...wall.splice(0, CHUNK_SIZE));
    }
  }

  // 4. 親チョンチョン（2枚: 取・跳・取）
  if (wall.length < 1) throw new Error('wall_underflow_chon_1');
  hands[dealer].push(wall.shift());
  if (wall.length < 2) throw new Error('wall_underflow_chon_skip');
  wall.splice(0, 2);
  if (wall.length < 1) throw new Error('wall_underflow_chon_2');
  hands[dealer].push(wall.shift());

  // 5. 閑家各1枚
  for (const seat of order) {
    if (seat === dealer) continue;
    if (wall.length < 1) throw new Error(`wall_underflow_bu seat=${seat}`);
    hands[seat].push(wall.shift());
  }

  const check = validateHarbinHands(hands, dealer);
  if (!check.ok) {
    throw new Error(`harbin_deal_invalid: ${check.errors.join('; ')}`);
  }

  return { hands, wall };
}

/**
 * @param {Array<Array>} hands
 * @param {number} dealer
 */
export function validateHarbinHands(hands, dealer) {
  const errors = [];
  for (let s = 0; s < 4; s++) {
    const want = s === dealer ? AFTER_CHUNK + DEALER_CHON_EXTRA : AFTER_CHUNK + CHILD_BU;
    const got = hands[s]?.length ?? 0;
    if (got !== want) errors.push(`seat${s}:${got}!=${want}`);
  }
  const total = hands.reduce((n, h) => n + h.length, 0);
  if (total !== 53) errors.push(`total:${total}!=53`);
  return { ok: errors.length === 0, errors };
}

/** 演出用ステップ（real seat 基準） */
export function buildHarbinDealSteps(dealer) {
  const order = dealOrderFromDealer(dealer);
  const steps = [];
  for (let round = 0; round < CHUNK_ROUNDS; round++) {
    for (const seat of order) steps.push({ seat, count: CHUNK_SIZE, phase: 'chunk' });
  }
  steps.push({ seat: dealer, count: 1, phase: 'chon' });
  steps.push({ wallSkip: 2, phase: 'chon' });
  steps.push({ seat: dealer, count: 1, phase: 'chon' });
  for (let i = 1; i < order.length; i++) {
    steps.push({ seat: order[i], count: 1, phase: 'bu' });
  }
  return steps;
}

export const HARBIN_DEAL_CHUNK_SIZE = CHUNK_SIZE;
export const HARBIN_DEAL_CHUNK_ROUNDS = CHUNK_ROUNDS;
export const WALL_COLS_PER_SIDE = 14;
export const WALL_MAX_CHUNK_START = 11;

/** 親の2d6合計 → 開門者 seat（1,5,9=親…は (sum-1)%4 で席順に対応） */
export function openerSeatFromDealerDice(dealer, diceSum) {
  const order = dealOrderFromDealer(dealer);
  return order[(diceSum - 1) % 4];
}

/** 開門者の2d6合計 → 正面牌山左から空ける墩数の次（0-based 列） */
export function breakColumnFromDice(diceSum) {
  return Math.min(Math.max(diceSum, 2), WALL_MAX_CHUNK_START);
}

/** view 0=南(下) 1=西(左) 2=北(上) 3=東(右) — 開門者から反時計回りの牌壁 side */
export function wallSidesFromOpenerView(openerView) {
  const viewToSide = ['bottom', 'left', 'top', 'right'];
  const order = [];
  let v = openerView;
  for (let i = 0; i < 4; i++) {
    order.push(viewToSide[v]);
    v = nextSeatCounterClockwise(v);
  }
  return order;
}

export function rollD6() {
  return 1 + Math.floor(Math.random() * 6);
}
