/** Browsing metadata is separate from evidence-gated kit recommendations. */
export const FACE_REGIONS = Object.freeze([
  { id: 'face', label: 'Complexion' }, { id: 'eyes', label: 'Eyes' },
  { id: 'brows', label: 'Brows' }, { id: 'cheeks', label: 'Cheeks' },
  { id: 'lips', label: 'Lips' },
]);
export const MAKEUP_CATEGORIES = Object.freeze([
  ['primer', 'Primer', 'face'], ['cushion', 'Cushion', 'face'],
  ['foundation', 'Foundation', 'face'], ['concealer', 'Concealer', 'face'],
  ['powder', 'Powder', 'face'], ['setting_spray', 'Setting spray', 'face'],
  ['blush', 'Blush', 'cheeks'], ['contour', 'Contour', 'cheeks'],
  ['highlighter', 'Highlighter', 'cheeks'], ['eyeshadow', 'Eyeshadow', 'eyes'],
  ['eyeliner', 'Eyeliner', 'eyes'], ['mascara', 'Mascara', 'eyes'],
  ['brow', 'Brow makeup', 'brows'], ['lip_tint', 'Lip tint', 'lips'],
  ['lipstick', 'Lipstick', 'lips'], ['lip_gloss', 'Lip gloss', 'lips'],
  ['lip_liner', 'Lip liner', 'lips'],
].map(([id, label, region]) => Object.freeze({ id, label, region })));
export const categoryLabel = id => MAKEUP_CATEGORIES.find(c => c.id === id)?.label || id;
export const regionLabel = id => FACE_REGIONS.find(r => r.id === id)?.label || 'Full look';
export const isMakeup = (p, evidence = {}) => Boolean(p.makeup_category) ||
  (evidence[p.id]?.slots || []).some(slot => ['base', 'eyes', 'cheek', 'lip'].includes(slot));

export function filterCatalog(products, evidence, { search = '', brand = '', kind = 'all', category = '', region = '', savedOnly = false, favorites = [] } = {}) {
  const query = search.trim().toLocaleLowerCase();
  return products.filter(p => {
    const makeup = isMakeup(p, evidence);
    const words = [p.brand, p.product_name, p.category, categoryLabel(p.makeup_category),
      ...(p.face_regions || []).map(regionLabel), p.kpop_connection?.artist, p.kpop_connection?.group].join(' ').toLocaleLowerCase();
    return (!query || words.includes(query)) && (!brand || p.brand === brand) &&
      (!savedOnly || favorites.includes(p.id)) && (!category || p.makeup_category === category) &&
      (!region || (p.face_regions || []).includes(region)) &&
      (kind === 'all' || kind === 'makeup' && makeup || kind === 'skincare' && !makeup || kind === 'kpop' && p.kpop_connection);
  });
}

export const lookSaveKey = (lookId, region = 'all') => `${lookId}:${region}`;
export function validSavedLooks(saved, library) {
  if (!Array.isArray(saved)) return [];
  const keys = new Set(library.looks.flatMap(look => [lookSaveKey(look.id), ...look.regions.map(r => lookSaveKey(look.id, r.id))]));
  return [...new Set(saved.filter(key => typeof key === 'string' && keys.has(key)))];
}
export function toggleSavedLook(saved, library, lookId, region = 'all') {
  const current = validSavedLooks(saved, library);
  const key = lookSaveKey(lookId, region);
  const allowed = validSavedLooks([key], library).length > 0;
  return !allowed ? current : current.includes(key) ? current.filter(k => k !== key) : [...current, key];
}

/** Returns individual saved regions, so saving eyes does not silently save the full look. */
export function filterLooks(library, { search = '', artistId = '', referenceGroup = '', styleId = '', region = 'all', savedOnly = false, saved = [] } = {}) {
  const keys = new Set(validSavedLooks(saved, library));
  const query = search.trim().toLocaleLowerCase();
  return library.looks.flatMap(look => {
    const artist = library.artists.find(a => a.id === look.artistId);
    const text = [artist?.name, artist?.group, look.title, look.summary, ...(look.tags || []),
      ...look.regions.flatMap(r => [r.title, r.description])].join(' ').toLocaleLowerCase();
    if ((artistId && look.artistId !== artistId) || (referenceGroup && artist?.referenceGroup !== referenceGroup) ||
      (styleId && !look.styleIds?.includes(styleId)) || (query && !text.includes(query))) return [];
    const regions = region === 'all' ? savedOnly ? ['all', ...look.regions.map(r => r.id)] : ['all'] : [region];
    return regions.filter(id => (id === 'all' || look.regions.some(r => r.id === id)) &&
      (!savedOnly || keys.has(lookSaveKey(look.id, id)))).map(regionId => ({ look, artist, regionId }));
  });
}

export function relatedProducts(look, region, products, guides = null) {
  const parts = region === 'all' ? look.regions : look.regions.filter(r => r.id === region);
  const categories = new Set(parts.flatMap(r => r.productCategories || []));
  const ids = new Set(parts.flatMap(r => r.productIds || []));
  const curated = new Map();
  for (const styleId of look.styleIds || []) {
    const guide = guides?.makeup?.find(guide => guide.id === styleId);
    for (const selection of guide?.selections || []) if (!curated.has(selection.productId)) curated.set(selection.productId, curated.size);
  }
  // Category matches are always editorial alternatives, never proof of personal use.
  const matches = products.filter(p => ids.has(p.id) || categories.has(p.makeup_category));
  return matches.sort((a, b) => (curated.get(a.id) ?? Infinity) - (curated.get(b.id) ?? Infinity) || Number(ids.has(b.id)) - Number(ids.has(a.id)));
}

export function cropStyle(image, crop) {
  const valid = crop && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(crop[k])) &&
    crop.x >= 0 && crop.y >= 0 && crop.width > 0 && crop.height > 0 &&
    crop.x + crop.width <= 1.00001 && crop.y + crop.height <= 1.00001;
  if (!valid) return null;
  const { x, y, width, height } = crop;
  const aspect = image.width > 0 && image.height > 0 ? image.width * width / (image.height * height) : width / height;
  return { aspect, width: 100 / width, height: 100 / height, left: -100 * x / width, top: -100 * y / height };
}
