import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const publicTessdataDir = path.join(rootDir, 'public', 'tessdata');
const serverTessdataDir = path.join(rootDir, 'server', 'tessdata');

// Rebuild these generated asset folders from scratch. This prevents stale legacy WASM files
// from inflating successive Android bundles.
for (const dir of [publicTessdataDir, serverTessdataDir]) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

const fasData = path.join(
  rootDir,
  'node_modules/@tesseract.js-data/fas/4.0.0_best_int/fas.traineddata.gz'
);
const engData = path.join(
  rootDir,
  'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'
);
const workerFile = path.join(rootDir, 'node_modules/tesseract.js/dist/worker.min.js');

// The installed APK only runs the Persian LSTM OCR head. Keep only its scalar, SIMD and
// relaxed-SIMD WASM variants so old and new WebViews remain supported without shipping the
// unused legacy (non-LSTM) engines or English model to every phone.
const lstmCoreFiles = [
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-lstm.wasm',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm',
  'tesseract-core-relaxedsimd-lstm.wasm.js',
  'tesseract-core-relaxedsimd-lstm.wasm',
];
const coreDir = path.join(rootDir, 'node_modules/tesseract.js-core');

const copies = [
  [fasData, path.join(publicTessdataDir, 'fas.traineddata.gz')],
  [workerFile, path.join(publicTessdataDir, 'worker.min.js')],
  // The server uses a bilingual worker; keep its English model out of the client APK.
  [fasData, path.join(serverTessdataDir, 'fas.traineddata.gz')],
  [engData, path.join(serverTessdataDir, 'eng.traineddata.gz')],
];

for (const file of lstmCoreFiles) {
  copies.push([path.join(coreDir, file), path.join(publicTessdataDir, file)]);
}

let copied = 0;
for (const [src, dest] of copies) {
  if (!fs.existsSync(src)) {
    throw new Error(`[prepare-assets] Required OCR asset is missing: ${src}`);
  }
  fs.copyFileSync(src, dest);
  copied++;
}

const publicBytes = fs.readdirSync(publicTessdataDir).reduce(
  (sum, name) => sum + fs.statSync(path.join(publicTessdataDir, name)).size,
  0
);
console.log(
  `[prepare-assets] Copied ${copied} OCR assets; client WASM/model payload ${(publicBytes / (1024 * 1024)).toFixed(1)} MiB.`
);
