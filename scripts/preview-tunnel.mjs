#!/usr/bin/env node
/**
 * ユーザーがブラウザで開ける公開 URL を出す。
 * Vercel preview は SSO で入れないので使わない。
 * 優先: cloudflared trycloudflare → SSH localhost.run
 */
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

const PORT = Number(process.env.PREVIEW_PORT || 8787);
const ROOT = join(import.meta.dirname, '..');
const URL_FILE = join(ROOT, '.preview-url');
const BIN_DIR = join(homedir(), '.local', 'bin');
const CF_BIN = join(BIN_DIR, 'cloudflared');
const CF_URL = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64';

function log(...args) {
  console.log('[preview]', ...args);
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

function saveUrl(url) {
  const play = url.replace(/\/$/, '') + '/harbin-mahjong.html';
  writeFileSync(URL_FILE, `${play}\n`, 'utf8');
  log('TRY:', play);
  return play;
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
  if (!ok) {
    await new Promise((r) => setTimeout(r, 800));
  }
  log(`local http://127.0.0.1:${PORT}/harbin-mahjong.html`);
}

async function tunnelCloudflared() {
  const bin = ensureCloudflared();
  if (!bin) return null;
  const child = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${PORT}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  try {
    const host = await waitForMatch(
      child,
      /https:\/\/[a-z0-9-]+\.trycloudflare\.com/,
      25000
    );
    return { url: host, child };
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
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  try {
    const host = await waitForMatch(
      child,
      /https:\/\/[a-zA-Z0-9.-]+\.(lhr\.life|localhost\.run)/,
      25000
    );
    return { url: host, child };
  } catch (err) {
    log('localhost.run failed:', err.message);
    child.kill('SIGTERM');
    return null;
  }
}

async function main() {
  await startApp();
  let tun = await tunnelCloudflared();
  if (!tun) tun = await tunnelLocalhostRun();
  if (!tun) {
    console.error('[preview] no public tunnel. local only: http://127.0.0.1:' + PORT + '/harbin-mahjong.html');
    process.exit(1);
  }
  saveUrl(tun.url);
  const stop = () => {
    tun.child.kill('SIGTERM');
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

await main();
