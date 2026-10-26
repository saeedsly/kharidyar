/**
 * Calculate Otsu's global grayscale threshold from an 8-bit intensity histogram.
 * Kept independent of Canvas so the image-processing decision can be unit-tested.
 */
export function calculateOtsuThreshold(histogram: ArrayLike<number>): number {
  let totalPixels = 0;
  let totalIntensity = 0;
  const intensityCount = Math.min(256, histogram.length);

  for (let intensity = 0; intensity < intensityCount; intensity += 1) {
    const count = Math.max(0, Number(histogram[intensity]) || 0);
    totalPixels += count;
    totalIntensity += intensity * count;
  }

  if (totalPixels === 0) return 127;

  let backgroundPixels = 0;
  let backgroundIntensity = 0;
  let bestVariance = -1;
  let bestThreshold = 127;

  for (let threshold = 0; threshold < intensityCount; threshold += 1) {
    const count = Math.max(0, Number(histogram[threshold]) || 0);
    backgroundPixels += count;
    backgroundIntensity += threshold * count;

    if (backgroundPixels === 0) continue;
    const foregroundPixels = totalPixels - backgroundPixels;
    if (foregroundPixels === 0) break;

    const backgroundMean = backgroundIntensity / backgroundPixels;
    const foregroundMean = (totalIntensity - backgroundIntensity) / foregroundPixels;
    const meanDifference = backgroundMean - foregroundMean;
    const betweenClassVariance =
      backgroundPixels * foregroundPixels * meanDifference * meanDifference;

    if (betweenClassVariance > bestVariance) {
      bestVariance = betweenClassVariance;
      bestThreshold = threshold;
    }
  }

  return bestThreshold;
}

/** Add the luminance of RGBA pixels to an 8-bit histogram. */
export function addRgbaToHistogram(pixels: Uint8ClampedArray, histogram: Uint32Array): void {
  const pixelCount = Math.floor(pixels.length / 4);
  for (let offset = 0; offset < pixelCount * 4; offset += 4) {
    const gray = Math.max(
      0,
      Math.min(
        255,
        Math.round((299 * pixels[offset] + 587 * pixels[offset + 1] + 114 * pixels[offset + 2]) / 1000)
      )
    );
    histogram[gray] += 1;
  }
}

/** Apply a previously calculated Otsu threshold to RGBA pixels in place. */
export function applyOtsuThreshold(pixels: Uint8ClampedArray, threshold: number): void {
  const pixelCount = Math.floor(pixels.length / 4);
  for (let offset = 0; offset < pixelCount * 4; offset += 4) {
    const gray = Math.round((299 * pixels[offset] + 587 * pixels[offset + 1] + 114 * pixels[offset + 2]) / 1000);
    const binary = gray <= threshold ? 0 : 255;
    pixels[offset] = binary;
    pixels[offset + 1] = binary;
    pixels[offset + 2] = binary;
    pixels[offset + 3] = 255;
  }
}

/** Convert RGBA pixels to a binary black/white image in place; returns the chosen threshold. */
export function binarizeRgbaWithOtsu(pixels: Uint8ClampedArray): number {
  if (pixels.length < 4) return 127;
  const histogram = new Uint32Array(256);
  addRgbaToHistogram(pixels, histogram);
  const threshold = calculateOtsuThreshold(histogram);
  applyOtsuThreshold(pixels, threshold);
  return threshold;
}
