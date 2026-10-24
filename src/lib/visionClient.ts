import { createWorker, type Worker } from 'tesseract.js';
import { Capacitor } from '@capacitor/core';
import type { BoundingBox, ScanResponse, ShoppingItem } from '../types';
import { assetUrl } from './assetUrl';
import {
  extractThermalRowsFromGrayscale,
  fuseDualHeadLines,
  parsePersianReceiptText,
  reconcileReceiptWithShoppingList,
  type NeuralLineInput,
  type ThermalNumericRow,
} from './persianMatcher';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './supabase';

export interface CloudVisionSettings {
  enabled: boolean;
  provider: 'gemini' | 'openai';
  apiKey: string;
}

export function getCloudVisionSettings(): CloudVisionSettings {
  try {
    const raw = localStorage.getItem('kharidyar_vision_ai_v1');
    if (raw) return JSON.parse(raw) as CloudVisionSettings;
  } catch {
    // ignore
  }
  return { enabled: false, provider: 'gemini', apiKey: '' };
}

export function saveCloudVisionSettings(settings: CloudVisionSettings) {
  localStorage.setItem('kharidyar_vision_ai_v1', JSON.stringify(settings));
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout (${ms}ms): ${label}`)), ms);
    promise.then(
      (val) => {
        clearTimeout(t);
        resolve(val);
      },
      (err) => {
        clearTimeout(t);
        reject(err);
      }
    );
  });
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Android 7-era WebViews have small heaps and much slower WASM execution. */
function isLowPowerAndroid(): boolean {
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const androidMatch = userAgent.match(/Android\s+(\d+(?:\.\d+)?)/i);
  const isAndroid = Capacitor.getPlatform() === 'android' || Boolean(androidMatch);
  if (!isAndroid) return false;
  const major = androidMatch ? Number(androidMatch[1].split('.')[0]) : 0;
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 0 : 0;
  const deviceMemory = Number((navigator as Navigator & { deviceMemory?: number })?.deviceMemory || 0);
  return (major > 0 && major <= 7) || (cores > 0 && cores <= 4) || (deviceMemory > 0 && deviceMemory <= 2);
}

export async function normalizeAndCompressReceiptPhoto(
  source: File | Blob | string
): Promise<{ compressedFile: File; previewDataUrl: string; width: number; height: number }> {
  let srcUrl = '';
  let temporaryObjectUrl = false;
  if (typeof source === 'string') {
    srcUrl = source;
  } else {
    // Keep large gallery photos as Blob URLs instead of turning the full-resolution file into
    // a base64 string first. Base64 duplicates camera memory and can kill older Android WebViews.
    srcUrl = URL.createObjectURL(source);
    temporaryObjectUrl = true;
  }
  const lowPowerAndroid = isLowPowerAndroid();

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      if (srcUrl.startsWith('http://') || srcUrl.startsWith('https://')) {
        el.crossOrigin = 'anonymous';
      }
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('فرمت تصویر قابل خواندن نیست'));
      el.src = srcUrl;
    });

    // Keep enough pixels for the tiny dot-matrix prices; reduce JPEG quality, not receipt detail.
    const maxW = 1500;
    const maxH = 2667;
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    if (w > maxW || h > maxH) {
      const ratio = Math.min(maxW / w, maxH / h);
      w = Math.round(w * ratio);
      h = Math.round(h * ratio);
    }
    const jpegQuality = lowPowerAndroid ? 0.82 : 0.9;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('خطا در آماده‌سازی بوم پردازش تصویر');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    const previewDataUrl = canvas.toDataURL('image/jpeg', jpegQuality);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('خطا در فشرده‌سازی تصویر'))),
        'image/jpeg',
        jpegQuality
      );
    });

    const compressedFile = new File([blob], `receipt-${Date.now()}.jpg`, {
      type: 'image/jpeg',
    });

    return { compressedFile, previewDataUrl, width: w, height: h };
  } finally {
    if (temporaryObjectUrl) {
      URL.revokeObjectURL(srcUrl);
    }
  }
}

async function enhanceImageOnCanvas(
  dataUrl: string,
  onProgress?: (stage: string, pct: number) => void
): Promise<{
  enhancedDataUrl: string;
  ocrDataUrl: string;
  width: number;
  height: number;
  ocrWidth: number;
  ocrHeight: number;
  sourceYScale: number;
  thermalRows: ThermalNumericRow[];
}> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (dataUrl.startsWith('http://') || dataUrl.startsWith('https://')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = async () => {
      try {
      const lowPowerAndroid = isLowPowerAndroid();
      // Thermal prices need their original dot detail; the optimized extractor is now fast enough
      // to keep the full 1500px receipt width even on legacy Android.
      const processMaxW = 1500;
      const processMaxH = 2667;
      const jpegQuality = lowPowerAndroid ? 0.82 : 0.9;
      onProgress?.('کوچک‌سازی هوشمند عکس برای جلوگیری از پرشدن حافظه گوشی...', 20);
      await yieldToUi();

      // Step 0: Detect & auto-crop dark table/background margins on left/right of bright receipt paper
      const probeW = Math.min(480, img.width);
      const probeH = Math.max(120, Math.round((img.height * probeW) / img.width));
      const probeCanvas = document.createElement('canvas');
      probeCanvas.width = probeW;
      probeCanvas.height = probeH;
      const pctx = probeCanvas.getContext('2d');
      let cropX0 = 0;
      let cropY0 = 0;
      let cropW = img.width;
      let cropH = img.height;

      if (pctx) {
        pctx.drawImage(img, 0, 0, probeW, probeH);
        const pData = pctx.getImageData(0, 0, probeW, probeH).data;
        const colMed = new Float32Array(probeW);
        const yStart = Math.floor(probeH * 0.2);
        const yEnd = Math.floor(probeH * 0.8);
        for (let x = 0; x < probeW; x++) {
          const vals: number[] = [];
          for (let y = yStart; y < yEnd; y += 3) {
            const idx = (y * probeW + x) * 4;
            vals.push(0.55 * pData[idx] + 0.35 * pData[idx + 1] + 0.1 * pData[idx + 2]);
          }
          vals.sort((a, b) => a - b);
          colMed[x] = vals[Math.floor(vals.length / 2)] || 0;
        }
        const centerSlice = Array.from(
          colMed.slice(Math.floor(probeW * 0.25), Math.floor(probeW * 0.75))
        ).sort((a, b) => a - b);
        const centerBright = centerSlice[Math.floor(centerSlice.length / 2)] || 180;
        const thresh = Math.max(85, centerBright * 0.68);
        let firstBright = -1;
        let lastBright = -1;
        for (let x = 0; x < probeW; x++) {
          if (colMed[x] >= thresh) {
            if (firstBright === -1) firstBright = x;
            lastBright = x;
          }
        }
        if (firstBright !== -1 && lastBright - firstBright >= probeW * 0.45 && lastBright - firstBright < probeW * 0.93) {
          const pad = Math.round(probeW * 0.015);
          const cx0 = Math.max(0, firstBright - pad);
          const cx1 = Math.min(probeW, lastBright + pad);
          cropX0 = Math.round((cx0 / probeW) * img.width);
          cropW = Math.round(((cx1 - cx0) / probeW) * img.width);
        }
      }

      const maxScale = lowPowerAndroid ? 1.15 : 1.6;
      const scale = Math.min(processMaxW / cropW, processMaxH / cropH, maxScale);
      const w = Math.max(1, Math.round(cropW * scale));
      const h = Math.max(200, Math.round(cropH * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        resolve({
          enhancedDataUrl: dataUrl,
          ocrDataUrl: dataUrl,
          width: img.width,
          height: img.height,
          ocrWidth: img.width,
          ocrHeight: img.height,
          sourceYScale: 1,
          thermalRows: [],
        });
        return;
      }
      ctx.drawImage(img, cropX0, cropY0, cropW, cropH, 0, 0, w, h);
      const imgData = ctx.getImageData(0, 0, w, h);
      const d = imgData.data;

      // Use Red channel biased luminance (removes warm yellow room lighting on thermal paper).
      // Yield periodically so an Android 7 WebView can keep painting progress instead of appearing hung.
      const lumArr = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        const pixelRow = y * w;
        const dataRow = pixelRow * 4;
        for (let x = 0; x < w; x++) {
          const i = dataRow + x * 4;
          lumArr[pixelRow + x] = Math.round(0.55 * d[i] + 0.35 * d[i + 1] + 0.1 * d[i + 2]);
        }
        if (lowPowerAndroid && y > 0 && y % 96 === 0) {
          onProgress?.('بهینه‌سازی نور و کنتراست فاکتور...', 22 + Math.round((y / h) * 4));
          await yieldToUi();
        }
      }

      // Fast coarse illumination background grid (32x32 tiles) to flatten hand/phone shadows
      const tile = 48;
      const gw = Math.ceil(w / tile);
      const gh = Math.ceil(h / tile);
      const gridBg = new Uint8Array(gw * gh);
      for (let gy = 0; gy < gh; gy++) {
        for (let gx = 0; gx < gw; gx++) {
          let maxV = 120;
          const yStart = gy * tile;
          const yEnd = Math.min(h, yStart + tile);
          const xStart = gx * tile;
          const xEnd = Math.min(w, xStart + tile);
          for (let y = yStart; y < yEnd; y += 4) {
            const rowOff = y * w;
            for (let x = xStart; x < xEnd; x += 4) {
              const v = lumArr[rowOff + x];
              if (v > maxV) maxV = v;
            }
          }
          gridBg[gy * gw + gx] = maxV;
        }
        if (lowPowerAndroid && gy > 0 && gy % 8 === 0) {
          onProgress?.('حذف سایه‌های میز از روی فاکتور...', 27);
          await yieldToUi();
        }
      }

      const normArr = new Uint8Array(w * h);
      const hist = new Uint32Array(256);
      for (let y = 0; y < h; y++) {
        const gy = Math.min(gh - 1, Math.floor(y / tile));
        const rowOff = y * w;
        for (let x = 0; x < w; x++) {
          const gx = Math.min(gw - 1, Math.floor(x / tile));
          const bgV = Math.max(80, gridBg[gy * gw + gx]);
          const v = Math.min(255, Math.round((lumArr[rowOff + x] * 255) / bgV));
          normArr[rowOff + x] = v;
          hist[v]++;
        }
        if (lowPowerAndroid && y > 0 && y % 96 === 0) {
          onProgress?.('بهبود کنتراست خطوط چاپ حرارتی...', 31 + Math.round((y / h) * 5));
          await yieldToUi();
        }
      }

      const totalPx = normArr.length;
      let acc = 0;
      let pLow = 45;
      let pHigh = 230;
      for (let v = 0; v < 256; v++) {
        acc += hist[v];
        if (acc <= totalPx * 0.04) pLow = v;
        if (acc <= totalPx * 0.86) pHigh = v;
      }
      const span = Math.max(25, pHigh - pLow);

      const stretchedGray = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        const pixelRow = y * w;
        const dataRow = pixelRow * 4;
        for (let x = 0; x < w; x++) {
          const p = pixelRow + x;
          const i = dataRow + x * 4;
          const stretched = Math.max(0, Math.min(255, Math.round(((normArr[p] - pLow) * 255) / span)));
          stretchedGray[p] = stretched;
          d[i] = stretched;
          d[i + 1] = stretched;
          d[i + 2] = stretched;
        }
        if (lowPowerAndroid && y > 0 && y % 96 === 0) {
          onProgress?.('آماده‌سازی تصویر برای خواندن نام کالاها...', 37 + Math.round((y / h) * 5));
          await yieldToUi();
        }
      }
      ctx.putImageData(imgData, 0, 0);

      onProgress?.('استخراج ارقام حرارتی فاکتور...', 43);
      await yieldToUi();
      const { thermalRows } = extractThermalRowsFromGrayscale(stretchedGray, w, h);

      const enhancedDataUrl = canvas.toDataURL('image/jpeg', jpegQuality);

      // Thermal receipts contain a long footer of loyalty/marketing text. OCR only needs the
      // store/date header and product rows; the exact total is already extracted geometrically.
      // Cropping the unused footer cuts OCR work substantially on slow phones without reducing text size.
      const itemRows = thermalRows.filter((row) => row.type === 'item_prices');
      const lastItemY = itemRows.length ? itemRows[itemRows.length - 1].yNorm : 1;
      const sourceYScale = itemRows.length >= 2 ? Math.min(0.84, Math.max(0.62, lastItemY + 0.07)) : 1;
      const cropHeight = Math.max(200, Math.min(h, Math.round(h * sourceYScale)));
      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = w;
      cropCanvas.height = cropHeight;
      const cropCtx = cropCanvas.getContext('2d');
      if (cropCtx) {
        cropCtx.drawImage(canvas, 0, 0, w, cropHeight, 0, 0, w, cropHeight);
      }

      const ocrMaxDim = lowPowerAndroid ? 1600 : 1350;
      const ocrScale = Math.min(1, ocrMaxDim / Math.max(w, cropHeight));
      const ow = Math.max(1, Math.round(w * ocrScale));
      const oh = Math.max(1, Math.round(cropHeight * ocrScale));
      const ocrCanvas = document.createElement('canvas');
      ocrCanvas.width = ow;
      ocrCanvas.height = oh;
      const octx = ocrCanvas.getContext('2d');
      if (octx) {
        octx.drawImage(cropCtx ? cropCanvas : canvas, 0, 0, ow, oh);
        resolve({
          enhancedDataUrl,
          ocrDataUrl: ocrCanvas.toDataURL('image/jpeg', jpegQuality),
          width: w,
          height: h,
          ocrWidth: ow,
          ocrHeight: oh,
          sourceYScale: cropHeight / h,
          thermalRows,
        });
        return;
      }

      resolve({
        enhancedDataUrl,
        ocrDataUrl: enhancedDataUrl,
        width: w,
        height: h,
        ocrWidth: w,
        ocrHeight: h,
        sourceYScale: 1,
        thermalRows,
      });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };
    img.onerror = () => reject(new Error('خطا در بارگذاری تصویر برای پردازش'));
    img.src = dataUrl;
  });
}

let cachedFasWorker: Worker | null = null;
let lastProgressCb: ((status: string, pct: number) => void) | null = null;

async function getOrInitFasWorker(): Promise<Worker> {
  if (cachedFasWorker) return cachedFasWorker;
  const workerJsUrl = assetUrl('tessdata/worker.min.js');
  const tessdataBaseUrl = assetUrl('tessdata').replace(/\/$/, '');
  const isCrossOrigin = (() => {
    try {
      return new URL(workerJsUrl, window.location.href).origin !== window.location.origin;
    } catch {
      return false;
    }
  })();

  cachedFasWorker = await createWorker('fas', 1, {
    workerBlobURL: isCrossOrigin,
    workerPath: workerJsUrl,
    corePath: tessdataBaseUrl,
    langPath: tessdataBaseUrl,
    gzip: true,
    cacheMethod: 'none',
    logger: (m) => {
      if (typeof m.progress === 'number') {
        lastProgressCb?.(m.status, m.progress);
      }
    },
  });
  return cachedFasWorker;
}

export async function runOnDeviceAutonomousScan(
  dataUrl: string,
  shoppingItems: ShoppingItem[],
  onProgress?: (stage: string, pct: number) => void
): Promise<ScanResponse> {
  const startedAt = Date.now();
  const lowPowerAndroid = isLowPowerAndroid();
  onProgress?.('بهینه‌سازی عکس با حالت سازگار با گوشی شما...', 16);
  const { enhancedDataUrl, ocrDataUrl, ocrWidth, ocrHeight, sourceYScale, thermalRows } =
    await enhanceImageOnCanvas(dataUrl, onProgress);

  onProgress?.('آماده‌سازی موتور خوانش فارسی (اولین اسکن ممکن است کمی بیشتر طول بکشد)...', 45);
  lastProgressCb = (status, p) => {
    if (status === 'recognizing text') {
      const pct = Math.round(52 + p * 43);
      onProgress?.('در حال خواندن نام کالاها و مبالغ فاکتور...', pct);
    } else if (status === 'loading tesseract core') {
      onProgress?.('بارگذاری موتور OCR فارسی روی گوشی...', Math.round(45 + p * 4));
    } else if (status === 'loading language traineddata') {
      onProgress?.('بارگذاری واژه‌نامهٔ فارسی...', Math.round(49 + p * 3));
    }
  };

  let fasWorker: Worker;
  try {
    fasWorker = await withTimeout(
      getOrInitFasWorker(),
      lowPowerAndroid ? 90000 : 45000,
      'بارگذاری اولیه موتور بینایی ماشین'
    );
  } catch (err) {
    const worker = cachedFasWorker;
    cachedFasWorker = null;
    if (worker) await worker.terminate().catch(() => {});
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Timeout')) {
      throw new Error(
        lowPowerAndroid
          ? 'آماده‌سازی موتور فارسی روی گوشی قدیمی بیش از حد طول کشید. برنامه را باز نگه دار و دوباره تلاش کن.'
          : 'بارگذاری موتور خوانش فاکتور طول کشید. یک بار دیگر امتحان کن.'
      );
    }
    throw err;
  }

  try {
    onProgress?.('در حال خواندن متن فاکتور روی گوشی...', 51);
    let fasRes;
    try {
      fasRes = await withTimeout(
        fasWorker.recognize(ocrDataUrl, {}, { blocks: true }),
        lowPowerAndroid ? 150000 : 90000,
        'خوانش تصویر فاکتور'
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('Timeout')) {
        if (cachedFasWorker === fasWorker) cachedFasWorker = null;
        await fasWorker.terminate().catch(() => {});
        throw new Error(
          lowPowerAndroid
            ? 'خواندن فاکتور روی گوشی قدیمی بیشتر از حد مجاز طول کشید. عکس واضح و نزدیک‌تری بگیر؛ اگر دوباره تکرار شد، مدل گوشی و پیام خطا را بفرست.'
            : 'خواندن عکس بیشتر از حد مجاز طول کشید. لطفاً عکس واضح‌تر یا نزدیک‌تری امتحان کن.'
        );
      }
      throw err;
    }

    onProgress?.('تطبیق هوشمند اقلام فاکتور با لیست خرید...', 96);

    const fasLinesRaw =
      fasRes.data.blocks?.flatMap((b) => b.paragraphs.flatMap((p) => p.lines)) || [];

    const lineBoxes: BoundingBox[] = [];
    const paired: NeuralLineInput[] = [];

    for (const fl of fasLinesRaw) {
      const box: BoundingBox = {
        x: Number((fl.bbox.x0 / ocrWidth).toFixed(4)),
        y: Number(((fl.bbox.y0 / ocrHeight) * sourceYScale).toFixed(4)),
        w: Number(((fl.bbox.x1 - fl.bbox.x0) / ocrWidth).toFixed(4)),
        h: Number((((fl.bbox.y1 - fl.bbox.y0) / ocrHeight) * sourceYScale).toFixed(4)),
        text: fl.text.trim(),
        confidence: Math.round(fl.confidence || 90),
      };
      lineBoxes.push(box);
      paired.push({
        fasText: fl.text,
        biText: fl.text,
        confidence: fl.confidence || 90,
        bbox: box,
      });
    }

    const fusedLines = fuseDualHeadLines(paired, thermalRows);
    const avgConf = fasRes.data.confidence || 90;
    const parsed = parsePersianReceiptText(fusedLines, lineBoxes, avgConf);
    const reconciliation = reconcileReceiptWithShoppingList(parsed.items, shoppingItems);

    onProgress?.('تکمیل شد!', 100);

    return {
      ok: true,
      engine: 'موتور عصبی Persian LSTM + تشخیصگر ارقام حرارتی',
      durationMs: Date.now() - startedAt,
      originalImageUrl: dataUrl,
      processedImageUrl: enhancedDataUrl,
      perspectiveCropped: false,
      lineBoxes,
      rawOcrText: fusedLines.join('\n'),
      receipt: {
        ...parsed,
        ocr_engine: 'Persian LSTM + Thermal Digit Engine',
        raw_ocr_text: fusedLines.join('\n'),
        image_url: dataUrl,
        processed_image_url: enhancedDataUrl,
      },
      reconciliation,
    };
  } finally {
    lastProgressCb = null;
  }
}

export async function scanReceiptHybrid(params: {
  file?: File | null;
  sampleId?: string | null;
  dataUrl?: string | null;
  serverUrl: string;
  serverOnline: boolean;
  shoppingItems: ShoppingItem[];
  onProgress?: (stage: string, pct: number, previewUrl?: string) => void;
}): Promise<ScanResponse> {
  const { file, sampleId, dataUrl, serverUrl, serverOnline, shoppingItems, onProgress } = params;
  const aiSettings = getCloudVisionSettings();

  onProgress?.('آماده‌سازی و بهینه‌سازی رزولوشن عکس فاکتور...', 8);
  const sampleFile =
    sampleId === 'ofogh-real'
      ? 'samples/sample-ofogh-real.jpg'
      : `samples/sample-${sampleId || 'ofogh'}.png`;
  const resolvedSource: File | string = file || dataUrl || assetUrl(sampleFile);
  const { compressedFile, previewDataUrl } = await normalizeAndCompressReceiptPhoto(resolvedSource);
  onProgress?.('تصویر آماده شد؛ شروع پردازش بینایی ماشین...', 18, previewDataUrl);

  // Layer 1: Optional Cloud Multimodal AI via Supabase Edge Function `scan-receipt`
  if (aiSettings.enabled && aiSettings.apiKey.trim().length > 10) {
    try {
      onProgress?.(
        `تحلیل هوشمند با ${
          aiSettings.provider === 'openai' ? 'GPT-4o Vision' : 'Gemini 2.5 Flash'
        }...`,
        45,
        previewDataUrl
      );
      const started = Date.now();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      const edgeResp = await fetch(`${SUPABASE_URL}/functions/v1/scan-receipt`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        signal: ctrl.signal,
        body: JSON.stringify({
          imageBase64: previewDataUrl,
          provider: aiSettings.provider,
          apiKey: aiSettings.apiKey.trim(),
          shoppingItems,
        }),
      });
      clearTimeout(timer);
      const edgeJson = await edgeResp.json();
      if (edgeResp.ok && edgeJson.usedCloudAi && edgeJson.receipt) {
        const recItems = edgeJson.receipt.items || [];
        const reconciliation = reconcileReceiptWithShoppingList(recItems, shoppingItems);
        onProgress?.('تکمیل شد!', 100, previewDataUrl);
        return {
          ok: true,
          engine: edgeJson.engine,
          durationMs: Date.now() - started,
          originalImageUrl: previewDataUrl,
          processedImageUrl: previewDataUrl,
          perspectiveCropped: true,
          lineBoxes: [],
          rawOcrText: JSON.stringify(edgeJson.receipt, null, 2),
          receipt: {
            ...edgeJson.receipt,
            ocr_engine: edgeJson.engine,
            image_url: previewDataUrl,
          },
          reconciliation,
        };
      }
    } catch (err) {
      console.warn('[HybridCV] Cloud AI fallback to OpenCV + Neural OCR:', err);
    }
  }

  // Layer 2: Live Full-Stack Python OpenCV 5.0 + Dual-Head Persian LSTM Server
  const isCapacitorLocalOrigin =
    serverUrl.startsWith('capacitor://') ||
    serverUrl === 'http://localhost' ||
    serverUrl === 'https://localhost' ||
    serverUrl.includes('.github.io') ||
    serverUrl.includes('githack.com');

  if (serverOnline && !isCapacitorLocalOrigin) {
    try {
      onProgress?.(
        'حذف سایه با OpenCV 5.0 و خوانش دوگانه شبکه عصبی فارسی روی سرور...',
        52,
        previewDataUrl
      );
      const endpoint = `${serverUrl.replace(/\/$/, '')}/api/scan`;
      const ctrl = new AbortController();
      const serverTimeoutMs = isLowPowerAndroid() ? 8000 : 18000;
      const timer = setTimeout(() => ctrl.abort(), serverTimeoutMs);

      let resp: Response;
      if (sampleId) {
        resp = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: ctrl.signal,
          body: JSON.stringify({ sampleId, shoppingItems }),
        });
      } else {
        const form = new FormData();
        form.append('receipt', compressedFile);
        form.append('shoppingItems', JSON.stringify(shoppingItems));
        resp = await fetch(endpoint, {
          method: 'POST',
          signal: ctrl.signal,
          body: form,
        });
      }
      clearTimeout(timer);

      const contentType = resp.headers.get('content-type') || '';
      if (resp.ok && contentType.includes('application/json')) {
        const result = (await resp.json()) as ScanResponse;
        if (result.ok) {
          const base = serverUrl.replace(/\/$/, '');
          result.originalImageUrl = result.originalImageUrl?.startsWith('/')
            ? `${base}${result.originalImageUrl}`
            : previewDataUrl;
          result.processedImageUrl = result.processedImageUrl?.startsWith('/')
            ? `${base}${result.processedImageUrl}`
            : previewDataUrl;
          result.receipt.image_url = previewDataUrl;
          result.receipt.processed_image_url = result.processedImageUrl;
          result.receipt.raw_ocr_text = result.rawOcrText;
          onProgress?.('تکمیل شد!', 100, previewDataUrl);
          return result;
        }
      }
    } catch (err) {
      console.warn('[HybridCV] Server unreachable, seamlessly running On-Device Neural OCR:', err);
    }
  }

  // Layer 3: Autonomous On-Device Persian LSTM + Thermal Digit Engine
  return await runOnDeviceAutonomousScan(previewDataUrl, shoppingItems, (stage, pct) =>
    onProgress?.(stage, pct, previewDataUrl)
  );
}
