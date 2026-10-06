import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhotoAnalyzer } from '../web/photo-analysis.js';

const PHOTO = { dataUrl: 'data:image/jpeg;base64,local-photo', width: 2, height: 2 };

// Exercise orchestration with actual transferable ArrayBuffers. Browser model
// inference is checked separately with the official MediaPipe portrait fixture.
function fixture(t) {
  const images = [], workers = [], canvases = [], statuses = [];
  const timers = new Map();
  let timerId = 0;
  class FakeImage {
    constructor() {
      this.naturalWidth = 2;
      this.naturalHeight = 2;
      images.push(this);
    }
    set src(value) { this.url = value; }
    load() { this.onload?.(); }
    fail() { this.onerror?.(); }
  }
  class FakeWorker {
    constructor(url, options) {
      this.url = url;
      this.options = options;
      this.terminations = 0;
      this.posts = [];
      workers.push(this);
    }
    postMessage(data, transfer) {
      // structuredClone uses the same transfer semantics as postMessage: the
      // caller loses access to its pixel buffer and the worker receives bytes.
      const received = structuredClone(data, { transfer });
      this.posts.push({ received, transfer });
    }
    terminate() { this.terminations += 1; }
    emit(type, values = {}) {
      this.onmessage?.({ data: { id: this.posts[0].received.id, type, ...values } });
    }
  }
  const globals = {
    Image: FakeImage,
    Worker: FakeWorker,
    OffscreenCanvas: class {},
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    document: {
      createElement(tag) {
        assert.equal(tag, 'canvas');
        const pixels = new Uint8ClampedArray([11, 22, 33, 255, 44, 55, 66, 255, 77, 88, 99, 255, 111, 122, 133, 255]);
        const context = {
          drawImage(...args) { this.drawn = args; },
          getImageData(x, y, width, height) { return { width, height, data: width * height * 4 === pixels.length ? pixels : new Uint8ClampedArray(width * height * 4) }; },
        };
        const canvas = { getContext: () => context, context, pixels };
        canvases.push(canvas);
        return canvas;
      },
    },
  };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  const analyzer = createPhotoAnalyzer({ onStatus: status => statuses.push(status) });
  t.after(() => {
    analyzer.cancel();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return {
    analyzer, images, workers, canvases, statuses, timers,
    expire(delay) {
      const entry = [...timers].find(([, timer]) => timer.delay === delay);
      assert.ok(entry, `Expected an active ${delay}ms timer`);
      timers.delete(entry[0]);
      entry[1].callback();
    },
  };
}

async function beginInference(f, photo = PHOTO) {
  const completion = f.analyzer.analyze(photo);
  f.images.at(-1).load();
  await Promise.resolve();
  const worker = f.workers.at(-1);
  assert.ok(worker, 'Decoding should start the analysis worker');
  return { completion, worker };
}

test('valid photo pixels are transferred to a local classic worker and released after its result', async t => {
  const f = fixture(t);
  const { completion, worker } = await beginInference(f);
  assert.match(worker.url.pathname, /\/web\/analysis-worker\.js$/);
  assert.equal(worker.options?.type, undefined, 'MediaPipe needs the classic worker importScripts API');
  const { received, transfer } = worker.posts[0];
  assert.deepEqual({ type: received.type, width: received.width, height: received.height }, { type: 'analyze', width: 2, height: 2 });
  assert.deepEqual([...received.pixels], [11, 22, 33, 255, 44, 55, 66, 255, 77, 88, 99, 255, 111, 122, 133, 255]);
  assert.equal(transfer.length, 1);
  assert.equal(transfer[0].byteLength, 0, 'Original buffer must be detached');
  assert.equal(f.canvases[0].pixels.byteLength, 0);
  assert.equal(f.canvases[0].width, 1);
  assert.equal(f.canvases[0].height, 1);
  worker.emit('status', { status: 'loading_model' });
  worker.emit('status', { status: 'analyzing' });
  const analysis = { status: 'ready', faceCount: 1, colorFamily: 'rose' };
  worker.emit('result', { analysis });
  assert.deepEqual(await completion, analysis);
  assert.deepEqual(f.statuses, ['reading_photo', 'loading_model', 'analyzing']);
  assert.equal(worker.terminations, 1);
  assert.equal(f.timers.size, 0);
});

test('removing a photo during decode clears image callbacks, URL, and timeout without starting inference', async t => {
  const f = fixture(t);
  const completion = f.analyzer.analyze(PHOTO);
  const image = f.images[0];
  const lateLoad = image.onload;
  f.analyzer.cancel();
  assert.equal(await completion, null);
  assert.equal(image.url, '');
  assert.equal(image.onload, null);
  assert.equal(image.onerror, null);
  assert.equal(f.timers.size, 0);
  lateLoad();
  await Promise.resolve();
  assert.equal(f.workers.length, 0);
  assert.equal(f.canvases.length, 0);
});

test('1920-pixel portrait and landscape photos retain their full detail in the analysis transfer', async t => {
  const f = fixture(t);
  for (const [width, height] of [[1920, 1080], [1080, 1920]]) {
    const completion = f.analyzer.analyze({ ...PHOTO, width, height });
    Object.assign(f.images.at(-1), { naturalWidth: width, naturalHeight: height });
    f.images.at(-1).load();
    await Promise.resolve();
    const worker = f.workers.at(-1);
    const { received, transfer } = worker.posts[0];
    assert.deepEqual([received.width, received.height, received.pixels.length], [width, height, width * height * 4]);
    assert.equal(transfer[0].byteLength, 0);
    worker.emit('result', { analysis: { status: 'ready' } });
    assert.equal((await completion).status, 'ready');
    assert.equal(worker.terminations, 1);
  }
  assert.equal(f.timers.size, 0);
});

test('replacing a photo while decoding settles the old request and analyzes only the replacement', async t => {
  const f = fixture(t);
  const original = f.analyzer.analyze(PHOTO);
  const replacement = f.analyzer.analyze({ ...PHOTO, dataUrl: 'data:image/jpeg;base64,replacement' });
  assert.equal(await original, null);
  assert.equal(f.images[0].url, '');
  assert.equal(f.images[0].onload, null);
  f.images[1].load();
  await Promise.resolve();
  assert.equal(f.workers.length, 1);
  f.workers[0].emit('result', { analysis: { status: 'ready', replacement: true } });
  assert.deepEqual(await replacement, { status: 'ready', replacement: true });
  assert.equal(f.timers.size, 0);
});

test('removing a photo during model loading terminates the worker and ignores late results and progress', async t => {
  const f = fixture(t);
  const { completion, worker } = await beginInference(f);
  worker.emit('status', { status: 'loading_model' });
  f.analyzer.cancel();
  const statuses = [...f.statuses];
  assert.equal(await completion, null);
  assert.equal(worker.terminations, 1);
  assert.equal(f.timers.size, 0);
  worker.emit('result', { analysis: { status: 'ready', stale: true } });
  worker.emit('status', { status: 'analyzing' });
  worker.emit('error', { message: 'stale error' });
  assert.deepEqual(f.statuses, statuses);
  assert.equal(worker.terminations, 1);
});

test('late worker messages from a replaced photo cannot settle or terminate its replacement', async t => {
  const f = fixture(t);
  const first = await beginInference(f);
  const second = await beginInference(f, { ...PHOTO, dataUrl: 'data:image/jpeg;base64,second' });
  assert.equal(await first.completion, null);
  assert.equal(first.worker.terminations, 1);
  assert.notEqual(first.worker.posts[0].received.id, second.worker.posts[0].received.id);
  const statuses = [...f.statuses];
  first.worker.emit('result', { analysis: { stale: true } });
  first.worker.emit('status', { status: 'stale status' });
  first.worker.emit('error', { message: 'stale failure' });
  assert.equal(second.worker.terminations, 0);
  assert.deepEqual(f.statuses, statuses);
  assert.equal(f.timers.size, 1);
  second.worker.emit('result', { analysis: { status: 'ready', second: true } });
  assert.deepEqual(await second.completion, { status: 'ready', second: true });
  assert.equal(second.worker.terminations, 1);
  assert.equal(f.timers.size, 0);
});

test('a worker timeout rejects the request, releases model resources, and permits a fresh retry', async t => {
  const f = fixture(t);
  const first = await beginInference(f);
  const rejection = assert.rejects(first.completion, /took too long/);
  f.expire(60000);
  await rejection;
  assert.equal(first.worker.terminations, 1);
  assert.equal(f.timers.size, 0);
  const retry = await beginInference(f);
  retry.worker.emit('result', { analysis: { status: 'retake', faceCount: 0 } });
  assert.deepEqual(await retry.completion, { status: 'retake', faceCount: 0 });
  assert.equal(retry.worker.terminations, 1);
});

test('worker model errors reject with the actionable message and terminate the worker', async t => {
  const f = fixture(t);
  const { completion, worker } = await beginInference(f);
  const rejection = assert.rejects(completion, /Image analysis could not run/);
  worker.emit('error', { message: 'Image analysis could not run. Try again.' });
  await rejection;
  assert.equal(worker.terminations, 1);
  assert.equal(f.timers.size, 0);
});

test('worker startup errors suppress raw browser details and release the pending request', async t => {
  const f = fixture(t);
  const { completion, worker } = await beginInference(f);
  let prevented = false;
  const rejection = assert.rejects(completion, /analysis model could not start/);
  worker.onerror({ message: 'Internal WASM diagnostic', preventDefault() { prevented = true; } });
  await rejection;
  assert.equal(prevented, true);
  assert.equal(worker.terminations, 1);
  assert.equal(f.timers.size, 0);
});

test('corrupt and stalled image decoding rejects before any worker is created', async t => {
  const f = fixture(t);
  const corrupt = f.analyzer.analyze(PHOTO);
  const corruptRejection = assert.rejects(corrupt, /photo could not be opened/);
  f.images[0].fail();
  await corruptRejection;
  assert.equal(f.images[0].onload, null);
  assert.equal(f.images[0].onerror, null);
  assert.equal(f.timers.size, 0);
  const stalled = f.analyzer.analyze(PHOTO);
  const stalledRejection = assert.rejects(stalled, /photo could not be opened/);
  f.expire(15000);
  await stalledRejection;
  assert.equal(f.images[1].onload, null);
  assert.equal(f.images[1].onerror, null);
  assert.equal(f.workers.length, 0);
  assert.equal(f.timers.size, 0);
});

test('unsupported browsers and oversized decoded images fail before pixel allocation or inference', async t => {
  const f = fixture(t);
  const originalWorker = globalThis.Worker;
  globalThis.Worker = undefined;
  await assert.rejects(f.analyzer.analyze(PHOTO), /updated browser/);
  assert.equal(f.images.length, 0);
  globalThis.Worker = originalWorker;
  for (const [width, height] of [[1921, 1080], [1080, 1921]]) {
    const oversized = f.analyzer.analyze(PHOTO);
    const rejection = assert.rejects(oversized, /captured or selected in the app/);
    Object.assign(f.images.at(-1), { naturalWidth: width, naturalHeight: height });
    f.images.at(-1).load();
    await rejection;
  }
  assert.equal(f.canvases.length, 0);
  assert.equal(f.workers.length, 0);
  assert.equal(f.timers.size, 0);
});
