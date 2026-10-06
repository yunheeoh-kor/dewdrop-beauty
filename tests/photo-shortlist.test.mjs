import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { defaultProfile, buildKit } from '../web/engine.js';
import { getPhotoShortlist, confirmPhotoColor, PHOTO_SHORTLIST_VERSION } from '../web/photo-shortlist.js';

const trait = values => ({ values, knownValues: values, basis: 'reviewed editorial inference', url: 'https://example.com/review', date: '2026-10-05' });
const product = (id, cents = 1000, extra = {}) => ({ id, brand: 'Test', product_name: id, price_usd: cents / 100, currency: 'USD', market: 'United States', size: '5 g', key_ingredients: [], ...extra });
const meta = (family, extra = {}) => ({ slots: ['lip'], identityVerified: true, traits: { chosen_color_family: trait([family]) }, requirements: {}, completeInci: true, aliasesReviewed: true, ingredients: [], removal: 'none', ...extra });
const profile = extra => ({ ...defaultProfile(), slots: [], budgetCents: 5000, itemCap: 5, ...extra });
const analysis = colorFamily => ({ status: 'ready', colorFamily, methodVersion: 'face-pixels-v1', samples: { lip: { hex: '#a55a5a', rgb: [165, 90, 90] }, cheek: { hex: '#c99c84', rgb: [201, 156, 132] } }, landmarks: [[0.4, 0.5]], dataUrl: 'data:image/jpeg;base64,secret' });
const products = [product('pink'), product('coral'), product('rose')];
const evidence = { pink: meta('pink'), coral: meta('coral'), rose: meta('rose') };
const ids = result => result.cards.map(card => card.product.id);

test('an omitted reaction answer stays unresolved in photo previews', () => {
  const result = getPhotoShortlist(analysis('pink'), { slots: [] }, products, evidence);
  assert.equal(result.cards[0].state, 'needs_verification');
  assert.ok(result.cards[0].reasons.some(reason => reason.includes('reaction history')));
});

test('changing ready photo colors changes the product shortlist without editing profile or kit', () => {
  const p = profile({ slots: ['moisturizer'] });
  const before = structuredClone(p);
  const beforeKit = buildKit(p, products, evidence);
  assert.deepEqual(ids(getPhotoShortlist(analysis('pink'), p, products, evidence)), ['pink']);
  assert.deepEqual(ids(getPhotoShortlist(analysis('coral'), p, products, evidence)), ['coral']);
  assert.deepEqual(p, before);
  assert.deepEqual(buildKit(p, products, evidence), beforeKit);
});

test('explicit questionnaire color takes priority over a new photo', () => {
  const p = profile({ colorFamily: 'rose' });
  const result = getPhotoShortlist(analysis('coral'), p, products, evidence);
  assert.deepEqual(ids(result), ['rose']);
  assert.equal(result.source, 'questionnaire');
  assert.equal(result.colorFamily, 'rose');
  assert.equal(p.colorFamily, 'rose');
});

test('unavailable observed colors transparently use the nearest reviewed editorial family', () => {
  const a = analysis('berry');
  a.samples.lip.rgb = [126, 57, 87];
  const result = getPhotoShortlist(a, profile(), products.slice(0, 2), evidence);
  assert.equal(result.observedColorFamily, 'berry');
  assert.equal(result.colorFamily, 'pink');
  assert.equal(result.nearestAvailable, true);
  assert.equal(result.methodVersion, PHOTO_SHORTLIST_VERSION);
  assert.deepEqual(ids(result), ['pink']);
  assert.match(result.reason, /No reviewed berry shades/);
  assert.match(result.reason, /editorial palette/);
  assert.equal(result.cards[0].score.components.find(c => c.dimension === 'chosen_color_family').match, 1);
});

test('catalog fallback uses actual lip pixels and never substitutes for an explicit unavailable preference', () => {
  const pink = analysis('berry');
  pink.samples.lip.rgb = [217, 124, 153];
  const coral = analysis('nude');
  coral.samples.lip.rgb = [224, 123, 104];
  assert.deepEqual(ids(getPhotoShortlist(pink, profile(), products.slice(0, 2), evidence)), ['pink']);
  assert.deepEqual(ids(getPhotoShortlist(coral, profile(), products.slice(0, 2), evidence)), ['coral']);
  const explicit = getPhotoShortlist(coral, profile({ colorFamily: 'berry' }), products, evidence);
  assert.equal(explicit.colorFamily, 'berry');
  assert.equal(explicit.source, 'questionnaire');
  assert.equal(explicit.nearestAvailable, false);
  assert.deepEqual(ids(explicit), []);
});

test('fallback cannot use missing pixels, unauthored metadata, or evade exclusions', () => {
  const a = analysis('berry');
  delete a.samples;
  const missing = getPhotoShortlist(a, profile(), products, evidence);
  assert.equal(missing.nearestAvailable, false);
  assert.deepEqual(ids(missing), []);
  const excluded = getPhotoShortlist(analysis('berry'), profile({ reactedProductIds: ['pink', 'coral', 'rose'] }), products, evidence);
  assert.deepEqual(ids(excluded), []);
});

test('missing or rejected face analysis never fabricates a product recommendation', () => {
  for (const a of [null, {}, { status: 'retake', colorFamily: 'pink' }, { status: 'ready', colorFamily: 'invented' }]) {
    assert.deepEqual(ids(getPhotoShortlist(a, profile({ colorFamily: 'pink' }), products, evidence)), []);
  }
});

test('photo color matches require authored evidence rather than product descriptions', () => {
  const noEvidence = { pink: meta('pink', { traits: { chosen_color_family: { values: ['pink'] } } }) };
  assert.deepEqual(ids(getPhotoShortlist(analysis('pink'), profile(), [product('pink', 1000, { intended_benefit: 'Pink lips' })], noEvidence)), []);
});

test('exact reactions, ingredient presence, country, and mandatory contradictions stay excluded', () => {
  for (const p of [profile({ reactedProductIds: ['pink'] }), profile({ avoidedIngredients: ['parfum'] }), profile({ country: 'Other' }), profile({ mandatoryRequirements: ['vegan'] })]) {
    const e = { pink: meta('pink', { ingredients: ['parfum'], requirements: { vegan: false } }) };
    assert.deepEqual(ids(getPhotoShortlist(analysis('pink'), p, [product('pink')], e)), []);
  }
});

test('unknown formula and removal checks remain pending with their actual reasons', () => {
  const e = { pink: meta('pink', { removal: 'unknown', requirements: {} }) };
  const result = getPhotoShortlist(analysis('pink'), profile({ mandatoryRequirements: ['vegan'] }), [product('pink')], e);
  assert.equal(result.cards[0].state, 'needs_verification');
  assert.match(result.cards[0].reasons.join(' '), /removal instructions/);
  assert.match(result.cards[0].reasons.join(' '), /vegan is not verified/);
});

test('alternatives use remaining whole-kit budget and reserve without summing alternative prices', () => {
  const all = [product('cream', 1000), product('pink-a', 600), product('pink-b', 600), product('pink-expensive', 701)];
  const e = { cream: meta('pink', { slots: ['moisturizer'], traits: {} }), 'pink-a': meta('pink'), 'pink-b': meta('pink'), 'pink-expensive': meta('pink') };
  const p = profile({ slots: ['moisturizer'], budgetCents: 1900, reserveCents: 200 });
  const result = getPhotoShortlist(analysis('pink'), p, all, e);
  assert.equal(result.remainingCents, 700);
  assert.deepEqual(ids(result), ['pink-a', 'pink-b']);
  assert.equal(buildKit(p, all, e).totalCents, 1000);
});

test('replacing an existing lip product credits its existing cost but retains other routine costs', () => {
  const all = [product('cream', 1000), product('pink-cheap', 500), product('pink-upgrade', 600), product('pink-expensive', 800)];
  const e = { cream: meta('pink', { slots: ['moisturizer'], traits: {} }), 'pink-cheap': meta('pink'), 'pink-upgrade': meta('pink'), 'pink-expensive': meta('pink') };
  const result = getPhotoShortlist(analysis('pink'), profile({ slots: ['moisturizer', 'lip'], budgetCents: 1600, itemCap: 2 }), all, e);
  assert.deepEqual(ids(result), ['pink-cheap', 'pink-upgrade']);
});

test('daily item limits, retained makeup, and selected exact products are preserved', () => {
  assert.deepEqual(ids(getPhotoShortlist(analysis('pink'), profile({ itemCap: 0 }), products, evidence)), []);
  assert.deepEqual(ids(getPhotoShortlist(analysis('pink'), profile({ ownedSlots: ['lip'] }), products, evidence)), []);
  assert.deepEqual(ids(getPhotoShortlist(analysis('pink'), profile({ swaps: { lip: 'coral' } }), products, evidence)), []);
});

test('at most three distinct alternatives are stable across catalog order', () => {
  const all = ['d', 'c', 'b', 'a'].map(id => product(id));
  const e = Object.fromEntries(all.map(p => [p.id, meta('pink', { slots: ['lip', 'cheek'] })]));
  const result = getPhotoShortlist(analysis('pink'), profile(), all, e);
  assert.deepEqual(ids(result), ['a', 'b', 'c']);
  assert.deepEqual(ids(getPhotoShortlist(analysis('pink'), profile(), all.toReversed(), e)), ids(result));
});

test('known remover dependencies count toward the available budget and item limit', () => {
  const all = [product('pink', 1000), product('remover', 500)];
  const e = { pink: meta('pink', { removal: 'remover' }), remover: meta(null, { slots: ['remover'], traits: {} }) };
  assert.deepEqual(ids(getPhotoShortlist(analysis('pink'), profile({ budgetCents: 1499 }), all, e)), []);
  assert.deepEqual(ids(getPhotoShortlist(analysis('pink'), profile({ itemCap: 1 }), all, e)), []);
  const result = getPhotoShortlist(analysis('pink'), profile({ budgetCents: 1500, itemCap: 2 }), all, e);
  assert.deepEqual(ids(result), ['pink']);
  assert.equal(result.cards[0].state, 'needs_verification');
});

test('invalid budgets cannot become an unlimited photo preview', () => {
  for (const budgetCents of [NaN, Infinity, -1, 500.5]) {
    const result = getPhotoShortlist(analysis('pink'), profile({ budgetCents }), products, evidence);
    assert.equal(result.cards.length, 0);
    assert.match(result.reason, /budgetCents/);
  }
});

test('confirmation stores only the chosen answer and provenance, with all other answers intact', () => {
  const p = profile({ skinFeel: 'dry_tight', goals: ['hydration_comfort'], colorFamily: 'rose', answerProvenance: [{ field: 'skinFeel', value: 'dry_tight', source: 'questionnaire' }, { field: 'colorFamily', value: 'rose', source: 'questionnaire' }] });
  const before = structuredClone(p);
  const confirmed = confirmPhotoColor(p, analysis('pink'));
  assert.deepEqual(p, before);
  assert.equal(confirmed.colorFamily, 'pink');
  assert.deepEqual(confirmed.slots, p.slots);
  assert.equal(confirmed.skinFeel, p.skinFeel);
  assert.deepEqual(confirmed.goals, p.goals);
  const source = confirmed.answerProvenance.filter(answer => answer.field === 'colorFamily');
  assert.equal(source.length, 1);
  assert.equal(source[0].source, 'confirmed_photo');
  assert.equal(source[0].confirmed, true);
  assert.match(source[0].observation_id, /^face-pixels-v1:/);
  assert.doesNotMatch(JSON.stringify(confirmed), /samples|landmarks|data:image|#a55a5a/);
  confirmed.goals.push('quick_easy');
  assert.deepEqual(p.goals, ['hydration_comfort']);
});

test('invalid confirmation preserves the profile and a chosen alternative can be confirmed explicitly', () => {
  const p = profile();
  assert.deepEqual(confirmPhotoColor(p, { status: 'retake', colorFamily: 'pink' }), p);
  assert.deepEqual(confirmPhotoColor(p, analysis('pink'), 'invalid'), p);
  assert.equal(confirmPhotoColor(p, analysis('pink'), 'coral').colorFamily, 'coral');
});

test('legacy photo payloads are removed from confirmed profiles and numeric constraints remain intact', () => {
  const confirmed = confirmPhotoColor(profile({ budgetCents: Infinity, selfie: analysis('pink'), dataUrl: 'data:image/jpeg;base64,private' }), analysis('pink'));
  assert.equal(confirmed.budgetCents, Infinity);
  assert.equal('selfie' in confirmed, false);
  assert.equal('dataUrl' in confirmed, false);
});

test('real catalog produces distinct pending pink and coral recommendations', async () => {
  const catalog = JSON.parse(await readFile(new URL('../web/data/catalog.json', import.meta.url)));
  const e = JSON.parse(await readFile(new URL('../web/data/evidence.json', import.meta.url)));
  const p = profile({ reactionHistory: 'unknown', budgetCents: null });
  const pink = getPhotoShortlist(analysis('pink'), p, catalog, e);
  const coral = getPhotoShortlist(analysis('coral'), p, catalog, e);
  assert.ok(pink.cards.length > 0);
  assert.ok(coral.cards.length > 0);
  assert.notDeepEqual(ids(pink), ids(coral));
  assert.ok([...pink.cards, ...coral.cards].every(card => card.state === 'needs_verification'));
});
