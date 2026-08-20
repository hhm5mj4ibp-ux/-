import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const outDir = path.join(root, 'audio');
fs.mkdirSync(outDir, { recursive: true });

function ogg(name, args) {
  const dest = path.join(outDir, name);
  const r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args, '-c:a', 'libvorbis', '-q:a', '3', dest], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('ffmpeg failed:', name);
    process.exit(1);
  }
}

ogg('discard.ogg', [
  '-f', 'lavfi', '-i', 'sine=frequency=540:duration=0.07',
  '-f', 'lavfi', '-i', 'sine=frequency=320:duration=0.05',
  '-filter_complex', 'amix=inputs=2,volume=0.9,afade=t=out:st=0.04:d=0.04',
]);
ogg('draw.ogg', [
  '-f', 'lavfi', '-i', 'sine=frequency=720:duration=0.09',
  '-f', 'lavfi', '-i', 'sine=frequency=880:duration=0.07',
  '-filter_complex', 'amix=inputs=2,volume=0.7,afade=t=out:st=0.05:d=0.05',
]);
ogg('chi.ogg', [
  '-f', 'lavfi', '-i', 'sine=frequency=920:duration=0.12',
  '-f', 'lavfi', '-i', 'sine=frequency=740:duration=0.1',
  '-filter_complex', 'amix=inputs=2,volume=0.75,afade=t=out:st=0.07:d=0.05',
]);
ogg('pon.ogg', [
  '-f', 'lavfi', '-i', 'sine=frequency=220:duration=0.14',
  '-f', 'lavfi', '-i', 'sine=frequency=330:duration=0.1',
  '-filter_complex', 'amix=inputs=2,volume=0.85,afade=t=out:st=0.08:d=0.06',
]);
ogg('kan.ogg', [
  '-f', 'lavfi', '-i', 'sine=frequency=180:duration=0.22',
  '-f', 'lavfi', '-i', 'sine=frequency=270:duration=0.16',
  '-filter_complex', 'amix=inputs=2,volume=0.85,afade=t=out:st=0.12:d=0.1',
]);
ogg('win.ogg', [
  '-f', 'lavfi', '-i', 'sine=frequency=523.25:duration=0.35',
  '-f', 'lavfi', '-i', 'sine=frequency=659.25:duration=0.35',
  '-f', 'lavfi', '-i', 'sine=frequency=783.99:duration=0.4',
  '-filter_complex', 'amix=inputs=3,volume=0.55,afade=t=out:st=0.22:d=0.18',
]);
ogg('skip.ogg', ['-f', 'lavfi', '-i', 'sine=frequency=280:duration=0.06', '-af', 'volume=0.45,afade=t=out:st=0.03:d=0.03']);
ogg('tap.ogg', ['-f', 'lavfi', '-i', 'sine=frequency=820:duration=0.04', '-af', 'volume=0.4,afade=t=out:st=0.02:d=0.02']);
ogg('deal.ogg', [
  '-f', 'lavfi', '-i', 'sine=frequency=420:duration=0.08',
  '-f', 'lavfi', '-i', 'sine=frequency=560:duration=0.06',
  '-filter_complex', 'amix=inputs=2,volume=0.6,afade=t=out:st=0.04:d=0.04',
]);
ogg('round.ogg', ['-f', 'lavfi', '-i', 'sine=frequency=196:duration=0.28', '-af', 'volume=0.5,afade=t=out:st=0.16:d=0.12']);
ogg('gacha.ogg', [
  '-f', 'lavfi', '-i', 'sine=frequency=340:duration=0.42',
  '-f', 'lavfi', '-i', 'sine=frequency=510:duration=0.42',
  '-filter_complex', 'amix=inputs=2,tremolo=f=12:d=0.7,volume=0.45,afade=t=out:st=0.3:d=0.12',
]);
ogg('reveal.ogg', [
  '-f', 'lavfi', '-i', 'sine=frequency=520:duration=0.16',
  '-f', 'lavfi', '-i', 'sine=frequency=990:duration=0.18',
  '-filter_complex', 'amix=inputs=2,volume=0.55,afade=t=out:st=0.1:d=0.08',
]);
ogg('kt_discard.ogg', [
  '-f', 'lavfi', '-i', 'sine=frequency=180:duration=0.12',
  '-f', 'lavfi', '-i', 'sine=frequency=140:duration=0.1',
  '-filter_complex', 'amix=inputs=2,volume=0.7,afade=t=out:st=0.06:d=0.06',
]);
ogg('dice.ogg', ['-f', 'lavfi', '-i', 'anoisesrc=color=white:duration=0.28:amplitude=0.08', '-af', 'bandpass=f=1800:width_type=h:w=900,volume=1.4,afade=t=out:st=0.2:d=0.08']);
ogg('dice_land.ogg', [
  '-f', 'lavfi', '-i', 'sine=frequency=160:duration=0.12',
  '-f', 'lavfi', '-i', 'anoisesrc=color=brown:duration=0.08:amplitude=0.2',
  '-filter_complex', 'amix=inputs=2,volume=0.7,afade=t=out:st=0.06:d=0.06',
]);
ogg('bgm-title.ogg', [
  '-f', 'lavfi', '-i', 'sine=frequency=130.81:duration=14',
  '-f', 'lavfi', '-i', 'sine=frequency=196:duration=14',
  '-f', 'lavfi', '-i', 'sine=frequency=246.94:duration=14',
  '-f', 'lavfi', '-i', 'anoisesrc=color=brown:duration=14:amplitude=0.015',
  '-filter_complex', 'amix=inputs=4:normalize=0,lowpass=f=900,volume=0.22,afade=t=in:st=0:d=1.2,afade=t=out:st=12.5:d=1.4',
]);
ogg('bgm-table.ogg', [
  '-f', 'lavfi', '-i', 'sine=frequency=98:duration=16',
  '-f', 'lavfi', '-i', 'sine=frequency=146.83:duration=16',
  '-f', 'lavfi', '-i', 'sine=frequency=174.61:duration=16',
  '-f', 'lavfi', '-i', 'anoisesrc=color=pink:duration=16:amplitude=0.012',
  '-filter_complex', 'amix=inputs=4:normalize=0,lowpass=f=700,volume=0.18,afade=t=in:st=0:d=1.4,afade=t=out:st=14.4:d=1.5',
]);

console.log('audio generated →', outDir);
