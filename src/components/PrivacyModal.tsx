import { motion, AnimatePresence } from 'framer-motion';
import { ExternalLink, Linkedin, LockKeyhole, ShieldCheck, Trash2, X } from 'lucide-react';

const OWNER_LINKEDIN_URL = 'https://www.linkedin.com/in/saeed-salariy/';
import { assetUrl } from '../lib/assetUrl';

interface PrivacyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onClearAllUserData: () => Promise<void>;
}

export function PrivacyModal({ isOpen, onClose, onClearAllUserData }: PrivacyModalProps) {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/55 backdrop-blur-sm p-0 sm:p-4"
      >
        <motion.div
          initial={{ y: 36, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 36, opacity: 0 }}
          onClick={(event) => event.stopPropagation()}
          className="w-full max-w-lg rounded-t-3xl sm:rounded-3xl bg-[#F6F8FC] border border-slate-200 shadow-2xl"
        >
          <div className="flex items-center justify-between bg-white px-5 py-4 rounded-t-3xl border-b border-slate-200/80">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                <LockKeyhole className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-extrabold text-slate-900">حریم خصوصی</h2>
                <p className="text-[11px] text-slate-500">اطلاعات خرید محلی می‌ماند؛ OCR ابری اختیاری است.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="بستن"
              className="rounded-full bg-slate-100 p-2 text-slate-600 hover:bg-slate-200 cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="p-5 space-y-4">
            <div className="rounded-2xl bg-white p-4 border border-slate-200/80 space-y-3">
              <p className="flex items-start gap-2 text-xs leading-6 text-slate-600">
                <ShieldCheck className="mt-1 h-4 w-4 shrink-0 text-emerald-600" />
                فاکتورها و فهرست‌ها روی دستگاه ذخیره می‌شوند. اگر OCR ابری را در پنجرهٔ اسکن روشن کنی، تصویر برای تشخیص متن به Microsoft Azure فرستاده می‌شود؛ با خاموش‌کردن آن، تصویر از دستگاه خارج نمی‌شود.
              </p>
              <a
                href={assetUrl('privacy.html')}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex rounded-xl bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100"
              >
                سیاست حریم خصوصی
              </a>
            </div>

            <div className="rounded-2xl bg-white p-4 border border-slate-200/80">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-extrabold text-slate-900">سعید سالاری</p>
                  <p className="mt-1 text-[11px] leading-5 text-slate-500">
                    سازنده و صاحب اثر خریدیـار · کلیهٔ حقوق مادی و معنوی محفوظ است.
                  </p>
                </div>
                <a
                  href={OWNER_LINKEDIN_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="پروفایل لینکدین سعید سالاری"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-blue-50 px-3 py-2 text-[11px] font-bold text-blue-700 hover:bg-blue-100"
                >
                  <Linkedin className="h-3.5 w-3.5" />
                  لینکدین
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <p dir="ltr" className="mt-3 border-t border-slate-100 pt-2 text-center text-[10px] text-slate-400">
                © 2026 Saeed Salari. All rights reserved.
              </p>
            </div>

            <button
              type="button"
              onClick={async () => {
                if (window.confirm('همهٔ فاکتورها، فهرست‌ها و بودجهٔ ذخیره‌شده روی این دستگاه حذف شوند؟')) {
                  await onClearAllUserData();
                  onClose();
                }
              }}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700 hover:bg-rose-100 cursor-pointer"
            >
              <Trash2 className="h-4 w-4" />
              حذف همهٔ اطلاعات این دستگاه
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
