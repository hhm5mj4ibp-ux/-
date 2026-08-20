import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  dealHarbinHands,
  openerSeatFromDealerDice,
  breakColumnFromDice,
  rollD6,
} from '../scripts/harbin-deal.mjs';
import {
  shopConfig,
  createCheckoutSession,
  retrieveCheckoutSession,
  sessionIsPaid,
  issuePremiumToken,
  verifyEntitlement,
  verifyStripeWebhook,
  successUrlFromEnv,
} from './shop.mjs';

const PORT = Number(process.env.PORT || 8787);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ROOM_TTL_MS = 1000 * 60 * 60 * 3;
const MAX_PLAYERS = 4;
const MIN_PLAYERS_TO_START = 2;
const MATCH_TOTAL_ROUNDS = 10;
/** オンラインAIは「ふつう」相当（オフライン難易度とは独立） */
const AI_LV = {
  pon: 0.58, chi: 0.48, minkan: 0.18, smartPick: true, defense: false, discardNoise: 0.07,
};

const rooms = new Map();
const clients = new Map();

const SUITS = ['m', 'p', 's'];
const namesJa = ['東', '南', '西', '北'];

function tileKey(t) {
  return `${t.suit}${t.num}`;
}
function tileEq(a, b) {
  return !!a && !!b && a.suit === b.suit && a.num === b.num;
}
function sortTiles(arr) {
  const order = { m: 0, p: 1, s: 2, z: 3 };
  return [...arr].sort((a, b) => order[a.suit] - order[b.suit] || a.num - b.num);
}
function countTile(arr, t) {
  return arr.filter((x) => tileEq(x, t)).length;
}
function uniq(arr) {
  return arr.filter((t, i) => arr.findIndex((x) => tileEq(x, t)) === i);
}
function removeTile(arr, t) {
  const idx = arr.findIndex((x) => tileEq(x, t));
  if (idx < 0) return null;
  return [...arr.slice(0, idx), ...arr.slice(idx + 1)];
}
function removeTiles(arr, tiles) {
  let out = [...arr];
  for (const t of tiles) {
    out = removeTile(out, t);
    if (!out) return null;
  }
  return out;
}
function nextPlayer(i) {
  return (i + 3) % 4;
}

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (let num = 1; num <= 9; num++) {
      for (let i = 0; i < 4; i++) deck.push({ suit, num });
    }
  }
  for (let i = 0; i < 4; i++) deck.push({ suit: 'z', num: 5 });
  return deck;
}

function shuffle(arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function allTileTypes() {
  const out = [];
  for (const suit of SUITS) for (let num = 1; num <= 9; num++) out.push({ suit, num });
  for (let i = 0; i < 4; i++) out.push({ suit: 'z', num: 5 });
  return out;
}

function isTriplet(tiles) {
  return tiles.length === 3 && tileEq(tiles[0], tiles[1]) && tileEq(tiles[1], tiles[2]);
}
function isSeq(tiles) {
  if (tiles.length !== 3) return false;
  const s = sortTiles(tiles);
  return s[0].suit === s[1].suit && s[1].suit === s[2].suit && s[0].suit !== 'z' &&
    s[1].num === s[0].num + 1 && s[2].num === s[1].num + 1;
}
function meldDecompositions(tiles) {
  if (tiles.length === 0) return [[]];
  const s = sortTiles(tiles), f = s[0], out = [];
  if (countTile(s, f) >= 3) {
    const r = removeTiles(s, [f, f, f]);
    if (r) for (const rest of meldDecompositions(r)) out.push([[f, f, f], ...rest]);
  }
  if (f.suit !== 'z' && f.num <= 7) {
    const f2 = { suit: f.suit, num: f.num + 1 }, f3 = { suit: f.suit, num: f.num + 2 };
    const r = removeTiles(s, [f, f2, f3]);
    if (r) for (const rest of meldDecompositions(r)) out.push([[f, f2, f3], ...rest]);
  }
  return out;
}
function winningDecompositions(fullHand) {
  if (fullHand.length % 3 !== 2) return [];
  const s = sortTiles(fullHand), out = [];
  for (const pair of uniq(s)) {
    if (countTile(s, pair) < 2) continue;
    const rest = removeTiles(s, [pair, pair]);
    if (!rest) continue;
    for (const melds of meldDecompositions(rest)) out.push({ pair: [pair, pair], melds });
  }
  return out;
}
function waitTypesForWin(hand, winTile) {
  const types = new Set();
  for (const d of winningDecompositions([...hand, winTile])) {
    if (d.pair.some((t) => tileEq(t, winTile))) types.add('tanki');
    for (const group of d.melds) {
      if (!group.some((t) => tileEq(t, winTile))) continue;
      if (isTriplet(group)) types.add('shanpon');
      else if (isSeq(group)) {
        const seq = sortTiles(group);
        types.add(tileEq(seq[1], winTile) ? 'katan' : 'side');
      }
    }
  }
  return types;
}
function isPureKatanWin(hand, winTile) {
  const types = waitTypesForWin(hand, winTile);
  return types.size === 1 && types.has('katan');
}
function standardWaits(hand) {
  if (hand.length < 4 || (hand.length - 1) % 3 !== 0) return [];
  return allTileTypes().filter((t) => countTile(hand, t) < 4 && winningDecompositions([...hand, t]).length > 0);
}
function getKatanWaits(hand) {
  const waits = standardWaits(hand);
  const katan = waits.filter((w) => isPureKatanWin(hand, w));
  return katan.length === waits.length ? katan : [];
}
function getChiOptions(hand, tile) {
  if (tile.suit === 'z') return [];
  const opts = [];
  for (const [n1, n2] of [[tile.num - 2, tile.num - 1], [tile.num - 1, tile.num + 1], [tile.num + 1, tile.num + 2]]) {
    if (n1 < 1 || n1 > 9 || n2 < 1 || n2 > 9) continue;
    const t1 = { suit: tile.suit, num: n1 }, t2 = { suit: tile.suit, num: n2 };
    if (hand.some((x) => tileEq(x, t1)) && hand.some((x) => tileEq(x, t2))) opts.push([t1, t2]);
  }
  return opts;
}
function canWin(game, seat, tile) {
  if (!game.melds[seat].length) return false;
  return isPureKatanWin(game.hands[seat], tile);
}

function expectedHandCount(game, seat) {
  return Math.max(1, 13 - game.melds[seat].length * 3);
}

function shouldEnterKouTing(game, seat, drawn) {
  if (!drawn || game.kouTing[seat] || !game.melds[seat].length) return false;
  const hand = game.hands[seat];
  const exp = expectedHandCount(game, seat);
  if (hand.length !== exp + 1) return false;
  const idx = hand.findIndex((t) => tileEq(t, drawn));
  if (idx < 0) return false;
  const basis = hand.filter((_, i) => i !== idx);
  if ((basis.length - 4) % 3 !== 0) return false;
  const waits = getKatanWaits(basis);
  return waits.length > 0 && waits.some((w) => isPureKatanWin(basis, w));
}

function getKouTingEntryDiscardIndices(game, seat) {
  if (game.kouTing[seat] || !game.melds[seat].length) return [];
  const hand = sortTiles([...game.hands[seat]]);
  const exp = expectedHandCount(game, seat);
  if (hand.length !== exp + 1) return [];
  const out = [];
  for (let i = 0; i < hand.length; i++) {
    const basis = hand.filter((_, j) => j !== i);
    const waits = getKatanWaits(basis);
    if (!waits.length) continue;
    if (!waits.some((w) => isPureKatanWin(basis, w))) continue;
    out.push(i);
  }
  return out;
}

function getTreasureScoreDeltas(winnerSeat, basePts = 12) {
  const d = [0, 0, 0, 0];
  d[winnerSeat] = basePts * 3;
  for (let s = 0; s < MAX_PLAYERS; s++) if (s !== winnerSeat) d[s] = -basePts;
  return d;
}

function kouTingWaitsMatchTreasure(game, seat) {
  if (!game?.kouTing[seat]) return false;
  const waits = getKatanWaits(game.hands[seat]);
  return waits.some((w) => tileEq(w, game.treasure));
}

/** 宝引き和了が宝中宝か（和了牌を除いた嵌張待ちに宝牌が含まれるか） */
function kouTingWaitsForTreasureTile(game, seat, winTile) {
  if (!game?.kouTing[seat] || !game.treasure || !winTile || !tileEq(winTile, game.treasure)) return false;
  const handWithout = removeTile([...game.hands[seat]], winTile);
  if (!handWithout) return false;
  return getKatanWaits(handWithout).some((w) => tileEq(w, game.treasure));
}

function finishTreasureDrawWin(room, seat, drawn) {
  const game = room.game;
  if (!canWin(game, seat, drawn)) return false;
  const isBao = kouTingWaitsForTreasureTile(game, seat, drawn);
  finishHand(room, { seat, type: 'tsumo', tile: drawn, treasure: isBao });
  return true;
}

function canOfferKouTingTreasureNow(game, seat) {
  if (!kouTingWaitsMatchTreasure(game, seat)) return false;
  return game.hands[seat].length === expectedHandCount(game, seat);
}

function maybeBeginKouTingTreasurePending(room, seat) {
  if (!canOfferKouTingTreasureNow(room.game, seat)) return false;
  if (isHumanSeat(room, seat)) return beginKouTingTreasurePending(room, seat);
  return tryFinishKouTingTreasureWin(room, seat);
}

/** 人間席: 宝中宝は「宝を見る」→「宝中宝」ボタンで和了（即終了しない） */
function beginKouTingTreasurePending(room, seat) {
  const game = room.game;
  if (!game || !canOfferKouTingTreasureNow(game, seat)) return false;
  game.kouTingTreasurePending = seat;
  game.kouTingTreasureSeen = false;
  game.treasureRevealed = game.kouTing.some((k, i) => k && i !== seat);
  game.phase = 'discard';
  game.turn = seat;
  game.pending = null;
  game.passed = [];
  bump(room);
  runAiUntilHuman(room);
  return true;
}

/** 扣聴成立直後: 待ち牌に宝牌が含まれれば宝中宝（AIは即和了） */
function tryFinishKouTingTreasureWin(room, seat) {
  const game = room.game;
  if (!game || !kouTingWaitsMatchTreasure(game, seat)) return false;
  if (isHumanSeat(room, seat)) return maybeBeginKouTingTreasurePending(room, seat);
  game.treasureUsed = true;
  game.treasureRevealed = true;
  finishHand(room, { seat, type: 'tsumo', tile: game.treasure, treasure: true });
  room.log.push({
    at: Date.now(),
    type: 'kou_ting_treasure',
    seat,
    tile: game.treasure,
  });
  bump(room);
  runAiUntilHuman(room);
  return true;
}

function maybeAutoEnterKouTing(game, seat, room) {
  const drawn = game.lastDraw?.seat === seat ? game.lastDraw.tile : null;
  if (!drawn || !shouldEnterKouTing(game, seat, drawn)) return false;
  if (!game.melds[seat].length) return false;
  game.kouTing[seat] = true;
  game.treasureRevealed = game.kouTing.some(Boolean);
  if (room && tryFinishKouTingTreasureWin(room, seat)) return true;
  return false;
}

function getKouTingLegalDiscardIndices(game, seat) {
  if (!game.kouTing[seat]) return [];
  const hand = sortTiles([...game.hands[seat]]);
  const exp = expectedHandCount(game, seat);
  const waits = getKatanWaits(hand.length === exp + 1 ? hand.filter((_, i) => i !== hand.length - 1) : hand);
  const keep = waits.length ? waits : null;
  const out = [];
  for (let i = 0; i < hand.length; i++) {
    const nh = hand.filter((_, j) => j !== i);
    const w = getKatanWaits(nh);
    if (!w.length) continue;
    if (keep && !keep.every((ww) => w.some((x) => tileEq(x, ww)))) continue;
    out.push(i);
  }
  if (hand.length === exp + 1) {
    const drawn = game.lastDraw?.seat === seat ? game.lastDraw.tile : hand[hand.length - 1];
    const di = hand.findIndex((t) => tileEq(t, drawn));
    if (di >= 0 && !out.includes(di)) out.push(di);
  }
  return out;
}

function roomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let tries = 0; tries < 20; tries++) {
    let code = '';
    for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
    if (!rooms.has(code)) return code;
  }
  return randomUUID().slice(0, 5).toUpperCase();
}

function makeRoom() {
  const id = roomCode();
  const now = Date.now();
  const room = {
    id,
    createdAt: now,
    updatedAt: now,
    hostId: null,
    version: 0,
    status: 'waiting',
    players: [],
    game: null,
    log: [],
  };
  rooms.set(id, room);
  return room;
}

function publicRoom(room) {
  return {
    id: room.id,
    version: room.version,
    status: room.status,
    hostId: room.hostId,
    players: room.players.map((p) => ({
      id: p.id,
      seat: p.seat,
      name: p.name,
      connected: p.connected,
      isHost: p.id === room.hostId,
    })),
    game: room.game
      ? {
          status: room.game.status,
          turn: room.game.turn,
          dealer: room.game.dealer,
          wallCount: room.game.wall.length,
          treasureRevealed: room.game.treasureRevealed,
          treasureUsed: room.game.treasureUsed,
          kouTing: room.game.kouTing,
          kouTingTreasurePending: room.game.kouTingTreasurePending ?? null,
          kouTingTreasureSeen: !!room.game.kouTingTreasureSeen,
          discards: room.game.discards,
          melds: room.game.melds,
          handCounts: room.game.hands.map((h) => h.length),
          phase: room.game.phase,
          pending: room.game.pending,
          winner: room.game.winner,
          dealBreak: room.game.dealBreak || null,
        }
      : null,
    match: room.match
      ? {
          round: room.match.round,
          totalRounds: room.match.totalRounds,
          scores: room.match.scores,
          finished: room.match.finished,
        }
      : null,
  };
}

function privateState(room, playerId) {
  const seat = room.players.find((p) => p.id === playerId)?.seat;
  if (seat == null || !room.game) return null;
  return {
    seat,
    hand: sortTiles(room.game.hands[seat]),
    treasure: room.game.kouTing[seat]
      && !(room.game.kouTingTreasurePending === seat && !room.game.kouTingTreasureSeen)
      ? room.game.treasure
      : null,
    lastDraw: room.game.lastDraw?.seat === seat ? room.game.lastDraw.tile : null,
    legalActions: legalActions(room.game, seat),
  };
}

function addPlayer(room, name = '') {
  const taken = new Set(room.players.map((p) => p.seat));
  let seat = -1;
  for (let i = 0; i < MAX_PLAYERS; i++) {
    if (!taken.has(i)) {
      seat = i;
      break;
    }
  }
  if (seat < 0) throw Object.assign(new Error('room_full'), { status: 409 });
  const player = {
    id: randomUUID(),
    seat,
    name: String(name || namesJa[seat]).slice(0, 24),
    connected: false,
    joinedAt: Date.now(),
  };
  room.players.push(player);
  if (!room.hostId) room.hostId = player.id;
  bump(room);
  return player;
}

function isHumanSeat(room, seat) {
  return room.players.some((p) => p.seat === seat && p.connected !== false);
}

function claimReactionOrder(fromSeat) {
  const out = [];
  let s = fromSeat;
  for (let i = 0; i < 3; i++) {
    s = nextPlayer(s);
    out.push(s);
  }
  return out;
}

function aiConcealedCore(hand, exp) {
  const h = sortTiles([...hand]);
  if (h.length === exp) return h;
  if (h.length === exp + 1) return h.slice(0, exp);
  return h;
}

function aiCountKatanBlocks(hand) {
  let n = 0;
  for (const suit of ['m', 'p', 's']) {
    for (let num = 1; num <= 7; num++) {
      const a = { suit, num };
      const b = { suit, num: num + 2 };
      if (hand.some((x) => tileEq(x, a)) && hand.some((x) => tileEq(x, b))) n++;
    }
  }
  return n;
}

function aiHandUtility(game, seat, hand) {
  const meldN = game.melds[seat]?.length || 0;
  const exp = Math.max(1, 13 - meldN * 3);
  const core = aiConcealedCore(hand, exp);
  if (core.length !== exp) return -80;
  let u = meldN * 14;
  const waits = getKatanWaits(core);
  u += waits.length * 48;
  if (!meldN) u -= 28;
  const all = [...core, ...(game.melds[seat] || []).flatMap((m) => m.tiles)];
  if (!all.some((t) => t.suit === 'z' || t.num === 1 || t.num === 9)) u -= 12;
  if (new Set(core.filter((t) => t.suit !== 'z').map((t) => t.suit)).size < 2 && meldN < 2) u -= 8;
  u += aiCountKatanBlocks(core) * 7;
  return u;
}

function aiFindSafeDiscardIndexKouTing(game, seat) {
  const hand = game.hands[seat];
  const leg = getKouTingLegalDiscardIndices(game, seat);
  if (!leg.length) return 0;
  let best = leg[0];
  let bestScore = Infinity;
  for (const i of leg) {
    const nh = hand.filter((_, j) => j !== i);
    const score = -aiHandUtility(game, seat, nh);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

function aiFindDiscardIndex(game, seat) {
  const hand = game.hands[seat];
  if (Math.random() < AI_LV.discardNoise) {
    return Math.floor(Math.random() * hand.length);
  }
  let bestIdx = 0;
  let bestScore = Infinity;
  for (let i = 0; i < hand.length; i++) {
    const nh = hand.filter((_, j) => j !== i);
    const score = -aiHandUtility(game, seat, nh);
    if (score < bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function aiChooseDiscardIndex(game, seat) {
  if (game.kouTing[seat]) return aiFindSafeDiscardIndexKouTing(game, seat);
  return aiFindDiscardIndex(game, seat);
}

function aiShouldClaimMeld(game, seat, tile, kind) {
  if (kind === 'chi' && Math.random() >= AI_LV.chi) return false;
  if (kind === 'minkan' && Math.random() >= AI_LV.minkan) return false;
  if (kind === 'pon' && Math.random() >= AI_LV.pon) return false;
  if (!AI_LV.smartPick) return true;
  const hand = game.hands[seat];
  const removed = kind === 'minkan' ? [tile, tile, tile] : [tile, tile];
  const nh = removeTiles(hand, removed);
  if (!nh) return false;
  const meldType = kind === 'minkan' ? 'kan' : 'pon';
  const after = aiHandUtility(game, seat, nh);
  const before = aiHandUtility(game, seat, hand);
  return after >= before - 6;
}

function applyAiClaimPhase(room) {
  const game = room.game;
  if (game.phase !== 'claim' || !game.pending) return false;
  const from = game.pending.from;
  const tile = game.pending.tile;
  const order = claimReactionOrder(from).filter((s) => !game.passed.includes(s));

  for (const seat of order) {
    if (isHumanSeat(room, seat)) continue;
    if (canWin(game, seat, tile)) {
      finishHand(room, {
        seat,
        type: 'ron',
        tile,
        from,
        discarderListening: game.lastDiscardMeta?.discarderListening,
      });
      room.log.push({ at: Date.now(), playerId: 'ai', seat, type: 'ron', payload: {} });
      return true;
    }
  }

  for (const seat of order) {
    if (isHumanSeat(room, seat) || game.kouTing[seat]) continue;
    if (countTile(game.hands[seat], tile) >= 3) {
      if (aiShouldClaimMeld(game, seat, tile, 'minkan')) {
        game.hands[seat] = removeTiles(game.hands[seat], [tile, tile, tile]);
        game.melds[seat].push({ type: 'kan', tiles: [tile, tile, tile, tile], from });
        game.turn = seat;
        game.phase = 'discard';
        game.pending = null;
        game.passed = [];
        game.skipDrawAfterCallBy = seat;
        room.log.push({ at: Date.now(), playerId: 'ai', seat, type: 'minkan', payload: {} });
        return true;
      }
    }
  }

  for (const seat of order) {
    if (isHumanSeat(room, seat) || game.kouTing[seat]) continue;
    if (countTile(game.hands[seat], tile) >= 2) {
      const needsPon = !game.melds[seat].some((m) => m.type === 'pon' || m.type === 'kan');
      if (needsPon || aiShouldClaimMeld(game, seat, tile, 'pon')) {
        game.hands[seat] = removeTiles(game.hands[seat], [tile, tile]);
        game.melds[seat].push({ type: 'pon', tiles: [tile, tile, tile], from });
        game.turn = seat;
        game.phase = 'discard';
        game.pending = null;
        game.passed = [];
        game.skipDrawAfterCallBy = seat;
        room.log.push({ at: Date.now(), playerId: 'ai', seat, type: 'pon', payload: {} });
        return true;
      }
    }
  }

  const chiSeat = nextPlayer(from);
  if (!game.passed.includes(chiSeat) && !isHumanSeat(room, chiSeat) && !game.kouTing[chiSeat]) {
    const opts = getChiOptions(game.hands[chiSeat], tile);
    const hasMeld = game.melds[chiSeat].some((m) => m.type === 'pon' || m.type === 'kan');
    if (opts.length && hasMeld && aiShouldClaimMeld(game, chiSeat, tile, 'chi')) {
      let opt = opts[0];
      if (AI_LV.smartPick) {
        let best = opts[0];
        let bestU = -Infinity;
        for (const pair of opts) {
          const nh = removeTiles(game.hands[chiSeat], pair);
          if (!nh) continue;
          const u = aiHandUtility(game, chiSeat, nh);
          if (u > bestU) {
            bestU = u;
            best = pair;
          }
        }
        opt = best;
      }
      game.hands[chiSeat] = removeTiles(game.hands[chiSeat], opt);
      game.melds[chiSeat].push({ type: 'chi', tiles: sortTiles([...opt, tile]), from });
      game.turn = chiSeat;
      game.phase = 'discard';
      game.pending = null;
      game.passed = [];
      game.skipDrawAfterCallBy = chiSeat;
      room.log.push({ at: Date.now(), playerId: 'ai', seat: chiSeat, type: 'chi', payload: { option: 0 } });
      return true;
    }
  }

  for (const seat of order) {
    if (isHumanSeat(room, seat)) continue;
    if (!game.passed.includes(seat)) {
      game.passed.push(seat);
      maybeAutoFinishClaim(game, room);
      room.log.push({ at: Date.now(), playerId: 'ai', seat, type: 'skip', payload: {} });
      return true;
    }
  }
  return false;
}

function applyAiDiscardTurn(room, seat) {
  const game = room.game;
  const exp = expectedHandCount(game, seat);

  if (game.kouTing[seat] && game.hands[seat].length === exp) {
    if (!game.wall.length) {
      if (!game.treasureUsed && game.kouTing[seat]) {
        game.treasureUsed = true;
        const drawn = game.treasure;
        game.hands[seat].push(drawn);
        game.lastDraw = { seat, tile: drawn };
        if (finishTreasureDrawWin(room, seat, drawn)) {
          room.log.push({
            at: Date.now(),
            playerId: 'ai',
            seat,
            type: 'tsumo',
            payload: { treasure: kouTingWaitsForTreasureTile(game, seat, drawn) },
          });
          return true;
        }
      } else {
        finishHand(room, { type: 'draw' });
        room.log.push({ at: Date.now(), playerId: 'ai', type: 'draw', payload: {} });
        return true;
      }
    } else {
      drawFor(game, seat, room);
      const tile = game.lastDraw?.seat === seat ? game.lastDraw.tile : null;
      if (tile && canWin(game, seat, tile)) {
        finishHand(room, { seat, type: 'tsumo', tile });
        room.log.push({ at: Date.now(), playerId: 'ai', seat, type: 'tsumo', payload: {} });
        return true;
      }
    }
  }

  const acts = legalActions(game, seat);
  if (acts.some((a) => a.type === 'tsumo')) {
    const tile = game.lastDraw?.seat === seat ? game.lastDraw.tile : null;
    if (tile && canWin(game, seat, tile)) {
      finishHand(room, { seat, type: 'tsumo', tile });
      room.log.push({ at: Date.now(), playerId: 'ai', seat, type: 'tsumo', payload: {} });
      return true;
    }
  }
  const idx = aiChooseDiscardIndex(game, seat);
  const tile = game.hands[seat][idx];
  if (!tile) return false;
  game.lastDiscardMeta = {
    from: seat,
    tile,
    discarderListening: isSeatListening(game, seat),
  };
  game.hands[seat].splice(idx, 1);
  game.discards[seat].push(tile);
  game.lastDiscard = { seat, tile };
  game.lastDraw = null;
  game.phase = 'claim';
  game.pending = { from: seat, tile };
  game.passed = [];
  maybeAutoFinishClaim(game, room);
  room.log.push({ at: Date.now(), playerId: 'ai', seat, type: 'discard', payload: { index: idx } });
  return true;
}

function stepAiIfNeeded(room) {
  const game = room.game;
  if (!game || game.status !== 'playing') return false;

  if (game.phase === 'discard' && game.turn != null) {
    const seat = game.turn;
    if (isHumanSeat(room, seat)) return false;
    return applyAiDiscardTurn(room, seat);
  }

  if (game.phase === 'claim' && game.pending) {
    const waiting = [0, 1, 2, 3].filter((s) => s !== game.pending.from && !game.passed.includes(s));
    for (const s of waiting) {
      if (isHumanSeat(room, s)) return false;
    }
    return applyAiClaimPhase(room);
  }

  return false;
}

function advanceMatchDealer(room) {
  const game = room.game;
  if (!game || !room.match) return;
  const winner = game.winner;
  const keepDealer = !winner || winner.type === 'draw' || winner.seat === game.dealer;
  if (!keepDealer) room.match.dealer = nextPlayer(game.dealer);
}

function isSeatListening(game, seat) {
  if (game.kouTing[seat]) return true;
  return getKatanWaits(game.hands[seat]).length > 0;
}

/** 嵌張和了ベース2点・自摸×2で各家4点（波克ルール簡略） */
function getTsumoScoreDeltas(winnerSeat, basePts = 4) {
  const d = [0, 0, 0, 0];
  d[winnerSeat] = basePts * 3;
  for (let s = 0; s < MAX_PLAYERS; s++) if (s !== winnerSeat) d[s] = -basePts;
  return d;
}

/** ロン: 听牌放炮は各家−2、未听牌放炮（出冲）は放炮者のみ−6 */
function getRonScoreDeltas(winnerSeat, fromSeat, discarderListening, basePts = 2) {
  const d = [0, 0, 0, 0];
  d[winnerSeat] = basePts * 3;
  if (discarderListening) {
    for (let s = 0; s < MAX_PLAYERS; s++) if (s !== winnerSeat) d[s] = -basePts;
  } else {
    d[fromSeat] = -basePts * 3;
  }
  return d;
}

function applyWinScores(room, winner) {
  if (!room.match || !winner || (winner.type !== 'ron' && winner.type !== 'tsumo')) return null;
  const deltas = winner.treasure
    ? getTreasureScoreDeltas(winner.seat, 12)
    : winner.type === 'tsumo'
      ? getTsumoScoreDeltas(winner.seat, 4)
      : getRonScoreDeltas(
        winner.seat,
        winner.from,
        winner.discarderListening !== false,
        2,
      );
  for (let seat = 0; seat < MAX_PLAYERS; seat++) room.match.scores[seat] += deltas[seat];
  return deltas;
}

function finishHand(room, winner) {
  const game = room.game;
  if (!game) return;
  game.status = 'ended';
  winner.scoreDeltas = applyWinScores(room, winner);
  game.winner = winner;
}

function beginNewHand(room) {
  const dealer = room.match.dealer;
  const dealerDice = [rollD6(), rollD6()];
  const dealerSum = dealerDice[0] + dealerDice[1];
  const openerSeat = openerSeatFromDealerDice(dealer, dealerSum);
  const openerDice = [rollD6(), rollD6()];
  const openerSum = openerDice[0] + openerDice[1];
  const breakCol = breakColumnFromDice(openerSum);
  const deck = shuffle(createDeck());
  const treasure = deck.pop();
  const { hands, wall } = dealHarbinHands(deck, dealer);

  room.status = 'playing';
  room.game = {
    status: 'playing',
    dealer,
    turn: dealer,
    wall,
    treasure,
    dealBreak: {
      dealerDice,
      openerDice,
      dealerSum,
      openerSum,
      openerSeat,
      breakCol,
    },
    treasureRevealed: false,
    treasureUsed: false,
    hands,
    discards: [[], [], [], []],
    melds: [[], [], [], []],
    kouTing: [false, false, false, false],
    lastDiscard: null,
    phase: 'discard',
    pending: null,
    passed: [],
    skipDrawAfterCallBy: null,
    dealerOpeningDiscardNoDraw: true,
    winner: null,
    kouTingTreasurePending: null,
    kouTingTreasureSeen: false,
    actionLog: [],
  };
  room.log.push({ at: Date.now(), type: 'hand_started', round: room.match.round, dealer });
}

function startNextHand(room, playerId) {
  if (room.hostId !== playerId) throw Object.assign(new Error('host_only'), { status: 403 });
  if (!room.match || room.match.finished) throw Object.assign(new Error('match_finished'), { status: 409 });
  if (!room.game || room.game.status !== 'ended') throw Object.assign(new Error('hand_not_finished'), { status: 409 });

  advanceMatchDealer(room);
  room.match.round += 1;
  if (room.match.round > room.match.totalRounds) {
    room.match.finished = true;
    room.status = 'ended';
    bump(room);
    return;
  }

  beginNewHand(room);
  bump(room);
  runAiUntilHuman(room);
}

function runAiUntilHuman(room) {
  let guard = 0;
  while (guard++ < 500 && stepAiIfNeeded(room)) {
    bump(room);
  }
}

function startGame(room, playerId) {
  if (room.hostId !== playerId) throw Object.assign(new Error('host_only'), { status: 403 });
  if (room.players.length < MIN_PLAYERS_TO_START) throw Object.assign(new Error('need_more_players'), { status: 409 });
  if (room.players.length > MAX_PLAYERS) throw Object.assign(new Error('room_full'), { status: 409 });
  if (room.status === 'playing' || room.match) throw Object.assign(new Error('already_started'), { status: 409 });

  room.match = {
    round: 1,
    totalRounds: MATCH_TOTAL_ROUNDS,
    scores: [0, 0, 0, 0],
    finished: false,
    dealer: Math.floor(Math.random() * MAX_PLAYERS),
  };
  beginNewHand(room);
  room.log.push({ at: Date.now(), type: 'game_started' });
  bump(room);
  runAiUntilHuman(room);
}

function updateKouTing(game) {
  if (!game || game.status !== 'playing') return;
  if (game.kouTingTreasurePending != null && !game.kouTingTreasureSeen) {
    game.treasureRevealed = game.kouTing.some((k, i) => k && i !== game.kouTingTreasurePending);
  } else {
    game.treasureRevealed = game.treasureUsed || game.kouTing.some(Boolean);
  }
}

function legalActions(game, seat) {
  if (!game || game.status !== 'playing') return [];
  const hand = game.hands[seat];
  const actions = [];
  const exp = expectedHandCount(game, seat);
  if (game.kouTingTreasurePending === seat) {
    if (!canOfferKouTingTreasureNow(game, seat)) {
      game.kouTingTreasurePending = null;
      game.kouTingTreasureSeen = false;
    } else if (!game.kouTingTreasureSeen) {
      actions.push({ type: 'reveal_treasure' });
      return actions;
    } else {
      actions.push({ type: 'treasure_win', tile: game.treasure });
      return actions;
    }
  }
  if (game.phase === 'discard' && game.turn === seat) {
    if (game.kouTing[seat]) {
      if (hand.length === exp) actions.push({ type: 'draw' });
      else if (hand.length === exp + 1) actions.push({ type: 'discard' });
    } else {
      actions.push({ type: 'discard' });
      const ktEntry = getKouTingEntryDiscardIndices(game, seat);
      if (ktEntry.length) actions.push({ type: 'kouting', indices: ktEntry });
    }
    if (game.lastDraw && game.lastDraw.seat === seat && canWin(game, seat, game.lastDraw.tile)) {
      actions.push({ type: 'tsumo', tile: game.lastDraw.tile });
    }
  }
  if (game.phase === 'claim' && game.pending && game.pending.from !== seat && !game.passed.includes(seat)) {
    const tile = game.pending.tile;
    if (canWin(game, seat, tile)) actions.push({ type: 'ron', tile });
    if (!game.kouTing[seat] && countTile(hand, tile) >= 3) actions.push({ type: 'minkan', tile });
    if (!game.kouTing[seat] && countTile(hand, tile) >= 2) actions.push({ type: 'pon', tile });
    if (!game.kouTing[seat] && nextPlayer(game.pending.from) === seat) {
      const chiOptions = getChiOptions(hand, tile);
      if (chiOptions.length) actions.push({ type: 'chi', tile, options: chiOptions });
    }
    actions.push({ type: 'skip' });
  }
  return actions;
}

function seatOf(room, playerId) {
  const player = room.players.find((p) => p.id === playerId);
  if (!player) throw Object.assign(new Error('invalid_player'), { status: 403 });
  return player.seat;
}

/** Client UI sorts the hand; discard index is that sorted order (including duplicate disambiguation). */
function removeTileAtSortedIndex(hand, sortedIdx) {
  const sorted = sortTiles([...hand]);
  const tile = sorted[sortedIdx];
  if (!tile) return null;
  let nth = 0;
  for (let i = 0; i < sortedIdx; i++) {
    if (tileEq(sorted[i], tile)) nth++;
  }
  let seen = 0;
  for (let i = 0; i < hand.length; i++) {
    if (tileEq(hand[i], tile)) {
      if (seen === nth) return i;
      seen++;
    }
  }
  return null;
}

function drawFor(game, seat, room) {
  if (!game.wall.length) {
    if (room) finishHand(room, { type: 'draw' });
    return;
  }
  const tile = game.wall.shift();
  game.hands[seat].push(tile);
  game.lastDraw = { seat, tile };
}

function finishNoClaim(game, room) {
  const from = game.pending.from;
  game.phase = 'discard';
  game.pending = null;
  game.passed = [];
  if (game.kouTingTreasurePending === from && !canOfferKouTingTreasureNow(game, from)) {
    game.kouTingTreasurePending = null;
    game.kouTingTreasureSeen = false;
  }
  if (isHumanSeat(room, from) && game.kouTing[from]) {
    maybeBeginKouTingTreasurePending(room, from);
  }
  if (game.kouTingTreasurePending === from) {
    game.turn = from;
    return;
  }
  if (game.skipDrawAfterCallBy === from) {
    game.skipDrawAfterCallBy = null;
  } else if (!game.kouTing[from]) {
    if (game.dealerOpeningDiscardNoDraw && from === game.dealer) {
      game.dealerOpeningDiscardNoDraw = false;
    } else {
      drawFor(game, from, room);
      if (maybeAutoEnterKouTing(game, from, room)) return;
    }
  }
  if (game.kouTing[from]) {
    game.turn = nextPlayer(from);
    return;
  }
  game.turn = nextPlayer(from);
}

function maybeAutoFinishClaim(game, room) {
  if (game.phase !== 'claim' || !game.pending) return;
  const waiting = [0, 1, 2, 3].filter((s) => s !== game.pending.from && !game.passed.includes(s));
  const hasAnyAction = waiting.some((s) => legalActions(game, s).some((a) => a.type !== 'skip'));
  if (!waiting.length || !hasAnyAction) finishNoClaim(game, room);
}

function resolveOnlineAction(room, playerId, body) {
  const game = room.game;
  if (!game || game.status !== 'playing') throw Object.assign(new Error('game_not_playing'), { status: 409 });
  const seat = seatOf(room, playerId);
  const type = body.type;

  if (type === 'discard') {
    if (game.phase !== 'discard' || game.turn !== seat) throw Object.assign(new Error('not_your_turn'), { status: 409 });
    const sortedIdx = Number(body.index);
    if (game.kouTing[seat]) {
      const legal = getKouTingLegalDiscardIndices(game, seat);
      if (!legal.includes(sortedIdx)) throw Object.assign(new Error('invalid_tile'), { status: 400 });
    }
    const realIdx = removeTileAtSortedIndex(game.hands[seat], sortedIdx);
    if (realIdx == null) throw Object.assign(new Error('invalid_tile'), { status: 400 });
    const tile = game.hands[seat][realIdx];
    game.lastDiscardMeta = {
      from: seat,
      tile,
      discarderListening: isSeatListening(game, seat),
    };
    game.hands[seat].splice(realIdx, 1);
    game.discards[seat].push(tile);
    game.lastDiscard = { seat, tile };
    game.lastDraw = null;
    game.phase = 'claim';
    game.pending = { from: seat, tile };
    game.passed = [];
    maybeAutoFinishClaim(game, room);
  } else if (type === 'draw') {
    if (game.phase !== 'discard' || game.turn !== seat || !game.kouTing[seat]) throw Object.assign(new Error('not_your_turn'), { status: 409 });
    const exp = expectedHandCount(game, seat);
    if (game.hands[seat].length !== exp) throw Object.assign(new Error('cannot_draw'), { status: 409 });
    if (!game.wall.length) {
      if (!game.treasureUsed) {
        game.treasureUsed = true;
        const drawn = game.treasure;
        game.hands[seat].push(drawn);
        game.lastDraw = { seat, tile: drawn };
        if (finishTreasureDrawWin(room, seat, drawn)) {
          room.log.push({
            at: Date.now(),
            playerId,
            seat,
            type: 'tsumo',
            payload: { treasure: kouTingWaitsForTreasureTile(game, seat, drawn) },
          });
          bump(room);
          runAiUntilHuman(room);
          return;
        }
      } else {
        finishHand(room, { type: 'draw' });
        room.log.push({ at: Date.now(), playerId, seat, type: 'draw', payload: {} });
        bump(room);
        runAiUntilHuman(room);
        return;
      }
    } else {
      drawFor(game, seat, room);
      const tile = game.lastDraw?.seat === seat ? game.lastDraw.tile : null;
      if (tile && canWin(game, seat, tile)) {
        finishHand(room, { seat, type: 'tsumo', tile });
        room.log.push({ at: Date.now(), playerId, seat, type: 'tsumo', payload: {} });
        bump(room);
        runAiUntilHuman(room);
        return;
      }
    }
  } else if (type === 'kouting') {
    if (game.phase !== 'discard' || game.turn !== seat || game.kouTing[seat]) throw Object.assign(new Error('cannot_kouting'), { status: 409 });
    const sortedIdx = Number(body.index);
    const legal = getKouTingEntryDiscardIndices(game, seat);
    if (!legal.includes(sortedIdx)) throw Object.assign(new Error('cannot_kouting'), { status: 409 });
    const realIdx = removeTileAtSortedIndex(game.hands[seat], sortedIdx);
    if (realIdx == null) throw Object.assign(new Error('invalid_tile'), { status: 400 });
    const tile = game.hands[seat][realIdx];
    game.lastDiscardMeta = {
      from: seat,
      tile,
      discarderListening: isSeatListening(game, seat),
    };
    game.hands[seat].splice(realIdx, 1);
    game.discards[seat].push(tile);
    game.lastDiscard = { seat, tile };
    game.lastDraw = null;
    game.kouTing[seat] = true;
    game.treasureRevealed = game.kouTing.some(Boolean);
    if (tryFinishKouTingTreasureWin(room, seat)) {
      return;
    }
    game.phase = 'claim';
    game.pending = { from: seat, tile };
    game.passed = [];
    maybeAutoFinishClaim(game, room);
  } else if (type === 'skip') {
    if (game.phase !== 'claim' || !game.pending || game.pending.from === seat) throw Object.assign(new Error('cannot_skip'), { status: 409 });
    if (!game.passed.includes(seat)) game.passed.push(seat);
    maybeAutoFinishClaim(game, room);
  } else if (type === 'minkan') {
    if (game.phase !== 'claim' || !game.pending || game.pending.from === seat) throw Object.assign(new Error('cannot_minkan'), { status: 409 });
    const tile = game.pending.tile;
    if (countTile(game.hands[seat], tile) < 3) throw Object.assign(new Error('cannot_minkan'), { status: 409 });
    game.hands[seat] = removeTiles(game.hands[seat], [tile, tile, tile]);
    game.melds[seat].push({ type: 'kan', tiles: [tile, tile, tile, tile], from: game.pending.from });
    game.turn = seat;
    game.phase = 'discard';
    game.pending = null;
    game.passed = [];
    game.skipDrawAfterCallBy = seat;
  } else if (type === 'pon') {
    if (game.phase !== 'claim' || !game.pending || game.pending.from === seat) throw Object.assign(new Error('cannot_pon'), { status: 409 });
    const tile = game.pending.tile;
    if (countTile(game.hands[seat], tile) < 2) throw Object.assign(new Error('cannot_pon'), { status: 409 });
    game.hands[seat] = removeTiles(game.hands[seat], [tile, tile]);
    game.melds[seat].push({ type: 'pon', tiles: [tile, tile, tile], from: game.pending.from });
    game.turn = seat;
    game.phase = 'discard';
    game.pending = null;
    game.passed = [];
    game.skipDrawAfterCallBy = seat;
  } else if (type === 'chi') {
    if (game.phase !== 'claim' || !game.pending || nextPlayer(game.pending.from) !== seat) throw Object.assign(new Error('cannot_chi'), { status: 409 });
    const tile = game.pending.tile;
    const opt = getChiOptions(game.hands[seat], tile)[Number(body.option || 0)];
    if (!opt) throw Object.assign(new Error('cannot_chi'), { status: 409 });
    game.hands[seat] = removeTiles(game.hands[seat], opt);
    game.melds[seat].push({ type: 'chi', tiles: sortTiles([...opt, tile]), from: game.pending.from });
    game.turn = seat;
    game.phase = 'discard';
    game.pending = null;
    game.passed = [];
    game.skipDrawAfterCallBy = seat;
  } else if (type === 'ron') {
    if (game.phase !== 'claim' || !game.pending || !canWin(game, seat, game.pending.tile)) throw Object.assign(new Error('cannot_ron'), { status: 409 });
    finishHand(room, {
      seat,
      type: 'ron',
      tile: game.pending.tile,
      from: game.pending.from,
      discarderListening: game.lastDiscardMeta?.discarderListening,
    });
  } else if (type === 'tsumo') {
    const tile = game.lastDraw?.seat === seat ? game.lastDraw.tile : null;
    if (!tile || !canWin(game, seat, tile)) throw Object.assign(new Error('cannot_tsumo'), { status: 409 });
    finishHand(room, { seat, type: 'tsumo', tile });
  } else if (type === 'reveal_treasure') {
    if (game.kouTingTreasurePending !== seat || game.kouTingTreasureSeen) {
      throw Object.assign(new Error('cannot_reveal_treasure'), { status: 409 });
    }
    game.kouTingTreasureSeen = true;
    game.treasureRevealed = true;
  } else if (type === 'treasure_win') {
    if (game.kouTingTreasurePending !== seat || !game.kouTingTreasureSeen) {
      throw Object.assign(new Error('cannot_treasure_win'), { status: 409 });
    }
    if (!kouTingWaitsMatchTreasure(game, seat)) {
      throw Object.assign(new Error('cannot_treasure_win'), { status: 409 });
    }
    game.kouTingTreasurePending = null;
    game.treasureUsed = true;
    game.treasureRevealed = true;
    finishHand(room, { seat, type: 'tsumo', tile: game.treasure, treasure: true });
    room.log.push({
      at: Date.now(),
      type: 'kou_ting_treasure',
      seat,
      tile: game.treasure,
    });
    bump(room);
    runAiUntilHuman(room);
    return;
  } else {
    throw Object.assign(new Error('unknown_action'), { status: 400 });
  }

  room.log.push({ at: Date.now(), playerId, seat, type, payload: body });
  bump(room);
  runAiUntilHuman(room);
}

function bump(room) {
  if (room.game) updateKouTing(room.game);
  room.version += 1;
  room.updatedAt = Date.now();
  broadcast(room, 'room_state', publicRoom(room));
  for (const player of room.players) {
    sendToPlayer(room.id, player.id, 'private_state', privateState(room, player.id));
  }
}

function send(res, status, data) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  res.end(JSON.stringify(data));
}

function sendSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function roomClients(roomId) {
  return [...clients.values()].filter((c) => c.roomId === roomId);
}

function broadcast(room, event, data) {
  for (const client of roomClients(room.id)) sendSse(client.res, event, data);
}

function sendToPlayer(roomId, playerId, event, data) {
  if (!data) return;
  for (const client of roomClients(roomId)) {
    if (client.playerId === playerId) sendSse(client.res, event, data);
  }
}

async function readRaw(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function readJson(req) {
  const buf = await readRaw(req);
  if (!buf.length) return {};
  return JSON.parse(buf.toString('utf8'));
}

async function handleShop(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/shop/config') {
    return send(res, 200, shopConfig());
  }

  if (req.method === 'POST' && url.pathname === '/api/shop/checkout') {
    try {
      const body = await readJson(req);
      const origin = String(body.origin || '').replace(/\/+$/, '');
      const successUrl = successUrlFromEnv(origin || 'https://harbin-mahjong-kaka.vercel.app');
      const cancelUrl = origin ? `${origin}/harbin-mahjong.html?shop=cancel` : successUrl.replace('shop_session={CHECKOUT_SESSION_ID}', 'shop=cancel');
      const session = await createCheckoutSession({ successUrl, cancelUrl });
      return send(res, 200, { url: session.url, id: session.id });
    } catch (err) {
      const status = err.status || (err.message === 'shop_disabled' ? 503 : 500);
      return send(res, status, { error: err.message || 'checkout_failed' });
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/shop/status') {
    const sessionId = url.searchParams.get('session_id') || '';
    if (!sessionId) return send(res, 400, { error: 'missing_session' });
    try {
      const session = await retrieveCheckoutSession(sessionId);
      if (!sessionIsPaid(session)) return send(res, 200, { premium: false });
      return send(res, 200, { premium: true, token: issuePremiumToken(session.id) });
    } catch (err) {
      return send(res, err.status || 500, { error: err.message || 'status_failed' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/shop/restore') {
    const body = await readJson(req);
    if (body.token) {
      const payload = verifyEntitlement(body.token);
      return send(res, 200, { premium: !!payload, token: payload ? body.token : null });
    }
    if (body.sessionId) {
      try {
        const session = await retrieveCheckoutSession(body.sessionId);
        if (!sessionIsPaid(session)) return send(res, 200, { premium: false });
        return send(res, 200, { premium: true, token: issuePremiumToken(session.id) });
      } catch (err) {
        return send(res, err.status || 500, { error: err.message || 'restore_failed' });
      }
    }
    return send(res, 400, { error: 'missing_token' });
  }

  if (req.method === 'POST' && url.pathname === '/api/shop/webhook') {
    const raw = await readRaw(req);
    const v = verifyStripeWebhook(raw.toString('utf8'), req.headers['stripe-signature']);
    if (!v.ok) return send(res, 400, { error: v.error });
    return send(res, 200, { received: true });
  }

  return notFound(res);
}

function notFound(res) {
  send(res, 404, { error: 'not_found' });
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const filePath = normalize(join(ROOT, pathname));
  if (!filePath.startsWith(normalize(ROOT)) || !existsSync(filePath)) return notFound(res);

  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ogg': 'audio/ogg',
    '.webmanifest': 'application/manifest+json',
    '.json': 'application/json',
  };
  res.writeHead(200, {
    'content-type': types[extname(filePath)] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  createReadStream(filePath).pipe(res);
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
    });
    res.end();
    return;
  }

  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return send(res, 200, { ok: true, rooms: rooms.size, shop: shopConfig().enabled });
    }

    if (url.pathname.startsWith('/api/shop/')) {
      return handleShop(req, res, url);
    }

    if (req.method === 'POST' && url.pathname === '/api/rooms') {
      const body = await readJson(req);
      const room = makeRoom();
      const player = addPlayer(room, body.name);
      return send(res, 201, { room: publicRoom(room), playerId: player.id, seat: player.seat });
    }

    const match = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{5})(?:\/(join|events|actions|start|next))?$/);
    if (!match) return notFound(res);
    const [, roomId, action] = match;
    const room = rooms.get(roomId);
    if (!room) return send(res, 404, { error: 'room_not_found' });

    if (req.method === 'POST' && action === 'join') {
      const body = await readJson(req);
      const player = addPlayer(room, body.name);
      return send(res, 200, { room: publicRoom(room), playerId: player.id, seat: player.seat });
    }

    if (req.method === 'POST' && action === 'start') {
      const body = await readJson(req);
      startGame(room, body.playerId);
      return send(res, 200, { room: publicRoom(room) });
    }

    if (req.method === 'POST' && action === 'next') {
      const body = await readJson(req);
      startNextHand(room, body.playerId);
      return send(res, 200, { room: publicRoom(room) });
    }

    if (req.method === 'POST' && action === 'actions') {
      const body = await readJson(req);
      resolveOnlineAction(room, body.playerId, body);
      return send(res, 202, { ok: true, version: room.version });
    }

    if (req.method === 'GET' && action === 'events') {
      const playerId = url.searchParams.get('playerId');
      const player = room.players.find((p) => p.id === playerId);
      if (!player) {
        res.writeHead(403);
        res.end('invalid player');
        return;
      }

      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
        'access-control-allow-origin': '*',
      });
      const id = randomUUID();
      clients.set(id, { id, roomId, playerId, res });
      player.connected = true;
      bump(room);
      sendSse(res, 'hello', { room: publicRoom(room), private: privateState(room, playerId) });

      const ping = setInterval(() => sendSse(res, 'ping', { at: Date.now() }), 15000);
      req.on('close', () => {
        clearInterval(ping);
        clients.delete(id);
        player.connected = false;
        bump(room);
      });
      return;
    }

    notFound(res);
  } catch (err) {
    send(res, err.status || 500, { error: err.message || 'server_error' });
  }
}

function cleanupRooms() {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (now - room.updatedAt > ROOM_TTL_MS && roomClients(id).length === 0) rooms.delete(id);
  }
}

const server = createServer(async (req, res) => {
  if (req.url?.startsWith('/api/')) return handleApi(req, res);
  return serveStatic(req, res);
});

setInterval(cleanupRooms, 1000 * 60 * 10).unref();

server.listen(PORT, () => {
  console.log(`Harbin Mahjong online server: http://localhost:${PORT}`);
});
