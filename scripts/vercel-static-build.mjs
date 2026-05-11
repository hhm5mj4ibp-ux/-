import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const pub = path.join(root, 'public');
fs.mkdirSync(pub, { recursive: true });

const must = ['index.html', 'harbin-mahjong.html', '7198.png'];
for (const f of must) {
  const src = path.join(root, f);
  if (!fs.existsSync(src)) {
    console.error('missing required file:', f);
    process.exit(1);
  }
  fs.copyFileSync(src, path.join(pub, f));
}

for (const name of fs.readdirSync(root)) {
  if (!name.endsWith('.png')) continue;
  if (name === '7198.png') continue;
  const src = path.join(root, name);
  if (fs.statSync(src).isFile()) {
    fs.copyFileSync(src, path.join(pub, name));
  }
}

const tiles = path.join(root, 'tiles');
if (fs.existsSync(tiles)) {
  fs.cpSync(tiles, path.join(pub, 'tiles'), { recursive: true });
}

console.log('static build → public/');
