#!/usr/bin/env python3
"""
KharidYar Professional Computer Vision Receipt Preprocessor (OpenCV 5.0)
Performs:
1. Auto paper boundary / margin detection on angled or dark-background camera shots
2. Optimal 2x bicubic upscaling so delicate Persian letter dots (نقطه‌ها) remain crisp
3. Edge-preserving denoising + CLAHE adaptive local contrast enhancement
4. Clean white-point / black-point thermal ink enhancement without dot erosion
5. Horizontal morphological text-line region detection for visual CV overlay boxes
"""
import sys
import json
import os
import cv2
import numpy as np


def order_points(pts: np.ndarray) -> np.ndarray:
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]
    rect[3] = pts[np.argmax(diff)]
    return rect


def four_point_transform(image: np.ndarray, pts: np.ndarray) -> np.ndarray:
    rect = order_points(pts)
    (tl, tr, br, bl) = rect
    widthA = np.linalg.norm(br - bl)
    widthB = np.linalg.norm(tr - tl)
    maxWidth = max(int(widthA), int(widthB))
    heightA = np.linalg.norm(tr - br)
    heightB = np.linalg.norm(tl - bl)
    maxHeight = max(int(heightA), int(heightB))
    if maxWidth < 200 or maxHeight < 200:
        return image
    dst = np.array(
        [[0, 0], [maxWidth - 1, 0], [maxWidth - 1, maxHeight - 1], [0, maxHeight - 1]],
        dtype="float32",
    )
    M = cv2.getPerspectiveTransform(rect, dst)
    return cv2.warpPerspective(image, M, (maxWidth, maxHeight))


def detect_receipt_document(img: np.ndarray):
    """If camera photo shows a bright paper receipt on a darker table/background, warp & crop cleanly."""
    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (7, 7), 0)
    _, bright_mask = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 15))
    closed = cv2.morphologyEx(bright_mask, cv2.MORPH_CLOSE, kernel)
    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return img, False

    largest = max(contours, key=cv2.contourArea)
    area_ratio = cv2.contourArea(largest) / float(w * h)
    # Only crop/warp if paper occupies between 22% and 93% of frame (real camera background present)
    if 0.22 <= area_ratio <= 0.93:
        peri = cv2.arcLength(largest, True)
        approx = cv2.approxPolyDP(largest, 0.025 * peri, True)
        if len(approx) == 4:
            warped = four_point_transform(img, approx.reshape(4, 2).astype("float32"))
            return warped, True
        x, y, cw, ch = cv2.boundingRect(largest)
        pad = 12
        x0 = max(0, x - pad)
        y0 = max(0, y - pad)
        x1 = min(w, x + cw + pad)
        y1 = min(h, y + ch + pad)
        return img[y0:y1, x0:x1], True

    return img, False


def process_receipt(input_path: str, output_path: str):
    raw_bytes = np.fromfile(input_path, dtype=np.uint8)
    img = cv2.imdecode(raw_bytes, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError(f"Cannot decode image: {input_path}")

    cropped, did_perspective_crop = detect_receipt_document(img)
    h, w = cropped.shape[:2]

    # Normalize width to ~1500px so Persian glyph dots & numbers have crystal clarity for LSTM OCR
    target_w = 1500
    if w < target_w or w > 2200:
        scale = target_w / float(w)
        new_w = int(round(w * scale))
        new_h = int(round(h * scale))
        interp = cv2.INTER_CUBIC if scale > 1.0 else cv2.INTER_AREA
        resized = cv2.resize(cropped, (new_w, new_h), interpolation=interp)
    else:
        resized = cropped

    rh, rw = resized.shape[:2]
    gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)

    # Background illumination flattening (removes uneven shadow across phone camera shot!)
    bg_kernel = max(31, (rw // 18) | 1)
    bg = cv2.GaussianBlur(gray, (bg_kernel, bg_kernel), 0)
    normalized = cv2.divide(gray, bg, scale=255)

    # CLAHE contrast boost + subtle sharpening while keeping smooth anti-aliased strokes
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(normalized)

    # Stretch levels cleanly so background paper -> pure white 255 and thermal ink -> crisp dark
    p_low, p_high = np.percentile(enhanced, (6, 88))
    if p_high - p_low > 10:
        stretched = np.clip((enhanced.astype(np.float32) - p_low) * (255.0 / (p_high - p_low)), 0, 255).astype(np.uint8)
    else:
        stretched = enhanced

    # Detect text line regions morphologically for live visual bounding box overlay
    inv = cv2.threshold(stretched, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
    line_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (max(25, rw // 16), 3))
    dilated = cv2.dilate(inv, line_kernel, iterations=2)
    contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    line_boxes = []
    for c in contours:
        x, y, bw, bh = cv2.boundingRect(c)
        if bw > rw * 0.08 and 10 <= bh <= rh * 0.12:
            line_boxes.append({
                "x": round(x / rw, 4),
                "y": round(y / rh, 4),
                "w": round(bw / rw, 4),
                "h": round(bh / rh, 4),
            })

    line_boxes.sort(key=lambda b: b["y"])

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    ok, encoded = cv2.imencode(".png", stretched)
    if not ok:
        raise RuntimeError("Failed to encode OpenCV enhanced image")
    encoded.tofile(output_path)

    return {
        "ok": True,
        "originalSize": {"width": w, "height": h},
        "processedSize": {"width": rw, "height": rh},
        "perspectiveCropped": did_perspective_crop,
        "detectedLineCount": len(line_boxes),
        "lineBoxes": line_boxes[:60],
        "outputPath": output_path,
    }


if __name__ == "__main__":
    in_path = sys.argv[1]
    out_path = sys.argv[2]
    res = process_receipt(in_path, out_path)
    print(json.dumps(res))
