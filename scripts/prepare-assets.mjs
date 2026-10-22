import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const targetDir = path.join(rootDir, 'public', 'tessdata');

fs.mkdirSync(targetDir, { recursive: true });

const filesToCopy = [
  [
    path.join(rootDir, 'node_modules/@tesseract.js-data/fas/4.0.0_best_int/fas.traineddata.gz'),
    path.join(targetDir, 'fas.traineddata.gz'),
  ],
  [
    path.join(rootDir, 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'),
    path.join(targetDir, 'eng.traineddata.gz'),
  ],
  [
    path.join(rootDir, 'node_modules/tesseract.js/dist/worker.min.js'),
    path.join(targetDir, 'worker.min.js'),
  ],
];

// Copy all WASM & JS core runtime files so browser & Android APK run 100% offline with zero external CDN requests
const coreDir = path.join(rootDir, 'node_modules/tesseract.js-core');
if (fs.existsSync(coreDir)) {
  for (const file of fs.readdirSync(coreDir)) {
    if (file.endsWith('.js') || file.endsWith('.wasm')) {
      filesToCopy.push([path.join(coreDir, file), path.join(targetDir, file)]);
    }
  }
}

let copied = 0;
for (const [src, dest] of filesToCopy) {
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    copied++;
  }
}

console.log(`[prepare-assets] Copied ${copied} local OCR & WASM files into public/tessdata/`);
