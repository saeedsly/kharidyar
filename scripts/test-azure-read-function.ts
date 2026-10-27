import assert from 'node:assert/strict';

type EdgeHandler = (request: Request) => Response | Promise<Response>;

async function main() {
  const originalFetch = globalThis.fetch;
  const environment: Record<string, string> = {};
  let edgeHandler: EdgeHandler | undefined;
  let azurePostCount = 0;
  let azurePollCount = 0;
  const endpoint = 'https://kharidyar-test.cognitiveservices.azure.com';
  const operationUrl = `${endpoint}/documentintelligence/documentModels/prebuilt-read/analyzeResults/test-id?api-version=2024-11-30`;

  (globalThis as typeof globalThis & { Deno?: unknown }).Deno = {
    serve: (handler: EdgeHandler) => { edgeHandler = handler; },
    env: { get: (name: string) => environment[name] },
  };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (init?.method === 'POST') {
      azurePostCount++;
      assert.equal(url.origin, endpoint);
      assert.equal(url.pathname, '/documentintelligence/documentModels/prebuilt-read:analyze');
      assert.equal(url.searchParams.get('_overload'), 'analyzeDocument');
      assert.equal(url.searchParams.get('api-version'), '2024-11-30');
      assert.ok(new Headers(init.headers).has('Ocp-Apim-Subscription-Key'));
      const body = JSON.parse(String(init.body)) as { base64Source?: string };
      assert.equal(body.base64Source, 'AQID');
      return new Response(null, {
        status: 202,
        headers: { 'operation-location': operationUrl, 'retry-after': '-1' },
      });
    }
    if (url.href === operationUrl) {
      azurePollCount++;
      return new Response(JSON.stringify({
        status: 'succeeded',
        analyzeResult: {
          pages: [{
            width: 200,
            height: 400,
            lines: [{
              content: 'نان سنگک',
              polygon: [10, 20, 150, 20, 150, 40, 10, 40],
              words: [{ confidence: 0.93 }],
            }],
          }],
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`Unexpected mocked Azure request: ${url.pathname}`);
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
    const health = await healthResponse.json() as { configured?: boolean };
    assert.equal(healthResponse.status, 200);
    assert.equal(health.configured, false);
    assert.equal(azurePostCount, 0, 'health check must not contact Azure or upload an image');

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

    environment.AZURE_DI_ENDPOINT = endpoint;
    environment.AZURE_DI_KEY = 'test-key';
    const form = new FormData();
    form.append('image', new File([new Uint8Array([1, 2, 3])], 'receipt.jpg', { type: 'image/jpeg' }));
    const uploadResponse = await handle(new Request(functionUrl, {
      method: 'POST',
      headers: { origin: 'https://saeedsly.github.io' },
      body: form,
    }));
    const result = await uploadResponse.json() as {
      ok?: boolean;
      lines?: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }>;
    };
    assert.equal(uploadResponse.status, 200);
    assert.equal(result.ok, true);
    assert.equal(azurePostCount, 1);
    assert.equal(azurePollCount, 1);
    assert.equal(result.lines?.length, 1);
    assert.equal(result.lines?.[0].text, 'نان سنگک');
    assert.equal(result.lines?.[0].confidence, 93);
    assert.deepEqual(result.lines?.[0].bbox, { x0: 0.05, y0: 0.05, x1: 0.75, y1: 0.1 });

    console.log('PASS: Edge Function status gate, CORS, Azure analyze/poll flow, and normalized OCR response (mocked; no network).');
  } finally {
    globalThis.fetch = originalFetch;
    delete (globalThis as typeof globalThis & { Deno?: unknown }).Deno;
  }
}

void main();
