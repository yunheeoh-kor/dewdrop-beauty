// A classic worker permits the bundled MediaPipe WASM loader's importScripts.
// All imports, model weights, and inference stay on the app's own origin.
let landmarkerPromise;
async function getLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const { FilesetResolver, FaceLandmarker } = await import('./vendor/mediapipe/vision_bundle.mjs');
      const files = await FilesetResolver.forVisionTasks(new URL('./vendor/mediapipe/wasm', self.location.href).href);
      return FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: new URL('./models/face_landmarker.task', self.location.href).href, delegate: 'CPU' },
        runningMode: 'IMAGE', numFaces: 2,
        outputFaceBlendshapes: false, outputFacialTransformationMatrixes: false,
      });
    })().catch(error => { landmarkerPromise = null; throw error; });
  }
  return landmarkerPromise;
}

self.onmessage = async ({ data }) => {
  if (data?.type !== 'analyze') return;
  const { id, width, height, pixels } = data;
  try {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 1200 || height > 1200 || pixels?.length !== width * height * 4) throw new Error('Invalid photo pixels');
    self.postMessage({ id, type: 'status', status: 'loading_model' });
    const detector = await getLandmarker();
    const { analyzeFacePixels } = await import('./photo-measurements.js');
    self.postMessage({ id, type: 'status', status: 'analyzing' });
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Photo canvas unavailable');
    const image = new ImageData(new Uint8ClampedArray(pixels), width, height);
    context.putImageData(image, 0, 0);
    const detected = detector.detect(canvas);
    const analysis = analyzeFacePixels(image, detected.faceLandmarks);
    self.postMessage({ id, type: 'result', analysis: { ...analysis, model: 'MediaPipe Face Landmarker', analyzedAt: new Date().toISOString() } });
    canvas.width = 1;
    canvas.height = 1;
  } catch (error) {
    // No source image, landmarks, or personal observations are logged.
    self.postMessage({ id, type: 'error', message: 'Image analysis could not run. Try again, or update your browser / Android System WebView.' });
  }
};
