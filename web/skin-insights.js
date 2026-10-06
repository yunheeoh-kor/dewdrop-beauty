/**
 * Conservative, deterministic observations of central-cheek RGB photo pixels.
 * These thresholds are engineering heuristics, not validated pore recognition,
 * pigment measurement, wrinkle recognition, or a skin-health assessment.
 * Ordinary RGB photos do not measure the skin's water content.
 */
const CHEEKS = [[50, 101, 205, 187], [280, 330, 425, 411]];
const SCOPE = 'Visible details in the two central-cheek samples only. Lighting, makeup, facial hair, camera processing and compression can change these observations.';
const AREAS = ['Image-left central cheek', 'Image-right central cheek'];
const DEFINITIONS = {
  pores: { label: 'Pore-like texture', limitation: 'Compact dark details are not confirmed pores. Their apparent size is in analyzed-image pixels, not millimeters or physical pore size; camera distance and resizing change it.' },
  pigmentation: { label: 'Visible color variation', limitation: 'Localized photo color differences do not measure melanin or diagnose pigmentation. Makeup, freckles and shadows can create similar differences.' },
  wrinkles: { label: 'Fine-line appearance', limitation: 'Elongated dark contrast can come from expression, hair, makeup or shadows. This does not confirm wrinkles or measure their depth.' },
  moisture: { label: 'Moisture / surface sheen', limitation: 'Actual skin hydration cannot be measured from an ordinary RGB photo. Surface reflections do not establish moisture level, dryness or oiliness.' },
};
const round = (n, places = 4) => Number(n.toFixed(places));
const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
const median = values => {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2;
};
const luma = rgb => rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
const box = points => ({ minX: Math.min(...points.map(p => p.x)), maxX: Math.max(...points.map(p => p.x)), minY: Math.min(...points.map(p => p.y)), maxY: Math.max(...points.map(p => p.y)) });
function inside(x, y, points) {
  let found = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) found = !found;
  }
  return found;
}
function normalizedBounds(points, image) {
  const b = box(points);
  return { x: round(b.minX / image.width), y: round(b.minY / image.height), width: round((b.maxX - b.minX) / image.width), height: round((b.maxY - b.minY) / image.height) };
}
function metric(id, fields) { return { id, ...DEFINITIONS[id], ...fields }; }
function unavailable(id, reason, bounds) {
  return metric(id, { status: 'unavailable', level: 'unavailable', summary: 'This photo does not support a reliable observation of the sampled cheek detail.', qualityReason: reason, ...(bounds ? { bounds } : {}), measurements: {} });
}
function poseReason(face, image) {
  const required = [33, 263, 1, 152];
  if (required.some(i => !face[i] || ![face[i].x, face[i].y].every(n => Number.isFinite(n) && n >= 0 && n <= 1))) return 'The face angle could not be checked. Use a front-facing photo with both eyes and the chin visible.';
  const points = required.map(i => ({ x: face[i].x * image.width, y: face[i].y * image.height }));
  const [a, b] = points.slice(0, 2).sort((a, b) => a.x - b.x), nose = points[2], chin = points[3];
  const dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
  if (distance < 40 || Math.abs(dy) / distance > 0.26) return 'Keep your head upright and face the camera so both cheek samples are comparable.';
  const along = p => ((p.x - cx) * dx + (p.y - cy) * dy) / distance;
  const below = p => ((p.y - cy) * dx - (p.x - cx) * dy) / distance;
  const chinHeight = below(chin), noseHeight = below(nose);
  if (Math.abs(along(nose)) / distance > 0.18 || Math.abs(along(chin)) / distance > 0.24 || chinHeight / distance < 0.65 || noseHeight / chinHeight < 0.18 || noseHeight / chinHeight > 0.70) return 'The face appears turned or tilted. Retake straight on so both central cheeks have comparable detail.';
  return null;
}

// Full native pixel resolution is retained inside each ROI. Summed-area tables
// allow local averages without smoothing/replacing the source pixel buffer.
function patch(image, polygon) {
  const b = box(polygon), x0 = Math.max(0, Math.floor(b.minX)), y0 = Math.max(0, Math.floor(b.minY));
  const width = Math.min(image.width, Math.ceil(b.maxX)) - x0, height = Math.min(image.height, Math.ceil(b.maxY)) - y0;
  if (width < 1 || height < 1) return null;
  const size = width * height, stride = width + 1;
  const mask = new Uint8Array(size), valid = new Uint8Array(size), rgb = [0, 1, 2].map(() => new Float64Array(size));
  const integrals = [0, 1, 2, 3].map(() => new Float64Array(stride * (height + 1)));
  let expected = 0, validCount = 0, clippedCount = 0, whollyClippedCount = 0;
  const brightness = [], quadrants = [[], [], [], []];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x, source = ((y + y0) * image.width + x + x0) * 4;
      const sample = [image.data[source], image.data[source + 1], image.data[source + 2]], alpha = image.data[source + 3];
      mask[i] = inside(x + x0 + 0.5, y + y0 + 0.5, polygon) ? 1 : 0;
      if (mask[i]) expected++;
      valid[i] = mask[i] && Number.isFinite(alpha) && alpha >= 250 && alpha <= 255 && sample.every(n => Number.isFinite(n) && n >= 0 && n <= 255) ? 1 : 0;
      if (valid[i]) {
        validCount++;
        if (Math.max(...sample) >= 253 || Math.max(...sample) <= 3) clippedCount++;
        if (Math.min(...sample) >= 253 || Math.max(...sample) <= 2) whollyClippedCount++;
        const value = luma(sample);
        brightness.push(value); quadrants[(x >= width / 2 ? 1 : 0) + (y >= height / 2 ? 2 : 0)].push(value);
        sample.forEach((n, c) => { rgb[c][i] = n; });
      }
      for (let c = 0; c < 4; c++) {
        const target = (y + 1) * stride + x + 1, table = integrals[c];
        table[target] = (c === 3 ? valid[i] : rgb[c][i]) + table[target - 1] + table[target - stride] - table[target - stride - 1];
      }
    }
  }
  const average = (x, y, r) => {
    const left = Math.max(0, x - r), top = Math.max(0, y - r), right = Math.min(width, x + r + 1), bottom = Math.min(height, y + r + 1);
    if (right <= left || bottom <= top) return null;
    const sums = integrals.map(t => t[bottom * stride + right] - t[top * stride + right] - t[bottom * stride + left] + t[top * stride + left]);
    if (!sums[3]) return null;
    return sums.slice(0, 3).map(n => n / sums[3]);
  };
  const medians = quadrants.filter(q => q.length >= 20).map(median);
  return { width, height, mask, valid, rgb, average, expected, validCount, clippedCount, whollyClippedCount, median: median(brightness), lightingSpread: medians.length < 4 ? 0 : (Math.max(...medians) - Math.min(...medians)) / (median(brightness) + 30) };
}

function components(mask, width, height) {
  const seen = new Uint8Array(mask.length), result = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    const queue = [start]; seen[start] = 1;
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, minX = width, minY = height, maxX = 0, maxY = 0;
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head], x = i % width, y = Math.floor(i / width);
      sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, next = ny * width + nx;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height || seen[next] || !mask[next]) continue;
        seen[next] = 1; queue.push(next);
      }
    }
    const area = queue.length, vx = sxx / area - (sx / area) ** 2, vy = syy / area - (sy / area) ** 2, covariance = sxy / area - sx * sy / area ** 2;
    const delta = Math.sqrt((vx - vy) ** 2 + 4 * covariance ** 2);
    const major = Math.max(0, (vx + vy + delta) / 2), minor = Math.max(0, (vx + vy - delta) / 2);
    result.push({ area, width: maxX - minX + 1, height: maxY - minY + 1, elongation: Math.sqrt((major + 1 / 12) / (minor + 1 / 12)), span: Math.sqrt(12 * major + 1) });
  }
  return result;
}

function measure(p, faceWidth, broadRadius) {
  const fineRadius = Math.max(1, Math.min(6, broadRadius, Math.round(faceWidth / 160)));
  const smoothRadius = Math.min(2, Math.max(0, broadRadius - 1));
  const dark = new Uint8Array(p.mask.length), color = new Uint8Array(p.mask.length), sheen = new Uint8Array(p.mask.length);
  let count = 0;
  const colorContrasts = [], grainResiduals = [], relativeGrainResiduals = [];
  const ring = [[-1, 0], [1, 0], [0, -1], [0, 1], [-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]];
  // Estimate common pixel grain before finding structures. Raising the contrast
  // threshold suppresses random candidates instead of refusing the whole card.
  for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) {
    const i = y * p.width + x;
    if (!p.valid[i]) continue;
    const nearby = p.average(x, y, 1), rgb = p.rgb.map(c => c[i]);
    const grain = Math.max(...rgb.map((value, c) => Math.abs(value - nearby[c])));
    grainResiduals.push(grain); relativeGrainResiduals.push(grain / (luma(nearby) + 30));
  }
  const grainRelative = median(relativeGrainResiduals), grainDominates = median(grainResiduals) > 2.5 && grainRelative > 0.018;
  const detailThreshold = Math.max(0.045, grainRelative * 4), colorThreshold = Math.max(0.06, grainRelative * 1.5);
  for (let y = 0; y < p.height; y++) {
    for (let x = 0; x < p.width; x++) {
      const i = y * p.width + x, rgb = p.rgb.map(c => c[i]);
      if (!p.valid[i]) continue;
      const neighborhood = ring.map(([dx, dy]) => p.average(x + Math.round(dx * fineRadius), y + Math.round(dy * fineRadius), 0)).filter(Boolean).map(luma);
      if (!neighborhood.length) continue;
      const surrounding = mean(neighborhood), relativeDark = (surrounding - luma(rgb)) / (surrounding + 30);
      dark[i] = relativeDark >= detailThreshold ? 1 : 0;
      const smooth = p.average(x, y, smoothRadius);
      const broad = ring.map(([dx, dy]) => p.average(x + Math.round(dx * broadRadius), y + Math.round(dy * broadRadius), smoothRadius)).filter(Boolean);
      if (!broad.length) { count++; continue; }
      const baseline = [0, 1, 2].map(c => mean(broad.map(v => v[c]))), baseLuma = luma(baseline), value = luma(smooth);
      const chroma = v => [v[0] - v[1], v[2] - v[1]];
      const a = chroma(smooth), b = chroma(baseline);
      const chromaticDifference = Math.hypot(a[0] - b[0], a[1] - b[1]) / (baseLuma + 30);
      const darkDifference = (baseLuma - value) / (baseLuma + 30);
      const colorDifference = Math.max(chromaticDifference, darkDifference);
      color[i] = colorDifference >= colorThreshold ? 1 : 0;
      if (color[i]) colorContrasts.push(colorDifference);
      const saturation = v => (Math.max(...v) - Math.min(...v)) / Math.max(1, Math.max(...v));
      const neutralReflection = saturation(smooth) <= Math.max(0.12, saturation(baseline) * 0.85);
      sheen[i] = value - baseLuma >= 18 && (value - baseLuma) / (baseLuma + 30) >= Math.max(0.12, grainRelative * 1.5) && neutralReflection ? 1 : 0;
      count++;
    }
  }
  const details = components(dark, p.width, p.height);
  const maxCompactDiameter = Math.max(7, Math.min(14, faceWidth / 60));
  const compact = details.filter(c => c.area >= 4 && c.elongation <= 2 && Math.max(c.width, c.height) <= maxCompactDiameter && c.area / (c.width * c.height) >= 0.4);
  const lines = details.filter(c => c.area >= 6 && c.elongation >= 3.5 && c.span >= Math.max(6, faceWidth * 0.02));
  const patches = components(color, p.width, p.height).filter(c => c.area >= Math.max(4, broadRadius ** 2 / 2) && Math.min(c.width, c.height) >= Math.min(5, broadRadius));
  const reflections = components(sheen, p.width, p.height).filter(c => c.area >= Math.min(12, Math.max(2, broadRadius)) && Math.min(c.width, c.height) >= Math.min(3, broadRadius));
  // The median suppresses sparse coherent dots/lines, but rises when fine
  // residuals cover most of the patch (sensor grain, aggressive processing,
  // or unresolved dense texture). In that case do not assign apparent sizes.
  // This is an uncertainty gate, not a validated noise/skin classifier.
  return { count, compact, lines, patches, reflections, colorContrasts, grainDominates };
}

/**
 * @param {{width:number,height:number,data:ArrayLike<number>}} image Oriented RGBA photo.
 * @param {Array<{x:number,y:number}>} face Original 468/478 normalized mesh.
 * @param {{photoQuality?:object,faceBounds?:{x:number,y:number,width:number,height:number}}} options
 */
export function analyzeSkinInsights(image, face, { photoQuality, faceBounds } = {}) {
  const result = { methodVersion: 'skin-appearance-v2', scope: SCOPE, sampledAreas: AREAS.slice(), metrics: [] };
  const stop = (reason, bounds) => ({ ...result, metrics: ['pores', 'pigmentation', 'wrinkles', 'moisture'].map(id => unavailable(id, reason, bounds)) });
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width <= 0 || image.height <= 0 || !image.data || image.data.length !== image.width * image.height * 4) return stop('The photo pixels could not be read.');
  if (!Array.isArray(face) || CHEEKS.flat().some(i => !face[i] || ![face[i].x, face[i].y].every(n => Number.isFinite(n) && n >= 0 && n <= 1))) return stop('The central cheek landmarks could not be read.');
  const polygons = CHEEKS.map(indices => {
    const points = indices.map(i => ({ x: face[i].x * image.width, y: face[i].y * image.height }));
    const center = { x: mean(points.map(p => p.x)), y: mean(points.map(p => p.y)) };
    return points.map(p => ({ x: center.x + (p.x - center.x) * 0.88, y: center.y + (p.y - center.y) * 0.88 }));
  }).sort((a, b) => box(a).minX - box(b).minX);
  const bounds = normalizedBounds(polygons.flat(), image);
  result.sampledRegions = polygons.map((points, i) => ({ label: AREAS[i], bounds: normalizedBounds(points, image) }));
  const qualityNotes = [];
  const size = (provided, fallback) => Number.isFinite(provided) && provided > 0 ? provided : fallback;
  const faceWidth = size(photoQuality?.faceWidthPx, size(faceBounds?.width * image.width, bounds.width * image.width / 0.7));
  const faceHeight = size(photoQuality?.faceHeightPx, size(faceBounds?.height * image.height, faceWidth * 1.3));
  if (photoQuality?.detailUsable !== true) qualityNotes.push('The available image detail supports a rough estimate.');
  if (photoQuality?.sharpness?.usable === false) qualityNotes.push('Soft focus may hide the smallest features.');
  if (poseReason(face, image)) qualityNotes.push('Head angle makes comparisons between the cheeks less certain.');
  const patches = polygons.map(p => patch(image, p)).filter(p => p && p.validCount > 0);
  if (!patches.length) return stop('No readable cheek pixels were available in this photo.', bounds);
  const validCount = patches.reduce((n, p) => n + p.validCount, 0);
  if (patches.reduce((n, p) => n + p.whollyClippedCount, 0) / validCount > 0.97) return stop('The sampled cheeks are almost entirely blank black or white pixels.', bounds);
  if (patches.length < 2 || patches.some(p => p.validCount < 400 || p.validCount / Math.max(1, p.expected) < 0.98)) qualityNotes.push('The estimate uses a small or partly readable cheek sample.');
  if (patches.some(p => p.clippedCount / p.validCount > 0.025)) qualityNotes.push('Bright glare or deep shadows may affect the estimate.');
  const sideDifference = patches.length === 2 ? Math.abs(patches[0].median - patches[1].median) / (mean(patches.map(p => p.median)) + 30) : 0;
  if (photoQuality?.lightingUsable === false || sideDifference >= 0.28 || patches.some(p => p.lightingSpread >= 0.4)) qualityNotes.push('Uneven lighting can exaggerate visible texture and color variation.');
  const measured = patches.map(p => measure(p, faceWidth, Math.max(1, Math.min(16, Math.round(faceWidth / 50), Math.floor(Math.min(p.width, p.height) / 5)))));
  const grainIssue = measured.some(p => p.grainDominates);
  if (grainIssue) qualityNotes.push('Fine image grain was suppressed; some subtle features may be missed.');
  const count = measured.reduce((n, p) => n + p.count, 0), features = key => measured.flatMap(p => p[key]);
  if (!count) return stop('No readable cheek detail pixels were available.', bounds);
  const fraction = key => features(key).reduce((n, c) => n + c.area, 0) / Math.max(1, count);
  const compactFraction = fraction('compact'), lineFraction = fraction('lines'), colorFraction = fraction('patches'), reflectionFraction = fraction('reflections');
  const level = (value, visible, pronounced) => value >= pronounced ? 'pronounced' : value >= visible ? 'visible' : 'low';
  const poreLevel = level(compactFraction, 0.002, 0.025), lineLevel = level(lineFraction, 0.005, 0.04), colorLevel = level(colorFraction, 0.008, 0.08), sheenLevel = level(reflectionFraction, 0.004, 0.05);
  const support = { sampledPixelCount: count, sampledAreas: AREAS.slice() };
  const estimated = (id, estimatedLevel, summary, measurements, minWidth = 240, minHeight = 300) => {
    const notes = qualityNotes.slice();
    if (faceWidth < minWidth || faceHeight < minHeight) notes.push('At this photo size, this is an estimate of visible appearance; smaller details may be missed.');
    return metric(id, { status: 'estimated', level: estimatedLevel, reliability: notes.length ? 'limited' : 'moderate', qualityNotes: notes, summary, bounds, measurements: { ...support, ...measurements } });
  };
  const compact = features('compact');
  result.metrics = [
    estimated('pores', poreLevel, poreLevel === 'low' ? 'The sampled cheeks look relatively smooth, with little pore-like texture standing out.' : `${poreLevel === 'pronounced' ? 'More noticeable' : 'Some'} pore-like texture stands out in the sampled cheeks.`, { compactDarkDetailFraction: round(compactFraction), apparentDiameterPx: !grainIssue && !qualityNotes.length && faceWidth >= 480 && faceHeight >= 560 && compact.length >= 3 ? round(median(compact.map(c => 2 * Math.sqrt(c.area / Math.PI))), 1) : null, sizeUnit: 'analyzed-image pixels' }, 480, 560),
    estimated('pigmentation', colorLevel, colorLevel === 'low' ? 'The sampled cheek color looks relatively even.' : `${colorLevel === 'pronounced' ? 'More noticeable' : 'Some'} localized color variation appears in the sampled cheeks.`, { localizedColorVariationFraction: round(colorFraction), relativeColorContrast: round(mean(features('colorContrasts'))) }),
    estimated('wrinkles', lineLevel, lineLevel === 'low' ? 'Few fine lines stand out in the sampled cheeks.' : `${lineLevel === 'pronounced' ? 'More noticeable' : 'Some'} fine-line-like detail appears in the sampled cheeks.`, { lineLikeDetailFraction: round(lineFraction) }, 320, 400),
    estimated('moisture', sheenLevel, sheenLevel === 'low' ? 'The sampled cheeks have a low-sheen, more matte-looking finish.' : sheenLevel === 'visible' ? 'The sampled cheeks have a balanced-looking finish with a little surface glow.' : 'The sampled cheeks have a dewy-looking finish with noticeable surface glow.', {
      hydrationMeasured: false,
      surfaceSheen: { status: 'estimated', level: sheenLevel, finishLabel: sheenLevel === 'low' ? 'Low-sheen finish' : sheenLevel === 'visible' ? 'Balanced-looking finish' : 'Dewy-looking finish', summary: sheenLevel === 'low' ? 'Little localized shine stands out.' : 'Localized bright reflections contribute to the visible glow.', brightReflectionFraction: round(reflectionFraction), ...support },
    }),
  ];
  return result;
}
