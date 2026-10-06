import { createCameraController } from '/camera.js';
import { createPhotoAnalyzer } from '/photo-analysis.js';

const $ = selector => document.querySelector(selector);
const canvas = $('#fixture'), context = canvas.getContext('2d');
const events = [];
let sourceImage = null, faceBounds = null, stream = null, animation = null, tick = 0, count = 0, preparing = false, generation = 0;
function log(message) { events.push(message); if (events.length > 45) events.shift(); $('#log').textContent = events.join('\n'); }
function cleanStream() { clearInterval(animation); animation = null; stream?.getTracks().forEach(track => track.stop()); stream = null; $('#active').textContent = 'no'; }
function paint() {
  const scene = $('#scene').value;
  context.filter = 'none'; context.fillStyle = '#999999'; context.fillRect(0, 0, 640, 640);
  if (sourceImage && faceBounds && scene !== 'absent') {
    const cx = (faceBounds.x + faceBounds.width / 2) * sourceImage.naturalWidth;
    const cy = (faceBounds.y + faceBounds.height / 2) * sourceImage.naturalHeight;
    const scale = 640 * .60 / (faceBounds.height * sourceImage.naturalHeight);
    context.filter = scene === 'blurred' ? 'blur(16px)' : 'none';
    context.drawImage(sourceImage, 320 - cx * scale, 320 - cy * scale, sourceImage.naturalWidth * scale, sourceImage.naturalHeight * scale);
    context.filter = 'none';
  }
  // A changing border pixel guarantees fresh canvas video frames. It is outside
  // the face crop and does not contribute to exposure or sharpness checks.
  context.fillStyle = tick++ % 2 ? '#898989' : '#8a8a8a'; context.fillRect(0, 0, 2, 2);
  stream?.getVideoTracks()[0]?.requestFrame?.();
}
function updateControls(status) {
  $('#start').disabled = preparing || status === 'requesting' || status === 'ready';
  $('#manual').disabled = status !== 'ready';
  $('#stop').disabled = !preparing && !controller.isActive();
  $('#active').textContent = controller.isActive() ? 'yes' : 'no';
}
const facade = {
  document, Worker, OffscreenCanvas, Image, URL, performance,
  setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window),
  navigator: { mediaDevices: { getUserMedia: async () => {
    cleanStream(); paint(); stream = canvas.captureStream(8);
    animation = setInterval(paint, 125);
    log('Synthetic source stream created. No hardware permission requested.');
    return stream;
  } } },
};
const controller = createCameraController({
  browser: facade,
  onStatus(status) { $('#status').textContent = `Camera controller: ${status}`; log(`status: ${status}`); updateControls(status); },
  onGuidance(value) {
    $('#guidance').textContent = `${value.status}: ${value.message}`;
    $('#progress').value = value.progress || 0;
    log(`guidance: ${value.status}; progress=${(value.progress || 0).toFixed(2)}; face=${value.faceBounds ? JSON.stringify(value.faceBounds) : 'none'}; hardwareFocusRequested=${value.autofocusRequested}`);
  },
  onError(message, code) { $('#status').textContent = `ERROR ${code}: ${message}`; log(`error: ${code}: ${message}`); },
  onPhoto(photo) {
    count += 1; $('#count').textContent = count; $('#source').textContent = photo.source;
    $('#captured').src = photo.dataUrl; $('#captured').hidden = false;
    log(`PHOTO ${count}: source=${photo.source}, ${photo.width}×${photo.height}`);
    $('#status').textContent = `Captured photo ${count}. Stream and worker released.`;
    cleanStream(); updateControls('idle');
  },
});
const analyzer = createPhotoAnalyzer({ onStatus(status) { if (preparing) { $('#status').textContent = `Fixture setup: ${status}`; log(`portrait analysis: ${status}`); } } });

async function prepare(token) {
  if (sourceImage && faceBounds) return;
  if (!sourceImage) sourceImage = await new Promise((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('Portrait fixture could not load.')); image.src = '/test-portrait.jpg';
  });
  if (token !== generation) return;
  const photoCanvas = document.createElement('canvas');
  const scale = Math.min(1, 1200 / Math.max(sourceImage.naturalWidth, sourceImage.naturalHeight));
  photoCanvas.width = Math.round(sourceImage.naturalWidth * scale); photoCanvas.height = Math.round(sourceImage.naturalHeight * scale);
  photoCanvas.getContext('2d').drawImage(sourceImage, 0, 0, photoCanvas.width, photoCanvas.height);
  const analysis = await analyzer.analyze({ dataUrl: photoCanvas.toDataURL('image/jpeg', .92), width: photoCanvas.width, height: photoCanvas.height, source: 'upload' });
  photoCanvas.width = 1; photoCanvas.height = 1;
  if (!analysis || token !== generation) return;
  if (analysis.status !== 'ready' || !analysis.faceBounds) throw new Error(`Portrait analysis did not yield a face box: ${JSON.stringify(analysis.issues || [])}`);
  faceBounds = analysis.faceBounds;
  log(`Real portrait detector bounds: ${JSON.stringify(faceBounds)}`);
  paint();
}
$('#start').addEventListener('click', async () => {
  const token = ++generation;
  preparing = true; updateControls('idle'); $('#status').textContent = 'Preparing portrait fixture with the real face model…';
  try {
    await prepare(token);
    if (token !== generation || !faceBounds) return;
    preparing = false;
    await controller.start($('#preview'));
  } catch (error) { log(`Harness error: ${error.message}`); $('#status').textContent = `ERROR: ${error.message}`; }
  finally { preparing = false; updateControls(controller.isActive() ? 'ready' : 'idle'); }
});
$('#manual').addEventListener('click', () => { log('Manual shutter requested.'); controller.capture(); });
$('#stop').addEventListener('click', () => { generation += 1; preparing = false; analyzer.cancel(); controller.stop(); cleanStream(); updateControls('idle'); log('Stopped by tester.'); });
$('#scene').addEventListener('change', () => { paint(); log(`Scene changed: ${$('#scene').value}`); });
window.addEventListener('pagehide', () => { generation += 1; analyzer.cancel(); controller.stop(); cleanStream(); });
paint();
