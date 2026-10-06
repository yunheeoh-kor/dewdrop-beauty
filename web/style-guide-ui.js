import { STYLE_PALETTES, findGuide, guideProducts, guidePreferenceSummary } from './style-guides.js';

export function createStyleGuideUI({ data, library, products, evidence, getProfile, applyGuide, nav, render, esc, icon, productCard, productImage }) {
  let kind = 'makeup';
  const switcher = () => `<div class="library-switch" aria-label="Inspiration library"><button class="chip" data-nav="looks">Artist references</button><button class="chip active" data-nav="guides" aria-current="page">Makeup & skincare styles</button></div>`;
  function swatches(guide) {
    return `<div class="guide-palette" aria-label="Illustrative style palette">${(STYLE_PALETTES[guide.id] || ['#c5d0bd','#9ead93','#d6c6af']).map(color=>`<span style="background:${color}"></span>`).join('')}</div>`;
  }
  function guideCard(guide) {
    const selected = getProfile()?.[`${kind}StyleId`] === guide.id;
    return `<article class="guide-card"><div class="guide-card-top"><span class="eyebrow">${kind === 'makeup' ? 'Makeup direction' : 'Skincare approach'}</span>${swatches(guide)}</div><h2><button data-open-guide="${esc(guide.id)}">${esc(guide.title)}</button></h2><p>${esc(guide.summary)}</p><div class="guide-product-strip" aria-label="Products in this guide">${guide.selections.slice(0,3).map(s=>products.find(p=>p.id===s.productId)).filter(Boolean).map(p=>`<button data-detail="${esc(p.id)}" aria-label="View ${esc(p.brand+' '+p.product_name)}">${productImage(p)}</button>`).join('')}</div><div class="row between"><button class="text-btn" data-open-guide="${esc(guide.id)}">Explore this ${kind === 'makeup' ? 'style' : 'routine'} ${icon('arrow')}</button>${selected?'<span class="pill">Your direction</span>':''}</div></article>`;
  }
  function index() {
    return `${switcher()}<section class="guide-intro"><p class="eyebrow">MORE THAN ONE WAY TO BE YOU</p><h1>Change the mood.<br><em>Choose your direction.</em></h1><p>Subtle or expressive. Dewy or softly matte. A simple skincare routine or extra hydration. Pick a direction to see a different product edit.</p><span>Every style is open to everyone.</span></section><div class="filterbar" aria-label="Guide category"><button class="chip ${kind==='makeup'?'active':''}" data-guide-kind="makeup" aria-pressed="${kind==='makeup'}">Makeup styles · ${data.makeup.length}</button><button class="chip ${kind==='skincare'?'active':''}" data-guide-kind="skincare" aria-pressed="${kind==='skincare'}">Skincare routines · ${data.skincare.length}</button></div><div class="guide-grid">${data[kind].map(guideCard).join('')}</div>`;
  }
  function detail(guide, guideKind) {
    kind = guideKind;
    let shelf;
    try { shelf = guideProducts(guide, products, evidence, getProfile()); }
    catch { shelf = {list:[],excluded:[],error:'Review your budget and preference answers to see options for this guide.'}; }
    const selected = getProfile()?.[`${kind}StyleId`] === guide.id;
    const references = library.looks.filter(l=>l.styleIds?.includes(guide.id));
    return `${switcher()}<button class="text-btn" data-nav="guides">${icon('back')} All ${kind==='makeup'?'makeup styles':'skincare routines'}</button><section class="guide-detail-intro"><div><p class="eyebrow">${kind==='makeup'?'MAKEUP DIRECTION':'SKINCARE APPROACH'} · FOR EVERYONE</p><h1>${esc(guide.title)}</h1><p>${esc(guide.summary)}</p>${swatches(guide)}</div><aside class="guide-choice"><h3>${selected?'Your selected direction':'Make this your direction'}</h3><p>${guidePreferenceSummary(guide,kind).map(esc).join(' · ') || 'A simple set of routine priorities.'}</p><button class="btn" data-apply-guide="${esc(guide.id)}">${selected?'Reapply preferences':'Use these preferences'} ${icon('check')}</button><p class="small muted">Sets the style preferences shown here and this guide’s priorities. Choose your kit categories separately.</p>${selected?'<button class="text-btn" data-nav="recommendations">View my updated suggestions →</button>':''}</aside></section><section class="guide-instructions"><h2>${kind==='makeup'?'Make the look your own':'Build it around your day'}</h2>${guide.colorNotes?`<p>${esc(guide.colorNotes)}</p>`:''}${guide.technique?`<p>${esc(guide.technique)}</p>`:''}<ol>${guide.steps.map(step=>`<li>${esc(step)}</li>`).join('')}</ol></section><section><div class="section-head"><div><p class="eyebrow">A DIFFERENT EDIT FOR EACH DIRECTION</p><h2>${kind==='makeup'?'The style shelf':'Routine options'}</h2><p>Individual options, not a combined kit. Your exclusions apply; shade, formula and removal checks still matter.</p></div><span class="saved-count">${shelf.list.length} options</span></div>${shelf.error?`<div class="hint">${esc(shelf.error)}</div>`:''}${shelf.excluded.length?`<p class="small muted guide-excluded">${shelf.excluded.length} options hidden by your product requirements or budget.</p>`:''}<div class="guide-shelf">${shelf.list.map(({product,selection,evaluation})=>`<div class="guide-shelf-item">${productCard(product)}<p>${esc(selection.reason)}</p><span class="pill ${evaluation.state==='eligible'?'':'warn'}">${evaluation.state==='eligible'?'Profile checks passed':'Checks still needed'}</span>${evaluation.reasons.length?`<details><summary>Review product checks</summary>${evaluation.reasons.map(r=>`<p>${esc(r)}</p>`).join('')}</details>`:''}</div>`).join('')||(!shelf.error?'<div class="empty"><p>No products in this edit pass your current filters. Your existing choices are still saved.</p><button class="btn secondary" data-nav="recommendations">Review my preferences</button></div>':'')}</div></section>${references.length?`<section><div class="section-head"><div><h2>See the direction in a reference</h2><p>Editorial inspiration from real event photos.</p></div></div><div class="guide-reference-grid">${references.slice(0,4).map(look=>{const artist=library.artists.find(a=>a.id===look.artistId);return `<button data-look-open="${esc(look.id)}" class="guide-reference"><img src="${esc(look.image.src)}" alt="${esc(look.image.alt)}" loading="lazy"><span><strong>${esc(artist.name)}</strong>${esc(look.title)}<small>${esc(look.image.credit)} · ${esc(look.image.license)}</small></span></button>`;}).join('')}</div></section>`:''}`;
  }
  function page() {
    const id = location.hash.split('/')[1];
    const found = findGuide(data,id);
    return !id ? index() : found ? detail(found.guide,found.kind) : `<div class="empty"><h2>This guide isn’t available.</h2><button class="btn" data-nav="guides">Browse styles and routines</button></div>`;
  }
  function handleClick(el) {
    if (el.hasAttribute('data-guide-kind')) { kind = el.dataset.guideKind; render(); }
    else if (el.hasAttribute('data-open-guide')) nav(`guides/${el.dataset.openGuide}`);
    else if (el.hasAttribute('data-apply-guide')) { const found=findGuide(data,el.dataset.applyGuide); if(found)applyGuide(found.guide,found.kind); }
    else return false;
    return true;
  }
  function hero() {
    return `<div class="beauty-examples"><p class="eyebrow">YOUR FACE. YOUR OWN DIRECTION.</p><div class="example-duo"><button class="example-portrait" data-open-guide="barely_there" aria-label="Subtle definition: explore barely-there makeup"><img src="assets/editorial/subtle-definition.jpg" width="640" height="800" alt="" decoding="async"><span>Subtle definition<small>Barely-there makeup</small></span></button><button class="example-portrait" data-open-guide="soft_rose" aria-label="A touch of rose: explore soft rose makeup"><img src="assets/editorial/touch-of-rose.jpg" width="640" height="800" alt="" decoding="async"><span>A touch of rose<small>Soft color & glow</small></span></button></div><div class="example-paths"><button data-open-guide="soft_smoky">Smoky eyes</button><button data-open-guide="hydration_comfort">Hydration</button><button data-nav="guides">Find your style ${icon('arrow')}</button></div><p class="example-note">AI-created portraits · every direction is yours to explore</p></div>`;
  }
  function teaser() {
    return `<section class="guide-home-banner"><div><p class="eyebrow">YOUR MOOD CAN CHANGE</p><h2>One shelf. Many directions.</h2><p>Explore ${data.makeup.length} makeup styles and ${data.skincare.length} skincare routines, with different techniques and product edits.</p></div><button class="btn secondary" data-nav="guides">Explore styles & routines ${icon('arrow')}</button></section>`;
  }
  return {render:page,handleClick,hero,teaser};
}
