const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

function toEnglishDigits(input: string): string {
  return input.replace(/[۰-۹٠-٩]/g, (digit) => {
    const persian = PERSIAN_DIGITS.indexOf(digit);
    return String(persian >= 0 ? persian : ARABIC_DIGITS.indexOf(digit));
  });
}

function toPersianDigits(input: string): string {
  return input.replace(/\d/g, (digit) => PERSIAN_DIGITS[Number(digit)]);
}

const GREGORIAN_DAYS_BEFORE_MONTH = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
const PERSIAN_MONTHS = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
];

export interface JalaliDateParts {
  year: number;
  month: number;
  day: number;
}

export function gregorianToJalali(year: number, month: number, day: number): JalaliDateParts {
  let jy = 0;
  let gy = year;
  if (gy > 1600) {
    jy = 979;
    gy -= 1600;
  } else {
    jy = 0;
    gy -= 621;
  }

  const gy2 = month > 2 ? gy + 1 : gy;
  let days =
    365 * gy +
    Math.floor((gy2 + 3) / 4) -
    Math.floor((gy2 + 99) / 100) +
    Math.floor((gy2 + 399) / 400) -
    80 +
    day +
    GREGORIAN_DAYS_BEFORE_MONTH[month - 1];

  jy += 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }

  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return { year: jy, month: jm, day: jd };
}

export function getTodayJalaliParts(date = new Date()): JalaliDateParts {
  try {
    const parts = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).formatToParts(date);
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value || 0);
    const result = { year: value('year'), month: value('month'), day: value('day') };
    if (result.year >= 1300 && result.month >= 1 && result.month <= 12) return result;
  } catch {
    // Some older Android WebViews have limited Intl calendar data; use the local conversion below.
  }
  return gregorianToJalali(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

export function formatJalaliDate(parts: JalaliDateParts, persianDigits = true): string {
  const raw = `${parts.year}/${String(parts.month).padStart(2, '0')}/${String(parts.day).padStart(2, '0')}`;
  return persianDigits ? toPersianDigits(raw) : raw;
}

export function getTodayJalaliDate(date = new Date()): string {
  return formatJalaliDate(getTodayJalaliParts(date));
}

export function getCurrentJalaliMonthKey(date = new Date()): string {
  const { year, month } = getTodayJalaliParts(date);
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function getJalaliMonthName(month: number): string {
  return PERSIAN_MONTHS[month - 1] || 'نامشخص';
}

/** Convert an OCR'd Persian/Jalali or Gregorian date into a stable YYYY-MM-DD Jalali key. */
export function normalizeReceiptDate(value: string | null | undefined): string | null {
  const rawSource = toEnglishDigits(value || '').trim();
  const isoDatePrefix = rawSource.match(/^((?:13|14|19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2})/);
  const source = (isoDatePrefix?.[1] || rawSource).replace(/[.\-]/g, '/');
  if (!source) return null;

  let match = source.match(/\b((?:13|14)\d{2})\/(\d{1,2})\/(\d{1,2})\b/);
  if (match) {
    return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  }

  match = source.match(/\b(20\d{2}|19\d{2})\/(\d{1,2})\/(\d{1,2})\b/);
  if (match) {
    const converted = gregorianToJalali(Number(match[1]), Number(match[2]), Number(match[3]));
    return `${converted.year}-${String(converted.month).padStart(2, '0')}-${String(converted.day).padStart(2, '0')}`;
  }

  // Turkish receipts commonly print dates as DD.MM.YYYY.
  match = source.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2}|19\d{2})\b/);
  if (match) {
    const converted = gregorianToJalali(Number(match[3]), Number(match[2]), Number(match[1]));
    return `${converted.year}-${String(converted.month).padStart(2, '0')}-${String(converted.day).padStart(2, '0')}`;
  }
  return null;
}

export function receiptMonthKey(value: string | null | undefined): string | null {
  const date = normalizeReceiptDate(value);
  return date ? date.slice(0, 7) : null;
}

export function receiptDayKey(value: string | null | undefined): string | null {
  return normalizeReceiptDate(value);
}

export function formatMonthKey(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  return `${getJalaliMonthName(month)} ${toPersianDigits(String(year))}`;
}
