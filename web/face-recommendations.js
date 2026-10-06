import { buildKit, evaluateProduct, scoreProduct } from './engine.js';
import { getPhotoShortlist } from './photo-shortlist.js';

export const FACE_RECOMMENDATIONS_VERSION = 'face-recommendations-v1';
const REGION_IDS = new Set(['brows', 'eyes', 'nose', 'cheeks', 'lips', 'skin_texture', 'skin_tone']);
const UNKNOWN = new Set(['unknown', 'unsure', '', null, undefined]);
const known = value => !UNKNOWN.has(value);
const metadataFor = (product, evidence) => evidence?.[product.id] ?? evidence?.products?.[product.id] ?? {};
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const trait = (meta, dimension, value) => {
  const source = meta.traits?.[dimension];
  return source?.url && source.date && source.basis && source.values?.includes(value) ? source : null;
};

// Authored links from the reviewed catalog's cosmetic benefit descriptions.
// These links do not infer an ingredient effect or diagnose what caused pixels.
// Require the dated source and identified product on each use; arbitrary prose
// and a matching product name cannot create a new benefit association.
const APPEARANCE_LINKS = {
  texture: {
    'kbeauty-003': 'https://beautyofjoseon.com/products/glow-serum-propolis-niacinamide',
    'kbeauty-010': 'https://www.cosrx.com/collections/award-winning/products/the-niacinamide-15-serum-%EB%B2%88%EB%93%A4',
    'kbeauty-011': 'https://www.cosrx.com/products/advanced-snail-92-all-in-one-cream',
    'kbeauty-019': 'https://roundlab.com/products/1025-dokdo-toner',
    'kbeauty-036': 'https://mixsoon.us/products/mixsoon-bean-essence-50ml',
    'kbeauty-055': 'https://misshaus.com/products/time-revolution-the-first-essence-5x',
  },
  tone: {
    'kbeauty-018': 'https://anua.com/products/niacinamide-10-txa-4-serum-2',
    'kbeauty-024': 'https://doctoraltheaglobal.com/products/345-relief-cream?country=US&currency=USD',
    'kbeauty-056': 'https://misshaus.com/products/vita-c-plus-spot-correcting-firming-ampoule-30ml',
  },
};

function appearanceEvidence(product, meta, appearance) {
  const url = APPEARANCE_LINKS[appearance]?.[product.id];
  if (!url || product.product_url !== url || product.researched_on !== '2026-10-05'
    || !meta.identityVerified || !meta.sources?.some(source => source.url === url && source.date === product.researched_on)) return null;
  return { url, date: product.researched_on, basis: 'Reviewed cosmetic appearance benefit', note: product.intended_benefit };
}

const photoObservation = region => (region.observations ?? []).map(observation => typeof observation === 'string'
  ? observation : observation?.text ?? observation?.message ?? '').filter(Boolean).join(' ');

function styleFor(region, profile) {
  const m = region.measurements ?? {};
  const source = 'photo';
  const inspiration = region.kind === 'makeup' ? 'K-pop editorial inspired styling; an application idea, not an artist endorsement.' : null;
  const common = { source, inspiration, why: photoObservation(region), slots: [], inferredPreferences: {} };
  if (!region.quality?.usable) return { ...common, title: 'A clearer view will help', steps: [],
    reason: region.quality?.reason ?? 'This region is not clear enough for a photo-based suggestion.' };
  switch (region.id) {
    case 'brows': return { ...common, title: m.arch === 'defined' ? 'Airy, softly arched brows' : 'Soft straight-brow styling',
      steps: m.arch === 'defined'
        ? ['Follow the arch visible in your photo; keep the front of each brow softly brushed.', 'Use a light coat of brow mascara through the tail for definition.']
        : ['Brush the front hairs upward, then brush the tail outward along the visible brow line.', 'Use a light coat of brow mascara to keep the shape soft.'],
      slots: ['eyes'], inferredPreferences: { eyeEffect: 'definition', eyeFormat: 'brow_mascara' }, match: 'brow',
      reason: m.arch === 'defined' ? 'Your visible brow arc gives a shape to follow. These brow products add soft definition while keeping the front airy.' : 'The visible brow line gives a starting point for a soft, straighter finish. These brow products help define the hairs without a heavy outline.' };
    case 'eyes': {
      const effect = known(profile.eyeEffect) ? profile.eyeEffect : m.placement === 'elongated' ? 'definition' : 'length';
      return { ...common, title: effect === 'length' ? 'Lifted, separated lashes' : effect === 'volume' ? 'Soft lash volume' : effect === 'soft_color' ? 'A soft wash of eye color' : 'Fine lash-line definition',
        source: known(profile.eyeEffect) ? 'photo_and_questionnaire' : source,
        steps: effect === 'length'
          ? ['Keep the lid light and separate the lashes with a small amount of mascara.', 'Emphasize the center lashes, using the eye opening in the photo as a placement guide.']
          : effect === 'definition'
            ? ['Keep the line fine along the outer lash line visible in your photo.', 'Extend just past the outer corner for a soft editorial finish.']
            : ['Use a light first layer and check the effect with your eyes open.', 'Keep the edge softly blended and adjust the amount to your preference.'],
        slots: ['eyes'], inferredPreferences: { eyeEffect: effect }, match: 'eye',
        reason: effect === 'definition' ? 'A fine line follows the visible eye opening and adds emphasis at the outer corner. These options have reviewed support for eye definition.' : effect === 'length' ? 'Separated, lengthened lashes can emphasize the visible eye opening. These options have reviewed support for a lengthening effect.' : effect === 'volume' ? 'A little more lash volume adds emphasis to the mapped eye area. These options support your selected volume effect.' : 'A softly blended wash of color adds dimension around the mapped eye area. These options support your selected soft-color direction.' };
    }
    case 'nose': return { ...common, title: profile.finish === 'matte' ? 'Soft matte center' : 'Light-touch center glow',
      source: known(profile.finish) || known(profile.coverage) ? 'photo_and_questionnaire' : source,
      steps: ['Use the detected nose bridge as a guide for a thin layer of base.',
        profile.finish === 'matte' ? 'Blend outward and keep extra product away from creases.' : 'Keep a small highlight on the bridge and blend its edges.'],
      slots: ['base'], inferredPreferences: { coverage: 'light_all_over' }, match: 'base',
      reason: 'The mapped bridge and center of the face give a guide for thin, blended base placement. These base options support that finish; choose the exact shade yourself.' };
    case 'cheeks': return { ...common, title: m.verticalPlacement > 0.55 ? 'Lifted, diffused cheek color' : 'Soft watercolor cheek color',
      steps: m.verticalPlacement > 0.55
        ? ['Start on the upper outer area of the detected cheek and blend toward the temple.', 'Build a thin layer at a time, leaving the center of the face soft.']
        : ['Place a small amount around the detected cheek center, then diffuse the edge.', 'Keep the finish light so the color stays soft in daylight.'],
      slots: ['cheek'], match: 'cheek', reason: 'The mapped cheek position guides where to place a soft layer of color. These blush options let you try that placement and adjust the intensity.' };
    case 'lips': return { ...common, title: profile.finish === 'dewy' ? 'A glossy center-lip accent'
      : profile.finish === 'matte' ? 'Softly blurred lip color' : m.heightToWidthRatio < 0.35 ? 'A soft center-lip gradient' : 'Softly blurred lip color',
      source: known(profile.finish) || known(profile.colorFamily) ? 'photo_and_questionnaire' : source,
      steps: profile.finish === 'dewy'
        ? ['Follow the visible lip border and keep the color light at the edges.', 'Concentrate the gloss at the center for a reflective finish.']
        : ['Place color at the center of the lip region and blend toward the measured border.', 'Leave the edge soft; add another thin layer if you want stronger color.'],
      slots: ['lip'], match: 'lip', reason: 'The sampled color and visible lip outline guide a starting palette and softly blended placement. These lip-color alternatives let you build the effect a layer at a time.' };
    case 'skin_texture': {
      const visible = ['visible', 'pronounced'].includes(m.level);
      return { ...common, inspiration: null, title: visible ? 'Explore smoother-looking texture' : 'Light hydration prep',
        steps: visible
          ? ['Zoom in and check that the visible detail is present in ordinary light too.', 'Explore one texture-focused option, then refine it with your skin feel and reaction history.']
          : ['The sampled patch has little fine contrast in this photo.', 'Choose a comfortable hydration step if you want a simple makeup-prep routine.'],
        slots: visible ? ['moisturizer', 'serum', 'toner'] : ['moisturizer'], match: visible ? 'texture' : 'hydration',
        reason: visible ? 'The photo suggests visible texture, so these options focus on a smoother-looking finish and comfortable preparation before makeup. The image cannot establish enlarged pores or their cause.'
          : 'The sampled texture looks fairly subtle, so a simple moisturizing preparation step is a useful starting point for an even makeup finish.' };
    }
    case 'skin_tone': {
      const visible = ['visible', 'pronounced'].includes(m.level);
      return { ...common, inspiration: null, title: visible ? 'Explore even-looking tone' : 'Keep daily protection simple',
        steps: visible
          ? ['Check the enlarged patch for lighting or makeup differences before treating it as a concern.', 'Explore a cosmetic tone-care option only if this appearance is something you want to change.']
          : ['The sampled areas show relatively little color variation in this photo.', 'A verified daytime sunscreen can remain a simple daily routine step.'],
        slots: visible ? ['moisturizer', 'serum'] : ['daytime_sunscreen'], match: visible ? 'tone' : 'sun',
        reason: visible ? 'The photo suggests some uneven-looking color, so these options have reviewed cosmetic claims for a more even-looking tone. Choose the finish you want to emphasize.'
          : 'The sampled color looks fairly even, so a simple daytime protection step can complement your existing routine.' };
    }
    default: return { ...common, title: region.label, steps: [] };
  }
}

function withChosenGuide(style, region, profile, guides, catalog) {
  if (!region.quality?.usable) return style;
  const kind = region.kind === 'skincare' ? 'skincare' : 'makeup';
  const selectedId = profile[`${kind}StyleId`];
  const guide = (guides?.[kind] || []).find(item => item.id === selectedId);
  if (!guide) return style;
  const selections = (guide.selections || []).map(item => item.productId);
  const categories = catalog.filter(product => selections.includes(product.id)).map(product => product.makeup_category).filter(Boolean);
  const direction = guide.regionDirections?.[region.id];
  const steps = direction?.steps?.length ? direction.steps : kind === 'skincare' && guide.steps?.length ? guide.steps : style.steps;
  const inferredPreferences = { ...style.inferredPreferences };
  // A chosen guide can use pencils or brow mascara; keep explicit format answers,
  // but do not let the photo's default mascara idea suppress a reviewed pencil.
  if (region.id === 'brows' && categories.includes('brow')) delete inferredPreferences.eyeFormat;
  return { ...style,
    title: direction?.title || `${guide.title} · ${style.title}`,
    steps,
    source: 'photo_and_style_choice',
    styleChoice: { id: guide.id, title: guide.title },
    reason: [style.reason, `You chose ${guide.title}. These styling or routine instructions are your selected direction, not a finding from your photo.`].filter(Boolean).join(' '),
    preferredProductIds: selections,
    preferredCategories: categories,
    inferredPreferences,
  };
}

function relevantEvidence(product, meta, style, profile) {
  if (style.match === 'brow') return trait(meta, 'format', 'brow_mascara') || trait(meta, 'format', 'brow_pencil')
    || product.makeup_category === 'brow' && trait(meta, 'format', 'pencil');
  if (style.match === 'eye') return product.makeup_category !== 'brow' && !trait(meta, 'format', 'brow_mascara') && !trait(meta, 'format', 'brow_pencil')
    && trait(meta, 'chosen_effect', profile.eyeEffect);
  if (style.match === 'lip') return trait(meta, 'chosen_color_family', profile.colorFamily);
  if (['texture', 'tone'].includes(style.match)) return appearanceEvidence(product, meta, style.match);
  if (style.match === 'hydration') return trait(meta, 'ordered_goals', 'hydration_comfort');
  if (style.match === 'sun') return meta.broadSpectrumSPF >= 30 ? meta.sunscreenEvidence : null;
  if (['cheek', 'base'].includes(style.match)) return meta.identityVerified ? meta.identityEvidence ?? { basis: 'Reviewed catalog category' } : null;
  return null;
}

function candidatesFor(style, kit, catalog, evidence) {
  const p = kit.profile;
  const effective = { ...p };
  for (const [key, value] of Object.entries(style.inferredPreferences)) if (!known(effective[key])) effective[key] = value;
  const candidates = [];
  const gates = new Set();
  for (const product of catalog) {
    const meta = metadataFor(product, evidence);
    const imageEvidence = relevantEvidence(product, meta, style, effective);
    if (!imageEvidence) continue;
    for (const slot of style.slots) {
      if (!meta.slots?.includes(slot)) continue;
      if (p.ownedSlots.includes(slot)) { gates.add('You are keeping your own product for this category.'); continue; }
      if (p.swaps[slot] && p.swaps[slot] !== product.id) { gates.add('Your selected exact product takes priority.'); continue; }
      const evaluation = evaluateProduct(product, slot, effective, evidence);
      if (evaluation.state === 'excluded') { evaluation.reasons.forEach(reason => gates.add(reason)); continue; }
      const replaced = kit.items.find(item => item.slot === slot && item.product);
      if (kit.items.some(item => item.slot !== slot && item.product?.id === product.id)) continue;
      const retainedSlots = new Set([...p.ownedSlots, ...kit.items.filter(item => item.product && item.slot !== slot).map(item => item.slot)]);
      const dependencies = evaluation.requiredSlots.filter(required => !retainedSlots.has(required));
      if (kit.itemCount + (replaced ? 0 : 1) + dependencies.length > p.itemCap) { gates.add('No room within the daily product limit.'); continue; }
      const budgetForAlternative = kit.remainingCents === null ? null : kit.remainingCents + (replaced?.evaluation?.priceCents ?? 0);
      let dependencyCents = 0;
      let unknownDependencyCost = false;
      for (const dependency of dependencies) {
        const options = catalog.filter(option => option.id !== product.id
          && !kit.items.some(item => item.product?.id === option.id)
          && (!p.swaps[dependency] || p.swaps[dependency] === option.id))
          .map(option => evaluateProduct(option, dependency, effective, evidence))
          .filter(result => result.state !== 'excluded' && result.priceCents !== null);
        if (!options.length) unknownDependencyCost = true;
        else dependencyCents += Math.min(...options.map(option => option.priceCents));
      }
      if (budgetForAlternative !== null && (unknownDependencyCost || evaluation.priceCents === null
        || evaluation.priceCents + dependencyCents > budgetForAlternative)) {
        gates.add('The product and its required steps do not fit a verified remaining budget.'); continue;
      }
      const reasons = [...evaluation.reasons];
      if (slot === 'cheek' && known(p.colorFamily) && !trait(meta, 'chosen_color_family', p.colorFamily)) {
        reasons.push(`Your selected ${p.colorFamily} color is not verified for this exact blush shade.`);
      }
      const score = scoreProduct(product, slot, effective, evidence);
      score.explanation = 'Photo-guided style category, refined by your answers. Preference points are not a prediction of results.';
      for (const component of score.components) {
        const inferredField = component.dimension === 'chosen_effect' ? 'eyeEffect' : component.dimension === 'format' ? 'eyeFormat'
          : component.dimension === 'chosen_color_family' ? 'colorFamily' : component.dimension;
        if (style.inferredPreferences[inferredField] && !known(p[inferredField])) component.reason = `The photo-guided styling idea uses ${String(component.preference).replaceAll('_', ' ')}. ${component.match ? 'Reviewed product evidence supports this format or effect.' : 'Product support for this styling preference is not established.'}`;
      }
      candidates.push({ product, slot, state: reasons.length ? 'needs_verification' : evaluation.state, reasons,
        score, priceCents: evaluation.priceCents, budgetForAlternative, imageEvidence,
        styleChoice: style.styleChoice ?? null,
        imageReason: product.intended_benefit || `An option for ${style.title.toLowerCase()}.` });
    }
  }
  candidates.sort((a, b) => Number(a.state !== 'eligible') - Number(b.state !== 'eligible')
    || (b.score.value ?? 0) - (a.score.value ?? 0)
    || Number((style.preferredProductIds || []).includes(b.product.id)) - Number((style.preferredProductIds || []).includes(a.product.id))
    || Number((style.preferredCategories || []).includes(b.product.makeup_category)) - Number((style.preferredCategories || []).includes(a.product.makeup_category))
    || b.score.softRequirementMatches - a.score.softRequirementMatches
    || (a.priceCents ?? Infinity) - (b.priceCents ?? Infinity)
    || compareText(a.product.id, b.product.id));
  const seen = new Set();
  const cards = candidates.filter(card => !seen.has(card.product.id) && seen.add(card.product.id)).slice(0, 3);
  return { cards, reason: cards.length ? 'These are separate alternatives; selecting a style does not add all of them to your kit.'
    : gates.size ? [...gates].slice(0, 2).join(' ') : 'No reviewed catalog options support this style with your current preferences.', gates: [...gates] };
}

/**
 * Image-derived regions are the entry point. Answers refine styles and product
 * gates without changing measurements or saving photo-derived personal claims.
 * Returned cards are separate alternatives, never a combined purchasable kit.
 */
export function getFaceRecommendations(analysis, profile = {}, products = [], evidence = {}, guides = {}) {
  const empty = reason => ({ regions: [], featured: [], reason, methodVersion: FACE_RECOMMENDATIONS_VERSION });
  if (analysis?.status !== 'ready' || !Array.isArray(analysis.regions)) return empty('Take a clear selfie to explore recommendations on your face.');
  const catalog = Array.isArray(products) ? products : products?.products ?? [];
  let kit;
  try { kit = buildKit({ reactionHistory: 'unknown', ...profile }, catalog, evidence); }
  catch (error) { return empty(error instanceof Error ? error.message : 'Review your questionnaire before exploring products.'); }
  const p = kit.profile;
  const confirmedScope = ['skincare', 'makeup'].includes(p.scope) && Array.isArray(p.answerProvenance)
    && p.answerProvenance.some(answer => answer?.field === 'scope' && answer.source === 'questionnaire'
      && answer.confirmed === true && answer.value === p.scope) ? p.scope : null;
  const seen = new Set();
  const regions = analysis.regions.filter(region => REGION_IDS.has(region?.id) && !seen.has(region.id) && seen.add(region.id)).map(region => {
    const style = withChosenGuide(styleFor(region, p), region, p, guides, catalog);
    let selected = { cards: [], reason: style.reason, gates: [] };
    if (region.quality?.usable) {
      if (region.id === 'lips') {
        const colorIdea = getPhotoShortlist(analysis, p, catalog, evidence);
        // Reuse the existing measured-color/catalog fallback, then independently
        // rank lip options. Cheaper cheek candidates must not crowd lip products
        // out of a shared three-card shortlist.
        selected = candidatesFor({ ...style, inferredPreferences: { colorFamily: colorIdea.colorFamily } }, kit, catalog, evidence);
        selected.colorFamily = colorIdea.colorFamily;
        selected.reason = [colorIdea.reason, selected.reason].filter(Boolean).join(' ');
      } else selected = candidatesFor(style, kit, catalog, evidence);
    }
    const { slots, match, inferredPreferences, preferredProductIds, preferredCategories, ...presentation } = style;
    const recommendation = { ...presentation, products: selected.cards, rationale: style.reason || style.why,
      reason: [style.reason, selected.reason].filter((value, index, all) => value && all.indexOf(value) === index).join(' '),
      gates: selected.gates ?? [], colorFamily: selected.colorFamily ?? null };
    let priority = Number.isFinite(region.priority) ? region.priority : 0;
    if (region.quality?.usable) {
      // Engine defaults must not make a fresh selfie a skincare-only journey.
      // A scope the person actually answered can move that category to the top.
      if (confirmedScope && region.kind === confirmedScope) priority += 100;
      if (p.goals.includes('hydration_comfort') && region.id === 'skin_texture') priority += 12;
      if (p.goals.includes('less_shine') && region.id === 'skin_texture') priority += 12;
      if (p.goals.includes('natural_makeup') && ['cheeks', 'lips'].includes(region.id)) priority += 8;
      if (known(p.colorFamily) && region.id === 'lips') priority += 8;
      if (known(p.eyeEffect) && region.id === 'eyes') priority += 8;
    }
    return { ...region, recommendation, cards: selected.cards, priority };
  });
  // An explicit skincare-only choice must not silently become makeup when the
  // skin photo is unclear. Feature the retake guidance for that chosen area.
  const featured = regions.filter(region => confirmedScope ? region.kind === confirmedScope : region.quality?.usable)
    .sort((a, b) => Number(!a.quality?.usable) - Number(!b.quality?.usable) || b.priority - a.priority || compareText(a.id, b.id)).slice(0, 3);
  return { regions, featured, reason: 'Start with these photo-guided ideas. Tap another region to explore more, or refine the answers at any time.',
    remainingCents: kit.remainingCents, methodVersion: FACE_RECOMMENDATIONS_VERSION };
}
