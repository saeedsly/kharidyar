import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Cloud,
  Cpu,
  Download,
  KeyRound,
  RefreshCw,
  Server,
  Smartphone,
  Wifi,
} from 'lucide-react';
import QRCode from 'qrcode';
import {
  getCloudVisionSettings,
  saveCloudVisionSettings,
  type CloudVisionSettings,
} from '../lib/visionClient';

interface ServerConnectTabProps {
  serverUrl: string;
  serverOnline: boolean;
  cloudConnected: boolean;
  cvEngine: string;
  apkDownloadUrl: string;
  onRefreshConnection: () => Promise<void>;
}

export function ServerConnectTab({
  serverUrl,
  serverOnline,
  cloudConnected,
  cvEngine,
  apkDownloadUrl,
  onRefreshConnection,
}: ServerConnectTabProps) {
  const [customUrl, setCustomUrl] = useState(
    () => localStorage.getItem('kharidyar_custom_server_url') || ''
  );
  const [aiSettings, setAiSettings] = useState<CloudVisionSettings>(() =>
    getCloudVisionSettings()
  );
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [savedToast, setSavedToast] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const fullTarget = apkDownloadUrl.startsWith('http')
      ? apkDownloadUrl
      : `${window.location.origin}${apkDownloadUrl}`;
    QRCode.toDataURL(fullTarget, {
      width: 220,
      margin: 1,
      color: { dark: '#0F172A', light: '#FFFFFF' },
    })
      .then(setQrDataUrl)
      .catch(() => {});
  }, [apkDownloadUrl]);

  const showToast = (msg: string) => {
    setSavedToast(msg);
    setTimeout(() => setSavedToast(null), 3000);
  };

  const handleSaveCustomServer = async () => {
    const trimmed = customUrl.trim();
    if (trimmed) {
      localStorage.setItem('kharidyar_custom_server_url', trimmed);
    } else {
      localStorage.removeItem('kharidyar_custom_server_url');
    }
    setChecking(true);
    await onRefreshConnection();
    setChecking(false);
    showToast('تنظیمات اتصال خودکار سرور ذخیره و بروزرسانی شد.');
  };

  const handleSaveAiKey = (e: React.FormEvent) => {
    e.preventDefault();
    saveCloudVisionSettings(aiSettings);
    showToast('تنظیمات هوش مصنوعی بینایی ماشین با موفقیت ذخیره شد.');
  };

  return (
    <div className="space-y-4 pb-28">
      {savedToast && (
        <div className="rounded-2xl bg-emerald-600 px-4 py-3 text-xs font-bold text-white shadow-md">
          ✓ {savedToast}
        </div>
      )}

      {/* Direct Android APK Download + QR Code Card */}
      <div className="rounded-3xl bg-white p-5 border border-slate-200/80 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col sm:flex-row items-center gap-5">
          <div className="flex-1 space-y-3 text-right">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
              <Smartphone className="h-3.5 w-3.5" />
              نسخه نصبی اندروید (APK) — آماده نصب
            </span>

            <h2 className="text-base font-extrabold text-slate-900">
              نصب مستقیم اپلیکیشن «خریدیـار» روی موبایل
            </h2>
            <p className="text-xs leading-relaxed text-slate-600">
              فایل APK به صورت کاملاً خودکار به دیتابیس ابری{' '}
              <span className="font-bold text-slate-800">Supabase</span> و سرور بینایی ماشین متصل
              می‌شود و حتی بدون سرور هم دارای موتور عصبی فارسی داخلی است.
            </p>

            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <a
                href={apkDownloadUrl}
                download="KharidYar-v1.0.apk"
                className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-xs font-extrabold text-white shadow-sm shadow-blue-600/20 hover:bg-blue-700 transition"
              >
                <Download className="h-4 w-4" />
                دانلود مستقیم فایل APK اندروید
              </a>
            </div>
          </div>

          {qrDataUrl && (
            <div className="shrink-0 flex flex-col items-center rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <img src={qrDataUrl} alt="QR Download APK" className="h-32 w-32 rounded-xl bg-white p-1" />
              <span className="mt-2 text-[11px] font-bold text-slate-600">
                اسکن با دوربین گوشی
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Zero-Config Automatic Cloud & CV Server Telemetry */}
      <div className="rounded-3xl bg-white p-5 border border-slate-200/80 shadow-[0_8px_30px_rgba(15,23,42,0.04)] space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Wifi className="h-5 w-5 text-emerald-600" />
            <h3 className="text-sm font-extrabold text-slate-900">
              وضعیت اتصال خودکار سرور و شبکه ابری
            </h3>
          </div>

          <button
            type="button"
            disabled={checking}
            onClick={async () => {
              setChecking(true);
              await onRefreshConnection();
              setChecking(false);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-200 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${checking ? 'animate-spin' : ''}`} />
            بررسی مجدد
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-800">
                <Cloud className="h-4 w-4 text-emerald-600" />
                دیتابیس ابری Supabase
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800">
                <CheckCircle2 className="h-3 w-3" />
                {cloudConnected ? 'متصل و زنده' : 'کش آفلاین فعال'}
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              همگام‌سازی لحظه‌ای (Realtime) فاکتورها و لیست خرید بین موبایل و وب
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-800">
                <Server className="h-4 w-4 text-blue-600" />
                سرور پردازش تصویر OpenCV
              </span>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                  serverOnline
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-blue-100 text-blue-800'
                }`}
              >
                {serverOnline ? 'متصل خودکار' : 'موتور داخلی گوشی فعال'}
              </span>
            </div>
            <p className="truncate text-[11px] text-slate-500" dir="ltr">
              {serverUrl}
            </p>
          </div>
        </div>

        <div className="rounded-2xl bg-blue-50/60 border border-blue-100 p-3 text-xs text-slate-700 flex items-center gap-2">
          <Cpu className="h-4 w-4 text-blue-600 shrink-0" />
          <span>
            موتور فعال فعلی: <strong className="text-slate-900">{cvEngine}</strong>
          </span>
        </div>

        {/* Optional Custom Server Address Override */}
        <div className="pt-1 space-y-2">
          <label className="block text-xs font-bold text-slate-700">
            آدرس سرور دلخواه (خالی بگذارید تا گوشی به صورت ۱۰۰٪ خودکار سرور را پیدا کند)
          </label>
          <div className="flex gap-2">
            <input
              type="url"
              dir="ltr"
              placeholder="Auto-Discovery Active (https://...)"
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs font-mono outline-none focus:border-blue-500 focus:bg-white"
            />
            <button
              type="button"
              onClick={handleSaveCustomServer}
              className="rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white hover:bg-slate-800 cursor-pointer"
            >
              ذخیره
            </button>
          </div>
        </div>
      </div>

      {/* Optional Cloud Multimodal AI Vision Upgrade (Gemini 2.5 / GPT-4o) */}
      <form
        onSubmit={handleSaveAiKey}
        className="rounded-3xl bg-white p-5 border border-slate-200/80 shadow-[0_8px_30px_rgba(15,23,42,0.04)] space-y-3.5"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4.5 w-4.5 text-blue-600" />
            <h3 className="text-sm font-extrabold text-slate-900">
              افزایش دقت با هوش مصنوعی ابری (اختیاری)
            </h3>
          </div>
          <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-700">
            <input
              type="checkbox"
              checked={aiSettings.enabled}
              onChange={(e) => setAiSettings((s) => ({ ...s, enabled: e.target.checked }))}
              className="h-4 w-4 accent-blue-600 rounded"
            />
            فعال
          </label>
        </div>

        <p className="text-xs text-slate-500 leading-relaxed">
          موتور داخلی OpenCV + شبکه عصبی فارسی بدون نیاز به هیچ کلیدی به صورت رایگان کار می‌کند. در
          صورت تمایل به خوانش فیش‌های دست‌نویس یا مچاله با Gemini 2.5 Flash یا GPT-4o می‌توانید کلید
          API خود را وارد کنید:
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <select
            value={aiSettings.provider}
            onChange={(e) =>
              setAiSettings((s) => ({
                ...s,
                provider: e.target.value as 'gemini' | 'openai',
              }))
            }
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-bold text-slate-800 outline-none"
          >
            <option value="gemini">Google Gemini 2.5 Flash</option>
            <option value="openai">OpenAI GPT-4o Vision</option>
          </select>

          <input
            type="password"
            dir="ltr"
            placeholder="API Key (AIza... / sk-...)"
            value={aiSettings.apiKey}
            onChange={(e) => setAiSettings((s) => ({ ...s, apiKey: e.target.value }))}
            className="sm:col-span-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs font-mono outline-none focus:border-blue-500 focus:bg-white"
          />
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 cursor-pointer"
          >
            ذخیره تنظیمات هوش مصنوعی
          </button>
        </div>
      </form>
    </div>
  );
}
