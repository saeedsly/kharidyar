import assert from 'node:assert/strict';
import { OcrSpaceError, isOcrSpaceConfigured, requestOcrSpace } from '../src/lib/ocrSpaceClient';

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
    assert.equal(await isOcrSpaceConfigured(), true);
    assert.match(lastHeaders?.get('apikey') || '', /^sb_publishable_/);

    const image = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'receipt.jpg', { type: 'image/jpeg' });
    const lines = await requestOcrSpace(image, 200, 400);
    assert.equal(postCalls, 1);
    assert.ok(lastBody instanceof FormData);
    const form = lastBody as FormData;
    assert.ok(form.get('image') instanceof Blob);
    assert.equal(form.get('imageWidth'), '200');
    assert.equal(form.get('imageHeight'), '400');
    assert.equal(lines.length, 1);
    assert.equal(lines[0].text, 'نان سنگک');
    assert.equal(lines[0].bbox.x0, 0);
    assert.equal(lines[0].bbox.y1, 1);
    assert.equal(lines[0].confidence, 88);

    configured = false;
    assert.equal(await isOcrSpaceConfigured(), false);
    assert.equal(postCalls, 1, 'an unconfigured service must not receive an image');

    const tooLarge = new File([new Uint8Array(1_000_001)], 'large.jpg', { type: 'image/jpeg' });
    await assert.rejects(
      requestOcrSpace(tooLarge, 200, 400),
      (error: unknown) => error instanceof OcrSpaceError && error.code === 'OCR_SPACE_IMAGE_TOO_LARGE',
    );
    assert.equal(postCalls, 1, 'an oversized image must not be sent to the function');

    failure = { status: 429, code: 'OCR_SPACE_QUOTA_OR_RATE_LIMIT' };
    await assert.rejects(
      requestOcrSpace(image, 200, 400),
      (error: unknown) => error instanceof OcrSpaceError &&
        error.code === 'OCR_SPACE_QUOTA_OR_RATE_LIMIT' && error.status === 429,
    );

    console.log('PASS: status gate, 1 MB guard, multipart image request, normalized OCR lines, and quota error mapping (mocked; no network).');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void main();
