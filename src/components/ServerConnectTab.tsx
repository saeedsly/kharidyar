import { useEffect, useState } from 'react';
import {
  Award,
  CheckCircle2,
  Cloud,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  FileCheck2,
  KeyRound,
  Linkedin,
  Link2,
  RefreshCw,
  Server,
  ShieldCheck,
  Smartphone,
  Wifi,
} from 'lucide-react';
import QRCode from 'qrcode';
import { assetUrl } from '../lib/assetUrl';
import { getWorkspaceId, setWorkspaceId } from '../lib/supabase';
import {
  getCloudVisionSettings,
  saveCloudVisionSettings,
  type CloudVisionSettings,
} from '../lib/visionClient';
import { OWNER_LINKEDIN_URL } from './AboutOwnerModal';

const GITHUB_RELEASE_AAB_URL =
  'https://github.com/saeedsly/kharidyar/releases/download/v1.0.0/KharidYar-PlayStore.aab';

interface ServerConnectTabProps {
  serverUrl: string;
  serverOnline: boolean;
  cloudConnected: boolean;
  cvEngine: string;
  apkDownloadUrl: string;
  onRefreshConnection: () => Promise<void>;
  onWorkspaceChanged: () => Promise<void>;
  onOpenAboutOwner: () => void;
}

export function ServerConnectTab({
  serverUrl,
  serverOnline,
  cloudConnected,
  cvEngine,
  apkDownloadUrl,
  onRefreshConnection,
  onWorkspaceChanged,
  onOpenAboutOwner,
}: ServerConnectTabProps) {
  const [workspaceCode, setWorkspaceCodeState] = useState(() => getWorkspaceId());
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
    setTimeout(() => setSavedToast(null), 3200);
  };

  const handleApplySyncCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const updated = setWorkspaceId(workspaceCode);
    setWorkspaceCodeState(updated);
    await onWorkspaceChanged();
    showToast(`فضای کاری اختصاصی «${updated}» فعال و با کلود همگام‌سازی شد.`);
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

      {/* Official Creator Bio, Ownership & LinkedIn Card */}
      <div className="rounded-3xl bg-white p-5 border border-slate-200/80 shadow-[0_8px_30px_rgba(15,23,42,0.04)] space-y-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
              <Award className="h-5 w-5" />
            </div>
            <div>
              <span className="text-[11px] font-bold text-blue-600">
                خالق، طراح و صاحب امتیاز رسمی اثر
              </span>
              <h2 className="text-base font-black text-slate-900">
                سعید سالاری <span className="text-xs font-semibold text-slate-400">(Saeed Salari)</span>
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenAboutOwner}
            className="rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-200 cursor-pointer"
          >
            شناسنامه کامل اثر
          </button>
        </div>

        <p className="text-xs leading-relaxed text-slate-600">
          کلیه حقوق مادی و معنوی اپلیکیشن «خریدیـار» متعلق به سعید سالاری است. طراحی‌شده مطابق با
          استانداردهای امنیتی و سیاست‌های حریم خصوصی Google Play Store.
        </p>

        <div className="flex flex-wrap items-center gap-2.5">
          <a
            href={OWNER_LINKEDIN_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-2xl bg-[#0A66C2] px-4 py-2.5 text-xs font-extrabold text-white hover:bg-[#004182] transition"
          >
            <Linkedin className="h-4 w-4 fill-current" />
            پروفایل رسمی لینکدین سعید سالاری
            <ExternalLink className="h-3.5 w-3.5 opacity-80" />
          </a>

          <a
            href={assetUrl('privacy.html')}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-100 transition"
          >
            <FileCheck2 className="h-4 w-4 text-emerald-600" />
            سیاست حریم خصوصی (Privacy Policy)
          </a>
        </div>
      </div>

      {/* Private Multi-User Cloud Sync Code Card */}
      <form
        onSubmit={handleApplySyncCode}
        className="rounded-3xl bg-white p-5 border border-slate-200/80 shadow-[0_8px_30px_rgba(15,23,42,0.04)] space-y-3"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Link2 className="h-4.5 w-4.5 text-blue-600" />
            <h3 className="text-sm font-extrabold text-slate-900">
              کد اختصاصی همگام‌سازی شخصی (موبایل ⇄ وب)
            </h3>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">
            <ShieldCheck className="h-3.5 w-3.5" />
            ایزوله و خصوصی
          </span>
        </div>

        <p className="text-xs text-slate-500 leading-relaxed">
          اطلاعات هر کاربر در اینترنت کاملاً خصوصی و جدا از سایر کاربران ذخیره می‌شود. برای اتصال
          هم‌زمان گوشی و لپ‌تاپ خودتان، همین کد را در هر دو دستگاه وارد کنید:
        </p>

        <div className="flex gap-2">
          <input
            type="text"
            dir="ltr"
            value={workspaceCode}
            onChange={(e) => setWorkspaceCodeState(e.target.value.toUpperCase())}
            className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-center text-sm font-black tracking-widest text-slate-900 outline-none focus:border-blue-500 focus:bg-white"
          />
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(workspaceCode);
              showToast('کد همگام‌سازی شخصی کپی شد.');
            }}
            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-100 cursor-pointer"
          >
            <Copy className="h-3.5 w-3.5" />
            کپی
          </button>
          <button
            type="submit"
            className="rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-blue-700 cursor-pointer"
          >
            اتصال کد
          </button>
        </div>
      </form>

      {/* Signed Production Release APK + Official Google Play AAB Card */}
      <div className="rounded-3xl bg-white p-5 border border-slate-200/80 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col sm:flex-row items-center gap-5">
          <div className="flex-1 space-y-3 text-right">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
              <Smartphone className="h-3.5 w-3.5" />
              نسخه Release امضاشده رسمی (تاییدشده برای اندروید و گوگل‌پلی)
            </span>

            <h2 className="text-base font-extrabold text-slate-900">
              دانلود مستقیم اندروید (APK) + بسته انتشار Google Play (AAB)
            </h2>
            <p className="text-xs leading-relaxed text-slate-600">
              امضاشده با گواهی دیجیتال رسمی <strong className="text-slate-800">Release Keystore</strong>{' '}
              (بدون کلید تست Debug) و حداقل دسترسی استاندارد گوگل برای نصب امن بدون اخطار Play Protect.
            </p>

            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <a
                href={apkDownloadUrl}
                download="KharidYar-v1.0.apk"
                className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-xs font-extrabold text-white shadow-sm shadow-blue-600/20 hover:bg-blue-700 transition"
              >
                <Download className="h-4 w-4" />
                دانلود مستقیم APK اندروید
              </a>

              <a
                href={GITHUB_RELEASE_AAB_URL}
                download="KharidYar-PlayStore.aab"
                className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-xs font-bold text-slate-800 hover:bg-slate-100 transition"
              >
                <Download className="h-3.5 w-3.5 text-emerald-600" />
                فایل رسمی Google Play (.AAB)
              </a>
            </div>
          </div>

          {qrDataUrl && (
            <div className="shrink-0 flex flex-col items-center rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <img
                src={qrDataUrl}
                alt="QR Download APK"
                className="h-32 w-32 rounded-xl bg-white p-1"
              />
              <span className="mt-2 text-[11px] font-bold text-slate-600">
                اسکن با دوربین گوشی
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Cloud & CV Server Telemetry */}
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
                پردازش بینایی ماشین
              </span>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                  serverOnline
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-blue-100 text-blue-800'
                }`}
              >
                {serverOnline ? 'سرور OpenCV متصل' : 'موتور WASM فعال'}
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

        <div className="pt-1 space-y-2">
          <label className="block text-xs font-bold text-slate-700">
            آدرس سرور دلخواه (اختیاری — خالی بگذارید تا کاملاً خودکار متصل شود)
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

      {/* Optional Cloud Multimodal AI Vision Key */}
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
          موتور عصبی فارسی داخلی بدون نیاز به هیچ کلیدی کاملاً رایگان کار می‌کند. در صورت تمایل به
          خوانش دست‌خط یا فیش‌های چروکیده با Gemini 2.5 Flash یا GPT-4o کلید API خود را وارد کنید:
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
