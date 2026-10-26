#!/usr/bin/env python3
"""
Generates high-resolution realistic Persian store thermal receipt PNGs + KharidYar App Icons
using bundled Vazirmatn fonts so the real OpenCV + Persian LSTM OCR pipeline can be tested
live end-to-end on authentic Persian pixel images.
"""
import os
import random
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import arabic_reshaper
from bidi.algorithm import get_display

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT_REG_PATH = os.path.join(ROOT, "node_modules/vazirmatn/fonts/ttf/Vazirmatn-Regular.ttf")
FONT_MED_PATH = os.path.join(ROOT, "node_modules/vazirmatn/fonts/ttf/Vazirmatn-Medium.ttf")
FONT_BOLD_PATH = os.path.join(ROOT, "node_modules/vazirmatn/fonts/ttf/Vazirmatn-Bold.ttf")

SAMPLES_DIR = os.path.join(ROOT, "public/samples")
os.makedirs(SAMPLES_DIR, exist_ok=True)

reshaper = arabic_reshaper.ArabicReshaper(
    configuration={
        "delete_harakat": False,
        "support_ligatures": True,
    }
)


def fa(text: str) -> str:
    return get_display(reshaper.reshape(text))


def to_persian_num(n: int | str) -> str:
    s = f"{n:,}" if isinstance(n, int) else str(n)
    trans = str.maketrans("0123456789,", "۰۱۲۳۴۵۶۷۸۹،")
    return s.translate(trans)


def render_receipt(
    filename: str,
    store_name: str,
    branch_info: str,
    date_str: str,
    serial_str: str,
    items: list[tuple[str, int, str, int, int]],
    discount_total: int = 0,
):
    W = 920
    header_h = 260
    row_h = 74
    footer_h = 260
    H = header_h + len(items) * row_h + footer_h

    # Subtle realistic thermal paper background framed on soft desk backdrop so OpenCV contour warp shines too
    pad = 36
    canvas = Image.new("RGB", (W + pad * 2, H + pad * 2), (232, 236, 242))
    paper = Image.new("RGB", (W, H), (252, 252, 250))
    pdraw = ImageDraw.Draw(paper)

    # Very subtle realistic paper texture speckles
    rng = random.Random(hash(filename))
    for _ in range(900):
        px = rng.randint(0, W - 1)
        py = rng.randint(0, H - 1)
        shade = rng.randint(242, 250)
        paper.putpixel((px, py), (shade, shade, shade - 1))

    f_title = ImageFont.truetype(FONT_BOLD_PATH, 38)
    f_sub = ImageFont.truetype(FONT_MED_PATH, 24)
    f_head = ImageFont.truetype(FONT_BOLD_PATH, 25)
    f_item = ImageFont.truetype(FONT_MED_PATH, 26)
    f_num = ImageFont.truetype(FONT_BOLD_PATH, 26)
    f_total = ImageFont.truetype(FONT_BOLD_PATH, 33)

    ink = (22, 26, 32)
    muted = (75, 82, 92)

    # Header
    y = 32
    title_s = fa(store_name)
    tw = pdraw.textlength(title_s, font=f_title)
    pdraw.text(((W - tw) / 2, y), title_s, font=f_title, fill=ink)
    y += 58

    sub_s = fa(branch_info)
    sw = pdraw.textlength(sub_s, font=f_sub)
    pdraw.text(((W - sw) / 2, y), sub_s, font=f_sub, fill=muted)
    y += 46

    meta_right = fa(f"تاریخ: {date_str}")
    meta_left = fa(f"شماره فاکتور: {serial_str}")
    mrw = pdraw.textlength(meta_right, font=f_sub)
    pdraw.text((W - 44 - mrw, y), meta_right, font=f_sub, fill=ink)
    pdraw.text((44, y), meta_left, font=f_sub, fill=ink)
    y += 46

    pdraw.line([(36, y), (W - 36, y)], fill=(60, 65, 75), width=2)
    y += 14

    # Table Header (RTL right-to-left columns: نام کالا | تعداد | قیمت واحد | مبلغ کل)
    h_name = fa("نام کالا")
    h_qty = fa("تعداد")
    h_unit = fa("قیمت واحد")
    h_sum = fa("مبلغ کل")

    pdraw.text((W - 48 - pdraw.textlength(h_name, font=f_head), y), h_name, font=f_head, fill=ink)
    pdraw.text((455 - pdraw.textlength(h_qty, font=f_head) / 2, y), h_qty, font=f_head, fill=ink)
    pdraw.text((295 - pdraw.textlength(h_unit, font=f_head) / 2, y), h_unit, font=f_head, fill=ink)
    pdraw.text((125 - pdraw.textlength(h_sum, font=f_head) / 2, y), h_sum, font=f_head, fill=ink)
    y += 44
    pdraw.line([(36, y), (W - 36, y)], fill=(60, 65, 75), width=2)
    y += 16

    subtotal = 0
    for idx, (name, qty, unit_label, unit_price, total_price) in enumerate(items, start=1):
        subtotal += total_price
        name_txt = fa(f"{idx}- {name}")
        qty_txt = fa(f"{qty} {unit_label}")
        up_txt = f"{unit_price:,}"
        tp_txt = f"{total_price:,}"

        pdraw.text((W - 44 - pdraw.textlength(name_txt, font=f_item), y), name_txt, font=f_item, fill=ink)
        pdraw.text((455 - pdraw.textlength(qty_txt, font=f_item) / 2, y), qty_txt, font=f_item, fill=ink)
        pdraw.text((295 - pdraw.textlength(up_txt, font=f_num) / 2, y), up_txt, font=f_num, fill=ink)
        pdraw.text((125 - pdraw.textlength(tp_txt, font=f_num) / 2, y), tp_txt, font=f_num, fill=ink)
        y += row_h - 14
        pdraw.line([(44, y), (W - 44, y)], fill=(215, 220, 228), width=1)
        y += 14

    y += 8
    pdraw.line([(36, y), (W - 36, y)], fill=(40, 45, 55), width=3)
    y += 20

    sub_lbl = fa("جمع اقلام (تومان):")
    sub_val = f"{subtotal:,}"
    pdraw.text((W - 48 - pdraw.textlength(sub_lbl, font=f_head), y), sub_lbl, font=f_head, fill=muted)
    pdraw.text((52, y), sub_val, font=f_num, fill=muted)
    y += 44

    if discount_total > 0:
        disc_lbl = fa("تخفیف کل خرید:")
        disc_val = f"{discount_total:,}"
        pdraw.text((W - 48 - pdraw.textlength(disc_lbl, font=f_head), y), disc_lbl, font=f_head, fill=muted)
        pdraw.text((52, y), disc_val, font=f_num, fill=muted)
        y += 46

    grand = subtotal - discount_total
    tot_lbl = fa("مبلغ قابل پرداخت (تومان):")
    tot_val = f"{grand:,}"
    pdraw.text((W - 48 - pdraw.textlength(tot_lbl, font=f_total), y), tot_lbl, font=f_total, fill=ink)
    pdraw.text((52, y), tot_val, font=f_total, fill=ink)
    y += 58

    thanks = fa("از خرید شما سپاسگزاریم - سامانه هوشمند خریدیار")
    tw2 = pdraw.textlength(thanks, font=f_sub)
    pdraw.text(((W - tw2) / 2, y), thanks, font=f_sub, fill=muted)

    # Soft drop shadow onto backdrop
    shadow = Image.new("RGBA", (W + 16, H + 16), (15, 23, 42, 42))
    shadow = shadow.filter(ImageFilter.GaussianBlur(8))
    canvas.paste(shadow.convert("RGB"), (pad - 4, pad + 4))
    canvas.paste(paper, (pad, pad))

    out_path = os.path.join(SAMPLES_DIR, filename)
    canvas.save(out_path, "PNG", optimize=True)
    return out_path


def render_long_thermal_receipt(filename: str = "sample-thermal-long.png"):
    """Create a narrow, dense thermal receipt fixture for long-receipt OCR regression tests."""
    width = 576  # Common 80 mm thermal-printer raster width at 203 dpi.
    rows = [
        ("شیر کم چرب کاله", 2, 49000), ("پنیر سفید صباح", 1, 65000),
        ("تخم مرغ تازه", 1, 115000), ("نان تست سبوس دار", 1, 42000),
        ("ماست یونانی کاله", 1, 78000), ("چیپس سرکه ای مزمز", 1, 45000),
        ("روغن مایع آفتابگردان", 1, 89000), ("گوجه فرنگی گلخانه ای", 2, 38000),
        ("دوغ نعنایی آبعلی", 2, 29000), ("مرغ تازه پاک شده", 2, 98000),
        ("برنج هاشمی درجه یک", 1, 650000), ("سیب درختی دماوند", 2, 55000),
        ("چای سیاه ممتاز", 1, 145000), ("قند شکسته", 1, 52000),
        ("ماکارونی زر ماکارون", 3, 27000), ("رب گوجه فرنگی", 2, 39000),
        ("روغن زیتون فرابکر", 1, 210000), ("آب معدنی", 6, 9000),
        ("نوشابه خانواده", 2, 32000), ("بیسکویت سبوس دار", 2, 24000),
        ("شکلات تلخ", 1, 68000), ("دستمال کاغذی", 2, 56000),
        ("مایع ظرفشویی", 1, 74000), ("پودر لباسشویی", 1, 132000),
        ("پنیر خامه ای", 1, 59000), ("کره حیوانی", 2, 47000),
        ("خامه صبحانه", 1, 36000), ("عدس بسته بندی", 2, 43000),
        ("لوبیا چیتی", 1, 94000), ("نخود ایرانی", 1, 51000),
        ("تن ماهی", 2, 78000), ("سس مایونز", 1, 64000),
        ("خیارشور ویژه", 1, 83000), ("عسل طبیعی", 1, 185000),
        ("مربای توت فرنگی", 1, 72000), ("قهوه فوری", 1, 115000),
        ("آبمیوه پرتقال", 2, 28000), ("موز تازه", 2, 69000),
        ("سیب زمینی", 2, 26000), ("پیاز زرد", 1, 18000),
        ("لیمو ترش", 1, 44000), ("شامپو روزانه", 1, 99000),
        ("صابون بهداشتی", 3, 17000), ("بستنی وانیلی", 2, 39000),
        ("نان لواش", 2, 12000), ("پنیر پیتزا", 1, 138000),
        ("پسته خام", 1, 225000), ("خرما مضافتی", 1, 88000),
    ]
    pad = 20
    header_h = 250
    row_h = 56
    footer_h = 290
    paper = Image.new("RGB", (width, header_h + len(rows) * row_h + footer_h), (250, 249, 245))
    draw = ImageDraw.Draw(paper)
    regular = ImageFont.truetype(FONT_REG_PATH, 17)
    medium = ImageFont.truetype(FONT_MED_PATH, 17)
    bold = ImageFont.truetype(FONT_BOLD_PATH, 18)
    small = ImageFont.truetype(FONT_REG_PATH, 15)
    ink = (48, 48, 46)
    faint = (86, 86, 82)

    def right_text(text: str, y: int, font, fill=ink, right: int = width - pad):
        display = fa(text)
        draw.text((right - draw.textlength(display, font=font), y), display, font=font, fill=fill)

    y = 16
    right_text("فروشگاه زنجیره ای بهار", y, bold, right=width - pad)
    y += 28
    right_text("شعبه بلوار فردوس - صندوق ۲", y, small, faint)
    y += 24
    draw.text((pad, y), "1405/08/04", font=small, fill=faint)
    right_text("شماره فاکتور: TH-804231", y, small, faint)
    y += 25
    draw.line((pad, y, width - pad, y), fill=(120, 120, 116), width=1)
    y += 10
    right_text("شرح کالا", y, small, faint)
    y += 22

    subtotal = 0
    for index, (name, quantity, unit_price) in enumerate(rows, start=1):
        total = quantity * unit_price
        subtotal += total
        right_text(name, y, medium)
        y += 22
        draw.text((pad, y), f"{quantity} عدد  {unit_price:,}  {total:,}", font=regular, fill=ink)
        y += 23
        if index % 4 == 0:
            draw.line((pad, y + 1, width - pad, y + 1), fill=(228, 226, 220), width=1)
        y += 9

    discount = 47000
    grand_total = subtotal - discount
    y += 5
    draw.line((pad, y, width - pad, y), fill=(100, 100, 96), width=2)
    y += 13
    right_text("جمع اقلام (تومان):", y, small, faint)
    draw.text((pad, y), f"{subtotal:,}", font=regular, fill=faint)
    y += 24
    right_text("تخفیف خرید (تومان):", y, small, faint)
    draw.text((pad, y), f"{discount:,}", font=regular, fill=faint)
    y += 25
    right_text("مالیات:", y, small, faint)
    draw.text((pad, y), "0", font=regular, fill=faint)
    y += 27
    right_text("مبلغ قابل پرداخت (تومان):", y, bold)
    draw.text((pad, y), f"{grand_total:,}", font=bold, fill=ink)
    y += 32
    right_text("از خرید شما سپاسگزاریم", y, small, faint)

    # Emulate a lightly faded thermal print without reducing the small glyph details.
    paper = paper.filter(ImageFilter.GaussianBlur(radius=0.12))
    out_path = os.path.join(SAMPLES_DIR, filename)
    paper.save(out_path, "PNG", optimize=True)
    return out_path


def generate_app_icons():

    """Creates sleek minimal Apple-style KharidYar app icon PNGs for PWA + Native Android APK."""
    size = 512
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Clean rounded squircle gradient look in Royal Cobalt Blue (#2563EB -> #1D4ED8)
    draw.rounded_rectangle([(0, 0), (size - 1, size - 1)], radius=116, fill=(37, 99, 235, 255))
    draw.rounded_rectangle([(18, 18), (size - 19, size - 19)], radius=102, outline=(255, 255, 255, 48), width=4)

    # Stylized receipt sheet + emerald checkmark badge + scan corners
    draw.rounded_rectangle([(146, 112), (366, 404)], radius=32, fill=(255, 255, 255, 255))
    # Scan lines inside receipt
    draw.rounded_rectangle([(182, 162), (330, 180)], radius=9, fill=(37, 99, 235, 220))
    draw.rounded_rectangle([(182, 206), (298, 222)], radius=8, fill=(148, 163, 184, 200))
    draw.rounded_rectangle([(182, 246), (322, 262)], radius=8, fill=(148, 163, 184, 200))
    draw.rounded_rectangle([(182, 286), (276, 302)], radius=8, fill=(148, 163, 184, 200))

    # Scanner frame corners around receipt
    corner_col = (147, 197, 253, 255)
    w_c = 12
    # Top-left
    draw.line([(98, 134), (98, 86), (146, 86)], fill=corner_col, width=w_c)
    # Top-right
    draw.line([(366, 86), (414, 86), (414, 134)], fill=corner_col, width=w_c)
    # Bottom-left
    draw.line([(98, 376), (98, 424), (146, 424)], fill=corner_col, width=w_c)

    # Crisp Emerald Check Circle at bottom-right
    cx, cy, cr = 360, 366, 68
    draw.ellipse([(cx - cr, cy - cr), (cx + cr, cy + cr)], fill=(16, 185, 129, 255), outline=(255, 255, 255, 255), width=10)
    draw.line([(cx - 28, cy + 2), (cx - 6, cy + 24), (cx + 32, cy - 20)], fill=(255, 255, 255, 255), width=14, joint="curve")

    public_dir = os.path.join(ROOT, "public")
    img.save(os.path.join(public_dir, "icon-512.png"), "PNG")
    img.resize((192, 192), Image.Resampling.LANCZOS).save(os.path.join(public_dir, "icon-192.png"), "PNG")


if __name__ == "__main__":
    p1 = render_receipt(
        "sample-ofogh.png",
        "فروشگاه زنجیره‌ای افق کوروش",
        "شعبه سعادت‌آباد - صندوق شماره ۳",
        "1405/08/01",
        "OK-77419",
        [
            ("شیر کم چرب کاله", 2, "عدد", 49000, 98000),
            ("پنیر فتا صباح", 1, "بسته", 65000, 65000),
            ("تخم مرغ تازه", 1, "شانه", 115000, 115000),
            ("نان تست سه نان", 1, "بسته", 42000, 42000),
            ("ماست یونانی کاله", 1, "سطل", 78000, 78000),
            ("چیپس سرکه ای مزمز", 1, "بسته", 45000, 45000),
        ],
        discount_total=23000,
    )
    p2 = render_receipt(
        "sample-janbo.png",
        "فروشگاه زنجیره‌ای جانبو",
        "شعبه بلوار فردوس - فیش فروش",
        "1405/08/01",
        "JB-91042",
        [
            ("روغن مایع آفتابگردان لادن", 1, "بطری", 89000, 89000),
            ("گوجه فرنگی گلخانه ای", 2, "کیلو", 38000, 76000),
            ("دوغ نعنایی آبعلی", 2, "بطری", 29000, 58000),
        ],
        discount_total=15000,
    )
    p3 = render_receipt(
        "sample-hyperstar.png",
        "هایپراستار ارم",
        "بخش پروتئین و تره‌بار روز",
        "1405/08/01",
        "HS-55210",
        [
            ("مرغ تازه پاک شده", 2, "کیلو", 98000, 196000),
            ("برنج هاشمی ایرانی درجه یک", 1, "کیسه", 650000, 650000),
            ("سیب درختی دماوند", 2, "کیلو", 55000, 110000),
        ],
        discount_total=46000,
    )
    p4 = render_long_thermal_receipt()
    generate_app_icons()
    print("Generated sample receipts & icons:", p1, p2, p3, p4)
