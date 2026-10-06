import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { defaultProfile, buildKit } from '../web/engine.js';
import { getFaceRecommendations, FACE_RECOMMENDATIONS_VERSION } from '../web/face-recommendations.js';
import { analyzeFacePixels } from '../web/photo-measurements.js';

const sourced = values => ({ values, url: 'https://example.com/review', date: '2026-10-05', basis: 'reviewed editorial inference' });
const product = (id, cents = 1000, extra = {}) => ({ id, brand: 'Test', product_name: id, price_usd: cents / 100, currency: 'USD', market: 'United States', size: '5 g', key_ingredients: [], ...extra });
const meta = (slots, traits = {}, extra = {}) => ({ slots, identityVerified: true, identityEvidence: { url: 'https://example.com/product', date: '2026-10-05' }, traits: Object.fromEntries(Object.entries(traits).map(([key, values]) => [key, sourced(values)])), completeInci: true, aliasesReviewed: true, ingredients: [], requirements: {}, removal: 'none', ...extra });
const profile = extra => ({ ...defaultProfile(), slots: [], budgetCents: 10000, itemCap: 8, ...extra });
const region = (id, measurements = {}, priority = 60, extra = {}) => ({ id, label: id, kind: id.startsWith('skin_') ? 'skincare' : 'makeup', point: { x: 0.5, y: 0.5 }, bounds: { x: 0.3, y: 0.3, width: 0.4, height: 0.4 }, observations: ['A measured photo observation.'], measurements, quality: { usable: true }, priority, ...extra });
const analysis = (regions, colorFamily = 'pink') => ({ status: 'ready', colorFamily, regions, samples: { lip: { rgb: [217, 124, 153], hex: '#d97c99' } } });
const products = [product('brow'), product('mascara'), product('liner'), product('blush'), product('lip'), product('base'), product('cream')];
const evidence = {
  brow: meta(['eyes'], { format: ['brow_mascara'], chosen_effect: ['definition'] }),
  mascara: meta(['eyes'], { format: ['mascara'], chosen_effect: ['length', 'definition'] }),
  liner: meta(['eyes'], { format: ['pencil'], chosen_effect: ['definition'] }),
  blush: meta(['cheek']), lip: meta(['lip'], { chosen_color_family: ['pink'] }),
  base: meta(['base'], { coverage: ['light_all_over'] }, { exactShade: '21N' }),
  cream: meta(['moisturizer'], { ordered_goals: ['hydration_comfort'] }),
};
const first = result => result.regions[0];
const ids = result => first(result).cards.map(card => card.product.id);
const run = (r, p = profile(), ps = products, es = evidence) => getFaceRecommendations(analysis([r]), p, ps, es);

test('only successfully measured analysis produces regions and input state is not mutated', () => {
  for (const a of [null, {}, { status: 'retake', regions: [region('brows')] }, { status: 'ready' }]) {
    const result = getFaceRecommendations(a, profile(), products, evidence);
    assert.deepEqual(result.regions, []);
    assert.deepEqual(result.featured, []);
  }
  const a = analysis([region('brows', { arch: 'soft' })]);
  const p = profile();
  const before = structuredClone({ a, p });
  const originalKit = buildKit(p, products, evidence);
  getFaceRecommendations(a, p, products, evidence);
  assert.deepEqual({ a, p }, before);
  assert.deepEqual(buildKit(p, products, evidence), originalKit);
});

test('seven regions remain available while only the top three measured priorities are featured', () => {
  const regions = [region('brows', { arch: 'soft' }, 80), region('eyes', { placement: 'open' }, 70), region('nose', {}, 45), region('cheeks', {}, 65), region('lips', {}, 90), region('skin_texture', { level: 'pronounced' }, 98), region('skin_tone', { level: 'pronounced' }, 96)];
  const result = getFaceRecommendations(analysis(regions), profile(), products, evidence);
  assert.equal(result.regions.length, 7);
  assert.deepEqual(result.featured.map(r => r.id), ['skin_texture', 'skin_tone', 'lips']);
  assert.equal(result.methodVersion, FACE_RECOMMENDATIONS_VERSION);
  assert.deepEqual(result.regions[0].point, regions[0].point);
  assert.deepEqual(result.regions[0].measurements, regions[0].measurements);
});

test('scope refines featured priority only when the user explicitly confirmed that answer', () => {
  const a = analysis([region('lips', {}, 90), region('brows', {}, 80), region('eyes', {}, 70), region('skin_texture', { level: 'low' }, 40), region('skin_tone', { level: 'low' }, 40)]);
  const p = profile({ scope: 'skincare' });
  assert.deepEqual(getFaceRecommendations(a, p, products, evidence).featured.map(r => r.id), ['lips', 'brows', 'eyes']);
  const provenance = { field: 'scope', value: 'skincare', source: 'questionnaire', confirmed: true };
  const explicit = getFaceRecommendations(a, { ...p, answerProvenance: [provenance] }, products, evidence);
  assert.deepEqual(explicit.featured.slice(0, 2).map(r => r.kind), ['skincare', 'skincare']);
  for (const answer of [{ ...provenance, confirmed: false }, { ...provenance, source: 'photo' }, { ...provenance, value: 'makeup' }]) {
    assert.equal(getFaceRecommendations(a, { ...p, answerProvenance: [answer] }, products, evidence).featured[0].id, 'lips');
  }
});

test('unusable regions explain capture limits and never trigger skin or style product suggestions', () => {
  const r = region('skin_texture', { level: 'pronounced' }, 100, { quality: { usable: false, reason: 'The photo is too soft to inspect detail.' } });
  const result = run(r);
  assert.deepEqual(ids(result), []);
  assert.deepEqual(result.featured, []);
  assert.match(first(result).recommendation.reason, /too soft/);
  assert.doesNotMatch(first(result).recommendation.title, /smoother/);
});

test('an explicit skincare scope shows retake guidance when skin detail is unavailable', () => {
  const a = analysis([region('lips', {}, 90), region('skin_texture', { level: 'unavailable' }, 10,
    { quality: { usable: false, reason: 'Move closer for skin detail.' } })]);
  const p = profile({ scope: 'skincare', answerProvenance: [{ field: 'scope', value: 'skincare', source: 'questionnaire', confirmed: true }] });
  const result = getFaceRecommendations(a, p, products, evidence);
  assert.deepEqual(result.featured.map(r => r.id), ['skin_texture']);
  assert.deepEqual(result.featured[0].cards, []);
  assert.equal(result.regions.length, 2);
});

test('brow geometry changes the application idea and brow candidates cannot become eye-liner candidates', () => {
  const soft = run(region('brows', { arch: 'soft' }));
  const defined = run(region('brows', { arch: 'defined' }));
  assert.notEqual(first(soft).recommendation.title, first(defined).recommendation.title);
  assert.deepEqual(ids(soft), ['brow']);
  assert.deepEqual(ids(defined), ['brow']);
  assert.match(first(soft).recommendation.inspiration, /not an artist endorsement/);
});

test('eye opening changes the proposed effect and actual reviewed product shortlist', () => {
  const open = run(region('eyes', { placement: 'open' }));
  const elongated = run(region('eyes', { placement: 'elongated' }));
  assert.deepEqual(ids(open), ['mascara']);
  assert.deepEqual(ids(elongated), ['liner', 'mascara']);
  assert.notEqual(first(open).recommendation.title, first(elongated).recommendation.title);
  assert.match(first(open).cards[0].score.components[0].reason, /photo-guided/);
  assert.doesNotMatch(first(open).cards[0].score.components[0].reason, /You chose/);
});

test('manual eye effect overrides the image styling suggestion without changing measured shape', () => {
  const result = run(region('eyes', { placement: 'open' }), profile({ eyeEffect: 'definition' }));
  assert.deepEqual(ids(result), ['liner', 'mascara']);
  assert.equal(first(result).recommendation.source, 'photo_and_questionnaire');
  assert.equal(first(result).measurements.placement, 'open');
  assert.match(first(result).recommendation.title, /definition/);
  assert.deepEqual(ids(run(region('eyes', { placement: 'open' }), profile({ eyeEffect: 'volume' }))), []);
});

test('cheek position and lip outline change the style instructions', () => {
  const upper = run(region('cheeks', { verticalPlacement: 0.5 }));
  const lower = run(region('cheeks', { verticalPlacement: 0.65 }));
  assert.notEqual(first(upper).recommendation.title, first(lower).recommendation.title);
  assert.deepEqual(ids(upper), ['blush']);
  const shallow = run(region('lips', { heightToWidthRatio: 0.25 }));
  const deeper = run(region('lips', { heightToWidthRatio: 0.45 }));
  assert.notEqual(first(shallow).recommendation.title, first(deeper).recommendation.title);
  const glossy = run(region('lips', { heightToWidthRatio: 0.45 }), profile({ finish: 'dewy' }));
  assert.match(first(glossy).recommendation.title, /glossy/);
});

test('lip suggestions follow measured color while an explicit questionnaire color has priority', () => {
  const ps = [product('pink'), product('coral')];
  const es = { pink: meta(['lip'], { chosen_color_family: ['pink'] }), coral: meta(['lip'], { chosen_color_family: ['coral'] }) };
  const a = analysis([region('lips')], 'coral');
  assert.deepEqual(ids(getFaceRecommendations(a, profile(), ps, es)), ['coral']);
  assert.deepEqual(ids(getFaceRecommendations(a, profile({ colorFamily: 'pink' }), ps, es)), ['pink']);
});

test('cheaper blush alternatives cannot crowd the lip-region shortlist out', () => {
  const ps = [product('cheek-a', 100), product('cheek-b', 200), product('cheek-c', 300), product('lip', 500)];
  const es = Object.fromEntries(ps.map(p => [p.id, meta([p.id === 'lip' ? 'lip' : 'cheek'], { chosen_color_family: ['pink'] })]));
  assert.deepEqual(ids(run(region('lips'), profile(), ps, es)), ['lip']);
});

test('base suggestions retain the exact shade gate and never claim the photo matched foundation', () => {
  const result = run(region('nose'));
  assert.deepEqual(ids(result), ['base']);
  assert.equal(first(result).cards[0].state, 'needs_verification');
  assert.match(first(result).cards[0].reasons.join(' '), /exact shade/);
  assert.match(first(result).recommendation.reason, /choose the exact shade yourself/);
  assert.equal(first(run(region('nose'), profile({ selectedShades: { base: '21N' } }))).cards[0].state, 'eligible');
});

test('blush category ideas keep an unverified selected color pending', () => {
  const result = run(region('cheeks'), profile({ colorFamily: 'pink' }));
  assert.deepEqual(ids(result), ['blush']);
  assert.equal(first(result).cards[0].state, 'needs_verification');
  assert.match(first(result).cards[0].reasons.join(' '), /pink color is not verified/);
});

test('missing reaction answers stay unresolved and actual exclusions still remove products', () => {
  const result = run(region('brows'), { slots: [] });
  assert.equal(first(result).cards[0].state, 'needs_verification');
  assert.match(first(result).cards[0].reasons.join(' '), /reaction history/);
  for (const p of [profile({ reactedProductIds: ['brow'] }), profile({ country: 'Other' }), profile({ mandatoryRequirements: ['vegan'] }), profile({ avoidedIngredients: ['parfum'] })]) {
    const es = { ...evidence, brow: { ...evidence.brow, ingredients: ['parfum'], requirements: { vegan: false } } };
    assert.deepEqual(ids(run(region('brows'), p, products, es)), []);
  }
});

test('unknown ingredient/removal requirements are shown with their actual reasons', () => {
  const es = { ...evidence, brow: { ...evidence.brow, removal: 'unknown', completeInci: false } };
  const result = run(region('brows'), profile({ avoidedIngredients: ['fragrance'], mandatoryRequirements: ['vegan'] }), products, es);
  assert.equal(first(result).cards[0].state, 'needs_verification');
  assert.match(first(result).cards[0].reasons.join(' '), /ingredient list/);
  assert.match(first(result).cards[0].reasons.join(' '), /vegan/);
  assert.match(first(result).cards[0].reasons.join(' '), /removal/);
});

test('remaining budget, reserve and daily item cap apply to alternatives without adding their prices', () => {
  const ps = [product('cream', 1000), product('brow-a', 600), product('brow-b', 650), product('brow-c', 701)];
  const es = { cream: evidence.cream, 'brow-a': evidence.brow, 'brow-b': evidence.brow, 'brow-c': evidence.brow };
  const p = profile({ slots: ['moisturizer'], budgetCents: 1900, reserveCents: 200, itemCap: 2 });
  assert.deepEqual(ids(run(region('brows'), p, ps, es)), ['brow-a', 'brow-b']);
  assert.deepEqual(ids(run(region('brows'), { ...p, itemCap: 1 }, ps, es)), []);
  assert.equal(buildKit(p, ps, es).totalCents, 1000);
});

test('replacing a selected slot credits only its existing cost and owned or swapped slots remain respected', () => {
  const ps = [product('brow', 700), product('brow-upgrade', 800), product('cream', 1000)];
  const es = { brow: evidence.brow, 'brow-upgrade': evidence.brow, cream: evidence.cream };
  const p = profile({ slots: ['eyes', 'moisturizer'], budgetCents: 1800, itemCap: 2 });
  assert.deepEqual(ids(run(region('brows'), p, ps, es)), ['brow', 'brow-upgrade']);
  assert.deepEqual(ids(run(region('brows'), { ...p, ownedSlots: ['eyes'] }, ps, es)), []);
  assert.deepEqual(ids(run(region('brows'), { ...p, swaps: { eyes: 'brow-upgrade' } }, ps, es)), ['brow-upgrade']);
});

test('required remover cost and item count cannot be omitted from a photo candidate', () => {
  const ps = [product('brow', 1000), product('remover', 500)];
  const es = { brow: { ...evidence.brow, removal: 'remover' }, remover: meta(['remover']) };
  assert.deepEqual(ids(run(region('brows'), profile({ budgetCents: 1499 }), ps, es)), []);
  assert.deepEqual(ids(run(region('brows'), profile({ itemCap: 1 }), ps, es)), []);
  const result = run(region('brows'), profile({ budgetCents: 1500, itemCap: 2 }), ps, es);
  assert.deepEqual(ids(result), ['brow']);
  assert.equal(first(result).cards[0].state, 'needs_verification');
  assert.deepEqual(ids(run(region('brows'), profile({ budgetCents: 1500 }), ps.slice(0, 1), es)), []);
});

test('malformed budget and unsupported or duplicate region ids cannot create suggestions', () => {
  for (const budgetCents of [-1, NaN, Infinity, 100.5]) {
    const result = run(region('brows'), profile({ budgetCents }));
    assert.deepEqual(result.regions, []);
    assert.match(result.reason, /budgetCents/);
  }
  const result = getFaceRecommendations(analysis([region('brows'), region('brows'), region('made-up')]), profile(), products, evidence);
  assert.equal(result.regions.length, 1);
});

test('product category words cannot fabricate authored eye or cosmetic appearance evidence', () => {
  const ps = [product('pretend', 500, { category: 'Brow mascara', intended_benefit: 'Removes pores and dark spots' })];
  const es = { pretend: meta(['eyes', 'serum'], { format: ['brow_mascara'] }) };
  delete es.pretend.traits.format.url;
  assert.deepEqual(ids(run(region('brows'), profile(), ps, es)), []);
  assert.deepEqual(ids(run(region('skin_texture', { level: 'pronounced' }), profile(), ps, es)), []);
  assert.deepEqual(ids(run(region('skin_tone', { level: 'pronounced' }), profile(), ps, es)), []);
});

test('real catalog skin appearance suggestions change with visible detail and retain opt-in gates', async () => {
  const catalog = JSON.parse(await readFile(new URL('../web/data/catalog.json', import.meta.url)));
  const es = JSON.parse(await readFile(new URL('../web/data/evidence.json', import.meta.url)));
  const p = profile({ budgetCents: null, reactionHistory: 'unknown' });
  const low = run(region('skin_texture', { level: 'low' }), p, catalog, es);
  const visible = run(region('skin_texture', { level: 'visible' }), p, catalog, es);
  const tone = run(region('skin_tone', { level: 'pronounced' }), p, catalog, es);
  assert.ok(ids(low).length > 0);
  assert.ok(ids(visible).length > 0);
  assert.ok(ids(tone).length > 0);
  assert.notDeepEqual(ids(low), ids(visible));
  assert.notDeepEqual(ids(visible), ids(tone));
  assert.ok(first(visible).cards.every(card => card.imageEvidence.url && card.state === 'needs_verification'));
  assert.match(first(visible).recommendation.reason, /cannot establish enlarged pores/);
  const opted = run(region('skin_texture', { level: 'visible' }), { ...p, reactionHistory: 'no', swaps: { serum: 'kbeauty-003' } }, catalog, es);
  const candidate = first(opted).cards.find(card => card.product.id === 'kbeauty-003');
  assert.ok(candidate);
  assert.ok(!candidate.reasons.some(reason => reason.includes('explicit')));
  const missingSource = structuredClone(es);
  for (const meta of Object.values(missingSource)) meta.sources = [];
  assert.deepEqual(ids(run(region('skin_texture', { level: 'visible' }), p, catalog, missingSource)), []);
});

test('real catalog covers brow, eye, nose, cheek and lip formats without inventing celebrity use', async () => {
  const catalog = JSON.parse(await readFile(new URL('../web/data/catalog.json', import.meta.url)));
  const es = JSON.parse(await readFile(new URL('../web/data/evidence.json', import.meta.url)));
  for (const id of ['brows', 'eyes', 'nose', 'cheeks', 'lips']) {
    const result = run(region(id, { placement: 'open' }), profile({ reactionHistory: 'unknown', budgetCents: null }), catalog, es);
    assert.ok(first(result).cards.length > 0, id);
    assert.ok(first(result).cards.every(card => card.state === 'needs_verification'));
    assert.doesNotMatch(first(result).recommendation.inspiration, /Winter|Felix|uses|endorses/);
  }
});

test('production pixel and region analysis feeds the recommendation contract without mock region objects', () => {
  const width = 400, height = 400, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(y > 240 && y < 320 ? [217, 124, 153, 255] : [170, 120, 100, 255], (y * width + x) * 4);
  const makeMesh = (browRise, eyeOpening) => {
    const mesh = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
    const oval = (indices, cx, cy, rx, ry, rotation = -Math.PI) => indices.forEach((index, i) => {
      const angle = rotation + i * Math.PI * 2 / indices.length;
      mesh[index] = { x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry };
    });
    oval([10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109], 0.5, 0.5, 0.35, 0.43, -Math.PI / 2);
    oval([61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146], 0.5, 0.7, 0.16, 0.075);
    oval([78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95], 0.5, 0.7, 0.13, 0.025);
    Object.entries({ 50: [0.32, 0.47], 101: [0.4, 0.51], 205: [0.34, 0.6], 187: [0.25, 0.57], 280: [0.68, 0.47], 330: [0.6, 0.51], 425: [0.66, 0.6], 411: [0.75, 0.57], 168: [0.5, 0.33], 2: [0.5, 0.58], 98: [0.45, 0.58], 327: [0.55, 0.58] }).forEach(([i, [x, y]]) => { mesh[i] = { x, y }; });
    for (const [indices, start] of [[[70, 63, 105, 66, 107], 0.2], [[336, 296, 334, 293, 300], 0.56]]) indices.forEach((index, i) => { mesh[index] = { x: start + i * 0.06, y: 0.3 - Math.sin(i / 4 * Math.PI) * browRise }; });
    for (const [a, b, top, bottom, cx] of [[33, 133, 159, 145, 0.32], [362, 263, 386, 374, 0.68]]) {
      mesh[a] = { x: cx - 0.1, y: 0.4 }; mesh[b] = { x: cx + 0.1, y: 0.4 };
      mesh[top] = { x: cx, y: 0.4 - eyeOpening / 2 }; mesh[bottom] = { x: cx, y: 0.4 + eyeOpening / 2 };
    }
    return mesh;
  };
  const narrow = analyzeFacePixels({ width, height, data }, [makeMesh(0.01, 0.04)]);
  const open = analyzeFacePixels({ width, height, data }, [makeMesh(0.06, 0.08)]);
  assert.equal(narrow.status, 'ready');
  assert.equal(open.status, 'ready');
  const a = getFaceRecommendations(narrow, profile(), products, evidence);
  const b = getFaceRecommendations(open, profile(), products, evidence);
  assert.equal(a.regions.length, 7);
  const lookup = (value, id) => value.regions.find(r => r.id === id);
  assert.notEqual(lookup(a, 'brows').recommendation.title, lookup(b, 'brows').recommendation.title);
  assert.deepEqual(lookup(a, 'eyes').cards.map(card => card.product.id), ['liner', 'mascara']);
  assert.deepEqual(lookup(b, 'eyes').cards.map(card => card.product.id), ['mascara']);
  assert.deepEqual(lookup(a, 'lips').cards.map(card => card.product.id), ['lip']);
  assert.ok(lookup(a, 'lips').bounds.width > 0);
  assert.equal(lookup(a, 'skin_texture').quality.usable, true);
  assert.equal(lookup(a, 'skin_texture').quality.status, 'estimated');
  assert.equal(lookup(a, 'skin_texture').quality.reliability, 'limited');
  assert.ok(lookup(a, 'skin_texture').measurements.sampledPixelCount > 0);
});
