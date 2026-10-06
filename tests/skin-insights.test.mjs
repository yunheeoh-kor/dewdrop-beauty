import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSkinInsights } from '../web/skin-insights.js';

function face() {
  const points = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  for (const [indices, left] of [[[50, 101, 205, 187], 0.16], [[280, 330, 425, 411], 0.64]]) {
    [[left, 0.45], [left + 0.2, 0.45], [left + 0.2, 0.66], [left, 0.66]].forEach(([x, y], i) => { points[indices[i]] = { x, y }; });
  }
  points[33] = { x: 0.3, y: 0.33 }; points[263] = { x: 0.7, y: 0.33 };
  points[1] = { x: 0.5, y: 0.52 }; points[152] = { x: 0.5, y: 0.93 };
  return points;
}
function fixture({ rgb = [165, 125, 105], pattern = 'uniform', gradient = 0, width = 720, height = 860 } = {}) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let pixel = rgb.map(v => v + gradient * (x / width - 0.5));
    if (pattern === 'dots' && Math.hypot(x % 23 - 11, y % 23 - 11) <= 2.3) pixel = pixel.map(v => v * 0.64);
    if (pattern === 'lines' && x % 37 < 3) pixel = pixel.map(v => v * 0.64);
    if (pattern === 'diagonal' && (x + y) % 51 < 3) pixel = pixel.map(v => v * 0.64);
    if (pattern === 'patches' && Math.hypot(x % 61 - 30, y % 61 - 30) < 11) pixel = [pixel[0] * 0.9, pixel[1] * 0.7, pixel[2] * 0.7];
    if (pattern === 'highlight' && Math.hypot(x % 61 - 30, y % 61 - 30) < 10) pixel = pixel.map(v => v + 65);
    data.set([...pixel, 255], (y * width + x) * 4);
  }
  return { width, height, data };
}
const quality = { detailUsable: true, faceWidthPx: 560, faceHeightPx: 730, lightingUsable: true, sharpness: { usable: true } };
const run = (image, options = {}, mesh = face()) => analyzeSkinInsights(image, mesh, { photoQuality: { ...quality, ...options } });
const metric = (result, id) => result.metrics.find(m => m.id === id);
function addNoise(image, amplitude, independentChannels = false) {
  let seed = 125;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let i = 0; i < image.data.length; i += 4) {
    const shared = (random() - 0.5) * amplitude * 2;
    for (let c = 0; c < 3; c++) image.data[i + c] += independentChannels ? (random() - 0.5) * amplitude * 2 : shared;
  }
  return image;
}

test('uniform skin colors across dark and light tones stay low with no invented sizes', () => {
  for (const rgb of [[30, 24, 20], [80, 59, 47], [165, 125, 105], [235, 217, 204]]) {
    const result = run(fixture({ rgb }));
    for (const id of ['pores', 'pigmentation', 'wrinkles']) {
      assert.equal(metric(result, id).status, 'estimated', `${rgb}: ${metric(result, id).qualityReason}`);
      assert.equal(metric(result, id).level, 'low');
    }
    assert.equal(metric(result, 'pores').measurements.apparentDiameterPx, null);
    assert.equal(metric(result, 'moisture').measurements.surfaceSheen.level, 'low');
  }
});

test('compact dark dots increase pore-like image texture and yield only apparent pixel size', () => {
  const smooth = run(fixture()), dotted = run(fixture({ pattern: 'dots' }));
  const pores = metric(dotted, 'pores');
  assert.equal(pores.status, 'estimated');
  assert.notEqual(pores.level, 'low');
  assert.ok(pores.measurements.compactDarkDetailFraction > metric(smooth, 'pores').measurements.compactDarkDetailFraction);
  assert.ok(pores.measurements.apparentDiameterPx >= 3 && pores.measurements.apparentDiameterPx <= 7);
  assert.equal(pores.measurements.sizeUnit, 'analyzed-image pixels');
  assert.equal(metric(dotted, 'wrinkles').level, 'low');
});

test('widespread random grain cannot masquerade as measured pore size or fine lines', () => {
  for (const independentChannels of [false, true]) for (const amplitude of [12, 24]) {
    const result = run(addNoise(fixture(), amplitude, independentChannels));
    for (const id of ['pores', 'wrinkles']) {
      const item = metric(result, id);
      assert.equal(item.status, 'estimated');
      assert.equal(item.level, 'low');
      assert.equal(item.reliability, 'limited');
      assert.ok(item.qualityNotes.some(note => note.includes('grain was suppressed')));
      assert.ok(item.measurements.sampledPixelCount > 0);
    }
    assert.equal(metric(result, 'pores').measurements.apparentDiameterPx, null);
  }
});

test('sparse structured dots remain resolvable with mild camera grain', () => {
  const result = run(addNoise(fixture({ pattern: 'dots' }), 2, true));
  const pores = metric(result, 'pores');
  assert.equal(pores.status, 'estimated');
  assert.notEqual(pores.level, 'low');
  assert.ok(pores.measurements.apparentDiameterPx >= 3 && pores.measurements.apparentDiameterPx <= 7);
});

test('large localized color patches respond separately from compact texture', () => {
  const smooth = run(fixture()), spotted = run(fixture({ pattern: 'patches' }));
  assert.equal(metric(spotted, 'pigmentation').status, 'estimated');
  assert.notEqual(metric(spotted, 'pigmentation').level, 'low');
  assert.ok(metric(spotted, 'pigmentation').measurements.localizedColorVariationFraction > metric(smooth, 'pigmentation').measurements.localizedColorVariationFraction);
  assert.equal(metric(spotted, 'pores').level, 'low');
});

test('straight and diagonal elongated contrast change fine-line observation without claiming depth', () => {
  for (const pattern of ['lines', 'diagonal']) {
    const result = run(fixture({ pattern })), lines = metric(result, 'wrinkles');
    assert.equal(lines.status, 'estimated');
    assert.notEqual(lines.level, 'low');
    assert.ok(lines.measurements.lineLikeDetailFraction > 0.005);
    assert.equal(metric(result, 'pores').level, 'low');
    assert.match(lines.limitation, /does not confirm wrinkles or measure their depth/);
  }
});

test('moisture leads with a visible finish estimate while never inventing water content', () => {
  const smooth = run(fixture()), shiny = run(fixture({ pattern: 'highlight' }));
  for (const result of [smooth, shiny]) {
    const moisture = metric(result, 'moisture');
    assert.equal(moisture.status, 'estimated');
    assert.ok(['low', 'visible', 'pronounced'].includes(moisture.level));
    assert.equal(moisture.measurements.hydrationMeasured, false);
    assert.match(moisture.measurements.surfaceSheen.finishLabel, /finish/);
  }
  assert.ok(metric(shiny, 'moisture').measurements.surfaceSheen.brightReflectionFraction > metric(smooth, 'moisture').measurements.surfaceSheen.brightReflectionFraction);
  assert.notEqual(metric(shiny, 'moisture').measurements.surfaceSheen.level, 'low');
});

test('gentle illumination gradients do not inflate texture, line, or color observations', () => {
  const result = run(fixture({ gradient: 35 }));
  for (const id of ['pores', 'pigmentation', 'wrinkles']) {
    assert.equal(metric(result, id).status, 'estimated');
    assert.equal(metric(result, id).level, 'low');
  }
  assert.equal(metric(result, 'moisture').measurements.surfaceSheen.level, 'low');
});

test('poor resolution, blur, uneven lighting and missing focus evidence still produce limited estimates', () => {
  const image = fixture({ pattern: 'dots' });
  const cases = [
    run(image, { faceWidthPx: 190, faceHeightPx: 280 }),
    run(image, { detailUsable: false, detailReason: 'The focus is too soft.' }),
    run(image, { sharpness: { usable: false } }),
    run(image, { lightingUsable: false }),
    run(fixture({ gradient: 130, rgb: [145, 115, 100] })),
    analyzeSkinInsights(image, face()),
  ];
  for (const result of cases) {
    for (const id of ['pores', 'pigmentation', 'wrinkles']) {
      const item = metric(result, id);
      assert.equal(item.status, 'estimated');
      assert.ok(['low', 'visible', 'pronounced'].includes(item.level));
      assert.equal(item.reliability, 'limited');
      assert.ok(item.qualityNotes.length > 0);
      assert.ok(item.measurements.sampledPixelCount > 0);
    }
    assert.equal(metric(result, 'moisture').status, 'estimated');
    assert.equal(metric(result, 'moisture').measurements.surfaceSheen.status, 'estimated');
  }
});

test('fine details carry stronger resolution notes without blocking the estimates', () => {
  const result = run(fixture(), { faceWidthPx: 290, faceHeightPx: 360 });
  assert.equal(metric(result, 'pores').status, 'estimated');
  assert.equal(metric(result, 'pores').reliability, 'limited');
  assert.equal(metric(result, 'wrinkles').status, 'estimated');
  assert.equal(metric(result, 'wrinkles').reliability, 'limited');
  assert.equal(metric(result, 'pigmentation').status, 'estimated');
  assert.equal(metric(result, 'pigmentation').reliability, 'moderate');
});

test('face angle uncertainty adds limited reliability without rejecting readable cheeks', () => {
  const image = fixture();
  for (const modify of [p => { p[1].x = 0.66; }, p => { p[33].y = 0.50; }, p => { p[152].y = 0.38; }, p => { p[1].x = NaN; }]) {
    const mesh = face(); modify(mesh);
    const result = run(image, {}, mesh);
    assert.equal(metric(result, 'pores').status, 'estimated');
    assert.equal(metric(result, 'pores').reliability, 'limited');
    assert.equal(metric(result, 'pigmentation').status, 'estimated');
  }
});

test('invalid or missing pixels and insufficient patch area never produce NaN or invented detail', () => {
  const transparent = fixture();
  for (let i = 3; i < transparent.data.length; i += 4) transparent.data[i] = 0;
  const corrupt = fixture(); corrupt.data = Array.from(corrupt.data);
  for (let i = 0; i < corrupt.data.length; i += 16) corrupt.data[i] = NaN;
  const narrow = face(); for (const i of [50, 101, 205, 187]) narrow[i].x = 0.25;
  for (const result of [run(transparent), run(null), run({ width: 1, height: 1, data: [] }), run(fixture({ rgb: [255, 255, 255] })), run(fixture({ rgb: [0, 0, 0] }))]) {
    assert.equal(metric(result, 'pores').status, 'unavailable');
    assert.equal(metric(result, 'pigmentation').status, 'unavailable');
    assert.equal(JSON.stringify(result).includes('NaN'), false);
  }
  for (const result of [run(corrupt), run(fixture(), {}, narrow)]) {
    assert.equal(metric(result, 'pores').status, 'estimated');
    assert.equal(metric(result, 'pores').reliability, 'limited');
    assert.ok(metric(result, 'pores').measurements.sampledPixelCount > 0);
  }
});

test('isolated readable pixels cannot fabricate an all-low appearance estimate', () => {
  const image = fixture();
  for (let i = 3; i < image.data.length; i += 4) image.data[i] = 0;
  image.data.set([165, 125, 105, 255], (470 * image.width + 180) * 4);
  image.data.set([165, 125, 105, 255], (470 * image.width + 530) * 4);
  const result = run(image);
  for (const item of result.metrics) {
    assert.equal(item.status, 'unavailable');
    assert.deepEqual(item.measurements, {});
  }
});

test('portrait-sized faces below the old threshold receive actual pixel-driven estimates', () => {
  const options = { width: 220, height: 270 }, resolution = { faceWidthPx: 170, faceHeightPx: 230, detailUsable: false };
  const smooth = run(fixture(options), resolution), dotted = run(fixture({ ...options, pattern: 'dots' }), resolution);
  for (const result of [smooth, dotted]) for (const item of result.metrics) {
    assert.equal(item.status, 'estimated');
    assert.equal(item.reliability, 'limited');
    assert.ok(item.measurements.sampledPixelCount > 0);
  }
  assert.ok(metric(dotted, 'pores').measurements.compactDarkDetailFraction > metric(smooth, 'pores').measurements.compactDarkDetailFraction);
  assert.equal(metric(dotted, 'pores').measurements.apparentDiameterPx, null);
});

test('returned observations are scoped to two original sample bounds and contain no image or health score', () => {
  const image = fixture({ pattern: 'dots' }), mesh = face(), before = image.data.slice();
  const result = run(image, {}, mesh);
  assert.equal(result.methodVersion, 'skin-appearance-v2');
  assert.deepEqual(result.metrics.map(m => m.id), ['pores', 'pigmentation', 'wrinkles', 'moisture']);
  assert.equal(result.sampledRegions.length, 2);
  for (const { bounds } of result.sampledRegions) {
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.width > 0 && bounds.height > 0);
    assert.ok(bounds.x + bounds.width <= 1 && bounds.y + bounds.height <= 1);
    assert.ok(bounds.width < 0.3);
  }
  for (const item of result.metrics) {
    assert.ok(item.summary && item.limitation && item.bounds);
    assert.equal('confidence' in item, false);
    assert.equal('score' in item, false);
  }
  assert.equal(/"(?:data|pixels|landmarks|poreCount|diagnosis|skinType|hydrationScore|healthScore)"/.test(JSON.stringify(result)), false);
  assert.deepEqual(image.data, before);
});
