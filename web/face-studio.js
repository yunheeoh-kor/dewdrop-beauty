import { getFaceRecommendations } from './face-recommendations.js';
import { money } from './engine.js';
import { renderSkinInsights } from './skin-insights-ui.js';
import { renderFaceStyleComparison } from './face-style-comparison.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Cropping changes only the viewport. The original pixels are never retouched.
export function regionCrop(region, photo) {
  const b = region.bounds;
  if (!b || ![b.x, b.y, b.width, b.height].every(Number.isFinite)) return { x: 0, y: 0, width: photo.width, height: photo.height };
  const aspect = 1.65;
  const paired = ['brows', 'eyes', 'cheeks'].includes(region.id);
  let width = Math.max(b.width * photo.width * (paired ? .58 : 1.15), 70);
  let height = Math.max(b.height * photo.height * (paired ? .9 : 1.15), width / aspect, 45);
  width = Math.max(width, height * aspect);
  const scale = Math.min(1, photo.width / width, photo.height / height);
  width *= scale; height *= scale;
  const center = paired && region.point ? region.point : { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  return { x: clamp(center.x * photo.width - width / 2, 0, photo.width - width),
    y: clamp(center.y * photo.height - height / 2, 0, photo.height - height), width, height };
}

export function facePhotoCrop(analysis, photo) {
  const b = analysis.faceBounds;
  if (!b || ![b.x,b.y,b.width,b.height].every(Number.isFinite)) return { x: 0, y: 0, width: photo.width, height: photo.height };
  let height = Math.max(b.height * photo.height * 1.38, b.width * photo.width * 1.7 / .8);
  let width = height * .8;
  const scale = Math.min(1, photo.width / width, photo.height / height);
  width *= scale; height *= scale;
  return { x: clamp((b.x + b.width/2) * photo.width - width/2, 0, photo.width - width),
    y: clamp((b.y + b.height/2) * photo.height - height/2, 0, photo.height - height), width, height };
}

export function visibleRegions(regions, featured, selectedId) {
  const selected = regions.find(r => r.id === selectedId);
  const visible = featured.slice(0, 3);
  if (selected && !visible.some(r => r.id === selected.id)) return [...visible.slice(0, 2), selected];
  return visible;
}

// Fit the requested original-photo area to the actual photo pane. A narrow
// mobile pane includes more vertical context instead of stretching the image.
export function fitFaceCrop(crop, photo, aspect = .8) {
  if (!Number.isFinite(aspect) || aspect <= 0) aspect = .8;
  let width = Math.max(crop.width, crop.height * aspect);
  let height = Math.max(crop.height, width / aspect);
  const scale = Math.min(1, photo.width / width, photo.height / height);
  width *= scale; height *= scale;
  return { x: clamp(crop.x + crop.width / 2 - width / 2, 0, photo.width - width),
    y: clamp(crop.y + crop.height / 2 - height / 2, 0, photo.height - height), width, height };
}

export function nextFaceRegion(regions, currentId, direction) {
  if (!regions.length) return '';
  const index = regions.findIndex(region => region.id === currentId);
  if (index < 0) return direction < 0 ? regions.at(-1).id : regions[0].id;
  return regions[(index + (direction < 0 ? -1 : 1) + regions.length) % regions.length].id;
}

// Pin navigation is an in-place interaction, including keyboard focus. Keep
// both offsets exact even when replacing DOM triggers browser scroll anchoring.
export function keepFaceViewport(viewport, update) {
  const left = viewport.scrollX, top = viewport.scrollY;
  const result = update();
  viewport.scrollTo({ left, top, behavior: 'instant' });
  return result;
}

function techniqueArt(id) {
  const paths = {
    brows: '<path d="M24 59 Q63 39 103 54 M137 54 Q178 39 216 59" stroke="#624b3e" stroke-width="9"/><path d="M27 69l6-14m7 9 6-14m7 9 6-14m94 14 6-14m7 9 6-14m7 10 6-13" stroke="#9b7960" stroke-width="2"/>',
    eyes: '<path d="M24 69Q65 24 105 69Q65 92 24 69 M135 69Q175 24 215 69Q175 92 135 69" stroke="#b69c88"/><path d="M24 69Q65 25 105 69l13-12 M135 69Q175 25 215 69l13-12" stroke="#54413c" stroke-width="4"/><circle cx="66" cy="62" r="12" fill="#766859"/><circle cx="176" cy="62" r="12" fill="#766859"/>',
    nose: '<path d="M109 23l-9 43q-11 18 8 17m24-60 9 43q11 18-8 17 M110 88q11 7 22 0" stroke="#aa8d78" stroke-width="3"/><path d="M118 33v33" stroke="#fffdf4" stroke-width="9"/>',
    cheeks: '<path d="M37 22q-6 62 46 80m120-80q6 62-46 80" stroke="#b69c88"/><ellipse cx="67" cy="63" rx="31" ry="13" transform="rotate(24 67 63)" fill="#d5908b" opacity=".55"/><ellipse cx="174" cy="63" rx="31" ry="13" transform="rotate(-24 174 63)" fill="#d5908b" opacity=".55"/>',
    lips: '<path d="M49 64Q89 37 109 47Q120 55 131 47Q151 37 191 64Q150 101 120 91Q88 101 49 64Z" fill="#cc8788" opacity=".45"/><path d="M63 64Q94 48 112 59Q120 62 128 59Q147 48 177 64Q120 93 63 64Z" fill="#af626b"/><path d="M64 64q56 11 113 0" stroke="#8b4c58" stroke-width="2"/>',
    skin_texture: '<path d="M40 80q40-43 80-5t80-10" stroke="#abbb9f" stroke-width="15"/><path d="M40 80q40-43 80-5t80-10" stroke="#f4f4e8" stroke-width="3"/><path d="M120 24q-12 15-12 23a12 12 0 0 0 24 0q0-8-12-23Z" fill="#91a88b"/>',
    skin_tone: '<circle cx="74" cy="62" r="23" fill="#dec0a5"/><circle cx="120" cy="62" r="23" fill="#c9a184"/><circle cx="166" cy="62" r="23" fill="#b58c73"/><path d="m104 61 10 10 20-24" stroke="#fffaf1" stroke-width="4"/>',
  };
  return `<svg viewBox="0 0 240 120" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[id] || paths.cheeks}</svg>`;
}

export function renderFaceStudio({ photo, analysis, profile, products, evidence, styleGuides = {}, lookbook = {}, selectedId, activeTab = 'observation', showAll, esc, icon, productImage, lipControls }) {
  const result = getFaceRecommendations(analysis, profile, products, evidence, styleGuides);
  const { regions, featured } = result;
  const selected = regions.find(r => r.id === selectedId);
  const frame = selected ? fitFaceCrop(regionCrop(selected, photo), photo) : facePhotoCrop(analysis, photo);
  const pins = visibleRegions(regions, featured, selectedId);
  const shortObservation = r => (r.observations || [])[0] || r.quality?.reason || 'Explore this area.';
  const featureButton = (r, i) => `<button class="face-feature ${r.id === selectedId ? 'active' : ''}" data-face-region="${esc(r.id)}" aria-pressed="${r.id === selectedId}"><span class="feature-number">${i + 1}</span><span><small>${esc(r.label)}</small><strong>${esc(r.recommendation?.title || r.label)}</strong><span>${esc(shortObservation(r))}</span></span>${icon('arrow')}</button>`;
  const productCard = item => `<article class="region-product"><div class="region-product-photo">${productImage(item.product)}</div><div><span class="eyebrow">${esc(item.product.brand)}</span><h4>${esc(item.product.product_name)}</h4><p class="region-product-benefit">${esc(item.imageReason || item.product.intended_benefit || 'An option for this direction, checked against your preferences.')}</p><p>${money(item.priceCents ?? Math.round(item.product.price_usd * 100))} <span class="region-product-state">${item.state === 'eligible' ? 'Option to explore' : 'Preview · needs checking'}</span></p><button class="text-btn" data-detail="${esc(item.product.id)}">Product details ${icon('arrow')}</button><details><summary>Why this product & checks</summary><p>${esc((item.reasons || []).join(' ') || 'Check your full routine before adding this option.')}</p>${item.product.kpop_connection ? `<p class="campaign-hint">${esc(item.product.kpop_connection.artist)} · ${esc(item.product.kpop_connection.relationship_type)}. See the documented connection in product details.</p>` : ''}</details></div></article>`;

  function detail(r) {
    const recommendation = r.recommendation || {};
    const tabs = [['observation', 'Why'], ['products', 'Products'], ['compare', 'K-pop']];
    const tab = tabs.some(([id]) => id === activeTab) ? activeTab : 'observation';
    const cards = (recommendation.products || r.cards || []).slice(0, 3);
    const estimated = r.quality?.estimated || r.quality?.reliability === 'limited' || r.measurements?.status === 'estimated';
    const limited = r.quality?.reliability === 'limited';
    return `<div class="region-detail" id="region-detail"><div class="face-detail-heading"><p class="eyebrow">${esc(r.label)} · In focus</p><h3 class="face-pane-title" tabindex="-1">${esc(recommendation.title || r.label)}</h3></div>
      <div class="face-detail-tabs" role="tablist" aria-label="Explore ${esc(r.label)}">${tabs.map(([id,label]) => `<button type="button" role="tab" id="face-tab-${id}" data-face-tab="${id}" aria-selected="${tab === id}" aria-controls="face-panel-${id}" tabindex="${tab === id ? '0' : '-1'}">${label}</button>`).join('')}</div>
      <div class="face-pane-scroll" tabindex="0" aria-label="${esc(r.label)} details; scroll for more">
        <div class="face-detail-panel" id="face-panel-observation" role="tabpanel" aria-labelledby="face-tab-observation" ${tab === 'observation' ? '' : 'hidden'}>
          <div class="region-observation"><span class="pill ${r.quality?.usable ? '' : 'warn'}">${r.quality?.usable ? estimated ? limited ? 'Photo estimate · limited detail' : 'Photo estimate' : 'Seen in your photo' : 'General direction · limited detail'}</span><p class="region-main-observation">${esc(shortObservation(r))}</p></div>
          <div class="region-explanation"><p class="eyebrow">Why this direction</p><p>${esc(recommendation.rationale || recommendation.reason || 'The visible placement gives a starting point for a technique and products. Adjust it to your preferred look.')}</p></div>
          ${recommendation.styleChoice ? `<p class="region-chosen-style">Your chosen direction: ${esc(recommendation.styleChoice.title)}. <button class="text-btn" data-nav="guides">Change style ${icon('arrow')}</button></p>` : ''}
          <div class="region-style"><div class="technique-art">${techniqueArt(r.id)}<small>Technique guide</small></div><div><p class="eyebrow">${r.kind === 'skincare' ? 'Care direction' : 'Try this technique'}</p><p>${esc(recommendation.steps?.[0] || recommendation.title || 'Explore this area at your own pace.')}</p></div></div>
          ${recommendation.steps?.length > 1 ? `<details class="region-more"><summary>More technique steps</summary><ol class="technique-steps">${recommendation.steps.slice(1).map(s => `<li>${esc(s)}</li>`).join('')}</ol></details>` : ''}
          <div class="face-next-actions"><button class="btn small" data-face-tab="products">See ${cards.length ? `${cards.length} product ${cards.length === 1 ? 'idea' : 'ideas'}` : 'product options'} ${icon('arrow')}</button><button class="text-btn" data-face-tab="compare">Compare K-pop styles ${icon('arrow')}</button></div>
          <details class="region-more"><summary>Photo detail & limitations</summary>${(r.observations || []).slice(1).map(o => `<p>${esc(o)}</p>`).join('')}${r.quality?.reason ? `<p>${esc(r.quality.reason)}</p>` : ''}<p>Lighting, makeup and camera processing affect this photo estimate. It is a starting point for styling, not a skin diagnosis.</p>${/^#[0-9a-f]{6}$/i.test(r.measurements?.colorHex || '') ? `<span class="region-swatch"><i style="background:${r.measurements.colorHex}"></i>${esc(r.measurements.colorHex)} · sampled in this light</span>` : ''}<button class="text-btn" data-nav="selfie">Retake for more detail ${icon('camera')}</button></details>
        </div>
        <div class="face-detail-panel" id="face-panel-products" role="tabpanel" aria-labelledby="face-tab-products" ${tab === 'products' ? '' : 'hidden'}><div class="region-products"><p class="eyebrow">Products for this direction</p><p class="small muted">${esc(recommendation.rationale || recommendation.reason || 'Options checked against your preferences and routine constraints.')}</p>${cards.length ? cards.map(productCard).join('') : '<p class="region-no-products">No product options fit the current preferences. Adjust your answers to explore more.</p>'}</div>${r.id === 'lips' ? lipControls || '' : ''}<button class="text-btn" data-selfie="refine">Adjust preferences & budget ${icon('arrow')}</button></div>
        <div class="face-detail-panel" id="face-panel-compare" role="tabpanel" aria-labelledby="face-tab-compare" ${tab === 'compare' ? '' : 'hidden'}>${renderFaceStyleComparison({ region: r, photo, analysis, lookbook, styleGuides, profile, esc, icon })}</div>
      </div></div>`;
  }

  return `<section class="photo-analysis-panel face-studio" aria-label="Interactive selfie recommendations"><div class="studio-heading"><div><p class="eyebrow">Your selfie, decoded</p><h2>A few details. A look that’s yours.</h2></div><span class="pill">${regions.length} areas explored · on this device</span></div>
    <div class="face-workspace ${selected ? 'is-exploring' : 'is-overview'}" data-selected-region="${esc(selected?.id || '')}">
      <div class="face-workspace-toolbar"><button class="text-btn face-overview-button" data-face-overview ${selected ? '' : 'disabled'}>${icon('close')} Overview</button><span class="face-workspace-label" aria-live="polite">${esc(selected?.label || 'Tap a numbered point')}</span><nav aria-label="Photo areas"><button class="face-step" data-face-step="-1" aria-label="Previous face area">‹</button><button class="text-btn" data-face-all aria-expanded="${showAll}" aria-controls="face-area-list">All ${regions.length} areas ${icon(showAll ? 'up' : 'down')}</button><button class="face-step" data-face-step="1" aria-label="Next face area">›</button></nav></div>
      <div id="face-area-list" class="face-area-list" ${showAll ? '' : 'hidden'}>${['makeup','skincare'].map(kind => `<div><span>${kind === 'makeup' ? 'Makeup' : 'Skincare'}</span><div>${regions.filter(r => r.kind === kind).map(r => `<button class="chip ${r.id === selectedId ? 'active' : ''}" data-face-region="${esc(r.id)}" aria-pressed="${r.id === selectedId}">${esc(r.label)}</button>`).join('')}</div></div>`).join('')}</div>
      <div class="face-studio-layout"><div class="face-map-column"><div class="face-map"><svg data-face-photo-view viewBox="${frame.x} ${frame.y} ${frame.width} ${frame.height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${selected ? `Enlarged ${esc(selected.label.toLowerCase())} from your original selfie` : 'Your selfie. Use the numbered markers to explore recommendations.'}"><image href="${esc(photo.dataUrl)}" width="${photo.width}" height="${photo.height}"/></svg>${!selected ? pins.map((r,i) => `<button class="face-pin " style="left:${clamp((r.point.x * photo.width - frame.x) / frame.width, 0.04, 0.96)*100}%;top:${clamp((r.point.y * photo.height - frame.y) / frame.height, 0.04, 0.96)*100}%" data-face-region="${esc(r.id)}" aria-label="Explore ${esc(r.label)}" aria-pressed="false" title="${esc(r.label)}"><span>${i+1}</span><i aria-hidden="true"></i></button>`).join('') : `<span class="face-focused-label">${esc(selected.label)}</span>`}<span class="face-map-caption">${icon(selected ? 'search' : 'sparkle')} ${selected ? 'Original photo · enlarged' : 'Tap a point to explore'}</span></div>${selected ? `<div class="face-photo-rail"><p>Original photo<br>enlarged</p><nav aria-label="Quick photo areas">${pins.map((r,i) => `<button data-face-region="${esc(r.id)}" aria-pressed="${r.id === selected.id}"><span>${i+1}</span><span>${esc(r.label)}</span></button>`).join('')}</nav><button class="text-btn" data-face-overview>Full photo ${icon('arrow')}</button></div>` : ''}<div class="face-map-tools"><button class="text-btn" data-nav="selfie">${icon('camera')} Retake</button><span>On this device</span></div></div>
      <div class="face-recommendations">${selected ? detail(selected) : `<div class="face-overview"><p class="eyebrow">Start with these ${featured.length}</p><h3>Your personal beauty map.</h3><p>Tap a point to zoom right here. Explore the reason, products and K-pop styles beside your photo.</p><div class="face-feature-list">${featured.map(featureButton).join('')}</div><div class="studio-refine"><span>${icon('sparkle')}</span><div><strong>Your photo leads. You decide.</strong><p>Change your goals, preferences or budget whenever you like.</p><button class="text-btn" data-selfie="refine">Refine recommendations ${icon('arrow')}</button></div></div></div>`}</div></div>
    </div><div class="face-studio-footer"><p class="face-map-note">Your photo stays on your device. Lighting, makeup and camera processing affect observations.</p><details class="analysis-method"><summary>About this analysis</summary><p>Face landmarks locate each area. Pixels and geometry guide observations and editorial style suggestions. Texture and color variation are photo estimates, not pore counts or a diagnosis. Photos and measurements stay in memory; only choices you confirm are saved.</p><div class="row wrap"><button class="text-btn" data-selfie="analyze">Analyze again</button><button class="text-btn" data-selfie="remove">Remove photo</button></div></details></div>${renderSkinInsights({ analysis, photo, profile, esc, icon })}</section>`;
}
