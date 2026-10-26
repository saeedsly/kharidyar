import assert from 'node:assert/strict';
import { binarizeRgbaWithOtsu, calculateOtsuThreshold } from '../src/lib/receiptImageProcessing';

const emptyHistogram = new Uint32Array(256);
assert.equal(calculateOtsuThreshold(emptyHistogram), 127);

const twoToneHistogram = new Uint32Array(256);
twoToneHistogram[20] = 3;
twoToneHistogram[220] = 3;
assert.equal(calculateOtsuThreshold(twoToneHistogram), 20);

const pixels = new Uint8ClampedArray([
  20, 20, 20, 255,
  20, 20, 20, 255,
  20, 20, 20, 255,
  220, 220, 220, 255,
  220, 220, 220, 255,
  220, 220, 220, 255,
]);
assert.equal(binarizeRgbaWithOtsu(pixels), 20);
assert.deepEqual(
  Array.from({ length: pixels.length / 4 }, (_, index) => pixels[index * 4]),
  [0, 0, 0, 255, 255, 255]
);

const coloredPixels = new Uint8ClampedArray([
  255, 255, 255, 0,
  0, 0, 0, 255,
]);
binarizeRgbaWithOtsu(coloredPixels);
assert.equal(coloredPixels[3], 255, 'Binarized OCR pixels should be opaque on the white canvas.');
assert.equal(coloredPixels[7], 255);

console.log('PASS: Otsu thresholding separates two-tone receipt pixels and returns opaque binary output.');
