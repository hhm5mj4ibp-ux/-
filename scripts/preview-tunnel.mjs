#!/usr/bin/env node
/**
 * ユーザーがブラウザで開ける公開 URL を出す。
 * Vercel preview は SSO で入れないので使わない。
 * 優先: localhost.run → localtunnel → cloudflared。切れたら張り直す（2本並行）。
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

const PORT = Number(process.env.PREVIEW_PORT || 8787);
const ROOT = join(import.meta.dirname, '..');
const URL_FILE = join(ROOT, '.preview-url');
const BIN_DIR = join(homedir(), '.local', 'bin');
const CF_BIN = join(BIN_DIR, 'cloudflared');
const CF_URL = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64';
const HEALTH_MS = 15000;

const live = new Map();

function log(...args) {
  console.log('[preview]', ...args);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function playUrl(host) {
  return String(host).replace(/\/$/, '') + '/harbin-mahjong.html';
}

function publish() {
  const lines = [...live.values()].map((u) => playUrl(u));
  writeFileSync(URL_FILE, (lines.join('\n') || '') + (lines.length ? '\n' : ''), 'utf8');
  if (lines.length) log('TRY:', lines.join('  /  '));
}

function waitForMatch(child, re, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = (chunk) => {
      buf += String(chunk);
      const m = buf.match(re);
      if (m) {
        cleanup();
        resolve(m[1] || m[0]);
      }
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout?.off('data', onData);
      child.stderr?.off('data', onData);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for ${re}`));
    }, timeoutMs);
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('exit', (code) => {
      cleanup();
      reject(new Error(`process exited ${code} before URL`));
    });
  });
}

function portOpen(port) {
  return new Promise((resolve) => {
    const sock = createServer();
    sock.once('error', () => resolve(true));
    sock.once('listening', () => {
      sock.close(() => resolve(false));
    });
    sock.listen(port, '127.0.0.1');
  });
}

function ensureCloudflared() {
  if (existsSync(CF_BIN)) return CF_BIN;
  mkdirSync(BIN_DIR, { recursive: true });
  log('downloading cloudflared…');
  const r = spawnSync('curl', ['-fsSL', '-o', CF_BIN, CF_URL], { stdio: 'inherit' });
  if (r.status !== 0) return null;
  spawnSync('chmod', ['+x', CF_BIN]);
  return existsSync(CF_BIN) ? CF_BIN : null;
}

function urlReturns200(url) {
  const r = spawnSync(
    'curl',
    ['-sS', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '12', url],
    { encoding: 'utf8' }
  );
  return String(r.stdout || '').trim() === '200';
}

async function confirmTunnel(tun) {
  if (!tun?.url) return false;
  await sleep(1200);
  const play = playUrl(tun.url);
  if (urlReturns200(play)) return true;
  log('tunnel URL not reachable:', play);
  try { tun.child.kill('SIGTERM'); } catch (_e) {}
  return false;
}

async function startApp() {
  spawnSync('node', [join(ROOT, 'scripts/vercel-static-build.mjs')], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (await portOpen(PORT)) {
    log(`port ${PORT} already in use — reusing`);
    return;
  }
  const app = spawn('node', [join(ROOT, 'server/online-server.mjs')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });
  app.stdout.pipe(process.stdout);
  app.stderr.pipe(process.stderr);
  const ok = await waitForMatch(app, /listening|http:\/\/|serving|PORT/i, 8000).catch(() => null);
  if (!ok) await sleep(800);
  log(`local http://127.0.0.1:${PORT}/harbin-mahjong.html`);
}

function pipeChild(child) {
  child.stdout?.pipe(process.stdout);
  child.stderr?.pipe(process.stderr);
}

async function tunnelCloudflared() {
  const bin = ensureCloudflared();
  if (!bin) return null;
  const child = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${PORT}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  pipeChild(child);
  try {
    const host = await waitForMatch(
      child,
      /https:\/\/[a-z0-9-]+\.trycloudflare\.com/,
      25000
    );
    return { url: host, child, kind: 'cloudflared' };
  } catch (err) {
    log('cloudflared failed:', err.message);
    child.kill('SIGTERM');
    return null;
  }
}

async function tunnelLocalhostRun() {
  const child = spawn(
    'ssh',
    [
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'ServerAliveInterval=30',
      '-o', 'ExitOnForwardFailure=yes',
      '-T',
      '-R', `80:127.0.0.1:${PORT}`,
      'nokey@localhost.run',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  pipeChild(child);
  try {
    const host = await waitForMatch(
      child,
      /https:\/\/[a-zA-Z0-9.-]+\.(lhr\.life|localhost\.run)/,
      25000
    );
    return { url: host, child, kind: 'localhost.run' };
  } catch (err) {
    log('localhost.run failed:', err.message);
    child.kill('SIGTERM');
    return null;
  }
}

async function tunnelLocaltunnel() {
  const child = spawn('npx', ['--yes', 'localtunnel', '--port', String(PORT)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: ROOT,
  });
  pipeChild(child);
  try {
    const host = await waitForMatch(
      child,
      /https:\/\/[a-zA-Z0-9.-]+\.loca\.lt/,
      40000
    );
    return { url: host, child, kind: 'localtunnel' };
  } catch (err) {
    log('localtunnel failed:', err.message);
    child.kill('SIGTERM');
    return null;
  }
}

async function openOneTunnel() {
  for (const fn of [tunnelLocalhostRun, tunnelLocaltunnel, tunnelCloudflared]) {
    const tun = await fn();
    if (await confirmTunnel(tun)) return tun;
  }
  return null;
}

async function watch(slot, tun) {
  const play = playUrl(tun.url);
  live.set(slot, tun.url);
  publish();
  while (true) {
    await sleep(HEALTH_MS);
    if (!urlReturns200(play)) {
      log(slot, 'lost', play);
      live.delete(slot);
      publish();
      try { tun.child.kill('SIGTERM'); } catch (_e) {}
      return;
    }
  }
}

async function runSlot(slot) {
  for (;;) {
    const tun = await openOneTunnel();
    if (!tun) {
      log(slot, 'no tunnel, retry');
      await sleep(8000);
      continue;
    }
    log(slot, tun.kind, playUrl(tun.url));
    await watch(slot, tun);
  }
}

async function main() {
  await startApp();
  const stop = () => process.exit(0);
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  await Promise.all([runSlot('a'), runSlot('b')]);
}

await main();
