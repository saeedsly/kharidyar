import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const targetDir = path.join(rootDir, 'public', 'tessdata');
fs.rmSync(targetDir, { recursive: true, force: true });
fs.mkdirSync(targetDir, { recursive: true });

const coreDir = path.join(rootDir, 'node_modules/tesseract.js-core');
const assets = [
  [
    path.join(rootDir, 'node_modules/@tesseract.js-data/fas/4.0.0_best_int/fas.traineddata.gz'),
    'fas.traineddata.gz',
  ],
  [
    path.join(rootDir, 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'),
    'eng.traineddata.gz',
  ],
  [
    path.join(rootDir, 'node_modules/@tesseract.js-data/tur/4.0.0_best_int/tur.traineddata.gz'),
    'tur.traineddata.gz',
  ],
  [path.join(rootDir, 'node_modules/tesseract.js/dist/worker.min.js'), 'worker.min.js'],
];

// Package only LSTM WASM runtimes. The previous build copied every legacy, SIMD and non-SIMD
// variant (about 47 MiB); the app needs just these three compatibility paths for Android 7–15.
for (const variant of ['lstm', 'simd-lstm', 'relaxedsimd-lstm']) {
  assets.push(
    [path.join(coreDir, `tesseract-core-${variant}.wasm.js`), `tesseract-core-${variant}.wasm.js`],
    [path.join(coreDir, `tesseract-core-${variant}.wasm`), `tesseract-core-${variant}.wasm`]
  );
}

for (const [source, name] of assets) {
  if (!fs.existsSync(source)) {
    throw new Error(`[prepare-assets] Required offline OCR asset not found: ${source}`);
  }
  fs.copyFileSync(source, path.join(targetDir, name));
}

const totalBytes = fs
  .readdirSync(targetDir)
  .reduce((sum, name) => sum + fs.statSync(path.join(targetDir, name)).size, 0);
console.log(
  `[prepare-assets] Copied ${assets.length} offline OCR assets (${(totalBytes / 1024 / 1024).toFixed(1)} MiB) into public/tessdata/`
);
