import { motion, AnimatePresence } from 'framer-motion';
import {
  Award,
  CheckCircle2,
  ExternalLink,
  FileCheck2,
  Github,
  Linkedin,
  Lock,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { assetUrl } from '../lib/assetUrl';

export const OWNER_LINKEDIN_URL = 'https://www.linkedin.com/in/saeed-salariy/';
export const OWNER_GITHUB_URL = 'https://github.com/saeedsly';
export const PUBLIC_APP_URL = 'https://saeedsly.github.io/kharidyar/';

interface AboutOwnerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onClearAllUserData: () => Promise<void>;
}

export function AboutOwnerModal({
  isOpen,
  onClose,
  onClearAllUserData,
}: AboutOwnerModalProps) {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/55 backdrop-blur-xs p-0 sm:p-4"
      >
        <motion.div
          initial={{ y: 36, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 36, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-xl max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-[#F6F8FC] border border-slate-200 shadow-2xl"
        >
          {/* Sticky Header */}
          <div className="sticky top-0 z-10 flex items-center justify-between bg-white/95 backdrop-blur-md px-5 py-4 border-b border-slate-200/80">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-white">
                <Award className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-extrabold text-slate-900">
                  درباره سازنده، مالکیت معنوی و حریم خصوصی
                </h2>
                <p className="text-[11px] text-slate-500">
                  شناسنامه رسمی اپلیکیشن هوشمند «خریدیـار» (KharidYar)
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="rounded-full bg-slate-100 p-2 text-slate-600 hover:bg-slate-200 cursor-pointer"
            >
              <X className="h-4.5 w-4.5" />
            </button>
          </div>

          <div className="p-5 space-y-4">
            {/* Executive Creator Profile & Bio Card */}
            <div className="rounded-3xl bg-white p-6 border border-slate-200/80 shadow-[0_10px_30px_rgba(15,23,42,0.04)] space-y-4">
              <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 text-center sm:text-right">
                <div className="relative shrink-0">
                  <img
                    src="https://avatars.githubusercontent.com/u/221086467?v=4"
                    alt="سعید سالاری - Saeed Salari"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).src = assetUrl('icon-192.png');
                    }}
                    className="h-20 w-20 rounded-3xl object-cover border-2 border-blue-100 shadow-sm bg-blue-50"
                  />
                  <span
                    title="صاحب امتیاز تایید شده"
                    className="absolute -bottom-1 -left-1 flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-white ring-2 ring-white"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                  </span>
                </div>

                <div className="flex-1 space-y-1.5">
                  <span className="inline-block rounded-full bg-blue-50 px-3 py-1 text-[11px] font-extrabold text-blue-700">
                    بنیان‌گذار، معمار نرم‌افزار و صاحب امتیاز اثر
                  </span>
                  <h3 className="text-xl font-black text-slate-900">
                    سعید سالاری{' '}
                    <span className="text-sm font-bold text-slate-400">(Saeed Salari)</span>
                  </h3>
                  <p className="text-xs font-semibold text-blue-600">
                    Full-Stack Software Engineer • AI & Computer Vision Product Architect
                  </p>
                </div>
              </div>

              {/* Executive Bio Copy */}
              <div className="rounded-2xl bg-slate-50/90 border border-slate-200/60 p-4 text-xs leading-7 text-slate-700 text-justify">
                <strong className="text-slate-900">سعید سالاری</strong> مهندس نرم‌افزار فول‌استک،
                طراح محصول و خالق اپلیکیشن هوشمند <strong className="text-slate-900">«خریدیـار»</strong>{' '}
                است؛ متخصص در طراحی و مهندسی سامانه‌های مدرن مبتنی بر هوش مصنوعی، بینایی ماشین
                (Computer Vision) و معماری ابری بلادرنگ. چشم‌انداز او در خلق «خریدیـار»، تبدیل
                فرآیند سنتی و پرخطای بررسی فاکتورهای خرید به یک تجربه دیجیتال آنی، دقیق و
                مینیمال است؛ محصولی که از ایده، تجربه کاربری (UX/UI) و موتور عصبی دوزبانه خوانش
                فاکتور تا زیرساخت ابری، به صورت یکپارچه توسط ایشان طراحی و توسعه یافته است.
              </div>

              {/* Direct LinkedIn Primary CTA Button */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                <a
                  href={OWNER_LINKEDIN_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="sm:col-span-2 flex items-center justify-center gap-2.5 rounded-2xl bg-[#0A66C2] px-5 py-3.5 text-xs font-extrabold text-white shadow-sm shadow-blue-900/15 hover:bg-[#004182] transition"
                >
                  <Linkedin className="h-4.5 w-4.5 fill-current" />
                  <span>ارتباط مستقیم در لینکدین رسمی (Saeed Salari)</span>
                  <ExternalLink className="h-3.5 w-3.5 opacity-80" />
                </a>

                <a
                  href={OWNER_GITHUB_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3.5 text-xs font-bold text-white hover:bg-slate-800 transition"
                >
                  <Github className="h-4 w-4" />
                  <span>پروفایل GitHub</span>
                </a>
              </div>
            </div>

            {/* Official Intellectual Property & Legal Ownership Notice */}
            <div className="rounded-3xl bg-white p-5 border border-slate-200/80 space-y-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-emerald-600" />
                <h4 className="text-sm font-extrabold text-slate-900">
                  بیانیه رسمی مالکیت مادی، معنوی و حقوق انحصاری اثر
                </h4>
              </div>

              <p className="text-xs leading-7 text-slate-600 text-justify">
                تمامی حقوق مادی، معنوی و مالکیت فکری نرم‌افزار وب و موبایل{' '}
                <strong className="text-slate-900">«خریدیـار | KharidYar»</strong> — اعم از نام و
                نشان تجاری، طراحی رابط و تجربه کاربری، کدهای منبع کلاینت و سرور، پایپ‌لاین بینایی
                ماشین و الگوریتم‌های تطبیق هوشمند لیست خرید — به صورت انحصاری متعلق به{' '}
                <strong className="text-slate-900">سعید سالاری (Saeed Salari)</strong> می‌باشد.
                استفاده شخصی کاربران از سامانه کاملاً آزاد و رایگان است، اما هرگونه تکثیر تجاری،
                مهندسی معکوس یا بازنشر با نام دیگر بدون مجوز کتبی صاحب اثر پیگرد قانونی دارد.
              </p>

              <div
                dir="ltr"
                className="rounded-xl bg-slate-50 border border-slate-200/70 px-3.5 py-2.5 text-[11px] font-medium text-slate-500 text-center"
              >
                © 2026 <strong>Saeed Salari</strong>. All Rights Reserved. Official Intellectual
                Property of KharidYar™ (`com.saeedsalari.kharidyar`).
              </div>
            </div>

            {/* Google Play Data Safety, Privacy Policy & Instant User Data Deletion */}
            <div className="rounded-3xl bg-white p-5 border border-slate-200/80 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <Lock className="h-4.5 w-4.5 text-blue-600" />
                  <h4 className="text-xs font-extrabold text-slate-900">
                    استاندارد امنیت داده و حریم خصوصی Google Play
                  </h4>
                </div>

                <a
                  href={assetUrl('privacy.html')}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-xl bg-blue-50 px-3 py-1.5 text-[11px] font-bold text-blue-700 hover:bg-blue-100"
                >
                  <FileCheck2 className="h-3.5 w-3.5" />
                  مشاهده سند رسمی Privacy Policy
                </a>
              </div>

              <p className="text-xs leading-relaxed text-slate-500">
                دسترسی دوربین صرفاً در لحظه اسکن فاکتور با اراده کاربر فعال می‌شود. اطلاعات لیست
                خرید و فاکتورها در فضای کاری اختصاصی شما نگهداری شده و هر زمان اراده کنید می‌توانید
                کل داده‌های خود را به صورت دائمی پاک‌سازی نمایید:
              </p>

              <div className="pt-1 flex justify-end">
                <button
                  type="button"
                  onClick={async () => {
                    if (
                      window.confirm(
                        'آیا از حذف دائمی تمام فاکتورها و لیست‌های خرید فضای کاری خود اطمینان دارید؟'
                      )
                    ) {
                      await onClearAllUserData();
                      onClose();
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100 cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  حذف کامل اطلاعات من (Data Deletion)
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
