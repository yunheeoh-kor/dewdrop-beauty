import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { defaultProfile } from '../web/engine.js';
import { createInstantProfile, getInstantRecommendations } from '../web/instant.js';

const product = (id, cents = 1000, extra = {}) => ({ id, product_name: id, price_cents: cents,
  currency: 'USD', market: 'United States', size: '50 ml', key_ingredients: [], ...extra });
const meta = (slots = ['moisturizer'], extra = {}) => ({ slots, identityVerified: true,
  removal: 'none', traits: {}, requirements: {}, ...extra });
const trait = values => ({ values, knownValues: ['hydration_comfort', 'less_shine'],
  url: 'https://example.com/review', date: '2026-10-05', basis: 'reviewed editorial inference' });
const profile = extra => ({ ...createInstantProfile(), slots: ['moisturizer'], ...extra });

test('a fresh selfie preview assumes no budget, goals, skin feel or reaction answer', () => {
  const fresh = createInstantProfile();
  assert.deepEqual(fresh.slots, ['cleanser', 'moisturizer', 'daytime_sunscreen']);
  assert.equal(fresh.budgetCents, null);
  assert.deepEqual(fresh.goals, []);
  assert.equal(fresh.skinFeel, 'unknown');
  assert.equal(fresh.reactionHistory, 'unknown');
  assert.deepEqual(fresh.answerProvenance, []);
  const products = fresh.slots.map(slot => product(slot));
  const evidence = Object.fromEntries(fresh.slots.map(slot => [slot, meta([slot], { broadSpectrumSPF: 50 })]));
  const result = getInstantRecommendations(fresh, products, evidence);
  assert.equal(result.cards.length, 3);
  assert.ok(result.cards.every(card => card.state === 'needs_verification' && card.score.value === null));
  assert.ok(result.cards.every(card => card.reasons.some(reason => reason.includes('reaction history'))));
  assert.equal(result.kit.totalCents, 0);
  assert.equal(result.kit.itemCount, 0);
  assert.equal(result.kit.purchaseReady, false);
  assert.equal(result.kit.status, 'partial_planning_kit');
  assert.deepEqual(result.kit.audit, []);
});

test('partial caller profiles cannot implicitly confirm reaction history', () => {
  const result = getInstantRecommendations({ slots: ['moisturizer'] }, [product('cream')], { cream: meta() });
  assert.equal(result.kit.profile.reactionHistory, 'unknown');
  assert.equal(result.cards[0].state, 'needs_verification');
  assert.equal(result.kit.totalCents, 0);
});

test('a confirmed saved profile and all nested preferences are preserved without shared references', () => {
  const saved = { ...defaultProfile(), budgetCents: 5000, reserveCents: 500,
    reactionHistory: 'yes', reactedProductIds: ['bad'], avoidedIngredients: ['fragrance'],
    ownedSlots: ['cleanser'], goals: ['hydration_comfort'], mandatoryRequirements: ['vegan'],
    preferredRequirements: ['fragrance_free'], swaps: { moisturizer: 'cream' },
    selectedShades: { base: '21N' }, confirmedAt: '2026-10-05',
    answerProvenance: [{ field: 'goals', value: ['hydration_comfort'], confirmed: true }] };
  const restored = createInstantProfile(saved);
  assert.deepEqual(restored, saved);
  restored.goals.push('less_shine');
  restored.swaps.moisturizer = 'other';
  restored.answerProvenance[0].value.push('less_shine');
  assert.deepEqual(saved.goals, ['hydration_comfort']);
  assert.equal(saved.swaps.moisturizer, 'cream');
  assert.deepEqual(saved.answerProvenance[0].value, ['hydration_comfort']);
});

test('confirmed profiles use assembled eligible products and preserve owned steps and swaps', () => {
  const input = createInstantProfile({ ...defaultProfile(), slots: ['cleanser', 'moisturizer'],
    ownedSlots: ['cleanser'], swaps: { moisturizer: 'chosen' } });
  const products = [product('cheap', 500), product('chosen', 1500)];
  const result = getInstantRecommendations(input, products, { cheap: meta(), chosen: meta() });
  assert.equal(result.cards[0].state, 'owned');
  assert.equal(result.cards[0].product, null);
  assert.equal(result.cards[1].product.id, 'chosen');
  assert.equal(result.cards[1].state, 'eligible');
  assert.equal(result.kit.totalCents, 1500);
});

test('budget, reserve, country and formula exclusions apply to previews unchanged', () => {
  const products = [product('allowed', 1000), product('expensive', 5000),
    product('reacted', 500), product('fragrance', 400, { key_ingredients: ['parfum'] })];
  const evidence = Object.fromEntries(products.map(item => [item.id, meta()]));
  const input = profile({ budgetCents: 1200, reserveCents: 200,
    avoidedIngredients: ['fragrance'], reactedProductIds: ['reacted'] });
  const result = getInstantRecommendations(input, products, evidence);
  assert.deepEqual(result.cards.map(card => card.product.id), ['allowed']);
  assert.equal(result.cards[0].state, 'needs_verification');
  assert.equal(result.kit.totalCents, 0);
  assert.deepEqual(getInstantRecommendations({ ...input, budgetCents: 1199 }, products, evidence).cards, []);
  assert.deepEqual(getInstantRecommendations({ ...input, country: 'Canada' }, products, evidence).cards, []);
});

test('quick goal edits rerank reviewed candidates without converting previews to eligible products', () => {
  const products = [product('comfort', 1200), product('shine', 1000)];
  const evidence = { comfort: meta(['moisturizer'], { traits: { ordered_goals: trait(['hydration_comfort']) } }),
    shine: meta(['moisturizer'], { traits: { ordered_goals: trait(['less_shine']) } }) };
  const basic = getInstantRecommendations(profile({}), products, evidence);
  assert.equal(basic.cards[0].product.id, 'shine');
  assert.equal(basic.cards[0].score.value, null);
  const comfort = getInstantRecommendations(profile({ goals: ['hydration_comfort'] }), products, evidence);
  assert.equal(comfort.cards[0].product.id, 'comfort');
  assert.equal(comfort.cards[0].score.value, 100);
  const shine = getInstantRecommendations(profile({ goals: ['less_shine'] }), products, evidence);
  assert.equal(shine.cards[0].product.id, 'shine');
  assert.equal(shine.cards[0].score.value, 100);
  assert.equal(shine.cards[0].state, 'needs_verification');
});

test('whole-kit budget and cap gaps never become eligible standalone recommendations', () => {
  const products = [product('cleanser', 1000), product('cream', 1000), product('pending', 500)];
  const evidence = { cleanser: meta(['cleanser']), cream: meta(), pending: meta(['moisturizer'], { identityVerified: false }) };
  const input = profile({ slots: ['cleanser', 'moisturizer'], reactionHistory: 'no', budgetCents: 1500 });
  const budgetResult = getInstantRecommendations(input, products, evidence);
  assert.deepEqual(budgetResult.cards.map(card => card.product.id), ['cleanser']);
  assert.equal(budgetResult.kit.totalCents, 1000);
  assert.equal(budgetResult.kit.missing[0].slot, 'moisturizer');
  assert.deepEqual(getInstantRecommendations({ ...input, budgetCents: null, itemCap: 1 }, products, evidence).cards.map(card => card.product.id), ['cleanser']);
});

test('pending previews respect the combined budget and routine cap without changing kit totals', () => {
  const products = [product('cleanser', 1000), product('cream', 1000)];
  const evidence = { cleanser: meta(['cleanser']), cream: meta() };
  const input = profile({ slots: ['cleanser', 'moisturizer'], budgetCents: 1500 });
  for (const change of [{}, { budgetCents: null, itemCap: 1 }]) {
    const result = getInstantRecommendations({ ...input, ...change }, products, evidence);
    assert.equal(result.cards.length, 1);
    assert.equal(result.cards[0].state, 'needs_verification');
    assert.equal(result.kit.totalCents, 0);
  }
});

test('preview swaps and missing dependency budget failures are not silently bypassed', () => {
  const products = [product('cheap', 500), product('chosen', 1000)];
  const evidence = { cheap: meta(), chosen: meta() };
  assert.equal(getInstantRecommendations(profile({ swaps: { moisturizer: 'chosen' } }), products, evidence).cards[0].product.id, 'chosen');
  assert.deepEqual(getInstantRecommendations(profile({ swaps: { moisturizer: 'chosen' }, budgetCents: 800 }), products, evidence).cards, []);
  const removalProducts = [product('lip', 1000), product('remover', 500)];
  const removalEvidence = { lip: meta(['lip'], { removal: 'remover' }), remover: meta(['remover']) };
  const result = getInstantRecommendations(profile({ slots: ['lip'], reactionHistory: 'no', budgetCents: 1200 }), removalProducts, removalEvidence);
  assert.deepEqual(result.cards, []);
  assert.equal(result.kit.missing.length, 1);
});

test('invalid profile constraints return an explicit error with no replacement recommendations', () => {
  for (const changes of [{ budgetCents: -1 }, { budgetCents: Infinity }, { budgetCents: NaN }, { itemCap: -1 }, { currency: 'CAD' }, { slots: null }]) {
    const result = getInstantRecommendations(profile(changes), [product('cream')], { cream: meta() });
    assert.equal(result.kit, null);
    assert.deepEqual(result.cards, []);
    assert.ok(result.error);
  }
});

test('the reviewed catalog yields immediate pending starter cards without photo analysis', async () => {
  const catalog = JSON.parse(await readFile(new URL('../web/data/catalog.json', import.meta.url)));
  const evidence = JSON.parse(await readFile(new URL('../web/data/evidence.json', import.meta.url)));
  const plain = getInstantRecommendations(createInstantProfile(), catalog, evidence);
  assert.equal(plain.cards.length, 3);
  assert.ok(plain.cards.every(card => card.state === 'needs_verification'));
  assert.deepEqual(plain.cards, getInstantRecommendations({ ...createInstantProfile(),
    selfie: { skinFeel: 'oily_shiny', inferredGoals: ['less_shine'] } }, catalog, evidence).cards);
});
