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
for (const f of ['7198.png', 'hand-tiles.png', '名称未設定のデザイン (2).png', 'harbin-mahjong.html', 'index.html']) {
  if (!mustExist(f)) ok = false;
}

if (fs.existsSync(path.join(root, 'public'))) {
  for (const f of ['7198.png', 'hand-tiles.png', '名称未設定のデザイン (2).png']) {
    if (!fs.existsSync(path.join(root, 'public', f))) {
      console.error('missing in public/:', f);
      ok = false;
    }
  }
}

if (!ok) process.exit(1);
console.log('deploy assets ok');
