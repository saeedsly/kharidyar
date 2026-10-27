import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createWorker, type Worker } from 'tesseract.js';
import type { BoundingBox } from '../src/types';
import { keepPersianReceiptText, parsePersianReceiptText } from '../src/lib/persianMatcher';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const TESSDATA_DIR = path.join(ROOT_DIR, 'public', 'tessdata');
const CV_SCRIPT = path.join(__dirname, 'cv_pipeline.py');

let persianWorkerPromise: Promise<Worker> | null = null;
let workersReady = false;

export async function getOcrWorker(): Promise<Worker> {
  if (!persianWorkerPromise) {
    persianWorkerPromise = createWorker('fas', 1, {
      langPath: TESSDATA_DIR,
      gzip: true,
      cacheMethod: 'none',
    });
  }
  const worker = await persianWorkerPromise;
  workersReady = true;
  return worker;
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

  // Step 1: OpenCV perspective correction and thermal contrast enhancement.
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

  // Step 2: Read the receipt with the Persian-only Tesseract model.
  const worker = await getOcrWorker();
  const recognized = await worker.recognize(imageForOcr, {}, { blocks: true });
  const rawBlockLines =
    recognized.data.blocks?.flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines)) || [];
  const recognizedLines = rawBlockLines.flatMap((line) => {
    const text = keepPersianReceiptText(line.text || '');
    if (!text) return [];
    const { x0, y0, x1, y1 } = line.bbox;
    const box: BoundingBox = {
      x: Number((x0 / (cvMeta?.processedSize.width || 1500)).toFixed(4)),
      y: Number((y0 / (cvMeta?.processedSize.height || 1600)).toFixed(4)),
      w: Number(((x1 - x0) / (cvMeta?.processedSize.width || 1500)).toFixed(4)),
      h: Number(((y1 - y0) / (cvMeta?.processedSize.height || 1600)).toFixed(4)),
      text,
      confidence: Math.round(line.confidence || 0),
    };
    return [{ text, box }];
  });
  const fallbackLines = (recognized.data.text || '')
    .split(/\r?\n/)
    .map((line) => keepPersianReceiptText(line))
    .filter(Boolean);
  const receiptLines = recognizedLines.length
    ? recognizedLines.map((line) => line.text)
    : fallbackLines;
  const lineBoxes = recognizedLines.map((line) => line.box);
  const confidence = Number(recognized.data.confidence) || 0;
  const parsedReceipt = parsePersianReceiptText(receiptLines, lineBoxes, confidence);

  return {
    engine: 'OpenCV 5.0 + Persian Tesseract LSTM (fas)',
    durationMs: Date.now() - startedAt,
    perspectiveCropped: cvMeta?.perspectiveCropped ?? false,
    lineBoxes: lineBoxes.length > 0 ? lineBoxes : cvMeta?.lineBoxes || [],
    rawOcrText: receiptLines.join('\n'),
    receipt: parsedReceipt,
  };
}
