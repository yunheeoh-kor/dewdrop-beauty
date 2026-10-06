// Classic worker: the bundled WASM loader uses importScripts. Model and frames
// remain on this app's origin. The controller keeps at most one frame in flight.
let detectorPromise;
let canvas;
async function detector() {
  if (!detectorPromise) detectorPromise = (async () => {
    const { FilesetResolver, FaceLandmarker } = await import('./vendor/mediapipe/vision_bundle.mjs');
    const files = await FilesetResolver.forVisionTasks(new URL('./vendor/mediapipe/wasm', self.location.href).href);
    return FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: new URL('./models/face_landmarker.task', self.location.href).href, delegate: 'CPU' },
      runningMode: 'VIDEO', numFaces: 2,
      outputFaceBlendshapes: false, outputFacialTransformationMatrixes: false,
    });
  })();
  return detectorPromise;
}
self.onmessage = async ({ data }) => {
  if (!['init', 'frame'].includes(data?.type)) return;
  const { id, sequence, width, height, pixels, timestamp } = data;
  try {
    const model = await detector();
    if (data.type === 'init') { self.postMessage({ id, type: 'ready' }); return; }
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 32 || height < 32 || width > 640 || height > 640 || pixels?.length !== width * height * 4 || !Number.isFinite(timestamp)) throw new Error('Invalid frame');
    if (!canvas) canvas = new OffscreenCanvas(width, height);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Frame unavailable');
    const image = new ImageData(new Uint8ClampedArray(pixels), width, height);
    context.putImageData(image, 0, 0);
    const detected = model.detectForVideo(canvas, timestamp);
    const { assessCaptureFrame } = await import('./capture-quality.js');
    self.postMessage({ id, sequence, type: 'quality', timestamp, quality: assessCaptureFrame(image, detected.faceLandmarks) });
  } catch {
    self.postMessage({ id, type: 'error' });
  }
};
