import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowLeft,
  Award,
  CalendarDays,
  Camera,
  CheckCircle2,
  ExternalLink,
  Linkedin,
  ListChecks,
  PiggyBank,
  ReceiptText,
  Sparkles,
  TrendingDown,
  Wallet,
} from 'lucide-react';
import type { Receipt, ShoppingItem, ShoppingList } from '../types';
import { formatCurrency, formatToman, toPersianDigits } from '../lib/persianMatcher';
import { formatMonthKey, getCurrentJalaliMonthKey, receiptDayKey, receiptMonthKey } from '../lib/jalaliDate';
import { OWNER_LINKEDIN_URL } from './AboutOwnerModal';

interface DashboardTabProps {
  receipts: Receipt[];
  activeList: ShoppingList | null;
  activeListItems: ShoppingItem[];
  monthlyBudget: number;
  onSaveMonthlyBudget: (amount: number) => void;
  onOpenScanner: (sampleId?: string) => void;
  onGoToList: () => void;
  onGoToReceipts: () => void;
  onSelectReceipt: (receipt: Receipt) => void;
  onOpenAboutOwner: () => void;
}

const isLiraReceipt = (receipt: Receipt) => /(?:لیر|₺|\bTRY\b|\bTL\b)/i.test(receipt.currency || '');

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
  monthlyBudget,
  onSaveMonthlyBudget,
  onOpenScanner,
  onGoToList,
  onGoToReceipts,
  onSelectReceipt,
  onOpenAboutOwner,
}: DashboardTabProps) {
  const [budgetDraft, setBudgetDraft] = useState(monthlyBudget ? String(monthlyBudget) : '');
  const currentMonthKey = getCurrentJalaliMonthKey();
  const monthLabel = formatMonthKey(currentMonthKey);
  const monthReceipts = receipts.filter(
    (receipt) => receiptMonthKey(receipt.jalali_date || receipt.created_at) === currentMonthKey
  );
  const monthTomanReceipts = monthReceipts.filter((receipt) => !isLiraReceipt(receipt));
  const monthLiraReceipts = monthReceipts.filter(isLiraReceipt);
  const monthlySpent = monthTomanReceipts.reduce((sum, receipt) => sum + Number(receipt.total_amount || 0), 0);
  const monthlyLiraSpent = monthLiraReceipts.reduce((sum, receipt) => sum + Number(receipt.total_amount || 0), 0);
  const monthlyDiscount = monthTomanReceipts.reduce((sum, receipt) => sum + Number(receipt.discount_total || 0), 0);
  const totalSpent = receipts
    .filter((receipt) => !isLiraReceipt(receipt))
    .reduce((sum, receipt) => sum + Number(receipt.total_amount || 0), 0);
  const budgetPercent = monthlyBudget > 0 ? Math.min(100, Math.round((monthlySpent / monthlyBudget) * 100)) : 0;

  useEffect(() => {
    setBudgetDraft(monthlyBudget ? String(monthlyBudget) : '');
  }, [monthlyBudget]);

  const dailyGroups = new Map<
    string,
    { dayKey: string; currency: string; total: number; stores: Set<string>; receiptCount: number }
  >();
  for (const receipt of monthReceipts) {
    const dayKey = receiptDayKey(receipt.jalali_date || receipt.created_at);
    if (!dayKey) continue;
    const currency = isLiraReceipt(receipt) ? 'لیر' : 'تومان';
    const groupKey = `${dayKey}|${currency}`;
    const group = dailyGroups.get(groupKey) || {
      dayKey,
      currency,
      total: 0,
      stores: new Set<string>(),
      receiptCount: 0,
    };
    group.total += Number(receipt.total_amount || 0);
    group.receiptCount += 1;
    group.stores.add(receipt.store_name || 'فروشگاه');
    dailyGroups.set(groupKey, group);
  }
  const recentShoppingDays = [...dailyGroups.entries()]
    .sort((a, b) => b[1].dayKey.localeCompare(a[1].dayKey) || b[0].localeCompare(a[0]))
    .slice(0, 4);

  const checkedItemsCount = activeListItems.filter((i) => i.is_checked).length;
  const missingItems = activeListItems.filter(
    (i) => !i.is_checked && i.reconcile_status === 'missing'
  );
  const listProgress =
    activeListItems.length > 0
      ? Math.round((checkedItemsCount / activeListItems.length) * 100)
      : 0;

  // Aggregate product categories within the selected current Persian month.
  const categoryTotals: Record<string, number> = {};
  for (const r of monthTomanReceipts) {
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
              هزینهٔ خریدهای {monthLabel}
            </span>
            <div className="mt-3 flex items-baseline gap-1.5 tabular-fa">
              <span className="text-3xl font-extrabold tracking-tight text-slate-900">
                {formatToman(monthlySpent, false)}
              </span>
              <span className="text-sm font-medium text-slate-500">تومان</span>
            </div>
            <p className="mt-1 text-[11px] text-slate-500 tabular-fa">
              همهٔ خریدهای تومانی: {formatToman(totalSpent)}
            </p>
            {monthlyLiraSpent > 0 && (
              <p className="mt-1 text-[11px] font-semibold text-slate-600 tabular-fa">
                خریدهای ثبت‌شده به لیر: {formatCurrency(monthlyLiraSpent, 'لیر')}
              </p>
            )}
          </div>

          <div className="text-left">
            <div className="inline-flex items-center gap-1 rounded-2xl bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 tabular-fa">
              <TrendingDown className="h-3.5 w-3.5" />
              تخفیف این ماه: {formatToman(monthlyDiscount, false)}
            </div>
            <p className="mt-1.5 text-xs text-slate-400 tabular-fa">
              {toPersianDigits(monthReceipts.length)} فاکتور در این ماه
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

      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 p-5 text-white shadow-[0_18px_44px_rgba(15,23,42,0.16)]"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold text-blue-100">
              <CalendarDays className="h-3.5 w-3.5" />
              جمع‌بندی ماهانه • {monthLabel}
            </span>
            <p className="mt-3 text-2xl font-black tabular-fa">{formatToman(monthlySpent)}</p>
            <p className="mt-1 text-[11px] text-slate-300">
              {toPersianDigits(monthReceipts.length)} فاکتور؛ خریدهای چند فروشگاه در هر روز با هم جمع شده‌اند.
            </p>
          </div>
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-emerald-300">
            <PiggyBank className="h-6 w-6" />
          </div>
        </div>

        {monthlyBudget > 0 && (
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-3.5">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-bold text-slate-200">بودجهٔ این ماه</span>
              <span className="font-extrabold tabular-fa">
                {formatToman(monthlyBudget, false)} تومان • {toPersianDigits(budgetPercent)}٪ مصرف شده
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className={`h-full rounded-full transition-all ${budgetPercent >= 100 ? 'bg-rose-400' : 'bg-emerald-400'}`}
                style={{ width: `${budgetPercent}%` }}
              />
            </div>
            <p className="mt-2 text-[11px] text-slate-300 tabular-fa">
              {monthlySpent > monthlyBudget
                ? `از بودجه ${formatToman(monthlySpent - monthlyBudget)} بیشتر شده‌ای.`
                : `${formatToman(monthlyBudget - monthlySpent)} تا سقف بودجه باقی مانده.`}
            </p>
          </div>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSaveMonthlyBudget(Number(budgetDraft));
          }}
          className="mt-3 flex gap-2"
        >
          <input
            type="number"
            min="0"
            step="100000"
            value={budgetDraft}
            onChange={(event) => setBudgetDraft(event.target.value)}
            placeholder="بودجهٔ ماهانه به تومان (اختیاری)"
            aria-label="بودجهٔ ماهانه به تومان"
            className="min-w-0 flex-1 rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 text-xs font-bold text-white placeholder:text-slate-400 outline-none focus:border-blue-300"
          />
          <button
            type="submit"
            className="shrink-0 rounded-xl bg-white px-3.5 py-2.5 text-xs font-extrabold text-slate-900 transition hover:bg-blue-50"
          >
            ذخیره بودجه
          </button>
        </form>

        {recentShoppingDays.length > 0 && (
          <div className="mt-4 border-t border-white/10 pt-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-200">خریدهای روزانهٔ این ماه</span>
              <span className="text-[10px] text-slate-400">فاکتورهای همان روز تجمیع شده‌اند</span>
            </div>
            <div className="space-y-2">
              {recentShoppingDays.map(([groupKey, group]) => (
                <div key={groupKey} className="flex items-center justify-between gap-3 rounded-xl bg-white/5 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-xs font-extrabold tabular-fa">{toPersianDigits(group.dayKey.replace(/-/g, '/'))}</p>
                    <p className="mt-0.5 truncate text-[10px] text-slate-400">
                      {group.stores.size > 1
                        ? `${toPersianDigits(group.stores.size)} فروشگاه: ${[...group.stores].join('، ')}`
                        : [...group.stores][0] || 'خرید روزانه'}
                      {group.receiptCount > 1 ? ` • ${toPersianDigits(group.receiptCount)} فاکتور` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs font-black tabular-fa">{formatCurrency(group.total, group.currency)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </motion.section>

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
          <h3 className="text-sm font-bold text-slate-900 mb-3.5">دسته‌بندی خرج‌های {monthLabel}</h3>
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
                  {formatCurrency(rec.total_amount, rec.currency, false)}
                </p>
                <p className="text-[11px] font-medium text-emerald-600">{isLiraReceipt(rec) ? 'لیر' : 'تومان'}</p>
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
