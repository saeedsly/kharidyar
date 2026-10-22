import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  Camera,
  Check,
  CheckCircle2,
  FolderPlus,
  Plus,
  RotateCcw,
  ShoppingBasket,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { ShoppingItem, ShoppingList } from '../types';
import { formatToman, inferItemCategory, toPersianDigits } from '../lib/persianMatcher';

interface ShoppingListTabProps {
  lists: ShoppingList[];
  activeListId: string;
  items: ShoppingItem[];
  onSelectList: (id: string) => void;
  onCreateList: (title: string, storeHint?: string) => Promise<void>;
  onAddItem: (item: {
    name: string;
    quantity: number;
    unit: string;
    category: string;
  }) => Promise<void>;
  onToggleItem: (item: ShoppingItem) => Promise<void>;
  onDeleteItem: (itemId: string) => Promise<void>;
  onResetList: () => Promise<void>;
  onOpenScannerForList: (sampleId?: string) => void;
}

const UNITS = ['عدد', 'بسته', 'کیلو', 'بطری', 'شانه', 'سطل', 'کیسه'];

const QUICK_SUGGESTIONS = [
  { name: 'شیر کم‌چرب', qty: 2, unit: 'عدد' },
  { name: 'پنیر فتا', qty: 1, unit: 'بسته' },
  { name: 'تخم‌مرغ', qty: 1, unit: 'شانه' },
  { name: 'نان تست', qty: 1, unit: 'بسته' },
  { name: 'روغن مایع', qty: 1, unit: 'بطری' },
  { name: 'گوجه فرنگی', qty: 2, unit: 'کیلو' },
  { name: 'مرغ تازه', qty: 2, unit: 'کیلو' },
  { name: 'ماست یونانی', qty: 1, unit: 'سطل' },
];

export function ShoppingListTab({
  lists,
  activeListId,
  items,
  onSelectList,
  onCreateList,
  onAddItem,
  onToggleItem,
  onDeleteItem,
  onResetList,
  onOpenScannerForList,
}: ShoppingListTabProps) {
  const [newName, setNewName] = useState('');
  const [newQty, setNewQty] = useState(1);
  const [newUnit, setNewUnit] = useState('عدد');
  const [creatingList, setCreatingList] = useState(false);
  const [listTitle, setListTitle] = useState('');
  const [storeHint, setStoreHint] = useState('');

  const checkedCount = items.filter((i) => i.is_checked).length;
  const missingItems = items.filter((i) => !i.is_checked && i.reconcile_status === 'missing');
  const allDone = items.length > 0 && checkedCount === items.length;

  const handleSubmitItem = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newName.trim();
    if (!clean) return;
    await onAddItem({
      name: clean,
      quantity: newQty > 0 ? newQty : 1,
      unit: newUnit,
      category: inferItemCategory(clean),
    });
    setNewName('');
    setNewQty(1);
  };

  const handleCreateNewList = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!listTitle.trim()) return;
    await onCreateList(listTitle.trim(), storeHint.trim() || undefined);
    setListTitle('');
    setStoreHint('');
    setCreatingList(false);
  };

  return (
    <div className="space-y-4 pb-28">
      {/* Horizontal List Switcher Pills */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {lists.map((l) => {
          const active = l.id === activeListId;
          return (
            <button
              key={l.id}
              type="button"
              onClick={() => onSelectList(l.id)}
              className={`shrink-0 rounded-2xl px-4 py-2.5 text-xs font-bold transition cursor-pointer ${
                active
                  ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/20'
                  : 'bg-white text-slate-600 border border-slate-200/80 hover:bg-slate-50'
              }`}
            >
              {l.title}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setCreatingList((v) => !v)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-2xl bg-white px-3.5 py-2.5 text-xs font-semibold text-blue-600 border border-dashed border-blue-300 hover:bg-blue-50 cursor-pointer"
        >
          <FolderPlus className="h-3.5 w-3.5" />
          لیست جدید
        </button>
      </div>

      {/* Create New Shopping List Inline Drawer */}
      <AnimatePresence>
        {creatingList && (
          <motion.form
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            onSubmit={handleCreateNewList}
            className="overflow-hidden rounded-3xl bg-white p-4 border border-blue-200 shadow-xs space-y-3"
          >
            <p className="text-xs font-bold text-slate-800">ساخت لیست خرید جدید</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <input
                type="text"
                placeholder="عنوان لیست (مثلاً خرید مهمانی پنجشنبه)"
                value={listTitle}
                onChange={(e) => setListTitle(e.target.value)}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-blue-500 focus:bg-white"
              />
              <input
                type="text"
                placeholder="فروشگاه (اختیاری - مثلاً شهروند)"
                value={storeHint}
                onChange={(e) => setStoreHint(e.target.value)}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-blue-500 focus:bg-white"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreatingList(false)}
                className="rounded-xl px-3.5 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                انصراف
              </button>
              <button
                type="submit"
                className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 cursor-pointer"
              >
                ایجاد لیست
              </button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {/* Reconcile Header Card — Match Receipt Against Shopping List */}
      <div className="rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.04)] border border-slate-200/70">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
              <ShoppingBasket className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-slate-900">چک‌لیست هوشمند ضد فراموشی</h2>
              <p className="text-xs text-slate-500 mt-0.5 tabular-fa">
                {toPersianDigits(checkedCount)} از {toPersianDigits(items.length)} قلم در سبد خرید
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {checkedCount > 0 && (
              <button
                type="button"
                onClick={onResetList}
                title="ریست تیک‌ها"
                className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                ریست
              </button>
            )}
            <button
              type="button"
              onClick={() => onOpenScannerForList()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-blue-700 cursor-pointer"
            >
              <Camera className="h-3.5 w-3.5" />
              اسکن فاکتور و تیک خودکار
            </button>
          </div>
        </div>

        {/* Missing Items Warning Banner after scanning receipt */}
        {missingItems.length > 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mt-4 rounded-2xl bg-amber-50 border border-amber-200 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-xs font-extrabold text-amber-950">
                    توجه! {toPersianDigits(missingItems.length)} قلم از لیست خریدت جا مونده و توی فاکتور نبود:
                  </h4>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {missingItems.map((m) => (
                      <span
                        key={m.id}
                        className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-xs font-bold text-amber-900 border border-amber-200 shadow-2xs"
                      >
                        • {m.name} ({toPersianDigits(m.quantity)} {m.unit})
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onOpenScannerForList('janbo')}
                className="shrink-0 inline-flex items-center gap-1 rounded-xl bg-amber-600 px-3 py-2 text-[11px] font-bold text-white hover:bg-amber-700 cursor-pointer"
              >
                <Sparkles className="h-3.5 w-3.5" />
                تست فاکتور تکمیلی
              </button>
            </div>
          </motion.div>
        )}

        {/* 100% Complete Celebration Banner */}
        {allDone && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mt-4 flex items-center gap-2.5 rounded-2xl bg-emerald-50 border border-emerald-200 p-3.5 text-xs font-bold text-emerald-900"
          >
            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
            فوق‌العاده! تمام اقلام لیست خرید به صورت کامل خریداری شدند و هیچ چیزی جا نماند.
          </motion.div>
        )}
      </div>

      {/* Add Item Form + 1-Tap Quick Suggestions */}
      <form
        onSubmit={handleSubmitItem}
        className="rounded-3xl bg-white p-4 shadow-[0_8px_30px_rgba(15,23,42,0.04)] border border-slate-200/70 space-y-3"
      >
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
          <input
            type="text"
            placeholder="چی می‌خوای بخری؟ (مثلاً شیر کم‌چرب، پنیر، نان...)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="flex-1 min-w-[180px] rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm font-medium outline-none transition focus:border-blue-500 focus:bg-white"
          />
          <input
            type="number"
            min={0.5}
            step={0.5}
            value={newQty}
            onChange={(e) => setNewQty(Number(e.target.value))}
            className="w-18 rounded-2xl border border-slate-200 bg-slate-50/80 px-2.5 py-3 text-center text-sm font-bold outline-none focus:border-blue-500 focus:bg-white tabular-fa"
          />
          <select
            value={newUnit}
            onChange={(e) => setNewUnit(e.target.value)}
            className="rounded-2xl border border-slate-200 bg-slate-50/80 px-3 py-3 text-sm font-semibold text-slate-700 outline-none focus:border-blue-500 focus:bg-white"
          >
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="inline-flex items-center justify-center gap-1 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-bold text-white transition hover:bg-slate-800 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            افزودن
          </button>
        </div>

        {/* Quick-add common grocery pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pt-0.5">
          <span className="shrink-0 text-[11px] font-semibold text-slate-400 ml-1">افزودن سریع:</span>
          {QUICK_SUGGESTIONS.filter(
            (q) => !items.some((existing) => existing.name === q.name)
          ).map((q) => (
            <button
              key={q.name}
              type="button"
              onClick={() =>
                onAddItem({
                  name: q.name,
                  quantity: q.qty,
                  unit: q.unit,
                  category: inferItemCategory(q.name),
                })
              }
              className="shrink-0 rounded-xl bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-blue-50 hover:text-blue-700 transition cursor-pointer"
            >
              + {q.name}
            </button>
          ))}
        </div>
      </form>

      {/* Shopping Items Checklist */}
      <div className="space-y-2.5">
        {items.map((item) => {
          const isMissing = !item.is_checked && item.reconcile_status === 'missing';
          return (
            <motion.div
              layout
              key={item.id}
              onClick={() => onToggleItem(item)}
              className={`flex items-center justify-between gap-3 rounded-2xl p-4 border transition cursor-pointer select-none ${
                item.is_checked
                  ? 'bg-emerald-50/55 border-emerald-200/80'
                  : isMissing
                  ? 'bg-amber-50/70 border-amber-300 shadow-xs'
                  : 'bg-white border-slate-200/70 hover:border-blue-200'
              }`}
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 transition ${
                    item.is_checked
                      ? 'border-emerald-500 bg-emerald-500 text-white scale-105'
                      : isMissing
                      ? 'border-amber-500 bg-white'
                      : 'border-slate-300 bg-white'
                  }`}
                >
                  {item.is_checked && <Check className="h-4 w-4 stroke-[3]" />}
                </div>

                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`text-sm font-bold ${
                        item.is_checked ? 'line-through text-slate-500' : 'text-slate-900'
                      }`}
                    >
                      {item.name}
                    </span>
                    <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 tabular-fa">
                      {toPersianDigits(item.quantity)} {item.unit}
                    </span>
                    {isMissing && (
                      <span className="rounded-lg bg-amber-200/80 px-2 py-0.5 text-[11px] font-bold text-amber-950">
                        از قلم افتاده!
                      </span>
                    )}
                  </div>

                  {item.is_checked && item.matched_item_name && (
                    <p className="mt-1 text-xs font-medium text-emerald-700 tabular-fa">
                      ✓ تایید شده از فاکتور: {item.matched_item_name}
                      {item.matched_price ? ` — ${formatToman(item.matched_price)}` : ''}
                    </p>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteItem(item.id);
                }}
                className="p-2 rounded-xl text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition cursor-pointer"
                title="حذف قلم"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </motion.div>
          );
        })}

        {items.length === 0 && (
          <div className="rounded-3xl bg-white p-10 text-center border border-slate-200/70">
            <ShoppingBasket className="h-10 w-10 text-slate-300 mx-auto" />
            <p className="mt-3 text-sm font-bold text-slate-700">هنوز قلمی در این لیست ثبت نشده</p>
            <p className="mt-1 text-xs text-slate-400">
              اقلام مورد نیازت رو بالا اضافه کن تا موقع خرید با فاکتور چک بشن.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
