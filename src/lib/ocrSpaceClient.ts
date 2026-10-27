const OCR_SPACE_FUNCTION_URL =
  'https://gngrgkrypvrgcnkldbhx.supabase.co/functions/v1/azure-read';
const MAX_IMAGE_BYTES = 1_000_000;

// The Supabase publishable key is public by design. The OCR.space API key remains only
// in the Edge Function secret store and is never included in this client or an APK.
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_nZCvspHyWsKCFhk34NQHxQ_M7gQL23W';

export interface OcrSpaceLine {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export class OcrSpaceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = 'OcrSpaceError';
    this.code = code;
    this.status = status;
  }
}

function requestHeaders(): HeadersInit {
  return { apikey: SUPABASE_PUBLISHABLE_KEY };
}

async function parseResponse(response: Response): Promise<Record<string, unknown>> {
  let payload: Record<string, unknown> = {};
  try {
    const value = await response.json();
    if (value && typeof value === 'object') payload = value as Record<string, unknown>;
  } catch {
    // A non-JSON gateway error is surfaced below as a generic cloud OCR failure.
  }
  if (!response.ok || payload.ok === false) {
    throw new OcrSpaceError(
      String(payload.code || 'OCR_SPACE_REQUEST_FAILED'),
      response.status,
      String(payload.message || 'سرویس OCR ابری در دسترس نیست.'),
    );
  }
  return payload;
}

export async function isOcrSpaceConfigured(signal?: AbortSignal): Promise<boolean> {
  const response = await fetch(OCR_SPACE_FUNCTION_URL, {
    method: 'GET',
    headers: requestHeaders(),
    signal,
  });
  const payload = await parseResponse(response);
  return payload.configured === true;
}

export async function requestOcrSpace(
  image: File,
  imageWidth: number,
  imageHeight: number,
  signal?: AbortSignal,
): Promise<OcrSpaceLine[]> {
  if (!image.size || image.size > MAX_IMAGE_BYTES) {
    throw new OcrSpaceError(
      'OCR_SPACE_IMAGE_TOO_LARGE',
      413,
      'هر بخش تصویر برای OCR ابری باید حداکثر ۱ مگابایت باشد.',
    );
  }

  const formData = new FormData();
  formData.append('image', image, image.name || 'receipt-image.jpg');
  formData.append('imageWidth', String(imageWidth));
  formData.append('imageHeight', String(imageHeight));
  const response = await fetch(OCR_SPACE_FUNCTION_URL, {
    method: 'POST',
    headers: requestHeaders(),
    body: formData,
    signal,
  });
  const payload = await parseResponse(response);
  if (!Array.isArray(payload.lines)) {
    throw new OcrSpaceError(
      'OCR_SPACE_INVALID_RESPONSE',
      response.status,
      'پاسخ OCR ابری معتبر نیست.',
    );
  }

  return payload.lines.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const line = value as Record<string, unknown>;
    const box = line.bbox && typeof line.bbox === 'object'
      ? line.bbox as Record<string, unknown>
      : null;
    const text = String(line.text || '').trim();
    if (!text || !box) return [];
    const coordinates = {
      x0: Number(box.x0),
      y0: Number(box.y0),
      x1: Number(box.x1),
      y1: Number(box.y1),
    };
    if (Object.values(coordinates).some((coordinate) => !Number.isFinite(coordinate))) return [];
    return [{
      text,
      confidence: Math.max(0, Math.min(100, Number(line.confidence) || 0)),
      bbox: {
        x0: Math.max(0, Math.min(1, coordinates.x0)),
        y0: Math.max(0, Math.min(1, coordinates.y0)),
        x1: Math.max(0, Math.min(1, coordinates.x1)),
        y1: Math.max(0, Math.min(1, coordinates.y1)),
      },
    }];
  });
}
