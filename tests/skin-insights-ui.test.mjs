import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSkinInsights, skinInsightCrop } from '../web/skin-insights-ui.js';
import { renderFaceStudio } from '../web/face-studio.js';
import { defaultProfile } from '../web/engine.js';

const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const icon = name => `<svg class="icon" data-icon="${name}" aria-hidden="true"></svg>`;
const photo = { dataUrl: 'data:image/jpeg;base64,original', width: 900, height: 1200 };
const bounds = { x: .18, y: .38, width: .14, height: .16 };
const metrics = ['pores', 'pigmentation', 'wrinkles'].map(id => ({ id, status: 'estimated', level: 'visible', reliability: 'moderate', qualityNotes: [], summary: `Visible ${id} photo detail.`, limitation: 'Lighting affects this appearance.', bounds }));
const analysis = { skinInsights: { methodVersion: 'skin-appearance-v1', scope: 'cheek samples', metrics: [...metrics, { id: 'moisture', status: 'not_measurable', level: 'not_measurable' }] } };
const render = (extra = {}) => renderSkinInsights({ analysis, photo, profile: {}, esc, icon, ...extra });

test('four distinct skin cards appear only with a skin-insights analysis contract', () => {
  assert.equal(render({ analysis: null }), '');
  assert.equal(render({ analysis: { status: 'ready' } }), '');
  const html = render();
  assert.equal((html.match(/<article class="skin-insight-card /g) || []).length, 4);
  for (const label of ['Pore appearance', 'Pigment appearance', 'Fine lines', 'Moisture']) assert.ok(html.includes(label));
  assert.ok(html.includes('sampled cheek areas'));
  assert.ok(html.includes('Forehead and eye-area wrinkles are not assessed'));
  assert.ok(html.includes('Your best estimate'));
  assert.equal((html.match(/<details class="skin-insight-detail">/g) || []).length, 4);
  assert.equal((html.match(/href="data:image\/jpeg;base64,original"/g) || []).length, 3);
  assert.equal((html.match(/Original photo · enlarged/g) || []).length, 3);
  assert.ok(!html.includes('data-face-region'));
});

test('moisture cannot acquire a photo-derived hydration result even with inconsistent input', () => {
  const badMoisture = { id: 'moisture', status: 'observed', level: 'pronounced', summary: 'Hydration is 90 percent', limitation: 'Hydration is measured', bounds, measurements: { hydration: 90 } };
  const html = render({ analysis: { skinInsights: { metrics: [...metrics, badMoisture] } } });
  assert.ok(!html.includes('Not measurable from a photo'));
  assert.ok(html.includes('Actual skin water content is not measured'));
  assert.ok(html.includes('Add a readable face photo to estimate the visible finish'));
  assert.ok(!html.includes('Hydration is 90 percent'));
  assert.ok(!html.includes('Hydration is measured'));
  assert.ok(!html.includes('value="90"'));
});

test('moisture leads with an estimated visible finish and keeps water-content limits secondary', () => {
  const moisture = { id: 'moisture', status: 'estimated', level: 'visible', reliability: 'limited', qualityNotes: ['Soft focus may hide smaller reflections.'], bounds, measurements: { hydrationMeasured: false, surfaceSheen: { status: 'estimated', level: 'visible', summary: 'Visible bright cheek reflections.' } } };
  const html = render({ analysis: { skinInsights: { metrics: [...metrics, moisture] } } });
  assert.ok(html.includes('Balanced-looking finish'));
  assert.ok(html.includes('a little surface glow'));
  assert.ok(html.includes('Actual skin water content is not measured'));
  assert.ok(html.includes('Photo appearance estimate · limited detail'));
  assert.ok(!html.includes('Not measurable from a photo'));
  assert.equal((html.match(/Original photo · enlarged/g) || []).length, 4);
  const unavailable = render({ analysis: { skinInsights: { metrics: [{ ...moisture, measurements: { surfaceSheen: { status: 'unavailable', level: 'visible', summary: 'Unsupported reflection claim' } } }] } } });
  assert.ok(!unavailable.includes('Unsupported reflection claim'));
  assert.ok(!unavailable.includes('Balanced-looking finish'));
});

test('separate sampled cheek crops are preferred over the union spanning the nose', () => {
  const left = { label: 'Image-left central cheek', bounds };
  const right = { label: 'Image-right central cheek', bounds: { ...bounds, x: .65 } };
  const union = { x: .18, y: .38, width: .61, height: .16 };
  const html = render({ analysis: { skinInsights: { sampledRegions: [left, right], metrics: metrics.map(metric => ({ ...metric, bounds: union })) } } });
  assert.equal((html.match(/Original photo · enlarged/g) || []).length, 6);
  for (const area of [left, right]) {
    const crop = skinInsightCrop(area.bounds, photo);
    assert.ok(html.includes(`viewBox="${crop.x} ${crop.y} ${crop.width} ${crop.height}"`));
    assert.ok(html.includes(`<figcaption>${area.label}</figcaption>`));
  }
  const crop = skinInsightCrop(union, photo);
  assert.ok(!html.includes(`viewBox="${crop.x} ${crop.y} ${crop.width} ${crop.height}"`));
});

test('apparent pore-like texture diameter is labeled as image pixels only when observed', () => {
  const pores = { ...metrics[0], measurements: { apparentDiameterPx: 5.2, sizeUnit: 'analyzed-image pixels' } };
  const html = render({ analysis: { skinInsights: { metrics: [pores] } } });
  assert.ok(html.includes('<strong>5.2 image pixels</strong>'));
  assert.ok(html.includes('not physical pore size'));
  assert.ok(html.includes('These details are not confirmed pores'));
  for (const metric of [{ ...pores, status: 'unavailable' }, ...[0, null, Infinity, '5.2'].map(apparentDiameterPx => ({ ...pores, measurements: { apparentDiameterPx } }))]) {
    const unavailable = render({ analysis: { skinInsights: { metrics: [metric] } } });
    assert.ok(!unavailable.includes('class="skin-apparent-size"'));
  }
});

test('skin-feel answers stay explicitly separate from image measurements', () => {
  for (const [skinFeel, label] of Object.entries({ dry_tight: 'Dry or tight', comfortable: 'Comfortable', oily_shiny: 'Oily or shiny', mixed: 'A little of both' })) {
    const profile = { skinFeel };
    const html = render({ profile });
    assert.ok(html.includes(`Your skin feel: ${label}`));
    assert.ok(html.includes('From your answers · separate from photo analysis'));
    assert.ok(html.includes('It is not a hydration measurement'));
    assert.ok(html.includes('data-selfie="refine">Update skin feel'));
    assert.deepEqual(profile, { skinFeel });
  }
  for (const skinFeel of [undefined, 'unknown', '<script>bad</script>']) {
    const html = render({ profile: { skinFeel } });
    assert.ok(html.includes('Your skin feel: Not added yet'));
    assert.ok(html.includes('data-selfie="refine">Add your skin feel'));
    assert.ok(!html.includes('<script>'));
  }
});

test('unreadable or missing metrics allow another photo without displaying a fabricated result', () => {
  const html = render({ analysis: { skinInsights: { metrics: [{ ...metrics[0], status: 'unavailable', level: 'low', qualityReason: 'Photo pixels could not be read.' }] } } });
  assert.equal((html.match(/Photo unavailable/g) || []).length, 4);
  assert.equal((html.match(/data-nav="selfie">Choose another photo/g) || []).length, 4);
  assert.ok(html.includes('Photo pixels could not be read.'));
  assert.ok(!html.includes('Low visual signal'));
  assert.ok(!html.includes('Not measurable from a photo'));
});

test('limited estimates display their pixel-derived result instead of a clearer-photo rejection', () => {
  const limited = metrics.map(item => ({ ...item, reliability: 'limited', qualityNotes: ['Soft focus may hide small details.'] }));
  const html = render({ analysis: { skinInsights: { metrics: limited } } });
  assert.equal((html.match(/Estimated · Visible detail/g) || []).length, 3);
  assert.equal((html.match(/Photo appearance estimate · limited detail/g) || []).length, 3);
  assert.ok(!html.includes('Needs a clearer photo'));
  assert.ok(!html.includes('Retake for more detail'));
  assert.ok(html.includes('Soft focus may hide small details.'));
});

test('text and original-photo attributes are escaped before rendering', () => {
  const attack = '<img src=x onerror="alert(1)"> & \'test\'';
  const html = render({ photo: { ...photo, dataUrl: `photo" onload="alert(1)` }, analysis: { skinInsights: { metrics: [{ ...metrics[0], summary: attack, limitation: attack }, { ...metrics[1], status: 'unavailable', qualityReason: attack }] } } });
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;test&#39;'));
  assert.ok(!html.includes('href="photo" onload='));
  assert.ok(html.includes('href="photo&quot; onload=&quot;alert(1)"'));
});

test('crop viewports stay within original pixels and reject unusable dimensions', () => {
  for (const size of [{ width: 900, height: 1200 }, { width: 800, height: 400 }, { width: 35, height: 50 }]) {
    for (const area of [bounds, { x: -.1, y: .9, width: .4, height: .3 }, { x: .9, y: -.1, width: .4, height: .3 }]) {
      const crop = skinInsightCrop(area, size);
      assert.ok(crop && crop.width > 0 && crop.height > 0);
      assert.ok(crop.x >= 0 && crop.y >= 0);
      assert.ok(crop.x + crop.width <= size.width + 1e-8 && crop.y + crop.height <= size.height + 1e-8);
    }
  }
  for (const area of [null, {}, { ...bounds, width: 0 }, { ...bounds, height: -1 }, { ...bounds, x: NaN }, { ...bounds, y: Infinity }, { ...bounds, x: 2 }]) assert.equal(skinInsightCrop(area, photo), null);
  for (const size of [{ width: 0, height: 200 }, { width: 100, height: -1 }, null]) assert.equal(skinInsightCrop(bounds, size), null);
});

test('skin dashboard preserves the original three map pins and all seven feature areas', () => {
  const ids = ['lips', 'brows', 'eyes', 'nose', 'cheeks', 'skin_texture', 'skin_tone'];
  const regions = ids.map((id, i) => ({ id, label: id, kind: id.startsWith('skin_') ? 'skincare' : 'makeup', point: { x: .4, y: .4 }, bounds, observations: ['Photo detail.'], measurements: {}, quality: { usable: true }, priority: 90 - i }));
  const html = renderFaceStudio({ photo, analysis: { ...analysis, status: 'ready', regions }, profile: defaultProfile(), products: [], evidence: {}, selectedId: '', showAll: true, esc, icon, productImage: () => '', lipControls: '' });
  assert.equal((html.match(/class="face-pin /g) || []).length, 3);
  assert.ok(html.includes('7 areas explored'));
  for (const id of ids) assert.ok(html.includes(`data-face-region="${id}"`));
  assert.equal((html.match(/<section class="skin-insights"/g) || []).length, 1);
});
