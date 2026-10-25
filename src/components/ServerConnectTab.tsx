import { useRef, useState } from 'react';
import {
  AlertTriangle,
  Download,
  FileJson2,
  HardDrive,
  LockKeyhole,
  ShieldCheck,
  Smartphone,
  Trash2,
  Upload,
} from 'lucide-react';
import type { LocalAppData } from '../lib/localStore';
import type { Receipt, ShoppingItem, ShoppingList } from '../types';
import { formatToman, toPersianDigits } from '../lib/persianMatcher';

interface ServerConnectTabProps {
  lists: ShoppingList[];
  items: ShoppingItem[];
  receipts: Receipt[];
  monthlyBudget: number;
  onExportBackup: () => void;
  onImportBackup: (data: LocalAppData, budget?: number) => void;
  onClearAllUserData: () => Promise<void>;
  onOpenPrivacy: () => void;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isObjectArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every(isObject);
}

function readFileAsText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('فایل پشتیبان خوانده نشد.'));
    reader.readAsText(file);
  });
}

export function ServerConnectTab({
  lists,
  items,
  receipts,
  monthlyBudget,
  onExportBackup,
  onImportBackup,
  onClearAllUserData,
  onOpenPrivacy,
}: ServerConnectTabProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const parsed: unknown = JSON.parse(await readFileAsText(file));
      if (!isObject(parsed) || parsed.app !== 'KharidYar' || !isObject(parsed.data)) {
        throw new Error('این فایل، نسخهٔ پشتیبان معتبر خریدیـار نیست.');
      }
      const listsData = parsed.data.lists;
      const itemsData = parsed.data.items;
      const receiptsData = parsed.data.receipts;
      if (!isObjectArray(listsData) || !isObjectArray(itemsData) || !isObjectArray(receiptsData)) {
        throw new Error('ساختار فایل پشتیبان کامل نیست.');
      }

      const validLists = listsData.every((entry) => typeof entry.id === 'string' && typeof entry.title === 'string');
      const validItems = itemsData.every(
        (entry) => typeof entry.id === 'string' && typeof entry.list_id === 'string' && typeof entry.name === 'string'
      );
      const validReceipts = receiptsData.every(
        (entry) => typeof entry.id === 'string' && typeof entry.store_name === 'string' && Array.isArray(entry.items)
      );
      if (!validLists || !validItems || !validReceipts) {
        throw new Error('اطلاعات داخل پشتیبان قابل‌شناسایی نیست.');
      }

      if (!window.confirm('اطلاعات فعلی این دستگاه با اطلاعات فایل پشتیبان جایگزین می‌شود. ادامه می‌دهی؟')) {
        return;
      }

      onImportBackup(
        {
          lists: listsData as unknown as ShoppingList[],
          items: itemsData as unknown as ShoppingItem[],
          receipts: receiptsData as unknown as Receipt[],
        },
        Number(parsed.monthlyBudget || 0)
      );
      setMessage('پشتیبان با موفقیت بازیابی شد.');
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'فایل پشتیبان باز نشد.');
    } finally {
      setBusy(false);
    }
  };

  const handleClearData = async () => {
    if (!window.confirm('همهٔ لیست‌ها، فاکتورها و بودجهٔ ذخیره‌شده روی این دستگاه پاک شوند؟')) return;
    setBusy(true);
    try {
      await onClearAllUserData();
      setMessage('اطلاعات این دستگاه پاک شد.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 pb-28">
      <section className="rounded-3xl bg-gradient-to-br from-emerald-700 via-emerald-800 to-slate-900 p-5 text-white shadow-[0_16px_40px_rgba(15,23,42,0.16)]">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/10">
            <ShieldCheck className="h-6 w-6 text-emerald-200" />
          </div>
          <div>
            <h2 className="text-base font-black">خریدیـار، روی همین دستگاه</h2>
            <p className="mt-1.5 text-xs leading-6 text-emerald-50/90">
              خواندن فاکتور و ذخیرهٔ خرید بدون اینترنت انجام می‌شود. تصویر فاکتور به سرور فرستاده نمی‌شود.
            </p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-2xl bg-white/10 px-2 py-3">
            <span className="block text-lg font-black tabular-fa">{toPersianDigits(receipts.length)}</span>
            <span className="mt-1 block text-[10px] text-emerald-100">فاکتور</span>
          </div>
          <div className="rounded-2xl bg-white/10 px-2 py-3">
            <span className="block text-lg font-black tabular-fa">{toPersianDigits(items.length)}</span>
            <span className="mt-1 block text-[10px] text-emerald-100">قلم در لیست‌ها</span>
          </div>
          <div className="rounded-2xl bg-white/10 px-2 py-3">
            <span className="block truncate text-sm font-black tabular-fa">{monthlyBudget ? formatToman(monthlyBudget, false) : '—'}</span>
            <span className="mt-1 block text-[10px] text-emerald-100">بودجهٔ ماهانه</span>
          </div>
        </div>
      </section>

      {(message || error) && (
        <div className={`rounded-2xl border px-4 py-3 text-xs font-bold ${error ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
          {error || message}
        </div>
      )}

      <section className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
        <div className="flex items-center gap-2">
          <HardDrive className="h-5 w-5 text-blue-600" />
          <h3 className="text-sm font-extrabold text-slate-900">پشتیبان‌گیری و انتقال گوشی</h3>
        </div>
        <p className="mt-2 text-xs leading-6 text-slate-500">
          برای حفظ خریدها پیش از حذف برنامه یا جابه‌جایی گوشی، یک فایل پشتیبان بساز و آن را در جای امن نگه دار. به‌روزرسانی معمول برنامه با همان امضای قبلی، داده‌های محلی را نگه می‌دارد.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={onExportBackup}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-xs font-extrabold text-white shadow-sm shadow-blue-600/20 transition hover:bg-blue-700"
          >
            <Download className="h-4 w-4" />
            ذخیرهٔ فایل پشتیبان
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-extrabold text-slate-800 transition hover:bg-slate-100 disabled:opacity-50"
          >
            <Upload className="h-4 w-4" />
            بازیابی از پشتیبان
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleImport}
            className="hidden"
          />
        </div>
        <div className="mt-3 flex items-start gap-2 rounded-2xl bg-amber-50 p-3 text-[11px] leading-5 text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>حذف برنامه یا پاک‌کردن داده‌های Android می‌تواند اطلاعات همان گوشی را پاک کند. قبل از نصب مجدد، فایل پشتیبان بگیر.</span>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
        <div className="flex items-center gap-2">
          <LockKeyhole className="h-5 w-5 text-emerald-600" />
          <h3 className="text-sm font-extrabold text-slate-900">حریم خصوصی و سازگاری</h3>
        </div>
        <div className="mt-3 space-y-2.5 text-xs leading-6 text-slate-600">
          <p className="flex gap-2"><ShieldCheck className="mt-1 h-4 w-4 shrink-0 text-emerald-600" />تصویر فاکتور روی دستگاه پردازش می‌شود و به اینترنت فرستاده نمی‌شود.</p>
          <p className="flex gap-2"><Smartphone className="mt-1 h-4 w-4 shrink-0 text-blue-600" />سازگار با Android 7 تا 15.</p>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onOpenPrivacy}
            className="rounded-xl bg-slate-100 px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200"
          >
            جزئیات حریم خصوصی
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleClearData()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            پاک‌کردن اطلاعات این گوشی
          </button>
        </div>
      </section>
      <div className="flex items-center justify-center gap-2 pb-2 text-[10px] text-slate-400">
        <FileJson2 className="h-3.5 w-3.5" />
        نسخهٔ پشتیبان فقط یک فایل JSON محلی است و هیچ حساب یا سروری لازم ندارد.
      </div>
    </div>
  );
}
