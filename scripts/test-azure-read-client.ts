import assert from 'node:assert/strict';
import { AzureReadError, isAzureReadConfigured, requestAzureRead } from '../src/lib/azureReadClient';

async function main() {
  const originalFetch = globalThis.fetch;
  let configured = true;
  let failure: { status: number; code: string } | null = null;
  let postCalls = 0;
  let lastHeaders: Headers | null = null;
  let lastBody: BodyInit | null | undefined;

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    lastHeaders = new Headers(init?.headers);
    if (init?.method === 'GET') {
      return new Response(JSON.stringify({ ok: true, configured }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    postCalls++;
    lastBody = init?.body;
    if (failure) {
      return new Response(JSON.stringify({
        ok: false,
        code: failure.code,
        message: 'simulated provider failure',
      }), {
        status: failure.status,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      lines: [
        { text: 'نان سنگک', confidence: 88, bbox: { x0: -0.2, y0: 0.1, x1: 0.9, y1: 1.2 } },
        { text: '', confidence: 99, bbox: { x0: 0, y0: 0, x1: 1, y1: 1 } },
        { text: 'invalid box', confidence: 95, bbox: { x0: 'bad', y0: 0, x1: 1, y1: 1 } },
      ],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    assert.equal(await isAzureReadConfigured(), true);
    assert.match(lastHeaders?.get('apikey') || '', /^sb_publishable_/);

    const image = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'receipt.jpg', { type: 'image/jpeg' });
    const lines = await requestAzureRead(image);
    assert.equal(postCalls, 1);
    assert.ok(lastBody instanceof FormData);
    assert.ok((lastBody as FormData).get('image') instanceof Blob);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].text, 'نان سنگک');
    assert.equal(lines[0].bbox.x0, 0);
    assert.equal(lines[0].bbox.y1, 1);
    assert.equal(lines[0].confidence, 88);

    configured = false;
    assert.equal(await isAzureReadConfigured(), false);
    assert.equal(postCalls, 1, 'an unconfigured service must not receive an image');

    failure = { status: 429, code: 'AZURE_QUOTA_EXCEEDED' };
    await assert.rejects(
      requestAzureRead(image),
      (error: unknown) => error instanceof AzureReadError &&
        error.code === 'AZURE_QUOTA_EXCEEDED' && error.status === 429,
    );

    console.log('PASS: status gate, multipart image request, normalized OCR lines, and quota error mapping (mocked; no network).');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void main();
