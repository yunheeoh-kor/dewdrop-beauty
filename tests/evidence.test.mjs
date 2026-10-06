import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const evidence = JSON.parse(readFileSync(new URL('../web/data/evidence.json', import.meta.url), 'utf8'));
const catalog = JSON.parse(readFileSync(new URL('../outputs/01a10dc6-c4fa-7151-8ca8-26510505dbce/korean-cosmetics-catalog.json', import.meta.url), 'utf8'));

test('every catalog SKU has dated evidence, without ingredient-absence clearance', () => {
  assert.deepEqual(Object.keys(evidence).sort(), catalog.products.map(p => p.id).sort());
  for (const product of catalog.products) {
    const item = evidence[product.id];
    assert.equal(item.completeInci, false);
    assert.equal(item.aliasesReviewed, false);
    assert.ok(item.identityEvidence.url.startsWith('https://'));
    for (const trait of Object.values(item.traits)) {
      assert.ok(Array.isArray(trait.values));
      assert.ok(Array.isArray(trait.knownValues));
      assert.ok(trait.values.every(value => trait.knownValues.includes(value)));
      assert.match(trait.date, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(['brand fact', 'editorial inference'].includes(trait.basis));
      assert.ok(trait.url.startsWith('https://'));
    }
  }
});

test('eye and lip care do not accidentally satisfy makeup slots', () => {
  for (const id of ['kbeauty-005', 'kbeauty-012', 'kbeauty-033']) {
    assert.deepEqual(evidence[id].slots, []);
  }
  for (const id of ['kbeauty-037', 'kbeauty-043', 'kbeauty-044']) {
    assert.ok(evidence[id].exactShade);
    assert.deepEqual(evidence[id].slots, ['base']);
    assert.equal(evidence[id].broadSpectrumSPF, null);
  }
});

test('only reviewed U.S. sunscreen labels satisfy the sunscreen slot', () => {
  const sunscreen = Object.entries(evidence).filter(([, item]) => item.slots.includes('daytime_sunscreen'));
  assert.deepEqual(sunscreen.map(([id]) => id), ['kbeauty-006', 'kbeauty-021']);
  for (const [, item] of sunscreen) {
    assert.equal(item.identityVerified, true);
    assert.ok(item.broadSpectrumSPF >= 30);
    assert.equal(item.sunscreenEvidence.market, 'United States');
  }
});

test('unverified removal and regional evidence stay unresolved', () => {
  for (const item of Object.values(evidence)) {
    if (item.slots.some(slot => ['base', 'lip', 'cheek', 'eyes'].includes(slot))) {
      assert.equal(item.removal, 'unknown');
    }
  }
  for (const id of ['kbeauty-037', 'kbeauty-038', 'kbeauty-042', 'kbeauty-053', 'kbeauty-054']) {
    assert.equal(evidence[id].identityVerified, false);
  }
});

test('brand instructions govern preparation and second-cleanser dependencies', () => {
  assert.deepEqual(evidence['kbeauty-017'].requiredSlots, ['cleanser']);
  assert.deepEqual(evidence['kbeauty-017'].slots, ['remover']);
  assert.deepEqual(evidence['kbeauty-047'].traits.application_simplicity.values, ['simple']);
  const cheek = evidence['kbeauty-048'].traits.application_simplicity;
  assert.deepEqual(cheek.values, []);
  assert.deepEqual(cheek.knownValues, ['simple']);
});

test('documented retinoid and exfoliating ingredients require an explicit product choice', () => {
  for (const id of ['kbeauty-003', 'kbeauty-005', 'kbeauty-007', 'kbeauty-015', 'kbeauty-041', 'kbeauty-042']) {
    assert.equal(evidence[id].requiresExplicitRequest, true);
    assert.ok(evidence[id].explicitRequestReason);
  }
  // A marketing mention of fermentation-derived AHA does not establish an isolated active.
  assert.notEqual(evidence['kbeauty-036'].requiresExplicitRequest, true);
});
