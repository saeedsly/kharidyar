import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Calendar,
  Cpu,
  Eye,
  ReceiptText,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { Receipt } from '../types';
import { formatCurrency, toPersianDigits } from '../lib/persianMatcher';

interface ReceiptsTabProps {
  receipts: Receipt[];
  selectedReceipt: Receipt | null;
  onSelectReceipt: (r: Receipt | null) => void;
  onDeleteReceipt: (id: string) => Promise<void>;
}

export function ReceiptsTab({
  receipts,
  selectedReceipt,
  onSelectReceipt,
  onDeleteReceipt,
}: ReceiptsTabProps) {
  const [query, setQuery] = useState('');
  const [showEnhancedImg, setShowEnhancedImg] = useState(false);

  const filtered = receipts.filter((r) => {
    const q = query.trim();
    if (!q) return true;
    if (r.store_name.includes(q) || (r.jalali_date || '').includes(q)) return true;
    return (r.items || []).some((it) => it.name.includes(q) || it.category.includes(q));
  });

  return (
    <div className="space-y-4 pb-28">
      {/* Search Bar Across Stores & Line Items */}
      <div className="relative">
        <Search className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-slate-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="جستجو در نام فروشگاه یا اقلام داخل فاکتور (مثلاً پنیر، قهوه...)"
          className="w-full rounded-2xl border border-slate-200/80 bg-white pr-11 pl-4 py-3.5 text-sm font-medium outline-none shadow-[0_4px_20px_rgba(15,23,42,0.03)] focus:border-blue-500"
        />
      </div>

      {/* Receipts Feed */}
      <div className="space-y-3">
        {filtered.map((rec) => (
          <motion.div
            layout
            key={rec.id}
            onClick={() => onSelectReceipt(rec)}
            className="rounded-3xl bg-white p-4.5 border border-slate-200/70 shadow-[0_8px_30px_rgba(15,23,42,0.03)] hover:border-blue-300 transition cursor-pointer"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                  <ReceiptText className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-extrabold text-slate-900">{rec.store_name}</h3>
                  <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 tabular-fa">
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" />
                      {toPersianDigits(rec.jalali_date || '۱۴۰۵/۰۸/۰۱')}
                    </span>
                    <span>•</span>
                    <span>{toPersianDigits(rec.items?.length || 0)} قلم</span>
                  </div>
                </div>
              </div>

              <div className="text-left shrink-0">
                <div className="text-base font-extrabold text-slate-900 tabular-fa">
                  {formatCurrency(rec.total_amount, rec.currency)}
                </div>
                {Number(rec.discount_total) > 0 && (
                  <span className="inline-block mt-0.5 rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 tabular-fa">
                    {formatCurrency(rec.discount_total, rec.currency, false)} تخفیف
                  </span>
                )}
              </div>
            </div>

            {/* Item chips preview */}
            {rec.items && rec.items.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {rec.items.slice(0, 5).map((it, idx) => (
                  <span
                    key={it.id || idx}
                    className="rounded-xl bg-slate-100/90 px-2.5 py-1 text-[11px] font-medium text-slate-700 tabular-fa"
                  >
                    {it.name} ({toPersianDigits(it.quantity)})
                  </span>
                ))}
                {rec.items.length > 5 && (
                  <span className="rounded-xl bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-600 tabular-fa">
                    +{toPersianDigits(rec.items.length - 5)} قلم دیگر
                  </span>
                )}
              </div>
            )}
          </motion.div>
        ))}

        {filtered.length === 0 && (
          <div className="rounded-3xl bg-white p-10 text-center border border-slate-200/70">
            <ReceiptText className="h-10 w-10 text-slate-300 mx-auto" />
            <p className="mt-3 text-sm font-bold text-slate-700">فاکتوری با این مشخصات پیدا نشد</p>
          </div>
        )}
      </div>

      {/* Full Digital Receipt Detail Sheet Modal */}
      <AnimatePresence>
        {selectedReceipt && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => onSelectReceipt(null)}
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/45 backdrop-blur-xs p-0 sm:p-4"
          >
            <motion.div
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg max-h-[88vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-white p-5 shadow-2xl space-y-4"
            >
              <div className="flex items-start justify-between border-b border-slate-100 pb-3.5">
                <div>
                  <span className="rounded-lg bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700">
                    {selectedReceipt.store_category}
                  </span>
                  <h3 className="mt-2 text-lg font-extrabold text-slate-900">
                    {selectedReceipt.store_name}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5 tabular-fa">
                    تاریخ: {toPersianDigits(selectedReceipt.jalali_date || '۱۴۰۵/۰۸/۰۱')}
                    {selectedReceipt.receipt_number ? ` • کد: ${selectedReceipt.receipt_number}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onSelectReceipt(null)}
                  className="rounded-full p-2 bg-slate-100 text-slate-600 hover:bg-slate-200 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* OCR Engine telemetry pill */}
              <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <Cpu className="h-4 w-4 text-blue-600" />
                  پردازش آفلاین
                </span>
                <span className="font-bold text-emerald-600 tabular-fa">
                  اطمینان خوانش: {toPersianDigits(selectedReceipt.ocr_confidence ?? 0)}٪
                </span>
              </div>

              {/* Scanned receipt image preview */}
              {(selectedReceipt.image_url || selectedReceipt.processed_image_url) && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700">تصویر اسکن‌شده فاکتور</span>
                    {selectedReceipt.processed_image_url && selectedReceipt.image_url && (
                      <button
                        type="button"
                        onClick={() => setShowEnhancedImg((v) => !v)}
                        className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-600 cursor-pointer"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        {showEnhancedImg ? 'نمایش عکس اصلی' : 'نمایش تصویر پردازش‌شده'}
                      </button>
                    )}
                  </div>
                  <img
                    src={
                      showEnhancedImg
                        ? selectedReceipt.processed_image_url || selectedReceipt.image_url || ''
                        : selectedReceipt.image_url || selectedReceipt.processed_image_url || ''
                    }
                    alt={selectedReceipt.store_name}
                    className="max-h-60 w-full rounded-2xl object-contain bg-slate-100 border border-slate-200 p-2"
                  />
                </div>
              )}

              {/* Itemized Rows */}
              <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200/80 overflow-hidden">
                <div className="grid grid-cols-12 bg-slate-50 px-3.5 py-2.5 text-[11px] font-bold text-slate-500">
                  <div className="col-span-6">نام کالا</div>
                  <div className="col-span-2 text-center">تعداد</div>
                  <div className="col-span-4 text-left">مبلغ کل</div>
                </div>
                {(selectedReceipt.items || []).map((item, idx) => (
                  <div
                    key={item.id || idx}
                    className="grid grid-cols-12 items-center px-3.5 py-3 text-xs tabular-fa"
                  >
                    <div className="col-span-6 font-bold text-slate-800 pl-2">
                      {item.name}
                      <span className="block text-[10px] font-normal text-slate-400">
                        فی: {formatCurrency(item.unit_price, selectedReceipt.currency, false)}
                      </span>
                    </div>
                    <div className="col-span-2 text-center font-semibold text-slate-600">
                      {toPersianDigits(item.quantity)} {item.unit}
                    </div>
                    <div className="col-span-4 text-left font-extrabold text-slate-900">
                      {formatCurrency(item.total_price, selectedReceipt.currency, false)}
                    </div>
                  </div>
                ))}
              </div>

              {/* Totals Footer */}
              <div className="space-y-2 rounded-2xl bg-slate-50 p-4 text-xs tabular-fa">
                <div className="flex justify-between text-slate-600">
                  <span>جمع اقلام:</span>
                  <span className="font-semibold">{formatCurrency(selectedReceipt.subtotal, selectedReceipt.currency)}</span>
                </div>
                {Number(selectedReceipt.discount_total) > 0 && (
                  <div className="flex justify-between text-emerald-700 font-semibold">
                    <span>تخفیف فروشگاه:</span>
                    <span>{formatCurrency(selectedReceipt.discount_total, selectedReceipt.currency)}-</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-slate-200 pt-2.5 text-sm font-extrabold text-slate-900">
                  <span>مبلغ نهایی پرداخت‌شده:</span>
                  <span className="text-blue-600">{formatCurrency(selectedReceipt.total_amount, selectedReceipt.currency)}</span>
                </div>
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={async () => {
                    await onDeleteReceipt(selectedReceipt.id);
                    onSelectReceipt(null);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 cursor-pointer"
                >
                  <Trash2 className="h-4 w-4" />
                  حذف این فاکتور
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
