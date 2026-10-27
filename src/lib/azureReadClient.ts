const AZURE_READ_FUNCTION_URL =
  'https://gngrgkrypvrgcnkldbhx.supabase.co/functions/v1/azure-read';

// A Supabase publishable key is designed to be embedded in public clients.
// Never place the Azure Document Intelligence key or a Supabase service-role key here.
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_nZCvspHyWsKCFhk34NQHxQ_M7gQL23W';

export interface AzureReadLine {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export class AzureReadError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = 'AzureReadError';
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
    throw new AzureReadError(
      String(payload.code || 'AZURE_READ_FAILED'),
      response.status,
      String(payload.message || 'سرویس OCR ابری در دسترس نیست.'),
    );
  }
  return payload;
}

export async function isAzureReadConfigured(signal?: AbortSignal): Promise<boolean> {
  const response = await fetch(AZURE_READ_FUNCTION_URL, {
    method: 'GET',
    headers: requestHeaders(),
    signal,
  });
  const payload = await parseResponse(response);
  return payload.configured === true;
}

export async function requestAzureRead(
  image: File,
  signal?: AbortSignal,
): Promise<AzureReadLine[]> {
  const formData = new FormData();
  formData.append('image', image, image.name || 'receipt-image');
  const response = await fetch(AZURE_READ_FUNCTION_URL, {
    method: 'POST',
    headers: requestHeaders(),
    body: formData,
    signal,
  });
  const payload = await parseResponse(response);
  if (!Array.isArray(payload.lines)) {
    throw new AzureReadError('AZURE_READ_INVALID_RESPONSE', response.status, 'پاسخ OCR ابری معتبر نیست.');
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
