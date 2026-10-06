// Photos and preview quality checks stay in memory on this device.
import { createCaptureStabilityGate } from './capture-quality.js';
const MAX_FILE_BYTES = 15 * 1024 * 1024;
// Preserve more real detail for skin appearance; never upscale small sources.
const MAX_EDGE = 1920;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const noop = () => {};

export const CAMERA_MESSAGES = Object.freeze({
  unavailable: 'This browser cannot open the camera. Choose a photo instead.',
  permission: 'Camera access was denied. Allow camera access in your device settings, or choose a photo.',
  missing: 'No camera was found. Choose a photo instead.',
  busy: 'Your camera is busy or unavailable. Close other camera apps and try again, or choose a photo.',
  notReady: 'The camera is still getting ready. Wait a moment and try again.',
  failed: 'The camera could not start. Try again, or choose a photo.',
  ended: 'The camera stopped. Open it again, or choose a photo.',
  fileType: 'Choose a JPG, PNG, or WebP photo.',
  fileSize: 'Choose a photo smaller than 15 MB.',
  fileRead: 'This photo could not be opened. Try a different JPG, PNG, or WebP photo.',
  capture: 'The photo could not be taken. Try again, or choose a photo.',
});

function cameraError(error) {
  if (['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(error?.name)) return ['permission', CAMERA_MESSAGES.permission];
  if (['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError'].includes(error?.name)) return ['missing', CAMERA_MESSAGES.missing];
  if (['NotReadableError', 'TrackStartError'].includes(error?.name)) return ['busy', CAMERA_MESSAGES.busy];
  return ['failed', CAMERA_MESSAGES.failed];
}

/**
 * onStatus receives requesting | ready | processing | idle.
 * onError receives (userReadyMessage, code). Canceled operations are silent.
 * onPhoto receives {dataUrl, width, height, source: 'camera' | 'upload'}.
 * onGuidance receives {status, message, progress, faceBounds, autofocusRequested}.
 * Bounds use normalized, unmirrored source coordinates; progress is 0..1.
 * start(video, {autoCapture:true}) and readFile(file) resolve true on success.
 * capture() returns the photo or null; stop() releases resources and cancels work.
 * Optional browser supplies navigator/document/Image/URL for isolated tests.
 */
export function createCameraController({ onPhoto = noop, onError = noop, onStatus = noop, onGuidance = noop, browser = globalThis } = {}) {
  let generation = 0;
  let stream = null;
  let video = null;
  let cancelPending = null;
  let removeTrackListeners = noop;
  let captureGeneration = 0;
  let captureWorker = null;
  let captureTimer = null;
  let workerTimeout = null;
  let previewCanvas = null;
  let autofocusRequested = false;
  const later = (callback, ms) => (browser.setTimeout || globalThis.setTimeout)(callback, ms);
  const clearLater = id => (browser.clearTimeout || globalThis.clearTimeout)(id);
  const now = () => browser.performance?.now?.() ?? Date.now();

  function guide(status, message, extra = {}) {
    onGuidance({ status, message, progress: 0, faceBounds: null, autofocusRequested, ...extra });
  }

  function haltAutoCapture() {
    captureGeneration += 1;
    clearLater(captureTimer); captureTimer = null;
    clearLater(workerTimeout); workerTimeout = null;
    captureWorker?.terminate(); captureWorker = null;
    if (previewCanvas) { previewCanvas.width = 1; previewCanvas.height = 1; previewCanvas = null; }
  }

  function stopAutoCapture() {
    haltAutoCapture();
    if (stream) guide('manual', 'Tap the shutter whenever you are ready.');
  }

  function startAutoCapture() {
    haltAutoCapture();
    if (!stream || !video) return false;
    const token = generation, id = captureGeneration;
    const active = () => token === generation && id === captureGeneration && stream && video;
    const manualFallback = () => {
      if (!active()) return;
      haltAutoCapture();
      guide('manual', 'Auto capture is unavailable on this device. Tap the shutter to take your photo.');
    };
    if (!browser.Worker || !browser.OffscreenCanvas) { manualFallback(); return false; }
    const gate = createCaptureStabilityGate();
    let sequence = 0, pendingSequence = null, pendingTimestamp = null, previousVideoTime = null, lastTimestamp = -1, ready = false;
    function sendFrame() {
      if (!active()) return;
      if (browser.document?.hidden) { stop(); return; }
      if (video.readyState < 2 || !video.videoWidth || !video.videoHeight || (Number.isFinite(video.currentTime) && video.currentTime === previousVideoTime)) {
        captureTimer = later(sendFrame, 350); return;
      }
      try {
        if (!previewCanvas) previewCanvas = browser.document.createElement('canvas');
        const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
        const width = Math.round(video.videoWidth * scale), height = Math.round(video.videoHeight * scale);
        previewCanvas.width = width; previewCanvas.height = height;
        const context = previewCanvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Preview unavailable');
        context.drawImage(video, 0, 0, width, height);
        const image = context.getImageData(0, 0, width, height);
        previousVideoTime = video.currentTime;
        lastTimestamp = Math.max(lastTimestamp + 1, now());
        pendingSequence = ++sequence; pendingTimestamp = lastTimestamp;
        workerTimeout = later(manualFallback, 10000);
        captureWorker.postMessage({ type: 'frame', id, sequence, width, height, timestamp: lastTimestamp, pixels: image.data }, [image.data.buffer]);
      } catch { manualFallback(); }
    }
    guide('loading', 'Preparing auto capture. You can also tap the shutter.');
    try {
      captureWorker = new browser.Worker(new URL('./capture-worker.js', import.meta.url));
      captureWorker.onmessage = ({ data }) => {
        if (!active() || data?.id !== id) return;
        if (browser.document?.hidden) { stop(); return; }
        if (data.type === 'error') { manualFallback(); return; }
        if (data.type === 'ready' && !ready) {
          ready = true;
          clearLater(workerTimeout); workerTimeout = null;
          guide('searching', 'Center your face — we will take the photo when it is clear and steady.');
          sendFrame();
        } else if (data.type === 'quality' && ready && pendingSequence !== null && data.sequence === pendingSequence && data.timestamp === pendingTimestamp) {
          clearLater(workerTimeout); workerTimeout = null; pendingSequence = null;
          const quality = gate.update(data.quality, data.timestamp);
          guide(quality.status, quality.message, { progress: quality.progress, faceBounds: quality.faceBounds });
          if (quality.capture) { if (!capture()) stopAutoCapture(); return; }
          captureTimer = later(sendFrame, Math.max(0, 350 - (now() - data.timestamp)));
        }
      };
      captureWorker.onerror = event => { event.preventDefault?.(); manualFallback(); };
      workerTimeout = later(manualFallback, 30000);
      captureWorker.postMessage({ type: 'init', id });
      return true;
    } catch { manualFallback(); return false; }
  }

  function requestContinuousFocus(track, token) {
    try {
      if (!track?.getCapabilities?.().focusMode?.includes('continuous') || !track.applyConstraints) return;
      // This is a best-effort hardware request. The web API exposes no focus-lock
      // event; automatic capture relies on measured clarity and stable framing.
      Promise.resolve(track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] })).then(() => {
        if (token === generation && stream) autofocusRequested = true;
      }, noop);
    } catch { /* Fixed-focus selfie cameras remain fully supported. */ }
  }

  function releaseCamera() {
    haltAutoCapture();
    removeTrackListeners();
    removeTrackListeners = noop;
    const oldStream = stream;
    const oldVideo = video;
    stream = null;
    video = null;
    if (oldVideo) {
      try { oldVideo.pause(); } catch { /* A detached video can already be stopped. */ }
      oldVideo.srcObject = null;
    }
    oldStream?.getTracks().forEach(track => track.stop());
  }

  function reset() {
    generation += 1;
    const cancel = cancelPending;
    cancelPending = null;
    cancel?.();
    releaseCamera();
    autofocusRequested = false;
    guide('idle', '');
    return generation;
  }

  function stop() {
    reset();
    onStatus('idle');
  }

  function rasterize(source, width, height, kind) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('Invalid image dimensions');
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    const canvas = browser.document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable');
    // Transparent PNGs become an opaque white photo when converted to JPEG.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
    if (!dataUrl.startsWith('data:image/jpeg')) throw new Error('Could not encode photo');
    return { dataUrl, width: canvas.width, height: canvas.height, source: kind };
  }

  function waitForVideo(element, token) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const events = ['loadeddata', 'canplay', 'resize'];
      const finish = (value, error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        events.forEach(event => element.removeEventListener(event, check));
        if (cancelPending === cancel) cancelPending = null;
        error ? reject(error) : resolve(value);
      };
      const cancel = () => finish(false);
      const check = () => {
        if (token !== generation) return finish(false);
        if (element.readyState >= 2 && element.videoWidth > 0 && element.videoHeight > 0) finish(true);
      };
      const timer = setTimeout(() => finish(false, new Error('Camera readiness timed out')), 12000);
      cancelPending = cancel;
      events.forEach(event => element.addEventListener(event, check));
      try {
        Promise.resolve(element.play()).then(check, error => finish(false, error));
        check();
      } catch (error) { finish(false, error); }
    });
  }

  async function start(element, { autoCapture = true } = {}) {
    const token = reset();
    if (!browser.navigator?.mediaDevices?.getUserMedia || !element) {
      onStatus('idle');
      onError(CAMERA_MESSAGES.unavailable, 'unavailable');
      return false;
    }
    onStatus('requesting');
    try {
      const requestedStream = await browser.navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'user' }, width: { ideal: MAX_EDGE }, height: { ideal: MAX_EDGE } },
      });
      if (token !== generation || browser.document?.hidden) {
        requestedStream.getTracks().forEach(track => track.stop());
        if (token === generation) stop();
        return false;
      }
      stream = requestedStream;
      video = element;
      element.muted = true;
      element.playsInline = true;
      element.autoplay = true;
      element.srcObject = stream;
      const ended = () => {
        if (token !== generation) return;
        stop();
        onError(CAMERA_MESSAGES.ended, 'ended');
      };
      const tracks = stream.getVideoTracks();
      requestContinuousFocus(tracks[0], token);
      tracks.forEach(track => track.addEventListener('ended', ended));
      removeTrackListeners = () => tracks.forEach(track => track.removeEventListener('ended', ended));
      const ready = await waitForVideo(element, token);
      if (!ready || token !== generation) return false;
      if (browser.document?.hidden) { stop(); return false; }
    } catch (error) {
      if (token !== generation) return false;
      reset();
      onStatus('idle');
      const [code, message] = cameraError(error);
      onError(message, code);
      return false;
    }
    onStatus('ready');
    if (autoCapture) startAutoCapture();
    else guide('manual', 'Tap the shutter whenever you are ready.');
    return true;
  }

  function capture() {
    if (!stream || !video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      onError(CAMERA_MESSAGES.notReady, 'notReady');
      return null;
    }
    const token = generation;
    let photo;
    try { photo = rasterize(video, video.videoWidth, video.videoHeight, 'camera'); }
    catch {
      onError(CAMERA_MESSAGES.capture, 'capture');
      return null;
    }
    releaseCamera();
    onStatus('idle');
    if (token !== generation) return null;
    onPhoto(photo);
    return photo;
  }

  async function readFile(file) {
    const token = reset();
    if (!file) {
      onStatus('idle');
      return false;
    }
    if (!IMAGE_TYPES.has(file.type)) {
      onStatus('idle');
      onError(CAMERA_MESSAGES.fileType, 'fileType');
      return false;
    }
    if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_FILE_BYTES) {
      onStatus('idle');
      onError(CAMERA_MESSAGES.fileSize, 'fileSize');
      return false;
    }
    onStatus('processing');
    let photo;
    try {
      const decoded = await new Promise((resolve, reject) => {
        const image = new browser.Image();
        let objectUrl;
        let settled = false;
        const clean = () => {
          clearTimeout(timer);
          image.onload = null;
          image.onerror = null;
          if (objectUrl) browser.URL.revokeObjectURL(objectUrl);
          if (cancelPending === cancel) cancelPending = null;
        };
        const cancel = () => {
          if (settled) return;
          settled = true;
          clean();
          image.src = '';
          resolve(null);
        };
        const fail = () => {
          if (settled) return;
          settled = true;
          clean();
          reject(new Error('Unable to decode photo'));
        };
        const timer = setTimeout(fail, 15000);
        cancelPending = cancel;
        image.onload = () => {
          if (settled) return;
          settled = true;
          clean();
          resolve(image);
        };
        image.onerror = fail;
        try {
          objectUrl = browser.URL.createObjectURL(file);
          image.src = objectUrl;
        } catch { fail(); }
      });
      if (!decoded || token !== generation) return false;
      photo = rasterize(decoded, decoded.naturalWidth, decoded.naturalHeight, 'upload');
    } catch {
      if (token !== generation) return false;
      onStatus('idle');
      onError(CAMERA_MESSAGES.fileRead, 'fileRead');
      return false;
    }
    onStatus('idle');
    if (token !== generation) return false;
    onPhoto(photo);
    return true;
  }

  return { start, capture, stop, readFile, startAutoCapture, stopAutoCapture, isActive: () => Boolean(stream) };
}
