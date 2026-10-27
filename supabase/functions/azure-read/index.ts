const API_VERSION = "2024-11-30";
const MODEL_ID = "prebuilt-read";
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_REQUESTS_PER_MINUTE = 20;
const RATE_WINDOW_MS = 60_000;

const allowedOrigins = new Set([
  "https://saeedsly.github.io",
  "https://gngrgkrypvrgcnkldbhx.supabase.co",
  "capacitor://localhost",
  "https://localhost",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

const recentRequests = new Map<string, number[]>();

type Point = { x: number; y: number };
type NormalizedBox = { x0: number; y0: number; x1: number; y1: number };

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
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  else headers["Access-Control-Allow-Origin"] = "*";
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

function polygonPoints(value: unknown): Point[] {
  if (!Array.isArray(value)) return [];
  if (value.length > 0 && typeof value[0] === "number") {
    const points: Point[] = [];
    for (let i = 0; i + 1 < value.length; i += 2) {
      const x = Number(value[i]);
      const y = Number(value[i + 1]);
      if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y });
    }
    return points;
  }
  return value
    .filter((point): point is Record<string, unknown> => Boolean(point) && typeof point === "object")
    .map((point) => ({ x: Number(point.x), y: Number(point.y) }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

function normalizedBox(line: Record<string, unknown>, page: Record<string, unknown>): NormalizedBox {
  const pageWidth = Number(page.width);
  const pageHeight = Number(page.height);
  const points = polygonPoints(line.polygon ?? line.boundingPolygon);
  if (!points.length || pageWidth <= 0 || pageHeight <= 0) {
    return { x0: 0, y0: 0, x1: 1, y1: 1 };
  }
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    x0: clamp01(Math.min(...xs) / pageWidth),
    y0: clamp01(Math.min(...ys) / pageHeight),
    x1: clamp01(Math.max(...xs) / pageWidth),
    y1: clamp01(Math.max(...ys) / pageHeight),
  };
}

function lineConfidence(line: Record<string, unknown>): number {
  const words = Array.isArray(line.words) ? line.words : [];
  const values = words
    .filter((word): word is Record<string, unknown> => Boolean(word) && typeof word === "object")
    .map((word) => Number(word.confidence))
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 1);
  if (!values.length) return 85;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100);
}

function normalizedLines(result: Record<string, unknown>) {
  const analyzeResult = (result.analyzeResult || {}) as Record<string, unknown>;
  const pages = Array.isArray(analyzeResult.pages) ? analyzeResult.pages : [];
  const lines: Array<{ text: string; confidence: number; bbox: NormalizedBox }> = [];

  for (const pageValue of pages) {
    if (!pageValue || typeof pageValue !== "object") continue;
    const page = pageValue as Record<string, unknown>;
    const pageLines = Array.isArray(page.lines) ? page.lines : [];
    for (const lineValue of pageLines) {
      if (!lineValue || typeof lineValue !== "object") continue;
      const line = lineValue as Record<string, unknown>;
      const text = String(line.content ?? line.text ?? "").trim();
      if (!text) continue;
      lines.push({
        text,
        confidence: lineConfidence(line),
        bbox: normalizedBox(line, page),
      });
    }
  }

  if (lines.length) return lines;
  const content = String(analyzeResult.content ?? "");
  const fallback = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return fallback.map((text, index) => {
    const top = index / Math.max(1, fallback.length);
    const bottom = (index + 1) / Math.max(1, fallback.length);
    return {
      text,
      confidence: 75,
      bbox: { x0: 0, y0: top, x1: 1, y1: bottom },
    };
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
    const configured = Boolean(
      Deno.env.get("AZURE_DI_ENDPOINT")?.trim() && Deno.env.get("AZURE_DI_KEY")?.trim(),
    );
    return jsonResponse(req, {
      ok: true,
      configured,
      provider: "Microsoft Azure Document Intelligence",
      model: MODEL_ID,
      freeTierPagesPerMonth: 500,
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

  const endpoint = Deno.env.get("AZURE_DI_ENDPOINT")?.trim().replace(/\/+$/, "");
  const key = Deno.env.get("AZURE_DI_KEY")?.trim();
  if (!endpoint || !key) {
    return jsonResponse(req, {
      ok: false,
      code: "AZURE_OCR_NOT_CONFIGURED",
      message: "سرویس OCR ابری هنوز پیکربندی نشده است.",
    }, 503);
  }

  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > MAX_IMAGE_BYTES + 128 * 1024) {
    return jsonResponse(req, {
      ok: false,
      code: "IMAGE_TOO_LARGE",
      message: "تصویر از سقف ۴ مگابایت پلن رایگان Azure بزرگ‌تر است.",
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
        code: "IMAGE_TOO_LARGE",
        message: "هر بخش تصویر باید حداکثر ۴ مگابایت باشد.",
      }, 413);
    }
    const supportedTypes = new Set([
      "image/jpeg",
      "image/png",
      "image/bmp",
      "image/tiff",
    ]);
    const mimeType = file.type.toLowerCase();
    if (!supportedTypes.has(mimeType)) {
      return jsonResponse(req, {
        ok: false,
        code: "UNSUPPORTED_IMAGE_TYPE",
        message: "فرمت تصویر پشتیبانی نمی‌شود؛ JPEG یا PNG انتخاب کن.",
      }, 415);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const base64Source = bytesToBase64(bytes);
    const analyzeUrl =
      `${endpoint}/documentintelligence/documentModels/${MODEL_ID}:analyze` +
      `?_overload=analyzeDocument&api-version=${API_VERSION}`;
    const analyzeResponse = await fetchWithTimeout(analyzeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Ocp-Apim-Subscription-Key": key,
      },
      body: JSON.stringify({ base64Source }),
    }, 20_000);

    if (analyzeResponse.status !== 202) {
      const providerStatus = analyzeResponse.status;
      return jsonResponse(req, {
        ok: false,
        code: providerStatus === 429 ? "AZURE_QUOTA_OR_RATE_LIMIT" : "AZURE_ANALYZE_FAILED",
        message: providerStatus === 401 || providerStatus === 403
          ? "کلید یا endpoint سرویس Azure معتبر نیست."
          : providerStatus === 429
            ? "سهمیه یا نرخ درخواست رایگان Azure فعلاً پر شده است."
            : `Azure درخواست OCR را نپذیرفت (HTTP ${providerStatus}).`,
      }, providerStatus === 429 ? 429 : 502);
    }

    const operationLocation = analyzeResponse.headers.get("operation-location");
    if (!operationLocation) {
      return jsonResponse(req, {
        ok: false,
        code: "AZURE_OPERATION_MISSING",
        message: "Azure نشانی پیگیری OCR را برنگرداند.",
      }, 502);
    }
    const operationUrl = new URL(operationLocation);
    if (operationUrl.origin !== new URL(endpoint).origin) {
      return jsonResponse(req, {
        ok: false,
        code: "AZURE_OPERATION_INVALID",
        message: "نشانی پاسخ Azure معتبر نیست.",
      }, 502);
    }

    const deadline = Date.now() + 75_000;
    let retryAfterMs = Math.max(300, Math.min(3_000,
      Number(analyzeResponse.headers.get("retry-after") || 1) * 1_000,
    ));
    while (Date.now() < deadline) {
      await delay(retryAfterMs);
      const resultResponse = await fetchWithTimeout(operationUrl.toString(), {
        method: "GET",
        headers: { "Ocp-Apim-Subscription-Key": key },
      }, 12_000);
      if (!resultResponse.ok) {
        return jsonResponse(req, {
          ok: false,
          code: "AZURE_RESULT_FAILED",
          message: `Azure نتیجهٔ OCR را برنگرداند (HTTP ${resultResponse.status}).`,
        }, 502);
      }
      const result = await resultResponse.json() as Record<string, unknown>;
      const status = String(result.status || "").toLowerCase();
      if (status === "succeeded") {
        const lines = normalizedLines(result);
        if (!lines.length) {
          return jsonResponse(req, {
            ok: false,
            code: "AZURE_NO_TEXT",
            message: "Azure متنی در تصویر پیدا نکرد.",
          }, 422);
        }
        return jsonResponse(req, {
          ok: true,
          engine: "Azure Document Intelligence Read",
          lines,
        });
      }
      if (status === "failed") {
        return jsonResponse(req, {
          ok: false,
          code: "AZURE_ANALYSIS_FAILED",
          message: "خواندن تصویر در Azure ناموفق بود.",
        }, 422);
      }
      retryAfterMs = 750;
    }

    return jsonResponse(req, {
      ok: false,
      code: "AZURE_TIMEOUT",
      message: "زمان پاسخ OCR ابری طولانی شد.",
    }, 504);
  } catch (error) {
    const isAbort = error instanceof DOMException && error.name === "AbortError";
    return jsonResponse(req, {
      ok: false,
      code: isAbort ? "AZURE_TIMEOUT" : "AZURE_REQUEST_FAILED",
      message: isAbort ? "ارتباط با Azure بیش از حد طول کشید." : "ارتباط با سرویس OCR ابری برقرار نشد.",
    }, isAbort ? 504 : 502);
  }
});
