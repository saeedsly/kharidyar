import cors from 'cors';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import QRCode from 'qrcode';
import {
  analyzeReceiptWithComputerVision,
  areWorkersWarm,
  getOcrWorkers,
} from './ocrEngine';
import { reconcileReceiptWithShoppingList } from '../src/lib/persianMatcher';
import type { ShoppingItem } from '../src/types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const UPLOADS_DIR = path.join(ROOT_DIR, 'uploads');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DOWNLOADS_DIR = path.join(PUBLIC_DIR, 'downloads');

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '25mb' }));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(PUBLIC_DIR));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '.png') || '.png';
    cb(null, `raw-${Date.now()}-${Math.round(Math.random() * 1e5)}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

function getLocalApkPath(): string | null {
  const candidates = [
    path.join(DOWNLOADS_DIR, 'KharidYar-v1.0.apk'),
    path.join(ROOT_DIR, 'KharidYar-v1.0.apk'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p) && fs.statSync(p).size > 100_000) {
      return p;
    }
  }
  return null;
}

// Live Health & Auto-Discovery Handshake Endpoint
app.get('/api/health', (_req, res) => {
  const apkFile = getLocalApkPath();
  const apkSizeMb = apkFile ? Number((fs.statSync(apkFile).size / (1024 * 1024)).toFixed(2)) : null;
  res.json({
    ok: true,
    app: 'خریدیـار (KharidYar)',
    version: '1.0.0',
    cvEngine: 'OpenCV 5.0 + Dual-Head Persian LSTM OCR (fas+eng)',
    workersWarm: areWorkersWarm(),
    supabaseProjectRef: 'gngrgkrypvrgcnkldbhx',
    apkReady: Boolean(apkFile),
    apkSizeMb,
    apkDownloadUrl: apkFile
      ? '/api/download/apk'
      : 'https://gngrgkrypvrgcnkldbhx.supabase.co/storage/v1/object/public/web-cdn/downloads/KharidYar-Android7-v1.4.1.apk',
    githubReleaseApkUrl:
      'https://github.com/saeedsly/kharidyar/releases/download/v1.4.1/KharidYar-Android7-v1.4.1.apk',
    timestamp: new Date().toISOString(),
  });
});

// Direct One-Tap APK Download Endpoint
app.get('/api/download/apk', (_req, res) => {
  const apkFile = getLocalApkPath();
  if (apkFile) {
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', 'attachment; filename="KharidYar-Android7-v1.4.1.apk"');
    res.sendFile(apkFile);
    return;
  }
  res.redirect(
    302,
    'https://gngrgkrypvrgcnkldbhx.supabase.co/storage/v1/object/public/web-cdn/downloads/KharidYar-Android7-v1.4.1.apk'
  );
});

// Dynamic QR Code SVG/DataURL Generator for Phone Pairing & Instant APK Install
app.get('/api/qrcode', async (req, res) => {
  try {
    const targetUrl = String(req.query.url || 'https://github.com/saeedsly/kharidyar');
    const dataUrl = await QRCode.toDataURL(targetUrl, {
      margin: 1,
      width: 280,
      color: { dark: '#0F172A', light: '#FFFFFF' },
    });
    res.json({ ok: true, dataUrl, targetUrl });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'QR error' });
  }
});

// Built-in Realistic Sample Receipts List
app.get('/api/samples', (_req, res) => {
  res.json({
    ok: true,
    samples: [
      {
        id: 'ofogh',
        title: 'فاکتور سوپرمارکت افق کوروش',
        subtitle: 'تست هوشمند تطبیق لیست خرید (۵ خریداری‌شده + ۲ جا مانده!)',
        imageUrl: '/samples/sample-ofogh.png',
        badge: 'پیشنهادی برای تست تطبیق لیست',
      },
      {
        id: 'janbo',
        title: 'فاکتور تکمیلی فروشگاه جانبو',
        subtitle: 'شامل روغن مایع و گوجه فرنگی برای تکمیل ۱۰۰٪ لیست خرید',
        imageUrl: '/samples/sample-janbo.png',
        badge: 'تکمیل اقلام جامانده',
      },
      {
        id: 'hyperstar',
        title: 'فاکتور پروتئین و تره‌بار هایپراستار',
        subtitle: 'مرغ تازه، برنج هاشمی ایرانی و سیب درختی',
        imageUrl: '/samples/sample-hyperstar.png',
        badge: 'لیست آخر هفته',
      },
    ],
  });
});

// Primary Computer Vision Receipt Scan & Shopping List Reconciliation Endpoint
app.post('/api/scan', upload.single('receipt'), async (req, res) => {
  try {
    let inputPath = '';
    let publicOriginalUrl = '';

    if (req.file) {
      inputPath = req.file.path;
      publicOriginalUrl = `/uploads/${path.basename(req.file.path)}`;
    } else if (req.body?.sampleId || req.body?.samplePath) {
      const sid = String(req.body.sampleId || 'ofogh');
      const defaultSampleRel =
        sid === 'ofogh-real' ? '/samples/sample-ofogh-real.jpg' : `/samples/sample-${sid}.png`;
      const cleanRel = String(req.body.samplePath || defaultSampleRel).replace(/^\/+/, '');
      const candidate = path.resolve(PUBLIC_DIR, cleanRel);
      if (!candidate.startsWith(PUBLIC_DIR) || !fs.existsSync(candidate)) {
        res.status(400).json({ ok: false, error: 'فایل نمونه فاکتور یافت نشد' });
        return;
      }
      inputPath = candidate;
      publicOriginalUrl = `/${cleanRel}`;
    } else if (req.body?.imageBase64) {
      const rawBase64 = String(req.body.imageBase64).replace(/^data:image\/\w+;base64,/, '');
      const fname = `cam-${Date.now()}-${Math.round(Math.random() * 1e5)}.png`;
      inputPath = path.join(UPLOADS_DIR, fname);
      fs.writeFileSync(inputPath, Buffer.from(rawBase64, 'base64'));
      publicOriginalUrl = `/uploads/${fname}`;
    } else {
      res.status(400).json({ ok: false, error: 'تصویر فاکتور ارسال نشده است' });
      return;
    }

    const enhancedName = `enhanced-${Date.now()}-${Math.round(Math.random() * 1e5)}.png`;
    const enhancedPath = path.join(UPLOADS_DIR, enhancedName);

    let shoppingItems: ShoppingItem[] = [];
    if (req.body?.shoppingItems) {
      shoppingItems =
        typeof req.body.shoppingItems === 'string'
          ? JSON.parse(req.body.shoppingItems)
          : req.body.shoppingItems;
    }

    const cvResult = await analyzeReceiptWithComputerVision(inputPath, enhancedPath);
    const reconciliation = reconcileReceiptWithShoppingList(cvResult.receipt.items, shoppingItems);

    res.json({
      ok: true,
      engine: cvResult.engine,
      durationMs: cvResult.durationMs,
      originalImageUrl: publicOriginalUrl,
      processedImageUrl: fs.existsSync(enhancedPath) ? `/uploads/${enhancedName}` : publicOriginalUrl,
      perspectiveCropped: cvResult.perspectiveCropped,
      lineBoxes: cvResult.lineBoxes,
      rawOcrText: cvResult.rawOcrText,
      receipt: cvResult.receipt,
      reconciliation,
    });
  } catch (err: any) {
    console.error('[/api/scan] Error:', err);
    res.status(500).json({
      ok: false,
      error: err?.message || 'خطا در پردازش تصویر فاکتور',
    });
  }
});

// Serve built React app for all frontend routes
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 [خریدیـار Server] Listening on http://0.0.0.0:${PORT}`);
  // Pre-warm neural OCR models in background so user scans take < 1 second!
  getOcrWorkers()
    .then(() => console.log('✅ [خریدیـار CV] Dual-Head Persian + English LSTM OCR Workers Warm & Ready!'))
    .catch((e) => console.warn('⚠️ [خریدیـار CV] Worker warmup warning:', e));
});
