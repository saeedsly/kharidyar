import { Capacitor } from '@capacitor/core';
import { createWorker } from 'tesseract.js';
import type { BoundingBox, ScanResponse, ShoppingItem } from '../types';
import { assetUrl } from './assetUrl';
import { OfflineOcrAssets, type NativeOcrResult } from './offlineOcrAssets';
import {
  parsePersianReceiptText,
  reconcileReceiptWithShoppingList,
} from './persianMatcher';

export type ReceiptOcrLanguage = 'fa-en' | 'tr-en';

const OCR_LANGUAGES: Record<ReceiptOcrLanguage, string> = {
  'fa-en': 'fas+eng',
  'tr-en': 'tur+eng',
};
const MAX_RECEIPT_EDGE = 1500;
const MAX_SCAN_TIME_MS = 60_000;
const WORKER_IDLE_MS = 60_000;
const WASM_BASELINE_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const WASM_SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0,
  1, 5, 1, 96, 0, 1, 123,
  3, 2, 1, 0,
  10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
]);

function getOcrCorePath(): string {
  let wasmSupported = false;
  let simdSupported = false;
  try {
    wasmSupported = typeof WebAssembly !== 'undefined' && WebAssembly.validate(WASM_BASELINE_PROBE);
    simdSupported = wasmSupported && WebAssembly.validate(WASM_SIMD_PROBE);
  } catch {
    // Fall back to the compatible asm.js runtime if a legacy WebView rejects wasm probes.
  }

  const coreFile = !wasmSupported
    ? 'tesseract-core-asm.js'
    : simdSupported
      ? 'tesseract-core-simd-lstm.wasm.js'
      : 'tesseract-core-lstm.wasm.js';
  const corePath = assetUrl(`tessdata/${coreFile}`);
  if (typeof window !== 'undefined') {
    const debugWindow = window as Window & {
      __emulatorOcrDebug?: boolean;
      __emulatorOcrCorePath?: string;
    };
    if (debugWindow.__emulatorOcrDebug) debugWindow.__emulatorOcrCorePath = corePath;
  }
  return corePath;
}

type OcrWorker = Awaited<ReturnType<typeof createWorker>>;
let workerPromise: Promise<OcrWorker> | null = null;
let workerInstance: OcrWorker | null = null;
let workerLanguage = '';
let activeProgress: ((stage: string, percent: number) => void) | null = null;
let activeCancel: (() => void) | null = null;
let cancelRequested = false;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function progress(stage: string, percent: number) {
  const normalizedPercent = Math.max(0, Math.min(98, Math.round(percent)));
  if (typeof window !== 'undefined') {
    const debugWindow = window as Window & {
      __emulatorOcrDebug?: boolean;
      __emulatorOcrProgress?: { stage: string; percent: number };
      __emulatorOcrWorkerStatus?: { status: string; progress?: number };
    };
    if (debugWindow.__emulatorOcrDebug) {
      debugWindow.__emulatorOcrProgress = { stage, percent: normalizedPercent };
    }
  }
  activeProgress?.(stage, normalizedPercent);
}

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => disposeWorker(), WORKER_IDLE_MS);
}

function disposeWorker() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;

  const pending = workerPromise;
  const ready = workerInstance;
  workerPromise = null;
  workerInstance = null;
  workerLanguage = '';

  if (ready) {
    void ready.terminate().catch(() => {});
  } else if (pending) {
    // createWorker does not expose its worker until language initialization finishes. If a scan
    // timed out during setup, terminate it as soon as the pending initialization settles.
    void pending.then((worker) => worker.terminate()).catch(() => {});
  }
}

export function cancelActiveOcrScan(): void {
  cancelRequested = true;
  activeCancel?.();
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout: () => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout();
      const error = new Error('SCAN_TIMEOUT');
      reject(error);
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function getOcrWorker(
  language: ReceiptOcrLanguage,
  remainingMs: number,
  onProgress?: (stage: string, percent: number) => void
): Promise<OcrWorker> {
  const languageCode = OCR_LANGUAGES[language];
  if (workerPromise && workerLanguage !== languageCode) disposeWorker();
  activeProgress = onProgress || null;

  if (!workerPromise) {
    workerLanguage = languageCode;
    progress('بارگذاری موتور اسکن آفلاین...', 22);
    const createWorkerOptions = {
      workerBlobURL: false,
      workerPath: assetUrl('tessdata/worker.min.js'),
      // Select a concrete JS core after a tiny synchronous feature probe. This
      // avoids Tesseract's asynchronous worker-side SIMD probe on legacy WebViews.
      corePath: getOcrCorePath(),
      langPath: assetUrl('tessdata').replace(/\/$/, ''),
      gzip: true,
      cacheMethod: 'write',
      logging: typeof window !== 'undefined' && Boolean((window as any).__emulatorOcrDebug),
      logger: (message: { status: string; progress?: number }) => {
        if (typeof window !== 'undefined') {
          const debugWindow = window as Window & {
            __emulatorOcrDebug?: boolean;
            __emulatorOcrWorkerStatus?: { status: string; progress?: number };
          };
          if (debugWindow.__emulatorOcrDebug) {
            debugWindow.__emulatorOcrWorkerStatus = {
              status: message.status,
              progress: message.progress,
            };
          }
        }
        if (message.status === 'recognizing text' && typeof message.progress === 'number') {
          progress('در حال خواندن نام کالاها و قیمت‌ها...', 36 + message.progress * 58);
        } else if (message.status === 'loading language traineddata') {
          // Tesseract reports progress while each bundled language is fetched, decompressed,
          // and cached. Reflect that work instead of leaving the UI frozen at 28% throughout.
          const languageProgress = typeof message.progress === 'number' ? message.progress : 0;
          progress('آماده‌سازی زبان فاکتور برای پردازش...', 28 + languageProgress * 8);
        } else if (message.status === 'loading tesseract core' || message.status === 'initializing tesseract') {
          progress('راه‌اندازی موتور اسکن روی گوشی...', 23);
        }
      },
    };
    const workerOptions = createWorkerOptions as Parameters<typeof createWorker>[2];
    const created = createWorker(languageCode, 1, workerOptions);

    let trackedPromise: Promise<OcrWorker>;
    trackedPromise = created.then(
      (worker) => {
        if (workerPromise === trackedPromise) {
          workerInstance = worker;
        } else {
          // The user cancelled or the watchdog expired while the worker was being prepared.
          void worker.terminate().catch(() => {});
        }
        return worker;
      },
      (error) => {
        if (workerPromise === trackedPromise) {
          workerPromise = null;
          workerLanguage = '';
        }
        throw error;
      }
    );
    workerPromise = trackedPromise;
  }

  const pending = workerPromise;
  if (!pending) throw new Error('OCR_WORKER_UNAVAILABLE');
  try {
    const worker = await withTimeout(pending, remainingMs, () => disposeWorker());
    workerInstance = worker;
    return worker;
  } catch (error) {
    if ((error as Error)?.message === 'SCAN_TIMEOUT') disposeWorker();
    throw error;
  }
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob === 'function') {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('IMAGE_COMPRESSION_FAILED'))),
        'image/jpeg',
        quality
      );
      return;
    }
    try {
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
      resolve(new Blob([bytes], { type: 'image/jpeg' }));
    } catch (error) {
      reject(error);
    }
  });
}

export async function normalizeAndCompressReceiptPhoto(
  source: File | Blob | string
): Promise<{ compressedFile: File; previewUrl: string; width: number; height: number; sizeBytes: number }> {
  let rawObjectUrl = '';
  const srcUrl =
    typeof source === 'string'
      ? source
      : ((rawObjectUrl = URL.createObjectURL(source)), rawObjectUrl);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('فرمت تصویر قابل خواندن نیست. لطفاً عکس دیگری انتخاب کنید.'));
      element.src = srcUrl;
    });

    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    if (!sourceWidth || !sourceHeight) throw new Error('تصویر فاکتور ابعاد معتبری ندارد.');

    const scale = Math.min(1, MAX_RECEIPT_EDGE / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('مرورگر گوشی نتوانست تصویر را آماده کند.');

    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    // Use the browser's native canvas filter when available. This avoids the slow full-image
    // JavaScript pixel loops that used to freeze older Android WebViews.
    try {
      context.filter = 'grayscale(1) contrast(1.12)';
    } catch {
      // Older WebViews can ignore canvas filters; a clean resized JPEG still works for OCR.
    }
    context.drawImage(image, 0, 0, width, height);
    try {
      context.filter = 'none';
    } catch {
      // No-op on older WebViews.
    }

    const blob = await canvasToJpeg(canvas, 0.78);
    const compressedFile = new File([blob], `receipt-${Date.now()}.jpg`, { type: 'image/jpeg' });
    const previewUrl = URL.createObjectURL(blob);
    return { compressedFile, previewUrl, width, height, sizeBytes: blob.size };
  } finally {
    if (rawObjectUrl) URL.revokeObjectURL(rawObjectUrl);
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('IMAGE_ENCODING_FAILED'));
        return;
      }
      const comma = result.indexOf(',');
      if (comma < 0) {
        reject(new Error('IMAGE_ENCODING_FAILED'));
        return;
      }
      resolve(result.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error('IMAGE_ENCODING_FAILED'));
    reader.readAsDataURL(blob);
  });
}

interface OcrLineData {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

function flattenOcrLines(data: Awaited<ReturnType<OcrWorker['recognize']>>['data']): OcrLineData[] {
  const lines = data.blocks?.flatMap((block) =>
    block.paragraphs.flatMap((paragraph) => paragraph.lines)
  );
  if (lines?.length) return lines;
  return data.text
    .split(/\r?\n/)
    .filter((text) => text.trim())
    .map((text) => ({
      text,
      confidence: data.confidence || 0,
      bbox: { x0: 0, y0: 0, x1: 0, y1: 0 },
    }));
}

export async function runOnDeviceAutonomousScan(
  compressedFile: File,
  previewUrl: string,
  width: number,
  height: number,
  shoppingItems: ShoppingItem[],
  language: ReceiptOcrLanguage = 'fa-en',
  onProgress?: (stage: string, pct: number) => void
): Promise<ScanResponse> {
  const startedAt = Date.now();
  let cancelled = false;
  let rejectCancellation: ((error: Error) => void) | null = null;
  const cancelledPromise = new Promise<never>((_, reject) => {
    rejectCancellation = reject;
  });
  activeProgress = onProgress || null;
  activeCancel = () => {
    cancelled = true;
    rejectCancellation?.(new Error('SCAN_CANCELLED'));
    disposeWorker();
    if (Capacitor.getPlatform() === 'android') {
      void OfflineOcrAssets.cancelRecognition().catch(() => {});
    }
  };

  try {
    let rawLines: string[];
    let lineBoxes: BoundingBox[];
    let confidence: number;

    if (Capacitor.getPlatform() === 'android') {
      progress('بارگذاری موتور بومی OCR و مدل‌های آفلاین...', 22);
      const nativeProgressListener = await OfflineOcrAssets.addListener('ocrProgress', (update) => {
        const nativePercent = Math.max(0, Math.min(100, Number(update.percent) || 0));
        progress(update.stage || 'در حال خواندن فاکتور روی گوشی...', 28 + nativePercent * 0.62);
      });
      try {
        const imageBase64 = await blobToBase64(compressedFile);
        if (cancelled) throw new Error('SCAN_CANCELLED');
        const remainingMs = MAX_SCAN_TIME_MS - (Date.now() - startedAt);
        if (remainingMs <= 0) throw new Error('SCAN_TIMEOUT');

        const nativeRecognition = OfflineOcrAssets.recognizeReceipt({
          imageBase64,
          language: OCR_LANGUAGES[language],
          width,
          height,
        });
        const recognized: NativeOcrResult = await Promise.race([
          withTimeout(nativeRecognition, remainingMs, () => {
            void OfflineOcrAssets.cancelRecognition().catch(() => {});
          }),
          cancelledPromise,
        ]);
        const nativeLines = Array.isArray(recognized.lines)
          ? recognized.lines.filter((line) => line.text?.trim())
          : [];
        if (nativeLines.length > 0) {
          rawLines = nativeLines.map((line) => line.text.trim());
          lineBoxes = nativeLines.map((line) => ({
            x: Number((line.bbox.x0 / width).toFixed(4)),
            y: Number((line.bbox.y0 / height).toFixed(4)),
            w: Number(((line.bbox.x1 - line.bbox.x0) / width).toFixed(4)),
            h: Number(((line.bbox.y1 - line.bbox.y0) / height).toFixed(4)),
            text: line.text.trim(),
            confidence: Math.round(line.confidence || 0),
          }));
        } else {
          rawLines = (recognized.text || '').split(/\r?\n/).map((text) => text.trim()).filter(Boolean);
          lineBoxes = rawLines.map((text) => ({
            x: 0,
            y: 0,
            w: 0,
            h: 0,
            text,
            confidence: Math.round(recognized.confidence || 0),
          }));
        }
        confidence = Number(recognized.confidence || 75);
      } finally {
        await nativeProgressListener.remove();
      }
    } else {
      progress('در حال آماده‌سازی موتور OCR آفلاین...', 21);
      const worker = await Promise.race([
        getOcrWorker(language, MAX_SCAN_TIME_MS, onProgress),
        cancelledPromise,
      ]);

      const remainingMs = MAX_SCAN_TIME_MS - (Date.now() - startedAt);
      if (remainingMs <= 0) {
        disposeWorker();
        throw new Error('SCAN_TIMEOUT');
      }

      progress('در حال خواندن فاکتور...', 36);
      const recognition = worker.recognize(compressedFile, {}, { blocks: true });
      const recognized = await Promise.race([
        withTimeout(recognition, remainingMs, () => disposeWorker()),
        cancelledPromise,
      ]);

      const ocrLines = flattenOcrLines(recognized.data).filter((line) => line.text.trim());
      rawLines = ocrLines.map((line) => line.text.trim());
      lineBoxes = ocrLines.map((line) => ({
        x: Number((line.bbox.x0 / width).toFixed(4)),
        y: Number((line.bbox.y0 / height).toFixed(4)),
        w: Number(((line.bbox.x1 - line.bbox.x0) / width).toFixed(4)),
        h: Number(((line.bbox.y1 - line.bbox.y0) / height).toFixed(4)),
        text: line.text?.trim() || '',
        confidence: Math.round(line.confidence || 0),
      }));
      confidence = Number(recognized.data.confidence || 75);
    }

    progress('تطبیق اقلام با چک‌لیست خرید...', 96);
    const parsed = parsePersianReceiptText(rawLines, lineBoxes, confidence);
    const reconciliation = reconcileReceiptWithShoppingList(parsed.items, shoppingItems);
    progress('فاکتور آمادهٔ بازبینی است.', 100);
    resetIdleTimer();

    return {
      ok: true,
      engine: language === 'tr-en' ? 'OCR آفلاین ترکی و انگلیسی' : 'OCR آفلاین فارسی و انگلیسی',
      durationMs: Date.now() - startedAt,
      originalImageUrl: previewUrl,
      processedImageUrl: previewUrl,
      perspectiveCropped: false,
      lineBoxes,
      rawOcrText: rawLines.join('\n'),
      receipt: {
        ...parsed,
        ocr_engine: language === 'tr-en' ? 'Tesseract TUR+ENG Offline' : 'Tesseract FAS+ENG Offline',
        raw_ocr_text: rawLines.join('\n'),
        image_url: previewUrl,
        processed_image_url: previewUrl,
      },
      reconciliation,
    };
  } catch (error) {
    if ((error as Error)?.message === 'SCAN_TIMEOUT') {
      disposeWorker();
      throw new Error('SCAN_TIMEOUT');
    }
    if ((error as Error)?.message === 'SCAN_CANCELLED' || cancelled) {
      throw new Error('SCAN_CANCELLED');
    }
    disposeWorker();
    throw error;
  } finally {
    activeCancel = null;
    activeProgress = null;
  }
}

export async function scanReceiptHybrid(params: {
  file?: File | null;
  sampleId?: string | null;
  imageUrl?: string | null;
  language?: ReceiptOcrLanguage;
  shoppingItems: ShoppingItem[];
  onProgress?: (stage: string, pct: number, previewUrl?: string) => void;
}): Promise<ScanResponse> {
  const { file, sampleId, imageUrl, language = 'fa-en', shoppingItems, onProgress } = params;
  cancelRequested = false;
  const source: File | Blob | string =
    file || imageUrl || assetUrl(`samples/sample-${sampleId || 'ofogh'}.png`);

  onProgress?.('فشرده‌سازی عکس و آماده‌سازی فاکتور روی گوشی...', 8);
  const prepared = await normalizeAndCompressReceiptPhoto(source);
  if (cancelRequested) {
    URL.revokeObjectURL(prepared.previewUrl);
    throw new Error('SCAN_CANCELLED');
  }
  onProgress?.(
    `عکس بهینه شد (${Math.max(1, Math.round(prepared.sizeBytes / 1024))} کیلوبایت)؛ شروع اسکن آفلاین...`,
    18,
    prepared.previewUrl
  );

  try {
    return await runOnDeviceAutonomousScan(
      prepared.compressedFile,
      prepared.previewUrl,
      prepared.width,
      prepared.height,
      shoppingItems,
      language,
      (stage, percent) => onProgress?.(stage, percent, prepared.previewUrl)
    );
  } catch (error) {
    // The caller owns and can reuse the compressed preview after a timeout to retry without
    // reopening the camera. Do not revoke the URL here.
    throw error;
  }
}
