// Technical capture checks, not skin analysis. Thresholds are deliberately broad
// across skin colors; they measure clipped pixels, spatial detail and movement.
const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const finitePoint = point => Number.isFinite(point?.x) && Number.isFinite(point?.y);

function guidance(status, message, extra = {}) {
  return { status, message, progress: 0, acceptable: false, faceBounds: null, ...extra };
}

function facePixelQuality({ data, width, height }, bounds) {
  const left = Math.max(1, Math.ceil((bounds.x + bounds.width * .12) * width));
  const right = Math.min(width - 2, Math.floor((bounds.x + bounds.width * .88) * width));
  const top = Math.max(1, Math.ceil((bounds.y + bounds.height * .14) * height));
  const bottom = Math.min(height - 2, Math.floor((bounds.y + bounds.height * .85) * height));
  const luminance = (x, y) => { const i = (y * width + x) * 4; return .2126 * data[i] + .7152 * data[i + 1] + .0722 * data[i + 2]; };
  const histogram = new Uint32Array(256);
  let count = 0, dark = 0, bright = 0, sum = 0, sumSquares = 0;
  for (let y = top; y <= bottom; y += 2) {
    for (let x = left; x <= right; x += 2) {
      const center = luminance(x, y);
      histogram[Math.round(center)] += 1;
      dark += Number(center < 8); bright += Number(center > 247);
      const laplacian = luminance(x - 1, y) + luminance(x + 1, y) + luminance(x, y - 1) + luminance(x, y + 1) - 4 * center;
      sum += laplacian; sumSquares += laplacian * laplacian; count += 1;
    }
  }
  if (!count) return null;
  const percentile = p => { let total = 0; for (let i = 0; i < 256; i += 1) { total += histogram[i]; if (total >= count * p) return i; } return 255; };
  return { sharpness: Math.max(0, sumSquares / count - (sum / count) ** 2), darkFraction: dark / count, brightFraction: bright / count, tonalRange: percentile(.9) - percentile(.1) };
}

/** Evaluate one actual frame and detector result. Face bounds use unmirrored source coordinates. */
export function assessCaptureFrame(image, faces) {
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 32 || image.height < 32 || image.data?.length !== image.width * image.height * 4) {
    return guidance('manual', 'Auto capture cannot read this preview. Tap the shutter to take your photo.');
  }
  if (!Array.isArray(faces) || !faces.length) return guidance('searching', 'Bring your face into the frame.');
  if (faces.length !== 1) return guidance('position', 'Keep just one face in the frame.');
  const landmarks = faces[0];
  if (!Array.isArray(landmarks) || landmarks.length < 468 || landmarks.some(point => !finitePoint(point))) return guidance('searching', 'Keep your face clearly visible.');
  const xs = landmarks.slice(0, 468).map(point => point.x), ys = landmarks.slice(0, 468).map(point => point.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  const bounds = { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  const extra = { faceBounds: bounds };
  // x and y are normalized independently by MediaPipe. Use one physical unit
  // (the frame's shorter edge) for angles, face size and motion so portrait and
  // landscape previews apply the same checks to the same visible face.
  const shortEdge = Math.min(image.width, image.height);
  const scale = { x: image.width / shortEdge, y: image.height / shortEdge };
  const physicalPoint = point => ({ x: point.x * scale.x, y: point.y * scale.y });
  const faceSize = { width: bounds.width * scale.x, height: bounds.height * scale.y };
  if (faceSize.width < .26 || faceSize.height < .32) return guidance('position', 'Move a little closer to the camera.', extra);
  if (x < .025 || y < .025 || x + bounds.width > .975 || y + bounds.height > .975 || bounds.width > .88 || bounds.height > .9) return guidance('position', 'Move back a little so your whole face fits.', extra);
  if (Math.abs(x + bounds.width / 2 - .5) > .12 || Math.abs(y + bounds.height / 2 - .5) > .15) return guidance('position', 'Center your face in the frame.', extra);
  const [eyeA, eyeB, nose, chin] = [33, 263, 1, 152].map(index => physicalPoint(landmarks[index]));
  const eyeDistance = distance(eyeA, eyeB);
  const eyeMid = { x: (eyeA.x + eyeB.x) / 2, y: (eyeA.y + eyeB.y) / 2 };
  const noseFraction = (nose.y - eyeMid.y) / Math.max(.01, chin.y - eyeMid.y);
  if (eyeDistance < .08 || Math.abs(eyeA.y - eyeB.y) / eyeDistance > .22 || Math.abs(nose.x - eyeMid.x) / eyeDistance > .23 || noseFraction < .12 || noseFraction > .66) {
    return guidance('position', 'Look straight at the camera and keep your head level.', extra);
  }
  const metrics = facePixelQuality(image, bounds);
  if (!metrics || metrics.darkFraction > .45 || metrics.brightFraction > .3 || metrics.tonalRange < 8) return guidance('exposure', 'Try soft, even light in front of your face.', { ...extra, metrics });
  // Variance of the face crop's Laplacian is a blur gate, not a hardware
  // autofocus lock signal. Noise and sharpening can affect this estimate.
  if (metrics.sharpness < 14) return guidance('sharpness', 'Hold the phone still and let the camera sharpen your face.', { ...extra, metrics });
  return guidance('steady', 'Hold still — your photo will be taken automatically.', { ...extra, acceptable: true, metrics, frameSize: { width: image.width, height: image.height }, faceSize, anchors: [eyeA, eyeB, nose, chin] });
}

/** Require consecutive, recent, stable quality observations before one shutter event. */
export function createCaptureStabilityGate({ holdMs = 1200, minFrames = 4, maxGapMs = 1200 } = {}) {
  let baseline = null, previousTime = null, startedAt = null, frames = 0, captured = false;
  function reset() { baseline = null; previousTime = null; startedAt = null; frames = 0; captured = false; }
  function update(quality, timestamp) {
    if (captured) return { ...quality, status: 'capturing', progress: 1, capture: false };
    if (!quality?.acceptable || !Array.isArray(quality.anchors) || quality.anchors.length !== 4 || !Number.isFinite(timestamp)) {
      baseline = null; startedAt = null; frames = 0; previousTime = null;
      return { ...quality, capture: false, progress: 0 };
    }
    const size = quality.faceSize || quality.faceBounds;
    const sameFrameSize = baseline && quality.frameSize?.width === baseline.frameSize?.width && quality.frameSize?.height === baseline.frameSize?.height;
    const sameRun = sameFrameSize && timestamp > previousTime && timestamp - previousTime <= maxGapMs;
    const baselineSize = baseline?.faceSize || baseline?.faceBounds;
    const moved = sameRun && (Math.max(...quality.anchors.map((point, index) => distance(point, baseline.anchors[index]))) > .025 || Math.abs(size.width - baselineSize.width) > .035 || Math.abs(size.height - baselineSize.height) > .045);
    if (!sameRun || moved) { baseline = quality; startedAt = timestamp; frames = 0; }
    previousTime = timestamp; frames += 1;
    const progress = clamp(Math.min((timestamp - startedAt) / holdMs, frames / minFrames));
    captured = progress >= 1;
    return { ...quality, status: captured ? 'capturing' : 'steady', message: captured ? 'Taking your photo…' : moved ? 'Keep still for a moment — auto capture is ready.' : 'Hold still — your photo will be taken automatically.', progress, capture: captured };
  }
  return { update, reset };
}
