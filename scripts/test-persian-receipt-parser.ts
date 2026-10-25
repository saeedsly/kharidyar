import assert from 'node:assert/strict';
import {
  normalizePersianText,
  parsePersianReceiptText,
  recoverCollapsedReceiptLines,
} from '../src/lib/persianMatcher';

const collapsedReceipt =
  'فروشگاه زنجیره‌ای افق کوروش شعبه سعادت‌آباد - صندوق شماره ۳ تاریخ: 1405/08/01 شماره فاکتور: ‎OK-77419‏ ‏نام ‎VIS‏ تعداد قیمت واحد مبلغ کل 1- شیر کم چرب کاله 2 عدد 49,000 98,000 2- پنیر ‎Ud‏ صباح 1 بسته 65,000 65,000 3- تخم مرغ تازه 1 شانه 115,000 115,000 4- نان تست سه نان 1 بسته 42,000 42,000 5- ماست یونانی کاله 1 سطل 78,000 78,000 6- چیپس سرکه ای مزمز 1 بسته 45,000 45,000 جمع اقلام (تومان): 443,000 تخفیف خرید: 23,000 مبلغ قابل پرداخت (تومان): 420,000 از خرید شما سپاسگزاریم';

const recoveredLines = recoverCollapsedReceiptLines([collapsedReceipt]);
const receipt = parsePersianReceiptText([collapsedReceipt]);

assert.ok(recoveredLines.length >= 12, `Expected receipt rows to be restored, got ${recoveredLines.length}.`);
assert.equal(receipt.store_name, 'فروشگاه زنجیره ای افق کوروش شعبه سعادت آباد');
assert.equal(receipt.receipt_number, 'OK-77419');
assert.equal(receipt.subtotal, 443_000);
assert.equal(receipt.discount_total, 23_000);
assert.equal(receipt.total_amount, 420_000);
assert.equal(receipt.ocr_confidence, 92);
assert.equal(parsePersianReceiptText([collapsedReceipt], [], 28).ocr_confidence, 28);
assert.equal(receipt.items.length, 6);
assert.deepEqual(
  receipt.items.map(({ name, quantity, unit_price, total_price }) => ({ name, quantity, unit_price, total_price })),
  [
    { name: 'شیر کم چرب کاله', quantity: 2, unit_price: 49_000, total_price: 98_000 },
    { name: 'پنیر Ud صباح', quantity: 1, unit_price: 65_000, total_price: 65_000 },
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

console.log(
  'PASS: collapsed Persian receipt text, with numbered or unnumbered items and with or without column headings, restored to six correctly priced items.'
);
