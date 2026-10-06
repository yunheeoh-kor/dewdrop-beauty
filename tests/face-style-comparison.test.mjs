import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { selectFaceStyleReferences, renderFaceStyleComparison } from '../web/face-style-comparison.js';

const lookbook = JSON.parse(readFileSync(new URL('../web/data/kpop-looks.json', import.meta.url)));
const styleGuides = JSON.parse(readFileSync(new URL('../web/data/beauty-styles.json', import.meta.url)));
const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const icon = name => `<svg class="icon" data-icon="${name}" aria-hidden="true"></svg>`;
const photo = { dataUrl: 'data:image/jpeg;base64,private', width: 900, height: 1200 };
const region = { id: 'lips', label: 'Lips', quality: { usable: true }, observations: ['Your lip pixels read rose in this light.'], measurements: {} };
const render = extra => renderFaceStyleComparison({ region, photo, analysis: {}, lookbook, styleGuides, profile: {}, esc, icon, ...extra });

test('every studio area maps to two licensed references with distinct artists and the corresponding crop', () => {
  for (const [id, expected] of Object.entries({ brows: 'brows', eyes: 'eyes', cheeks: 'cheeks', lips: 'lips', nose: 'face', skin_texture: 'face', skin_tone: 'face' })) {
    const references = selectFaceStyleReferences({ region: { ...region, id }, lookbook, styleGuides });
    assert.equal(references.length, 2, id);
    assert.notEqual(references[0].artist.id, references[1].artist.id);
    for (const ref of references) {
      assert.equal(ref.part.id, expected);
      assert.equal(ref.look.image.displayAllowed, true);
      assert.ok(ref.look.image.license && ref.look.image.sourceUrl);
      assert.ok(ref.part.crop.width > 0 && ref.part.crop.height > 0);
      assert.equal('score' in ref, false);
      assert.equal('similarity' in ref, false);
    }
  }
});

test('an explicitly chosen makeup direction takes priority over category alternatives', () => {
  for (const guide of styleGuides.makeup) {
    if (!lookbook.looks.some(look => look.styleIds.includes(guide.id))) continue;
    const references = selectFaceStyleReferences({ region, lookbook, styleGuides, profile: { makeupStyleId: guide.id, finish: 'dewy' } });
    assert.ok(references[0].look.styleIds.includes(guide.id), guide.id);
    assert.equal(references[0].guide.id, guide.id);
    assert.match(references[0].selectionReason, /From your/);
  }
});

test('editorial selection depends on chosen styling, not face identity, demographic fields, or geometry', () => {
  const first = selectFaceStyleReferences({ region, lookbook, styleGuides, profile: { makeupStyleId: 'soft_rose' } });
  const second = selectFaceStyleReferences({ region: { ...region, measurements: { age: 75, gender: 'man', faceShape: 'round', heightToWidthRatio: .8 } }, lookbook, styleGuides, profile: { makeupStyleId: 'soft_rose', gender: 'woman', race: 'asian', age: 21 } });
  assert.deepEqual(second.map(item => item.look.id), first.map(item => item.look.id));
  assert.equal(selectFaceStyleReferences({ region: { id: 'unknown' }, lookbook, styleGuides }).length, 0);
});

test('unlicensed images, remote assets, invalid crop coordinates and missing attributions never become references', () => {
  for (const change of [
    look => { look.image.displayAllowed = false; },
    look => { look.image.src = 'https://example.com/image.jpg'; },
    look => { look.image.src = 'assets/looks/../private.jpg'; },
    look => { look.image.sourceUrl = 'javascript:alert(1)'; },
    look => { look.image.licenseUrl = ''; },
    look => { look.image.credit = ''; },
    look => { look.regions.find(part => part.id === 'lips').crop.x = 2; },
  ]) {
    const modified = structuredClone(lookbook); modified.looks.forEach(change);
    assert.deepEqual(selectFaceStyleReferences({ region, lookbook: modified, styleGuides }), []);
  }
});

test('comparison renders real crops, a photo observation, actionable styling and working library/guide actions', () => {
  const html = render({ profile: { makeupStyleId: 'dewy_glow' } });
  assert.equal((html.match(/<article class="comparison-reference">/g) || []).length, 2);
  assert.equal((html.match(/class="comparison-reference-photo"/g) || []).length, 2);
  assert.ok(html.includes('Your photo'));
  assert.ok(html.includes(esc(region.observations[0])));
  assert.ok(html.includes('Style direction'));
  assert.ok(html.includes('Try this direction'));
  assert.ok(html.includes('data-open-guide="dewy_glow"'));
  assert.ok(html.includes('data-look-region="lips"'));
  assert.ok(html.includes('data-nav="looks"'));
  assert.ok(html.includes('Original photo'));
  assert.ok(html.includes('CC BY'));
  assert.ok(!html.includes('base64,private'), 'The original selfie stays in the existing photo pane.');
  assert.ok(!/similarity|beauty score|you look like|you will look/i.test(html));
});

test('uncertain photos still offer styling references without inventing a personal finding or demanding a retake', () => {
  const html = render({ region: { ...region, quality: { usable: false }, observations: ['You have deep lip lines.'] } });
  assert.ok(!html.includes('You have deep lip lines'));
  assert.ok(html.includes('Compare your lips in the photo'));
  assert.ok(html.includes('Try this direction'));
  assert.ok(!/retake|clearer photo/i.test(html));
});

test('dynamic observation, title, technique and attribution text are escaped', () => {
  const modified = structuredClone(lookbook), attack = '<img src=x onerror="alert(1)">';
  modified.looks.forEach(look => {
    look.image.credit = attack;
    for (const part of look.regions) { part.title = attack; part.description = `Try ${attack}.`; }
  });
  const html = render({ lookbook: modified, region: { ...region, observations: [attack] } });
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'));
});

test('missing library or photo produces a useful empty state without fabricated references', () => {
  assert.equal(render({ photo: null }), '');
  const html = render({ lookbook: null });
  assert.ok(html.includes('Explore the library to choose a reference'));
  assert.ok(!html.includes('<article class="comparison-reference">'));
});
