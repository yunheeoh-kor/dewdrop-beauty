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
  const photos = [], errors = [], statuses = [], images = [], revoked = [], canvases = [], guidance = [];
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
      const canvas = { getContext: () => context, toDataURL(type, quality) { this.encoding = { type, quality }; return 'data:image/jpeg;base64,photo'; }, context };
      canvases.push(canvas);
      return canvas;
    } },
  };
  const controller = createCameraController({ browser, onPhoto: photo => photos.push(photo), onError: (message, code) => errors.push({ message, code }), onStatus: status => statuses.push(status), onGuidance: value => guidance.push(value) });
  return { controller, browser, photos, errors, statuses, images, revoked, canvases, guidance };
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
  assert.equal(constraints.video.width.ideal, 1920);
  assert.equal(constraints.video.height.ideal, 1920);
  assert.equal(video.playsInline, true);
  const photo = f.controller.capture();
  assert.deepEqual(photo, { dataUrl: 'data:image/jpeg;base64,photo', width: 1920, height: 1080, source: 'camera' });
  assert.deepEqual(f.canvases[0].encoding, { type: 'image/jpeg', quality: 0.95 });
  assert.equal(f.photos.length, 1);
  assert.equal(stream.track.stops, 1);
  assert.equal(video.srcObject, null);
  assert.equal(f.controller.isActive(), false);
  assert.equal(f.controller.capture(), null);
  assert.equal(f.photos.length, 1);
});

test('capture preserves available camera detail within the bound without enlarging lower-resolution video', async () => {
  for (const [width, height, expectedWidth, expectedHeight] of [[3840, 2160, 1920, 1080], [2160, 3840, 1080, 1920], [640, 480, 640, 480]]) {
    const f = fixture();
    const video = Object.assign(videoElement(), { videoWidth: width, videoHeight: height });
    assert.equal(await f.controller.start(video), true);
    const photo = f.controller.capture();
    assert.deepEqual([photo.width, photo.height], [expectedWidth, expectedHeight]);
    assert.deepEqual(f.canvases[0].context.drawn.slice(1), [0, 0, expectedWidth, expectedHeight]);
  }
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

test('permission resolving after the page becomes hidden never starts a background camera', async () => {
  const permission = deferred();
  const f = fixture(() => permission.promise);
  const stream = mediaStream(), video = videoElement();
  const starting = f.controller.start(video);
  f.browser.document.hidden = true;
  permission.resolve(stream);
  assert.equal(await starting, false);
  assert.equal(stream.track.stops, 1);
  assert.equal(video.srcObject, null);
  assert.equal(f.controller.isActive(), false);
  assert.deepEqual(f.statuses, ['requesting', 'idle']);
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

test('gallery image stops camera, scales to max 1920 pixels, and revokes its object URL', async () => {
  const stream = mediaStream();
  const f = fixture(async () => stream);
  await f.controller.start(videoElement());
  const reading = f.controller.readFile(jpeg);
  assert.equal(stream.track.stops, 1);
  f.images[0].load();
  assert.equal(await reading, true);
  assert.deepEqual(f.photos[0], { dataUrl: 'data:image/jpeg;base64,photo', width: 1440, height: 1920, source: 'upload' });
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

function autoFixture(stream = mediaStream()) {
  const f = fixture(async () => stream);
  let clock = 1000, timerId = 0;
  const timers = new Map(), workers = [];
  f.browser.setTimeout = (callback, ms) => { const id = ++timerId; timers.set(id, { callback, time: clock + ms }); return id; };
  f.browser.clearTimeout = id => timers.delete(id);
  f.browser.performance = { now: () => clock };
  f.browser.OffscreenCanvas = class {};
  f.browser.Worker = class {
    constructor(url) { this.url = url; this.messages = []; this.terminated = 0; workers.push(this); }
    postMessage(message, transfer) { this.messages.push({ message, transfer }); }
    terminate() { this.terminated += 1; }
    emit(data) { this.onmessage?.({ data }); }
    ready() { this.emit({ id: this.messages[0].message.id, type: 'ready' }); }
    frame() { return this.messages.filter(item => item.message.type === 'frame').at(-1)?.message; }
    quality(value = validQuality()) { const frame = this.frame(); this.emit({ id: frame.id, sequence: frame.sequence, timestamp: frame.timestamp, type: 'quality', quality: value }); }
  };
  const originalCanvas = f.browser.document.createElement;
  f.browser.document.createElement = () => {
    const canvas = originalCanvas();
    canvas.context.getImageData = (x, y, width, height) => ({ data: new Uint8ClampedArray(width * height * 4), width, height });
    return canvas;
  };
  function advance(ms) {
    const target = clock + ms;
    while (true) {
      const next = [...timers].filter(([, value]) => value.time <= target).sort((a, b) => a[1].time - b[1].time)[0];
      if (!next) break;
      clock = next[1].time; timers.delete(next[0]); next[1].callback();
    }
    clock = target;
  }
  return { ...f, stream, workers, timers, advance };
}
function validQuality() {
  return { acceptable: true, status: 'steady', message: 'Hold still', faceBounds: { x: .25, y: .15, width: .5, height: .7 }, anchors: [{ x: .35, y: .4 }, { x: .65, y: .4 }, { x: .5, y: .55 }, { x: .5, y: .82 }] };
}

test('automatic capture requests continuous focus where supported and shoots once after stable observations', async () => {
  const stream = mediaStream();
  const applied = [];
  stream.track.getCapabilities = () => ({ focusMode: ['manual', 'continuous'] });
  stream.track.applyConstraints = async value => applied.push(value);
  const f = autoFixture(stream);
  await f.controller.start(videoElement());
  assert.deepEqual(applied, [{ advanced: [{ focusMode: 'continuous' }] }]);
  const worker = f.workers[0]; worker.ready();
  assert.equal(worker.frame().width, 640);
  assert.equal(worker.frame().height, 360);
  const sent = worker.messages.at(-1);
  assert.equal(sent.transfer[0], sent.message.pixels.buffer);
  assert.equal(f.photos.length, 0);
  for (let i = 0; i < 4; i += 1) { worker.quality(); assert.equal(f.photos.length, 0); f.advance(350); }
  const lastFrame = worker.frame();
  worker.quality();
  assert.equal(f.photos.length, 1);
  assert.equal(worker.terminated, 1);
  assert.equal(stream.track.stops, 1);
  assert.equal(f.timers.size, 0);
  assert.equal(f.guidance.at(-1).status, 'capturing');
  assert.equal(f.guidance.at(-1).autofocusRequested, true);
  worker.emit({ ...lastFrame, type: 'quality', quality: validQuality() });
  assert.equal(f.photos.length, 1);
});

test('manual shutter works while auto model is loading and cancels all later work', async () => {
  const f = autoFixture();
  await f.controller.start(videoElement());
  const worker = f.workers[0];
  assert.equal(f.guidance.at(-1).status, 'loading');
  f.controller.capture();
  assert.equal(f.photos.length, 1);
  assert.equal(worker.terminated, 1);
  assert.equal(f.timers.size, 0);
  worker.ready();
  assert.equal(worker.messages.length, 1);
  assert.equal(f.photos.length, 1);
});

test('manual shutter works with unsupported workers, fixed-focus cameras, or rejected focus constraints', async () => {
  const f = fixture();
  await f.controller.start(videoElement());
  assert.equal(f.guidance.at(-1).status, 'manual');
  assert.equal(f.guidance.at(-1).autofocusRequested, false);
  assert.ok(f.controller.capture());
  const stream = mediaStream();
  stream.track.getCapabilities = () => ({ focusMode: ['continuous'] });
  stream.track.applyConstraints = async () => { throw new Error('Unsupported'); };
  const rejected = autoFixture(stream);
  assert.equal(await rejected.controller.start(videoElement()), true);
  assert.ok(rejected.controller.capture());
  assert.equal(rejected.errors.length, 0);
});

test('stopping auto mode retains manual camera and ignores an in-flight quality result', async () => {
  const f = autoFixture();
  await f.controller.start(videoElement());
  const worker = f.workers[0]; worker.ready();
  f.controller.stopAutoCapture();
  worker.quality();
  f.advance(60000);
  assert.equal(f.controller.isActive(), true);
  assert.equal(f.guidance.at(-1).status, 'manual');
  assert.equal(f.photos.length, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(worker.terminated, 1);
  assert.ok(f.controller.capture());
});

test('model/frame timeout falls back to manual while leaving camera usable', async () => {
  for (const stage of ['model', 'frame']) {
    const f = autoFixture();
    await f.controller.start(videoElement());
    const worker = f.workers[0];
    if (stage === 'frame') worker.ready();
    f.advance(stage === 'model' ? 30000 : 10000);
    assert.equal(f.guidance.at(-1).status, 'manual', stage);
    assert.equal(f.controller.isActive(), true, stage);
    assert.equal(f.timers.size, 0, stage);
    assert.equal(worker.terminated, 1, stage);
    assert.ok(f.controller.capture(), stage);
  }
});

test('restart, visibility loss and stop suppress stale worker messages and release resources', async () => {
  const f = autoFixture();
  await f.controller.start(videoElement());
  const old = f.workers[0]; old.ready();
  await f.controller.start(videoElement());
  old.quality();
  assert.equal(f.photos.length, 0);
  assert.equal(old.terminated, 1);
  const current = f.workers[1]; current.ready();
  f.browser.document.hidden = true;
  current.quality();
  assert.equal(f.controller.isActive(), false);
  assert.equal(current.terminated, 1);
  assert.equal(f.photos.length, 0);
  assert.equal(f.timers.size, 0);
});

test('repeated frozen video frame cannot accumulate a capture countdown', async () => {
  const f = autoFixture();
  const video = videoElement(); video.currentTime = 1;
  await f.controller.start(video);
  const worker = f.workers[0]; worker.ready(); worker.quality();
  f.advance(4000);
  assert.equal(worker.messages.filter(item => item.message.type === 'frame').length, 1);
  assert.equal(f.photos.length, 0);
  video.currentTime = 2; f.advance(350); worker.quality();
  assert.equal(f.guidance.at(-1).progress, 0);
  f.controller.stop();
  assert.equal(f.timers.size, 0);
});
