import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createWorker, type Worker } from 'tesseract.js';
import type { BoundingBox } from '../src/types';
import {
  fuseDualHeadLines,
  parsePersianReceiptText,
  type NeuralLineInput,
  type ThermalNumericRow,
} from '../src/lib/persianMatcher';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const TESSDATA_DIR = path.join(ROOT_DIR, 'public', 'tessdata');
const CV_SCRIPT = path.join(__dirname, 'cv_pipeline.py');

let fasWorkerPromise: Promise<Worker> | null = null;
let biWorkerPromise: Promise<Worker> | null = null;
let workersReady = false;

export async function getOcrWorkers(): Promise<{ fasWorker: Worker; biWorker: Worker }> {
  if (!fasWorkerPromise) {
    fasWorkerPromise = createWorker('fas', 1, {
      langPath: TESSDATA_DIR,
      gzip: true,
      cacheMethod: 'none',
    });
  }
  if (!biWorkerPromise) {
    biWorkerPromise = createWorker(['fas', 'eng'], 1, {
      langPath: TESSDATA_DIR,
      gzip: true,
      cacheMethod: 'none',
    });
  }
  const [fasWorker, biWorker] = await Promise.all([fasWorkerPromise, biWorkerPromise]);
  workersReady = true;
  return { fasWorker, biWorker };
}

export function areWorkersWarm(): boolean {
  return workersReady;
}

export interface OpenCvResult {
  ok: boolean;
  originalSize: { width: number; height: number };
  processedSize: { width: number; height: number };
  perspectiveCropped: boolean;
  detectedLineCount: number;
  lineBoxes: BoundingBox[];
  thermalRows?: ThermalNumericRow[];
  outputPath: string;
}

export async function runOpenCvPreprocess(inputPath: string, outputPath: string): Promise<OpenCvResult> {
  const { stdout } = await execFileAsync('python3', [CV_SCRIPT, inputPath, outputPath], {
    timeout: 25000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return JSON.parse(stdout.trim()) as OpenCvResult;
}

export async function analyzeReceiptWithComputerVision(inputImagePath: string, enhancedOutputPath: string) {
  const startedAt = Date.now();

  // Step 1: OpenCV 5.0 perspective & thermal contrast enhancement
  let cvMeta: OpenCvResult | null = null;
  let imageForOcr = inputImagePath;
  try {
    cvMeta = await runOpenCvPreprocess(inputImagePath, enhancedOutputPath);
    if (cvMeta.ok && fs.existsSync(enhancedOutputPath)) {
      imageForOcr = enhancedOutputPath;
    }
  } catch (err) {
    console.warn('[CV] Python OpenCV fallback to raw image:', err);
  }

  // Step 2: Neural LSTM OCR (`fas` lexical head + optional `fas+eng` numeric head if thermal rows not pre-extracted)
  const { fasWorker, biWorker } = await getOcrWorkers();
  const hasThermalRows = (cvMeta?.thermalRows?.length || 0) >= 2;
  const [fasRes, biRes] = await Promise.all([
    fasWorker.recognize(imageForOcr, {}, { blocks: true }),
    hasThermalRows
      ? Promise.resolve(null)
      : biWorker.recognize(imageForOcr, {}, { blocks: true }),
  ]);

  const imgW = cvMeta?.processedSize.width || 1500;
  const imgH = cvMeta?.processedSize.height || 1600;

  const fasLinesRaw =
    fasRes.data.blocks?.flatMap((b) => b.paragraphs.flatMap((p) => p.lines)) || [];
  const biLinesRaw =
    biRes?.data.blocks?.flatMap((b) => b.paragraphs.flatMap((p) => p.lines)) || [];

  const neuralBoxes: BoundingBox[] = [];
  const pairedLines: NeuralLineInput[] = [];

  if (fasLinesRaw.length > 0) {
    for (const fl of fasLinesRaw) {
      const midY = (fl.bbox.y0 + fl.bbox.y1) / 2;
      // Match corresponding horizontal line in bilingual numeric head by vertical overlap
      let bestBi = '';
      let minDist = Infinity;
      for (const bl of biLinesRaw) {
        const bMidY = (bl.bbox.y0 + bl.bbox.y1) / 2;
        const dist = Math.abs(midY - bMidY);
        if (dist < 28 && dist < minDist) {
          minDist = dist;
          bestBi = bl.text || '';
        }
      }

      const normBox: BoundingBox = {
        x: Number((fl.bbox.x0 / imgW).toFixed(4)),
        y: Number((fl.bbox.y0 / imgH).toFixed(4)),
        w: Number(((fl.bbox.x1 - fl.bbox.x0) / imgW).toFixed(4)),
        h: Number(((fl.bbox.y1 - fl.bbox.y0) / imgH).toFixed(4)),
        text: fl.text.trim(),
        confidence: Math.round(fl.confidence || 90),
      };
      neuralBoxes.push(normBox);
      pairedLines.push({
        fasText: fl.text,
        biText: bestBi,
        confidence: fl.confidence || 88,
        bbox: normBox,
      });
    }
  } else {
    const rawSplit = (fasRes.data.text || '').split(/\r?\n/);
    const biSplit = (biRes?.data.text || '').split(/\r?\n/);
    rawSplit.forEach((ft, i) => {
      pairedLines.push({
        fasText: ft,
        biText: biSplit[i] || '',
        confidence: fasRes.data.confidence || 85,
      });
    });
  }

  // Step 3: Fuse Persian lexical tokens + exact comma-grouped numbers & self-healing arithmetic check
  const fusedLines = fuseDualHeadLines(pairedLines, cvMeta?.thermalRows || []);
  const avgConfidence = biRes
    ? ((fasRes.data.confidence || 84) + (biRes.data.confidence || 88)) / 2
    : fasRes.data.confidence || 90;
  const parsedReceipt = parsePersianReceiptText(fusedLines, neuralBoxes, avgConfidence);

  const durationMs = Date.now() - startedAt;

  return {
    engine: 'OpenCV 5.0 + Dual-Head Persian LSTM OCR (fas + eng)',
    durationMs,
    perspectiveCropped: cvMeta?.perspectiveCropped ?? false,
    lineBoxes: neuralBoxes.length > 0 ? neuralBoxes : cvMeta?.lineBoxes || [],
    rawOcrText: fusedLines.join('\n'),
    receipt: parsedReceipt,
  };
}
