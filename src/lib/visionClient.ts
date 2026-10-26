import { Capacitor } from '@capacitor/core';
import { createWorker } from 'tesseract.js';
import type { BoundingBox, ScanResponse, ShoppingItem } from '../types';
import { assetUrl } from './assetUrl';
import { OfflineOcrAssets, type NativeOcrResult } from './offlineOcrAssets';
import {
  normalizePersianText,
  parsePersianReceiptText,
  reconcileReceiptWithShoppingList,
  recoverCollapsedReceiptLines,
} from './persianMatcher';

export type ReceiptOcrLanguage = 'fa-en' | 'tr-en';

const OCR_LANGUAGES: Record<ReceiptOcrLanguage, string> = {
  'fa-en': 'fas+eng',
  'tr-en': 'tur+eng',
};
const MAX_RECEIPT_EDGE = 2800;
const LONG_RECEIPT_MIN_EDGE = 2400;
const RECEIPT_TILE_OVERLAP = 160;
const LONG_THERMAL_TILE_HEIGHT = 1400;
const MAX_RECEIPT_TILES = 8;
const MAX_SCAN_TIME_MS = 90_000;
const MAX_NATIVE_SCAN_TIME_MS = 180_000;
const MAX_NATIVE_SCAN_TOTAL_MS = 540_000;
const WORKER_IDLE_MS = 60_000;

type PreparedOcrSegment = {
  file: File;
  width: number;
  height: number;
  top: number;
  fullHeight: number;
};
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
): Promise<{
  compressedFile: File;
  previewUrl: string;
  width: number;
  height: number;
  sizeBytes: number;
  ocrSegments: PreparedOcrSegment[];
}> {
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

    const previewScale = Math.min(1, MAX_RECEIPT_EDGE / Math.max(sourceWidth, sourceHeight));
    const previewWidth = Math.max(1, Math.round(sourceWidth * previewScale));
    const previewHeight = Math.max(1, Math.round(sourceHeight * previewScale));
    const previewCanvas = document.createElement('canvas');
    previewCanvas.width = previewWidth;
    previewCanvas.height = previewHeight;
    const previewContext = previewCanvas.getContext('2d', { alpha: false });
    if (!previewContext) throw new Error('مرورگر گوشی نتوانست تصویر را آماده کند.');

    previewContext.fillStyle = '#fff';
    previewContext.fillRect(0, 0, previewWidth, previewHeight);
    try {
      previewContext.filter = 'grayscale(1) contrast(1.14)';
    } catch {
      // Older WebViews can ignore canvas filters; the resized image is still usable.
    }
    previewContext.drawImage(image, 0, 0, previewWidth, previewHeight);
    try {
      previewContext.filter = 'none';
    } catch {
      // No-op on older WebViews.
    }

    const previewBlob = await canvasToJpeg(previewCanvas, 0.92);
    const compressedFile = new File([previewBlob], `receipt-${Date.now()}.jpg`, { type: 'image/jpeg' });
    const previewUrl = URL.createObjectURL(previewBlob);

    // Do not shrink a long thermal receipt to a single 2,800-pixel image. That used to turn
    // fine print into a few unreadable pixels. Keep the original print resolution and OCR
    // overlapping strips; the overlap prevents a row at a strip boundary from being cut in half.
    const receiptAspectRatio = sourceHeight / sourceWidth;
    const isLongReceipt = sourceHeight >= LONG_RECEIPT_MIN_EDGE && receiptAspectRatio >= 1.3;
    const isNarrowThermalReceipt = isLongReceipt && sourceWidth <= 1400 && receiptAspectRatio >= 2.3;
    const segmentHeightLimit = isNarrowThermalReceipt ? LONG_THERMAL_TILE_HEIGHT : MAX_RECEIPT_EDGE;
    const ocrScale = isLongReceipt
      ? Math.min(1, MAX_RECEIPT_EDGE / sourceWidth)
      : previewScale;
    const width = Math.max(1, Math.round(sourceWidth * ocrScale));
    const height = Math.max(1, Math.round(sourceHeight * ocrScale));
    const segments: PreparedOcrSegment[] = [];

    if (!isLongReceipt || height <= segmentHeightLimit) {
      segments.push({ file: compressedFile, width, height, top: 0, fullHeight: height });
    } else {
      const stride = segmentHeightLimit - RECEIPT_TILE_OVERLAP;
      const segmentCount = Math.ceil((height - RECEIPT_TILE_OVERLAP) / stride);
      if (segmentCount > MAX_RECEIPT_TILES) {
        URL.revokeObjectURL(previewUrl);
        throw new Error('فاکتور بیش از حد بلند است؛ آن را به چند عکسِ هم‌پوشان تقسیم کن.');
      }

      for (let top = 0; top < height; top += stride) {
        const tileHeight = Math.min(segmentHeightLimit, height - top);
        const tileCanvas = document.createElement('canvas');
        tileCanvas.width = width;
        tileCanvas.height = tileHeight;
        const tileContext = tileCanvas.getContext('2d', { alpha: false });
        if (!tileContext) {
          URL.revokeObjectURL(previewUrl);
          throw new Error('گوشی نتوانست بخش‌های فاکتور را برای خواندن آماده کند.');
        }
        tileContext.fillStyle = '#fff';
        tileContext.fillRect(0, 0, width, tileHeight);
        try {
          tileContext.filter = 'grayscale(1) contrast(1.14)';
        } catch {
          // Older WebViews can ignore canvas filters.
        }
        tileContext.drawImage(
          image,
          0,
          top / ocrScale,
          sourceWidth,
          tileHeight / ocrScale,
          0,
          0,
          width,
          tileHeight
        );
        try {
          tileContext.filter = 'none';
        } catch {
          // No-op on older WebViews.
        }
        const tileBlob = await canvasToJpeg(tileCanvas, 0.94);
        const tileFile = new File([tileBlob], `receipt-part-${segments.length + 1}.jpg`, {
          type: 'image/jpeg',
        });
        segments.push({ file: tileFile, width, height: tileHeight, top, fullHeight: height });
        if (top + tileHeight >= height) break;
      }
    }

    return {
      compressedFile,
      previewUrl,
      width,
      height,
      sizeBytes: segments.reduce((total, segment) => total + segment.file.size, 0),
      ocrSegments: segments,
    };
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

function mapSegmentLine(line: OcrLineData, segment: PreparedOcrSegment): OcrLineData {
  return {
    ...line,
    text: line.text.trim(),
    bbox: {
      x0: line.bbox.x0,
      y0: segment.top + line.bbox.y0,
      x1: line.bbox.x1,
      y1: segment.top + line.bbox.y1,
    },
  };
}

function filterSegmentOwnedLines(lines: OcrLineData[], segment: PreparedOcrSegment): OcrLineData[] {
  const ownedTop = segment.top === 0 ? 0 : segment.top + RECEIPT_TILE_OVERLAP / 2;
  const tileBottom = segment.top + segment.height;
  const isLastSegment = tileBottom >= segment.fullHeight;
  const ownedBottom = isLastSegment
    ? segment.fullHeight
    : tileBottom - RECEIPT_TILE_OVERLAP / 2;
  return lines.filter((line) => {
    if (line.bbox.y1 <= line.bbox.y0) return true;
    const lineCenter = (line.bbox.y0 + line.bbox.y1) / 2;
    return lineCenter >= ownedTop && lineCenter < ownedBottom;
  });
}

function deduplicateOverlappingLines(lines: OcrLineData[]): OcrLineData[] {
  const ordered = [...lines].sort((first, second) => first.bbox.y0 - second.bbox.y0);
  const unique: OcrLineData[] = [];
  for (const line of ordered) {
    const key = normalizePersianText(line.text)
      .toLowerCase()
      .replace(/[^0-9a-z\u0600-\u06FF]/g, '');
    const center = (line.bbox.y0 + line.bbox.y1) / 2;
    const duplicateIndex = key.length < 3 || line.bbox.y1 <= line.bbox.y0
      ? -1
      : unique.findIndex((existing) => {
          if (existing.bbox.y1 <= existing.bbox.y0) return false;
          const existingKey = normalizePersianText(existing.text)
            .toLowerCase()
            .replace(/[^0-9a-z\u0600-\u06FF]/g, '');
          const existingCenter = (existing.bbox.y0 + existing.bbox.y1) / 2;
          const allowedDistance = Math.max(
            12,
            Math.max(line.bbox.y1 - line.bbox.y0, existing.bbox.y1 - existing.bbox.y0)
          );
          return key === existingKey && Math.abs(center - existingCenter) <= allowedDistance;
        });

    if (duplicateIndex < 0) {
      unique.push(line);
    } else if (line.confidence > unique[duplicateIndex].confidence) {
      unique[duplicateIndex] = line;
    }
  }
  return unique.sort((first, second) => first.bbox.y0 - second.bbox.y0);
}

export async function runOnDeviceAutonomousScan(
  compressedFile: File,
  previewUrl: string,
  width: number,
  height: number,
  shoppingItems: ShoppingItem[],
  language: ReceiptOcrLanguage = 'fa-en',
  onProgress?: (stage: string, pct: number) => void,
  ocrSegments: PreparedOcrSegment[] = []
): Promise<ScanResponse> {
  const startedAt = Date.now();
  const isNativeAndroid = Capacitor.getPlatform() === 'android';
  const segments = ocrSegments.length
    ? ocrSegments
    : [{ file: compressedFile, width, height, top: 0, fullHeight: height }];
  const scanTimeoutMs = isNativeAndroid
    ? Math.min(MAX_NATIVE_SCAN_TOTAL_MS, MAX_NATIVE_SCAN_TIME_MS + Math.max(0, segments.length - 1) * 90_000)
    : Math.min(240_000, MAX_SCAN_TIME_MS + Math.max(0, segments.length - 1) * 30_000);
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
    if (isNativeAndroid) {
      void OfflineOcrAssets.cancelRecognition().catch(() => {});
    }
  };

  try {
    let rawLines: string[];
    let lineBoxes: BoundingBox[];
    let confidence: number;

    if (isNativeAndroid) {
      progress('بارگذاری موتور بومی OCR و مدل‌های آفلاین...', 22);
      const scannedLines: OcrLineData[] = [];
      let confidenceTotal = 0;
      let confidenceWeight = 0;
      let currentSegmentIndex = 0;
      const nativeProgressListener = await OfflineOcrAssets.addListener('ocrProgress', (update) => {
        const nativePercent = Math.max(0, Math.min(100, Number(update.percent) || 0));
        const overallPercent = 28 + ((currentSegmentIndex + nativePercent / 100) / segments.length) * 62;
        const stage = segments.length > 1
          ? `خواندن بخش ${currentSegmentIndex + 1} از ${segments.length} فاکتور...`
          : update.stage || 'در حال خواندن فاکتور روی گوشی...';
        progress(stage, overallPercent);
      });
      try {
        for (let index = 0; index < segments.length; index++) {
          const segment = segments[index];
          currentSegmentIndex = index;
          progress(
            segments.length > 1
              ? `خواندن بخش ${index + 1} از ${segments.length} فاکتور...`
              : 'در حال خواندن متن و مبلغ‌های فاکتور...',
            28 + (index / segments.length) * 62
          );
          const imageBase64 = await blobToBase64(segment.file);
          if (cancelled) throw new Error('SCAN_CANCELLED');
          const remainingMs = scanTimeoutMs - (Date.now() - startedAt);
          if (remainingMs <= 0) throw new Error('SCAN_TIMEOUT');

          const nativeRecognition = OfflineOcrAssets.recognizeReceipt({
            imageBase64,
            language: OCR_LANGUAGES[language],
            width: segment.width,
            height: segment.height,
            longReceipt: segments.length > 1,
            receiptTail:
              segments.length > 1 &&
              segment.top + segment.height >= segment.fullHeight,
          });
          const recognized: NativeOcrResult = await Promise.race([
            withTimeout(nativeRecognition, remainingMs, () => {
              void OfflineOcrAssets.cancelRecognition().catch(() => {});
            }),
            cancelledPromise,
          ]);
          const nativeLines: OcrLineData[] = Array.isArray(recognized.lines)
            ? recognized.lines
                .filter((line) => line.text?.trim())
                .map((line) =>
                  mapSegmentLine(
                    {
                      text: line.text,
                      confidence: Number(line.confidence) || 0,
                      bbox: line.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 },
                    },
                    segment
                  )
                )
            : [];
          const segmentLines = nativeLines.length > 0
            ? filterSegmentOwnedLines(nativeLines, segment)
            : filterSegmentOwnedLines(
                (recognized.text || '')
                  .split(/\r?\n/)
                  .map((text) => text.trim())
                  .filter(Boolean)
                  .map((text) =>
                    mapSegmentLine(
                      {
                        text,
                        confidence: Number(recognized.confidence) || 0,
                        bbox: { x0: 0, y0: 0, x1: 0, y1: 0 },
                      },
                      segment
                    )
                  ),
                segment
              );
          scannedLines.push(...segmentLines);
          const segmentConfidence = Number(recognized.confidence);
          const weight = Math.max(1, segmentLines.length);
          confidenceTotal += (Number.isFinite(segmentConfidence) ? segmentConfidence : 75) * weight;
          confidenceWeight += weight;
        }
      } finally {
        await nativeProgressListener.remove();
      }
      const orderedLines = deduplicateOverlappingLines(scannedLines);
      rawLines = orderedLines.map((line) => line.text.trim()).filter(Boolean);
      lineBoxes = orderedLines.map((line) => ({
        x: Number((line.bbox.x0 / width).toFixed(4)),
        y: Number((line.bbox.y0 / height).toFixed(4)),
        w: Number(((line.bbox.x1 - line.bbox.x0) / width).toFixed(4)),
        h: Number(((line.bbox.y1 - line.bbox.y0) / height).toFixed(4)),
        text: line.text.trim(),
        confidence: Math.round(line.confidence || 0),
      }));
      confidence = confidenceWeight ? confidenceTotal / confidenceWeight : 0;
    } else {
      progress('در حال آماده‌سازی موتور OCR آفلاین...', 21);
      const worker = await Promise.race([
        getOcrWorker(language, scanTimeoutMs, onProgress),
        cancelledPromise,
      ]);
      const scannedLines: OcrLineData[] = [];
      let confidenceTotal = 0;
      let confidenceWeight = 0;

      for (let index = 0; index < segments.length; index++) {
        const segment = segments[index];
        const remainingMs = scanTimeoutMs - (Date.now() - startedAt);
        if (remainingMs <= 0) {
          disposeWorker();
          throw new Error('SCAN_TIMEOUT');
        }
        progress(
          segments.length > 1
            ? `خواندن بخش ${index + 1} از ${segments.length} فاکتور...`
            : 'در حال خواندن متن و مبلغ‌های فاکتور...',
          36 + (index / segments.length) * 58
        );
        const recognition = worker.recognize(segment.file, {}, { blocks: true });
        const recognized = await Promise.race([
          withTimeout(recognition, remainingMs, () => disposeWorker()),
          cancelledPromise,
        ]);
        const segmentLines = filterSegmentOwnedLines(
          flattenOcrLines(recognized.data)
            .filter((line) => line.text.trim())
            .map((line) => mapSegmentLine(line, segment)),
          segment
        );
        scannedLines.push(...segmentLines);
        const segmentConfidence = Number(recognized.data.confidence);
        const weight = Math.max(1, segmentLines.length);
        confidenceTotal += (Number.isFinite(segmentConfidence) ? segmentConfidence : 75) * weight;
        confidenceWeight += weight;
      }
      const orderedLines = deduplicateOverlappingLines(scannedLines);
      rawLines = orderedLines.map((line) => line.text.trim()).filter(Boolean);
      lineBoxes = orderedLines.map((line) => ({
        x: Number((line.bbox.x0 / width).toFixed(4)),
        y: Number((line.bbox.y0 / height).toFixed(4)),
        w: Number(((line.bbox.x1 - line.bbox.x0) / width).toFixed(4)),
        h: Number(((line.bbox.y1 - line.bbox.y0) / height).toFixed(4)),
        text: line.text?.trim() || '',
        confidence: Math.round(line.confidence || 0),
      }));
      confidence = confidenceWeight ? confidenceTotal / confidenceWeight : 0;
    }

    const recoveredLines = recoverCollapsedReceiptLines(rawLines);
    const recoveredLineBoxes = recoveredLines.length === lineBoxes.length ? lineBoxes : [];
    progress('تطبیق اقلام با چک‌لیست خرید...', 96);
    const parsed = parsePersianReceiptText(recoveredLines, recoveredLineBoxes, confidence);
    const reconciliation = reconcileReceiptWithShoppingList(parsed.items, shoppingItems);
    const itemSubtotal = parsed.items.reduce((sum, item) => sum + Number(item.total_price || 0), 0);
    const amountTolerance = Math.max(500, Math.round(Math.abs(parsed.subtotal) * 0.001));
    const payableFromItems = Math.max(0, itemSubtotal - parsed.discount_total + parsed.tax_total);
    const ocrQuality = {
      itemCount: parsed.items.length,
      unrecognizedItemCount: parsed.items.filter((item) => item.name.startsWith('کالای نامشخص')).length,
      amountReadFromReceipt: parsed.amount_read_from_receipt,
      subtotalReadFromReceipt: parsed.subtotal_read_from_receipt,
      itemTotalsMatchSubtotal: Math.abs(itemSubtotal - parsed.subtotal) <= amountTolerance,
      payableMatchesItems: Math.abs(parsed.total_amount - payableFromItems) <= amountTolerance,
    };
    progress('فاکتور آمادهٔ بازبینی است.', 100);
    resetIdleTimer();

    return {
      ok: true,
      engine: language === 'tr-en' ? 'OCR آفلاین ترکی و انگلیسی' : 'OCR آفلاین فارسی و انگلیسی',
      durationMs: Date.now() - startedAt,
      originalImageUrl: previewUrl,
      processedImageUrl: previewUrl,
      perspectiveCropped: false,
      lineBoxes: recoveredLineBoxes,
      rawOcrText: recoveredLines.join('\n'),
      ocrQuality,
      receipt: {
        ...parsed,
        ocr_engine: language === 'tr-en' ? 'Tesseract TUR+ENG Offline' : 'Tesseract FAS+ENG Offline',
        raw_ocr_text: recoveredLines.join('\n'),
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
  const segmentMessage = prepared.ocrSegments.length > 1
    ? `؛ فاکتور در ${prepared.ocrSegments.length} بخشِ هم‌پوشان خوانده می‌شود`
    : '';
  onProgress?.(
    `عکس آماده شد (${Math.max(1, Math.round(prepared.sizeBytes / 1024))} کیلوبایت)${segmentMessage}؛ شروع اسکن آفلاین...`,
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
      (stage, percent) => onProgress?.(stage, percent, prepared.previewUrl),
      prepared.ocrSegments
    );
  } catch (error) {
    // The caller owns and can reuse the compressed preview after a timeout to retry without
    // reopening the camera. Do not revoke the URL here.
    throw error;
  }
}
