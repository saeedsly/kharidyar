import { motion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowLeft,
  Award,
  Camera,
  CheckCircle2,
  ExternalLink,
  Linkedin,
  ListChecks,
  ReceiptText,
  Sparkles,
  TrendingDown,
  Wallet,
} from 'lucide-react';
import type { Receipt, ShoppingItem, ShoppingList } from '../types';
import { formatToman, toPersianDigits } from '../lib/persianMatcher';
import { OWNER_LINKEDIN_URL } from './AboutOwnerModal';

interface DashboardTabProps {
  receipts: Receipt[];
  activeList: ShoppingList | null;
  activeListItems: ShoppingItem[];
  onOpenScanner: (sampleId?: string) => void;
  onGoToList: () => void;
  onGoToReceipts: () => void;
  onSelectReceipt: (receipt: Receipt) => void;
  onOpenAboutOwner: () => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  لبنیات: 'bg-blue-500',
  پروتئین: 'bg-rose-500',
  خواربار: 'bg-amber-500',
  'نان و غلات': 'bg-orange-500',
  'میوه و سبزیجات': 'bg-emerald-500',
  نوشیدنی: 'bg-violet-500',
  تنقلات: 'bg-pink-500',
  'شوینده و بهداشتی': 'bg-cyan-500',
};

export function DashboardTab({
  receipts,
  activeList,
  activeListItems,
  onOpenScanner,
  onGoToList,
  onGoToReceipts,
  onSelectReceipt,
  onOpenAboutOwner,
}: DashboardTabProps) {
  const totalSpent = receipts.reduce((sum, r) => sum + Number(r.total_amount || 0), 0);
  const totalSaved = receipts.reduce((sum, r) => sum + Number(r.discount_total || 0), 0);

  const checkedItemsCount = activeListItems.filter((i) => i.is_checked).length;
  const missingItems = activeListItems.filter(
    (i) => !i.is_checked && i.reconcile_status === 'missing'
  );
  const listProgress =
    activeListItems.length > 0
      ? Math.round((checkedItemsCount / activeListItems.length) * 100)
      : 0;

  // Aggregate spending by product category across all scanned receipts
  const categoryTotals: Record<string, number> = {};
  for (const r of receipts) {
    for (const item of r.items || []) {
      const cat = item.category || 'خواربار';
      categoryTotals[cat] = (categoryTotals[cat] || 0) + Number(item.total_price || 0);
    }
  }
  const sortedCategories = Object.entries(categoryTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);
  const maxCatSum = sortedCategories[0]?.[1] || 1;

  return (
    <div className="space-y-4 pb-28">
      {/* Main Clean Hero Spend & Scan Action Card */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.04)] border border-slate-200/70"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
              <Wallet className="h-3.5 w-3.5" />
              مجموع خریدهای ثبت‌شده
            </span>
            <div className="mt-3 flex items-baseline gap-1.5 tabular-fa">
              <span className="text-3xl font-extrabold tracking-tight text-slate-900">
                {formatToman(totalSpent, false)}
              </span>
              <span className="text-sm font-medium text-slate-500">تومان</span>
            </div>
          </div>

          <div className="text-left">
            <div className="inline-flex items-center gap-1 rounded-2xl bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 tabular-fa">
              <TrendingDown className="h-3.5 w-3.5" />
              سود تخفیف: {formatToman(totalSaved, false)}
            </div>
            <p className="mt-1.5 text-xs text-slate-400 tabular-fa">
              {toPersianDigits(receipts.length)} فاکتور دیجیتال آرشیو شده
            </p>
          </div>
        </div>

        {/* Primary Quick Camera Scan CTA + Instant Demo Trigger */}
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => onOpenScanner()}
            className="flex items-center justify-center gap-2.5 rounded-2xl bg-blue-600 px-4 py-3.5 text-sm font-bold text-white shadow-sm shadow-blue-600/20 transition hover:bg-blue-700 active:scale-[0.99] cursor-pointer"
          >
            <Camera className="h-4.5 w-4.5" />
            اسکن فاکتور با دوربین
          </button>

          <button
            type="button"
            onClick={() => onOpenScanner('ofogh')}
            className="flex items-center justify-center gap-2 rounded-2xl bg-slate-100 px-4 py-3.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-200/80 active:scale-[0.99] cursor-pointer"
          >
            <Sparkles className="h-4 w-4 text-blue-600" />
            تست زنده اسکنر هوشمند
          </button>
        </div>
      </motion.div>

      {/* Active Smart Shopping List Status & Missing Items Radar */}
      {activeList && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          onClick={onGoToList}
          className="rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.04)] border border-slate-200/70 transition hover:border-blue-300 cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                <ListChecks className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">{activeList.title}</h3>
                <p className="text-xs text-slate-500 mt-0.5 tabular-fa">
                  {toPersianDigits(checkedItemsCount)} از {toPersianDigits(activeListItems.length)}{' '}
                  قلم خریداری شده ({toPersianDigits(listProgress)}٪)
                </p>
              </div>
            </div>

            <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600">
              مشاهده چک‌لیست
              <ArrowLeft className="h-3.5 w-3.5" />
            </span>
          </div>

          {/* Sleek Apple-style progress bar */}
          <div className="mt-3.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-500"
              style={{ width: `${listProgress}%` }}
            />
          </div>

          {missingItems.length > 0 && (
            <div className="mt-3.5 flex items-start gap-2.5 rounded-2xl bg-amber-50/90 border border-amber-200/80 p-3 text-xs text-amber-900">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
              <div>
                <span className="font-bold">
                  {toPersianDigits(missingItems.length)} قلم از لیست در آخرین فاکتور نبود:{' '}
                </span>
                <span className="font-medium text-amber-800">
                  {missingItems.map((m) => m.name).join('، ')}
                </span>
              </div>
            </div>
          )}

          {activeListItems.length > 0 && checkedItemsCount === activeListItems.length && (
            <div className="mt-3.5 flex items-center gap-2 rounded-2xl bg-emerald-50 border border-emerald-200/70 p-3 text-xs font-semibold text-emerald-800">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
              عالی! تمام اقلام این لیست خرید به صورت کامل خریداری شده‌اند.
            </div>
          )}
        </motion.div>
      )}

      {/* Category Spending Breakdown */}
      {sortedCategories.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.04)] border border-slate-200/70"
        >
          <h3 className="text-sm font-bold text-slate-900 mb-3.5">تفکیک هوشمند دسته‌بندی خریدها</h3>
          <div className="space-y-3">
            {sortedCategories.map(([cat, amount]) => {
              const pct = Math.max(8, Math.round((amount / maxCatSum) * 100));
              const barColor = CATEGORY_COLORS[cat] || 'bg-blue-500';
              return (
                <div key={cat} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-700">{cat}</span>
                    <span className="font-bold text-slate-900 tabular-fa">{formatToman(amount)}</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${barColor} transition-all duration-500`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* Recent Scanned Receipts */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.14 }}
        className="rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.04)] border border-slate-200/70"
      >
        <div className="flex items-center justify-between mb-3.5">
          <h3 className="text-sm font-bold text-slate-900">آخرین فاکتورهای اسکن‌شده</h3>
          <button
            type="button"
            onClick={onGoToReceipts}
            className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700 cursor-pointer"
          >
            همه فاکتورها
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="space-y-2.5">
          {receipts.slice(0, 4).map((rec) => (
            <button
              key={rec.id}
              type="button"
              onClick={() => onSelectReceipt(rec)}
              className="w-full flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50/70 p-3.5 text-right transition hover:bg-blue-50/40 hover:border-blue-200 cursor-pointer"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-blue-600 shadow-xs border border-slate-100">
                  <ReceiptText className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-900">{rec.store_name}</p>
                  <p className="text-xs text-slate-500 mt-0.5 tabular-fa">
                    {toPersianDigits(rec.jalali_date || '۱۴۰۵/۰۸/۰۱')} •{' '}
                    {toPersianDigits(rec.items?.length || 0)} قلم کالا
                  </p>
                </div>
              </div>
              <div className="text-left shrink-0 mr-2">
                <p className="text-sm font-extrabold text-slate-900 tabular-fa">
                  {formatToman(rec.total_amount, false)}
                </p>
                <p className="text-[11px] font-medium text-emerald-600">تومان</p>
              </div>
            </button>
          ))}
        </div>
      </motion.div>

      {/* Executive Creator Signature, Ownership Notice & Direct LinkedIn Card */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.18 }}
        className="rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.04)] border border-slate-200/70 space-y-3"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
              <Award className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-bold text-blue-600">طراحی، توسعه و مالکیت انحصاری اثر</p>
              <h3 className="text-sm font-black text-slate-900 truncate">
                سعید سالاری <span className="font-semibold text-slate-400">(Saeed Salari)</span>
              </h3>
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenAboutOwner}
            className="shrink-0 rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-200 transition cursor-pointer"
          >
            بیوگرافی و مالکیت
          </button>
        </div>

        <p className="text-xs leading-relaxed text-slate-600">
          مهندس نرم‌افزار فول‌استک و معمار سیستم‌های هوشمند بینایی ماشین؛ خالق و صاحب امتیاز رسمی
          اپلیکیشن «خریدیـار». کلیه حقوق مادی و معنوی این نرم‌افزار محفوظ است.
        </p>

        <a
          href={OWNER_LINKEDIN_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full flex items-center justify-center gap-2 rounded-2xl bg-[#0A66C2] px-4 py-3 text-xs font-extrabold text-white shadow-xs hover:bg-[#004182] transition"
        >
          <Linkedin className="h-4 w-4 fill-current" />
          <span>مشاهده پروفایل رسمی سعید سالاری در لینکدین</span>
          <ExternalLink className="h-3.5 w-3.5 opacity-80" />
        </a>
      </motion.div>
    </div>
  );
}
