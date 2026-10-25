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
const asmCoreDir = path.join(rootDir, 'node_modules/tesseract.js-core-asm');
const assets = [
  [path.join(asmCoreDir, 'tesseract-core.asm.js'), 'tesseract-core-asm.js'],
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
    let sourceCode = fs.readFileSync(source, 'utf8');
    if (name === 'tesseract-core-asm.js') {
      // Core 3.0.2 still ships a pure asm.js build for WebViews where the
      // asynchronous WebAssembly compiler stalls. Tesseract's worker looks for
      // the WASM export name, so expose this compatible factory under that name.
      sourceCode += '\nself.TesseractCoreWASM = self.TesseractCoreASM;\n';
    }
    if (name === 'worker.min.js') {
      // Tesseract's Lang[] overload contains bytes in `data`; initialization must
      // receive the language `code`, not the byte array, after those bytes load.
      const languageCodePatch = sourceCode.replace(
        'a.map((function(t){return"string"==typeof t?t:t.data})).join("+")',
        'a.map((function(t){return"string"==typeof t?t:t.code})).join("+")'
      );
      if (languageCodePatch === sourceCode) {
        throw new Error('[prepare-assets] Could not patch Tesseract Lang[] initialization');
      }
      sourceCode = languageCodePatch;

      // Surface whether the Android WebView's WebAssembly compiler actually
      // resolves; Tesseract otherwise reports no progress while Core() awaits it.
      const wasmProbe = sourceCode.replace(
        /r\.progress\(\{workerId:n,status:f,progress:0\}\),h\(\{TesseractProgress:/,
        () => `r.progress({workerId:n,status:f,progress:0}),(()=>{const wasm=self.WebAssembly;const instantiate=wasm.instantiate;wasm.instantiate=function(){r.progress({workerId:n,status:'wasm instantiate started',progress:0});let result;try{result=instantiate.apply(wasm,arguments)}catch(error){r.progress({workerId:n,status:'wasm instantiate threw',progress:0});throw error}return result.then(value=>{r.progress({workerId:n,status:'wasm instantiate resolved',progress:0});return value},error=>{r.progress({workerId:n,status:'wasm instantiate rejected',progress:0});throw error})}})(),h({TesseractProgress:`
      );
      if (wasmProbe === sourceCode) {
        throw new Error('[prepare-assets] Could not instrument Tesseract WASM initialization');
      }
      sourceCode = wasmProbe;
    }
    if (name.startsWith('tesseract-core-') && name.endsWith('.wasm.js')) {
      // Chrome 69 can hang when Emscripten tries streaming compilation from an
      // embedded data: URL in a Web Worker. Decode the bundled bytes directly
      // and use WebAssembly.instantiate instead of fetch/instantiateStreaming.
      const withoutFetch = sourceCode.replace(
        /function Na\(a\)\{[\s\S]*?\}function Oa/,
        'function Na(a){return Promise.resolve().then(()=>Ma(a))}function Oa'
      );
      const withoutStreaming = withoutFetch.replace(
        /function Pa\(a,c\)\{[\s\S]*?\}var y,z,/,
        'function Pa(a,c){return Oa(Ka,a,c)}var y,z,'
      );
      if (withoutFetch === sourceCode || withoutStreaming === withoutFetch) {
        throw new Error(`[prepare-assets] Could not apply Android 7 WebAssembly fallback to ${name}`);
      }
      sourceCode = withoutStreaming;
    }

    const { code } = await transform(sourceCode, {
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
