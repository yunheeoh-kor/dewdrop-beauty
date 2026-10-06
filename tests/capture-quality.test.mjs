import test from 'node:test';
import assert from 'node:assert/strict';
import { assessCaptureFrame, createCaptureStabilityGate } from '../web/capture-quality.js';

function face() {
  const points = Array.from({ length: 478 }, () => ({ x: .5, y: .5 }));
  points[10] = { x: .5, y: .18 }; points[152] = { x: .5, y: .82 };
  points[234] = { x: .27, y: .5 }; points[454] = { x: .73, y: .5 };
  points[33] = { x: .36, y: .4 }; points[263] = { x: .64, y: .4 };
  points[1] = { x: .5, y: .57 };
  return points;
}
function pixels(sample = (x, y) => 130 + ((Math.floor(x / 3) + Math.floor(y / 3)) % 2 ? 18 : -18), width = 256, height = 256) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) { const offset = (y * width + x) * 4; data.fill(sample(x, y), offset, offset + 3); data[offset + 3] = 255; }
  return { data, width, height };
}
const shift = (points, x, y = 0) => points.map(point => ({ x: point.x + x, y: point.y + y }));
const good = () => assessCaptureFrame(pixels(), [face()]);

test('capture requires exactly one detected face with valid geometry', () => {
  assert.equal(assessCaptureFrame(pixels(), []).status, 'searching');
  assert.equal(assessCaptureFrame(pixels(), [face(), face()]).acceptable, false);
  assert.equal(assessCaptureFrame(pixels(), [[{ x: .5, y: .5 }]]).status, 'searching');
  assert.equal(assessCaptureFrame({ width: 10, height: 10, data: [] }, [face()]).status, 'manual');
});

test('clear centered face is accepted, with source-space bounds and measured sharpness', () => {
  const result = good();
  assert.equal(result.acceptable, true);
  assert.equal(result.faceBounds.x, .27);
  assert.ok(Math.abs(result.faceBounds.width - .46) < 1e-9);
  assert.equal(result.anchors.length, 4);
  assert.ok(result.metrics.sharpness > 14);
});

test('small, cropped, off-center and tilted faces give positioning guidance', () => {
  const small = face().map(point => ({ x: .5 + (point.x - .5) * .3, y: .5 + (point.y - .5) * .3 }));
  assert.match(assessCaptureFrame(pixels(), [small]).message, /closer/);
  assert.match(assessCaptureFrame(pixels(), [shift(face(), .3)]).message, /whole face/);
  assert.match(assessCaptureFrame(pixels(), [shift(face(), .15)]).message, /Center/);
  const tilt = face(); tilt[33].y = .32; tilt[263].y = .48;
  assert.match(assessCaptureFrame(pixels(), [tilt]).message, /head level/);
  const turned = face(); turned[1].x = .60;
  assert.match(assessCaptureFrame(pixels(), [turned]).message, /straight/);
});

test('clipped exposure blocks automatic capture but darker visible faces are accepted', () => {
  assert.equal(assessCaptureFrame(pixels(() => 1), [face()]).status, 'exposure');
  assert.equal(assessCaptureFrame(pixels(() => 254), [face()]).status, 'exposure');
  const darker = pixels((x, y) => 34 + ((Math.floor(x / 3) + Math.floor(y / 3)) % 2 ? 14 : -14));
  assert.equal(assessCaptureFrame(darker, [face()]).acceptable, true);
});

test('a smooth gradient with adequate light fails the measurable sharpness gate', () => {
  const result = assessCaptureFrame(pixels(x => 65 + x * .5), [face()]);
  assert.equal(result.status, 'sharpness');
  assert.equal(result.acceptable, false);
  assert.ok(result.metrics.tonalRange > 8);
  assert.ok(result.metrics.sharpness < 14);
});

test('one shutter only after sustained recent quality frames, never the first frame', () => {
  const gate = createCaptureStabilityGate();
  assert.equal(gate.update(good(), 1000).capture, false);
  assert.equal(gate.update(good(), 1400).capture, false);
  assert.equal(gate.update(good(), 1800).capture, false);
  assert.equal(gate.update(good(), 2200).capture, true);
  assert.equal(gate.update(good(), 2600).capture, false);
});

test('loss of face, motion, long frame gaps and duplicate timestamps reset stability', () => {
  for (const interruption of ['loss', 'motion', 'gap', 'duplicate']) {
    const gate = createCaptureStabilityGate();
    gate.update(good(), 1000); gate.update(good(), 1500);
    let time = 1900, quality = good();
    if (interruption === 'loss') quality = assessCaptureFrame(pixels(), []);
    if (interruption === 'motion') quality = assessCaptureFrame(pixels(), [shift(face(), .03)]);
    if (interruption === 'gap') time = 5000;
    if (interruption === 'duplicate') time = 1500;
    const result = gate.update(quality, time);
    assert.equal(result.capture, false, interruption);
    assert.equal(result.progress, 0, interruption);
  }
});

test('continuous small drift is measured against initial pose and does not accumulate to a shutter', () => {
  const gate = createCaptureStabilityGate();
  for (let index = 0; index < 8; index += 1) {
    const quality = assessCaptureFrame(pixels(), [shift(face(), index * .012)]);
    assert.equal(gate.update(quality, 1000 + index * 350).capture, false);
  }
});

// Put identical face geometry into differently shaped frames without stretching
// the face. This models portrait/landscape sources rather than a CSS resize.
function inFrame(points, width, height) {
  const shortEdge = Math.min(width, height);
  return points.map(point => ({ x: .5 + (point.x - .5) * shortEdge / width, y: .5 + (point.y - .5) * shortEdge / height }));
}

test('head-level and face-size decisions match for the same face in portrait and landscape frames', () => {
  for (const [width, height] of [[256, 256], [256, 448], [448, 256]]) {
    for (const [degrees, accepted] of [[0, true], [10, true], [18, false]]) {
      const points = face(), angle = degrees * Math.PI / 180;
      points[33] = { x: .5 - .14 * Math.cos(angle), y: .4 - .14 * Math.sin(angle) };
      points[263] = { x: .5 + .14 * Math.cos(angle), y: .4 + .14 * Math.sin(angle) };
      const quality = assessCaptureFrame(pixels(undefined, width, height), [inFrame(points, width, height)]);
      assert.equal(quality.acceptable, accepted, `${width}x${height}, ${degrees} degrees`);
    }
  }
});

test('equal movement resets hold equally in portrait and landscape; orientation changes also restart hold', () => {
  for (const [width, height] of [[256, 448], [448, 256]]) {
    const gate = createCaptureStabilityGate();
    const image = pixels(undefined, width, height);
    const original = assessCaptureFrame(image, [inFrame(face(), width, height)]);
    gate.update(original, 1000); gate.update(original, 1500);
    const moved = assessCaptureFrame(image, [inFrame(shift(face(), .03), width, height)]);
    assert.equal(gate.update(moved, 2000).progress, 0, `${width}x${height}`);
  }
  const gate = createCaptureStabilityGate();
  gate.update(good(), 1000); gate.update(good(), 1500);
  const turned = assessCaptureFrame(pixels(undefined, 448, 256), [inFrame(face(), 448, 256)]);
  assert.equal(gate.update(turned, 2000).progress, 0);
});
