import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera as CapCamera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import {
  AlertTriangle,
  ArrowLeftRight,
  Camera,
  Check,
  CheckCircle2,
  Cpu,
  FileText,
  ImagePlus,
  Loader2,
  Plus,
  ScanLine,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { ReceiptItem, ScanResponse, ShoppingItem, ShoppingList } from '../types';
import { assetUrl } from '../lib/assetUrl';
import { OfflineOcrAssets } from '../lib/offlineOcrAssets';
import {
  cancelActiveOcrScan,
  scanReceiptHybrid,
  type ReceiptOcrLanguage,
  type ReceiptProcessingMode,
} from '../lib/visionClient';
import {
  formatCurrency,
  inferItemCategory,
  reconcileReceiptWithShoppingList,
  toPersianDigits,
} from '../lib/persianMatcher';

interface ScannerModalProps {
  isOpen: boolean;
  initialSampleId?: string | null;
  lists: ShoppingList[];
  activeListId: string;
  allShoppingItems: ShoppingItem[];
  onSelectList: (listId: string) => void;
  onClose: () => void;
  onConfirmSave: (params: {
    scanResult: ScanResponse;
    editedStoreName: string;
    editedDate: string;
    editedDiscount: number;
    editedTax: number;
    editedItems: ReceiptItem[];
    targetListId: string;
  }) => Promise<void>;
}

const BUILTIN_SAMPLES = [
  {
    id: 'ofogh',
    title: 'فاکتور نمونهٔ افق کوروش',
    desc: 'برای بررسی اسکن',
    thumb: 'samples/sample-ofogh.png',
  },
  {
    id: 'janbo',
    title: 'فاکتور نمونهٔ جانبو',
    desc: 'برای بررسی اسکن',
    thumb: 'samples/sample-janbo.png',
  },
  {
    id: 'hyperstar',
    title: 'فاکتور نمونهٔ هایپراستار ارم',
    desc: 'برای بررسی اسکن',
    thumb: 'samples/sample-hyperstar.png',
  },
  {
    id: 'thermal-long',
    title: 'فاکتور حرارتی طولانی',
    desc: 'برای آزمون نوشته‌های ریز و ردیف‌های زیاد',
    thumb: 'samples/sample-thermal-long.png',
  },
];

export function ScannerModal({
  isOpen,
  initialSampleId,
  lists,
  activeListId,
  allShoppingItems,
  onSelectList,
  onClose,
  onConfirmSave,
}: ScannerModalProps) {
  const [step, setStep] = useState<'capture' | 'scanning' | 'review'>('capture');
  const [stageMessage, setStageMessage] = useState('آماده‌سازی تصویر فاکتور...');
  const [progressPct, setProgressPct] = useState<number>(8);
  const [scanningPreviewUrl, setScanningPreviewUrl] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [ocrLanguage, setOcrLanguage] = useState<ReceiptOcrLanguage>('fa-en');
  const [useCloudOcr, setUseCloudOcr] = useState(true);
  const [processingMode, setProcessingMode] = useState<ReceiptProcessingMode>('auto');

  const [scanResult, setScanResult] = useState<ScanResponse | null>(null);
  const [showBoxes, setShowBoxes] = useState(true);
  const [showRawOcr, setShowRawOcr] = useState(false);

  const [storeName, setStoreName] = useState('');
  const [jalaliDate, setJalaliDate] = useState('');
  const [discountTotal, setDiscountTotal] = useState(0);
  const [taxTotal, setTaxTotal] = useState(0);
  const [items, setItems] = useState<ReceiptItem[]>([]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const scanInProgressRef = useRef(false);
  const lastScanInputRef = useRef<{
    file?: File | null;
    sampleId?: string | null;
    imageUrl?: string | null;
  } | null>(null);

  const targetShoppingItems = allShoppingItems.filter((i) => i.list_id === activeListId);

  const stopCameraStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  };

  const releasePreview = () => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setScanningPreviewUrl(null);
  };

  useEffect(() => {
    if (!isOpen) {
      stopCameraStream();
      cancelActiveOcrScan();
      releasePreview();
      setStep('capture');
      setScanResult(null);
      setErrorMsg(null);
      lastScanInputRef.current = null;
      return;
    }
    if (initialSampleId) {
      void executeScan({ sampleId: initialSampleId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialSampleId]);

  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      cancelActiveOcrScan();
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    []
  );

  const startLiveWebCamera = async () => {
    setCameraError(null);
    if (Capacitor.isNativePlatform()) {
      try {
        const photo = await CapCamera.getPhoto({
          quality: 95,
          width: 3200,
          allowEditing: false,
          resultType: CameraResultType.Uri,
          source: CameraSource.Camera,
        });
        const imageUrl = photo.webPath || (photo.path ? Capacitor.convertFileSrc(photo.path) : null);
        if (imageUrl) await executeScan({ imageUrl });
        else setCameraError('دوربین عکسی برنگرداند؛ لطفاً یک‌بار دیگر امتحان کن.');
        return;
      } catch (err: any) {
        if (String(err?.message || '').toLowerCase().includes('cancel')) return;
        setCameraError('دوربین باز نشد. اگر اجازهٔ دوربین رد شده، از گالری عکس انتخاب کن.');
        return;
      }
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setCameraActive(true);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      });
    } catch {
      setCameraError('دوربین باز نشد؛ می‌توانی تصویر فاکتور را از فایل‌ها انتخاب کنی.');
    }
  };

  const captureFrameFromVideo = async () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      setCameraError('دوربین هنوز تصویر آماده نکرده؛ یک لحظه صبر کن و دوباره عکس بگیر.');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      setCameraError('ذخیرهٔ عکس دوربین ناموفق بود؛ از گالری تصویر انتخاب کن.');
      return;
    }

    setCameraError(null);
    let blob: Blob | null;
    try {
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((value) => resolve(value), 'image/jpeg', 0.92)
      );
    } catch {
      stopCameraStream();
      setCameraError('ذخیرهٔ عکس دوربین ناموفق بود؛ دوباره امتحان کن یا از گالری انتخاب کن.');
      return;
    }
    stopCameraStream();
    if (!blob) {
      setCameraError('عکس دوربین آماده نشد؛ دوباره عکس بگیر یا از گالری انتخاب کن.');
      return;
    }
    await executeScan({ file: new File([blob], `receipt-${Date.now()}.jpg`, { type: 'image/jpeg' }) });
  };

  const pickFromGallery = async () => {
    if (Capacitor.getPlatform() === 'android') {
      try {
        const selected = await OfflineOcrAssets.pickReceiptImage();
        if (!selected.path) throw new Error('فایلی انتخاب نشد.');
        await executeScan({ imageUrl: Capacitor.convertFileSrc(selected.path) });
      } catch (err: any) {
        if (`${err?.code || ''} ${err?.message || ''}`.toLowerCase().includes('cancel')) return;
        setCameraError('فایل تصویر باز نشد. دوباره انتخاب کن.');
      }
      return;
    }

    if (Capacitor.isNativePlatform()) {
      try {
        const photo = await CapCamera.getPhoto({
          quality: 95,
          width: 3200,
          allowEditing: false,
          resultType: CameraResultType.Uri,
          source: CameraSource.Photos,
        });
        const imageUrl = photo.webPath || (photo.path ? Capacitor.convertFileSrc(photo.path) : null);
        if (imageUrl) await executeScan({ imageUrl });
      } catch (err: any) {
        if (String(err?.message || '').toLowerCase().includes('cancel')) return;
        setCameraError('فایل تصویر باز نشد. دوباره انتخاب کن.');
      }
      return;
    }

    fileInputRef.current?.click();
  };

  const executeScan = async (
    input: { file?: File | null; sampleId?: string | null; imageUrl?: string | null },
    retrying = false
  ) => {
    if (scanInProgressRef.current) return;
    scanInProgressRef.current = true;
    if (!retrying) lastScanInputRef.current = input;
    releasePreview();
    setErrorMsg(null);
    setProgressPct(8);
    setStageMessage('فشرده‌سازی عکس و آماده‌سازی OCR...');
    setStep('scanning');

    try {
      const result = await scanReceiptHybrid({
        ...input,
        language: ocrLanguage,
        processingMode,
        useCloudOcr,
        shoppingItems: targetShoppingItems,
        onProgress: (msg, pct, previewUrl) => {
          setStageMessage(msg);
          setProgressPct(pct);
          if (previewUrl && previewUrlRef.current !== previewUrl) {
            if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
            previewUrlRef.current = previewUrl;
            setScanningPreviewUrl(previewUrl);
          }
        },
      });

      setScanResult(result);
      setStoreName(result.receipt.store_name);
      setJalaliDate(result.receipt.jalali_date);
      setDiscountTotal(result.receipt.discount_total || 0);
      setTaxTotal(result.receipt.tax_total || 0);
      setItems(result.receipt.items || []);
      setShowRawOcr((result.receipt.items || []).length === 0);
      setStep('review');
    } catch (err: any) {
      if (err?.message === 'SCAN_CANCELLED') {
        setErrorMsg(null);
      } else if (err?.message === 'SCAN_TIMEOUT') {
        setErrorMsg('خواندن فاکتور در زمان مجاز تمام نشد. عکس فشرده و روی گوشی می‌ماند؛ می‌توانی دوباره تلاش کنی یا آن را در گالری برش بدهی.');
      } else {
        setErrorMsg(err?.message || 'خواندن فاکتور ناموفق بود. عکس را روشن‌تر یا صاف‌تر بگیر و دوباره تلاش کن.');
      }
      setStep('capture');
    } finally {
      scanInProgressRef.current = false;
    }
  };

  // One-tap Rial <-> Toman converter (÷10 or ×10) if user wants to switch currency unit!
  const scaleAllPrices = (factor: number) => {
    setItems((prev) =>
      prev.map((it) => ({
        ...it,
        unit_price: Math.round(it.unit_price * factor),
        total_price: Math.round(it.total_price * factor),
      }))
    );
    setDiscountTotal((d) => Math.round(d * factor));
    setTaxTotal((tax) => Math.round(tax * factor));
  };

  const liveReconciliation = reconcileReceiptWithShoppingList(items, targetShoppingItems);
  const liveSubtotal = items.reduce((s, it) => s + Number(it.total_price || 0), 0);
  const liveGrandTotal = Math.max(
    0,
    liveSubtotal - Number(discountTotal || 0) + Number(taxTotal || 0)
  );
  const resultCurrency = scanResult?.receipt.currency || 'تومان';
  const isLiraCurrency = /(?:لیر|₺|\bTRY\b|\bTL\b)/i.test(resultCurrency);
  const scanQualityNeedsReview = Boolean(
    scanResult &&
      (scanResult.receipt.ocr_confidence < 65 ||
        (scanResult.ocrQuality?.unrecognizedItemCount || 0) > 0 ||
        !scanResult.ocrQuality?.amountReadFromReceipt ||
        !scanResult.ocrQuality?.subtotalReadFromReceipt ||
        scanResult.receipt.currency_detected === false ||
        scanResult.receipt.discount_inferred ||
        !scanResult.ocrQuality?.itemTotalsMatchSubtotal ||
        !scanResult.ocrQuality?.payableMatchesItems)
  );

  const updateItemField = (index: number, patch: Partial<ReceiptItem>) => {
    setItems((prev) =>
      prev.map((item, idx) => {
        if (idx !== index) return item;
        const next = { ...item, ...patch };
        if ('quantity' in patch || 'unit_price' in patch) {
          next.total_price = Math.round(Number(next.quantity || 1) * Number(next.unit_price || 0));
        }
        return next;
      })
    );
  };

  const handleSave = async () => {
    if (!scanResult) return;
    setSaving(true);
    try {
      await onConfirmSave({
        scanResult: {
          ...scanResult,
          reconciliation: liveReconciliation,
        },
        editedStoreName: storeName.trim() || 'فروشگاه',
        editedDate: jalaliDate,
        editedDiscount: discountTotal,
        editedTax: taxTotal,
        editedItems: items,
        targetListId: activeListId,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs p-0 sm:p-4"
      >
        <motion.div
          initial={{ y: 36, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 36, opacity: 0 }}
          className="relative flex flex-col w-full max-w-xl max-h-[94vh] rounded-t-3xl sm:rounded-3xl bg-[#F6F8FC] shadow-2xl overflow-hidden border border-slate-200"
        >
          {/* Top Header */}
          <div className="flex items-center justify-between bg-white px-5 py-4 border-b border-slate-200/80 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-white">
                <ScanLine className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-extrabold text-slate-900">
                  اسکنر هوشمند فاکتور
                </h2>
                <p className="text-[11px] text-slate-500">
                  اسکن آفلاین روی همین دستگاه؛ تصویر ارسال نمی‌شود.
                </p>
              </div>
            </div>

            <button
              type="button"
              aria-label="بستن اسکنر"
              onClick={() => {
                stopCameraStream();
                cancelActiveOcrScan();
                onClose();
              }}
              className="rounded-full bg-slate-100 p-2 text-slate-600 hover:bg-slate-200 cursor-pointer"
            >
              <X className="h-4.5 w-4.5" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {errorMsg && (
              <div className="flex items-start justify-between gap-3 rounded-2xl bg-rose-50 border border-rose-200 p-3.5 text-xs font-semibold text-rose-800">
                <span className="leading-6">{errorMsg}</span>
                {lastScanInputRef.current && (
                  <button
                    type="button"
                    onClick={() => void executeScan(lastScanInputRef.current || {}, true)}
                    className="shrink-0 rounded-xl bg-white px-3 py-2 text-[11px] font-extrabold text-rose-700 shadow-sm border border-rose-200"
                  >
                    تلاش دوباره
                  </button>
                )}
              </div>
            )}

            {/* STEP 1: CAPTURE / UPLOAD / SAMPLES */}
            {step === 'capture' && (
              <>
                {cameraActive ? (
                  <div className="relative mx-auto aspect-[3/4] max-h-[420px] w-full overflow-hidden rounded-3xl bg-slate-950 shadow-lg">
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="h-full w-full object-cover"
                    />
                    {cameraError && (
                      <p role="alert" className="absolute inset-x-4 bottom-24 rounded-xl bg-amber-100/95 px-3 py-2 text-center text-[10px] font-bold leading-5 text-amber-950">
                        {cameraError}
                      </p>
                    )}
                    <p className="absolute inset-x-4 bottom-[86px] text-center text-[10px] font-semibold leading-5 text-white drop-shadow">
                      گوشی را نزدیک و روبه‌روی فاکتور نگه‌دار؛ نوشته‌های فارسی و رقم‌ها واضح‌تر ثبت می‌شوند.
                    </p>
                    <div className="absolute inset-x-0 bottom-4 flex items-center justify-center gap-4 px-4">
                      <button
                        type="button"
                        onClick={stopCameraStream}
                        className="rounded-2xl bg-white/20 px-4 py-2.5 text-xs font-bold text-white backdrop-blur-md cursor-pointer"
                      >
                        بستن دوربین
                      </button>
                      <button
                        type="button"
                        aria-label="گرفتن عکس از فاکتور"
                        onClick={captureFrameFromVideo}
                        className="flex h-16 w-16 items-center justify-center rounded-full bg-white p-1.5 shadow-xl active:scale-95 cursor-pointer"
                      >
                        <span className="h-full w-full rounded-full bg-blue-600" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-3xl bg-white p-5 border border-slate-200/80 shadow-2xs space-y-4">
                    <label className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-3">
                      <span>
                        <span className="block text-xs font-extrabold text-slate-800">زبان فاکتور</span>
                        <span className="mt-0.5 block text-[10px] text-slate-500">Azure زبان را خودکار تشخیص می‌دهد؛ این انتخاب برای fallback آفلاین است.</span>
                      </span>
                      <select
                        value={ocrLanguage}
                        onChange={(event) => setOcrLanguage(event.target.value as ReceiptOcrLanguage)}
                        className="max-w-[160px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-blue-500"
                      >
                        <option value="fa-en">فارسی‌محور + انگلیسی</option>
                        <option value="tr-en">ترکی + انگلیسی</option>
                      </select>
                    </label>

                    <label className="flex items-center justify-between gap-3 rounded-2xl border border-blue-200 bg-blue-50/70 px-3.5 py-3">
                      <span>
                        <span className="block text-xs font-extrabold text-slate-800">OCR ابری Microsoft · {useCloudOcr ? 'روشن' : 'خاموش'}</span>
                        <span className="mt-0.5 block max-w-[250px] text-[10px] leading-4 text-slate-600">
                          در حالت روشن، تصویر برای خواندن متن به Azure می‌رود. برای حفظ کامل حالت آفلاین، این گزینه را خاموش کن.
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        data-testid="receipt-cloud-ocr-toggle"
                        checked={useCloudOcr}
                        onChange={(event) => setUseCloudOcr(event.target.checked)}
                        className="h-5 w-5 shrink-0 accent-blue-600"
                        aria-label="فعال‌سازی OCR ابری Microsoft"
                      />
                    </label>

                    <section
                      aria-label="حالت پردازش تصویر"
                      className="rounded-2xl border border-slate-200 bg-white p-3.5"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-extrabold text-slate-800">آماده‌سازی تصویر</p>
                          <p className="mt-0.5 text-[10px] leading-4 text-slate-500">
                            {useCloudOcr
                              ? 'در حالت ابری، تصویر برای OCR به Microsoft Azure ارسال می‌شود؛ در صورت نبود سرویس، OCR محلی اجرا می‌شود.'
                              : 'در این حالت تصویر از دستگاه خارج نمی‌شود و OCR فقط محلی انجام می‌شود.'}
                          </p>
                        </div>
                        <ScanLine className="h-5 w-5 shrink-0 text-blue-600" />
                      </div>
                      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <button
                          type="button"
                          data-testid="receipt-processing-mode-auto"
                          aria-pressed={processingMode === 'auto'}
                          onClick={() => setProcessingMode('auto')}
                          className={`rounded-xl border p-3 text-right transition cursor-pointer ${
                            processingMode === 'auto'
                              ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-200'
                              : 'border-slate-200 bg-slate-50 hover:border-blue-300'
                          }`}
                        >
                          <span className="block text-xs font-extrabold text-slate-900">خودکار · پیشنهادی</span>
                          <span className="mt-1 block text-[10px] leading-4 text-slate-600">
                            خاکستری با حفظ جزئیات ریز و نوشته‌های حرارتی
                          </span>
                        </button>
                        <button
                          type="button"
                          data-testid="receipt-processing-mode-high-contrast"
                          aria-pressed={processingMode === 'high-contrast'}
                          onClick={() => setProcessingMode('high-contrast')}
                          className={`rounded-xl border p-3 text-right transition cursor-pointer ${
                            processingMode === 'high-contrast'
                              ? 'border-amber-500 bg-amber-50 ring-1 ring-amber-200'
                              : 'border-slate-200 bg-slate-50 hover:border-amber-300'
                          }`}
                        >
                          <span className="block text-xs font-extrabold text-slate-900">پرکنتراست · آزمایشی</span>
                          <span className="mt-1 block text-[10px] leading-4 text-slate-600">
                            سیاه‌وسفید؛ threshold خودکار Otsu
                          </span>
                        </button>
                      </div>
                      <p role="note" className="mt-2 text-[10px] leading-5 text-slate-500">
                        {processingMode === 'auto'
                          ? 'حالت خودکار برای شروع مناسب است و کیفیت lossless رسیدهای حرارتی باریک را حفظ می‌کند.'
                          : 'این حالت آزمایشی است و ممکن است نوشته‌های کم‌رنگ را حذف کند؛ اگر نتیجه بدتر شد، «خودکار» را انتخاب کن.'}
                      </p>
                    </section>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={startLiveWebCamera}
                        className="flex flex-col items-center justify-center gap-2.5 rounded-2xl bg-blue-600 p-6 text-white shadow-sm shadow-blue-600/20 hover:bg-blue-700 transition cursor-pointer"
                      >
                        <Camera className="h-8 w-8" />
                        <span className="text-sm font-extrabold">گرفتن عکس</span>
                        <span className="text-[11px] text-blue-100">
                          از نزدیک و روبه‌رو بگیر تا فارسی و رقم‌ها واضح‌تر باشند.
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={pickFromGallery}
                        className="flex flex-col items-center justify-center gap-2.5 rounded-2xl bg-slate-50 border-2 border-dashed border-slate-300 p-6 text-slate-800 hover:border-blue-500 hover:bg-blue-50/30 transition cursor-pointer"
                      >
                        <ImagePlus className="h-8 w-8 text-blue-600" />
                        <span className="text-sm font-extrabold">انتخاب فایل یا عکس</span>
                        <span className="text-[11px] text-slate-500">
                          از فایل‌های دستگاه
                        </span>
                      </button>
                    </div>

                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (f) void executeScan({ file: f });
                      }}
                      className="hidden"
                    />

                    {cameraError && (
                      <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                        {cameraError}
                      </p>
                    )}
                  </div>
                )}

                <div className="rounded-3xl bg-white p-5 border border-slate-200/80 space-y-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-blue-600" />
                    <h3 className="text-xs font-extrabold text-slate-900">
                      فاکتورهای نمونه
                    </h3>
                  </div>

                  <div className="space-y-2.5">
                    {BUILTIN_SAMPLES.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        data-testid={`receipt-sample-${s.id}`}
                        onClick={() => executeScan({ sampleId: s.id })}
                        className="w-full flex items-center gap-3.5 rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3 text-right hover:border-blue-400 hover:bg-blue-50/40 transition cursor-pointer"
                      >
                        <img
                          src={assetUrl(s.thumb)}
                          alt={s.title}
                          className="h-14 w-14 shrink-0 rounded-xl object-cover border border-slate-200 bg-white"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-extrabold text-slate-900">{s.title}</p>
                          <p className="text-[11px] text-slate-500 mt-0.5">{s.desc}</p>
                        </div>
                        <span className="shrink-0 rounded-xl bg-blue-600 px-3 py-1.5 text-[11px] font-bold text-white">
                          اسکن نمونه
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* STEP 2: LIVE VISUAL SCAN PREVIEW + REAL PERCENTAGE PROGRESS BAR */}
            {step === 'scanning' && (
              <div className="rounded-3xl bg-white p-6 text-center border border-slate-200/80 space-y-5">
                {scanningPreviewUrl ? (
                  <div className="relative mx-auto max-w-[260px] max-h-56 overflow-hidden rounded-2xl border-2 border-blue-500/50 bg-slate-100 shadow-md">
                    <img
                      src={scanningPreviewUrl}
                      alt="در حال اسکن"
                      className="w-full h-48 object-cover opacity-90"
                    />
                    <motion.div
                      animate={{ top: ['4%', '92%', '4%'] }}
                      transition={{ duration: 2.0, repeat: Infinity, ease: 'easeInOut' }}
                      className="pointer-events-none absolute inset-x-0 h-1 bg-blue-500 shadow-[0_0_18px_4px_rgba(37,99,235,0.85)]"
                    />
                  </div>
                ) : (
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                    <Loader2 className="h-8 w-8 animate-spin" />
                  </div>
                )}

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-extrabold text-slate-800 px-1 tabular-fa">
                    <span>در حال خواندن فاکتور...</span>
                    <span className="text-blue-600">{toPersianDigits(progressPct)}٪</span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-blue-600 transition-all duration-300"
                      style={{ width: `${Math.max(8, progressPct)}%` }}
                    />
                  </div>
                  <p className="text-xs font-medium text-slate-500 pt-1">{stageMessage}</p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    cancelActiveOcrScan();
                    setStep('capture');
                  }}
                  className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200 cursor-pointer"
                >
                  لغو و انتخاب تصویر دیگر
                </button>
              </div>
            )}

            {/* STEP 3: REVIEW + BOUNDING BOXES + RECONCILIATION */}
            {step === 'review' && scanResult && (
              <div className="space-y-4">
                {(scanResult.processedImageUrl || scanResult.originalImageUrl) && (
                  <div className="rounded-3xl bg-white p-4 border border-slate-200/80 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-xl tabular-fa">
                        <Cpu className="h-3.5 w-3.5" />
                        اطمینان خوانش: {toPersianDigits(scanResult.receipt.ocr_confidence)}٪ (
                        {toPersianDigits((scanResult.durationMs / 1000).toFixed(1))} ثانیه)
                      </span>

                      <div className="flex items-center gap-1.5 flex-wrap">
                        {scanResult.lineBoxes.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setShowBoxes((v) => !v)}
                            className={`rounded-lg px-2.5 py-1 text-[11px] font-bold cursor-pointer ${
                              showBoxes
                                ? 'bg-emerald-600 text-white'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            کادر خطوط
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setShowRawOcr((v) => !v)}
                          className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-200 cursor-pointer"
                        >
                          <FileText className="h-3 w-3" />
                          متن خام OCR
                        </button>
                      </div>
                    </div>

                    {scanResult.ocrQuality && (
                      <div
                        role={scanQualityNeedsReview ? 'alert' : 'status'}
                        className={`rounded-2xl border px-3.5 py-3 ${
                          scanQualityNeedsReview
                            ? 'border-amber-200 bg-amber-50 text-amber-900'
                            : 'border-emerald-200 bg-emerald-50 text-emerald-900'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[11px] font-extrabold">
                            {scanResult.ocrQuality.amountReadFromReceipt
                              ? 'مبلغ پرداختی خوانده‌شده'
                              : 'مبلغ پرداختی محاسبه‌شده'}
                          </span>
                          <span
                            data-testid="ocr-source-total"
                            data-amount={scanResult.receipt.total_amount}
                            className="text-sm font-black tabular-fa"
                          >
                            {formatCurrency(scanResult.receipt.total_amount, resultCurrency)}
                          </span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-1.5 text-[10px] font-extrabold">
                          {scanQualityNeedsReview ? (
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                          )}
                          <span>{scanQualityNeedsReview ? 'نیازمند بازبینی' : 'مبالغ هم‌خوان هستند'}</span>
                        </div>
                        <div className="mt-1.5 flex items-center justify-between gap-3 text-[10px]">
                          <span>
                            {scanResult.ocrQuality.subtotalReadFromReceipt
                              ? 'جمع اقلام خوانده‌شده از فاکتور'
                              : 'جمع اقلام محاسبه‌شده از ردیف‌ها'}
                          </span>
                          <span
                            data-testid="ocr-source-subtotal"
                            data-amount={scanResult.receipt.subtotal}
                            data-read-from-receipt={scanResult.ocrQuality.subtotalReadFromReceipt}
                            className="font-bold tabular-fa"
                          >
                            {formatCurrency(scanResult.receipt.subtotal, resultCurrency)}
                          </span>
                        </div>
                        <p className="mt-1.5 text-[11px] leading-5">
                          {!scanResult.ocrQuality.amountReadFromReceipt
                            ? 'مبلغ نهایی در متن فاکتور پیدا نشد و از روی ردیف‌ها محاسبه شده؛ آن را با اصل فاکتور مقایسه کن.'
                            : scanResult.ocrQuality.payableMatchesItems
                              ? 'مبلغ نهایی با جمع ردیف‌ها و تخفیف هماهنگ است.'
                              : 'مبلغ نهایی با جمع ردیف‌ها جور درنمی‌آید؛ قبل از ثبت، اعداد را بررسی کن.'}
                        </p>
                        {scanResult.ocrQuality.unrecognizedItemCount > 0 && (
                          <p className="mt-1 text-[11px] font-bold leading-5">
                            نام {toPersianDigits(scanResult.ocrQuality.unrecognizedItemCount)} ردیف از تصویر خوانده نشد؛ مبلغ آن حفظ شده تا نامش را بازبینی کنی.
                          </p>
                        )}
                        {!scanResult.ocrQuality.subtotalReadFromReceipt && (
                          <p className="mt-1 text-[11px] font-bold leading-5">
                            جمع اقلام چاپ‌شده پیدا نشد و از روی ردیف‌های خوانده‌شده محاسبه شده است.
                          </p>
                        )}
                        {scanResult.receipt.currency_detected === false && (
                          <p className="mt-1 text-[11px] font-bold leading-5">
                            واحد پول در متن پیدا نشد؛ مبالغ فعلاً تومان در نظر گرفته شده‌اند. واحد را با فاکتور اصلی تطبیق بده.
                          </p>
                        )}
                        {scanResult.receipt.detected_rial && (
                          <p className="mt-1 text-[11px] font-bold leading-5">
                            واحد چاپ‌شده ریال تشخیص داده شد و برای نمایش به تومان تبدیل شده است.
                          </p>
                        )}
                        {!scanResult.ocrQuality.itemTotalsMatchSubtotal && (
                          <p className="mt-1 text-[11px] font-bold leading-5">
                            جمع ردیف‌های خوانده‌شده با جمع اقلام فاکتور برابر نیست.
                          </p>
                        )}
                        {scanResult.receipt.discount_inferred && (
                          <p className="mt-1 text-[11px] font-bold leading-5">
                            تخفیف از اختلاف جمع اقلام و مبلغ پرداختی برآورد شده؛ مقدارش را با اصل فاکتور تطبیق بده.
                          </p>
                        )}
                        {scanResult.receipt.ocr_confidence < 65 && (
                          <p className="mt-1 text-[11px] font-bold leading-5">
                            بخشی از نوشته‌ها واضح نیست؛ ردیف‌ها را پیش از ذخیره بازبینی کن.
                          </p>
                        )}
                      </div>
                    )}

                    <div className="relative max-h-60 overflow-y-auto rounded-2xl bg-slate-900/5 border border-slate-200">
                      <div className="relative w-full">
                        <img
                          src={scanResult.processedImageUrl || scanResult.originalImageUrl}
                          alt="Scanned Receipt"
                          className="w-full h-auto block rounded-xl"
                        />
                        {showBoxes &&
                          scanResult.lineBoxes.map((b, i) => (
                            <div
                              key={i}
                              style={{
                                left: `${b.x * 100}%`,
                                top: `${b.y * 100}%`,
                                width: `${b.w * 100}%`,
                                height: `${b.h * 100}%`,
                              }}
                              className="pointer-events-none absolute rounded-xs border border-emerald-500/80 bg-emerald-400/12"
                            />
                          ))}
                      </div>
                    </div>

                    {showRawOcr && (
                      <div className="rounded-2xl bg-slate-900 text-slate-100 p-3.5 text-xs leading-relaxed font-mono whitespace-pre-wrap max-h-44 overflow-y-auto">
                        {scanResult.rawOcrText || 'متنی یافت نشد'}
                      </div>
                    )}
                  </div>
                )}

                {/* Shopping List Reconciliation Summary */}
                <div className="rounded-3xl bg-white p-4.5 border border-slate-200/80 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-extrabold text-slate-900">
                      تطبیق خودکار با لیست خرید:
                    </span>
                    <select
                      value={activeListId}
                      onChange={(e) => onSelectList(e.target.value)}
                      className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-800 outline-none"
                    >
                      {lists.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.title}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center tabular-fa">
                    <div className="rounded-2xl bg-emerald-50 p-2.5 border border-emerald-200/70">
                      <p className="text-lg font-extrabold text-emerald-700">
                        {toPersianDigits(liveReconciliation.matchedCount)}
                      </p>
                      <p className="text-[11px] font-bold text-emerald-800">تیک خورده ✅</p>
                    </div>
                    <div className="rounded-2xl bg-amber-50 p-2.5 border border-amber-200/70">
                      <p className="text-lg font-extrabold text-amber-700">
                        {toPersianDigits(liveReconciliation.missingCount)}
                      </p>
                      <p className="text-[11px] font-bold text-amber-800">جا مانده ⚠️</p>
                    </div>
                    <div className="rounded-2xl bg-blue-50 p-2.5 border border-blue-200/70">
                      <p className="text-lg font-extrabold text-blue-700">
                        {toPersianDigits(liveReconciliation.extraCount)}
                      </p>
                      <p className="text-[11px] font-bold text-blue-800">خارج از لیست ➕</p>
                    </div>
                  </div>

                  {liveReconciliation.missingNames.length > 0 && (
                    <div className="flex items-start gap-2 rounded-2xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-950">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                      <div>
                        <span className="font-extrabold">از قلم افتاده در این فاکتور: </span>
                        <span className="font-semibold">
                          {liveReconciliation.missingNames.join('، ')}
                        </span>
                      </div>
                    </div>
                  )}

                  {targetShoppingItems.length > 0 && liveReconciliation.missingNames.length === 0 && (
                    <div className="flex items-center gap-2 rounded-2xl bg-emerald-50 border border-emerald-200 p-3 text-xs font-bold text-emerald-900">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                      تمام اقلام لیست خرید در این فاکتور موجود است و هیچ قلمی جا نمانده!
                    </div>
                  )}
                </div>

                {/* Editable Store Info & Line Items + Rial/Toman Quick Converter */}
                <div className="rounded-3xl bg-white p-4.5 border border-slate-200/80 space-y-3.5">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-bold text-slate-500 mb-1">
                        نام فروشگاه تشخیص داده شده
                      </label>
                      <input
                        type="text"
                        value={storeName}
                        onChange={(e) => setStoreName(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:border-blue-500 focus:bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 mb-1">
                        تاریخ فاکتور
                      </label>
                      <input
                        type="text"
                        value={jalaliDate}
                        onChange={(e) => setJalaliDate(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:border-blue-500 focus:bg-white tabular-fa"
                      />
                    </div>
                  </div>

                  {/* Quick Rial <-> Toman Helper Bar */}
                  {!isLiraCurrency && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 border border-slate-200/70">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-600">
                      <ArrowLeftRight className="h-3.5 w-3.5 text-blue-600" />
                      اصلاح سریع واحد پول مبالغ:
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => scaleAllPrices(0.1)}
                        className="rounded-lg bg-white border border-slate-200 px-2.5 py-1 text-[11px] font-bold text-slate-700 hover:bg-blue-50 hover:text-blue-700 cursor-pointer"
                      >
                        تبدیل ریال به تومان (÷۱۰)
                      </button>
                      <button
                        type="button"
                        onClick={() => scaleAllPrices(10)}
                        className="rounded-lg bg-white border border-slate-200 px-2.5 py-1 text-[11px] font-bold text-slate-700 hover:bg-blue-50 hover:text-blue-700 cursor-pointer"
                      >
                        ×۱۰
                      </button>
                    </div>
                  </div>
                  )}

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-extrabold text-slate-800 tabular-fa">
                        اقلام استخراج‌شده ({toPersianDigits(items.length)} ردیف)
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setItems((prev) => [
                            ...prev,
                            {
                              name: 'کالای جدید',
                              quantity: 1,
                              unit: 'عدد',
                              unit_price: 50000,
                              total_price: 50000,
                              discount: 0,
                              category: 'خواربار',
                              confidence: 100,
                            },
                          ])
                        }
                        className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-600 cursor-pointer"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        افزودن ردیف
                      </button>
                    </div>

                    {items.map((it, idx) => {
                      const matchedInList = liveReconciliation.items.some(
                        (r) => r.matchedReceiptItemIndex === idx
                      );
                      return (
                        <div
                          key={idx}
                          className={`rounded-2xl border p-3 space-y-2 ${
                            matchedInList
                              ? 'border-emerald-200 bg-emerald-50/40'
                              : 'border-slate-200/80 bg-slate-50/50'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            {matchedInList && (
                              <span
                                title="منطبق با لیست خرید"
                                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white"
                              >
                                <Check className="h-3 w-3 stroke-[3]" />
                              </span>
                            )}
                            <input
                              data-testid="receipt-item-name"
                              type="text"
                              value={it.name}
                              onChange={(e) =>
                                updateItemField(idx, {
                                  name: e.target.value,
                                  category: inferItemCategory(e.target.value),
                                })
                              }
                              className="flex-1 rounded-lg bg-white border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-900 outline-none focus:border-blue-500"
                            />
                            <button
                              type="button"
                              onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                              className="p-1.5 text-slate-400 hover:text-rose-600 cursor-pointer"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>

                          <div className="grid grid-cols-3 gap-2 text-xs tabular-fa">
                            <div>
                              <span className="block text-[10px] text-slate-400 mb-0.5">تعداد</span>
                              <input
                                type="number"
                                step={0.5}
                                min={0.5}
                                value={it.quantity}
                                onChange={(e) =>
                                  updateItemField(idx, { quantity: Number(e.target.value) })
                                }
                                className="w-full rounded-lg bg-white border border-slate-200 px-2 py-1 font-bold text-slate-800"
                              />
                            </div>
                            <div>
                              <span className="block text-[10px] text-slate-400 mb-0.5">
                                قیمت واحد ({resultCurrency})
                              </span>
                              <input
                                type="number"
                                step={1000}
                                value={it.unit_price}
                                onChange={(e) =>
                                  updateItemField(idx, { unit_price: Number(e.target.value) })
                                }
                                className="w-full rounded-lg bg-white border border-slate-200 px-2 py-1 font-bold text-slate-800"
                              />
                            </div>
                            <div>
                              <span className="block text-[10px] text-slate-400 mb-0.5">
                                مبلغ کل ({resultCurrency})
                              </span>
                              <div
                                data-testid="receipt-item-total"
                                data-amount={it.total_price}
                                className="rounded-lg bg-white border border-slate-200 px-2.5 py-1 font-extrabold text-blue-700"
                              >
                                {formatCurrency(it.total_price, resultCurrency, false)}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="rounded-2xl bg-slate-50 p-3.5 space-y-2 text-xs tabular-fa border border-slate-200/60">
                    <div className="flex justify-between text-slate-600">
                      <span>جمع کل اقلام:</span>
                      <span
                        data-testid="receipt-subtotal"
                        data-amount={liveSubtotal}
                        className="font-bold"
                      >
                        {formatCurrency(liveSubtotal, resultCurrency)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-emerald-700">
                      <span>تخفیف فاکتور ({resultCurrency}):</span>
                      <input
                        data-testid="receipt-discount"
                        type="number"
                        step={1000}
                        value={discountTotal}
                        onChange={(e) => setDiscountTotal(Number(e.target.value))}
                        className="w-28 rounded-lg bg-white border border-emerald-200 px-2 py-1 text-left font-bold text-emerald-700"
                      />
                    </div>
                    <div className="flex items-center justify-between text-slate-600">
                      <span>مالیات / عوارض ({resultCurrency}):</span>
                      <input
                        type="number"
                        step={1000}
                        value={taxTotal}
                        onChange={(e) => setTaxTotal(Number(e.target.value))}
                        className="w-28 rounded-lg bg-white border border-slate-200 px-2 py-1 text-left font-bold text-slate-700"
                      />
                    </div>
                    <div className="flex justify-between border-t border-slate-200 pt-2 text-sm font-extrabold text-slate-900">
                      <span>مبلغ قابل پرداخت:</span>
                      <span data-testid="receipt-payable-total" data-amount={liveGrandTotal} className="text-blue-600">
                        {formatCurrency(liveGrandTotal, resultCurrency)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {step === 'review' && (
            <div className="flex items-center gap-2.5 bg-white px-5 py-4 border-t border-slate-200 shrink-0">
              <button
                type="button"
                data-testid="receipt-rescan"
                onClick={() => setStep('capture')}
                className="rounded-2xl border border-slate-200 px-4 py-3 text-xs font-bold text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                اسکن مجدد
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleSave}
                className="flex-1 flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-extrabold text-white shadow-sm shadow-blue-600/25 hover:bg-blue-700 disabled:opacity-60 cursor-pointer"
              >
                {saving ? (
                  <Loader2 className="h-4.5 w-4.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4.5 w-4.5" />
                )}
                ثبت فاکتور و اعمال تیک‌های لیست خرید
              </button>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
