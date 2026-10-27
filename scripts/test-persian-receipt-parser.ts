import assert from 'node:assert/strict';
import {
  formatCurrency,
  keepPersianReceiptText,
  normalizePersianText,
  parsePersianReceiptText,
  recoverCollapsedReceiptLines,
} from '../src/lib/persianMatcher';

assert.equal(
  normalizePersianText('يِك كالا ۱۲۳٬۴۵۶٫۷۸'),
  'یک کالا 123,456.78',
  'Normalize Arabic/Persian letter variants, OCR marks, and Persian amount digits.'
);
assert.equal(keepPersianReceiptText('شیر Ud 90,000 90,000'), 'شیر 90,000 90,000');
assert.equal(keepPersianReceiptText('milk 90,000'), '', 'Drop English-only OCR rows.');
assert.equal(keepPersianReceiptText('2 * 490,000 980,000'), '2 * 490,000 980,000', 'Keep numeric thermal rows.');
assert.equal(keepPersianReceiptText('شیر 49,000 لیر ₺'), 'شیر 49,000', 'Remove mistaken Lira markers.');
assert.equal(keepPersianReceiptText('₺ 49,000'), '', 'A Lira-only row must not become an unnamed item.');
assert.equal(formatCurrency(49_000, 'لیر'), '۴۹,۰۰۰ تومان');

const collapsedReceipt =
  'فروشگاه زنجیره‌ای افق کوروش شعبه سعادت‌آباد - صندوق شماره ۳ تاریخ: 1405/08/01 شماره فاکتور: ‎OK-77419‏ ‏نام ‎VIS‏ تعداد قیمت واحد مبلغ کل 1- شیر کم چرب کاله 2 عدد 49,000 98,000 2- پنیر ‎Ud‏ صباح 1 بسته 65,000 65,000 3- تخم مرغ تازه 1 شانه 115,000 115,000 4- نان تست سه نان 1 بسته 42,000 42,000 5- ماست یونانی کاله 1 سطل 78,000 78,000 6- چیپس سرکه ای مزمز 1 بسته 45,000 45,000 gaz اقلام (تومان): 443,000 تخفیف خرید: 23,000 مبلغ قابل پرداخت (تومان): 420,000 از خرید شما سپاسگزاریم';

const recoveredLines = recoverCollapsedReceiptLines([collapsedReceipt]);
const receipt = parsePersianReceiptText([collapsedReceipt]);

assert.ok(recoveredLines.length >= 12, `Expected receipt rows to be restored, got ${recoveredLines.length}.`);
assert.equal(receipt.store_name, 'فروشگاه زنجیره ای افق کوروش شعبه سعادت آباد');
assert.equal(receipt.receipt_number, '77419');
assert.equal(receipt.subtotal, 443_000);
assert.equal(receipt.discount_total, 23_000);
assert.equal(receipt.total_amount, 420_000);
assert.equal(receipt.ocr_confidence, 92);
assert.equal(parsePersianReceiptText([collapsedReceipt], [], 28).ocr_confidence, 28);
assert.equal(receipt.items.length, 6);

const persianDigitReceipt = parsePersianReceiptText([
  'فروشگاه نمونه',
  'شیر کم چرب کاله',
  '۲ عدد ۴۹٬۰۰۰ ۹۸٬۰۰۰',
  'جمع اقلام: ۹۸٬۰۰۰ تومان',
  'مبلغ قابل پرداخت: ۹۸٬۰۰۰ تومان',
]);
assert.equal(persianDigitReceipt.items.length, 1);
assert.equal(persianDigitReceipt.items[0].name, 'شیر کم چرب کاله');
assert.equal(persianDigitReceipt.items[0].quantity, 2);
assert.equal(persianDigitReceipt.items[0].total_price, 98_000);
assert.equal(persianDigitReceipt.subtotal, 98_000);
assert.equal(persianDigitReceipt.total_amount, 98_000);
assert.equal(persianDigitReceipt.amount_read_from_receipt, true);

const receiptWithUnreadableDiscountLabel = parsePersianReceiptText(
  recoveredLines.map((line) => (line.startsWith('تخفیف خرید:') ? line.replace('تخفیف خرید: ', '') : line))
);
assert.equal(receiptWithUnreadableDiscountLabel.items.length, 6);
assert.equal(receiptWithUnreadableDiscountLabel.subtotal, 443_000);
assert.equal(receiptWithUnreadableDiscountLabel.discount_total, 23_000);
assert.equal(receiptWithUnreadableDiscountLabel.total_amount, 420_000);
assert.deepEqual(
  receipt.items.map(({ name, quantity, unit_price, total_price }) => ({ name, quantity, unit_price, total_price })),
  [
    { name: 'شیر کم چرب کاله', quantity: 2, unit_price: 49_000, total_price: 98_000 },
    { name: 'پنیر صباح', quantity: 1, unit_price: 65_000, total_price: 65_000 },
    { name: 'تخم مرغ تازه', quantity: 1, unit_price: 115_000, total_price: 115_000 },
    { name: 'نان تست سه نان', quantity: 1, unit_price: 42_000, total_price: 42_000 },
    { name: 'ماست یونانی کاله', quantity: 1, unit_price: 78_000, total_price: 78_000 },
    { name: 'چیپس سرکه ای مزمز', quantity: 1, unit_price: 45_000, total_price: 45_000 },
  ]
);

const unnumberedReceipt = collapsedReceipt.replace(
  /(?:^|\s)\d{1,3}\s*[-–.)]\s*(?=[\u0600-\u06FF])/g,
  ' '
);
const unnumberedResult = parsePersianReceiptText([unnumberedReceipt]);

assert.equal(unnumberedResult.items.length, 6);
assert.equal(unnumberedResult.subtotal, 443_000);
assert.equal(unnumberedResult.discount_total, 23_000);
assert.equal(unnumberedResult.total_amount, 420_000);
assert.deepEqual(
  unnumberedResult.items.map(({ name, total_price }) => ({ name, total_price })),
  receipt.items.map(({ name, total_price }) => ({ name, total_price }))
);

const unnumberedWithoutColumnHeadings = normalizePersianText(unnumberedReceipt).replace(
  /\sنام\s*VIS\s*تعداد\s*قیمت\s*واحد\s*مبلغ\s*کل\s*/,
  ' '
);
const thermalReceiptResult = parsePersianReceiptText([unnumberedWithoutColumnHeadings]);
assert.equal(thermalReceiptResult.items.length, 6);
assert.equal(thermalReceiptResult.subtotal, 443_000);
assert.equal(thermalReceiptResult.discount_total, 23_000);
assert.equal(thermalReceiptResult.total_amount, 420_000);

const twoLineThermalReceipt = parsePersianReceiptText([
  'فروشگاه نمونه',
  'شیر کم چرب کاله',
  '2 عدد 490,000 980,000',
  'چای سیاه ممتاز',
  '1 عدد 145 000 145 000',
  'جمع کل اقلام: 1 125 000',
  'تخفیف خرید: 25,000',
  'مبلغ قابل پرداخت: 1,100,000',
]);
assert.equal(twoLineThermalReceipt.items.length, 2);
assert.deepEqual(twoLineThermalReceipt.items.map(({ quantity, total_price }) => ({ quantity, total_price })), [
  { quantity: 2, total_price: 980_000 },
  { quantity: 1, total_price: 145_000 },
]);
assert.equal(twoLineThermalReceipt.subtotal, 1_125_000);
assert.equal(twoLineThermalReceipt.discount_total, 25_000);
assert.equal(twoLineThermalReceipt.total_amount, 1_100_000);
assert.equal(twoLineThermalReceipt.amount_read_from_receipt, true);

const reversedRtlUnitReceipt = parsePersianReceiptText([
  'فروشگاه نمونه',
  'شیر کم چرب کاله',
  '98,000 49,000 ددع 2',
  'مبلغ قابل پرداخت (تومان): 98,000',
]);
assert.equal(reversedRtlUnitReceipt.items.length, 1);
assert.equal(reversedRtlUnitReceipt.items[0].name, 'شیر کم چرب کاله');
assert.equal(reversedRtlUnitReceipt.items[0].quantity, 2);
assert.equal(reversedRtlUnitReceipt.items[0].total_price, 98_000);

const receiptWithUnreadableProductName = parsePersianReceiptText([
  'فروشگاه نمونه',
  'شیر کم چرب کاله',
  '98,000 49,000 ددع 2',
  '65,000 65,000 ددع 1',
  'مبلغ قابل پرداخت (تومان): 163,000',
]);
assert.equal(receiptWithUnreadableProductName.items.length, 2);
assert.equal(receiptWithUnreadableProductName.items[0].name, 'شیر کم چرب کاله');
assert.equal(receiptWithUnreadableProductName.items[1].name, 'کالای نامشخص 2');
assert.equal(receiptWithUnreadableProductName.items[1].total_price, 65_000);

const receiptWithSinglePriceOnFinalItemRow = parsePersianReceiptText([
  'فروشگاه نمونه',
  'شیر کم چرب کاله',
  '1 عدد 49,000 49,000',
  '65,000',
  'جمع اقلام (تومان): 114,000',
  'مبلغ قابل پرداخت (تومان): 114,000',
]);
assert.equal(receiptWithSinglePriceOnFinalItemRow.items.length, 2);
assert.equal(receiptWithSinglePriceOnFinalItemRow.items[1].name, 'کالای نامشخص 2');
assert.equal(receiptWithSinglePriceOnFinalItemRow.items[1].total_price, 65_000);
assert.equal(receiptWithSinglePriceOnFinalItemRow.subtotal, 114_000);
assert.equal(receiptWithSinglePriceOnFinalItemRow.total_amount, 114_000);

const largeTomanReceipt = parsePersianReceiptText([
  'فروشگاه نمونه',
  'برنج هاشمی',
  '1 عدد 650,000 650,000',
  'جمع کل اقلام: 650,000',
  'مبلغ قابل پرداخت: 650,000',
]);
assert.equal(largeTomanReceipt.total_amount, 650_000, 'Do not guess Rial from a large price alone.');
assert.equal(largeTomanReceipt.detected_rial, false);
assert.equal(largeTomanReceipt.currency_detected, false);

const explicitRialReceipt = parsePersianReceiptText([
  'فروشگاه نمونه',
  'برنج هاشمی (ریال)',
  '1 عدد 6,500,000 6,500,000',
  'جمع کل اقلام: 6,500,000 ریال',
  'مبلغ قابل پرداخت: 6,500,000 ریال',
]);
assert.equal(explicitRialReceipt.total_amount, 650_000);
assert.equal(explicitRialReceipt.detected_rial, true);
assert.equal(explicitRialReceipt.currency_detected, true);
assert.equal(explicitRialReceipt.currency, 'تومان');

const misleadingLiraReceipt = parsePersianReceiptText([
  'فروشگاه نمونه',
  'شیر کم چرب کاله',
  '1 عدد 49,000 49,000 TL',
  'جمع اقلام: 49,000 TL',
  'مبلغ قابل پرداخت: 49,000 TL',
]);
assert.equal(misleadingLiraReceipt.items.length, 1);
assert.equal(misleadingLiraReceipt.total_amount, 49_000);
assert.equal(misleadingLiraReceipt.currency, 'تومان');
assert.equal(misleadingLiraReceipt.currency_detected, false);

const receiptWithPaymentMetadata = parsePersianReceiptText([
  'فروشگاه نمونه',
  'شیر کم چرب کاله',
  '1 عدد 49,000 49,000',
  'شماره کارت: 6037 0000 0000 0000',
  'کد رهگیری: 938475',
  'تلفن فروشگاه: 021 12345678',
  'هزینه ارسال: 15,000',
  'توضیحات اضافی: 12,000',
  'جمع اقلام: 49,000',
  'مبلغ قابل پرداخت: 49,000',
]);
assert.equal(receiptWithPaymentMetadata.items.length, 1, 'Store and payment metadata must not become receipt items.');
assert.equal(receiptWithPaymentMetadata.items[0].name, 'شیر کم چرب کاله');
assert.equal(receiptWithPaymentMetadata.total_amount, 49_000);
assert.ok(receiptWithPaymentMetadata.items.every((item) => !/[A-Za-z\u00C0-\u024F]/.test(item.name)));


console.log(
  'PASS: Persian-only OCR text, conservative receipt-item filtering, Toman default, and explicit-only Rial conversion.'
);
