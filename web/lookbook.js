import { FACE_REGIONS, categoryLabel, regionLabel, filterLooks, relatedProducts, lookSaveKey, toggleSavedLook, cropStyle } from './beauty-library.js';
import { STYLE_LABELS } from './style-guides.js';

export function createLookbook({ library, products, styleGuides, getSaved, setSaved, nav, render, toast, esc, icon, safeLink, productCard }) {
  const filters = { search: '', artistId: '', referenceGroup: '', styleId: '', region: 'all', savedOnly: false };
  let selectedRegion = 'all', currentLookId = '', productLimit = 8;
  const saved = (id, region) => getSaved().includes(lookSaveKey(id, region));
  const saveButton = (look, region, compact = false) => `<button class="${compact ? 'icon-btn' : 'btn secondary small'} ${saved(look.id, region) ? 'saved' : ''}" data-look-save="${esc(look.id)}" data-look-region="${esc(region)}" aria-pressed="${saved(look.id, region)}" aria-label="${saved(look.id, region) ? 'Unsave' : 'Save'} ${esc(look.title)} · ${regionLabel(region)}">${icon('heart')}${compact ? '' : `${saved(look.id, region) ? 'Saved' : 'Save'} ${region === 'all' ? 'full look' : regionLabel(region).toLowerCase()}`}</button>`;
  function photo(look, region = 'all', eager = false) {
    const image = look.image;
    if (!image?.displayAllowed || !/^assets\/looks\/[\w.-]+$/.test(image.src)) return '<div class="look-photo is-unavailable"><span>Photo reference unavailable</span></div>';
    const crop = region === 'all' ? null : look.regions.find(r => r.id === region)?.crop;
    const style = cropStyle(image, crop);
    const alt = `${image.alt}${style ? ` · ${regionLabel(region)} detail, cropped from original` : ''}`;
    return `<div class="look-photo ${style ? 'is-cropped' : ''}" ${style ? `style="aspect-ratio:${style.aspect};--crop-aspect:${style.aspect}"` : ''}><img src="${esc(image.src)}" alt="${esc(alt)}" loading="${eager ? 'eager' : 'lazy'}" decoding="async" ${style ? `style="width:${style.width}%;height:${style.height}%;left:${style.left}%;top:${style.top}%"` : ''}><span class="look-photo-fallback" hidden>Photo unavailable · open the source below</span></div>`;
  }
  function card({ look, artist, regionId = 'all' }) {
    const part = look.regions.find(r => r.id === regionId);
    return `<article class="look-card"><div class="look-card-art"><button class="look-open" data-look-open="${esc(look.id)}" data-look-region="${esc(regionId)}" aria-label="View ${esc(artist.name)} · ${esc(part?.title || look.title)}">${photo(look, regionId)}</button><span class="look-view-label">${regionLabel(regionId)}</span>${saveButton(look, regionId, true)}</div><div class="look-card-copy"><p class="eyebrow">${esc(artist.name)} <span>${esc(artist.group || '')}</span></p><button class="look-title" data-look-open="${esc(look.id)}" data-look-region="${esc(regionId)}">${esc(part?.title || look.title)}</button><p>${esc(part?.description || look.summary)}</p><div class="look-tags">${(look.tags || []).slice(0, 3).map(t => `<span>${esc(t)}</span>`).join('')}</div><p class="look-credit">${esc(look.image.credit)} · ${safeLink(look.image.sourceUrl, esc(look.image.license))}</p></div></article>`;
  }
  function grid() {
    const list = filterLooks(library, { ...filters, saved: getSaved() });
    return { list, html: list.map(card).join('') || `<div class="empty look-empty">${icon('book')}<h2>${filters.savedOnly ? 'Your inspiration starts here.' : 'No looks found.'}</h2><p>${filters.savedOnly ? 'Save a whole look, or just the eyes, brows, cheeks, complexion or lips that catch your eye.' : 'Try a different artist, face region or search.'}</p><button class="btn secondary" data-look-reset>Browse all looks</button></div>` };
  }
  function updateGrid() {
    const target = document.querySelector('#look-grid');
    if (!target) return;
    const { list, html } = grid();
    target.innerHTML = html;
    document.querySelector('#look-count').textContent = `${list.length} ${filters.savedOnly ? 'saved references' : 'looks'}`;
  }
  function libraryPage() {
    return `<div class="library-switch" aria-label="Inspiration library"><button class="chip active" data-nav="looks" aria-current="page">Artist references</button><button class="chip" data-nav="guides">Makeup & skincare styles</button></div><section class="lookbook-intro"><div><p class="eyebrow">THE K-POP STYLE LIBRARY</p><h1>A look you love.<br><em>Make it your own.</em></h1><p>Explore the whole mood or focus on one detail. Explore men’s and women’s references, then make any style your own.</p></div><div class="lookbook-stats"><strong>${library.artists.length}</strong><span>artists</span><strong>${library.looks.length}</strong><span>photo references</span><strong>5</strong><span>face regions</span></div></section><div class="look-style-tools"><label>References<select id="look-reference-group" aria-label="Filter reference group"><option value="">Everyone</option><option value="men" ${filters.referenceGroup==="men"?"selected":""}>Men</option><option value="women" ${filters.referenceGroup==="women"?"selected":""}>Women</option></select></label><label>Style direction<select id="look-style" aria-label="Filter reference style"><option value="">Every style</option>${Object.entries(STYLE_LABELS).map(([id,label])=>`<option value="${id}" ${filters.styleId===id?"selected":""}>${label}</option>`).join("")}</select></label></div><p class="look-style-note">Browse the references you want. Every product and style is open to everyone.</p><div class="filterbar"><label class="search">${icon('search')}<input type="search" id="look-search" value="${esc(filters.search)}" placeholder="Search artists, styles, or colors" aria-label="Search looks"></label><select id="look-artist" class="form-input brand-filter" aria-label="Filter looks by artist"><option value="">All artists</option>${library.artists.map(a => `<option value="${esc(a.id)}" ${filters.artistId === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select><button class="chip ${filters.savedOnly ? 'active' : ''}" data-look-saved-filter aria-pressed="${filters.savedOnly}">Saved references (${getSaved().length})</button></div><div class="filterbar look-region-filters" aria-label="Face region">${[{id:'all',label:filters.savedOnly?'All saved views':'Full look'}, ...FACE_REGIONS].map(r => `<button class="chip ${filters.region === r.id ? 'active' : ''}" data-look-filter-region="${r.id}" aria-pressed="${filters.region === r.id}">${r.label}</button>`).join('')}<span class="saved-count" id="look-count" aria-live="polite"></span></div><div id="look-grid" class="look-grid">${grid().html}</div><p class="look-editorial-note">Event-photo references with editorial style notes. Suggested products are inspiration, not confirmed products worn by the artists.</p>`;
  }
  function detailPage(look) {
    if (currentLookId !== look.id) { currentLookId = look.id; selectedRegion = 'all'; productLimit = 8; }
    if (selectedRegion !== 'all' && !look.regions.some(r => r.id === selectedRegion)) selectedRegion = 'all';
    const region = selectedRegion;
    const artist = library.artists.find(a => a.id === look.artistId);
    const part = look.regions.find(r => r.id === region);
    const related = relatedProducts(look, region, products, styleGuides);
    const categories = [...new Set((part ? [part] : look.regions).flatMap(r => r.productCategories || []))];
    const campaigns = (look.productLinks || []).filter(link => link.relationship === 'documented_campaign');
    return `<button class="text-btn" data-nav="looks">${icon('back')} Back to the style library</button><div class="look-detail-heading"><p class="eyebrow">${esc(artist.name)} · ${esc(artist.group || 'K-pop')}</p><h1>${esc(look.title)}</h1><p>${esc(look.summary)}</p></div><div class="look-detail-layout"><figure class="look-reference">${photo(look, region, true)}<figcaption><strong>${regionLabel(region)}${region !== 'all' ? ' · cropped view' : ' · original photo'}</strong><p>${esc(look.image.credit)} · ${safeLink(look.image.licenseUrl, esc(look.image.license))}</p>${safeLink(look.image.sourceUrl, 'Original photo & attribution')}</figcaption></figure><section class="look-breakdown"><p class="eyebrow">EXPLORE THE DETAILS</p><div class="look-region-tabs" aria-label="Choose a face region">${[{id:'all',label:'Full look'}, ...look.regions.map(r => ({id:r.id,label:regionLabel(r.id)}))].map(r => `<button class="chip ${region === r.id ? 'active' : ''}" data-look-select-region="${r.id}" aria-pressed="${region === r.id}">${r.label}</button>`).join('')}</div><h2>${esc(part?.title || 'The overall mood')}</h2><div class="look-guide-links">${(look.styleIds||[]).map(id=>`<button class="chip" data-open-guide="${esc(id)}">${esc(STYLE_LABELS[id]||id)} →</button>`).join("")}</div><p>${esc(part?.description || look.summary)}</p><div class="look-tags">${(look.tags || []).map(t => `<span>${esc(t)}</span>`).join('')}</div>${saveButton(look, region)}${region === 'all' ? `<div class="look-part-list">${look.regions.map(r => `<button data-look-select-region="${r.id}"><span>${regionLabel(r.id)}</span><strong>${esc(r.title)}</strong>${icon('arrow')}</button>`).join('')}</div>` : `<p class="small muted look-crop-note">This detail uses the same source photo. Lighting, distance and existing makeup affect visible color; exact shades are not identified.</p>`}<details class="look-source"><summary>About this reference</summary><p>${esc(look.source.title)}${look.source.date ? ` · ${esc(look.source.date)}` : ''}</p>${safeLink(look.source.url, 'Reference source')}<p>${esc(look.editorialNote || 'Editorial style interpretation; exact products worn are unverified.')}</p>${look.resolutionNote ? `<p>${esc(look.resolutionNote)}</p>` : ''}</details>${campaigns.length ? `<details class="look-source"><summary>Documented brand campaigns</summary><p>These are separate promotions, not evidence of products worn in this photo.</p>${campaigns.map(link => {const p = products.find(p => p.id === link.productId);return `<p>${esc(link.note)}</p><div class="row wrap">${p ? `<button class="text-btn" data-detail="${esc(p.id)}">${esc(p.brand + " · " + p.product_name)}</button>` : ""}${safeLink(link.sourceUrl, "Campaign source")}</div>`;}).join("")}</details>` : ""}</section></div><section class="look-products"><div class="section-head"><div><p class="eyebrow">MAKE THE STYLE YOURS</p><h2>${region === 'all' ? 'Makeup for a similar mood' : `Explore ${regionLabel(region).toLowerCase()} products`}</h2><p>An edit shaped by this look’s style and face region. Product, shade and personal fit need your own choice.</p></div><span class="saved-count">${related.length} products</span></div><div class="filterbar">${categories.map(id => `<button class="chip" data-browse-makeup="${esc(id)}">${esc(categoryLabel(id))} ${icon('arrow')}</button>`).join('')}</div><div class="product-grid">${related.slice(0, productLimit).map(productCard).join('') || '<p class="no-results">Products for this detail are still being researched.</p>'}</div>${related.length > productLimit ? '<div class="catalog-more"><button class="btn secondary" data-look-more-products>Show more products</button></div>' : ''}</section>`;
  }
  function page() {
    const id = location.hash.split('/')[1];
    const look = library.looks.find(l => l.id === id);
    if (id && !look) return `<div class="empty"><h2>This look isn’t in the library.</h2><p>Browse the available photo references.</p><button class="btn" data-nav="looks">Browse looks</button></div>`;
    return look ? detailPage(look) : libraryPage();
  }
  function handleClick(el) {
    if (el.hasAttribute('data-look-open')) {
      currentLookId = el.dataset.lookOpen; selectedRegion = el.dataset.lookRegion || 'all'; productLimit = 8; nav(`looks/${currentLookId}`);
    } else if (el.hasAttribute('data-look-save')) {
      const id = el.dataset.lookSave, region = el.dataset.lookRegion || 'all';
      setSaved(toggleSavedLook(getSaved(), library, id, region));
      const y = window.scrollY; render(); window.scrollTo(0, y);
      toast(saved(id, region) ? `${regionLabel(region)} saved to your references` : 'Reference removed from saved');
    } else if (el.hasAttribute('data-look-select-region')) {
      selectedRegion = el.dataset.lookSelectRegion; productLimit = 8; const y = window.scrollY; render(); window.scrollTo(0, y);
    } else if (el.hasAttribute('data-look-filter-region')) { filters.region = el.dataset.lookFilterRegion; render(); }
    else if (el.hasAttribute('data-look-saved-filter')) { filters.savedOnly = !filters.savedOnly; render(); }
    else if (el.hasAttribute('data-look-reset')) { Object.assign(filters, { search:'', artistId:'', referenceGroup:'', styleId:'', region:'all', savedOnly:false }); render(); }
    else if (el.hasAttribute('data-view-saved-looks')) { Object.assign(filters, { search:'', artistId:'', region:'all', savedOnly:true }); nav('looks'); }
    else if (el.hasAttribute('data-look-more-products')) { productLimit += 8; const y = window.scrollY; render(); window.scrollTo(0, y); }
    else return false;
    return true;
  }
  function handleInput(el) {
    if (el.id === 'look-reference-group') { filters.referenceGroup = el.value; filters.artistId = ''; render(); return true; }
    if (el.id === 'look-style') { filters.styleId = el.value; updateGrid(); return true; }
    if (el.id === 'look-search') { filters.search = el.value; updateGrid(); return true; }
    if (el.id === 'look-artist') { filters.artistId = el.value; updateGrid(); return true; }
    return false;
  }
  function teaser() {
    return `<section><div class="section-head"><div><p class="eyebrow">A LITTLE INSPIRATION</p><h2>From the spotlight to your shelf.</h2><p>K-pop looks, one beautiful detail at a time.</p></div><button class="text-btn" data-nav="looks">Explore looks ${icon('arrow')}</button></div><div class="look-grid look-teaser">${library.looks.slice(0, 3).map(look => card({ look, artist:library.artists.find(a => a.id === look.artistId) })).join('')}</div></section>`;
  }
  return { render: page, updateGrid, handleClick, handleInput, teaser };
}
