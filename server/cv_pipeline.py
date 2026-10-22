#!/usr/bin/env python3
"""
KharidYar Professional Computer Vision Receipt Preprocessor v2 (OpenCV 5.0 + Pillow EXIF)
Handles real mobile phone photos:
1. Automatic EXIF Orientation fixing (crucial for sideways iPhone/Samsung portrait camera JPEGs!)
2. Automatic skew angle detection & deskewing (-15° to +15° tilted hand-held camera shots)
3. Illumination shadow flattening (removes dark phone/hand shadows across thermal paper)
4. Optimal 1500px scaling + gentle CLAHE & level stretching preserving Persian dots (نقطه‌ها)
"""
import sys
import json
import os
import cv2
import numpy as np
from PIL import Image, ImageOps


def deskew_receipt(gray: np.ndarray) -> tuple[np.ndarray, float]:
    """Detects slight text line tilt (-15 to +15 deg) via projection / minAreaRect and straightens."""
    h, w = gray.shape[:2]
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    thresh = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
    # Connect characters horizontally into text lines
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (30, 3))
    connected = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)
    contours, _ = cv2.findContours(connected, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)

    angles = []
    for c in contours:
        x, y, cw, ch = cv2.boundingRect(c)
        if cw > w * 0.18 and 8 < ch < h * 0.08:
            rect = cv2.minAreaRect(c)
            angle = rect[-1]
            if angle < -45:
                angle = 90 + angle
            elif angle > 45:
                angle = angle - 90
            if -15.0 <= angle <= 15.0:
                angles.append(angle)

    if len(angles) < 3:
        return gray, 0.0

    median_angle = float(np.median(angles))
    if abs(median_angle) < 0.35:
        return gray, 0.0

    center = (w // 2, h // 2)
    M = cv2.getRotationMatrix2D(center, median_angle, 1.0)
    rotated = cv2.warpAffine(
        gray, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE
    )
    return rotated, round(median_angle, 2)


def crop_bright_paper_if_on_dark_surface(gray: np.ndarray) -> tuple[np.ndarray, bool]:
    """Crops outer dark desk/table margins around bright thermal paper."""
    h, w = gray.shape[:2]
    # Check outer border brightness vs center brightness
    border_pixels = np.concatenate([
        gray[: max(4, h // 25), :].ravel(),
        gray[-max(4, h // 25) :, :].ravel(),
        gray[:, : max(4, w // 25)].ravel(),
        gray[:, -max(4, w // 25) :].ravel(),
    ])
    center_patch = gray[h // 4 : 3 * h // 4, w // 4 : 3 * w // 4]
    if float(np.median(center_patch)) - float(np.median(border_pixels)) < 35:
        return gray, False

    blurred = cv2.GaussianBlur(gray, (9, 9), 0)
    _, mask = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (21, 21))
    closed = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return gray, False

    largest = max(contours, key=cv2.contourArea)
    x, y, cw, ch = cv2.boundingRect(largest)
    if cw * ch < 0.20 * w * h:
        return gray, False

    pad = 16
    x0, y0 = max(0, x - pad), max(0, y - pad)
    x1, y1 = min(w, x + cw + pad), min(h, y + ch + pad)
    return gray[y0:y1, x0:x1], True


def process_receipt(input_path: str, output_path: str):
    # Step 1: Load with Pillow & fix camera EXIF rotation tag automatically!
    pil_img = Image.open(input_path)
    pil_img = ImageOps.exif_transpose(pil_img).convert("RGB")
    orig_w, orig_h = pil_img.size

    rgb = np.array(pil_img)
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)

    # Step 2: Crop dark desk background if present
    gray, did_crop = crop_bright_paper_if_on_dark_surface(gray)

    # Step 3: Normalize width to ~1500px optimal neural LSTM resolution
    h, w = gray.shape[:2]
    target_w = 1500
    scale = target_w / float(w)
    new_w = target_w
    new_h = max(200, int(round(h * scale)))
    interp = cv2.INTER_CUBIC if scale > 1.0 else cv2.INTER_AREA
    resized = cv2.resize(gray, (new_w, new_h), interpolation=interp)

    # Step 4: Auto-deskew tilted hand-held receipt shot
    deskewed, skew_angle = deskew_receipt(resized)

    # Step 5: Illumination shadow removal (flattens phone shadow & warm yellow room light)
    bg_k = max(51, (new_w // 14) | 1)
    bg = cv2.GaussianBlur(deskewed, (bg_k, bg_k), 0)
    flattened = cv2.divide(deskewed, bg, scale=255)

    # Step 6: Gentle CLAHE + level stretching so thermal ink is deep black & paper is clean white
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(flattened)

    p_low, p_high = np.percentile(enhanced, (4, 86))
    if p_high - p_low > 12:
        stretched = np.clip(
            (enhanced.astype(np.float32) - p_low) * (255.0 / (p_high - p_low)), 0, 255
        ).astype(np.uint8)
    else:
        stretched = enhanced

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    Image.fromarray(stretched).save(output_path, "PNG", optimize=True)

    return {
        "ok": True,
        "originalSize": {"width": orig_w, "height": orig_h},
        "processedSize": {"width": new_w, "height": new_h},
        "perspectiveCropped": did_crop,
        "deskewAngle": skew_angle,
        "detectedLineCount": 0,
        "lineBoxes": [],
        "outputPath": output_path,
    }


if __name__ == "__main__":
    in_path = sys.argv[1]
    out_path = sys.argv[2]
    res = process_receipt(in_path, out_path)
    print(json.dumps(res))
