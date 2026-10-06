import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyStyleGuide, guideProducts, findGuide } from '../web/style-guides.js';
import { defaultProfile } from '../web/engine.js';
import { filterLooks, relatedProducts } from '../web/beauty-library.js';
import { getFaceRecommendations } from '../web/face-recommendations.js';
import { renderFaceStudio } from '../web/face-studio.js';

const profile = extra => ({ ...defaultProfile(), slots: [], reactionHistory: 'unknown', itemCap: 8, ...extra });
const product = (id, category = 'eyeliner', cents = 1000) => ({ id, brand: 'Test', product_name: id, makeup_category: category, size: '3 g', price_usd: cents / 100, currency: 'USD', market: 'United States', key_ingredients: [] });
const trait = values => ({ values, knownValues: values, url: 'https://example.com/product', date: '2026-10-05', basis: 'brand fact' });
const metadata = (format = 'pencil', extra = {}) => ({ slots: ['eyes'], identityVerified: true, identityEvidence: { url: 'https://example.com/product', date: '2026-10-05' }, completeInci: false, aliasesReviewed: false, removal: 'unknown', requirements: {}, ingredients: [], traits: { format: trait([format]), chosen_effect: trait(['definition']) }, ...extra });
const region = (id, extra = {}) => ({ id, kind: id.startsWith('skin_') ? 'skincare' : 'makeup', label: id, observations: ['A measured feature.'], measurements: { placement: 'elongated', level: 'pronounced' }, quality: { usable: true }, ...extra });
const analyze = (...regions) => ({ status: 'ready', regions });
const cards = (result, id = 'eyes') => result.regions.find(region => region.id === id).cards.map(card => card.product.id);
const guides = { makeup: [
  { id: 'soft_smoky', title: 'Soft smoky', profilePatch: { eyeEffect: 'definition', finish: 'matte' }, selections: [{ productId: 'smoky' }], regionDirections: { eyes: { title: 'Diffused smoky eye', steps: ['Diffuse the liner edge.'] } } },
  { id: 'stage_definition', title: 'Stage definition', profilePatch: { eyeEffect: 'definition', finish: 'matte' }, selections: [{ productId: 'stage' }], regionDirections: { eyes: { title: 'Precise stage liner', steps: ['Keep the outer line precise.'] } } },
], skincare: [] };

test('applying a style changes only allowed preferences and records an explicit choice while preserving constraints', () => {
  const input = profile({ scope: 'both', slots: ['lip', 'cleanser'], ownedSlots: ['cleanser'], swaps: { lip: 'chosen' }, selectedShades: { base: '21N' },
    budgetCents: 4300, reserveCents: 300, country: 'Other', currency: 'USD', itemCap: 2, reactionHistory: 'yes', reactedProductIds: ['reaction'],
    avoidedIngredients: ['fragrance'], mandatoryRequirements: ['vegan'], preferredRequirements: ['fragrance_free'], skinFeel: 'dry_tight',
    answerProvenance: [{ field: 'skinFeel', source: 'questionnaire', confirmed: true, value: 'dry_tight' }] });
  const before = structuredClone(input);
  const patch = { ...guides.makeup[0], profilePatch: { finish: 'matte', coverage: 'invented', goals: ['natural_makeup', 'natural_makeup', 'unsafe_goal', 'quick_easy', 'less_shine'],
    scope: 'makeup', slots: ['eyes'], swaps: {}, selectedShades: {}, budgetCents: null, reserveCents: 0, itemCap: 99, country: 'United States',
    reactionHistory: 'no', avoidedIngredients: [], reactedProductIds: [], mandatoryRequirements: [], skinFeel: 'oily_shiny', gender: 'men' } };
  const next = applyStyleGuide(input, patch, 'makeup', '2026-10-06T01:00:00Z');
  assert.equal(next.finish, 'matte');
  assert.equal(next.makeupStyleId, 'soft_smoky');
  assert.deepEqual(next.goals, ['natural_makeup', 'quick_easy']);
  for (const key of ['scope', 'slots', 'ownedSlots', 'swaps', 'selectedShades', 'budgetCents', 'reserveCents', 'country', 'currency', 'itemCap', 'reactionHistory', 'reactedProductIds', 'avoidedIngredients', 'mandatoryRequirements', 'preferredRequirements', 'skinFeel', 'coverage']) assert.deepEqual(next[key], input[key], key);
  assert.equal(next.gender, undefined);
  assert.ok(next.answerProvenance.filter(answer => answer.source === 'style_guide').every(answer => answer.confirmed && answer.style_id === 'soft_smoky' && answer.observation_id === null));
  assert.deepEqual(input, before);
  assert.equal(applyStyleGuide({}, guides.makeup[0], 'makeup').reactionHistory, 'unknown');
});

test('a care guide cannot overwrite makeup choices and invalid guide inputs do not apply', () => {
  const input = profile({ finish: 'matte', colorFamily: 'red', coverage: 'spot_only' });
  const guide = { id: 'hydration_comfort', profilePatch: { finish: 'dewy', colorFamily: 'pink', coverage: 'more_coverage', texture: 'rich', goals: ['hydration_comfort'] } };
  const next = applyStyleGuide(input, guide, 'skincare');
  assert.equal(next.texture, 'rich');
  assert.equal(next.skincareStyleId, 'hydration_comfort');
  for (const key of ['finish', 'colorFamily', 'coverage']) assert.equal(next[key], input[key]);
  assert.throws(() => applyStyleGuide(input, null, 'makeup'), TypeError);
  assert.throws(() => applyStyleGuide(input, guide, 'unknown'), TypeError);
  assert.equal(findGuide(guides, 'missing'), null);
});

test('curated browsing retains unresolved checks and filters actual product exclusions', () => {
  const products = [product('smoky'), product('stage')];
  const evidence = { smoky: metadata(), stage: metadata() };
  const guide = { selections: [{ productId: 'smoky', reason: 'Soft edges' }, { productId: 'stage', reason: 'Precise line' }] };
  const input = profile({ reactionHistory: 'yes', reactedProductIds: ['smoky'] });
  const result = guideProducts(guide, products, evidence, input);
  assert.deepEqual(result.list.map(item => item.product.id), ['stage']);
  assert.equal(result.list[0].evaluation.state, 'needs_verification');
  assert.deepEqual(result.excluded.map(item => item.product.id), ['smoky']);
  assert.deepEqual(guideProducts(guide, products, evidence, profile({ country: 'Other' })).list, []);
  assert.deepEqual(guideProducts(guide, products, evidence, profile({ budgetCents: 500 })).list, []);
});

test('explicit style choices change regional instructions and rank distinct qualified products', () => {
  const products = [product('plain'), product('smoky'), product('stage')];
  const evidence = Object.fromEntries(products.map(product => [product.id, metadata()]));
  const analysis = analyze(region('eyes'));
  const original = structuredClone(analysis);
  const results = guides.makeup.map(guide => getFaceRecommendations(analysis, applyStyleGuide(profile(), guide, 'makeup'), products, evidence, guides));
  assert.equal(cards(results[0])[0], 'smoky');
  assert.equal(cards(results[1])[0], 'stage');
  assert.notEqual(results[0].regions[0].recommendation.title, results[1].regions[0].recommendation.title);
  assert.notDeepEqual(results[0].regions[0].recommendation.steps, results[1].regions[0].recommendation.steps);
  assert.equal(results[0].regions[0].recommendation.source, 'photo_and_style_choice');
  assert.ok(results.every(result => result.regions[0].cards.every(card => card.state === 'needs_verification')));
  assert.deepEqual(analysis, original);
  assert.deepEqual(cards(getFaceRecommendations(analysis, profile({ makeupStyleId: 'missing' }), products, evidence, guides)), cards(getFaceRecommendations(analysis, profile(), products, evidence)));
  const manualFormat = { ...applyStyleGuide(profile(), guides.makeup[0], 'makeup'), eyeFormat: 'mascara' };
  const explicitEvidence = { ...evidence, plain: metadata('mascara') };
  assert.equal(cards(getFaceRecommendations(analysis, manualFormat, products, explicitEvidence, guides))[0], 'plain', 'Authored support for a manual format choice precedes a curated style tie-break');
});

test('a selected guide cannot bypass evidence, reaction, budget, item, exact-product or photo-quality gates', () => {
  const products = [product('plain'), product('smoky')];
  const evidence = { plain: metadata(), smoky: metadata() };
  const base = applyStyleGuide(profile(), guides.makeup[0], 'makeup');
  const compute = (patch, es = evidence, a = analyze(region('eyes'))) => getFaceRecommendations(a, { ...base, ...patch }, products, es, guides);
  assert.deepEqual(cards(compute({ reactionHistory: 'yes', reactedProductIds: ['smoky'] })), ['plain']);
  assert.deepEqual(cards(compute({ budgetCents: 500 })), []);
  assert.deepEqual(cards(compute({ itemCap: 0 })), []);
  assert.deepEqual(cards(compute({ ownedSlots: ['eyes'] })), []);
  assert.deepEqual(cards(compute({ swaps: { eyes: 'plain' } })), ['plain']);
  const noSource = structuredClone(evidence); delete noSource.smoky.traits.chosen_effect.url;
  assert.deepEqual(cards(compute({}, noSource)), ['plain']);
  const unusable = compute({}, evidence, analyze(region('eyes', { quality: { usable: false, reason: 'Retake' } })));
  assert.deepEqual(cards(unusable), []);
  assert.equal(unusable.regions[0].recommendation.styleChoice, undefined);
});

test('brow pencils need authored format evidence and cannot become eyeliner candidates', () => {
  const products = [product('pencil', 'brow'), product('cara', 'brow'), product('liner')];
  const evidence = { pencil: metadata(), cara: metadata('brow_mascara'), liner: metadata() };
  const guide = { id: 'defined', title: 'Defined brows', selections: [{ productId: 'pencil' }], regionDirections: { brows: { title: 'Defined pencil brows', steps: ['Use short hairlike marks.'] } } };
  const data = { makeup: [guide] };
  const p = profile({ makeupStyleId: 'defined', eyeEffect: 'definition' });
  const result = getFaceRecommendations(analyze(region('brows'), region('eyes')), p, products, evidence, data);
  assert.equal(cards(result, 'brows')[0], 'pencil');
  assert.deepEqual(cards(result, 'eyes'), ['liner']);
  delete evidence.pencil.traits.format.date;
  assert.deepEqual(cards(getFaceRecommendations(analyze(region('brows')), p, products, evidence, data), 'brows'), ['cara']);
});

test('the selfie detail renders the chosen regional direction and a route to change it', () => {
  const chosen = applyStyleGuide(profile(), guides.makeup[0], 'makeup');
  const measured = region('eyes', { point: { x: 0.4, y: 0.4 }, bounds: { x: 0.25, y: 0.3, width: 0.5, height: 0.15 } });
  const html = renderFaceStudio({ photo: { width: 800, height: 1000, dataUrl: 'data:image/jpeg;base64,fixture' },
    analysis: analyze(measured), profile: chosen, products: [product('smoky')], evidence: { smoky: metadata() }, styleGuides: guides,
    selectedId: 'eyes', showAll: false, esc: value => String(value ?? ''), icon: () => '', productImage: () => '', lipControls: '' });
  assert.ok(html.includes('Diffused smoky eye'));
  assert.ok(html.includes('Your chosen direction: Soft smoky'));
  assert.ok(html.includes('data-nav="guides"'));
  assert.ok(html.includes('Diffuse the liner edge.'));
});

test('routine selection cannot fabricate cosmetic skin-appearance evidence or a matching base shade', () => {
  const products = [product('cream', ''), product('base', 'foundation')];
  const evidence = { cream: metadata('cream', { slots: ['serum'] }), base: metadata('liquid', { slots: ['base'], exactShade: '21N' }) };
  const data = { skincare: [{ id: 'care', title: 'Comfort', selections: [{ productId: 'cream' }], steps: ['Use one comfortable layer.'] }], makeup: [{ id: 'glow', title: 'Glow', selections: [{ productId: 'base' }] }] };
  const result = getFaceRecommendations(analyze(region('skin_texture'), region('nose')), profile({ skincareStyleId: 'care', makeupStyleId: 'glow' }), products, evidence, data);
  assert.deepEqual(cards(result, 'skin_texture'), []);
  const base = result.regions.find(region => region.id === 'nose').cards[0];
  assert.equal(base.state, 'needs_verification');
  assert.ok(base.reasons.some(reason => /shade/i.test(reason)));
});

test('artist group and style filters intersect with regional saved references without choosing a user gender', () => {
  const data = { artists: [{ id: 'a', name: 'A', referenceGroup: 'men' }, { id: 'b', name: 'B', referenceGroup: 'women' }], looks: [
    { id: 'one', artistId: 'a', styleIds: ['soft_smoky'], regions: [{ id: 'eyes', productCategories: ['eyeliner'], productIds: [] }] },
    { id: 'two', artistId: 'b', styleIds: ['stage_definition'], regions: [{ id: 'eyes', productCategories: ['eyeliner'], productIds: [] }] },
  ] };
  const filter = settings => filterLooks(data, settings).map(({ look, regionId }) => `${look.id}:${regionId}`);
  assert.deepEqual(filter({ referenceGroup: 'men', styleId: 'soft_smoky' }), ['one:all']);
  assert.deepEqual(filter({ referenceGroup: 'women', styleId: 'soft_smoky' }), []);
  assert.deepEqual(filter({ referenceGroup: 'men', savedOnly: true, saved: ['one:eyes'], region: 'all' }), ['one:eyes']);
  const products = [product('plain'), product('smoky'), product('stage')];
  assert.equal(relatedProducts(data.looks[0], 'eyes', products, guides)[0].id, 'smoky');
  assert.equal(relatedProducts(data.looks[1], 'eyes', products, guides)[0].id, 'stage');
});

test('live guides cover distinct editorial choices with valid product sources and regional directions', async () => {
  const read = async file => JSON.parse(await readFile(new URL(`../web/data/${file}.json`, import.meta.url), 'utf8'));
  const [data, catalog, evidence, looks] = await Promise.all(['beauty-styles', 'catalog', 'evidence', 'kpop-looks'].map(read));
  const makeupIds = ['barely_there', 'dewy_glow', 'soft_rose', 'soft_smoky', 'stage_definition', 'warm_bronze', 'statement_lip'];
  const careIds = ['minimal_routine', 'hydration_comfort', 'lightweight_layers', 'makeup_prep'];
  assert.deepEqual(data.makeup.map(guide => guide.id).sort(), makeupIds.sort());
  assert.deepEqual(data.skincare.map(guide => guide.id).sort(), careIds.sort());
  const sets = [];
  for (const kind of ['makeup', 'skincare']) for (const guide of data[kind]) {
    assert.ok(guide.title && guide.summary && guide.steps.length > 0);
    assert.ok(guide.selections.length >= 3);
    assert.equal(new Set(guide.selections.map(selection => selection.productId)).size, guide.selections.length);
    for (const selection of guide.selections) {
      const product = catalog.products.find(product => product.id === selection.productId);
      assert.ok(product, `${guide.id}: invalid product reference`);
      assert.equal(selection.sourceUrl, product.product_url);
      assert.ok(selection.reason);
      if (kind === 'skincare') assert.notEqual(evidence[product.id].requiresExplicitRequest, true);
    }
    if (kind === 'makeup') {
      for (const region of ['brows', 'eyes', 'nose', 'cheeks', 'lips']) assert.ok(guide.regionDirections[region].title && guide.regionDirections[region].steps.length);
      sets.push(guide.selections.map(selection => selection.productId).sort().join(','));
    }
  }
  assert.equal(new Set(sets).size, data.makeup.length, 'Every makeup guide needs a distinct product selection');
  const face = analyze(...['brows', 'eyes', 'nose', 'cheeks', 'lips'].map(id => region(id)));
  face.colorFamily = 'pink';
  face.samples = { lip: { rgb: [217, 124, 153], hex: '#d97c99' } };
  const outcomes = data.makeup.map(guide => {
    const chosen = applyStyleGuide(profile(), guide, 'makeup');
    const result = getFaceRecommendations(face, chosen, catalog, evidence, data);
    assert.ok(result.regions.every(region => region.cards.length <= 3));
    return result.regions.map(region => `${region.id}:${region.cards.map(card => card.product.id).join(',')}`).join('|');
  });
  assert.equal(new Set(outcomes).size, data.makeup.length, 'Applied makeup directions must not all return the same product edit');
  for (const look of looks.looks) assert.ok(look.styleIds?.length && look.styleIds.every(id => makeupIds.includes(id)), `${look.id}: invalid style reference`);
  for (const group of ['men', 'women']) assert.ok(filterLooks(looks, { referenceGroup: group }).length > 0, `${group}: no references available`);
});
