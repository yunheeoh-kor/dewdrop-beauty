import test from 'node:test';
import assert from 'node:assert/strict';
import { createCameraController } from '../web/camera.js';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function mediaStream() {
  const track = new EventTarget();
  track.stops = 0;
  track.stop = () => { track.stops += 1; };
  return { track, getTracks: () => [track], getVideoTracks: () => [track] };
}
function videoElement() {
  return Object.assign(new EventTarget(), { srcObject: null, readyState: 2, videoWidth: 1920, videoHeight: 1080, play: async () => {}, pause() {} });
}
function fixture(getUserMedia = async () => mediaStream()) {
  const photos = [], errors = [], statuses = [], images = [], revoked = [], canvases = [];
  class FakeImage {
    constructor() { this.naturalWidth = 3000; this.naturalHeight = 4000; images.push(this); }
    set src(value) { this.url = value; }
    load() { this.onload?.(); }
    fail() { this.onerror?.(); }
  }
  const browser = {
    navigator: { mediaDevices: { getUserMedia } },
    Image: FakeImage,
    URL: { createObjectURL: () => `blob:test-${images.length}`, revokeObjectURL: url => revoked.push(url) },
    document: { createElement: () => {
      const context = { fillRect() {}, drawImage(...args) { this.drawn = args; } };
      const canvas = { getContext: () => context, toDataURL: () => 'data:image/jpeg;base64,photo', context };
      canvases.push(canvas);
      return canvas;
    } },
  };
  const controller = createCameraController({ browser, onPhoto: photo => photos.push(photo), onError: (message, code) => errors.push({ message, code }), onStatus: status => statuses.push(status) });
  return { controller, browser, photos, errors, statuses, images, revoked, canvases };
}
const jpeg = { type: 'image/jpeg', size: 5000 };

test('front camera captures one bounded JPEG and releases every media track', async () => {
  const stream = mediaStream();
  let constraints;
  const f = fixture(async options => { constraints = options; return stream; });
  const video = videoElement();
  assert.equal(await f.controller.start(video), true);
  assert.equal(f.controller.isActive(), true);
  assert.equal(constraints.audio, false);
  assert.equal(constraints.video.facingMode.ideal, 'user');
  assert.equal(video.playsInline, true);
  const photo = f.controller.capture();
  assert.deepEqual(photo, { dataUrl: 'data:image/jpeg;base64,photo', width: 1200, height: 675, source: 'camera' });
  assert.equal(f.photos.length, 1);
  assert.equal(stream.track.stops, 1);
  assert.equal(video.srcObject, null);
  assert.equal(f.controller.isActive(), false);
  assert.equal(f.controller.capture(), null);
  assert.equal(f.photos.length, 1);
});

test('late camera permission result after navigation is stopped without updating the view', async () => {
  const permission = deferred();
  const f = fixture(() => permission.promise);
  const stream = mediaStream();
  const video = videoElement();
  const starting = f.controller.start(video);
  f.controller.stop();
  permission.resolve(stream);
  assert.equal(await starting, false);
  assert.equal(stream.track.stops, 1);
  assert.equal(video.srcObject, null);
  assert.deepEqual(f.statuses, ['requesting', 'idle']);
  assert.equal(f.photos.length, 0);
  assert.equal(f.errors.length, 0);
});

test('restarting while permission is pending keeps only the most recent camera', async () => {
  const first = deferred(), second = deferred();
  let call = 0;
  const f = fixture(() => ++call === 1 ? first.promise : second.promise);
  const firstStream = mediaStream(), secondStream = mediaStream();
  const firstStart = f.controller.start(videoElement());
  const secondStart = f.controller.start(videoElement());
  second.resolve(secondStream);
  assert.equal(await secondStart, true);
  first.resolve(firstStream);
  assert.equal(await firstStart, false);
  assert.equal(firstStream.track.stops, 1);
  assert.equal(secondStream.track.stops, 0);
  f.controller.stop();
  assert.equal(secondStream.track.stops, 1);
});

test('denied or missing cameras provide actionable messages', async () => {
  for (const [name, code] of [['NotAllowedError', 'permission'], ['NotFoundError', 'missing'], ['NotReadableError', 'busy']]) {
    const f = fixture(async () => { throw Object.assign(new Error('browser detail'), { name }); });
    assert.equal(await f.controller.start(videoElement()), false);
    assert.equal(f.errors[0].code, code);
    assert.match(f.errors[0].message, /choose a photo/i);
    assert.equal(f.controller.isActive(), false);
  }
});

test('capture waits for real video pixels and stop cancels the readiness wait', async () => {
  const stream = mediaStream();
  const f = fixture(async () => stream);
  const video = videoElement();
  video.readyState = 0;
  video.videoWidth = 0;
  const starting = f.controller.start(video);
  await Promise.resolve();
  assert.equal(f.controller.capture(), null);
  assert.equal(f.errors[0].code, 'notReady');
  f.controller.stop();
  assert.equal(await starting, false);
  assert.equal(stream.track.stops, 1);
  assert.equal(f.photos.length, 0);
});

test('gallery image stops camera, scales to max 1200 pixels, and revokes its object URL', async () => {
  const stream = mediaStream();
  const f = fixture(async () => stream);
  await f.controller.start(videoElement());
  const reading = f.controller.readFile(jpeg);
  assert.equal(stream.track.stops, 1);
  f.images[0].load();
  assert.equal(await reading, true);
  assert.deepEqual(f.photos[0], { dataUrl: 'data:image/jpeg;base64,photo', width: 900, height: 1200, source: 'upload' });
  assert.deepEqual(f.revoked, ['blob:test-1']);
  assert.equal(f.photos.length, 1);
});

test('invalid or oversized photos never reach the decoder', async () => {
  const f = fixture();
  for (const file of [{ type: 'image/svg+xml', size: 500 }, { type: 'image/jpeg', size: 15 * 1024 * 1024 + 1 }, { type: 'image/png', size: 0 }]) {
    assert.equal(await f.controller.readFile(file), false);
  }
  assert.deepEqual(f.errors.map(error => error.code), ['fileType', 'fileSize', 'fileSize']);
  assert.equal(f.images.length, 0);
  assert.equal(f.photos.length, 0);
});

test('stopping an in-flight upload releases resources and suppresses stale photos', async () => {
  const f = fixture();
  const reading = f.controller.readFile(jpeg);
  const oldLoad = f.images[0].onload;
  f.controller.stop();
  oldLoad();
  assert.equal(await reading, false);
  assert.equal(f.photos.length, 0);
  assert.equal(f.errors.length, 0);
  assert.deepEqual(f.revoked, ['blob:test-1']);
  assert.equal(f.images[0].url, '');
});

test('only latest gallery selection is emitted and small photos are not enlarged', async () => {
  const f = fixture();
  const oldReading = f.controller.readFile(jpeg);
  const newReading = f.controller.readFile({ type: 'image/webp', size: 1200 });
  f.images[1].naturalWidth = 200;
  f.images[1].naturalHeight = 300;
  f.images[1].load();
  assert.equal(await oldReading, false);
  assert.equal(await newReading, true);
  assert.equal(f.photos.length, 1);
  assert.equal(f.photos[0].width, 200);
  assert.equal(f.photos[0].height, 300);
  assert.equal(f.revoked.length, 2);
});

test('corrupt image and canvas failure never emit a photo', async () => {
  const corrupt = fixture();
  const reading = corrupt.controller.readFile(jpeg);
  corrupt.images[0].fail();
  assert.equal(await reading, false);
  assert.equal(corrupt.errors[0].code, 'fileRead');
  assert.equal(corrupt.revoked.length, 1);
  const canvas = fixture();
  canvas.browser.document.createElement = () => ({ getContext: () => null });
  await canvas.controller.start(videoElement());
  assert.equal(canvas.controller.capture(), null);
  assert.equal(canvas.errors[0].code, 'capture');
  assert.equal(canvas.photos.length, 0);
  canvas.controller.stop();
});

test('revoked camera permission releases the preview and reports a stopped camera', async () => {
  const stream = mediaStream();
  const f = fixture(async () => stream);
  await f.controller.start(videoElement());
  stream.track.dispatchEvent(new Event('ended'));
  assert.equal(f.controller.isActive(), false);
  assert.equal(stream.track.stops, 1);
  assert.equal(f.errors[0].code, 'ended');
});
