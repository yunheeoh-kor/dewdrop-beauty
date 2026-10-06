import { buildKit, defaultProfile, evaluateProduct, scoreProduct } from './engine.js';

/** A photo starts a preview; it does not supply or confirm questionnaire answers. */
export function createInstantProfile(savedProfile = null) {
  return {
    ...defaultProfile(),
    reactionHistory: 'unknown',
    answerProvenance: [],
    ...(savedProfile && typeof savedProfile === 'object' && !Array.isArray(savedProfile)
      ? JSON.parse(JSON.stringify(savedProfile)) : {}),
  };
}

const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const compareCandidates = (a, b) => (b.score.value ?? 0) - (a.score.value ?? 0)
  || b.score.softRequirementMatches - a.score.softRequirementMatches
  || (a.evaluation.priceCents ?? Infinity) - (b.evaluation.priceCents ?? Infinity)
  || compareText(a.product.id, b.product.id);

/**
 * Keep the verified planning kit intact and offer separate, explicitly pending
 * previews for unanswered checks. Pending cards never become purchases or totals.
 */
export function getInstantRecommendations(profile = createInstantProfile(), products = [], evidence = {}) {
  try {
    // Keep live values intact for validation: JSON storage cloning would turn
    // nonfinite budgets into null and accidentally remove the spending cap.
    const kit = buildKit({ ...createInstantProfile(), ...profile }, products, evidence);
    const p = kit.profile;
    const cardsBySlot = new Map(kit.items.filter(item => item.product || item.owned).map(item => [item.slot, {
      slot: item.slot,
      product: item.product,
      score: item.score,
      state: item.owned ? 'owned' : item.evaluation.state,
      reasons: item.evaluation?.reasons ?? [],
      owned: Boolean(item.owned),
    }]));
    let remainingItems = Math.max(0, p.itemCap - kit.itemCount);
    let remainingCents = kit.remainingCents ?? Infinity;
    const usedProducts = new Set(kit.items.filter(item => item.product).map(item => item.product.id));
    const catalog = Array.isArray(products) ? products : products?.products ?? [];

    for (const missing of kit.missing) {
      if (!remainingItems) break;
      const slot = missing.slot;
      const selectedId = p.swaps[slot];
      // An eligible option omitted by the optimizer is a whole-kit constraint
      // gap. Do not disguise that gap as an unresolved evidence check.
      const eligibleOption = catalog.some(product => (!selectedId || selectedId === product.id)
        && evaluateProduct(product, slot, p, evidence).state === 'eligible');
      if (eligibleOption) continue;

      // Use the engine's pending list, whose dependency checks understand kit
      // assembly. This avoids making unaffordable dependency sets look pending.
      const candidates = kit.pending.filter(item => item.slot === slot
        && (!selectedId || selectedId === item.product.id)
        && !usedProducts.has(item.product.id)).map(item => ({
        ...item,
        evaluation: evaluateProduct(item.product, slot, p, evidence),
        score: scoreProduct(item.product, slot, p, evidence),
      })).filter(item => item.evaluation.state === 'needs_verification'
        && (item.evaluation.priceCents === null
          ? p.budgetCents === null
          : item.evaluation.priceCents <= remainingCents)).sort(compareCandidates);
      const preview = candidates[0];
      if (!preview) continue;
      cardsBySlot.set(slot, {
        slot,
        product: preview.product,
        score: preview.score,
        state: 'needs_verification',
        reasons: preview.evaluation.reasons,
        owned: false,
      });
      usedProducts.add(preview.product.id);
      remainingItems -= 1;
      remainingCents -= preview.evaluation.priceCents ?? 0;
    }

    // Keep requested steps in order and retain any engine-added removal step.
    const slots = [...new Set([...p.slots, ...kit.items.map(item => item.slot)])];
    return { kit, cards: slots.map(slot => cardsBySlot.get(slot)).filter(Boolean) };
  } catch (error) {
    return { kit: null, cards: [], error: error instanceof Error ? error.message : String(error) };
  }
}
