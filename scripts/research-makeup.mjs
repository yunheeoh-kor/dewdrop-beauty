// Fetch explicit official product-page snapshots for the curated makeup expansion.
// This helper only writes a temporary research cache; it does not mutate the app catalog.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const domains = { tirtir: 'tirtir.global', amuse: 'amuseseoulmakeup.com', clio: 'clubclio.shop', romand: 'romandbeauty.com', missha: 'misshaus.com' };
const selection = JSON.parse(await readFile('research/makeup-selection.json', 'utf8'));
await mkdir('.catalog-tools/makeup', { recursive: true });
const sources = [];
function text(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&#39;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g, ' ').trim();
}
for (let start = 0; start < selection.length; start += 6) {
  await Promise.all(selection.slice(start, start + 6).map(async ([brand, handle, category], index) => {
    const id = `kbeauty-${String(57 + start + index).padStart(3, '0')}`;
    const url = `https://${domains[brand]}/products/${handle}`;
    const [page, json, commerce] = await Promise.all([fetch(url), fetch(`${url}.json`), fetch(`${url}.js`)]);
    if (!page.ok || !json.ok || !commerce.ok) throw new Error(`${id}: ${page.status}/${json.status}/${commerce.status}`);
    const html = await page.text();
    const { product } = await json.json();
    const storefront = await commerce.json();
    const source = { id, brand, handle, category, url, product, storefront, bodyText: text(product.body_html ?? ''), pageText: text(html) };
    sources.push(source);
    await writeFile(`.catalog-tools/makeup/${id}.json`, JSON.stringify(source, null, 2));
    console.log(`${id} ${product.title}: ${product.variants[0]?.title}, $${product.variants[0]?.price}`);
  }));
}
sources.sort((a,b) => a.id.localeCompare(b.id));
await writeFile('.catalog-tools/makeup/sources.json', JSON.stringify(sources, null, 2));
for (const [brand, domain] of Object.entries(domains)) {
  const response = await fetch(`https://${domain}/cart.js`);
  const cart = await response.json();
  console.log(`${brand} storefront currency: ${cart.currency}`);
}
