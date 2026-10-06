import { cropStyle, regionLabel } from './beauty-library.js';

const REGION_IDS = { brows: 'brows', eyes: 'eyes', cheeks: 'cheeks', lips: 'lips', nose: 'face', skin_texture: 'face', skin_tone: 'face' };
const DEFAULT_CATEGORIES = { brows: ['brow'], eyes: ['eyeliner', 'eyeshadow', 'mascara'], cheeks: ['blush', 'contour'], lips: ['lip_tint', 'lipstick'], face: ['cushion', 'foundation', 'concealer', 'powder'] };
const FALLBACK_TECHNIQUES = {
  brows: 'Brush the front softly and add short strokes only where you want more definition.',
  eyes: 'Keep the inner lash line fine, then add and blend definition at the outer corner.',
  cheeks: 'Start with a sheer layer of cheek color and soften the edge into your base.',
  lips: 'Build color at the center and soften the edge; add a little gloss if you want more reflection.',
  face: 'Try thin base layers and targeted concealer, keeping the finish and shade your own.',
};
const validUrl = value => { try { return new URL(value).protocol === 'https:'; } catch { return false; } };
const text = value => typeof value === 'string' ? value : '';

function preferredCategories(region, profile, regionId) {
  const products = region.recommendation?.products || region.cards || [];
  const categories = products.map(item => item?.product?.makeup_category).filter(Boolean);
  if (categories.length) return new Set(categories);
  if (regionId === 'eyes') {
    if (['length', 'volume'].includes(profile.eyeEffect)) return new Set(['mascara']);
    if (profile.eyeEffect === 'definition') return new Set(['eyeliner']);
    if (profile.eyeEffect === 'soft_color') return new Set(['eyeshadow']);
  }
  if (regionId === 'lips' && profile.finish === 'dewy') return new Set(['lip_gloss']);
  return new Set(DEFAULT_CATEGORIES[regionId]);
}

/** Editorial reference selection uses chosen style and makeup categories only. */
export function selectFaceStyleReferences({ region, lookbook, styleGuides = {}, profile = {} }) {
  const regionId = REGION_IDS[region?.id];
  if (!regionId || !Array.isArray(lookbook?.looks) || !Array.isArray(lookbook?.artists)) return [];
  const guides = Array.isArray(styleGuides.makeup) ? styleGuides.makeup : [];
  const chosenGuide = guides.find(guide => guide.id === profile.makeupStyleId);
  const categories = preferredCategories(region, profile, regionId);
  const candidates = lookbook.looks.flatMap((look, order) => {
    const image = look.image, part = look.regions?.find(item => item.id === regionId);
    const artist = lookbook.artists.find(item => item.id === look.artistId);
    if (!artist || !part || !image?.displayAllowed || !/^assets\/looks\/[\w.-]+\.(?:png|jpe?g|webp)$/i.test(image.src || '')
      || !Number.isFinite(image.width) || image.width <= 0 || !Number.isFinite(image.height) || image.height <= 0
      || !cropStyle(image, part.crop) || !image.credit || !image.license || !validUrl(image.sourceUrl) || !validUrl(image.licenseUrl)) return [];
    // These library notes explicitly say the brows cannot be inspected.
    if (regionId === 'brows' && /fringe-covered|partial brow view|hides most|cannot be assessed/i.test(`${part.title} ${part.description}`)) return [];
    const matchingChoice = Boolean(chosenGuide && look.styleIds?.includes(chosenGuide.id));
    const guide = matchingChoice ? chosenGuide : guides.find(item => look.styleIds?.includes(item.id));
    const categoryMatches = (part.productCategories || []).filter(category => categories.has(category)).length;
    return [{ look, artist, part, guide, matchingChoice, categoryMatches, order }];
  }).sort((a, b) => Number(b.matchingChoice) - Number(a.matchingChoice) || b.categoryMatches - a.categoryMatches || a.order - b.order);
  const selected = [], artists = new Set();
  for (const candidate of candidates) {
    if (artists.has(candidate.artist.id)) continue;
    const { matchingChoice, categoryMatches, order, ...reference } = candidate;
    selected.push({ ...reference, selectionReason: matchingChoice ? `From your ${candidate.guide.title} direction.` : `An editorial ${regionLabel(regionId).toLowerCase()} reference.` });
    artists.add(candidate.artist.id);
    if (selected.length === 2) break;
  }
  return selected;
}

function technique(part, regionId) {
  const sentences = text(part.description).match(/[^.!?]+[.!?]*/g)?.map(s => s.trim()).filter(Boolean) || [];
  const action = sentences.find(sentence => /^(?:Try|Blend|Brush|Apply|Tap|Keep|Use|Build|Layer|Smudge|Soften|Start|For a|If recreating)\b/i.test(sentence));
  return action || sentences.at(-1) || FALLBACK_TECHNIQUES[regionId];
}

export function renderFaceStyleComparison({ region, photo, analysis, lookbook, styleGuides = {}, profile = {}, esc, icon }) {
  const regionId = REGION_IDS[region?.id];
  if (!regionId || !photo) return '';
  const references = selectFaceStyleReferences({ region, lookbook, styleGuides, profile });
  const observation = region.quality?.usable
    ? (region.observations || []).map(item => typeof item === 'string' ? item : item?.text || item?.message).find(Boolean)
    : null;
  const color = regionId === 'lips' && /^#[0-9a-f]{6}$/i.test(analysis?.samples?.lip?.hex || '') ? `The sampled lip color in this light is ${analysis.samples.lip.hex}.` : null;
  const yourPhoto = observation || color || `Compare your ${regionLabel(regionId).toLowerCase()} in the photo with the placement, softness and finish below.`;
  const link = (url, label) => validUrl(url) ? `<a href="${esc(url)}" rel="noopener noreferrer">${esc(label)}</a>` : '';
  return `<section class="face-style-comparison" aria-label="K-pop style comparison"><div class="comparison-heading"><p class="eyebrow">K-pop inspiration</p><h3>Try a new direction.</h3><p>Borrow a color, a finish or a small placement change and make it yours.</p></div>
    <div class="comparison-your-photo"><span class="eyebrow">Your photo</span><p>${esc(yourPhoto)}</p></div>
    <div class="comparison-references">${references.map(({ look, artist, part, guide, selectionReason }) => {
      const crop = part.crop, image = look.image;
      const viewBox = [crop.x * image.width, crop.y * image.height, crop.width * image.width, crop.height * image.height].join(' ');
      return `<article class="comparison-reference"><figure class="comparison-reference-photo"><svg viewBox="${viewBox}" role="img" aria-label="${esc(artist.name)} · ${esc(regionLabel(regionId))} cropped reference"><image href="${esc(image.src)}" width="${image.width}" height="${image.height}"/></svg><figcaption>${esc(artist.name)} · ${esc(regionLabel(regionId))}</figcaption></figure>
        <div class="comparison-reference-copy"><p class="eyebrow">Style direction</p><h4>${esc(part.title || look.title)}</h4><p class="comparison-direction">${esc(technique(part, regionId))}</p><p class="comparison-selection">${esc(selectionReason)}</p>
        <div class="comparison-reference-actions">${guide ? `<button class="btn small" data-open-guide="${esc(guide.id)}">Try this direction ${icon('arrow')}</button>` : ''}<button class="text-btn" data-look-open="${esc(look.id)}" data-look-region="${regionId}">Explore this look ${icon('arrow')}</button></div>
        <details class="comparison-reference-credit"><summary>Photo credit & source</summary><p>${esc(image.credit)} · ${link(image.licenseUrl, image.license)} · cropped from original.</p><p>${link(image.sourceUrl, 'Original photo')} · ${esc(look.title)}</p><p>Editorial makeup inspiration; products worn are unverified.</p></details></div></article>`;
    }).join('') || '<p class="comparison-empty">Explore the library to choose a reference for this area.</p>'}</div>
    <button class="text-btn comparison-browse" data-nav="looks">Browse K-pop references ${icon('arrow')}</button></section>`;
}
