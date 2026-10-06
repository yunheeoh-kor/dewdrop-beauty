const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const metricDefinitions = [
  { id: 'pores', label: 'Pore appearance', symbol: 'pores', description: 'Small texture details', limitation: 'Texture can suggest pore-like detail. This photo cannot establish actual pore size, depth or a pore count.' },
  { id: 'pigmentation', label: 'Pigment appearance', symbol: 'pigmentation', description: 'Visible color variation', limitation: 'Color variation may also come from lighting, shadows or makeup. This does not identify pigment conditions.' },
  { id: 'wrinkles', label: 'Fine lines', symbol: 'wrinkles', description: 'Line-like detail on cheeks', limitation: 'Expression, shadows and camera processing can create or hide lines. This does not measure wrinkle depth. Forehead and eye-area wrinkles are not assessed.' },
  { id: 'moisture', label: 'Moisture & finish', symbol: 'moisture', description: 'Estimated visible finish', limitation: 'This estimates visible finish. Actual skin water content is not measured; light, makeup and oil also affect shine.' },
];
const feelLabels = { dry_tight: 'Dry or tight', comfortable: 'Comfortable', oily_shiny: 'Oily or shiny', mixed: 'A little of both' };
const levelLabels = { low: 'Low visual signal', visible: 'Visible detail', pronounced: 'More visible detail' };
const finishLabels = { low: 'Low-sheen finish', visible: 'Balanced-looking finish', pronounced: 'Dewy-looking finish' };
const finishSummaries = { low: 'The sampled cheeks look more matte, with little localized shine.', visible: 'The sampled cheeks have a little surface glow and a balanced-looking finish.', pronounced: 'The sampled cheeks show noticeable surface glow and a dewy-looking finish.' };

function metricArt(symbol) {
  const art = {
    pores: '<circle cx="8" cy="9" r="1.5"/><circle cx="17" cy="6" r="1"/><circle cx="23" cy="13" r="1.6"/><circle cx="13" cy="18" r="1.8"/><circle cx="6" cy="24" r="1"/><circle cx="23" cy="25" r="1.2"/>',
    pigmentation: '<path d="M7 9c4-6 13-5 16 1s0 15-7 15S2 17 7 9Z" fill="currentColor" opacity=".18" stroke="none"/><path d="M10 12c2-3 7-3 9 1s-1 7-4 7-7-4-5-8Z"/><path d="m24 5 1 1M5 24l1 1"/>',
    wrinkles: '<path d="M4 10c8-7 16 7 24 0M4 16c8-7 16 7 24 0M4 22c8-7 16 7 24 0"/>',
    moisture: '<path d="M16 4c-3 5-9 11-9 16a9 9 0 0 0 18 0c0-5-6-11-9-16Z"/><path d="M12 20c0 2 1 4 4 4"/>',
  };
  return `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${art[symbol]}</svg>`;
}

// An enlarged viewport of the original photo, with no smoothing or retouching pass.
export function skinInsightCrop(bounds, photo) {
  if (!bounds || !photo || ![bounds.x, bounds.y, bounds.width, bounds.height, photo.width, photo.height].every(Number.isFinite)
    || bounds.width <= 0 || bounds.height <= 0 || photo.width <= 0 || photo.height <= 0) return null;
  const x1 = clamp(bounds.x, 0, 1), y1 = clamp(bounds.y, 0, 1);
  const x2 = clamp(bounds.x + bounds.width, 0, 1), y2 = clamp(bounds.y + bounds.height, 0, 1);
  if (x2 <= x1 || y2 <= y1) return null;
  let width = Math.max((x2 - x1) * photo.width * 1.12, 48);
  let height = Math.max((y2 - y1) * photo.height * 1.12, width / 1.65);
  width = Math.max(width, height * 1.65);
  const scale = Math.min(1, photo.width / width, photo.height / height);
  width *= scale; height *= scale;
  return {
    x: clamp((x1 + x2) / 2 * photo.width - width / 2, 0, photo.width - width),
    y: clamp((y1 + y2) / 2 * photo.height - height / 2, 0, photo.height - height), width, height,
  };
}

export function renderSkinInsights({ analysis, photo, profile = {}, esc, icon }) {
  const insights = analysis?.skinInsights;
  if (!insights) return '';
  const metrics = Array.isArray(insights.metrics) ? insights.metrics : [];
  const sampledRegions = Array.isArray(insights.sampledRegions) ? insights.sampledRegions : [];
  function samplePhotos(metric, description) {
    const areas = sampledRegions.length ? sampledRegions : [{ label: 'Sampled cheek area', bounds: metric.bounds }];
    return areas.slice(0, 2).map(area => {
      const crop = skinInsightCrop(area?.bounds, photo);
      if (!crop) return '';
      return `<figure class="skin-sample-photo"><div class="region-zoom skin-insight-zoom"><svg role="img" aria-label="Enlarged original photo: ${esc(area.label)} for ${description}" viewBox="${crop.x} ${crop.y} ${crop.width} ${crop.height}"><image href="${esc(photo.dataUrl)}" width="${photo.width}" height="${photo.height}"/></svg><span>Original photo · enlarged</span></div><figcaption>${esc(area.label)}</figcaption></figure>`;
    }).join('');
  }
  function card(definition) {
    const metric = metrics.find(item => item?.id === definition.id) || {};
    const moisture = definition.id === 'moisture';
    const sheen = moisture && metric.measurements?.surfaceSheen;
    const sheenObserved = ['estimated', 'observed'].includes(sheen?.status) && Object.hasOwn(levelLabels, sheen.level);
    const observed = moisture ? sheenObserved : ['estimated', 'observed'].includes(metric.status) && Object.hasOwn(levelLabels, metric.level);
    const status = observed ? moisture ? finishLabels[sheen.level] : `Estimated · ${levelLabels[metric.level]}` : 'Photo unavailable';
    const summary = moisture ? sheenObserved ? finishSummaries[sheen.level] : 'Add a readable face photo to estimate the visible finish.' : observed ? metric.summary || 'Visible features were estimated from the available cheek pixels.' : metric.qualityReason || 'The sampled photo pixels could not be read.';
    const crops = (!moisture || sheenObserved) ? samplePhotos(metric, moisture ? 'surface reflections' : definition.label.toLowerCase()) : '';
    const diameter = metric.measurements?.apparentDiameterPx;
    const showDiameter = definition.id === 'pores' && observed && metric.reliability !== 'limited' && Number.isFinite(diameter) && diameter > 0;
    const qualityNotes = Array.isArray(metric.qualityNotes) ? metric.qualityNotes.filter(note => typeof note === 'string') : [];
    return `<article class="skin-insight-card ${observed ? 'is-observed' : moisture ? 'is-moisture' : 'is-unavailable'}" aria-labelledby="skin-${definition.id}-title">
      <div class="skin-insight-label"><span class="skin-insight-icon">${metricArt(definition.symbol)}</span><div><h3 id="skin-${definition.id}-title">${definition.label}</h3><p>${definition.description}</p></div></div>
      <span class="skin-insight-state">${status}</span><p class="skin-insight-summary">${esc(summary)}</p>
      ${observed ? `<p class="skin-insight-method">Photo appearance estimate${metric.reliability === 'limited' ? ' · limited detail' : ''}</p>` : ''}
      ${!observed ? '<button class="text-btn skin-retake" data-nav="selfie">Choose another photo</button>' : ''}
      <details class="skin-insight-detail"><summary>${crops ? 'See photo & estimate details' : 'About this estimate'} ${icon('down')}</summary><div>
        ${crops ? `<div class="skin-sample-crops">${crops}</div>` : ''}
        ${showDiameter ? `<div class="skin-apparent-size"><strong>${diameter.toFixed(1)} image pixels</strong><p>Median apparent diameter of compact dark texture details in the analyzed image, not physical pore size. These details are not confirmed pores. Camera distance and image resizing change this value.</p></div>` : ''}
        <p>${definition.limitation}</p>${!moisture && metric.limitation ? `<p>${esc(metric.limitation)}</p>` : ''}
        ${qualityNotes.map(note => `<p>${esc(note)}</p>`).join('')}
        ${!moisture ? '<p class="skin-insight-method">An unvalidated appearance estimate from this photo, not a clinical measurement. A low signal does not establish absence.</p>' : ''}
      </div></details></article>`;
  }
  const skinFeel = Object.hasOwn(feelLabels, profile?.skinFeel) ? feelLabels[profile.skinFeel] : null;
  return `<section class="skin-insights" aria-labelledby="skin-insights-title"><div class="skin-insights-heading"><div><p class="eyebrow">A closer look at your skin</p><h2 id="skin-insights-title">Your skin, up close.</h2><p>Your best estimate of visible texture, color, lines and finish in the sampled cheek areas, using the photo you have.</p></div><span class="pill">Appearance estimates</span></div>
    <div class="skin-insights-grid">${metricDefinitions.map(card).join('')}</div>
    <div class="skin-feel-note"><div><p class="eyebrow">From your answers · separate from photo analysis</p><p><strong>Your skin feel: ${skinFeel || 'Not added yet'}</strong> ${skinFeel ? 'You reported this in your preferences. It is not a hydration measurement.' : 'Dry, comfortable, oily or a little of both? Your own experience adds context that a photo cannot provide.'}</p></div><button class="text-btn" data-selfie="refine">${skinFeel ? 'Update skin feel' : 'Add your skin feel'} ${icon('arrow')}</button></div>
    <details class="skin-capture-guide"><summary>How to get a clearer skin photo ${icon('down')}</summary><p>Use clean, bare skin, even light and a relaxed expression. Take a close, in-focus photo with your full face visible. Use the original photo without filters or beauty mode. Makeup, glare, shadows and image compression can change these observations.</p></details>
  </section>`;
}
