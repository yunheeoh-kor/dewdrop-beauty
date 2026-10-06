import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  FACE_REGIONS, MAKEUP_CATEGORIES, isMakeup, filterCatalog,
  validSavedLooks, toggleSavedLook, filterLooks, relatedProducts, cropStyle,
} from '../web/beauty-library.js';

const web = new URL('../web/', import.meta.url);
const json = async name => JSON.parse(await readFile(new URL(`data/${name}.json`, web), 'utf8'));
const regionIds = FACE_REGIONS.map(region => region.id);
const categoryIds = MAKEUP_CATEGORIES.map(category => category.id);
const https = value => assert.equal(new URL(value).protocol, 'https:');

const products = [
  { id: 'care', brand: 'Daily', product_name: 'Eye cream', category: 'Eye care' },
  { id: 'legacy', brand: 'Daily', product_name: 'Old tint', category: 'Tint' },
  { id: 'liner', brand: 'Color', product_name: 'Clean line', category: 'Pencil', makeup_category: 'eyeliner', face_regions: ['eyes'], kpop_connection: { artist: 'Mira', group: 'Bloom' } },
  { id: 'lip', brand: 'Color', product_name: 'Soft color', category: 'Gloss', makeup_category: 'lip_gloss', face_regions: ['lips'] },
];
const evidence = { care: { slots: [] }, legacy: { slots: ['lip'] } };
const library = {
  artists: [{ id: 'mira', name: 'Mira', group: 'Bloom' }, { id: 'sol', name: 'Sol', group: 'Orion' }],
  looks: [
    { id: 'mira-stage', artistId: 'mira', title: 'Stage rose', summary: 'Soft evening color', tags: ['rose'], regions: [
      { id: 'eyes', title: 'Soft eye line', description: 'Fine wing', productCategories: ['eyeliner'], productIds: [] },
      { id: 'lips', title: 'Gloss finish', description: 'Transparent shine', productCategories: ['lip_gloss'], productIds: ['legacy'] },
    ] },
    { id: 'sol-day', artistId: 'sol', title: 'Daylight', summary: 'Clean graphic lines', tags: ['graphic'], regions: [
      { id: 'eyes', title: 'Defined eyes', description: 'Precise liner', productCategories: ['eyeliner'], productIds: [] },
    ] },
  ],
};
const ids = list => list.map(item => item.id);

test('makeup filters combine category, region, brand, artist and saved products without treating eye care as makeup', () => {
  assert.equal(isMakeup(products[0], evidence), false);
  assert.equal(isMakeup(products[1], evidence), true);
  assert.deepEqual(ids(filterCatalog(products, evidence, { kind: 'skincare' })), ['care']);
  assert.deepEqual(ids(filterCatalog(products, evidence, { kind: 'makeup' })), ['legacy', 'liner', 'lip']);
  assert.deepEqual(ids(filterCatalog(products, evidence, { kind: 'kpop', search: '  BLOOM  ', brand: 'Color', category: 'eyeliner', region: 'eyes', savedOnly: true, favorites: ['liner', 'lip'] })), ['liner']);
  assert.deepEqual(ids(filterCatalog(products, evidence, { search: 'lip gloss' })), ['lip']);
  assert.deepEqual(filterCatalog(products, evidence, { category: 'eyeliner', region: 'lips' }), []);
  assert.deepEqual(filterCatalog(products, evidence, { savedOnly: true, favorites: [] }), []);
});

test('saved look migration drops stale keys and whole looks and individual regions toggle independently', () => {
  const dirty = ['mira-stage:eyes', 'mira-stage:eyes', 'removed:all', 'mira-stage:nose', null, 42];
  const before = [...dirty];
  assert.deepEqual(validSavedLooks(dirty, library), ['mira-stage:eyes']);
  assert.deepEqual(validSavedLooks({ look: 'mira-stage' }, library), []);
  const saved = toggleSavedLook(dirty, library, 'mira-stage');
  assert.deepEqual(saved, ['mira-stage:eyes', 'mira-stage:all']);
  assert.deepEqual(toggleSavedLook(saved, library, 'mira-stage', 'eyes'), ['mira-stage:all']);
  assert.deepEqual(toggleSavedLook(saved, library, 'mira-stage'), ['mira-stage:eyes']);
  assert.deepEqual(toggleSavedLook(saved, library, 'mira-stage', 'nose'), saved);
  assert.deepEqual(dirty, before);
});

test('look search and saved-only browsing retain the exact saved face region', () => {
  const saved = ['mira-stage:eyes', 'mira-stage:all', 'sol-day:eyes'];
  const keys = entries => entries.map(({ look, regionId }) => `${look.id}:${regionId}`);
  assert.deepEqual(keys(filterLooks(library)), ['mira-stage:all', 'sol-day:all']);
  assert.deepEqual(keys(filterLooks(library, { search: ' BLOOM ', region: 'lips' })), ['mira-stage:lips']);
  assert.deepEqual(keys(filterLooks(library, { search: 'transparent shine' })), ['mira-stage:all']);
  assert.deepEqual(keys(filterLooks(library, { search: 'graphic', artistId: 'sol' })), ['sol-day:all']);
  assert.deepEqual(keys(filterLooks(library, { savedOnly: true, saved, artistId: 'mira' })), ['mira-stage:all', 'mira-stage:eyes']);
  assert.deepEqual(keys(filterLooks(library, { savedOnly: true, saved: ['mira-stage:eyes'] })), ['mira-stage:eyes']);
  assert.deepEqual(filterLooks(library, { savedOnly: true, saved, region: 'lips' }), []);
  assert.deepEqual(filterLooks(library, { region: 'nose' }), []);
});

test('related products follow the selected region and explicit catalog links without mutating catalog order', () => {
  const before = structuredClone(products);
  assert.deepEqual(ids(relatedProducts(library.looks[0], 'eyes', products)), ['liner']);
  assert.deepEqual(ids(relatedProducts(library.looks[0], 'lips', products)), ['legacy', 'lip']);
  assert.deepEqual(ids(relatedProducts(library.looks[0], 'all', products)), ['legacy', 'liner', 'lip']);
  assert.deepEqual(relatedProducts(library.looks[0], 'nose', products), []);
  assert.deepEqual(products, before);
});

test('crop rendering preserves source proportions and rejects empty or out-of-frame crops', () => {
  assert.deepEqual(cropStyle({ width: 800, height: 1200 }, { x: 0, y: 0, width: 1, height: 1 }),
    { aspect: 2 / 3, width: 100, height: 100, left: -0, top: -0 });
  assert.deepEqual(cropStyle({ width: 800, height: 1200 }, { x: 0.25, y: 0.5, width: 0.5, height: 0.25 }),
    { aspect: 4 / 3, width: 200, height: 400, left: -50, top: -200 });
  for (const crop of [null, {}, { x: -0.1, y: 0, width: 1, height: 1 },
    { x: 0, y: 0, width: 0, height: 1 }, { x: 0, y: 0.8, width: 1, height: 0.3 },
    { x: NaN, y: 0, width: 1, height: 1 }, { x: 0, y: 0, width: Infinity, height: 1 }]) {
    assert.equal(cropStyle({ width: 800, height: 1200 }, crop), null);
  }
});

test('expanded live catalog covers every makeup browsing category with valid region and evidence records', async () => {
  const catalog = await json('catalog');
  const liveEvidence = await json('evidence');
  assert.ok(catalog.products.length > 56, 'The makeup expansion must add products to the existing catalog');
  assert.equal(catalog.product_count, catalog.products.length);
  assert.equal(catalog.brand_count, new Set(catalog.products.map(product => product.brand)).size);
  assert.equal(new Set(ids(catalog.products)).size, catalog.products.length);
  for (const product of catalog.products.filter(product => isMakeup(product, liveEvidence))) {
    assert.ok(categoryIds.includes(product.makeup_category), `${product.id}: unsupported makeup category`);
    assert.ok(product.face_regions.length > 0, `${product.id}: missing face regions`);
    assert.ok(product.face_regions.every(region => regionIds.includes(region)), `${product.id}: unsupported face region`);
    const category = MAKEUP_CATEGORIES.find(category => category.id === product.makeup_category);
    assert.ok(product.face_regions.includes(category.region), `${product.id}: category region mismatch`);
    assert.ok(liveEvidence[product.id], `${product.id}: missing recommendation evidence`);
    https(product.product_url);
  }
  for (const category of categoryIds) {
    assert.ok(catalog.products.some(product => product.makeup_category === category), `${category}: empty category`);
  }
});

test('bundled K-pop looks have valid artist, region, product and category references', async () => {
  const data = await json('kpop-looks');
  const catalog = await json('catalog');
  const productIds = new Set(ids(catalog.products));
  const artistIds = new Set(ids(data.artists));
  assert.equal(data.schemaVersion, 1);
  assert.match(data.researchedOn, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(data.looks.length > 0);
  assert.equal(new Set(ids(data.looks)).size, data.looks.length);
  assert.equal(artistIds.size, data.artists.length);
  assert.deepEqual(ids(data.regions).sort(), [...regionIds].sort());
  for (const artist of data.artists) {
    assert.ok(artist.name?.trim());
    assert.ok(data.looks.some(look => look.artistId === artist.id), `${artist.id}: artist has no photo references`);
  }
  for (const look of data.looks) {
    assert.ok(artistIds.has(look.artistId), `${look.id}: missing artist`);
    for (const key of ['title', 'summary', 'editorialNote']) assert.ok(look[key]?.trim(), `${look.id}: missing ${key}`);
    https(look.source.url);
    assert.ok(look.source.title);
    assert.match(look.source.date, /^\d{4}-\d{2}-\d{2}$/);
    for (const link of look.productLinks) {
      assert.ok(productIds.has(link.productId), `${look.id}: broken product link`);
      assert.ok(['style_alternative', 'documented_campaign'].includes(link.relationship), `${look.id}: unsupported product relationship`);
      assert.ok(link.scope && link.note, `${look.id}: product relationship needs its scope and note`);
      https(link.sourceUrl);
      if (link.relationship === 'documented_campaign') assert.match(link.evidenceDate, /^\d{4}-\d{2}-\d{2}$/);
    }
    assert.deepEqual(ids(look.regions).sort(), [...regionIds].sort(), `${look.id}: incomplete regional views`);
    for (const region of look.regions) {
      assert.ok(region.title && region.description, `${look.id}/${region.id}: missing description`);
      assert.ok(cropStyle(look.image, region.crop), `${look.id}/${region.id}: invalid crop`);
      assert.ok(region.productCategories.length > 0, `${look.id}/${region.id}: missing product types`);
      assert.ok(region.productCategories.every(category => categoryIds.includes(category)), `${look.id}/${region.id}: missing category`);
      assert.ok(region.productIds.every(id => productIds.has(id)), `${look.id}/${region.id}: missing product`);
      assert.ok(relatedProducts(look, region.id, catalog.products).length > 0, `${look.id}/${region.id}: no browsable products`);
    }
  }
});

test('every displayed K-pop photo is bundled with safe paths, attribution, a license and matching bytes', async () => {
  const data = await json('kpop-looks');
  for (const look of data.looks) {
    const image = look.image;
    assert.equal(image.displayAllowed, true, `${look.id}: photo must have display rights`);
    assert.match(image.src, /^assets\/looks\/[a-z0-9-]+\.(jpg|png|webp)$/);
    assert.ok(image.alt?.trim() && image.credit?.trim() && image.license?.trim(), `${look.id}: missing attribution`);
    for (const key of ['sourceUrl', 'imageUrl', 'licenseUrl']) https(image[key]);
    assert.ok(Number.isInteger(image.width) && image.width > 0);
    assert.ok(Number.isInteger(image.height) && image.height > 0);
    const bytes = await readFile(new URL(image.src, web));
    const ext = image.src.split('.').pop();
    const hasSignature = ext === 'jpg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : ext === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    assert.ok(hasSignature, `${look.id}: incorrect photo format`);
    assert.equal(bytes.length, image.bytes, `${look.id}: incorrect photo size`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), image.sha256, `${look.id}: incorrect photo checksum`);
  }
});
