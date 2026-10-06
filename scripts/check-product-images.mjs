import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const web = new URL('../web/', import.meta.url);
const catalog = JSON.parse(await readFile(new URL('data/catalog.json', web), 'utf8'));
const images = JSON.parse(await readFile(new URL('data/product-images.json', web), 'utf8'));
assert.deepEqual(Object.keys(images).sort(), catalog.products.map(p => p.id).sort(), 'Every catalog product needs its own photo record');
let totalBytes = 0;
for (const product of catalog.products) {
  const image = images[product.id];
  assert.match(image.src, new RegExp(`^assets/products/${product.id}\\.(jpg|png|webp)$`));
  assert.ok(image.alt?.includes(product.brand), `${product.id}: missing descriptive alt text`);
  assert.equal(new URL(image.sourceUrl).protocol, 'https:');
  assert.equal(new URL(image.imageUrl).protocol, 'https:');
  const bytes = await readFile(new URL(image.src, web));
  const ext = image.src.split('.').pop();
  const isImage = ext === 'jpg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : ext === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  assert.ok(isImage, `${product.id}: file type does not match its extension`);
  assert.equal(bytes.length, image.bytes, `${product.id}: image size changed`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), image.sha256, `${product.id}: image checksum changed`);
  totalBytes += bytes.length;
}
console.log(`Verified ${catalog.products.length} bundled product photographs (${(totalBytes / 1024 / 1024).toFixed(1)} MiB), provenance and SHA-256 checksums.`);
