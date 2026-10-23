import { useState } from 'react';
import {
  Award,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FileCheck2,
  KeyRound,
  Linkedin,
  Link2,
  ShieldCheck,
} from 'lucide-react';
import { assetUrl } from '../lib/assetUrl';
import { getWorkspaceId, setWorkspaceId } from '../lib/supabase';
import {
  getCloudVisionSettings,
  saveCloudVisionSettings,
  type CloudVisionSettings,
} from '../lib/visionClient';
import { OWNER_LINKEDIN_URL } from './AboutOwnerModal';

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
  apkDownloadUrl,
  onWorkspaceChanged,
  onOpenAboutOwner,
}: ServerConnectTabProps) {
  const [workspaceCode, setWorkspaceCodeState] = useState(() => getWorkspaceId());
  const [aiSettings, setAiSettings] = useState<CloudVisionSettings>(() =>
    getCloudVisionSettings()
  );
  const [savedToast, setSavedToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setSavedToast(msg);
    setTimeout(() => setSavedToast(null), 3200);
  };

  const handleApplySyncCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const updated = setWorkspaceId(workspaceCode);
    setWorkspaceCodeState(updated);
    await onWorkspaceChanged();
    showToast(`فضای کاری اختصاصی «${updated}» فعال و همگام‌سازی شد.`);
  };

  const handleSaveAiKey = (e: React.FormEvent) => {
    e.preventDefault();
    saveCloudVisionSettings(aiSettings);
    showToast('تنظیمات هوش مصنوعی ذخیره شد.');
  };

  return (
    <div className="space-y-4 pb-28">
      {savedToast && (
        <div className="rounded-2xl bg-emerald-600 px-4 py-3 text-xs font-bold text-white shadow-md">
          ✓ {savedToast}
        </div>
      )}

      {/* Official Creator Bio, Ownership & LinkedIn Card */}
      <div className="rounded-3xl bg-white p-5 border border-slate-200/80 shadow-[0_8px_30px_rgba(15,23,42,0.04)] space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3.5">
            <div className="relative shrink-0">
              <img
                src="https://avatars.githubusercontent.com/u/221086467?v=4"
                alt="سعید سالاری - Saeed Salari"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).src = assetUrl('icon-192.png');
                }}
                className="h-14 w-14 rounded-2xl object-cover border border-blue-200 bg-blue-50"
              />
              <span className="absolute -bottom-1 -left-1 flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-white ring-2 ring-white">
                <CheckCircle2 className="h-3 w-3" />
              </span>
            </div>
            <div>
              <span className="inline-flex items-center gap-1 text-[11px] font-extrabold text-blue-600">
                <Award className="h-3.5 w-3.5" />
                خالق، طراح و صاحب امتیاز رسمی اثر
              </span>
              <h2 className="text-base font-black text-slate-900 mt-0.5">
                سعید سالاری{' '}
                <span className="text-xs font-semibold text-slate-400">(Saeed Salari)</span>
              </h2>
              <p className="text-[11px] font-medium text-slate-500 mt-0.5">
                Full-Stack Software Engineer • AI & Computer Vision Architect
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenAboutOwner}
            className="shrink-0 rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-200 cursor-pointer"
          >
            شناسنامه کامل
          </button>
        </div>

        <p className="text-xs leading-7 text-slate-600 text-justify bg-slate-50/80 rounded-2xl p-3.5 border border-slate-200/60">
          اپلیکیشن هوشمند <strong className="text-slate-900">«خریدیـار | KharidYar»</strong> از مرحله
          ایده‌پردازی، طراحی رابط کاربری و موتور بینایی ماشین فارسی تا زیرساخت ابری، به صورت
          انحصاری توسط <strong className="text-slate-900">سعید سالاری</strong> طراحی و توسعه یافته و
          کلیه حقوق مادی و معنوی آن محفوظ است.
        </p>

        <div className="flex flex-wrap items-center gap-2.5">
          <a
            href={OWNER_LINKEDIN_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-2 rounded-2xl bg-[#0A66C2] px-4 py-3 text-xs font-extrabold text-white hover:bg-[#004182] transition"
          >
            <Linkedin className="h-4 w-4 fill-current" />
            ارتباط مستقیم در لینکدین رسمی سعید سالاری
            <ExternalLink className="h-3.5 w-3.5 opacity-80" />
          </a>

          <a
            href={apkDownloadUrl}
            download="KharidYar-v1.0.apk"
            className="inline-flex items-center gap-1.5 rounded-2xl border border-blue-200 bg-blue-50 px-3.5 py-3 text-xs font-bold text-blue-700 hover:bg-blue-100 transition"
          >
            <Download className="h-4 w-4" />
            نسخه اندروید (APK)
          </a>

          <a
            href={assetUrl('privacy.html')}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-xs font-bold text-slate-700 hover:bg-slate-100 transition"
          >
            <FileCheck2 className="h-4 w-4 text-emerald-600" />
            حریم خصوصی
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
              کد اختصاصی همگام‌سازی (موبایل ⇄ وب)
            </h3>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">
            <ShieldCheck className="h-3.5 w-3.5" />
            فضای کاری شخصی
          </span>
        </div>

        <p className="text-xs text-slate-500 leading-relaxed">
          برای مشاهده هم‌زمان فاکتورها و لیست خرید خود در گوشی و مرورگر، این کد را در هر دو دستگاه
          وارد کنید:
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
            ثبت کد
          </button>
        </div>
      </form>

      {/* Optional Cloud Multimodal AI Vision Key */}
      <form
        onSubmit={handleSaveAiKey}
        className="rounded-3xl bg-white p-5 border border-slate-200/80 shadow-[0_8px_30px_rgba(15,23,42,0.04)] space-y-3"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4.5 w-4.5 text-blue-600" />
            <h3 className="text-sm font-extrabold text-slate-900">
              کلید هوش مصنوعی ابری (اختیاری)
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
            placeholder="API Key (اختیاری)"
            value={aiSettings.apiKey}
            onChange={(e) => setAiSettings((s) => ({ ...s, apiKey: e.target.value }))}
            className="sm:col-span-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs font-mono outline-none focus:border-blue-500 focus:bg-white"
          />
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 cursor-pointer"
          >
            ذخیره تنظیمات
          </button>
        </div>
      </form>
    </div>
  );
}
