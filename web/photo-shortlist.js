import { buildKit, evaluateProduct, scoreProduct } from './engine.js';
import { nearestColorFamily } from './photo-measurements.js';

export const PHOTO_SHORTLIST_VERSION = 'photo-shortlist-v1';
const COLORS = new Set(['pink', 'rose', 'coral', 'red', 'nude', 'berry']);
const PHOTO_FIELDS = new Set(['selfie', 'photo', 'photoAnalysis', 'analysis', 'samples', 'dataUrl', 'imageData', 'landmarks', 'faceLandmarks', 'markers']);
const metadataFor = (product, evidence) => evidence?.[product.id] ?? evidence?.products?.[product.id] ?? {};
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const readyAnalysis = analysis => analysis?.status === 'ready' && COLORS.has(analysis.colorFamily);

function copyProfile(value) {
  if (Array.isArray(value)) return value.map(copyProfile);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !PHOTO_FIELDS.has(key))
    .map(([key, child]) => [key, copyProfile(child)]));
}

/**
 * Separate color exploration, never a mutation of the saved profile or kit.
 * Each card is an alternative; their prices are not added together. Existing
 * routine costs, retained products, item limits and engine exclusions still apply.
 */
export function getPhotoShortlist(analysis, profile = {}, products = [], evidence = {}) {
  const chosenColor = COLORS.has(profile?.colorFamily) ? profile.colorFamily : null;
  const source = chosenColor ? 'questionnaire' : 'photo';
  const observedColorFamily = readyAnalysis(analysis) ? analysis.colorFamily : null;
  let colorFamily = chosenColor ?? observedColorFamily;
  let nearestAvailable = false;
  const empty = reason => ({ cards: [], reason, colorFamily, observedColorFamily, nearestAvailable,
    source, remainingCents: null, methodVersion: PHOTO_SHORTLIST_VERSION });
  if (!readyAnalysis(analysis)) return empty('Take a clear selfie to explore colors from the photo.');
  const catalog = Array.isArray(products) ? products : products?.products ?? [];
  const catalogFamilies = new Set(catalog.flatMap(product => {
    const meta = metadataFor(product, evidence);
    if (!meta.slots?.some(slot => ['lip', 'cheek'].includes(slot))) return [];
    const trait = meta.traits?.chosen_color_family;
    return trait?.url && trait.date && trait.basis && Array.isArray(trait.values) ? trait.values.filter(family => COLORS.has(family)) : [];
  }));
  // Missing catalog families use the same versioned editorial palette as the
  // pixel measurement. Never substitute for an explicit questionnaire answer.
  if (!chosenColor && !catalogFamilies.has(colorFamily)) {
    const nearest = nearestColorFamily(analysis.samples?.lip?.rgb, [...catalogFamilies]);
    if (nearest) {
      colorFamily = nearest;
      nearestAvailable = true;
    }
  }
  let kit;
  try { kit = buildKit({ reactionHistory: 'unknown', ...profile }, catalog, evidence); }
  catch (error) { return empty(error instanceof Error ? error.message : 'Review your questionnaire before exploring colors.'); }
  const p = kit.profile;
  const previewProfile = { ...p, colorFamily };
  const cards = [];
  let reviewedMatches = 0;
  let limitedByBudgetOrItems = false;

  for (const product of catalog) {
    const meta = metadataFor(product, evidence);
    for (const slot of ['lip', 'cheek']) {
      if (!meta.slots?.includes(slot) || p.ownedSlots.includes(slot)) continue;
      if (p.swaps[slot] && p.swaps[slot] !== product.id) continue;
      const score = scoreProduct(product, slot, previewProfile, evidence);
      const color = score.components.find(component => component.dimension === 'chosen_color_family');
      // Only authored, sourced color evidence can connect photo colors to products.
      if (color?.known !== 1 || color.match !== 1) continue;
      reviewedMatches += 1;
      const evaluation = evaluateProduct(product, slot, previewProfile, evidence);
      if (evaluation.state === 'excluded') {
        if (evaluation.checks.some(check => check.id === 'F04' && check.state === 'fail')) limitedByBudgetOrItems = true;
        continue;
      }
      const replaced = kit.items.find(item => item.slot === slot && item.product);
      if (kit.items.some(item => item.slot !== slot && item.product?.id === product.id)) continue;
      const retainedSlots = new Set([...p.ownedSlots, ...kit.items.filter(item => item.product && item.slot !== slot).map(item => item.slot)]);
      const dependencies = evaluation.requiredSlots.filter(required => !retainedSlots.has(required));
      const addedItemCount = (replaced ? 0 : 1) + dependencies.length;
      if (kit.itemCount + addedItemCount > p.itemCap) {
        limitedByBudgetOrItems = true;
        continue;
      }
      const budgetForAlternative = kit.remainingCents === null ? null
        : kit.remainingCents + (replaced?.evaluation?.priceCents ?? 0);
      let minimumDependencyCents = 0;
      for (const dependency of dependencies) {
        const eligibleCosts = catalog.filter(option => (!p.swaps[dependency] || p.swaps[dependency] === option.id)
          && option.id !== product.id && !kit.items.some(item => item.product?.id === option.id))
          .map(option => evaluateProduct(option, dependency, previewProfile, evidence))
          .filter(result => result.state === 'eligible' && result.priceCents !== null).map(result => result.priceCents);
        if (eligibleCosts.length) minimumDependencyCents += Math.min(...eligibleCosts);
      }
      if (budgetForAlternative !== null && (evaluation.priceCents === null
          || evaluation.priceCents + minimumDependencyCents > budgetForAlternative)) {
        limitedByBudgetOrItems = true;
        continue;
      }
      if (source === 'photo') {
        color.reason = `The visible photo color suggests exploring ${colorFamily}. Reviewed product evidence supports this color family; this is not a personal shade match.`;
        score.explanation = 'Editorial color exploration from visible photo pixels and your selected preferences; not a safety, efficacy or shade-match score.';
      }
      cards.push({ product, slot, colorFamily, state: evaluation.state, reasons: evaluation.reasons.slice(), score,
        priceCents: evaluation.priceCents, budgetForAlternative });
    }
  }

  cards.sort((a, b) => Number(a.state !== 'eligible') - Number(b.state !== 'eligible')
    || (b.score.value ?? 0) - (a.score.value ?? 0)
    || b.score.softRequirementMatches - a.score.softRequirementMatches
    || (a.priceCents ?? Infinity) - (b.priceCents ?? Infinity)
    || compareText(a.product.id, b.product.id) || compareText(a.slot, b.slot));
  const seen = new Set();
  const alternatives = cards.filter(card => {
    if (seen.has(card.product.id)) return false;
    seen.add(card.product.id);
    return true;
  }).slice(0, 3);
  const fallbackReason = nearestAvailable
    ? `No reviewed ${observedColorFamily} shades are available in this catalog. ${colorFamily[0].toUpperCase() + colorFamily.slice(1)} is the nearest available family in the editorial palette; this is color inspiration, not a shade match. ` : '';
  const reason = fallbackReason + (alternatives.length
    ? `${source === 'questionnaire' ? 'Your selected color takes priority. ' : ''}These are separate color ideas, not additions to your kit. Confirm a color to refine your answers.`
    : !reviewedMatches
      ? `There are no reviewed ${colorFamily} lip or cheek colors available for this preview. Try another color in your questionnaire.`
      : limitedByBudgetOrItems
        ? 'These color ideas do not fit the remaining budget or daily product limit. Edit your questionnaire to make room.'
        : 'No reviewed color options pass your current product exclusions and requirements.');
  return { cards: alternatives, reason, colorFamily, observedColorFamily, nearestAvailable, source,
    remainingCents: kit.remainingCents, methodVersion: PHOTO_SHORTLIST_VERSION };
}

/** Call only after an explicit user confirmation. Adds no routine slots. */
export function confirmPhotoColor(profile, analysis, chosenFamily = analysis?.colorFamily) {
  const next = copyProfile(profile ?? {});
  if (!readyAnalysis(analysis) || !COLORS.has(chosenFamily)) return next;
  const now = new Date().toISOString();
  const methodVersion = typeof analysis.methodVersion === 'string' && /^[a-zA-Z0-9._-]{1,80}$/.test(analysis.methodVersion)
    ? analysis.methodVersion : 'face-pixels-v1';
  next.colorFamily = chosenFamily;
  next.answerProvenance = (Array.isArray(next.answerProvenance) ? next.answerProvenance : []).filter(answer => answer?.field !== 'colorFamily');
  next.answerProvenance.push({ field: 'colorFamily', value: chosenFamily, source: 'confirmed_photo', confirmed: true,
    updated_at: now, observation_id: `${methodVersion}:${now}` });
  return next;
}
