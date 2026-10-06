// Orchestrates actual on-device inference. Raw pixels are transferred to a
// worker; neither images nor derived face geometry enter persistent storage.
export function createPhotoAnalyzer({ onStatus = () => {} } = {}) {
  let worker = null;
  let generation = 0;
  let pending = null;
  let timer = null;
  let cancelDecode = null;

  function cancel() {
    generation += 1;
    cancelDecode?.();
    cancelDecode = null;
    if (pending) { pending.resolve(null); pending = null; }
    clearTimeout(timer);
    timer = null;
    worker?.terminate();
    worker = null;
  }

  function decode(photo, token) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const timeout = setTimeout(() => fail(new Error('The photo could not be opened. Try taking it again.')), 15000);
      function clean() { clearTimeout(timeout); image.onload = null; image.onerror = null; cancelDecode = null; }
      function fail(error) { clean(); reject(error); }
      cancelDecode = () => { clean(); image.src = ''; resolve(null); };
      image.onload = () => {
        clean();
        if (token !== generation) { resolve(null); return; }
        try {
          const width = image.naturalWidth, height = image.naturalHeight;
          if (!width || !height || width > 1920 || height > 1920) throw new Error('Use a photo captured or selected in the app.');
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (!context) throw new Error('Your browser cannot read the photo.');
          context.drawImage(image, 0, 0);
          const pixels = context.getImageData(0, 0, width, height);
          canvas.width = 1; canvas.height = 1;
          resolve(pixels);
        } catch (error) { reject(error); }
      };
      image.onerror = () => fail(new Error('The photo could not be opened. Try taking it again.'));
      image.src = photo.dataUrl;
    });
  }

  async function analyze(photo) {
    cancel();
    const id = generation;
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') throw new Error('On-device image analysis needs an updated browser or Android System WebView.');
    onStatus('reading_photo');
    const image = await decode(photo, id);
    if (!image || id !== generation) return null;
    return new Promise((resolve, reject) => {
      pending = { resolve, reject };
      const finish = (value, error) => {
        if (id !== generation || !pending) return;
        clearTimeout(timer);
        pending = null;
        // Dispose the model and GPU/CPU buffers after every still image.
        worker?.terminate(); worker = null;
        error ? reject(error) : resolve(value);
      };
      try {
        worker = new Worker(new URL('./analysis-worker.js', import.meta.url));
        worker.onmessage = ({ data }) => {
          if (id !== generation || data.id !== id) return;
          if (data.type === 'status') onStatus(data.status);
          else if (data.type === 'result') finish(data.analysis);
          else if (data.type === 'error') finish(null, new Error(data.message));
        };
        worker.onerror = event => { event.preventDefault(); finish(null, new Error('The analysis model could not start. Try again with an updated browser or Android System WebView.')); };
        timer = setTimeout(() => finish(null, new Error('Image analysis took too long on this device. Try a new photo or continue with your answers.')), 60000);
        worker.postMessage({ type: 'analyze', id, width: image.width, height: image.height, pixels: image.data }, [image.data.buffer]);
      } catch (error) { finish(null, error); }
    });
  }
  return { analyze, cancel };
}
