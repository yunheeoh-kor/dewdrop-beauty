/** Deterministic, evidence-gated planning recommendations. No network or photo inference. */
export const SLOT_LABELS = Object.freeze({
  cleanser: 'Cleanser', moisturizer: 'Moisturizer', daytime_sunscreen: 'Daytime sunscreen',
  lip: 'Lip color', cheek: 'Cheek color', eyes: 'Eye makeup', base: 'Base makeup',
  toner: 'Toner / essence', serum: 'Serum', remover: 'Makeup remover',
});

const SKIN = new Set(['cleanser', 'moisturizer', 'daytime_sunscreen', 'toner', 'serum', 'remover']);
const MAKEUP = new Set(['lip', 'cheek', 'eyes', 'base']);
const INTERNAL_ASSEMBLY = Symbol('dependency assembly');
const UNKNOWN = new Set(['unknown', 'unsure', '', null, undefined]);
const PRICE_CHECKS = ['Refresh exact-variant price and stock', 'Verify seller shipping, tax and any import charges'];
const unique = (values = []) => [...new Set(values)];
const words = value => String(value ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
const knownAnswer = value => !UNKNOWN.has(value);
const label = value => String(value).replaceAll('_', ' ');
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;

export function defaultProfile() {
  return {
    scope: 'skincare', budgetCents: null, reserveCents: 0, currency: 'USD', country: 'United States',
    slots: ['cleanser', 'moisturizer', 'daytime_sunscreen'], ownedSlots: [], goals: [],
    routineTime: 'help_start_small', itemCap: 3, reactionHistory: 'no', avoidedIngredients: [],
    reactedProductIds: [], mandatoryRequirements: [], preferredRequirements: [], skinFeel: 'unknown',
    texture: 'unknown', makeupSkill: 'unknown', coverage: 'unknown', finish: 'unknown',
    colorFamily: 'unknown', eyeEffect: 'unknown', wear: 'unknown', simpleApplication: false,
    selectedShades: {}, swaps: {},
  };
}

export function money(cents) {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return 'Not set';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

function normalizeProfile(input = {}) {
  const p = { ...defaultProfile(), ...input };
  for (const field of ['slots', 'ownedSlots', 'goals', 'avoidedIngredients', 'reactedProductIds', 'mandatoryRequirements', 'preferredRequirements']) {
    if (!Array.isArray(p[field])) throw new TypeError(`${field} must be an array.`);
    p[field] = unique(p[field].filter(value => typeof value === 'string' && value.trim()));
  }
  p.avoidedIngredients = unique(p.avoidedIngredients.map(value => value.trim().toLowerCase()));
  p.goals = p.goals.slice(0, 2);
  for (const field of ['budgetCents', 'reserveCents']) {
    if (field === 'budgetCents' && p[field] === null) continue;
    if (!Number.isSafeInteger(p[field]) || p[field] < 0) throw new RangeError(`${field} must be a nonnegative integer number of cents.`);
  }
  if (p.budgetCents !== null && p.reserveCents > p.budgetCents) throw new RangeError('The shipping and tax reserve cannot exceed the budget.');
  if (!Number.isSafeInteger(p.itemCap) || p.itemCap < 0) throw new RangeError('The routine item limit must be a nonnegative integer.');
  if (p.currency !== 'USD') throw new RangeError('Only USD budgets are supported; currency conversion has not been verified.');
  p.selectedShades = p.selectedShades && typeof p.selectedShades === 'object' ? { ...p.selectedShades } : {};
  p.swaps = p.swaps && typeof p.swaps === 'object' ? { ...p.swaps } : {};
  return p;
}

function metadataFor(product, evidence) {
  return evidence?.[product.id] ?? evidence?.products?.[product.id] ?? {};
}

function priceCents(product) {
  if (Number.isSafeInteger(product.price_cents) && product.price_cents >= 0) return product.price_cents;
  const value = product.price_usd;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  const cents = Math.round(value * 100);
  return Number.isSafeInteger(cents) && Math.abs(value * 100 - cents) < 0.000001 ? cents : null;
}

const ALIASES = {
  fragrance: ['fragrance', 'parfum', 'perfume'], parfum: ['fragrance', 'parfum', 'perfume'],
  'alcohol denat': ['alcohol denat', 'denatured alcohol', 'sd alcohol'],
  'denatured alcohol': ['alcohol denat', 'denatured alcohol', 'sd alcohol'],
};

function containsIngredient(product, meta, ingredient) {
  const normalized = words(ingredient);
  const aliases = unique([normalized, ...(ALIASES[normalized] ?? []), ...(meta.ingredientAliases?.[normalized] ?? []).map(words)]);
  const entries = [...(product.key_ingredients ?? []), ...(meta.ingredients ?? [])].map(words);
  if (entries.some(entry => aliases.some(alias => (` ${entry} `).includes(` ${alias} `)))) return true;
  // Evidence notes can establish presence, but mere prose mentioning an ingredient cannot establish absence.
  const notes = String(product.evidence_notes ?? '').split(/[.;\n]/);
  return notes.some(sentence => aliases.some(alias => {
    const sentenceWords = words(sentence);
    if (!(` ${sentenceWords} `).includes(` ${alias} `)) return false;
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?:no|without|free of|free from|does not contain|not contain|excludes) (?:[a-z]+ ){0,3}${escaped}\\b`).test(sentenceWords)) return false;
    if (new RegExp(`\\b${escaped} free\\b`).test(sentenceWords)) return false;
    return /\b(contains?|includes?|lists?|confirms?|inci|ingredients?)\b/.test(sentenceWords);
  }));
}

function evaluateNormalized(product, slot, p, evidence) {
  const meta = metadataFor(product, evidence);
  const checks = [];
  const check = (id, state, reason) => checks.push({ id, state, reason });
  const cents = priceCents(product);
  const shade = meta.exactShade ?? product.shade ?? null;
  if (!(meta.slots ?? []).includes(slot)) check('SLOT', 'fail', `This reviewed product does not fill ${SLOT_LABELS[slot] ?? slot}.`);
  if (p.country !== 'United States' || (product.market && product.market !== p.country)) {
    check('F01', 'fail', 'The catalog does not verify this exact formula for the selected shopping country.');
  } else if (meta.identityVerified !== true || !product.id || !product.size) {
    check('F01', 'unknown', 'Exact regional formula, size, shade and price identity need verification.');
  } else check('F01', 'pass', 'Reviewed product identity and snapshot price refer to the same regional variant.');

  if (p.reactedProductIds.includes(product.id)) check('F02', 'fail', 'You reported a previous reaction to this exact product.');
  else if (!p.avoidedIngredients.length) check('F02', 'skip', 'No ingredient exclusions were selected.');
  else {
    const found = p.avoidedIngredients.filter(ingredient => containsIngredient(product, meta, ingredient));
    if (found.length) check('F02', 'fail', `Verified ingredient evidence includes your avoidance: ${found.join(', ')}.`);
    else if (meta.completeInci !== true || meta.aliasesReviewed !== true) check('F02', 'unknown', 'A complete current exact-variant ingredient list and reviewed ingredient aliases are needed to check your avoidance list.');
    else check('F02', 'pass', 'Your exclusions are absent from the reviewed complete formula; this does not guarantee tolerance.');
  }
  const unresolvedHistory = p.reactionHistory === 'unsure' || !['no', 'yes'].includes(p.reactionHistory)
    || (p.reactionHistory === 'yes' && !p.avoidedIngredients.length && !p.reactedProductIds.length);
  if (unresolvedHistory) check('F02', 'unknown', p.reactionHistory === 'yes'
    ? 'Your reaction history needs a known ingredient to avoid or an exact previously reacted product. Free-text notes alone cannot clear this check.'
    : 'Your reaction history is unresolved. Review this answer and any known ingredient or exact-product exclusions before adding new products.');

  if (meta.requiresExplicitRequest === true && p.swaps[slot] !== product.id) {
    check('OPT_IN', 'unknown', meta.explicitRequestReason ?? 'This exfoliating or retinoid product needs an explicit product-level choice; choosing a general routine category does not add it automatically.');
  }

  if (!p.mandatoryRequirements.length) check('F03', 'skip', 'No mandatory formula requirements were selected.');
  for (const requirement of p.mandatoryRequirements) {
    const result = meta.requirements?.[requirement];
    check('F03', result === true ? 'pass' : result === false ? 'fail' : 'unknown',
      result === true ? `Exact-variant ${label(requirement)} evidence is supported.` : result === false ? `This formula does not meet mandatory ${label(requirement)}.` : `Mandatory ${label(requirement)} is not verified for this exact variant.`);
  }

  if (cents === null || (product.currency && product.currency !== 'USD')) check('F04', 'unknown', 'A valid exact-variant USD price is needed.');
  else if (p.budgetCents !== null && cents > p.budgetCents - p.reserveCents) check('F04', 'fail', `Its ${money(cents)} snapshot price exceeds the available merchandise budget.`);
  else check('F04', 'pass', p.budgetCents === null ? 'Snapshot merchandise price is known; no spending cap was supplied.' : 'Individually within the merchandise budget; the whole kit is checked separately.');

  if (slot !== 'base') check('F05', 'skip', 'The base shade gate does not apply to this slot.');
  else {
    const selected = p.selectedShades[product.id] ?? p.selectedShades.base;
    // A range of shades is not evidence that this snapshot's price/formula covers another variant.
    const supported = shade ? [shade] : unique((meta.supportedShades ?? []).filter(Boolean));
    if (!selected || !supported.length) check('F05', 'unknown', 'Choose a supported exact shade for this product; a photo estimate cannot establish the match.');
    else if (!supported.includes(selected)) check('F05', 'fail', 'The selected shade is not the exact catalog variant supported by this product evidence.');
    else check('F05', 'pass', `You explicitly selected supported shade ${selected}; personal shade suitability is not guaranteed.`);
  }

  if (slot !== 'daytime_sunscreen') check('F06', 'skip', 'This is not being used to fill the daytime sunscreen slot.');
  else if (!Number.isFinite(meta.broadSpectrumSPF)) check('F06', 'unknown', 'Broad-spectrum SPF 30 or higher needs exact-market verification.');
  else if (meta.broadSpectrumSPF < 30) check('F06', 'fail', 'The verified SPF is below the required broad-spectrum SPF 30.');
  else check('F06', 'pass', `Verified broad-spectrum SPF ${meta.broadSpectrumSPF} in the selected market.`);

  const requiredSlots = unique([...(meta.requiredSlots ?? []), ...(meta.removal === 'remover' ? ['remover'] : [])]);
  const absentDependencies = requiredSlots.filter(required => !p.ownedSlots.includes(required));
  if (MAKEUP.has(slot) && !['none', 'remover'].includes(meta.removal)) {
    check('F07', 'unknown', 'Product-specific removal instructions and any compatible remover need verification.');
  } else if (absentDependencies.length && !p[INTERNAL_ASSEMBLY]) {
    check('F07', 'unknown', `A verified ${absentDependencies.map(value => SLOT_LABELS[value] ?? value).join(' and ')} step must be added and checked against the whole-kit budget and item limit.`);
  } else if (requiredSlots.length) check('F07', 'pass', absentDependencies.length ? 'Verified application/removal dependencies will be enforced during whole-kit assembly.' : 'Required application/removal steps are retained as owned items.');
  else check('F07', 'skip', 'No verified extra application/removal dependency applies.');

  const state = checks.some(item => item.state === 'fail') ? 'excluded' : checks.some(item => item.state === 'unknown') ? 'needs_verification' : 'eligible';
  return { state, checks, reasons: checks.filter(item => ['fail', 'unknown'].includes(item.state)).map(item => item.reason),
    pendingChecks: checks.filter(item => item.state === 'unknown').map(item => item.reason), requiredSlots,
    priceCents: cents, exactShade: shade };
}

export function evaluateProduct(product, slot, profile, evidence = {}) {
  return evaluateNormalized(product, slot, normalizeProfile(profile), evidence);
}

function traitMatch(meta, dimension, preference) {
  const trait = meta.traits?.[dimension];
  if (!trait || !trait.url || !trait.date || !trait.basis || !Array.isArray(trait.values)) return { match: 0, known: 0, evidence: null };
  if (trait.values.includes(preference)) return { match: 1, known: 1, evidence: trait };
  const reviewed = Array.isArray(trait.knownValues) ? trait.knownValues.includes(preference) : trait.values.length > 0;
  const mismatch = (trait.mismatches ?? []).includes(preference);
  return { match: 0, known: reviewed || mismatch ? 1 : 0, evidence: trait };
}

function scoreNormalized(product, slot, p, evidence) {
  const meta = metadataFor(product, evidence);
  const components = [];
  const add = (dimension, weight, preference, source = dimension) => {
    if (!knownAnswer(preference)) return;
    components.push({ dimension, weight, preference, ...traitMatch(meta, source, preference) });
  };
  const simplicity = p.simpleApplication || p.goals.includes('quick_easy') || (MAKEUP.has(slot) && ['new', 'basics'].includes(p.makeupSkill));
  if (SKIN.has(slot)) {
    add('daily_skin_feel', 35, p.skinFeel);
    const goals = p.goals.filter(goal => ['hydration_comfort', 'less_shine'].includes(goal));
    if (goals.length) {
      const goalDetails = goals.map(goal => ({ goal, ...traitMatch(meta, 'ordered_goals', goal) }));
      const weighted = key => goals.length === 1 ? goalDetails[0][key] : (2 * goalDetails[0][key] + goalDetails[1][key]) / 3;
      components.push({ dimension: 'ordered_goals', weight: 30, preference: goals, match: weighted('match'), known: weighted('known'), evidence: goalDetails.map(goal => goal.evidence), goalDetails });
    }
    add('texture', 20, p.texture);
    if (simplicity) add('application_simplicity', 15, 'simple');
  } else if (slot === 'base') {
    add('finish', 30, p.finish);
    add('coverage', 30, p.coverage);
    const prefs = [['wear', p.wear], ['texture', p.texture]].filter(([, value]) => knownAnswer(value));
    if (prefs.length) {
      const details = prefs.map(([dimension, preference]) => ({ dimension, preference, ...traitMatch(meta, dimension, preference) }));
      components.push({ dimension: 'wear_and_texture', weight: 25, preference: prefs.map(([, value]) => value), match: details.reduce((sum, x) => sum + x.match, 0) / details.length,
        known: details.reduce((sum, x) => sum + x.known, 0) / details.length, evidence: details.map(x => x.evidence), details });
    }
    if (simplicity) add('application_simplicity', 15, 'simple');
  } else if (slot === 'lip' || slot === 'cheek') {
    add('chosen_color_family', 35, p.colorFamily);
    add('finish', 30, p.finish);
    add('wear', 20, p.wear);
    if (simplicity) add('application_simplicity', 15, 'simple');
  } else if (slot === 'eyes') {
    add('chosen_effect', 35, p.eyeEffect);
    add('wear', 30, p.wear);
    add('format', 20, p.eyeFormat);
    if (simplicity) add('application_simplicity', 15, 'simple');
  }
  const denominator = components.reduce((sum, item) => sum + item.weight, 0);
  const raw = components.reduce((sum, item) => sum + item.weight * item.match, 0);
  const value = denominator ? 100 * raw / denominator : null;
  const metadataCoverage = denominator ? 100 * components.reduce((sum, item) => sum + item.weight * item.known, 0) / denominator : null;
  for (const component of components) {
    component.contribution = component.weight * component.match;
    component.fitPoints = denominator ? 100 * component.contribution / denominator : 0;
    component.reason = `You chose ${[].concat(component.preference).map(label).join(', ')}. ${component.known === 0 ? 'This product has no reviewed evidence for that preference' : component.match ? 'Reviewed product evidence supports this preference' : 'Reviewed product evidence does not match this preference'}; ${component.fitPoints.toFixed(1)} fit points.`;
  }
  const softRequirements = unique(p.preferredRequirements).filter(requirement => !p.mandatoryRequirements.includes(requirement)).map(requirement => ({ requirement, supported: meta.requirements?.[requirement] ?? null }));
  return { value, display: value === null ? 'Basic option' : value.toFixed(1), components, activeDimensions: components.map(item => item.dimension), denominator,
    metadataCoverage, softRequirementMatches: softRequirements.filter(item => item.supported === true).length, softRequirements,
    explanation: denominator ? 'Editorial fit for your active preferences; not a safety, efficacy or probability score.' : 'No active preferences: eligible basic options use verified soft requirements, then lower cost.' };
}

export function scoreProduct(product, slot, profile, evidence = {}) {
  return scoreNormalized(product, slot, normalizeProfile(profile), evidence);
}

function compareChoices(a, b) {
  return (b.score.value ?? 0) - (a.score.value ?? 0) || b.score.softRequirementMatches - a.score.softRequirementMatches || a.evaluation.priceCents - b.evaluation.priceCents || compareText(a.product.id, b.product.id);
}

function fulfilmentCompare(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] ? 1 : -1;
  return 0;
}

function betterKit(a, b) {
  if (!b) return true;
  const coverage = fulfilmentCompare(a.fulfilled, b.fulfilled);
  return coverage > 0 || (coverage === 0 && (a.utility > b.utility || (a.utility === b.utility &&
    (a.soft > b.soft || (a.soft === b.soft && (a.cost < b.cost || (a.cost === b.cost && compareText(a.ids, b.ids) < 0)))))));
}

function dependenciesSatisfied(items, owned) {
  const present = new Set([...owned, ...items.filter(item => item.product || item.owned).map(item => item.slot)]);
  return items.every(item => !item.product || item.evaluation.requiredSlots.every(slot => present.has(slot)));
}

/** Exhaustive depth-first optimization with safe lexicographic and budget pruning. */
function assemble(p, slots, candidates, removerCandidates, merchandiseLimit, cheapestOnly = false) {
  let best = null;
  const retained = p.ownedSlots.length;
  if (retained > p.itemCap) return null;
  const remainingMax = Array(slots.length + 1).fill(0);
  for (let i = slots.length - 1; i >= 0; i--) remainingMax[i] = remainingMax[i + 1] + Math.max(0, ...(candidates.get(slots[i]) ?? []).map(item => item.score.value ?? 0));
  const visit = (index, items, fulfilled, cost, count, utility, soft) => {
    if (cost > merchandiseLimit || count > p.itemCap) return;
    if (best && !cheapestOnly) {
      if (fulfilmentCompare(fulfilled, best.fulfilled.slice(0, index)) < 0) return;
      if (best.fulfilled.every(Boolean) && utility + remainingMax[index] < best.utility) return;
    }
    if (cheapestOnly && best && cost > best.cost) return;
    if (index === slots.length) {
      const owned = new Set(p.ownedSlots);
      const needsRemover = items.some(item => item.product && item.evaluation.requiredSlots.includes('remover')) && !owned.has('remover') && !items.some(item => item.slot === 'remover' && item.product);
      const additions = needsRemover && !slots.includes('remover') ? removerCandidates : [null];
      if (needsRemover && slots.includes('remover')) return;
      for (const addition of additions) {
        if (addition && items.some(item => item.product?.id === addition.product.id)) continue;
        const total = cost + (addition?.evaluation.priceCents ?? 0);
        const totalCount = count + (addition ? 1 : 0);
        const allItems = addition ? [...items, { ...addition, addedForRemoval: true }] : items;
        if (total > merchandiseLimit || totalCount > p.itemCap || !dependenciesSatisfied(allItems, owned)) continue;
        const result = { items: allItems.slice(), fulfilled: fulfilled.slice(), cost: total, count: totalCount, utility,
          soft: soft + (addition?.score.softRequirementMatches ?? 0), ids: allItems.filter(item => item.product).map(item => item.product.id).sort().join('|') };
        if (cheapestOnly ? !best || result.cost < best.cost || (result.cost === best.cost && compareText(result.ids, best.ids) < 0) : betterKit(result, best)) best = result;
      }
      return;
    }
    const slot = slots[index];
    if (p.ownedSlots.includes(slot)) {
      visit(index + 1, [...items, { slot, product: null, owned: true, evaluation: null, score: null }], [...fulfilled, true], cost, count, utility, soft);
      return;
    }
    for (const choice of candidates.get(slot) ?? []) {
      if (items.some(item => item.product?.id === choice.product.id)) continue;
      visit(index + 1, [...items, choice], [...fulfilled, true], cost + choice.evaluation.priceCents, count + 1, utility + (choice.score.value ?? 0), soft + choice.score.softRequirementMatches);
    }
    if (!cheapestOnly) visit(index + 1, [...items, { slot, product: null, owned: false, evaluation: null, score: null }], [...fulfilled, false], cost, count, utility, soft);
  };
  visit(0, [], [], 0, retained, 0, 0);
  return best;
}

export function buildKit(profile, products, evidence = {}) {
  const p = normalizeProfile(profile);
  const catalog = Array.isArray(products) ? products : products?.products ?? [];
  const slots = p.slots;
  const assemblyProfile = { ...p, [INTERNAL_ASSEMBLY]: true };
  const candidates = new Map();
  const allEvaluations = new Map();
  const pending = [];
  const excluded = [];
  const allSlots = unique([...slots, 'remover']);
  for (const slot of allSlots) {
    const evaluated = catalog.filter(product => (metadataFor(product, evidence).slots ?? []).includes(slot)).map(product => ({ slot, product, owned: false,
      evaluation: evaluateNormalized(product, slot, assemblyProfile, evidence), score: scoreNormalized(product, slot, p, evidence) })).sort(compareChoices);
    allEvaluations.set(slot, evaluated);
    candidates.set(slot, evaluated.filter(item => item.evaluation.state === 'eligible' && (!p.swaps[slot] || p.swaps[slot] === item.product.id)));
    if (slots.includes(slot) && !p.ownedSlots.includes(slot)) {
      for (const item of evaluated) {
        if (item.evaluation.state === 'needs_verification') pending.push({ ...item, reasons: item.evaluation.reasons });
        if (item.evaluation.state === 'excluded') excluded.push({ ...item, reasons: item.evaluation.reasons });
      }
    }
  }
  const limit = p.budgetCents === null ? Infinity : p.budgetCents - p.reserveCents;
  const result = assemble(p, slots, candidates, candidates.get('remover') ?? [], limit);
  // Re-run without the spending cap to report the actual lowest feasible full-kit cost.
  const unlimitedProfile = { ...assemblyProfile, budgetCents: null, reserveCents: 0 };
  const cheapestCandidates = new Map(allSlots.map(slot => [slot, (allEvaluations.get(slot) ?? []).map(item => ({ ...item, evaluation: evaluateNormalized(item.product, slot, unlimitedProfile, evidence) }))
    .filter(item => item.evaluation.state === 'eligible' && (!p.swaps[slot] || p.swaps[slot] === item.product.id)).sort((a, b) => a.evaluation.priceCents - b.evaluation.priceCents || compareText(a.product.id, b.product.id))]));
  const cheapest = assemble(p, slots, cheapestCandidates, cheapestCandidates.get('remover') ?? [], Infinity, true);
  const items = (result?.items ?? slots.map(slot => ({ slot, product: null, owned: p.ownedSlots.includes(slot), evaluation: null, score: null }))).map(item => {
    if (!item.product || !item.evaluation.requiredSlots.length) return item;
    return { ...item, evaluation: { ...item.evaluation, checks: item.evaluation.checks.map(check => check.id === 'F07' && check.state === 'pass'
      ? { ...check, reason: 'Verified application/removal steps are included or retained; whole-kit budget and item limits have been checked.' } : check) } };
  });
  const missing = items.filter(item => !item.product && !item.owned).map(item => {
    const options = allEvaluations.get(item.slot) ?? [];
    let reason;
    if (!SLOT_LABELS[item.slot]) reason = 'This requested slot is not supported by the current catalog.';
    else if (!options.length) reason = 'No catalog product has reviewed evidence for this slot.';
    else if (p.swaps[item.slot] && !(candidates.get(item.slot) ?? []).length) reason = 'Your selected replacement does not pass the required evidence and budget checks.';
    else if (options.every(option => option.evaluation.state !== 'eligible')) reason = unique(options.flatMap(option => option.evaluation.reasons)).join(' ');
    else if (result?.count >= p.itemCap || p.ownedSlots.length >= p.itemCap) reason = `The ${p.itemCap}-item routine limit leaves no room after higher-priority steps and removal dependencies.`;
    else reason = 'No combination can include this step after higher-priority slots while meeting the whole-kit budget, item limit and application/removal dependencies.';
    return { slot: item.slot, reason };
  });
  const notices = [];
  if (p.country !== 'United States') notices.push('This prototype has only United States market evidence. Change the shopping country or add verified regional product data.');
  if (p.budgetCents === null) notices.push('No budget selected: this is a catalog preview, with no claim that the kit fits your spending limit.');
  if (p.reactionHistory === 'unsure' || !['no', 'yes'].includes(p.reactionHistory) || (p.reactionHistory === 'yes' && !p.avoidedIngredients.length && !p.reactedProductIds.length)) notices.push('New products remain pending until the reaction-history answer is resolved. For a known reaction, add an ingredient to avoid or the exact product involved; notes alone cannot clear this check.');
  if (p.ownedSlots.length > p.itemCap) notices.push('Your retained items already exceed the routine item limit. Raise the limit or edit the retained steps.');
  if (cheapest && p.budgetCents !== null && cheapest.cost > limit) notices.push(`The cheapest verified full kit costs ${money(cheapest.cost)} before shipping and tax, above the available ${money(limit)} merchandise budget.`);
  if (items.some(item => item.addedForRemoval)) notices.push('A verified removal step was added and counted in the price and item limit.');
  const totalCents = result?.cost ?? 0;
  const status = missing.length || p.ownedSlots.length > p.itemCap ? 'partial_planning_kit' : 'planning_estimate';
  const costLabel = p.budgetCents === null ? 'Catalog preview · merchandise estimate · no budget selected' : p.reserveCents ? 'Planning estimate · merchandise subtotal with your shipping/tax reserve' : 'Merchandise-only planning estimate · shipping and tax not included';
  const answerProvenance = p.answerProvenance ?? Object.entries(p).filter(([field]) => !['answerProvenance', 'swaps'].includes(field)).map(([field, value]) => ({ field, value, source: 'submitted_profile', confirmed: true, updated_at: null, observation_id: null }));
  const audit = items.filter(item => item.product).map(item => ({
    rules_version: '0.1', catalog_snapshot: item.product.researched_on ?? null, confirmed_profile: p,
    product_id: item.product.id, exact_variant: { market: item.product.market, size: item.product.size, shade: item.evaluation.exactShade, currency: item.product.currency ?? 'USD' },
    slot: item.slot, eligibility_state: item.evaluation.state, fit_score: item.score.value, active_dimensions: item.score.activeDimensions,
    active_weight_denominator: item.score.denominator, score_components: item.score.components, metadata_coverage: item.score.metadataCoverage,
    reason_rule_ids: unique(item.evaluation.checks.map(check => check.id)), answer_provenance: answerProvenance,
    product_evidence: metadataFor(item.product, evidence), purchase_cost_cents: item.evaluation.priceCents, kit_status: status,
    pending_checks: PRICE_CHECKS.slice(), alternative_and_tradeoff: (candidates.get(item.slot) ?? []).filter(other => other.product.id !== item.product.id).slice(0, 3).map(other => ({
      product_id: other.product.id, price_change_cents: other.evaluation.priceCents - item.evaluation.priceCents,
      fit_score_change: item.score.value === null || other.score.value === null ? null : other.score.value - item.score.value,
      note: 'Alternative requires a full-kit budget, dependency and item-limit recheck.',
    })),
  }));
  return { items, missing, pending, excluded, totalCents, budgetCents: p.budgetCents,
    remainingCents: p.budgetCents === null ? null : p.budgetCents - p.reserveCents - totalCents,
    reserveCents: p.reserveCents, status, costLabel, cheapestRequiredCents: cheapest?.cost ?? null,
    itemCount: result?.count ?? p.ownedSlots.length, notices, audit, purchaseReady: false, pendingChecks: PRICE_CHECKS.slice(), profile: p };
}
