import assert from 'node:assert/strict';

type EdgeHandler = (request: Request) => Response | Promise<Response>;

async function main() {
  const originalFetch = globalThis.fetch;
  const environment: Record<string, string> = {};
  let edgeHandler: EdgeHandler | undefined;
  let providerPostCount = 0;
  let providerStatus = 200;
  const providerEndpoint = 'https://api.ocr.space/parse/image';

  (globalThis as typeof globalThis & { Deno?: unknown }).Deno = {
    serve: (handler: EdgeHandler) => { edgeHandler = handler; },
    env: { get: (name: string) => environment[name] },
  };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.href, providerEndpoint);
    assert.equal(init?.method, 'POST');
    assert.equal(new Headers(init?.headers).get('apikey'), 'test-key');
    assert.ok(init?.body instanceof FormData);
    const providerForm = init?.body as FormData;
    assert.ok(providerForm.get('file') instanceof Blob);
    assert.equal(providerForm.get('language'), 'fas');
    assert.equal(providerForm.get('OCREngine'), '3');
    assert.equal(providerForm.get('isTable'), 'true');
    assert.equal(providerForm.get('isOverlayRequired'), 'true');
    providerPostCount++;

    if (providerStatus === 429) {
      return new Response(JSON.stringify({ ErrorMessage: 'rate limit exceeded' }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({
      OCRExitCode: 1,
      IsErroredOnProcessing: false,
      ParsedResults: [{
        ParsedText: 'نان سنگک',
        TextOverlay: {
          HasOverlay: true,
          Lines: [{
            LineText: 'نان سنگک',
            MinTop: 20,
            MaxHeight: 20,
            Words: [
              { WordText: 'نان', Left: 10, Top: 20, Height: 20, Width: 35, Confidence: 93 },
              { WordText: 'سنگک', Left: 50, Top: 20, Height: 20, Width: 100, Confidence: 93 },
            ],
          }],
        },
      }],
    }), {
      status: providerStatus,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    await import('../supabase/functions/azure-read/index.ts');
    assert.ok(edgeHandler, 'Deno.serve should register the Edge Function handler');
    const handle = edgeHandler!;
    const functionUrl = 'https://gngrgkrypvrgcnkldbhx.supabase.co/functions/v1/azure-read';

    const healthResponse = await handle(new Request(functionUrl, {
      method: 'GET',
      headers: { origin: 'https://saeedsly.github.io' },
    }));
    const health = await healthResponse.json() as {
      configured?: boolean;
      provider?: string;
      engine?: number;
      language?: string;
      isTable?: boolean;
      maxImageBytes?: number;
      freeEngine3ConversionsPerMonth?: number;
    };
    assert.equal(healthResponse.status, 200);
    assert.equal(health.configured, false);
    assert.equal(health.provider, 'OCR.space');
    assert.equal(health.engine, 3);
    assert.equal(health.language, 'fas');
    assert.equal(health.isTable, true);
    assert.equal(health.maxImageBytes, 1_000_000);
    assert.equal(health.freeEngine3ConversionsPerMonth, 1_000);
    assert.equal(providerPostCount, 0, 'health check must not contact OCR.space or upload an image');

    const preflight = await handle(new Request(functionUrl, {
      method: 'OPTIONS',
      headers: { origin: 'https://saeedsly.github.io' },
    }));
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://saeedsly.github.io');

    const rejectedOrigin = await handle(new Request(functionUrl, {
      method: 'GET',
      headers: { origin: 'https://untrusted.example' },
    }));
    assert.equal(rejectedOrigin.status, 403);

    environment.OCR_SPACE_API_KEY = 'test-key';
    const form = new FormData();
    form.append('image', new File([new Uint8Array([1, 2, 3])], 'receipt.jpg', { type: 'image/jpeg' }));
    form.append('imageWidth', '200');
    form.append('imageHeight', '400');
    const uploadResponse = await handle(new Request(functionUrl, {
      method: 'POST',
      headers: { origin: 'https://saeedsly.github.io' },
      body: form,
    }));
    const result = await uploadResponse.json() as {
      ok?: boolean;
      engine?: string;
      lines?: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }>;
    };
    assert.equal(uploadResponse.status, 200);
    assert.equal(result.ok, true);
    assert.equal(result.engine, 'OCR.space Engine 3');
    assert.equal(providerPostCount, 1);
    assert.equal(result.lines?.length, 1);
    assert.equal(result.lines?.[0].text, 'نان سنگک');
    assert.equal(result.lines?.[0].confidence, 93);
    assert.deepEqual(result.lines?.[0].bbox, { x0: 0.05, y0: 0.05, x1: 0.75, y1: 0.1 });

    // The old v1.4.4 APK sends the same image field but no dimensions. Keep its
    // normalized line response usable while the new client adds image dimensions.
    const legacyForm = new FormData();
    legacyForm.append('image', new File([new Uint8Array([1, 2, 3])], 'legacy.jpg', { type: 'image/jpeg' }));
    const legacyResponse = await handle(new Request(functionUrl, {
      method: 'POST',
      headers: { origin: 'https://saeedsly.github.io' },
      body: legacyForm,
    }));
    const legacyResult = await legacyResponse.json() as {
      lines?: Array<{ bbox: { x0: number; y0: number; x1: number; y1: number } }>;
    };
    assert.equal(legacyResponse.status, 200);
    assert.deepEqual(legacyResult.lines?.[0].bbox, { x0: 0, y0: 0, x1: 1, y1: 1 });
    assert.equal(providerPostCount, 2);

    const oversizedForm = new FormData();
    oversizedForm.append('image', new File([new Uint8Array(1_000_001)], 'large.jpg', { type: 'image/jpeg' }));
    const oversizedResponse = await handle(new Request(functionUrl, {
      method: 'POST',
      headers: { origin: 'https://saeedsly.github.io' },
      body: oversizedForm,
    }));
    assert.equal(oversizedResponse.status, 413);
    assert.equal(providerPostCount, 2, 'oversized images must not be forwarded to OCR.space');

    providerStatus = 429;
    const quotaForm = new FormData();
    quotaForm.append('image', new File([new Uint8Array([1, 2, 3])], 'receipt.jpg', { type: 'image/jpeg' }));
    const quotaResponse = await handle(new Request(functionUrl, {
      method: 'POST',
      headers: { origin: 'https://saeedsly.github.io' },
      body: quotaForm,
    }));
    const quota = await quotaResponse.json() as { code?: string };
    assert.equal(quotaResponse.status, 429);
    assert.equal(quota.code, 'OCR_SPACE_QUOTA_OR_RATE_LIMIT');

    console.log('PASS: function status gate, CORS, OCR.space Engine 3 request, 1 MB guard, normalized response, and quota mapping (mocked; no network).');
  } finally {
    globalThis.fetch = originalFetch;
    delete (globalThis as typeof globalThis & { Deno?: unknown }).Deno;
  }
}

void main();
