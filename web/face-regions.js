/**
 * Visible, two-dimensional face placement and image-detail measurements.
 * Landmarks follow MediaPipe's original 468-point mesh contours:
 * https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/python/solutions/face_mesh_connections.py
 * Image-detail thresholds are conservative, unvalidated sampling heuristics.
 * They do not identify pores, lesions, skin types, or causes of visible marks.
 */
const BROWS = [[70, 63, 105, 66, 107, 55, 65, 52, 53, 46], [336, 296, 334, 293, 300, 276, 283, 282, 295, 285]];
const BROW_LINES = [[70, 63, 105, 66, 107], [336, 296, 334, 293, 300]];
const EYES = [[33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246], [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398]];
const NOSE = [168, 6, 197, 195, 5, 4, 1, 19, 94, 2, 98, 97, 326, 327, 294, 278, 344, 440, 275, 45, 220, 115, 48, 64];
const clamp = (value, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, value));
const round = (value, precision = 3) => Number(value.toFixed(precision));
const mean = values => values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : 0;
const quantile = (values, q) => {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))];
};
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const center = points => ({ x: mean(points.map(p => p.x)), y: mean(points.map(p => p.y)) });
const box = points => ({ minX: Math.min(...points.map(p => p.x)), maxX: Math.max(...points.map(p => p.x)), minY: Math.min(...points.map(p => p.y)), maxY: Math.max(...points.map(p => p.y)) });

function inside(p, polygon) {
  let value = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) value = !value;
  }
  return value;
}

function rgbAt(image, x, y) {
  const px = Math.round(clamp(x, 0, image.width - 1)), py = Math.round(clamp(y, 0, image.height - 1));
  const i = (py * image.width + px) * 4;
  if (image.data[i + 3] < 250) return null;
  return [image.data[i], image.data[i + 1], image.data[i + 2]];
}
const luma = rgb => rgb ? rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 : null;

function scan(image, polygons, callback, margin = 0, target = 5000) {
  const b = box(polygons.flat());
  if (![b.minX, b.maxX, b.minY, b.maxY].every(Number.isFinite)) return;
  const stride = Math.max(1, Math.ceil(Math.sqrt((b.maxX - b.minX) * (b.maxY - b.minY) / target)));
  for (let y = Math.max(margin, Math.ceil(b.minY)); y < Math.min(image.height - margin, b.maxY); y += stride) {
    for (let x = Math.max(margin, Math.ceil(b.minX)); x < Math.min(image.width - margin, b.maxX); x += stride) {
      const p = { x, y };
      // Keep the whole neighborhood in one cheek patch, away from boundaries.
      if (!polygons.some(poly => inside(p, poly) && (!margin || [[margin, 0], [-margin, 0], [0, margin], [0, -margin]].every(([dx, dy]) => inside({ x: x + dx, y: y + dy }, poly))))) continue;
      callback(x, y);
    }
  }
}

function focusMeasure(image, polygons) {
  const fine = [], broad = [], ratios = [];
  scan(image, polygons, (x, y) => {
    const samples = [[-1, 0], [1, 0], [0, -1], [0, 1], [-3, 0], [3, 0], [0, -3], [0, 3]].map(([dx, dy]) => luma(rgbAt(image, x + dx, y + dy)));
    if (samples.some(n => n === null)) return;
    const near = Math.hypot(samples[1] - samples[0], samples[3] - samples[2]);
    const far = Math.hypot(samples[5] - samples[4], samples[7] - samples[6]);
    fine.push(near); broad.push(far);
    if (far > 12) ratios.push(Math.min(1, near / far));
  }, 0, 7000);
  const strength = quantile(fine, 0.9);
  // A soft/flat image can have no reliable focus evidence. Do not call smooth
  // cheek pixels blurry; use eye/brow/lip boundaries for this check instead.
  const edgeRatio = quantile(ratios, 0.8);
  return { strength: round(strength), edgeRatio: round(edgeRatio), usable: strength >= 3 && ratios.length >= 12 && edgeRatio >= 0.60 };
}

/** Public for isolated, synthetic image-quality tests. No pixel buffers escape. */
export function analyzeSkinAppearance(image, cheekPolygons, focusPolygons, faceSize) {
  const focus = focusMeasure(image, focusPolygons);
  const left = [], right = [], contrasts = [], darker = [], variations = [];
  const radius = Math.max(2, Math.round(faceSize.faceWidthPx / 100));
  const broadRadius = Math.max(5, Math.round(faceSize.faceWidthPx / 32));
  const splitX = center(cheekPolygons.flat()).x;
  const ring = [[-1, 0], [1, 0], [0, -1], [0, 1], [-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]];
  scan(image, cheekPolygons, (x, y) => {
    const rgb = rgbAt(image, x, y), value = luma(rgb);
    if (value === null) return;
    (x < splitX ? left : right).push(value);
    const fine = ring.map(([dx, dy]) => luma(rgbAt(image, x + dx * radius, y + dy * radius)));
    const coarse = ring.map(([dx, dy]) => rgbAt(image, x + dx * broadRadius, y + dy * broadRadius));
    if (fine.some(n => n === null) || coarse.some(n => n === null)) return;
    const neighborhood = mean(fine);
    // Relative contrast reduces dependence on absolute skin/photo brightness.
    const relative = (value - neighborhood) / (neighborhood + 30);
    contrasts.push(Math.abs(relative)); darker.push(relative < -0.045 ? 1 : 0);
    const coarseRgb = [0, 1, 2].map(channel => mean(coarse.map(p => p[channel])));
    const coarseLuma = luma(coarseRgb);
    // Local broad contrast suppresses a linear illumination gradient. It is
    // still affected by makeup, freckles, shadows, camera noise, and compression.
    variations.push(Math.hypot(...rgb.map((n, i) => (n - coarseRgb[i]) / (coarseLuma + 30))) / Math.sqrt(3));
  }, broadRadius, 6000);
  const leftMedian = quantile(left, 0.5), rightMedian = quantile(right, 0.5);
  const sideDifference = Math.abs(leftMedian - rightMedian) / (mean([leftMedian, rightMedian]) + 30);
  const enoughSamples = contrasts.length >= 80 && left.length >= 20 && right.length >= 20;
  const enoughResolution = faceSize.faceWidthPx >= 240 && faceSize.faceHeightPx >= 300;
  const lightingUsable = sideDifference < 0.28;
  let quality = { usable: true };
  if (!enoughResolution) quality = { usable: false, code: 'low_resolution', reason: 'Move closer or use the original photo so small details have enough pixels.' };
  else if (!enoughSamples) quality = { usable: false, code: 'limited_skin_pixels', reason: 'The visible cheek areas are too small to compare fine detail reliably.' };
  else if (!lightingUsable) quality = { usable: false, code: 'uneven_lighting', reason: 'The two cheeks have very different brightness. Face soft, even light and retake for skin-detail suggestions.' };
  else if (!focus.usable) quality = { usable: false, code: 'soft_image', reason: 'Fine edges are too soft or unclear to assess skin detail. Hold still and retake in clear light.' };
  const localContrast = round(mean(contrasts));
  const darkerDetailFraction = round(mean(darker));
  const colorVariation = round(quantile(variations, 0.8));
  const textureLevel = !quality.usable ? 'unavailable' : localContrast >= 0.055 ? 'pronounced' : localContrast >= 0.019 ? 'visible' : 'low';
  const toneLevel = !quality.usable ? 'unavailable' : colorVariation >= 0.11 ? 'pronounced' : colorVariation >= 0.045 ? 'visible' : 'low';
  return {
    quality,
    photoQuality: { ...faceSize, detailUsable: quality.usable, detailReason: quality.reason ?? null, detailCode: quality.code ?? null, lightingUsable, lightingReason: lightingUsable ? null : 'Large brightness difference between the cheek samples.', sharpness: focus, sampleCount: contrasts.length, sideBrightnessDifference: round(sideDifference) },
    texture: { level: textureLevel, localContrast, darkerDetailFraction },
    tone: { level: toneLevel, colorVariation },
  };
}

function normalizedBox(points, image, padding = 0.25) {
  const b = box(points), minWidth = image.width * 0.08, minHeight = image.height * 0.06;
  const width = Math.max(b.maxX - b.minX, minWidth), height = Math.max(b.maxY - b.minY, minHeight), c = center([{ x: b.minX, y: b.minY }, { x: b.maxX, y: b.maxY }]);
  const x = clamp((c.x - width * (0.5 + padding)) / image.width), y = clamp((c.y - height * (0.5 + padding)) / image.height);
  return { x: round(x, 5), y: round(y, 5), width: round(Math.min(1 - x, width * (1 + padding * 2) / image.width), 5), height: round(Math.min(1 - y, height * (1 + padding * 2) / image.height), 5) };
}

function region(image, { id, label, kind = 'makeup', polygons, point, observations, measurements, quality = { usable: true }, priority }) {
  const points = polygons.flat(), c = point ?? center(points);
  return { id, label, kind, point: { x: round(clamp(c.x / image.width), 5), y: round(clamp(c.y / image.height), 5) }, bounds: normalizedBox(points, image), observations, measurements, quality, priority: quality.usable ? priority : 10 };
}

const geometryQuality = (points, image) => {
  const b = box(points);
  return (b.maxX - b.minX) >= image.width * 0.03 && (b.maxY - b.minY) >= image.height * 0.002
    ? { usable: true }
    : { usable: false, code: 'unclear_landmarks', reason: 'This feature is not clearly mapped. Try a front-facing photo with the feature visible.' };
};

/** Build UI-ready, normalized photo regions from real detected mesh landmarks. */
export function analyzeFaceRegions(image, face, { cheekPolygons, outerLip, cheek, lip, colorFamily, faceBox }) {
  const point = index => ({ x: face[index].x * image.width, y: face[index].y * image.height });
  const toPolygons = groups => groups.map(indices => indices.map(point));
  const allRequired = [...BROWS.flat(), ...EYES.flat(), ...NOSE];
  // Preserve successful color sampling if a supplemental mesh point is corrupt.
  if (allRequired.some(i => !face[i] || !Number.isFinite(face[i].x) || !Number.isFinite(face[i].y) || face[i].x < 0 || face[i].x > 1 || face[i].y < 0 || face[i].y > 1)) return { regions: [], photoQuality: { detailUsable: false, detailReason: 'Some feature landmarks were unreadable.' } };
  const browPolygons = toPolygons(BROWS), eyePolygons = toPolygons(EYES), nose = NOSE.map(point);
  const faceWidthPx = round(faceBox.maxX - faceBox.minX, 1), faceHeightPx = round(faceBox.maxY - faceBox.minY, 1);
  // Join each cheek's two sampling triangles to retain neighborhoods straddling
  // their shared edge. Inset the outside contour to exclude eyes and hair.
  const detailCheeks = toPolygons([[50, 101, 205, 187], [280, 330, 425, 411]]).map(points => {
    const c = center(points);
    return points.map(p => ({ x: c.x + (p.x - c.x) * 0.88, y: c.y + (p.y - c.y) * 0.88 }));
  });
  const appearance = analyzeSkinAppearance(image, detailCheeks, [...browPolygons, ...eyePolygons, outerLip], { faceWidthPx, faceHeightPx });
  const arcs = BROW_LINES.map(indices => {
    const pts = indices.map(point), a = pts[0], b = pts.at(-1), width = distance(a, b);
    return width ? Math.max(...pts.map(p => Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / width)) / width : 0;
  });
  const archRatio = round(mean(arcs)), arch = archRatio > 0.10 ? 'defined' : 'soft';
  const eyeRatios = [[33, 133, 159, 145], [362, 263, 386, 374]].map(([a, b, top, bottom]) => distance(point(top), point(bottom)) / Math.max(1, distance(point(a), point(b))));
  const openingRatio = round(mean(eyeRatios)), placement = openingRatio > 0.30 ? 'open' : 'elongated';
  const qualityForPair = polygons => polygons.map(points => geometryQuality(points, image)).find(quality => !quality.usable) ?? { usable: true };
  const browQuality = qualityForPair(browPolygons), eyeQuality = qualityForPair(eyePolygons), noseQuality = geometryQuality(nose, image);
  const browAngle = mean([[70, 107], [300, 336]].map(([outer, inner]) => Math.atan2(point(inner).y - point(outer).y, Math.abs(point(inner).x - point(outer).x)) * 180 / Math.PI));
  const lipBounds = box(outerLip);
  const rightCheek = cheekPolygons.slice(2).flat(), leftCheek = cheekPolygons.slice(0, 2).flat();
  const textureObservation = appearance.texture.level === 'low' ? 'Small-scale contrast is subtle in the sampled cheek pixels.' : appearance.texture.level === 'pronounced' ? 'The sampled cheek pixels show pronounced small-scale contrast.' : 'The sampled cheek pixels show visible small-scale contrast.';
  const toneObservation = appearance.tone.level === 'low' ? 'Broader color differences are subtle inside the sampled cheek areas.' : appearance.tone.level === 'pronounced' ? 'The sampled cheek areas show pronounced local color variation.' : 'The sampled cheek areas show some local color variation.';
  const qualityObservation = 'These are photo details: makeup, facial hair, freckles, shadows, noise, and compression can contribute. They do not establish pore size, pigmentation, or a skin condition.';
  return {
    photoQuality: appearance.photoQuality,
    regions: [
      region(image, { id: 'brows', label: 'Brows', polygons: browPolygons, point: center(browPolygons[0]), quality: browQuality, measurements: { archRatio, arch, tailAngleDeg: round(browAngle, 1) }, observations: browQuality.usable ? [`The detected brow line has a ${arch} arc in this photo.`, 'The visible outline can guide where to place brow definition; head angle and makeup affect it.'] : [browQuality.reason], priority: 80 }),
      region(image, { id: 'eyes', label: 'Eyes', polygons: eyePolygons, point: center(eyePolygons[1]), quality: eyeQuality, measurements: { openingRatio, placement }, observations: eyeQuality.usable ? [`The detected eye opening reads ${placement} in this frame.`, 'This maps a placement area for eye makeup; expression and camera angle change the outline.'] : [eyeQuality.reason], priority: 70 }),
      region(image, { id: 'nose', label: 'Nose', polygons: [nose], point: point(4), quality: noseQuality, measurements: { bridgeToBaseRatio: round(distance(point(168), point(2)) / Math.max(1, distance(point(98), point(327)))) }, observations: noseQuality.usable ? ['The bridge and nose tip are mapped for optional highlight or contour placement.', 'These are two-dimensional photo positions, not a judgment about nose shape.'] : [noseQuality.reason], priority: 45 }),
      region(image, { id: 'cheeks', label: 'Cheeks', polygons: cheekPolygons, point: center(rightCheek), measurements: { colorHex: cheek.hex, verticalPlacement: round((center(rightCheek).y - faceBox.minY) / Math.max(1, faceHeightPx)) }, observations: [`The sampled cheek color in this photo is ${cheek.hex}.`, 'Cheek landmarks give a starting position for blush; lighting and existing makeup change the color.'], priority: 65 }),
      region(image, { id: 'lips', label: 'Lips', polygons: [outerLip], measurements: { colorHex: lip.hex, heightToWidthRatio: round((lipBounds.maxY - lipBounds.minY) / Math.max(1, lipBounds.maxX - lipBounds.minX)), colorFamily }, observations: [`Your measured lip pixels are closest to the ${colorFamily} exploration palette.`, 'The detected lip outline helps place a soft gradient or defined edge; this is not an exact product shade match.'], priority: 90 }),
      region(image, { id: 'skin_texture', label: 'Visible texture', kind: 'skincare', polygons: [leftCheek], point: center(leftCheek), quality: appearance.quality, measurements: appearance.texture, observations: appearance.quality.usable ? [textureObservation, qualityObservation] : [appearance.quality.reason, 'Skin-detail suggestions are held until the photo is clear enough.'], priority: appearance.texture.level === 'pronounced' ? 98 : appearance.texture.level === 'visible' ? 88 : 40 }),
      region(image, { id: 'skin_tone', label: 'Color variation', kind: 'skincare', polygons: [rightCheek], point: { x: center(rightCheek).x, y: center(rightCheek).y + faceHeightPx * 0.045 }, quality: appearance.quality, measurements: appearance.tone, observations: appearance.quality.usable ? [toneObservation, qualityObservation] : [appearance.quality.reason, 'Color-variation suggestions are held until the photo is clear enough.'], priority: appearance.tone.level === 'pronounced' ? 96 : appearance.tone.level === 'visible' ? 84 : 40 }),
    ],
  };
}
