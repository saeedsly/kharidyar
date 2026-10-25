import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

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

// Package only the LSTM WASM runtimes needed by Android 7–15. Keep the baseline
// runtime built with Tesseract.js Core 5.1.1: Core 6 adds the DataCount/bulk-memory
// WASM section that Android 7's Chrome 69 WebView cannot decode.
for (const variant of ['lstm', 'simd-lstm']) {
  assets.push(
    [path.join(coreDir, `tesseract-core-${variant}.wasm.js`), `tesseract-core-${variant}.wasm.js`],
    [path.join(coreDir, `tesseract-core-${variant}.wasm`), `tesseract-core-${variant}.wasm`]
  );
}

for (const [source, name] of assets) {
  if (!fs.existsSync(source)) {
    throw new Error(`[prepare-assets] Required offline OCR asset not found: ${source}`);
  }

  const destination = path.join(targetDir, name);
  if (name.endsWith('.js')) {
    // Tesseract.js core bundles ship optional chaining/nullish coalescing that
    // Chrome 69 (Android 7's WebView) cannot parse. They are copied outside
    // Vite's module graph, so transpile every standalone JS worker/core here.
    const { code } = await transform(fs.readFileSync(source, 'utf8'), {
      target: 'chrome69',
      minify: true,
    });
    fs.writeFileSync(destination, code);
  } else {
    fs.copyFileSync(source, destination);
  }
}

const totalBytes = fs
  .readdirSync(targetDir)
  .reduce((sum, name) => sum + fs.statSync(path.join(targetDir, name)).size, 0);
console.log(
  `[prepare-assets] Copied ${assets.length} offline OCR assets (${(totalBytes / 1024 / 1024).toFixed(1)} MiB) into public/tessdata/`
);
