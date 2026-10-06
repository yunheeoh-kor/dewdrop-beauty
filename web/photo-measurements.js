/**
 * Measure visible photo colors, never skin health, identity, or shade suitability.
 * Region topology follows Google's MediaPipe Face Mesh connections:
 * https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/python/solutions/face_mesh_connections.py
 * Face/eye/lip contours and cheek triangles use the original 468 mesh landmarks;
 * the additional iris landmarks in Face Landmarker's 478-point output are unused.
 * Thresholds below are operational sampling heuristics, not a validated diagnosis
 * or a calibrated assessment of a person's appearance.
 */

import { analyzeFaceRegions } from './face-regions.js';
import { analyzeSkinInsights } from './skin-insights.js';

const METHOD_VERSION = 'face-pixels-v1';
const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const OUTER_LIP = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146];
const INNER_LIP = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95];
// Central cheek tessellation, away from eyes, hairline, nose, and mouth.
const CHEEK_TRIANGLES = [[50, 101, 205], [50, 205, 187], [280, 330, 425], [280, 425, 411]];
const REQUIRED_INDICES = [...new Set([...FACE_OVAL, ...OUTER_LIP, ...INNER_LIP, ...CHEEK_TRIANGLES.flat()])];

// Manually curated exploration references, not product shade measurements.
const COLOR_REFERENCES = {
  rose: [181, 99, 119], pink: [217, 124, 153], coral: [224, 123, 104],
  red: [170, 54, 65], nude: [164, 116, 99], berry: [126, 57, 87],
};

function retake(faceCount, code, message) {
  return { status: 'retake', issues: [{ code, message }], faceCount, samples: {}, colorFamily: null, markers: [], regions: [], methodVersion: METHOD_VERSION };
}

function bounds(points) {
  return {
    minX: Math.min(...points.map(p => p.x)), maxX: Math.max(...points.map(p => p.x)),
    minY: Math.min(...points.map(p => p.y)), maxY: Math.max(...points.map(p => p.y)),
  };
}

function center(points) {
  return { x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: points.reduce((sum, p) => sum + p.y, 0) / points.length };
}

function inset(points, factor = 0.8) {
  const c = center(points);
  return points.map(p => ({ x: c.x + (p.x - c.x) * factor, y: c.y + (p.y - c.y) * factor }));
}

function contains(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function distanceToEdge(point, polygon) {
  let nearest = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const fraction = lengthSquared ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared)) : 0;
    nearest = Math.min(nearest, Math.hypot(point.x - a.x - fraction * dx, point.y - a.y - fraction * dy));
  }
  return nearest;
}

function collectPixels(image, polygons, excluded = []) {
  const box = bounds(polygons.flat()), pixels = [];
  // Cap sampling density for unusually large input photos; retain actual pixels.
  const stride = Math.max(1, Math.floor(Math.sqrt(Math.max(0, (box.maxX - box.minX) * (box.maxY - box.minY)) / 12000)));
  for (let y = Math.max(0, Math.floor(box.minY)); y < Math.min(image.height, Math.ceil(box.maxY)); y += stride) {
    for (let x = Math.max(0, Math.floor(box.minX)); x < Math.min(image.width, Math.ceil(box.maxX)); x += stride) {
      const p = { x: x + 0.5, y: y + 0.5 };
      if (!polygons.some(polygon => contains(p, polygon) && (!excluded.length || distanceToEdge(p, polygon) >= 0.6))) continue;
      if (excluded.some(polygon => contains(p, polygon) || distanceToEdge(p, polygon) < 0.6)) continue;
      const index = (y * image.width + x) * 4;
      const rgba = Array.from(image.data.slice(index, index + 4));
      if (rgba.some(value => !Number.isFinite(value) || value < 0 || value > 255) || rgba[3] < 250) continue;
      pixels.push(rgba.slice(0, 3));
    }
  }
  return pixels;
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function measuredSample(pixels, label) {
  const initial = [0, 1, 2].map(channel => median(pixels.map(p => p[channel])));
  // Trim the most distant 20% to reduce highlights and isolated contamination.
  const trimmed = pixels.slice().sort((a, b) => a.reduce((sum, v, i) => sum + (v - initial[i]) ** 2, 0) - b.reduce((sum, v, i) => sum + (v - initial[i]) ** 2, 0)).slice(0, Math.max(1, Math.ceil(pixels.length * 0.8)));
  const rgb = [0, 1, 2].map(channel => Math.round(median(trimmed.map(p => p[channel]))));
  return { rgb, hex: `#${rgb.map(value => value.toString(16).padStart(2, '0')).join('')}`, pixelCount: pixels.length, label };
}

function rgbToLab(rgb) {
  const [r, g, b] = rgb.map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const transform = value => value > 216 / 24389 ? Math.cbrt(value) : (24389 / 27 * value + 16) / 116;
  const x = transform((r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047);
  const y = transform(r * 0.2126729 + g * 0.7151522 + b * 0.072175);
  const z = transform((r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

export function nearestColorFamily(rgb, allowedFamilies = Object.keys(COLOR_REFERENCES)) {
  if (!Array.isArray(rgb) || rgb.length !== 3 || rgb.some(value => !Number.isFinite(value) || value < 0 || value > 255) || !Array.isArray(allowedFamilies)) return null;
  const observed = rgbToLab(rgb);
  return Object.entries(COLOR_REFERENCES).filter(([name]) => allowedFamilies.includes(name)).map(([name, reference]) => ({ name, distance: rgbToLab(reference).reduce((sum, value, i) => sum + (value - observed[i]) ** 2, 0) })).sort((a, b) => a.distance - b.distance)[0]?.name ?? null;
}

/**
 * @param {{data: Uint8ClampedArray|Uint8Array|number[], width: number, height: number}} image RGBA pixels, oriented to match the landmarks.
 * @param {Array<Array<{x:number,y:number,z?:number}>>} faces Face Landmarker result.faceLandmarks, with normalized coordinates.
 * @returns {{status:string,issues:Array,faceCount:number,samples:Object,colorFamily:string|null,markers:Array,methodVersion:string}}
 */
export function analyzeFacePixels(image, faces) {
  const faceCount = Array.isArray(faces) ? faces.length : 0;
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width <= 0 || image.height <= 0 || !image.data || typeof image.data.slice !== 'function' || image.data.length !== image.width * image.height * 4) {
    return retake(faceCount, 'invalid_image', 'The photo pixels could not be read. Try another photo.');
  }
  if (!Array.isArray(faces)) return retake(0, 'invalid_landmarks', 'Face landmarks could not be read. Try another photo.');
  if (!faceCount) return retake(0, 'no_face', 'No face was detected. Face the camera and try again.');
  if (faceCount > 1) return retake(faceCount, 'multiple_faces', 'Use a photo with only one face.');
  const face = faces[0];
  if (!Array.isArray(face) || face.length < 468 || REQUIRED_INDICES.some(index => !face[index] || !Number.isFinite(face[index].x) || !Number.isFinite(face[index].y))) {
    return retake(1, 'invalid_landmarks', 'Face landmarks could not be read. Try another photo.');
  }
  const pixelPoint = index => ({ x: face[index].x * image.width, y: face[index].y * image.height });
  const oval = FACE_OVAL.map(pixelPoint), box = bounds(oval);
  if (REQUIRED_INDICES.some(index => face[index].x < 0 || face[index].x > 1 || face[index].y < 0 || face[index].y > 1)) {
    return retake(1, 'face_out_of_frame', 'Keep your full face inside the photo and try again.');
  }
  if (box.maxX - box.minX < 48 || box.maxY - box.minY < 64) {
    return retake(1, 'face_too_small', 'Move closer so the photo contains enough face pixels to sample.');
  }
  const cheekPolygons = CHEEK_TRIANGLES.map(indices => inset(indices.map(pixelPoint)));
  const outerLip = OUTER_LIP.map(pixelPoint), innerLip = INNER_LIP.map(pixelPoint);
  const cheekPixels = collectPixels(image, cheekPolygons);
  const lipPixels = collectPixels(image, [outerLip], [innerLip]);
  if (cheekPixels.length < 20 || lipPixels.length < 12) {
    return retake(1, 'no_valid_samples', 'The cheek or lip regions had too few readable pixels. Try a closer, front-facing photo.');
  }
  // Only near-total clipping across every channel is a blocking pixel failure.
  // There is no brightness, skin color, contrast, blur, or beauty quality score.
  const clipped = pixels => pixels.filter(rgb => Math.max(...rgb) <= 2 || Math.min(...rgb) >= 253).length / pixels.length > 0.97;
  if (clipped(cheekPixels) || clipped(lipPixels)) {
    return retake(1, 'clipped_pixels', 'A sampled region is almost entirely clipped to black or white. Try a different exposure.');
  }
  const cheek = measuredSample(cheekPixels, 'Cheek pixels in this photo');
  const lip = measuredSample(lipPixels, 'Lip pixels in this photo');
  const lipMarker = center([pixelPoint(14), pixelPoint(17)]);
  const marker = (point, label) => ({ x: point.x / image.width, y: point.y / image.height, label });
  const colorFamily = nearestColorFamily(lip.rgb);
  const detail = analyzeFaceRegions(image, face, { cheekPolygons, outerLip, cheek, lip, colorFamily, faceBox: box });
  const faceBounds = { x: box.minX / image.width, y: box.minY / image.height, width: (box.maxX - box.minX) / image.width, height: (box.maxY - box.minY) / image.height };
  const skinInsights = analyzeSkinInsights(image, face, { photoQuality: detail.photoQuality, faceBounds });
  // Keep useful appearance estimates available to the existing product flow,
  // including when the original fine-detail check reports a limited photo.
  const regions = detail.regions.map(region => {
    const id = region.id === 'skin_texture' ? 'pores' : region.id === 'skin_tone' ? 'pigmentation' : null;
    const estimate = skinInsights.metrics.find(metric => metric.id === id);
    if (estimate?.status !== 'estimated') return region;
    return { ...region, quality: { usable: true, status: 'estimated', reliability: estimate.reliability, qualityNotes: estimate.qualityNotes },
      measurements: { ...region.measurements, ...estimate.measurements, level: estimate.level, reliability: estimate.reliability },
      observations: [estimate.summary, ...(estimate.qualityNotes || []), estimate.limitation],
      priority: estimate.level === 'pronounced' ? 96 : estimate.level === 'visible' ? 84 : 40 };
  });
  return {
    status: 'ready', issues: [], faceCount: 1, samples: { cheek, lip }, colorFamily,
    faceBounds,
    markers: [marker(center(cheekPolygons.slice(0, 2).flat()), 'Cheek sample'), marker(center(cheekPolygons.slice(2).flat()), 'Cheek sample'), marker(lipMarker, 'Lip sample')],
    methodVersion: METHOD_VERSION,
    regions, photoQuality: detail.photoQuality, regionMethodVersion: 'face-regions-v1',
    skinInsights,
    description: 'Measured colors in this photo. Lighting, camera settings, and makeup affect these pixels. The color family is a nearby exploration reference, not a shade match.',
  };
}
