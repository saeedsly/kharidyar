import { createWorker } from 'tesseract.js';
import type { BoundingBox, ScanResponse, ShoppingItem } from '../types';
import { assetUrl } from './assetUrl';
import {
  fuseDualHeadLines,
  parsePersianReceiptText,
  reconcileReceiptWithShoppingList,
  type NeuralLineInput,
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

export async function normalizeAndCompressReceiptPhoto(
  source: File | Blob | string
): Promise<{ compressedFile: File; previewDataUrl: string; width: number; height: number }> {
  let rawObjectUrl = '';
  const srcUrl =
    typeof source === 'string'
      ? source
      : ((rawObjectUrl = URL.createObjectURL(source)), rawObjectUrl);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = 'anonymous';
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('فرمت تصویر قابل خواندن نیست'));
      el.src = srcUrl;
    });

    const maxDim = 1600;
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    if (w > maxDim || h > maxDim) {
      const ratio = Math.min(maxDim / w, maxDim / h);
      w = Math.round(w * ratio);
      h = Math.round(h * ratio);
    }

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('خطا در آماده‌سازی بوم پردازش تصویر');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    const previewDataUrl = canvas.toDataURL('image/jpeg', 0.88);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('خطا در فشرده‌سازی تصویر'))),
        'image/jpeg',
        0.88
      );
    });

    const compressedFile = new File([blob], `receipt-${Date.now()}.jpg`, {
      type: 'image/jpeg',
    });

    return { compressedFile, previewDataUrl, width: w, height: h };
  } finally {
    if (rawObjectUrl) URL.revokeObjectURL(rawObjectUrl);
  }
}

async function enhanceImageOnCanvas(dataUrl: string): Promise<{
  enhancedDataUrl: string;
  width: number;
  height: number;
}> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const targetW = 1480;
      const scale = targetW / img.width;
      const w = targetW;
      const h = Math.max(200, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve({ enhancedDataUrl: dataUrl, width: img.width, height: img.height });
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      const imgData = ctx.getImageData(0, 0, w, h);
      const d = imgData.data;

      const lumArr = new Uint8Array(w * h);
      for (let i = 0, p = 0; i < d.length; i += 4, p++) {
        lumArr[p] = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
      }
      const hist = new Uint32Array(256);
      for (let p = 0; p < lumArr.length; p++) hist[lumArr[p]]++;
      const totalPx = lumArr.length;
      let acc = 0;
      let pLow = 35;
      let pHigh = 225;
      for (let v = 0; v < 256; v++) {
        acc += hist[v];
        if (acc <= totalPx * 0.05) pLow = v;
        if (acc <= totalPx * 0.85) pHigh = v;
      }
      const span = Math.max(25, pHigh - pLow);

      for (let i = 0, p = 0; i < d.length; i += 4, p++) {
        const stretched = Math.max(0, Math.min(255, ((lumArr[p] - pLow) * 255) / span));
        d[i] = stretched;
        d[i + 1] = stretched;
        d[i + 2] = stretched;
      }
      ctx.putImageData(imgData, 0, 0);
      resolve({
        enhancedDataUrl: canvas.toDataURL('image/png'),
        width: w,
        height: h,
      });
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

export async function runOnDeviceAutonomousScan(
  dataUrl: string,
  shoppingItems: ShoppingItem[],
  onProgress?: (stage: string, pct: number) => void
): Promise<ScanResponse> {
  const startedAt = Date.now();
  onProgress?.('بهینه‌سازی نور، سایه و کنتراست عکس فاکتور...', 12);
  const { enhancedDataUrl, width, height } = await enhanceImageOnCanvas(dataUrl);

  const workerJsUrl = assetUrl('tessdata/worker.min.js');
  const tessdataBaseUrl = assetUrl('tessdata').replace(/\/$/, '');
  let p1 = 0;
  let p2 = 0;

  onProgress?.('بارگذاری موتور بینایی ماشین فارسی و عددی...', 24);

  const [fasWorker, biWorker] = await withTimeout(
    Promise.all([
      createWorker('fas', 1, {
        workerBlobURL: false,
        workerPath: workerJsUrl,
        corePath: tessdataBaseUrl,
        langPath: tessdataBaseUrl,
        gzip: true,
        cacheMethod: 'none',
        logger: (m) => {
          if (m.status === 'recognizing text' && typeof m.progress === 'number') {
            p1 = m.progress;
            const combined = Math.round(30 + ((p1 + p2) / 2) * 62);
            onProgress?.('در حال خواندن خطوط و مبالغ فاکتور...', combined);
          }
        },
      }),
      createWorker(['fas', 'eng'], 1, {
        workerBlobURL: false,
        workerPath: workerJsUrl,
        corePath: tessdataBaseUrl,
        langPath: tessdataBaseUrl,
        gzip: true,
        cacheMethod: 'none',
        logger: (m) => {
          if (m.status === 'recognizing text' && typeof m.progress === 'number') {
            p2 = m.progress;
            const combined = Math.round(30 + ((p1 + p2) / 2) * 62);
            onProgress?.('در حال خواندن خطوط و مبالغ فاکتور...', combined);
          }
        },
      }),
    ]),
    25000,
    'راه‌اندازی موتور عصبی داخل مرورگر/گوشی'
  );

  try {
    onProgress?.('در حال استخراج نام کالاها، فی و جمع فاکتور...', 35);
    const [fasRes, biRes] = await withTimeout(
      Promise.all([
        fasWorker.recognize(enhancedDataUrl, {}, { blocks: true }),
        biWorker.recognize(enhancedDataUrl, {}, { blocks: true }),
      ]),
      35000,
      'خوانش تصویر فاکتور'
    );

    onProgress?.('تطبیق هوشمند اقلام فاکتور با لیست خرید...', 95);

    const fasLinesRaw =
      fasRes.data.blocks?.flatMap((b) => b.paragraphs.flatMap((p) => p.lines)) || [];
    const biLinesRaw =
      biRes.data.blocks?.flatMap((b) => b.paragraphs.flatMap((p) => p.lines)) || [];

    const lineBoxes: BoundingBox[] = [];
    const paired: NeuralLineInput[] = [];

    for (const fl of fasLinesRaw) {
      const midY = (fl.bbox.y0 + fl.bbox.y1) / 2;
      let bestBi = '';
      let minDist = Infinity;
      for (const bl of biLinesRaw) {
        const dist = Math.abs(midY - (bl.bbox.y0 + bl.bbox.y1) / 2);
        if (dist < 28 && dist < minDist) {
          minDist = dist;
          bestBi = bl.text || '';
        }
      }
      const box: BoundingBox = {
        x: Number((fl.bbox.x0 / width).toFixed(4)),
        y: Number((fl.bbox.y0 / height).toFixed(4)),
        w: Number(((fl.bbox.x1 - fl.bbox.x0) / width).toFixed(4)),
        h: Number(((fl.bbox.y1 - fl.bbox.y0) / height).toFixed(4)),
        text: fl.text.trim(),
        confidence: Math.round(fl.confidence || 90),
      };
      lineBoxes.push(box);
      paired.push({ fasText: fl.text, biText: bestBi, confidence: fl.confidence || 88, bbox: box });
    }

    const fusedLines = fuseDualHeadLines(paired);
    const avgConf = ((fasRes.data.confidence || 84) + (biRes.data.confidence || 88)) / 2;
    const parsed = parsePersianReceiptText(fusedLines, lineBoxes, avgConf);
    const reconciliation = reconcileReceiptWithShoppingList(parsed.items, shoppingItems);

    onProgress?.('تکمیل شد!', 100);

    return {
      ok: true,
      engine: 'موتور عصبی Dual-Head Persian LSTM',
      durationMs: Date.now() - startedAt,
      originalImageUrl: dataUrl,
      processedImageUrl: enhancedDataUrl,
      perspectiveCropped: false,
      lineBoxes,
      rawOcrText: fusedLines.join('\n'),
      receipt: {
        ...parsed,
        ocr_engine: 'Dual-Head Persian LSTM OCR',
        raw_ocr_text: fusedLines.join('\n'),
        image_url: dataUrl,
        processed_image_url: enhancedDataUrl,
      },
      reconciliation,
    };
  } finally {
    await Promise.all([fasWorker.terminate(), biWorker.terminate()]).catch(() => {});
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
  const resolvedSource: File | string =
    file || dataUrl || assetUrl(`samples/sample-${sampleId || 'ofogh'}.png`);
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
    serverUrl.includes('.github.io');

  if (serverOnline && !isCapacitorLocalOrigin) {
    try {
      onProgress?.(
        'حذف سایه با OpenCV 5.0 و خوانش دوگانه شبکه عصبی فارسی روی سرور...',
        52,
        previewDataUrl
      );
      const endpoint = `${serverUrl.replace(/\/$/, '')}/api/scan`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);

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

  // Layer 3: Autonomous On-Device Dual-Head Persian WASM OCR (100% standalone on GitHub Pages & APK!)
  return await runOnDeviceAutonomousScan(previewDataUrl, shoppingItems, (stage, pct) =>
    onProgress?.(stage, pct, previewDataUrl)
  );
}
