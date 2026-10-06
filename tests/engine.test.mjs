import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildKit, defaultProfile, evaluateProduct, scoreProduct, money } from '../web/engine.js';

const trait = (values, knownValues = values) => ({ values, knownValues, basis: 'reviewed editorial inference', url: 'https://example.com/review', date: '2026-10-05' });
const product = (id, cents = 1000, extra = {}) => ({ id, brand: 'Test', product_name: id, price_usd: cents / 100, currency: 'USD', market: 'United States', size: '50 ml', researched_on: '2026-10-05', key_ingredients: [], ...extra });
const meta = (slots = ['moisturizer'], extra = {}) => ({ slots, identityVerified: true, traits: {}, requirements: {}, completeInci: false, aliasesReviewed: false, ingredients: [], removal: 'none', ...extra });
const profile = extra => ({ ...defaultProfile(), slots: ['moisturizer'], budgetCents: 5000, itemCap: 5, ...extra });
const chosen = kit => kit.items.filter(item => item.product).map(item => item.product.id);

test('all applicable checks pass or skip gives eligible; empty preferences give a null score', () => {
  const p = product('a'); const evidence = { a: meta() };
  assert.equal(evaluateProduct(p, 'moisturizer', profile({}), evidence).state, 'eligible');
  const score = scoreProduct(p, 'moisturizer', profile({}), evidence);
  assert.equal(score.value, null); assert.equal(score.denominator, 0); assert.equal(score.metadataCoverage, null);
});

test('basic selection is lower cost and then stable ID, independent of catalog order', () => {
  const products = [product('c', 1100), product('b', 1000), product('a', 1000)];
  const evidence = Object.fromEntries(products.map(p => [p.id, meta()]));
  assert.deepEqual(chosen(buildKit(profile({}), products, evidence)), ['a']);
  assert.deepEqual(chosen(buildKit(profile({}), products.toReversed(), evidence)), ['a']);
});

test('a single active dimension exposes denominator and evidence coverage', () => {
  const p = product('a'); const evidence = { a: meta(['moisturizer'], { traits: { texture: trait(['lightweight']) } }) };
  const score = scoreProduct(p, 'moisturizer', profile({ texture: 'lightweight' }), evidence);
  assert.equal(score.value, 100); assert.equal(score.denominator, 20); assert.equal(score.metadataCoverage, 100);
  assert.deepEqual(score.activeDimensions, ['texture']); assert.equal(score.components[0].fitPoints, 100);
});

test('unknown product metadata keeps active weight and receives zero score and coverage', () => {
  const p = product('a'); const score = scoreProduct(p, 'moisturizer', profile({ texture: 'lightweight' }), { a: meta() });
  assert.equal(score.value, 0); assert.equal(score.denominator, 20); assert.equal(score.metadataCoverage, 0);
});

test('a skipped texture preference removes the weight for every candidate', () => {
  const p = product('a'); const evidence = { a: meta(['moisturizer'], { traits: { texture: trait(['lightweight']), daily_skin_feel: trait(['dry_tight']) } }) };
  assert.equal(scoreProduct(p, 'moisturizer', profile({ texture: 'unknown', skinFeel: 'dry_tight' }), evidence).denominator, 35);
});

test('unreviewed prose and incomplete trait records cannot award points', () => {
  const p = product('a', 1000, { ideal_customers: 'Rich hydration for dry skin', intended_benefit: 'Lightweight' });
  const evidence = { a: meta(['moisturizer'], { traits: { texture: { values: ['lightweight'] } } }) };
  assert.equal(scoreProduct(p, 'moisturizer', profile({ texture: 'lightweight' }), evidence).value, 0);
});

test('ordered goals are deduplicated, weighted 2:1, and knownness uses the same weights', () => {
  const p = product('a'); const evidence = { a: meta(['moisturizer'], { traits: { ordered_goals: trait(['hydration_comfort']) } }) };
  const one = scoreProduct(p, 'moisturizer', profile({ goals: ['hydration_comfort', 'hydration_comfort'] }), evidence);
  assert.equal(one.value, 100);
  const two = scoreProduct(p, 'moisturizer', profile({ goals: ['hydration_comfort', 'less_shine'] }), evidence);
  assert.ok(Math.abs(two.value - 200 / 3) < 1e-10);
  assert.ok(Math.abs(two.metadataCoverage - 200 / 3) < 1e-10);
});

test('routine time alone does not award ease; quick_easy is not counted as an ordered goal', () => {
  const p = product('a'); const evidence = { a: meta(['moisturizer'], { traits: { application_simplicity: trait(['simple']) } }) };
  assert.equal(scoreProduct(p, 'moisturizer', profile({ routineTime: '3_minutes' }), evidence).value, null);
  const score = scoreProduct(p, 'moisturizer', profile({ goals: ['quick_easy'] }), evidence);
  assert.equal(score.denominator, 15); assert.deepEqual(score.activeDimensions, ['application_simplicity']);
});

test('selfie metadata, including unconfirmed color and shiny skin, has no effect', () => {
  const p = product('a'); const evidence = { a: meta(['moisturizer'], { traits: { daily_skin_feel: trait(['dry_tight']) } }) };
  const plain = scoreProduct(p, 'moisturizer', profile({ skinFeel: 'dry_tight' }), evidence);
  const photo = scoreProduct(p, 'moisturizer', profile({ skinFeel: 'dry_tight', selfie: { skinFeel: 'oily_shiny', confirmed: false }, observedGoals: ['less_shine'] }), evidence);
  assert.deepEqual(plain, photo);
});

test('known ingredient presence in evidence notes excludes, while missing key ingredient does not clear', () => {
  const p = product('a', 1000, { evidence_notes: 'The selected shade contains fragrance and denatured alcohol.' });
  const evidence = { a: meta() };
  assert.equal(evaluateProduct(p, 'moisturizer', profile({ avoidedIngredients: ['parfum'] }), evidence).state, 'excluded');
  assert.equal(evaluateProduct(p, 'moisturizer', profile({ avoidedIngredients: ['niacinamide'] }), evidence).state, 'needs_verification');
});

test('an explicit absence sentence does not become false ingredient presence', () => {
  const p = product('a', 1000, { evidence_notes: 'The full ingredients do not contain fragrance.' });
  assert.equal(evaluateProduct(p, 'moisturizer', profile({ avoidedIngredients: ['fragrance'] }), { a: meta() }).state, 'needs_verification');
});

test('ingredient absence needs both complete formula and reviewed aliases', () => {
  const p = product('a'); const input = profile({ avoidedIngredients: ['niacinamide'] });
  assert.equal(evaluateProduct(p, 'moisturizer', input, { a: meta(['moisturizer'], { completeInci: true }) }).state, 'needs_verification');
  assert.equal(evaluateProduct(p, 'moisturizer', input, { a: meta(['moisturizer'], { completeInci: true, aliasesReviewed: true }) }).state, 'eligible');
});

test('prior exact product reaction excludes even if all other requirements pass', () => {
  const p = product('a'); assert.equal(evaluateProduct(p, 'moisturizer', profile({ reactedProductIds: ['a'] }), { a: meta() }).state, 'excluded');
});

test('uncertain, unanswered and unexplained reaction history keeps all new choices pending', () => {
  const p = product('a'); const evidence = { a: meta() };
  for (const reactionHistory of ['unsure', '', 'yes']) {
    const input = profile({ reactionHistory });
    assert.equal(evaluateProduct(p, 'moisturizer', input, evidence).state, 'needs_verification');
    const kit = buildKit(input, [p], evidence);
    assert.equal(kit.status, 'partial_planning_kit'); assert.equal(kit.totalCents, 0);
    assert.equal(kit.pending.length, 1); assert.equal(kit.missing.length, 1);
  }
});

test('free-text reaction notes alone do not resolve a yes answer', () => {
  const p = product('a'); const input = profile({ reactionHistory: 'yes', reactionNotes: 'My old moisturizer caused stinging.' });
  assert.equal(evaluateProduct(p, 'moisturizer', input, { a: meta() }).state, 'needs_verification');
});

test('known reaction details allow unrelated candidates while the exact reacted product stays excluded', () => {
  const products = [product('a'), product('reacted')]; const evidence = { a: meta(), reacted: meta() };
  const input = profile({ reactionHistory: 'yes', reactedProductIds: ['reacted'] });
  assert.equal(evaluateProduct(products[0], 'moisturizer', input, evidence).state, 'eligible');
  assert.equal(evaluateProduct(products[1], 'moisturizer', input, evidence).state, 'excluded');
  assert.deepEqual(chosen(buildKit(input, products, evidence)), ['a']);
  assert.equal(evaluateProduct(products[1], 'moisturizer', { ...input, reactionHistory: 'unsure' }, evidence).state, 'excluded');
  assert.equal(evaluateProduct(products[0], 'moisturizer', { ...input, reactionHistory: 'unsure' }, evidence).state, 'needs_verification');
});

test('a known ingredient resolves reaction details but still requires formula clearance', () => {
  const p = product('a'); const input = profile({ reactionHistory: 'yes', avoidedIngredients: ['fragrance'] });
  assert.equal(evaluateProduct(p, 'moisturizer', input, { a: meta() }).state, 'needs_verification');
  assert.equal(evaluateProduct(p, 'moisturizer', input, { a: meta(['moisturizer'], { completeInci: true, aliasesReviewed: true }) }).state, 'eligible');
});

test('retained items are not new-purchase recommendations and are kept with unresolved reaction history', () => {
  const kit = buildKit(profile({ reactionHistory: 'unsure', ownedSlots: ['moisturizer'] }), [product('a')], { a: meta() });
  assert.equal(kit.totalCents, 0); assert.equal(kit.items[0].owned, true); assert.deepEqual(chosen(kit), []);
});

test('exfoliating or retinoid products require an explicit product choice independently of identity evidence', () => {
  const p = product('active'); const evidence = { active: meta(['moisturizer'], { requiresExplicitRequest: true }) };
  assert.equal(evaluateProduct(p, 'moisturizer', profile({}), evidence).state, 'needs_verification');
  assert.equal(buildKit(profile({}), [p], evidence).missing.length, 1);
  const selected = profile({ swaps: { moisturizer: 'active' } });
  assert.equal(evaluateProduct(p, 'moisturizer', selected, evidence).state, 'eligible');
  assert.deepEqual(chosen(buildKit(selected, [p], evidence)), ['active']);
  evidence.active.identityVerified = false;
  assert.equal(evaluateProduct(p, 'moisturizer', selected, evidence).state, 'needs_verification');
});

test('mandatory false excludes and mandatory unknown stays pending', () => {
  const p = product('a'); const input = profile({ mandatoryRequirements: ['fragrance_free'] });
  assert.equal(evaluateProduct(p, 'moisturizer', input, { a: meta(['moisturizer'], { requirements: { fragrance_free: false } }) }).state, 'excluded');
  assert.equal(evaluateProduct(p, 'moisturizer', input, { a: meta() }).state, 'needs_verification');
});

test('soft requirements only break fit ties and cannot create fit points', () => {
  const products = [product('cheap', 1000), product('vegan', 1200)];
  const evidence = { cheap: meta(), vegan: meta(['moisturizer'], { requirements: { vegan: true } }) };
  const kit = buildKit(profile({ preferredRequirements: ['vegan', 'vegan'] }), products, evidence);
  assert.deepEqual(chosen(kit), ['vegan']); assert.equal(kit.items[0].score.value, null); assert.equal(kit.items[0].score.softRequirementMatches, 1);
});

test('owned steps incur zero cost, occupy a routine item and prevent duplicates', () => {
  const products = [product('a')]; const evidence = { a: meta() };
  const kit = buildKit(profile({ ownedSlots: ['moisturizer'], itemCap: 1, budgetCents: 0 }), products, evidence);
  assert.equal(kit.totalCents, 0); assert.equal(kit.itemCount, 1); assert.equal(kit.items[0].owned, true); assert.deepEqual(chosen(kit), []);
});

test('exact cent boundary is permitted, one cent above produces a partial kit and minimum cost', () => {
  const p = product('a', 999); const evidence = { a: meta() };
  assert.equal(buildKit(profile({ budgetCents: 999 }), [p], evidence).status, 'planning_estimate');
  const kit = buildKit(profile({ budgetCents: 998 }), [p], evidence);
  assert.equal(kit.status, 'partial_planning_kit'); assert.equal(kit.totalCents, 0); assert.equal(kit.cheapestRequiredCents, 999);
});

test('whole-kit optimizer picks the best feasible combination, not independent slot winners', () => {
  const products = [product('cleanser-best', 2000), product('cleanser-basic', 1000), product('cream-best', 2000), product('cream-basic', 1000)];
  const evidence = {
    'cleanser-best': meta(['cleanser'], { traits: { texture: trait(['lightweight']) } }),
    'cleanser-basic': meta(['cleanser']),
    'cream-best': meta(['moisturizer'], { traits: { texture: trait(['lightweight']), daily_skin_feel: trait(['dry_tight']) } }),
    'cream-basic': meta(['moisturizer']),
  };
  const kit = buildKit(profile({ slots: ['cleanser', 'moisturizer'], budgetCents: 3000, texture: 'lightweight', skinFeel: 'dry_tight' }), products, evidence);
  assert.deepEqual(chosen(kit), ['cleanser-basic', 'cream-best']); assert.equal(kit.totalCents, 3000); assert.equal(kit.cheapestRequiredCents, 2000);
});

test('partial-kit priorities are lexicographic and every unfilled slot is returned', () => {
  const products = [product('a', 2000), product('b', 1000), product('c', 1000)];
  const evidence = { a: meta(['cleanser']), b: meta(['moisturizer']), c: meta(['toner']) };
  const kit = buildKit(profile({ slots: ['cleanser', 'moisturizer', 'toner'], budgetCents: 2000 }), products, evidence);
  assert.deepEqual(chosen(kit), ['a']); assert.deepEqual(kit.missing.map(item => item.slot), ['moisturizer', 'toner']);
  assert.equal(kit.cheapestRequiredCents, 4000);
});

test('routine cap is enforced even when there is no spending limit', () => {
  const products = [product('a'), product('b')]; const evidence = { a: meta(['cleanser']), b: meta(['moisturizer']) };
  const kit = buildKit(profile({ slots: ['cleanser', 'moisturizer'], budgetCents: null, itemCap: 1 }), products, evidence);
  assert.deepEqual(chosen(kit), ['a']); assert.equal(kit.itemCount, 1); assert.equal(kit.missing.length, 1); assert.equal(kit.cheapestRequiredCents, null);
});

test('base products stay pending without exact shade confirmation; arbitrary true cannot clear it', () => {
  const p = product('base'); const evidence = { base: meta(['base'], { exactShade: '21N Ivory' }) };
  assert.equal(evaluateProduct(p, 'base', profile({}), evidence).state, 'needs_verification');
  assert.equal(evaluateProduct(p, 'base', profile({ selectedShades: { base: true } }), evidence).state, 'excluded');
  assert.equal(evaluateProduct(p, 'base', profile({ selectedShades: { base: '21N Ivory' } }), evidence).state, 'eligible');
  evidence.base.supportedShades = ['21N Ivory', '23N Sand'];
  assert.equal(evaluateProduct(p, 'base', profile({ selectedShades: { base: '23N Sand' } }), evidence).state, 'excluded');
});

test('daytime sunscreen requires verified broad-spectrum SPF30 or greater', () => {
  const p = product('s'); const input = profile({});
  assert.equal(evaluateProduct(p, 'daytime_sunscreen', input, { s: meta(['daytime_sunscreen']) }).state, 'needs_verification');
  assert.equal(evaluateProduct(p, 'daytime_sunscreen', input, { s: meta(['daytime_sunscreen'], { broadSpectrumSPF: 20 }) }).state, 'excluded');
  assert.equal(evaluateProduct(p, 'daytime_sunscreen', input, { s: meta(['daytime_sunscreen'], { broadSpectrumSPF: 30 }) }).state, 'eligible');
  assert.equal(evaluateProduct(p, 'daytime_sunscreen', input, { s: meta(['daytime_sunscreen'], { broadSpectrumSPF: NaN }) }).state, 'needs_verification');
});

test('unknown product-specific removal remains pending despite an owned remover', () => {
  const p = product('lip'); const evidence = { lip: meta(['lip'], { removal: 'unknown' }) };
  const kit = buildKit(profile({ slots: ['lip'], ownedSlots: ['remover'] }), [p], evidence);
  assert.equal(kit.items[0].product, null); assert.equal(kit.pending.length, 1); assert.equal(kit.pending[0].evaluation.state, 'needs_verification');
});

test('verified remover dependency is automatically added within whole-kit budget and cap', () => {
  const products = [product('lip', 1200), product('remover', 800)];
  const evidence = { lip: meta(['lip'], { removal: 'remover' }), remover: meta(['remover']) };
  const kit = buildKit(profile({ slots: ['lip'], budgetCents: 2000, itemCap: 2 }), products, evidence);
  assert.deepEqual(chosen(kit), ['lip', 'remover']); assert.equal(kit.totalCents, 2000); assert.equal(kit.itemCount, 2); assert.equal(kit.items[1].addedForRemoval, true);
  assert.equal(buildKit(profile({ slots: ['lip'], budgetCents: 1999, itemCap: 2 }), products, evidence).missing.length, 1);
  assert.equal(buildKit(profile({ slots: ['lip'], budgetCents: 2000, itemCap: 1 }), products, evidence).missing.length, 1);
});

test('double-cleanse dependency cannot be silently omitted from an added remover', () => {
  const products = [product('lip', 1000), product('remover', 500), product('cleanser', 500)];
  const evidence = { lip: meta(['lip'], { removal: 'remover' }), remover: meta(['remover'], { requiredSlots: ['cleanser'] }), cleanser: meta(['cleanser']) };
  assert.equal(buildKit(profile({ slots: ['lip'], itemCap: 3 }), products, evidence).missing.length, 1);
  const kit = buildKit(profile({ slots: ['lip', 'cleanser'], itemCap: 3, budgetCents: 2000 }), products, evidence);
  assert.deepEqual(chosen(kit), ['lip', 'cleanser', 'remover']); assert.equal(kit.totalCents, 2000);
});

test('every swap rechecks whole-kit budget and cannot retain an impossible requested product', () => {
  const products = [product('cheap', 1000), product('expensive', 2000), product('cleanser', 1000)];
  const evidence = { cheap: meta(), expensive: meta(), cleanser: meta(['cleanser']) };
  const input = profile({ slots: ['cleanser', 'moisturizer'], budgetCents: 2000, swaps: { moisturizer: 'expensive' } });
  const kit = buildKit(input, products, evidence);
  assert.deepEqual(chosen(kit), ['cleanser']); assert.equal(kit.status, 'partial_planning_kit'); assert.equal(kit.missing[0].slot, 'moisturizer');
});

test('negative, fractional or excessive reserves and unsupported currency are rejected', () => {
  for (const change of [{ reserveCents: -1 }, { reserveCents: 5001 }, { budgetCents: 1.5 }, { reserveCents: Infinity }, { currency: 'CAD' }]) {
    assert.throws(() => buildKit(profile(change), [], {}), RangeError);
  }
});

test('reserve is deducted from merchandise cap and remaining cents', () => {
  const kit = buildKit(profile({ budgetCents: 1200, reserveCents: 200 }), [product('a', 1000)], { a: meta() });
  assert.equal(kit.totalCents, 1000); assert.equal(kit.remainingCents, 0); assert.equal(kit.reserveCents, 200);
});

test('unsupported markets do not fill new-purchase slots and exact identity unknown is pending', () => {
  const p = product('a');
  assert.equal(evaluateProduct(p, 'moisturizer', profile({ country: 'Canada' }), { a: meta() }).state, 'excluded');
  assert.equal(evaluateProduct(p, 'moisturizer', profile({}), { a: meta(['moisturizer'], { identityVerified: false }) }).state, 'needs_verification');
});

test('planning records are auditable and never claim purchase readiness', () => {
  const kit = buildKit(profile({}), [product('a')], { a: meta() });
  assert.equal(kit.purchaseReady, false); assert.equal(kit.status, 'planning_estimate'); assert.ok(kit.pendingChecks.some(check => check.includes('stock')));
  const record = kit.audit[0];
  for (const field of ['rules_version', 'catalog_snapshot', 'confirmed_profile', 'product_id', 'exact_variant', 'slot', 'eligibility_state', 'fit_score', 'active_dimensions', 'active_weight_denominator', 'score_components', 'metadata_coverage', 'reason_rule_ids', 'answer_provenance', 'product_evidence', 'purchase_cost_cents', 'kit_status', 'pending_checks', 'alternative_and_tradeoff']) assert.ok(field in record, field);
  assert.equal(money(1099), '$10.99');
});

test('reviewed 56-product catalog produces repeatable safe skincare planning and preserves makeup gaps', async () => {
  const catalog = JSON.parse(await readFile(new URL('../outputs/01a10dc6-c4fa-7151-8ca8-26510505dbce/korean-cosmetics-catalog.json', import.meta.url)));
  const evidence = JSON.parse(await readFile(new URL('../web/data/evidence.json', import.meta.url)));
  const input = profile({ slots: ['cleanser', 'moisturizer', 'daytime_sunscreen'], budgetCents: 6000, itemCap: 3, skinFeel: 'dry_tight', goals: ['hydration_comfort'] });
  const kit = buildKit(input, catalog.products, evidence);
  assert.equal(kit.status, 'planning_estimate'); assert.equal(kit.items.length, 3); assert.ok(kit.totalCents <= 6000);
  assert.deepEqual(chosen(kit), chosen(buildKit(input, catalog.products.toReversed(), evidence)));
  const makeup = buildKit(profile({ slots: ['lip', 'base'], selectedShades: { 'kbeauty-043': '21N Ivory' } }), catalog.products, evidence);
  assert.equal(makeup.status, 'partial_planning_kit'); assert.equal(makeup.missing.length, 2); assert.ok(makeup.pending.some(item => item.product.id === 'kbeauty-043'));
  const avoided = buildKit({ ...input, avoidedIngredients: ['niacinamide'] }, catalog.products, evidence);
  assert.equal(chosen(avoided).length, 0); assert.equal(avoided.missing.length, 3);
  const retinoid = catalog.products.find(product => product.id === 'kbeauty-042');
  const futureVerifiedEvidence = { ...evidence, [retinoid.id]: { ...evidence[retinoid.id], identityVerified: true } };
  assert.equal(futureVerifiedEvidence[retinoid.id].requiresExplicitRequest, true);
  const retinoidEvaluation = evaluateProduct(retinoid, 'moisturizer', input, futureVerifiedEvidence);
  assert.equal(retinoidEvaluation.state, 'needs_verification');
  assert.ok(retinoidEvaluation.checks.some(check => check.id === 'OPT_IN' && check.state === 'unknown'));
});
