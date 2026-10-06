import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSkinAppearance } from '../web/face-regions.js';

const rectangle = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const cheeks = [rectangle(35, 145, 100, 110), rectangle(185, 145, 100, 110)];
const eyes = [rectangle(35, 55, 100, 35), rectangle(185, 55, 100, 35)];
const size = { faceWidthPx: 280, faceHeightPx: 340 };

function fixture({ detail = 0, shade = 150, lighting = 0, broadVariation = 0 } = {}) {
  const width = 320, height = 400, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value = shade + lighting * x / width;
      if (y >= 145 && y < 255) value += detail * (Math.sin(x * 1.6) + Math.sin(y * 1.1)) / 2 + broadVariation * Math.sin(x / 9) * Math.cos(y / 9);
      if (y >= 55 && y <= 90 && ((x >= 35 && x <= 135) || (x >= 185 && x <= 285))) value = x % 12 < 6 ? 50 : 190;
      data.set([value, value * 0.8, value * 0.65, 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

function blur(image, radius = 6) {
  const horizontal = new Uint8ClampedArray(image.data.length), data = new Uint8ClampedArray(image.data.length);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let dx = -radius; dx <= radius; dx++) sum += image.data[(y * image.width + Math.min(image.width - 1, Math.max(0, x + dx))) * 4 + c];
        horizontal[(y * image.width + x) * 4 + c] = sum / (radius * 2 + 1);
      }
    }
  }
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let dy = -radius; dy <= radius; dy++) sum += horizontal[(Math.min(image.height - 1, Math.max(0, y + dy)) * image.width + x) * 4 + c];
        data[(y * image.width + x) * 4 + c] = sum / (radius * 2 + 1);
      }
      data[(y * image.width + x) * 4 + 3] = 255;
    }
  }
  return { ...image, data };
}

const analyze = (image, resolution = size) => analyzeSkinAppearance(image, cheeks, eyes, resolution);

test('visible texture changes with actual localized pixel contrast', () => {
  const smooth = analyze(fixture()), detail = analyze(fixture({ detail: 12 })), stronger = analyze(fixture({ detail: 60 }));
  assert.equal(smooth.quality.usable, true);
  assert.equal(smooth.texture.level, 'low');
  assert.equal(detail.texture.level, 'visible');
  assert.equal(stronger.texture.level, 'pronounced');
  assert.ok(stronger.texture.localContrast > detail.texture.localContrast);
  assert.ok(detail.texture.darkerDetailFraction > smooth.texture.darkerDetailFraction);
});

test('broad local color variation responds to measured image patches', () => {
  const flat = analyze(fixture()), varied = analyze(fixture({ broadVariation: 70 }));
  assert.equal(varied.quality.usable, true);
  assert.equal(flat.tone.level, 'low');
  assert.notEqual(varied.tone.level, 'low');
  assert.ok(varied.tone.colorVariation > flat.tone.colorVariation);
});

test('insufficient resolution cannot produce a skin-detail classification', () => {
  const result = analyze(fixture({ detail: 60 }), { faceWidthPx: 190, faceHeightPx: 250 });
  assert.equal(result.quality.usable, false);
  assert.equal(result.quality.code, 'low_resolution');
  assert.equal(result.texture.level, 'unavailable');
  assert.equal(result.tone.level, 'unavailable');
});

test('uneven illumination gates skin claims instead of creating a concern', () => {
  const result = analyze(fixture({ lighting: 120, shade: 60, detail: 20 }));
  assert.equal(result.quality.usable, false);
  assert.equal(result.quality.code, 'uneven_lighting');
  assert.equal(result.photoQuality.lightingUsable, false);
  assert.equal(result.texture.level, 'unavailable');
  assert.equal(result.tone.level, 'unavailable');
});

test('blurred focus boundaries withhold detail classification', () => {
  const sharp = analyze(fixture({ detail: 60 })), soft = analyze(blur(fixture({ detail: 60 })));
  assert.equal(sharp.quality.usable, true);
  assert.equal(soft.quality.usable, false);
  assert.equal(soft.quality.code, 'soft_image');
  assert.equal(soft.texture.level, 'unavailable');
  assert.ok(soft.photoQuality.sharpness.strength < sharp.photoQuality.sharpness.strength);
});

test('smooth cheeks are not confused with an out-of-focus image', () => {
  const result = analyze(fixture({ detail: 0 }));
  assert.equal(result.quality.usable, true);
  assert.equal(result.texture.level, 'low');
  assert.ok(result.photoQuality.sharpness.usable);
});

test('dark readable colors remain eligible for appearance measurement', () => {
  const result = analyze(fixture({ shade: 30, detail: 5 }));
  assert.equal(result.quality.usable, true);
  assert.equal(result.photoQuality.lightingUsable, true);
});

test('appearance result holds measurements only, with no raw pixels, pores, or diagnosis fields', () => {
  const result = analyze(fixture({ detail: 25 }));
  const serialized = JSON.stringify(result);
  assert.equal(/poreCount|spotCount|diagnosis|skinType|data:image|landmarks|pixels|rgba/i.test(serialized), false);
  assert.equal('data' in result, false);
});
