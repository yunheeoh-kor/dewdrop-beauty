// Import the reviewed official-store makeup selection without changing historical catalog outputs.
// Run research-makeup.mjs first to refresh the temporary source cache; re-review facts before import.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { applyStyleEvidence } from './apply-style-evidence.mjs';
const read = async path => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
const save = async (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
const sources = await read('.catalog-tools/makeup/sources.json');
const catalog = await read('web/data/catalog.json');
const evidence = await read('web/data/evidence.json');
const images = await read('web/data/product-images.json');
const date = '2026-10-05';
// Curated facts refer only to the selected source/variant, never reviews or recommended products.
// [net content, selected ingredients, intended appearance, finish, eye format]
const facts = {
  57: ['30 ml / 1.01 fl oz', ['Dimethicone', 'Silica', 'Glycerin'], 'Prepares an even-looking base and softens the appearance of pores and excess shine.', 'matte'],
  58: ['30 ml / 1.01 fl oz', ['Glycerin', 'Niacinamide', 'Butylene glycol'], 'Adds moisture and a luminous-looking base before complexion makeup.', 'dewy'],
  59: ['30 ml / 1.01 fl oz', ['Hibiscus extract', 'Propolis extract', 'Astaxanthin'], 'Evens visible skin tone with radiant liquid coverage.', 'dewy'],
  60: [null, ['Hyaluronic acid complex'], 'Offers targeted coverage using a liquid end and a balm end for a smoother-looking finish.'],
  61: [null, ['Niacinamide', 'Vitamin C'], 'Creates an even-looking complexion with high coverage and a matte finish.', 'matte'],
  62: ['80 ml / 2.70 fl oz', [], 'Sets finished makeup with a fine mist and helps reduce the appearance of excess shine.'],
  63: ['5 g', ['Silica', 'Dimethicone', 'Sodium hyaluronate'], 'Sets makeup and blurs the appearance of pores with a lightweight powder.', 'matte'],
  64: ['80 ml', ['Alcohol Denat.', 'Oryza Sativa (Rice) Extract', 'Glycerin'], 'Adds a radiant finish and helps set makeup.', 'dewy'],
  65: [null, ['Diisostearyl malate', 'Synthetic wax', 'Silica'], 'Defines or softly blends the lip outline for a fuller-looking lip shape.'],
  66: [null, ['Dimethicone', 'Mica', 'Tocopherol'], 'Adds pink-toned shimmer to facial high points.'],
  67: [null, ['Methyl trimethicone', 'Synthetic fluorphlogopite', 'Silica'], 'Accents the under-eye area with a pale, sparkling pencil.', null, 'pencil'],
  68: ['3 g', ['Octyldodecanol', 'Diisostearyl malate', 'Mica'], 'Adds sheer-looking color and moisture radiance to lips, cheeks or eyelids.', 'dewy'],
  69: ['0.14 oz', ['Diphenyl dimethicone', 'Diisostearyl malate', 'Diglycerin'], 'Adds a watery layer of lip color with a dewy-looking shine.', 'dewy'],
  70: [null, ['Titanium dioxide', 'Niacinamide', 'Adenosine', 'Tocopherol'], 'Evens visible skin tone with a lightweight liquid base.'],
  71: [null, ['Chamomile flower water', 'Panthenol', 'Hyaluronic acid complex'], 'Provides a lightweight, luminous layer of complexion coverage.', 'dewy'],
  72: [null, ['Cyclopentasiloxane', 'Titanium dioxide', 'Glycerin'], 'Provides targeted coverage for uneven-looking areas with a narrow applicator.'],
  73: [null, [], 'Defines lips with a soft pencil and a blurred-looking edge.'],
  74: [null, [], 'Combines twelve shades for layered matte, satin and shimmer eye looks.'],
  75: [null, ['Jojoba seed oil', 'Peach extract'], 'Adds softly blended lip color with a blurred finish.'],
  76: [null, ['Diisostearyl malate', 'Squalane', 'Fragrance'], 'Adds glossy, buildable lip color.', 'dewy'],
  77: [null, ['Cyclopentasiloxane', 'Synthetic wax', 'Silica'], 'Defines the lash line with a creamy pencil.', null, 'pencil'],
  78: [null, ['Butylene glycol', 'Alcohol', 'Phenoxyethanol'], 'Draws a precise dark lash line with a fine brush.'],
  79: [null, ['Dimethicone', 'Synthetic fluorphlogopite', 'Silica'], 'Adds contrasting highlighting textures to the cheekbones and other facial high points.'],
  80: [null, ['Synthetic wax', 'Hydrogenated soybean oil', 'Stearic acid'], 'Fills brow gaps and draws fine-looking brow definition.', null, 'pencil'],
  81: [null, ['Talc', 'Mica', 'Silica'], 'Builds soft facial shading along contours, including the nose and jaw.'],
  82: [null, ['Talc', 'Mica', 'Silica'], 'Combines eye shadow, blush and highlighting colors in one palette.'],
  83: [null, ['Mica', 'Synthetic wax', 'Phenyl trimethicone'], 'Adds a brightened, shimmering accent beneath the eyes.', null, 'pencil'],
  84: [null, ['Mango seed oil', 'Olive oil', 'Jojoba oil'], 'Adds a transparent glassy shine to lips.', 'dewy'],
  85: [null, ['Isododecane', 'Trimethylsiloxysilicate', 'Talc'], 'Defines lashes with the selected long-lash curling brush.', null, 'mascara'],
  86: [null, ['Iron oxides', 'Polyethylene', 'Microcrystalline wax'], 'Uses a narrow pencil to fill brow gaps with fine strokes.', null, 'pencil'],
  87: [null, [], 'Layers ten glitter shades for sparkling eye accents.'],
  88: [null, [], 'Combs and colors brow hairs for a more uniform-looking brow.', null, 'brow_mascara'],
  89: [null, [], 'Adds a dewy wash of cheek color with a cream stick.', 'dewy'],
  90: [null, [], 'Defines the lip edge and blends the outline using an attached brush.'],
  91: [null, [], 'Adds buildable lip color with a softly blurred matte finish.', 'matte'],
  92: [null, [], 'Adds sheer color and a high-shine gloss finish.', 'dewy'],
  93: [null, [], 'Uses the selected volume brush to build fuller-looking lashes.', null, 'mascara'],
  94: ['40 ml / 1.35 fl oz', ['Moringa oleifera seed oil', 'Glycerin', 'Pearl powder'], 'Prepares skin for base makeup with a luminous-looking finish.', 'dewy'],
  95: ['5 g', ['Nylon-12', 'Silica', 'Synthetic fluorphlogopite'], 'Sets makeup and reduces visible shine with a translucent pressed powder.', 'matte'],
  96: [null, ['Honey extract', 'Mango seed butter', 'Raspberry seed oil', 'Apricot oil', 'Fragrance'], 'Adds moisturizing-feeling lipstick color with a glossy finish.', 'dewy'],
  97: ['50 ml / 1.7 fl oz', ['Glycerin', 'Hyaluronic acid', 'Ceramide'], 'Offers medium-to-high complexion coverage and a more even-looking skin tone.'],
  98: [null, ['Bamboo water', 'Baobab fruit extract', 'Witch hazel extract'], 'Provides portable, buildable complexion coverage in a cushion compact.'],
};
const labels = { primer: 'Makeup primer', cushion: 'Cushion foundation', foundation: 'Liquid foundation / BB cream', concealer: 'Concealer', powder: 'Setting powder', setting_spray: 'Makeup setting spray', blush: 'Blush', contour: 'Contour / shading', highlighter: 'Highlighter', eyeshadow: 'Eye shadow', eyeliner: 'Eyeliner', mascara: 'Mascara', brow: 'Brow makeup', lip_tint: 'Lip tint', lipstick: 'Lipstick', lip_gloss: 'Lip gloss', lip_liner: 'Lip liner' };
const region = { primer:'face', cushion:'face', foundation:'face', concealer:'face', powder:'face', setting_spray:'face', blush:'cheeks', contour:'cheeks', highlighter:'cheeks', eyeshadow:'eyes', eyeliner:'eyes', mascara:'eyes', brow:'brows', lip_tint:'lips', lipstick:'lips', lip_gloss:'lips', lip_liner:'lips' };
const slot = { face:'base', cheeks:'cheek', eyes:'eyes', brows:'eyes', lips:'lip' };
const oldCategories = { 25:'lip_tint', 26:'blush', 27:'lip_gloss', 28:'mascara', 29:'eyeliner', 30:'lip_tint', 31:'lip_tint', 32:'lip_tint', 37:'cushion', 38:'lip_gloss', 43:'cushion', 44:'cushion', 47:'lip_tint', 48:'blush', 49:'lip_tint', 50:'brow' };
for (const p of catalog.products) {
  const category = oldCategories[Number(p.id.split('-')[1])];
  if (category) { p.makeup_category = category; p.face_regions = [region[category]]; }
}
const existing = Object.fromEntries(catalog.products.map(p => [p.id, p]));
const brandLinks = { TIRTIR: existing['kbeauty-043'].kpop_connection, AMUSE: existing['kbeauty-048'].kpop_connection, MISSHA: existing['kbeauty-055'].kpop_connection };
const fit = {
  primer:'Customers preparing the complexion for color makeup.', cushion:'Customers who prefer a portable complexion compact; a shade match is still required.',
  foundation:'Customers seeking all-over complexion coverage; a shade match is still required.', concealer:'Customers seeking targeted coverage; the correct shade depends on the intended use.',
  powder:'Customers who want to set complexion makeup and soften visible shine.', setting_spray:'Customers who want a finishing mist for their makeup.',
  blush:'Customers seeking visible cheek color.', contour:'Customers creating soft face, nose or jaw definition.', highlighter:'Customers adding shimmer to facial high points.',
  eyeshadow:'Customers adding color or shimmer around the eyes.', eyeliner:'Customers defining the lash line.', mascara:'Customers adding definition to lashes.',
  brow:'Customers shaping or filling brows.', lip_tint:'Customers seeking buildable lip color.', lipstick:'Customers who prefer lip color in a lipstick format.',
  lip_gloss:'Customers who want a shiny lip finish.', lip_liner:'Customers defining or softly blending the lip outline.',
};
const dimensions = ['daily_skin_feel', 'ordered_goals', 'texture', 'application_simplicity', 'finish', 'chosen_color_family', 'wear', 'chosen_effect', 'format', 'coverage'];
const audit = [];
for (const source of sources) {
  const { id, product: raw, category, url, storefront } = source;
  const n = Number(id.split('-')[1]);
  const [size, ingredients, benefit, finish, format] = facts[n];
  const v = storefront.variants[0];
  const photo = v.featured_image ?? raw.images.find(i => i.variant_ids.includes(v.id)) ?? raw.images[0];
  if (!photo?.src) throw new Error(`Missing official photograph for ${id}`);
  const sourceImage = new URL(photo.src.startsWith('//') ? `https:${photo.src}` : photo.src);
  sourceImage.searchParams.set('width', '800');
  let bytes;
  if (images[id]?.imageUrl === sourceImage.href) {
    bytes = await readFile(`web/${images[id].src}`);
    if (createHash('sha256').update(bytes).digest('hex') !== images[id].sha256) throw new Error(`Existing image checksum changed: ${id}`);
  } else {
    const response = await fetch(sourceImage);
    if (!response.ok) throw new Error(`${id} photograph: ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  const extension = bytes[0] === 0xff && bytes[1] === 0xd8 ? 'jpg' : bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'png' : bytes.toString('ascii',0,4) === 'RIFF' ? 'webp' : null;
  if (!extension) throw new Error(`Unexpected image type for ${id}`);
  const imageSrc = `assets/products/${id}.${extension}`;
  await writeFile(`web/${imageSrc}`, bytes);
  const brand = source.brand === 'clio' ? (raw.title.startsWith('[PERIPERA]') ? 'peripera' : 'CLIO') : ({tirtir:'TIRTIR',amuse:'AMUSE',romand:'rom&nd',missha:'MISSHA'})[source.brand];
  const name = raw.title.replace(/^\[(?:CLIO|PERIPERA)\]\s*/, '').replace(/^Cardi B's PICK \|\s*/, '');
  const shade = v.title === 'Default Title' || n === 94 ? null : v.title;
  const variantUrl = `${url}?variant=${v.id}`;
  const current = v.price / 100;
  const comparison = v.compare_at_price / 100;
  const price = comparison > current ? comparison : current;
  const priceBasis = `Official ${source.brand === 'missha' ? 'U.S.' : 'global'} storefront USD ${comparison > current ? `regular reference price; observed sale $${current.toFixed(2)} excluded` : 'displayed price; no higher regular reference verified'}. Selected variant ${v.title}. Excludes tax, duties and shipping; U.S. checkout delivery and final charges not verified.`;
  const regions = n === 68 ? ['cheeks','lips','eyes'] : n === 82 ? ['eyes','cheeks'] : category === 'contour' || category === 'highlighter' ? ['cheeks','face'] : category === 'concealer' ? ['face','eyes'] : [region[category]];
  let connection = brandLinks[brand] ? structuredClone(brandLinks[brand]) : null;
  if (connection) {
    connection.association_scope = 'Brand-level';
    connection.connection_summary = `The dated source documents ${connection.artist} in a ${brand} brand campaign. It does not establish use or endorsement of this product or its selected shade.`;
    connection.suggested_selling_point = `Makeup from ${brand}, a brand with a documented ${connection.evidence_date.slice(0,4)} campaign association with ${connection.artist}.`;
  }
  const sizeSource = [59,62].includes(n) ? 'official bottle photograph' : 'brand page text';
  const note = `Official product page and variant API observed on ${date}; storefront cart API confirms USD. ${size ? `Net content verified from ${sizeSource}: ${size}.` : 'Net content not verified in reviewed page text; exact-size identity remains unresolved.'} ${ingredients.length ? 'Selected ingredient presence only; the complete exact-shade INCI has not been reviewed.' : 'No verified ingredient extraction added; empty ingredient list means unknown.'} Cosmetic appearance summaries are editorial paraphrases. No U.S. broad-spectrum sunscreen clearance or product-specific removal evidence is inferred.${n === 96 ? ' Live official page and variant API showed $13; an older indexed web result showed $15 and was not used.' : ''}${n === 93 ? ' The API comparison value was below the current selling price; it was not treated as a regular price or discount.' : ''}`;
  const p = {
    id, brand, product_name: `${name}${shade ? ` — ${shade}` : ''}`, category: labels[category], makeup_category: category, face_regions: regions,
    size: size ?? 'Net content not verified', size_verified: Boolean(size), shade, price_usd: price, price_basis: priceBasis,
    key_ingredients: ingredients, ideal_customers: `Inferred: ${fit[category]}`, intended_benefit: benefit,
    product_url: variantUrl, price_source_url: `${url}.js`, ingredient_source_url: variantUrl,
    availability: v.available ? 'Selected variant marked available by official storefront on the research date; checkout not verified.' : 'Selected variant marked unavailable by official storefront on the research date.',
    evidence_notes: note, researched_on: date, kpop_connection: connection, currency:'USD', market:'United States',
    budget_tier: price <= 15 ? 'Budget' : price <= 30 ? 'Mid-range' : 'Premium',
    ingredient_scope: ingredients.length ? 'Selected ingredients only; not the complete exact-shade INCI' : 'Ingredient information not verified',
    customer_fit_basis: 'Editorial inference from manufacturer-stated product format and intended appearance',
  };
  const traits = Object.fromEntries(dimensions.map(d => [d, {values:[],knownValues:[],basis:'editorial inference',url:variantUrl,date,note:'No reviewed mapping for this dimension; empty arrays mean unknown.'}]));
  const setTrait = (dimension, values, reason) => traits[dimension] = {values,knownValues:[...values],basis:'editorial inference',url:variantUrl,date,note:reason};
  if (finish) setTrait('finish',[finish],'Editorial mapping of the stated matte or radiant/glossy cosmetic appearance.');
  if (format) setTrait('format',[format],'Format verified from the product name and official instructions.');
  if ([59,61,97].includes(n)) setTrait('coverage',['more_coverage'],'Brand describes high or medium-to-high coverage; not an efficacy guarantee.');
  if ([67,77,78,80,83,86,88].includes(n)) setTrait('chosen_effect',['definition'],'Editorial mapping of the stated eye or brow definition purpose.');
  if (n === 85) setTrait('chosen_effect',['length','definition'],'Selected variant is explicitly Long Lash Curling; editorial mapping does not promise a result.');
  evidence[id] = {
    metadataVersion:'1.0.0', slots:[...new Set(regions.map(r => slot[r]))].filter(s => !(regions.includes('cheeks') && s === 'base')),
    identityVerified:Boolean(size), exactShade:shade,
    identityEvidence:{url:variantUrl,date,basis:'catalog fact',note:`Official variant ${v.id} and USD price verified. ${size ? `Net content verified in ${sizeSource}.` : 'Net content unresolved; exact-size identity is not cleared.'}`},
    traits, requirements:{fragrance_free:null,vegan:null},
    requirementEvidence:{url:variantUrl,date,basis:'catalog fact',note:'No absence or certification clearance is inferred from a partial ingredient list.'},
    broadSpectrumSPF:null,sunscreenEvidence:null,removal:'unknown',
    removalEvidence:{url:variantUrl,date,basis:'catalog fact',note:'No product-specific removal method or compatible remover has been established.'},
    requiredSlots:[],completeInci:false,ingredients,aliasesReviewed:false,
    notes:[note,'Fine makeup categories and face regions support browsing. Coarse planning slots do not establish equivalent uses or a complete routine.'],
    sources:[{url:variantUrl,date,scope:'Official product identity and cosmetic-format evidence'},{url:`${url}.js`,date,scope:'Official selected-variant USD price and stock snapshot'}],
  };
  // Concealer used around the eyes still belongs to base coverage, not an eye-color slot.
  if (category === 'concealer') evidence[id].slots = ['base'];
  if (ingredients.includes('Fragrance')) evidence[id].requirements.fragrance_free = false;
  images[id] = {src:imageSrc,sourceUrl:variantUrl,imageUrl:sourceImage.href,alt:`${brand} ${name}${shade ? ` in ${shade}` : ''}, official product photograph`,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),note:'Official storefront product/variant image; colors are a visual reference, not a verified shade match.'};
  existing[id] = p;
  audit.push({id,brand,product_name:p.product_name,makeup_category:category,face_regions:regions,product_url:variantUrl,variant_id:v.id,observed_currency:'USD',observed_price_usd:current,reference_price_usd:price,price_source_url:`${url}.js`,currency_source_url:`https://${new URL(url).hostname}/cart.js`,size_verified:Boolean(size),researched_on:date,image_source_url:sourceImage.href});
  console.log(`${id}: ${brand} ${category}, $${price.toFixed(2)}, ${bytes.length} image bytes`);
}
catalog.products = Object.values(existing).sort((a,b) => a.id.localeCompare(b.id));
catalog.product_count = catalog.products.length;
catalog.brand_count = new Set(catalog.products.map(p => p.brand)).size;
catalog.kpop_linked_product_count = catalog.products.filter(p => p.kpop_connection).length;
catalog.makeup_product_count = catalog.products.filter(p => p.makeup_category).length;
catalog.makeup_category_count = new Set(catalog.products.map(p => p.makeup_category).filter(Boolean)).size;
catalog.makeup_taxonomy = {version:'1.0',categories:labels,face_regions:['face','eyes','brows','cheeks','lips'],method:'Editorial product-format taxonomy. Multi-use regions are recorded only when supported by the manufacturer; this does not imply routine or shade compatibility.'};
catalog.researched_on = date;
catalog.price_method = 'Observed USD storefront prices for selected variants. Higher regular comparison prices are used only when explicitly shown; otherwise the observed selling price is recorded without claiming it is a regular price. New records explicitly flag unverified net content. Global store prices do not establish U.S. checkout availability, delivery or final charges. Excludes tax, duties, shipping, subscriptions and coupons; prices and stock can change.';
await save('web/data/catalog.json',catalog);
await applyStyleEvidence(evidence);
await save('web/data/evidence.json',evidence);
await save('web/data/product-images.json',images);
await save('research/makeup-expansion.json',{researched_on:date,added_product_count:audit.length,method:'Official product HTML, product JSON, selected-variant storefront API and cart currency were reviewed. Higher regular comparison prices are used when valid. Photographs retain provenance and SHA-256 checksums in the live manifest. Net contents and ingredient evidence are not invented when missing.',products:audit});
console.log(`Catalog: ${catalog.product_count} products / ${catalog.makeup_product_count} makeup / ${catalog.makeup_category_count} makeup categories / ${catalog.kpop_linked_product_count} K-pop brand or product associations.`);
