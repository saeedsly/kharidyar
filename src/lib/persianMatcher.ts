import type {
  BoundingBox,
  ReceiptItem,
  ReconciliationItemResult,
  ShoppingItem,
} from '../types';
import { getTodayJalaliDate, normalizeReceiptDate } from './jalaliDate';

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export function toEnglishDigits(input: string | number | null | undefined): string {
  return String(input ?? '').replace(/[۰-۹٠-٩]/g, (digit) => {
    const persianDigit = PERSIAN_DIGITS.indexOf(digit);
    const digitValue = persianDigit >= 0 ? persianDigit : ARABIC_DIGITS.indexOf(digit);
    return String(digitValue);
  });
}

export function toPersianDigits(input: string | number | null | undefined): string {
  const str = String(input ?? '');
  return str.replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)]);
}

export function formatToman(amount: number | null | undefined, showUnit = true): string {
  const safe = Math.round(Number(amount || 0));
  const formatted = toPersianDigits(safe.toLocaleString('en-US'));
  return showUnit ? `${formatted} تومان` : formatted;
}

export function formatCurrency(
  amount: number | null | undefined,
  currency: string | null | undefined,
  showUnit = true
): string {
  const currencyLabel = String(currency || '').trim();
  if (/(لیر|₺|\bTRY\b|\bTL\b)/i.test(currencyLabel)) {
    const safeAmount = Number(amount || 0);
    const formatted = toPersianDigits(
      safeAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    );
    return showUnit ? `${formatted} لیر` : formatted;
  }
  return formatToman(amount, showUnit);
}

export function normalizePersianText(input: string): string {
  return toEnglishDigits(input || '')
    .replace(/[\u200E\u200F\u202A-\u202E]/g, '')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/ۀ/g, 'ه')
    .replace(/٬/g, ',') // Persian thousands separator U+066C
    .replace(/\u200c/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const BRAND_AND_UNIT_STOPWORDS = new Set([
  'کاله',
  'صباح',
  'میهن',
  'پگاه',
  'دامداران',
  'هراز',
  'چوپان',
  'سه',
  'اویلا',
  'لادن',
  'بهار',
  'مزمز',
  'چی',
  'توز',
  'پریل',
  'اکتیو',
  'تبرک',
  'مهرام',
  'دلپذیر',
  'زرماکارون',
  'آبعلی',
  'دماوند',
  'گلخانه',
  'ای',
  'تازه',
  'پاک',
  'شده',
  'درجه',
  'یک',
  'ممتاز',
  'ویژه',
  'ایرانی',
  'پاستوریزه',
  'استریل',
  'بسته',
  'عدد',
  'عددی',
  'کیلو',
  'کیلویی',
  'گرم',
  'گرمی',
  'لیتر',
  'لیتری',
  'بطری',
  'شانه',
  'سطل',
  'کیسه',
  'قوطی',
]);

export function extractCorePersianTokens(text: string): string[] {
  return normalizePersianText(text)
    .toLowerCase()
    .replace(/[^\u0600-\u06FF\u00C0-\u024Fa-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !BRAND_AND_UNIT_STOPWORDS.has(t) && !/^\d+$/.test(t));
}

export function computeItemMatchScore(shoppingName: string, receiptItemName: string): number {
  const cleanShop = normalizePersianText(shoppingName).toLowerCase();
  const cleanRec = normalizePersianText(receiptItemName).toLowerCase();
  if (!cleanShop || !cleanRec) return 0;

  const shopIsEgg = cleanShop.includes('تخم');
  const recIsEgg = cleanRec.includes('تخم');
  if (shopIsEgg !== recIsEgg && (cleanShop.includes('مرغ') || cleanRec.includes('مرغ'))) {
    return 0;
  }

  const shopWords = cleanShop.split(' ');
  const recWords = cleanRec.split(' ');
  if (shopWords.every((sw) => recWords.includes(sw))) {
    return 0.99;
  }

  const shopTokens = extractCorePersianTokens(shoppingName);
  const recTokens = extractCorePersianTokens(receiptItemName);
  if (!shopTokens.length || !recTokens.length) return 0;

  let matched = 0;
  for (const st of shopTokens) {
    if (
      recTokens.some(
        (rt) =>
          rt === st ||
          (Math.min(rt.length, st.length) >= 4 && (rt.startsWith(st) || st.startsWith(rt)))
      )
    ) {
      matched += 1;
    }
  }
  return matched / shopTokens.length;
}

export function inferItemCategory(name: string): string {
  const n = normalizePersianText(name);
  if (/(شیر|پنیر|ماست|کره|خامه|دوغ|کشک)/.test(n)) return 'لبنیات';
  if (/(مرغ|گوشت|تخم مرغ|ماهی|تن ماهی|سوسیس|کالباس|فیله)/.test(n)) return 'پروتئین';
  if (/(نان|برنج|ماکارونی|پاستا|آرد|غلات|بیسکویت|کیک)/.test(n)) return 'نان و غلات';
  if (/(گوجه|خیار|سیب|موز|لیمو|پیاز|میوه|سبزی|پرتقال|کاهو|هویج|سیب زمینی)/.test(n))
    return 'میوه و سبزیجات';
  if (/(چیپس|پفک|شکلات|آجیل|تخمه|بستنی|تنقلات)/.test(n)) return 'تنقلات';
  if (/(قهوه|چای|نوشابه|آبمیوه|دلستر|نوشیدنی|آب معدنی)/.test(n)) return 'نوشیدنی';
  if (/(روغن|رب|شکر|قند|حبوبات|عدس|لوبیا|نخود|عسل|مربا|ادویه|سس)/.test(n)) return 'خواربار';
  if (/(مایع|پودر|شامپو|صابون|دستمال|شوینده|سفیدکننده)/.test(n)) return 'شوینده و بهداشتی';
  return 'خواربار';
}

export function inferStoreCategory(storeName: string): string {
  const s = normalizePersianText(storeName);
  if (/(داروخانه)/.test(s)) return 'داروخانه';
  if (/(نانوایی|شیرینی|قنادی)/.test(s)) return 'نانوایی و قنادی';
  if (/(رستوران|کافه|فست فود|تهیه غذا|کباب|پیتزا)/.test(s)) return 'رستوران و کافه';
  if (/(میوه|تره بار)/.test(s)) return 'میوه و تره‌بار';
  if (/(پروتئین|قصابی|مرغ)/.test(s)) return 'پروتئین';
  return 'سوپرمارکت';
}

export interface NeuralLineInput {
  fasText: string;
  biText: string;
  confidence: number;
  bbox?: BoundingBox;
}

const PRICE_TOKEN_REGEX =
  /(?:\d{1,3}(?:\.\d{3})+,\d{2}|\d{1,3}(?:[,،/.]\d{3})+|\d{1,10}[,.]\d{2}|\b\d{4,10}\b)/g;

function extractPricesFromText(line: string, liraHint = false): number[] {
  const norm = normalizePersianText(line);
  // Remove Gregorian, Jalali and Turkish day-first dates before considering prices.
  const withoutDates = norm.replace(
    /\b(?:(?:13|14|19|20)\d{2}[/.-]\d{1,2}[/.-]\d{1,2}|\d{1,2}[/.-]\d{1,2}[/.\-](?:13|14|19|20)\d{2})\b/g,
    ' '
  );
  const hasLira = liraHint || /(₺|\bTRY\b|\bTL\b|\blira\b)/i.test(withoutDates);
  const matches = withoutDates.match(PRICE_TOKEN_REGEX) || [];
  return matches
    .map((raw) => {
      if (hasLira && /^\d{1,3}(?:\.\d{3})+,\d{2}$/.test(raw)) {
        return Number(raw.replace(/\./g, '').replace(',', '.'));
      }
      if (hasLira && /^\d{1,10}[,.]\d{2}$/.test(raw)) {
        return Number(raw.replace(',', '.'));
      }
      return Number(raw.replace(/[,،/.\s]/g, ''));
    })
    .filter((value) => Number.isFinite(value) && value > 0 && (value >= 1000 || hasLira) && value <= 9_999_999_999);
}

/**
 * Dual-Head Line Fusion v2:
 * Combines pure Persian lexical words from `fas` head with exact price numbers from `fas+eng` head,
 * preserving BOTH pure text lines (for 2-line POS thermal receipts!) AND pure numeric price lines!
 */
export function fuseDualHeadLines(lines: NeuralLineInput[]): string[] {
  return lines.map(({ fasText, biText }) => {
    const cleanFas = normalizePersianText(fasText);
    const cleanBi = normalizePersianText(biText || fasText);
    if (!biText) return cleanFas;

    if (/(تاریخ|شماره\s*فاکتور)/.test(cleanFas)) {
      return cleanBi;
    }

    const biPrices = extractPricesFromText(cleanBi);
    const fasPrices = extractPricesFromText(cleanFas);
    const bestPrices = biPrices.length >= fasPrices.length ? biPrices : fasPrices;

    // Pure text line without prices (e.g. store name OR line 1 of a 2-line thermal POS item!)
    if (bestPrices.length === 0) {
      return cleanFas || cleanBi;
    }

    // Pure numeric line on 2-line POS thermal receipts (e.g., "2 * 490,000   980,000")
    const persianLettersInFas = (cleanFas.match(/[\u0600-\u06FF]/g) || []).length;
    if (persianLettersInFas <= 1) {
      return cleanBi || cleanFas;
    }

    // Summary footer line
    if (/^(جمع|تخفیف|مبلغ|قابل پرداخت|مالیات|سود شما|خالص|پرداختی)/.test(cleanFas)) {
      const label = cleanFas.replace(/[:\d,،/\s]+$/g, '').trim();
      return `${label}: ${bestPrices[bestPrices.length - 1].toLocaleString('en-US')}`;
    }

    // Single-line item row with unit
    const withoutIndex = cleanFas.replace(/^\d+\s*[-–.)]\s*/, '').trim();
    const unitMatch = withoutIndex.match(
      /^(.+?)\s+(\d+(?:\.\d+)?)\s*(عدد|بسته|کیلوگرم|کیلو|گرم|بطری|شانه|سطل|کیسه|قوطی|لیتر)(?=\s|$)/
    );
    if (unitMatch) {
      const itemName = unitMatch[1].trim();
      const qty = unitMatch[2];
      const unit = unitMatch[3];
      const formattedNums = bestPrices.slice(-2).map((n) => n.toLocaleString('en-US'));
      return `${itemName} | ${qty} ${unit} | ${formattedNums.join(' | ')}`;
    }

    // Single-line item row WITHOUT unit word (e.g. "شیر کم چرب کاله 2 490,000 980,000" or RTL reversed)
    const strippedWords = withoutIndex
      .replace(PRICE_TOKEN_REGEX, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // Check if there is a small standalone quantity integer 1..50 left next to the name
    const qtyOnlyMatch = strippedWords.match(/^(.*?[\u0600-\u06FF]+.*?)\s+(\d{1,2})$/);
    if (qtyOnlyMatch) {
      const itemName = qtyOnlyMatch[1].trim();
      const qty = qtyOnlyMatch[2];
      const formattedNums = bestPrices.slice(-2).map((n) => n.toLocaleString('en-US'));
      return `${itemName} | ${qty} عدد | ${formattedNums.join(' | ')}`;
    }

    const cleanTitle = strippedWords.replace(/\b\d+\b/g, ' ').replace(/\s+/g, ' ').trim();
    const formattedNums = bestPrices.slice(-2).map((n) => n.toLocaleString('en-US'));
    return `${cleanTitle} | ${formattedNums.join(' | ')}`;
  });
}

const IGNORE_HEADER_KEYWORDS =
  /(تاریخ|شماره\s*فاکتور|شماره\s*فیش|نام\s*کالا|شرح\s*کالا|قیمت\s*واحد|فی\s*واحد|مبلغ\s*کل|صندوق\s*شماره|سپاسگزاریم|سامانه\s*هوشمند|تلفن|آدرس|کد\s*پستی|شناسه\s*ملی|کارتخوان|ترمینال|رهگیری|date|invoice\s*(?:no|number)|item\s*name|unit\s*price|quantity|\bsubtotal\b|\btotal\b|\bdiscount\b|\bamount\b|\bprice\b|tel|address|tarih|fi[sş]\s*(?:no|numarası)|ürün\s*adı|birim\s*fiyat|adet|telefon|adres|\btoplam\b|\bindirim\b|\btutar\b)/i;

const COLLAPSED_ITEM_MARKER = /(?:^|\s)\d{1,3}\s*[-–.)]\s*(?=[\u0600-\u06FF])/g;
const COLLAPSED_FOOTER_MARKER =
  /(?:^|\s)(?:جمع\s*(?:اقلام|کل(?:\s*اقلام)?|فاکتور)|مبلغ\s*(?:قابل\s*پرداخت|نهایی|کل)|قابل\s*پرداخت|تخفیف|مالیات|ارزش\s*افزوده|sub\s*total|subtotal|grand\s*total|total\s*paid|amount\s*due|discount|tax|vat)(?=\s|[:：]|$)/gi;
const COLLAPSED_HEADER_MARKER =
  /(?:^|\s)(?:صندوق\s*شماره|تاریخ|شماره\s*(?:فاکتور|فیش)|نام(?:\s*کالا)?|شرح\s*کالا|تعداد|قیمت\s*واحد|مبلغ\s*کل)(?=\s|[:：]|$)/gi;
const COLLAPSED_COLUMN_HEADER_MARKER =
  /(?:^|\s)(?:نام(?:\s*کالا)?|شرح\s*کالا|تعداد|قیمت\s*واحد|فی\s*واحد|مبلغ\s*کل)(?=\s|[:：]|$)/gi;
const COLLAPSED_HEADER_VALUE_MARKER =
  /(?:^|\s)(?:تاریخ\s*[:：]?\s*\d{1,4}[/.\-]\d{1,2}[/.\-]\d{1,4}|شماره\s*(?:فاکتور|فیش)\s*[:：]?\s*[A-Za-z0-9-]{2,16}|صندوق\s*شماره\s*[:：]?\s*\d{1,8})/gi;
const COLLAPSED_QUANTITY_MARKER =
  /(?:^|\s)\d{1,2}(?:[.,]\d+)?\s*(?:عدد|بسته|کیلوگرم|کیلو|گرم|بطری|شانه|سطل|کیسه|قوطی|لیتر|pcs?|pieces?|kg|kgs|g|gr|lit(?:er|re)s?|adet|paket|tane)(?=\s|$)/gi;

function findMarkerStarts(text: string, marker: RegExp): number[] {
  const starts: number[] = [];
  marker.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(text)) !== null) {
    let leadingWhitespace = 0;
    while (leadingWhitespace < match[0].length && /\s/.test(match[0][leadingWhitespace])) {
      leadingWhitespace++;
    }
    starts.push(match.index + leadingWhitespace);
    if (match[0].length === 0) marker.lastIndex++;
  }
  return starts;
}

function splitTextAtMarkers(text: string, markerStarts: number[]): string[] {
  const starts = Array.from(new Set([0, ...markerStarts]))
    .filter((start) => start >= 0 && start < text.length)
    .sort((first, second) => first - second);
  return starts
    .map((start, index) => text.slice(start, starts[index + 1] ?? text.length).trim())
    .filter(Boolean);
}

function findLastMarkerEndBefore(text: string, marker: RegExp, before: number): number {
  let lastEnd = 0;
  marker.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(text)) !== null) {
    const end = match.index + match[0].length;
    if (end <= before) lastEnd = end;
    if (match[0].length === 0) marker.lastIndex++;
  }
  return lastEnd;
}

function findLastPriceEndBefore(text: string, before: number, after: number): number {
  const pricePattern = new RegExp(PRICE_TOKEN_REGEX.source, 'g');
  let lastEnd = 0;
  let match: RegExpExecArray | null;
  while ((match = pricePattern.exec(text)) !== null) {
    const end = match.index + match[0].length;
    if (end <= before && end > after) lastEnd = end;
  }
  return lastEnd;
}

function skipWhitespace(text: string, start: number): number {
  let index = start;
  while (index < text.length && /\s/.test(text[index])) index++;
  return index;
}

function recoverCollapsedUnnumberedRows(line: string): string[] | null {
  const quantityStarts = findMarkerStarts(line, COLLAPSED_QUANTITY_MARKER);
  if (quantityStarts.length === 0) return null;

  const columnHeaderEnd = findLastMarkerEndBefore(line, COLLAPSED_COLUMN_HEADER_MARKER, quantityStarts[0]);
  const metadataValueEnd = findLastMarkerEndBefore(line, COLLAPSED_HEADER_VALUE_MARKER, quantityStarts[0]);
  const genericHeaderEnd = findLastMarkerEndBefore(line, COLLAPSED_HEADER_MARKER, quantityStarts[0]);
  const firstItemStart = skipWhitespace(line, columnHeaderEnd || metadataValueEnd || genericHeaderEnd);
  if (firstItemStart <= 0 || firstItemStart >= quantityStarts[0]) return null;

  const rowStarts = [firstItemStart];
  for (const quantityStart of quantityStarts.slice(1)) {
    const previousPriceEnd = findLastPriceEndBefore(line, quantityStart, rowStarts[rowStarts.length - 1]);
    const nextItemStart = skipWhitespace(line, previousPriceEnd);
    if (previousPriceEnd > rowStarts[rowStarts.length - 1] && nextItemStart < quantityStart) {
      rowStarts.push(nextItemStart);
    }
  }

  const header = line.slice(0, firstItemStart).trim();
  const recovered = header
    ? splitTextAtMarkers(header, findMarkerStarts(header, COLLAPSED_HEADER_MARKER))
    : [];
  const rowsStart = line.slice(firstItemStart);
  const footerStarts = findMarkerStarts(line, COLLAPSED_FOOTER_MARKER)
    .filter((start) => start >= firstItemStart)
    .map((start) => start - firstItemStart);
  recovered.push(
    ...splitTextAtMarkers(
      rowsStart,
      [...rowStarts.map((start) => start - firstItemStart), ...footerStarts]
    )
  );
  return recovered.length > 1 ? recovered : null;
}

/** Restores product rows when OCR returns an entire receipt as one text line. */
export function recoverCollapsedReceiptLines(lines: string[]): string[] {
  return lines.flatMap((sourceLine) => {
    const line = normalizePersianText(sourceLine);
    const itemStarts = findMarkerStarts(line, COLLAPSED_ITEM_MARKER);
    if (itemStarts.length === 0) return recoverCollapsedUnnumberedRows(line) || [line];

    const footerStarts = findMarkerStarts(line, COLLAPSED_FOOTER_MARKER);
    const firstItemStart = Math.min(...itemStarts);
    const header = line.slice(0, firstItemStart).trim();
    const recovered = header
      ? splitTextAtMarkers(header, findMarkerStarts(header, COLLAPSED_HEADER_MARKER))
      : [];
    const rowsStart = line.slice(firstItemStart);
    const rowMarkers = [...itemStarts, ...footerStarts]
      .filter((start) => start >= firstItemStart)
      .map((start) => start - firstItemStart);
    recovered.push(...splitTextAtMarkers(rowsStart, rowMarkers));
    return recovered.length ? recovered : [line];
  });
}

/**
 * Universal Iranian Receipt NLP Parser v2
 * Supports:
 * 1. Standard 1-line supermarket & hypermarket tabular receipts (Toman & Rial)
 * 2. Narrow 80mm 2-line POS thermal receipts (Line 1: Persian item name, Line 2: qty * fee = total)
 * 3. RTL/LTR column reversal immunity
 * 4. Automatic Rial -> Toman conversion (explicit ریال keyword OR Rial magnitude heuristic)
 */
export function parsePersianReceiptText(
  linesOrText: string[] | string,
  lineBoxes: BoundingBox[] = [],
  ocrConfidence = 92
) {
  const rawLines = recoverCollapsedReceiptLines(
    (Array.isArray(linesOrText) ? linesOrText : linesOrText.split(/\r?\n/))
      .map((line) => normalizePersianText(line))
      .filter((line) => line.length > 1)
  );

  const fullText = rawLines.join('\n');
  const safeOcrConfidence = Number.isFinite(ocrConfidence)
    ? Math.max(0, Math.min(100, ocrConfidence))
    : 0;
  const explicitLira = /(₺|\bTRY\b|\bTL\b|\blira\b)/i.test(fullText);
  const explicitToman = /(تومان|تومن)/.test(fullText);
  const explicitRial = /ریال/.test(fullText) && !explicitToman && !explicitLira;
  const roundForCurrency = (amount: number) =>
    explicitLira ? Math.round(amount * 100) / 100 : Math.round(amount);

  let storeName = '';
  let jalaliDate = getTodayJalaliDate();
  let receiptNumber = `KY-${Math.floor(10000 + Math.random() * 89999)}`;
  let rawSubtotal = 0;
  let rawDiscount = 0;
  let rawTax = 0;
  let rawTotal = 0;

  const rawItems: Array<{
    name: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    totalPrice: number;
    bbox: BoundingBox | null;
  }> = [];

  // Pending item name buffer for 2-line 80mm narrow thermal POS receipts!
  let pendingProductTitle: { text: string; bbox: BoundingBox | null } | null = null;

  for (let idx = 0; idx < rawLines.length; idx++) {
    const line = rawLines[idx];

    const normalizedDate = normalizeReceiptDate(line);
    if (normalizedDate) jalaliDate = toPersianDigits(normalizedDate.replace(/-/g, '/'));

    const serialMatch = line.match(
      /(?:شماره\s*فاکتور|شماره\s*فیش|فاکتور|سریال)\s*[:：]?\s*([A-Za-z0-9\-]{2,16})/
    );
    if (serialMatch) {
      receiptNumber = serialMatch[1].toUpperCase();
    }

    if (
      !storeName &&
      idx <= 4 &&
      !IGNORE_HEADER_KEYWORDS.test(line) &&
      extractPricesFromText(line, explicitLira).length === 0
    ) {
      const cleanedTitle = line
        .replace(/^[^\u0600-\u06FF\u00C0-\u024Fa-zA-Z]+/, '')
        .replace(/[-–—:]+$/, '')
        .trim();
      if (cleanedTitle.length >= 3) {
        storeName = cleanedTitle;
        continue;
      }
    }

    const linePrices = extractPricesFromText(line, explicitLira);
    const isReceiptMetadata = /(?:تاریخ|شماره\s*فاکتور|شماره\s*فیش|صندوق\s*شماره|invoice\s*(?:no|number))/i.test(line);
    if ((IGNORE_HEADER_KEYWORDS.test(line) && linePrices.length === 0) || isReceiptMetadata || /^شعبه\s/.test(line)) {
      pendingProductTitle = null;
      continue;
    }

    // Summary labels commonly printed on Persian, English and Turkish thermal receipts.
    if (/^(جمع اقلام|جمع فاکتور|جمع کل اقلام|sub\s*total|subtotal|ara toplam)/i.test(line) && linePrices.length) {
      rawSubtotal = linePrices[linePrices.length - 1];
      pendingProductTitle = null;
      continue;
    }
    if (/(تخفیف|سود شما|discount|indirim|iskonto)/i.test(line) && linePrices.length) {
      rawDiscount = linePrices[linePrices.length - 1];
      pendingProductTitle = null;
      continue;
    }
    if (/(مالیات|ارزش افزوده|tax|vat|kdv|vergi)/i.test(line) && linePrices.length) {
      rawTax = linePrices[linePrices.length - 1];
      pendingProductTitle = null;
      continue;
    }
    if (/(قابل پرداخت|جمع کل|مبلغ نهایی|پرداختی|خالص پرداختی|amount due|grand total|total paid|\btotal\b|payable|toplam|ödenecek|tutar)/i.test(line) && linePrices.length) {
      rawTotal = linePrices[linePrices.length - 1];
      pendingProductTitle = null;
      continue;
    }

    // Case A: Pipe-structured line from Dual-Head fusion
    if (line.includes('|')) {
      const parts = line.split('|').map((p) => p.trim()).filter(Boolean);
      const itemName = parts[0]?.replace(/^\d+\s*[-–.)]\s*/, '').trim();
      if (itemName && itemName.length >= 2) {
        let quantity = 1;
        let unit = 'عدد';
        const priceParts: number[] = [];

        for (const p of parts.slice(1)) {
          const qm = p.match(
            /^(\d+(?:\.\d+)?)\s*(عدد|بسته|کیلوگرم|کیلو|گرم|بطری|شانه|سطل|کیسه|قوطی|لیتر)$/
          );
          if (qm) {
            quantity = Number(qm[1]) || 1;
            unit = qm[2];
          } else {
            const pNums = extractPricesFromText(p, explicitLira);
            priceParts.push(...pNums);
          }
        }

        if (priceParts.length >= 1) {
          let unitPrice = Math.min(...priceParts);
          let totalPrice = Math.max(...priceParts);
          if (priceParts.length >= 2 && Math.abs(quantity * unitPrice - totalPrice) > (explicitLira ? 0.05 : 50)) {
            if (quantity > 1 && totalPrice / quantity >= (explicitLira ? 0.01 : 1000)) {
              unitPrice = roundForCurrency(totalPrice / quantity);
            } else {
              totalPrice = roundForCurrency(quantity * unitPrice);
            }
          } else if (priceParts.length === 1) {
            unitPrice = quantity > 0 ? roundForCurrency(totalPrice / quantity) : totalPrice;
          }

          rawItems.push({
            name: itemName,
            quantity,
            unit,
            unitPrice,
            totalPrice,
            bbox: lineBoxes[idx] || null,
          });
          pendingProductTitle = null;
          continue;
        }
      }
    }

    // Case B: Price-free product titles are held for the next row on narrow thermal receipts.
    if (linePrices.length === 0) {
      const letters = (line.match(/[\u0600-\u06FF\u00C0-\u024Fa-zA-Z]/g) || []).length;
      if (letters >= 3 && idx > 0) {
        pendingProductTitle = {
          text: line.replace(/^\d+\s*[-–.)]\s*/, '').trim(),
          bbox: lineBoxes[idx] || null,
        };
      }
      continue;
    }

    // Case C: A priced row may contain Persian, English or Turkish product names.
    const persianPart = line
      .replace(PRICE_TOKEN_REGEX, ' ')
      .replace(/₺|\b(?:TRY|TL|LIRA|LIRASI)\b/gi, ' ')
      .replace(/^\d+\s*[-–.)]\s*/, '')
      .replace(/[*×=:\-|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const persianLetterCount = (persianPart.match(/[\u0600-\u06FF\u00C0-\u024Fa-zA-Z]/g) || []).length;

    let finalName = '';
    let itemBbox: BoundingBox | null = lineBoxes[idx] || null;
    let quantity = 1;
    let unit = 'عدد';

    // Extract small quantity number like `2 *` or `3 عدد`
    const qtyMatch = line.match(
      /(?:^|\s)(\d{1,2}(?:\.\d+)?)\s*(?:\*|×|عدد|بسته|کیلوگرم|کیلو|گرم|بطری|شانه|سطل|کیسه|قوطی|لیتر|pcs?|pieces?|kg|kgs|g|gr|lit(?:er|re)s?|adet|paket|tane)(?=\s|\d|$)/i
    );
    if (qtyMatch) {
      const qv = Number(qtyMatch[1]);
      if (qv > 0 && qv <= 60) quantity = qv;
      const unitWord = line.match(/(عدد|بسته|کیلوگرم|کیلو|گرم|بطری|شانه|سطل|کیسه|قوطی|لیتر|pcs?|pieces?|kg|kgs|g|gr|lit(?:er|re)s?|adet|paket|tane)/i);
      if (unitWord) unit = unitWord[1];
    }

    if (persianLetterCount >= 2) {
      finalName = persianPart
        .replace(/(?:^|\s)(عدد|بسته|کیلوگرم|کیلو|گرم|بطری|شانه|سطل|کیسه|قوطی|لیتر|pcs?|pieces?|kg|kgs|g|gr|lit(?:er|re)s?|adet|paket|tane)(?=\s|$)/gi, ' ')
        .replace(/\b\d+\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    } else if (pendingProductTitle) {
      finalName = pendingProductTitle.text;
      itemBbox = pendingProductTitle.bbox || itemBbox;
    }

    pendingProductTitle = null;

    if (finalName.length >= 2) {
      let unitPrice = Math.min(...linePrices);
      let totalPrice = Math.max(...linePrices);
      if (linePrices.length === 1) {
        unitPrice = quantity > 0 ? roundForCurrency(totalPrice / quantity) : totalPrice;
      } else if (quantity === 1 && totalPrice > unitPrice && totalPrice % unitPrice === 0) {
        const inferredQty = totalPrice / unitPrice;
        if (inferredQty >= 2 && inferredQty <= 24) {
          quantity = inferredQty;
        }
      }

      rawItems.push({
        name: finalName,
        quantity,
        unit,
        unitPrice,
        totalPrice,
        bbox: itemBbox,
      });
    }
  }

  // Smart Rial vs Toman Auto-Detection!
  // 1) Explicit "ریال" without "تومان" -> convert ÷10
  // 2) Implicit POS Rial receipt (no "تومان" written anywhere, all prices end in 0, and median price >= 350,000) -> convert ÷10!
  const allItemTotals = rawItems.map((i) => i.totalPrice).sort((a, b) => a - b);
  const medianPrice = allItemTotals.length
    ? allItemTotals[Math.floor(allItemTotals.length / 2)]
    : 0;
  const allEndWithZero =
    allItemTotals.length > 0 && allItemTotals.every((p) => p % 10 === 0);
  const implicitRial = !explicitToman && !explicitLira && allEndWithZero && medianPrice >= 350_000;

  const scale = explicitRial || implicitRial ? 0.1 : 1;

  const roundReceiptAmount = (amount: number) => roundForCurrency(amount * scale);
  const items: ReceiptItem[] = rawItems.map((r) => ({
    name: r.name,
    quantity: r.quantity,
    unit: r.unit,
    unit_price: roundReceiptAmount(r.unitPrice),
    total_price: roundReceiptAmount(r.totalPrice),
    discount: 0,
    category: inferItemCategory(r.name),
    confidence: Number(safeOcrConfidence.toFixed(1)),
    bbox: r.bbox,
  }));

  const computedSum = items.reduce((acc, it) => acc + it.total_price, 0);
  const subtotal = rawSubtotal > 0 ? roundReceiptAmount(rawSubtotal) : computedSum;
  const discountTotal = roundReceiptAmount(rawDiscount);
  const taxTotal = roundReceiptAmount(rawTax);
  const totalAmount =
    rawTotal > 0
      ? roundReceiptAmount(rawTotal)
      : roundForCurrency(Math.max(0, subtotal - discountTotal + taxTotal));

  const finalStore = storeName || 'فروشگاه اسکن‌شده';

  return {
    store_name: finalStore,
    store_category: inferStoreCategory(finalStore),
    jalali_date: jalaliDate,
    receipt_number: receiptNumber,
    subtotal,
    discount_total: discountTotal,
    tax_total: taxTotal,
    total_amount: totalAmount,
    currency: explicitLira ? 'لیر' : 'تومان',
    detected_rial: explicitRial || implicitRial,
    ocr_confidence: Number(safeOcrConfidence.toFixed(1)),
    items,
  };
}

export function reconcileReceiptWithShoppingList(
  receiptItems: ReceiptItem[],
  shoppingItems: ShoppingItem[]
) {
  const usedReceiptIndices = new Set<number>();
  const results: ReconciliationItemResult[] = [];

  for (const sItem of shoppingItems) {
    let bestIdx = -1;
    let bestScore = 0;

    receiptItems.forEach((rItem, idx) => {
      const score = computeItemMatchScore(sItem.name, rItem.name);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = idx;
      }
    });

    if (bestIdx >= 0 && bestScore >= 0.5) {
      usedReceiptIndices.add(bestIdx);
      const matched = receiptItems[bestIdx];
      matched.matched_shopping_item_id = sItem.id;
      results.push({
        shoppingItemId: sItem.id,
        shoppingItemName: sItem.name,
        status: 'matched',
        matchedReceiptItemIndex: bestIdx,
        matchedReceiptItemName: matched.name,
        matchedPrice: matched.total_price,
        score: Number(bestScore.toFixed(2)),
      });
    } else {
      results.push({
        shoppingItemId: sItem.id,
        shoppingItemName: sItem.name,
        status: 'missing',
        matchedReceiptItemIndex: null,
        matchedReceiptItemName: null,
        matchedPrice: null,
        score: Number(bestScore.toFixed(2)),
      });
    }
  }

  const extraItems = receiptItems.filter((_, idx) => !usedReceiptIndices.has(idx));
  const matchedCount = results.filter((r) => r.status === 'matched').length;
  const missingNames = results
    .filter((r) => r.status === 'missing')
    .map((r) => r.shoppingItemName);

  return {
    matchedCount,
    missingCount: missingNames.length,
    extraCount: extraItems.length,
    items: results,
    missingNames,
    extraItems,
  };
}
