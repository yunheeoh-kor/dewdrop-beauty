import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeFacePixels, nearestColorFamily } from '../web/photo-measurements.js';

const OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const OUTER = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146];
const INNER = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95];

function landmarks() {
  const points = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  OVAL.forEach((index, i) => { const a = -Math.PI / 2 + i * Math.PI * 2 / OVAL.length; points[index] = { x: 0.5 + Math.cos(a) * 0.35, y: 0.5 + Math.sin(a) * 0.43 }; });
  OUTER.forEach((index, i) => { const a = -Math.PI + i * Math.PI * 2 / OUTER.length; points[index] = { x: 0.5 + Math.cos(a) * 0.16, y: 0.7 + Math.sin(a) * 0.075 }; });
  INNER.forEach((index, i) => { const a = -Math.PI + i * Math.PI * 2 / INNER.length; points[index] = { x: 0.5 + Math.cos(a) * 0.13, y: 0.7 + Math.sin(a) * 0.025 }; });
  Object.entries({ 50: [0.32, 0.47], 101: [0.4, 0.51], 205: [0.34, 0.6], 187: [0.25, 0.57], 280: [0.68, 0.47], 330: [0.6, 0.51], 425: [0.66, 0.6], 411: [0.75, 0.57] }).forEach(([index, [x, y]]) => { points[index] = { x, y }; });
  return points;
}

function photo({ cheek = [172, 121, 99], lip = [170, 54, 65], interior = [255, 255, 255], alpha = 255 } = {}) {
  const width = 400, height = 400, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width, v = (y + 0.5) / height;
      let rgb = [10, 190, 220]; // Strongly colored background/eyes/hair stay excluded.
      if (u > 0.24 && u < 0.76 && v > 0.46 && v < 0.61) rgb = cheek;
      if (((u - 0.5) / 0.16) ** 2 + ((v - 0.7) / 0.075) ** 2 < 1) rgb = lip;
      if (((u - 0.5) / 0.129) ** 2 + ((v - 0.7) / 0.024) ** 2 < 1) rgb = interior;
      data.set([...rgb, alpha], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

test('samples measured lip/cheek pixels and excludes mouth interior and background', () => {
  const result = analyzeFacePixels(photo(), [landmarks()]);
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.samples.lip.rgb, [170, 54, 65]);
  assert.equal(result.samples.lip.hex, '#aa3641');
  assert.deepEqual(result.samples.cheek.rgb, [172, 121, 99]);
  assert.equal(result.colorFamily, 'red');
  assert.equal(result.faceCount, 1);
  assert.equal(result.methodVersion, 'face-pixels-v1');
  assert.ok(result.markers.every(marker => marker.x > 0 && marker.x < 1 && marker.y > 0 && marker.y < 1));
  assert.ok(result.samples.lip.pixelCount > 12);
  assert.equal('confidence' in result, false);
});

test('different actual pixels change measured swatches and exploration color family', () => {
  const red = analyzeFacePixels(photo(), [landmarks()]);
  const coral = analyzeFacePixels(photo({ cheek: [85, 61, 47], lip: [224, 123, 104] }), [landmarks()]);
  assert.equal(coral.status, 'ready');
  assert.equal(coral.colorFamily, 'coral');
  assert.notEqual(red.samples.lip.hex, coral.samples.lip.hex);
  assert.notEqual(red.samples.cheek.hex, coral.samples.cheek.hex);
});

test('teeth and dark mouth interior do not change lip measurement', () => {
  const first = analyzeFacePixels(photo(), [landmarks()]);
  const second = analyzeFacePixels(photo({ interior: [0, 0, 0] }), [landmarks()]);
  assert.deepEqual(first.samples.lip.rgb, second.samples.lip.rgb);
});

test('isolated highlight pixels do not dominate robust color measurements', () => {
  const image = photo();
  for (let i = 0; i < image.data.length; i += 28) image.data.set([255, 255, 255], i);
  const result = analyzeFacePixels(image, [landmarks()]);
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.samples.lip.rgb, [170, 54, 65]);
  assert.deepEqual(result.samples.cheek.rgb, [172, 121, 99]);
});

test('no detected face does not invent measurements', () => {
  const result = analyzeFacePixels(photo(), []);
  assert.equal(result.status, 'retake');
  assert.equal(result.issues[0].code, 'no_face');
  assert.equal(result.faceCount, 0);
  assert.equal(result.colorFamily, null);
  assert.deepEqual(result.samples, {});
});

test('multiple faces require a single-person photo', () => {
  const result = analyzeFacePixels(photo(), [landmarks(), landmarks()]);
  assert.equal(result.issues[0].code, 'multiple_faces');
  assert.equal(result.faceCount, 2);
});

test('cropped or very small face cannot produce a measured color claim', () => {
  const cropped = landmarks(); cropped[10].y = -0.05;
  assert.equal(analyzeFacePixels(photo(), [cropped]).issues[0].code, 'face_out_of_frame');
  const tiny = landmarks().map(point => ({ x: 0.5 + (point.x - 0.5) / 20, y: 0.5 + (point.y - 0.5) / 20 }));
  assert.equal(analyzeFacePixels(photo(), [tiny]).issues[0].code, 'face_too_small');
});

test('invalid images and corrupt landmarks return actionable computational errors', () => {
  for (const image of [null, {}, { width: 2, height: 2, data: new Uint8Array(3) }, { width: Infinity, height: 2, data: [] }]) {
    assert.equal(analyzeFacePixels(image, [landmarks()]).issues[0].code, 'invalid_image');
  }
  const face = landmarks(); face[50].x = NaN;
  assert.equal(analyzeFacePixels(photo(), [face]).issues[0].code, 'invalid_landmarks');
  assert.equal(analyzeFacePixels(photo(), null).issues[0].code, 'invalid_landmarks');
  assert.equal(analyzeFacePixels(photo(), [[]]).issues[0].code, 'invalid_landmarks');
});

test('transparent or degenerate sampled regions request another photo', () => {
  assert.equal(analyzeFacePixels(photo({ alpha: 0 }), [landmarks()]).issues[0].code, 'no_valid_samples');
  const face = landmarks(); [...OUTER, ...INNER].forEach(index => { face[index] = { x: 0.5, y: 0.7 }; });
  assert.equal(analyzeFacePixels(photo(), [face]).issues[0].code, 'no_valid_samples');
});

test('only near-total black or white clipping blocks color sampling', () => {
  for (const clipped of [[0, 0, 0], [255, 255, 255]]) {
    assert.equal(analyzeFacePixels(photo({ cheek: clipped, lip: clipped }), [landmarks()]).issues[0].code, 'clipped_pixels');
  }
  // Dark visible color values are valid observations, not a quality failure.
  const dark = analyzeFacePixels(photo({ cheek: [10, 8, 6], lip: [20, 11, 12] }), [landmarks()]);
  assert.equal(dark.status, 'ready');
  assert.deepEqual(dark.samples.cheek.rgb, [10, 8, 6]);
});

test('pure analysis does not mutate pixels or landmarks', () => {
  const image = photo(), face = landmarks(), pixelsBefore = image.data.slice(), faceBefore = structuredClone(face);
  analyzeFacePixels(image, [face]);
  assert.deepEqual(image.data, pixelsBefore);
  assert.deepEqual(face, faceBefore);
});

test('nearest available reference only considers reviewed families supplied by caller', () => {
  assert.equal(nearestColorFamily([170, 54, 65]), 'red');
  assert.equal(nearestColorFamily([217, 124, 153], ['coral', 'pink']), 'pink');
  assert.equal(nearestColorFamily([224, 123, 104], ['pink', 'coral']), 'coral');
  assert.equal(nearestColorFamily([170, 54, 65], []), null);
  assert.equal(nearestColorFamily([170, 54, 65], ['unreviewed']), null);
  assert.equal(nearestColorFamily([NaN, 1, 2]), null);
});

test('real feature mapping adds seven normalized clickable regions without changing color sampling', () => {
  const face = landmarks();
  const polygon = (indices, cx, cy, rx, ry) => indices.forEach((index, i) => {
    const a = -Math.PI + i * Math.PI * 2 / indices.length;
    face[index] = { x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry };
  });
  polygon([70, 63, 105, 66, 107, 55, 65, 52, 53, 46], 0.33, 0.28, 0.12, 0.03);
  polygon([336, 296, 334, 293, 300, 276, 283, 282, 295, 285], 0.67, 0.28, 0.12, 0.03);
  polygon([33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246], 0.33, 0.37, 0.10, 0.03);
  polygon([362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398], 0.67, 0.37, 0.10, 0.03);
  face[168] = { x: 0.5, y: 0.33 }; face[2] = { x: 0.5, y: 0.58 };
  face[98] = { x: 0.45, y: 0.58 }; face[327] = { x: 0.55, y: 0.58 };
  const result = analyzeFacePixels(photo(), [face]);
  assert.equal(result.status, 'ready');
  assert.equal(result.regionMethodVersion, 'face-regions-v1');
  assert.deepEqual(result.regions.map(region => region.id), ['brows', 'eyes', 'nose', 'cheeks', 'lips', 'skin_texture', 'skin_tone']);
  for (const region of result.regions) {
    for (const n of Object.values(region.point)) assert.ok(n >= 0 && n <= 1);
    const { x, y, width, height } = region.bounds;
    assert.ok(x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= 1.00001 && y + height <= 1.00001);
    assert.equal(typeof region.quality.usable, 'boolean');
    assert.ok(region.observations.length > 0);
    assert.ok(Number.isFinite(region.priority));
  }
  assert.equal(result.regions.find(region => region.id === 'brows').quality.usable, true);
  assert.ok(result.regions.find(region => region.id === 'nose').measurements.bridgeToBaseRatio > 1);
  assert.equal(result.regions.find(region => region.id === 'lips').measurements.colorFamily, result.colorFamily);
  assert.deepEqual(result.samples.lip.rgb, [170, 54, 65]);
});

test('corrupt supplemental feature landmarks preserve valid color results without invented regions', () => {
  const face = landmarks(); face[70] = undefined;
  const result = analyzeFacePixels(photo(), [face]);
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.regions, []);
  assert.equal(result.photoQuality.detailUsable, false);
});

test('different landmark geometry changes brow and eye observations', () => {
  const makeFace = (browRise, eyeHeight) => {
    const face = landmarks();
    for (const [indices, start] of [[[70, 63, 105, 66, 107], 0.2], [[336, 296, 334, 293, 300], 0.56]]) {
      indices.forEach((index, i) => { face[index] = { x: start + i * 0.06, y: 0.3 - Math.sin(i / 4 * Math.PI) * browRise }; });
    }
    for (const [a, b, top, bottom, cx] of [[33, 133, 159, 145, 0.32], [362, 263, 386, 374, 0.68]]) {
      face[a] = { x: cx - 0.1, y: 0.4 }; face[b] = { x: cx + 0.1, y: 0.4 };
      face[top] = { x: cx, y: 0.4 - eyeHeight / 2 }; face[bottom] = { x: cx, y: 0.4 + eyeHeight / 2 };
    }
    return face;
  };
  const soft = analyzeFacePixels(photo(), [makeFace(0.01, 0.04)]);
  const defined = analyzeFacePixels(photo(), [makeFace(0.06, 0.08)]);
  const lookup = (result, id) => result.regions.find(region => region.id === id);
  assert.equal(lookup(soft, 'brows').measurements.arch, 'soft');
  assert.equal(lookup(defined, 'brows').measurements.arch, 'defined');
  assert.notDeepEqual(lookup(soft, 'brows').observations, lookup(defined, 'brows').observations);
  assert.equal(lookup(soft, 'eyes').measurements.placement, 'elongated');
  assert.equal(lookup(defined, 'eyes').measurements.placement, 'open');
});
