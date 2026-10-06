// Photos stay in memory. This module does not upload, persist, or analyze images.
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_EDGE = 1200;
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
 * start(video) and readFile(file) resolve true on success, false on cancellation/error.
 * capture() returns the photo or null; stop() releases resources and cancels work.
 * Optional browser supplies navigator/document/Image/URL for isolated tests.
 */
export function createCameraController({ onPhoto = noop, onError = noop, onStatus = noop, browser = globalThis } = {}) {
  let generation = 0;
  let stream = null;
  let video = null;
  let cancelPending = null;
  let removeTrackListeners = noop;

  function releaseCamera() {
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
    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
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

  async function start(element) {
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
        video: { facingMode: { ideal: 'user' }, width: { ideal: 1200 }, height: { ideal: 1200 } },
      });
      if (token !== generation) {
        requestedStream.getTracks().forEach(track => track.stop());
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
      tracks.forEach(track => track.addEventListener('ended', ended));
      removeTrackListeners = () => tracks.forEach(track => track.removeEventListener('ended', ended));
      const ready = await waitForVideo(element, token);
      if (!ready || token !== generation) return false;
    } catch (error) {
      if (token !== generation) return false;
      reset();
      onStatus('idle');
      const [code, message] = cameraError(error);
      onError(message, code);
      return false;
    }
    onStatus('ready');
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

  return { start, capture, stop, readFile, isActive: () => Boolean(stream) };
}
