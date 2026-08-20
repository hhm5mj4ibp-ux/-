import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function mustExist(rel) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) {
    console.error('missing:', rel);
    return false;
  }
  return true;
}

let ok = true;
for (const f of [
  '7198.png', 'hand-tiles.png', 'harbin-mahjong.html', 'index.html',
  'hero-splash.jpg', 'manifest.webmanifest', 'sw.js',
  'icons/icon-192.png', 'icons/icon-512.png',
  'audio/discard.ogg', 'audio/bgm-title.ogg', 'audio/bgm-table.ogg',
  'legal/privacy.html', 'legal/tokushoho.html', 'legal/terms.html',
]) {
  if (!mustExist(f)) ok = false;
}

if (fs.existsSync(path.join(root, 'public'))) {
  for (const f of ['7198.png', 'hand-tiles.png', 'audio/discard.ogg', 'manifest.webmanifest']) {
    if (!fs.existsSync(path.join(root, 'public', f))) {
      console.error('missing in public/:', f);
      ok = false;
    }
  }
}

if (!ok) process.exit(1);
console.log('deploy assets ok');
