const OCR_SPACE_ENDPOINT = "https://api.ocr.space/parse/image";
const MAX_IMAGE_BYTES = 1_000_000;
const MAX_REQUESTS_PER_MINUTE = 20;
const RATE_WINDOW_MS = 60_000;

// Keep the existing function route (`azure-read`) so already-installed v1.4.4 clients
// can continue using it. The function itself now proxies OCR.space, not Azure.
const allowedOrigins = new Set([
  "https://saeedsly.github.io",
  "https://gngrgkrypvrgcnkldbhx.supabase.co",
  "capacitor://localhost",
  "https://localhost",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

const recentRequests = new Map<string, number[]>();

type NormalizedBox = { x0: number; y0: number; x1: number; y1: number };
type NormalizedLine = { text: string; confidence: number; bbox: NormalizedBox };

function originAllowed(origin: string | null): boolean {
  return !origin || allowedOrigins.has(origin);
}

function responseHeaders(origin: string | null): HeadersInit {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin",
  };
  headers["Access-Control-Allow-Origin"] = origin || "*";
  return headers;
}

function jsonResponse(
  req: Request,
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(req.headers.get("origin")),
  });
}

function requestKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip") || "unknown-client";
}

function allowRateLimitedRequest(req: Request): boolean {
  const now = Date.now();
  const key = requestKey(req);
  const recent = (recentRequests.get(key) || []).filter((time) => now - time < RATE_WINDOW_MS);
  if (recent.length >= MAX_REQUESTS_PER_MINUTE) return false;
  recent.push(now);
  recentRequests.set(key, recent);
  return true;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function imageDimension(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string") return null;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= 20_000 ? number : null;
}

function lineConfidence(words: unknown[]): number {
  const values = words
    .map(asRecord)
    .filter((word): word is Record<string, unknown> => Boolean(word))
    .map((word) => finiteNumber(word.Confidence ?? word.confidence))
    .filter((value): value is number => value !== null && value >= 0 && value <= 100);
  return values.length
    ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    : 85;
}

function overlayLine(
  value: unknown,
  index: number,
  lineCount: number,
  imageWidth: number | null,
  imageHeight: number | null,
): NormalizedLine | null {
  const line = asRecord(value);
  if (!line) return null;
  const text = String(line.LineText ?? line.lineText ?? "").trim();
  if (!text) return null;

  const rawWords = Array.isArray(line.Words) ? line.Words : [];
  const words = rawWords.map(asRecord).filter((word): word is Record<string, unknown> => Boolean(word));
  const positioned = words.flatMap((word) => {
    const left = finiteNumber(word.Left ?? word.left);
    const top = finiteNumber(word.Top ?? word.top);
    const width = finiteNumber(word.Width ?? word.width);
    const height = finiteNumber(word.Height ?? word.height);
    if (left === null || top === null || width === null || height === null) return [];
    return [{ left, top, right: left + Math.max(0, width), bottom: top + Math.max(0, height) }];
  });

  const minTop = finiteNumber(line.MinTop ?? line.minTop);
  const maxHeight = finiteNumber(line.MaxHeight ?? line.maxHeight);
  let box: NormalizedBox;
  if (imageWidth && imageHeight && positioned.length) {
    const left = Math.min(...positioned.map((word) => word.left));
    const top = Math.min(...positioned.map((word) => word.top));
    const right = Math.max(...positioned.map((word) => word.right));
    const bottom = Math.max(...positioned.map((word) => word.bottom));
    box = {
      x0: clamp01(left / imageWidth),
      y0: clamp01(top / imageHeight),
      x1: clamp01(right / imageWidth),
      y1: clamp01(bottom / imageHeight),
    };
  } else if (imageHeight && minTop !== null && maxHeight !== null && maxHeight > 0) {
    box = {
      x0: 0,
      y0: clamp01(minTop / imageHeight),
      x1: 1,
      y1: clamp01((minTop + maxHeight) / imageHeight),
    };
  } else {
    // Older installed clients do not send image dimensions. Preserve row order with
    // approximate vertical boxes; text extraction remains fully usable.
    const top = index / Math.max(1, lineCount);
    box = { x0: 0, y0: top, x1: 1, y1: (index + 1) / Math.max(1, lineCount) };
  }

  return { text, confidence: lineConfidence(rawWords), bbox: box };
}

function textLines(
  parsedResults: unknown[],
  imageWidth: number | null,
  imageHeight: number | null,
): NormalizedLine[] {
  const allLines: NormalizedLine[] = [];
  for (const resultValue of parsedResults) {
    const result = asRecord(resultValue);
    if (!result) continue;
    const textOverlay = asRecord(result.TextOverlay ?? result.textOverlay);
    const overlayLines = textOverlay && Array.isArray(textOverlay.Lines) ? textOverlay.Lines : [];
    const normalized = overlayLines
      .map((line, index) => overlayLine(line, index, overlayLines.length, imageWidth, imageHeight))
      .filter((line): line is NormalizedLine => Boolean(line));
    if (normalized.length) {
      allLines.push(...normalized);
      continue;
    }

    const parsedText = String(result.ParsedText ?? result.parsedText ?? "");
    const fallback = parsedText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    fallback.forEach((text, index) => {
      const top = index / Math.max(1, fallback.length);
      allLines.push({
        text,
        confidence: 75,
        bbox: { x0: 0, y0: top, x1: 1, y1: (index + 1) / Math.max(1, fallback.length) },
      });
    });
  }
  return allLines;
}

function providerErrorText(payload: Record<string, unknown>): string {
  const values = [payload.ErrorMessage, payload.ErrorDetails, payload.error, payload.message];
  return values.flatMap((value) => Array.isArray(value) ? value : [value])
    .filter((value) => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

function quotaError(message: string): boolean {
  return /quota|rate.?limit|too many|daily limit|monthly limit|exceeded.*request|maximum.*request/.test(message);
}

function providerFailure(req: Request, status: number, message: string): Response {
  if (quotaError(message) || status === 429) {
    return jsonResponse(req, {
      ok: false,
      code: "OCR_SPACE_QUOTA_OR_RATE_LIMIT",
      message: "سهمیهٔ رایگان یا سقف درخواست OCR.space فعلاً پر شده است.",
    }, 429);
  }
  if (status === 401 || status === 403 || /invalid.*key|unauthorized|api.?key/.test(message)) {
    return jsonResponse(req, {
      ok: false,
      code: "OCR_SPACE_API_KEY_INVALID",
      message: "کلید OCR.space معتبر نیست یا دسترسی آن پذیرفته نشد.",
    }, 502);
  }
  if (status === 413 || /file.*large|size.*limit|exceed.*size/.test(message)) {
    return jsonResponse(req, {
      ok: false,
      code: "OCR_SPACE_IMAGE_TOO_LARGE",
      message: "OCR.space فقط فایل‌های حداکثر ۱ مگابایت را می‌پذیرد.",
    }, 413);
  }
  return jsonResponse(req, {
    ok: false,
    code: "OCR_SPACE_PROCESSING_FAILED",
    message: "OCR.space نتوانست این تصویر را پردازش کند.",
  }, 502);
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (!originAllowed(origin)) {
    return new Response("Forbidden origin", { status: 403 });
  }
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: responseHeaders(origin) });
  }
  if (req.method === "GET") {
    const configured = Boolean(Deno.env.get("OCR_SPACE_API_KEY")?.trim());
    return jsonResponse(req, {
      ok: true,
      configured,
      provider: "OCR.space",
      engine: 3,
      language: "fas",
      isTable: true,
      maxImageBytes: MAX_IMAGE_BYTES,
      freeEngine3ConversionsPerMonth: 1_000,
      freeRequestsPerDayPerIp: 500,
    });
  }
  if (req.method !== "POST") {
    return jsonResponse(req, { ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  }
  if (!allowRateLimitedRequest(req)) {
    return jsonResponse(req, {
      ok: false,
      code: "RATE_LIMITED",
      message: "تعداد درخواست‌ها زیاد است؛ کمی بعد دوباره امتحان کن.",
    }, 429);
  }

  const apiKey = Deno.env.get("OCR_SPACE_API_KEY")?.trim();
  if (!apiKey) {
    return jsonResponse(req, {
      ok: false,
      code: "OCR_SPACE_NOT_CONFIGURED",
      message: "سرویس OCR ابری هنوز پیکربندی نشده است.",
    }, 503);
  }

  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > MAX_IMAGE_BYTES + 128 * 1024) {
    return jsonResponse(req, {
      ok: false,
      code: "OCR_SPACE_IMAGE_TOO_LARGE",
      message: "هر فایل OCR ابری باید حداکثر ۱ مگابایت باشد.",
    }, 413);
  }

  try {
    const form = await req.formData();
    const file = form.get("image");
    if (!(file instanceof File)) {
      return jsonResponse(req, {
        ok: false,
        code: "IMAGE_REQUIRED",
        message: "تصویر فاکتور ارسال نشده است.",
      }, 400);
    }
    if (!file.size || file.size > MAX_IMAGE_BYTES) {
      return jsonResponse(req, {
        ok: false,
        code: "OCR_SPACE_IMAGE_TOO_LARGE",
        message: "هر فایل OCR ابری باید حداکثر ۱ مگابایت باشد.",
      }, 413);
    }
    const supportedTypes = new Set([
      "image/jpeg",
      "image/png",
      "image/bmp",
      "image/tiff",
    ]);
    if (!supportedTypes.has(file.type.toLowerCase())) {
      return jsonResponse(req, {
        ok: false,
        code: "UNSUPPORTED_IMAGE_TYPE",
        message: "فرمت تصویر پشتیبانی نمی‌شود؛ JPEG یا PNG انتخاب کن.",
      }, 415);
    }

    const imageWidth = imageDimension(form.get("imageWidth"));
    const imageHeight = imageDimension(form.get("imageHeight"));
    const providerForm = new FormData();
    providerForm.set("file", file, file.name || "receipt-image.jpg");
    providerForm.set("language", "fas");
    providerForm.set("OCREngine", "3");
    providerForm.set("isTable", "true");
    providerForm.set("isOverlayRequired", "true");

    const providerResponse = await fetchWithTimeout(OCR_SPACE_ENDPOINT, {
      method: "POST",
      headers: { apikey: apiKey },
      body: providerForm,
    }, 75_000);

    let providerPayload: Record<string, unknown> = {};
    try {
      const value = await providerResponse.json();
      providerPayload = asRecord(value) || {};
    } catch {
      if (!providerResponse.ok) return providerFailure(req, providerResponse.status, "");
      return jsonResponse(req, {
        ok: false,
        code: "OCR_SPACE_INVALID_RESPONSE",
        message: "پاسخ OCR.space قابل خواندن نبود.",
      }, 502);
    }

    const providerMessage = providerErrorText(providerPayload);
    if (!providerResponse.ok) {
      return providerFailure(req, providerResponse.status, providerMessage);
    }

    const errored = providerPayload.IsErroredOnProcessing === true ||
      String(providerPayload.IsErroredOnProcessing).toLowerCase() === "true";
    const exitCode = finiteNumber(providerPayload.OCRExitCode);
    if (errored || (exitCode !== null && ![1, 2].includes(exitCode))) {
      if (exitCode === 4) {
        return jsonResponse(req, {
          ok: false,
          code: "OCR_SPACE_NO_TEXT",
          message: "OCR.space متنی در تصویر پیدا نکرد.",
        }, 422);
      }
      if (exitCode === 6) return providerFailure(req, 413, providerMessage || "file size limit");
      if (exitCode === 99) {
        return jsonResponse(req, {
          ok: false,
          code: "OCR_SPACE_TIMEOUT",
          message: "زمان پردازش OCR.space طولانی شد.",
        }, 504);
      }
      return providerFailure(req, 502, providerMessage);
    }

    const parsedResults = Array.isArray(providerPayload.ParsedResults)
      ? providerPayload.ParsedResults
      : [];
    const lines = textLines(parsedResults, imageWidth, imageHeight);
    if (!lines.length) {
      return jsonResponse(req, {
        ok: false,
        code: "OCR_SPACE_NO_TEXT",
        message: "OCR.space متنی در تصویر پیدا نکرد.",
      }, 422);
    }

    return jsonResponse(req, {
      ok: true,
      engine: "OCR.space Engine 3",
      lines,
    });
  } catch (error) {
    const isAbort = error instanceof DOMException && error.name === "AbortError";
    return jsonResponse(req, {
      ok: false,
      code: isAbort ? "OCR_SPACE_TIMEOUT" : "OCR_SPACE_REQUEST_FAILED",
      message: isAbort ? "ارتباط با OCR.space بیش از حد طول کشید." : "ارتباط با سرویس OCR ابری برقرار نشد.",
    }, isAbort ? 504 : 502);
  }
});
