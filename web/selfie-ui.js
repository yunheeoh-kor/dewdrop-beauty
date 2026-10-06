import { createCameraController } from './camera.js';
import { createInstantProfile, getInstantRecommendations } from './instant.js';
import { money } from './engine.js';
import { createPhotoAnalyzer } from './photo-analysis.js';
import { getPhotoShortlist, confirmPhotoColor } from './photo-shortlist.js';
import { renderFaceStudio, facePhotoCrop, regionCrop, fitFaceCrop, nextFaceRegion, keepFaceViewport } from './face-studio.js';

// Photos deliberately live only in this closure, never in the persisted profile.
export function createSelfieExperience({ getProfile, setProfile, products, evidence, styleGuides = {}, lookbook = {}, render, nav, toast, esc, icon, productImage, goalLabels, skinLabels, slotLabel }) {
  let photo = null;
  let cameraStatus = 'idle';
  let analysis = null;
  let analysisStage = 'idle';
  let analysisError = '';
  let analysisRequest = 0;
  let selectedRegion = '';
  let faceTab = 'observation';
  let showAllRegions = false;
  let preferencesOpen = false;
  let routineOpen = false;
  let guidance = { status: 'idle', message: '', progress: 0 };
  const $ = selector => document.querySelector(selector);
  let faceAnimation = 0;
  function fitPhotoView({ animate = false, previousFrame, previousCenter } = {}) {
    const workspace = $('.face-workspace'), map = workspace?.querySelector('.face-map');
    const svg = map?.querySelector('[data-face-photo-view]');
    if (!svg || !photo || !analysis || !map.clientWidth || !map.clientHeight) return;
    if (faceAnimation) { cancelAnimationFrame(faceAnimation); faceAnimation = 0; }
    const region = analysis.regions?.find(item => item.id === selectedRegion);
    const base = region ? regionCrop(region, photo) : facePhotoCrop(analysis, photo);
    const crop = fitFaceCrop(base, photo, map.clientWidth / map.clientHeight);
    const target = [crop.x, crop.y, crop.width, crop.height];
    svg.setAttribute('viewBox', target.join(' '));
    for (const pin of map.querySelectorAll('[data-face-region]')) {
      const area = analysis.regions?.find(item => item.id === pin.dataset.faceRegion);
      if (!area?.point) continue;
      pin.style.left = `${Math.max(.06, Math.min(.94, (area.point.x * photo.width - crop.x) / crop.width)) * 100}%`;
      pin.style.top = `${Math.max(.06, Math.min(.94, (area.point.y * photo.height - crop.y) / crop.height)) * 100}%`;
    }
    if (!animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (previousFrame?.length === 4 && previousFrame.every(Number.isFinite)) {
      const start = performance.now();
      const tick = now => {
        if (!svg.isConnected) { faceAnimation = 0; return; }
        const progress = Math.min(1, (now - start) / 300), eased = 1 - (1 - progress) ** 3;
        svg.setAttribute('viewBox', target.map((value, i) => previousFrame[i] + (value - previousFrame[i]) * eased).join(' '));
        faceAnimation = progress < 1 ? requestAnimationFrame(tick) : 0;
      };
      svg.setAttribute('viewBox', previousFrame.join(' '));
      faceAnimation = requestAnimationFrame(tick);
    }
    const box = map.getBoundingClientRect();
    if (Number.isFinite(previousCenter) && map.animate) map.animate([{ transform: `translateX(${previousCenter - box.left - box.width / 2}px)` }, { transform: 'translateX(0)' }], { duration: 300, easing: 'cubic-bezier(.22,.7,.2,1)' });
    workspace.querySelector('.face-recommendations')?.animate?.([{ opacity: .35, transform: 'translateX(12px)' }, { opacity: 1, transform: 'translateX(0)' }], { duration: 220, easing: 'ease-out' });
  }
  const colorLabels = { pink: 'Pink', rose: 'Rose', coral: 'Coral', red: 'Red', nude: 'Nude', berry: 'Berry' };
  const analysisMessages = { reading_photo: 'Reading your selfie on this device…', loading_model: 'Preparing your on-device face model…', analyzing: 'Checking facial features, pore-like texture, color differences, fine lines and surface reflection…' };
  const analyzer = createPhotoAnalyzer({ onStatus(status) {
    analysisStage = status;
    if ($('#analysis-status')) $('#analysis-status').textContent = analysisMessages[status] || '';
  } });
  function refreshAnalysis() {
    if (location.hash === '#recommendations') {
      const y = window.scrollY;
      render();
      window.scrollTo(0, y);
    }
  }
  async function analyzePhoto() {
    if (!photo) return;
    const request = ++analysisRequest;
    analysis = null; analysisError = ''; analysisStage = 'reading_photo'; selectedRegion = ''; faceTab = 'observation';
    refreshAnalysis();
    try {
      const found = await analyzer.analyze(photo);
      if (request !== analysisRequest || !found) return;
      analysis = found; analysisStage = found.status;
    } catch (error) {
      if (request !== analysisRequest) return;
      analysisStage = 'error'; analysisError = error.message;
    }
    refreshAnalysis();
  }
  function clearPhoto() {
    analysisRequest += 1;
    analyzer.cancel();
    if (faceAnimation) { cancelAnimationFrame(faceAnimation); faceAnimation = 0; }
    photo = null; analysis = null; analysisStage = 'idle'; analysisError = '';
    selectedRegion = ''; showAllRegions = false; faceTab = 'observation';
  }
  const camera = createCameraController({
    onPhoto(value) {
      photo = value;
      selectedRegion = ''; showAllRegions = false;
      if (!getProfile()) setProfile(createInstantProfile());
      nav('recommendations');
      void analyzePhoto();
    },
    onError(message) {
      const target = $('#camera-error');
      if (target) target.textContent = message;
      else toast(message);
      updateCameraControls();
    },
    onStatus(status) {
      cameraStatus = status;
      updateCameraControls();
    },
    onGuidance(value) { guidance = value; updateCameraGuidance(); },
  });

  function updateCameraGuidance() {
    const status = $('#camera-guidance');
    if (status && status.textContent !== guidance.message) status.textContent = guidance.message || '';
    const progress = $('.capture-progress span');
    if (progress) progress.style.width = `${Math.max(0, Math.min(1, guidance.progress || 0)) * 100}%`;
    const frame = $('.camera-frame');
    if (frame) frame.dataset.guidance = guidance.status;
    if (cameraStatus === 'ready') {
      const auto = !['manual', 'idle'].includes(guidance.status);
      if ($('#camera-status')) $('#camera-status').textContent = auto ? 'Auto capture is on. You can also use the shutter anytime.' : 'Tap the shutter to take your selfie.';
      if ($('.camera-badge')) $('.camera-badge').innerHTML = `${icon('shield')} ${auto ? 'Auto capture' : 'Manual capture'} · on-device`;
    }
    const focus = $('#camera-focus-box'), video = $('#selfie-video'), bounds = guidance.faceBounds;
    if (!focus) return;
    focus.hidden = !bounds || cameraStatus !== 'ready' || !video?.videoWidth;
    const oval = $('.face-guide');
    if (oval && video?.videoWidth && frame) {
      const contain = Math.min(frame.clientWidth / video.videoWidth, frame.clientHeight / video.videoHeight);
      const vw = video.videoWidth * contain, vh = video.videoHeight * contain;
      oval.style.width = `${vw * .58}px`; oval.style.height = `${vh * .74}px`;
      oval.style.left = `${(frame.clientWidth - vw * .58) / 2}px`; oval.style.top = `${(frame.clientHeight - vh * .74) / 2}px`;
    }
    if (focus.hidden) return;
    // The preview uses contain and is mirrored; landmarks refer to the source.
    const scale = Math.min(frame.clientWidth / video.videoWidth, frame.clientHeight / video.videoHeight);
    const width = video.videoWidth * scale, height = video.videoHeight * scale;
    focus.style.left = `${(frame.clientWidth - width) / 2 + (1 - bounds.x - bounds.width) * width}px`;
    focus.style.top = `${(frame.clientHeight - height) / 2 + bounds.y * height}px`;
    focus.style.width = `${bounds.width * width}px`; focus.style.height = `${bounds.height * height}px`;
  }

  function updateCameraControls() {
    const live = cameraStatus === 'ready';
    const busy = ['requesting', 'processing'].includes(cameraStatus);
    const shutter = $('[data-selfie="capture"]');
    if (shutter) shutter.disabled = !live;
    const start = $('[data-selfie="camera"]');
    if (start) {
      start.hidden = live;
      start.disabled = busy;
    }
    const status = $('#camera-status');
    if (status) status.textContent = live ? 'Auto capture is on. You can also use the shutter anytime.' : busy ? (cameraStatus === 'requesting' ? 'Allow camera access to see your preview…' : 'Preparing your photo…') : 'Your camera opens only when you choose.';
    const frame = $('.camera-frame');
    if (frame) frame.classList.toggle('is-live', live);
    updateCameraGuidance();
  }

  const fileInput = '<input id="selfie-file" type="file" accept="image/jpeg,image/png,image/webp" hidden><input id="selfie-native" type="file" accept="image/*" capture="user" hidden>';
  function captureScreen() {
    return `<section id="selfie-experience" class="selfie-screen">
      <div class="page-top"><p class="eyebrow">01 · Your selfie comes first</p><h1>Your beauty starts here.</h1><p>One selfie. Your features, your style directions, your product picks.</p></div>
      <div class="capture-layout"><div class="capture-panel">
        <div class="camera-frame"><video id="selfie-video" autoplay muted playsinline aria-label="Front camera preview"></video>
          <div class="camera-placeholder">${icon('camera')}<span>A fresh start.<br>A familiar face.</span></div><div class="face-guide" aria-hidden="true"></div><div id="camera-focus-box" class="camera-focus-box" hidden aria-hidden="true"></div><span class="camera-badge">${icon('shield')} Auto capture · on-device</span>
        </div>
        <div class="capture-progress" aria-hidden="true"><span></span></div><p id="camera-guidance" class="camera-guidance" role="status" aria-live="polite"></p>
        <p id="camera-status" class="camera-status" role="status">Your camera opens only when you choose.</p>
        <p id="camera-error" class="form-error" role="alert"></p>
        <div class="capture-actions"><button class="btn" data-selfie="camera">${icon('camera')} Open front camera</button><button class="shutter" data-selfie="capture" disabled aria-label="Take selfie manually" title="Take selfie manually"><span></span></button></div>
        <div class="capture-alternatives"><button class="text-btn" data-selfie="upload">Choose a photo</button><button class="text-btn" data-selfie="native">Use device camera</button></div>${fileInput}
      </div><aside class="capture-copy"><span class="pill">Selfie → face map → your look</span><h2>Hold still.<br>We’ll take it from here.</h2><p>The camera takes your selfie automatically when one face is well positioned, clear and steady. The shutter is always there if you need it.</p>
        <ol class="photo-tips"><li><strong>Find soft, even light.</strong><span>Face a window and fit your face in the oval. Continuous focus is requested on cameras that support it.</span></li><li><strong>Give skin detail a clear view.</strong><span>For pore appearance, color differences and fine lines, use a close, unfiltered original photo with clean, bare skin and a relaxed expression. Keep hair away from your cheeks.</span></li><li><strong>Explore without losing your place.</strong><span>Tap a numbered point to zoom into the same photo. See the reason, product ideas and K-pop styles beside it, then explore skin-appearance estimates, including visible finish.</span></li></ol>
        <p class="photo-privacy">Analysis runs on this device. Photos and face measurements stay in memory and can be removed anytime. Your answers refine the recommendations; they don’t have to come first.</p>
        <button class="text-btn" data-selfie="skip">Continue without a photo ${icon('arrow')}</button>
        ${photo ? '<button class="text-btn" data-nav="recommendations">Back to my recommendations</button>' : ''}
      </aside></div></section>`;
  }

  function select(profile, field, label, choices) {
    return `<label class="field"><span>${label}</span><select data-quick="${field}">${choices.map(([value, text]) => `<option value="${value}" ${profile[field] === value ? 'selected' : ''}>${text}</option>`).join('')}</select></label>`;
  }

  function card(item) {
    if (item.owned) return `<article class="instant-card kept"><div class="owned-symbol">${icon('check')}</div><div><p class="eyebrow">${slotLabel(item.slot)}</p><h3>Keep your ${slotLabel(item.slot).toLowerCase()}</h3><p>Already on your shelf · $0 new spend</p></div></article>`;
    const p = item.product;
    const pending = item.state === 'needs_verification';
    return `<article class="instant-card"><div class="instant-art art-${Number(p.id.split('-')[1]) % 4 + 1}">${productImage(p)}</div><div class="instant-copy"><div class="row between wrap"><p class="eyebrow">${slotLabel(item.slot)}</p><span class="pill ${pending ? 'warn' : ''}">${pending ? 'Preview · needs checking' : 'In your plan'}</span></div><p class="instant-brand">${esc(p.brand)}</p><h3>${esc(p.product_name)}</h3><p>${item.score?.value != null ? `Preference fit ${Number(item.score.value).toFixed(0)} / 100` : 'An everyday starting option, selected by available evidence and price.'}</p>${pending ? `<p class="pending-reason">${esc((item.reasons || []).join(' '))}</p>` : ''}<div class="row between"><strong>${money(Math.round(p.price_usd * 100))}</strong><button class="text-btn" data-detail="${p.id}">View product ${icon('arrow')}</button></div></div></article>`;
  }

  function photoSummary(profile) {
    if (!photo) return `<div class="selfie-summary"><div class="selfie-summary-icon">${icon('camera')}</div><div><span class="pill">Make it personal</span><h2>Your selfie is the starting point.</h2><p>Take a selfie to explore your face map and photo-led style and care suggestions. You can also use your saved preferences below.</p><button class="btn small" data-nav="selfie">Take a selfie ${icon('arrow')}</button></div></div>`;
    const ready = analysis?.status === 'ready';
    if (ready) {
      requestAnimationFrame(() => { if (!faceAnimation) fitPhotoView(); });
      return renderFaceStudio({ photo, analysis, profile, products, evidence, styleGuides, lookbook, selectedId: selectedRegion, activeTab: faceTab, showAll: showAllRegions, esc, icon, productImage, lipControls: lipControls(profile) });
    }
    const busy = ['reading_photo', 'loading_model', 'analyzing'].includes(analysisStage);
    const markers = ready ? (analysis.markers || []).filter(m => Number.isFinite(m.x) && Number.isFinite(m.y)) : [];
    return `<section class="photo-analysis-panel" aria-label="Selfie analysis"><div class="selfie-summary analysis-summary">
      <div class="analyzed-photo"><img src="${photo.dataUrl}" width="${photo.width}" height="${photo.height}" alt="Your selfie with the sampled face regions marked">${markers.map(m => `<span class="sample-marker" style="left:${m.x * 100}%;top:${m.y * 100}%" title="${esc(m.label)}"></span>`).join('')}</div>
      <div class="analysis-copy"><span class="pill">${busy ? 'Analyzing on this device' : ready ? 'Photo analyzed · 1 face found' : 'On-device analysis'}</span><h2>${busy ? 'Mapping your possibilities.' : ready ? 'Colors from your selfie.' : 'Let’s get a clearer look.'}</h2>
        <p id="analysis-status" role="status" aria-live="polite">${busy ? analysisMessages[analysisStage] : analysisStage === 'error' ? esc(analysisError) : esc((analysis?.issues || []).map(i => i.message).join(' '))}</p>
        ${ready ? `<div class="photo-swatches">${['cheek', 'lip'].filter(k => /^#[0-9a-f]{6}$/i.test(analysis.samples?.[k]?.hex || '')).map(k => `<div class="photo-swatch"><span style="background:${analysis.samples[k].hex}"></span><div><strong>${k === 'lip' ? 'Lip color' : 'Cheek color'}</strong><small>${esc(analysis.samples[k].hex)} · in this light</small></div></div>`).join('')}</div>` : ''}
        <div class="row wrap analysis-actions"><button class="text-btn" data-selfie="remove">Remove photo</button>${!busy ? '<button class="text-btn" data-selfie="analyze">Analyze again</button>' : ''}${!ready && !busy ? '<button class="text-btn" data-nav="selfie">Retake selfie</button>' : ''}</div>
      </div></div></section>`;
  }

  function lipControls(profile) {
    const shortlist = getPhotoShortlist(analysis, profile, products, evidence);
    const selected = shortlist.colorFamily || analysis.colorFamily;
    return `<div class="photo-confirm row wrap"><label class="field"><span>Keep or change the color family</span><select id="photo-color-family">${Object.entries(colorLabels).map(([value,label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('')}</select></label><button class="btn small" data-selfie="use-color">Use this lip color ${icon('arrow')}</button><p class="small muted">Only the color choice you confirm is saved. It is color inspiration, not a foundation shade match.</p></div>`;
  }

  function results() {
    const profile = createInstantProfile(getProfile());
    setProfile(profile);
    const data = getInstantRecommendations(profile, products, evidence);
    const cards = data.cards || [];
    const pending = cards.some(c => c.state === 'needs_verification');
    const missing = (data.kit?.missing || []).filter(m => !cards.some(c => c.slot === m.slot));
    const selectedStyles = ['makeup', 'skincare'].map(kind => (styleGuides[kind] || []).find(guide => guide.id === profile[`${kind}StyleId`])?.title).filter(Boolean);

    return `<section id="selfie-experience" class="recommendations-screen">
      <div class="page-top row between wrap"><div><p class="eyebrow">02 · Your personal beauty map</p><h1>Your selfie. Your possibilities.</h1><p>Explore the details that shape your look. Your answers add the finishing touches.</p></div><button class="text-btn" data-selfie="refine">Edit preferences ${icon('arrow')}</button></div>
      <div class="catalog-look-link row between wrap"><span>${selectedStyles.length ? `Your directions: ${esc(selectedStyles.join(' · '))}` : 'Choose a makeup look or skincare direction to make these ideas yours.'}</span><button class="text-btn" data-nav="guides">${selectedStyles.length ? 'Change styles' : 'Explore styles'} ${icon('arrow')}</button></div>
      ${photoSummary(profile)}
      <div class="secondary-planning"><details class="preferences-disclosure" ${preferencesOpen || !photo ? 'open' : ''}><summary><span><strong>Make it yours</strong><small>Goals, budget, skin feel & preferences</small></span>${icon('down')}</summary><aside class="quick-questionnaire"><p class="eyebrow">03 · Your finishing touches</p><h2 id="quick-title" tabindex="-1">What do you want?</h2><p class="small muted">Edit any answer. Your face recommendations update right away.</p>
        <div class="field"><span>Your priorities · choose up to two</span><div class="chip-row">${Object.entries(goalLabels).map(([value, label]) => `<button class="chip ${profile.goals.includes(value) ? 'active' : ''}" data-quick-goal="${value}" aria-pressed="${profile.goals.includes(value)}">${label}</button>`).join('')}</div></div>
        ${select(profile, 'scope', 'What would you like help with?', [['skincare','Skincare essentials'],['makeup','Everyday makeup'],['both','Skincare & makeup'],['help_choose','Help me choose']])}
        <div class="fields-two"><label class="field"><span>Whole-kit budget · USD</span><input data-quick="budgetCents" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Optional" value="${profile.budgetCents == null ? '' : (profile.budgetCents / 100).toFixed(2)}"></label><label class="field"><span>Daily product limit</span><input data-quick="itemCap" type="number" min="1" max="12" step="1" value="${profile.itemCap}"></label></div>
        ${select(profile, 'skinFeel', 'How does your skin usually feel?', Object.entries(skinLabels))}
        ${select(profile, 'reactionHistory', 'Have products irritated your skin?', [['unknown','Choose an answer'],['no','No known reactions'],['yes','Yes — I have details'],['unsure','I’m not sure']])}
        ${profile.reactionHistory === 'yes' ? '<button class="text-btn" data-nav="quiz/4">Add reaction details & exclusions</button>' : ''}
        ${select(profile, 'texture', 'What texture feels good?', [['unknown','No preference'],['lightweight','Lightweight'],['rich','Rich & comforting'],['nonsticky','Not sticky']])}
        ${select(profile, 'finish', 'Your preferred finish', [['unknown','No preference'],['natural','Natural'],['dewy','Dewy / glowy'],['matte','Matte']]) + select(profile, 'colorFamily', 'Your lip or cheek colors', [['unknown','No preference'],['pink','Pink'],['rose','Rose'],['coral','Coral'],['red','Red'],['nude','Nude'],['berry','Berry']])}
        <p id="quick-error" class="form-error" role="alert"></p><div class="quick-more"><button class="text-btn" data-start>Edit full questionnaire ${icon('arrow')}</button><p class="small muted">Kept products, ingredients to avoid, shopping country, shades, and more.</p></div>
      </aside></details><details class="routine-disclosure" ${routineOpen || !photo ? 'open' : ''}><summary><span><strong>Your everyday kit</strong><small>${cards.length} starting options · ${money(data.kit?.totalCents || 0)} planned</small></span>${icon('down')}</summary><div class="instant-results"><div class="row between results-heading"><h2>Your routine essentials</h2><span class="small muted">${cards.length} suggestions</span></div>
        <p class="instant-note">${pending ? 'Preview options are ready to explore. Answer the reaction question and resolve any listed checks before adding them to your plan.' : 'Picks follow your preferences, product evidence, and budget.'}</p><button class="text-btn refine-jump" data-selfie="refine">Refine my picks ${icon('down')}</button>
        ${data.error ? `<p class="hint warning" role="alert">${esc(data.error)}</p>` : ''}
        <div id="instant-cards">${cards.map(card).join('')}${missing.map(m => `<div class="missing-card"><h3>${slotLabel(m.slot)}</h3><p>${esc(m.reason)}</p><button class="text-btn" data-start>Edit full questionnaire ${icon('arrow')}</button></div>`).join('')}${!cards.length && !missing.length ? '<div class="empty"><h2>Let’s adjust your plan.</h2><p>No suggestions fit these choices yet. Try editing your budget or product categories.</p></div>' : ''}</div>
        <p class="small muted">U.S. catalog prices, before tax and shipping. Preview options aren’t included in your planned total.</p>
        ${data.kit ? `<div class="instant-total row between wrap"><div><span class="small muted">Planned products${profile.budgetCents != null ? ` · ${money(profile.budgetCents)} budget` : ' · no budget set'}</span><strong>${money(data.kit.totalCents)}${profile.reserveCents ? ` + ${money(profile.reserveCents)} reserve` : ''}</strong></div><button class="btn secondary small" data-nav="kit">View my kit ${icon('arrow')}</button></div>` : ''}
      </div></details></div><p id="picks-status" class="sr-only" role="status" aria-live="polite"></p></section>`;
  }

  function updateProfile(field, value) {
    const profile = createInstantProfile(getProfile());
    profile[field] = value;
    if (field === 'scope') {
      profile.slots = value === 'makeup' ? ['lip'] : value === 'both' ? ['cleanser', 'moisturizer', 'daytime_sunscreen', 'lip'] : ['cleanser', 'moisturizer', 'daytime_sunscreen'];
      profile.ownedSlots = profile.ownedSlots.filter(s => profile.slots.includes(s) || s === 'remover');
      profile.swaps = {};
    }
    const now = new Date().toISOString();
    profile.answerProvenance = (profile.answerProvenance || []).filter(a => a.field !== field);
    profile.answerProvenance.push({ field, value, source: 'questionnaire', confirmed: true, updated_at: now, observation_id: null });
    setProfile(profile);
    const scroll = window.scrollY;
    if (['budgetCents', 'itemCap'].includes(field)) {
      // Keep the active input mounted so committing a number does not swallow
      // the user's Tab key or their click on the next question.
      const template = document.createElement('template');
      template.innerHTML = results();
      $('.instant-results').innerHTML = template.content.querySelector('.instant-results').innerHTML;
      const photoPanel = template.content.querySelector('.photo-analysis-panel');
      if (photoPanel && $('.photo-analysis-panel')) $('.photo-analysis-panel').replaceWith(photoPanel);
      $('#quick-error').textContent = '';
    } else {
      render();
      const control = $(`[data-quick="${field}"]`);
      if (control) control.focus({ preventScroll: true });
    }
    window.scrollTo(0, scroll);
    if ($('#picks-status')) $('#picks-status').textContent = 'Product picks updated with your preferences.';
  }

  document.addEventListener('click', async event => {
    const regionButton = event.target.closest('[data-face-region], [data-face-all], [data-face-overview], [data-face-step], [data-face-tab]');
    if (regionButton) {
      keepFaceViewport(window, () => {
        if (regionButton.hasAttribute('data-face-tab')) {
          faceTab = ['observation', 'products', 'compare'].includes(regionButton.dataset.faceTab) ? regionButton.dataset.faceTab : 'observation';
          for (const tab of document.querySelectorAll('.face-detail-tabs [data-face-tab]')) {
            const active = tab.dataset.faceTab === faceTab;
            tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
          }
          for (const panel of document.querySelectorAll('.face-detail-panel')) panel.hidden = panel.id !== `face-panel-${faceTab}`;
          const scroller = $('.face-pane-scroll');
          if (scroller) scroller.scrollTop = 0;
          $(`.face-detail-tabs [data-face-tab="${faceTab}"]`)?.focus({ preventScroll: true });
          return;
        }
        if (regionButton.hasAttribute('data-face-all')) {
          showAllRegions = !showAllRegions;
          $('#face-area-list').hidden = !showAllRegions;
          regionButton.setAttribute('aria-expanded', String(showAllRegions));
          return;
        }
        const previous = selectedRegion, workspace = $('.face-workspace');
        const photoView = workspace?.querySelector('[data-face-photo-view]');
        const previousFrame = photoView?.getAttribute('viewBox')?.split(/\s+/).map(Number);
        const box = workspace?.querySelector('.face-map')?.getBoundingClientRect();
        if (regionButton.hasAttribute('data-face-region')) selectedRegion = regionButton.dataset.faceRegion;
        else if (regionButton.hasAttribute('data-face-step')) selectedRegion = nextFaceRegion(analysis?.regions || [], selectedRegion, Number(regionButton.dataset.faceStep));
        else selectedRegion = '';
        faceTab = 'observation'; showAllRegions = false;
        const template = document.createElement('template');
        template.innerHTML = photoSummary(createInstantProfile(getProfile()));
        const replacement = template.content.querySelector('.face-workspace');
        if (workspace && replacement) workspace.replaceWith(replacement);
        fitPhotoView({ animate: true, previousFrame, previousCenter: box ? box.left + box.width / 2 : undefined });
        if (selectedRegion) $('.face-pane-title')?.focus({ preventScroll: true });
        else ($(`.face-pin[data-face-region="${previous}"]`) || $('[data-face-all]'))?.focus({ preventScroll: true });
      });
      return;
    }
    const el = event.target.closest('[data-selfie], [data-quick-goal]');
    if (!el) return;
    if (el.hasAttribute('data-quick-goal')) {
      const goals = [...createInstantProfile(getProfile()).goals];
      const value = el.dataset.quickGoal;
      if (goals.includes(value)) goals.splice(goals.indexOf(value), 1);
      else if (goals.length < 2) goals.push(value);
      else { toast('Choose up to two priorities. Remove one to choose another.'); return; }
      updateProfile('goals', goals);
      $(`[data-quick-goal="${value}"]`)?.focus({ preventScroll: true });
      return;
    }
    switch (el.dataset.selfie) {
      case 'camera':
        $('#camera-error').textContent = '';
        await camera.start($('#selfie-video'));
        break;
      case 'capture': camera.capture(); break;
      case 'upload': $('#selfie-file').click(); break;
      case 'native': $('#selfie-native').click(); break;
      case 'skip':
        camera.stop();
        if (!getProfile()) setProfile(createInstantProfile());
        nav('recommendations');
        break;
      case 'remove': clearPhoto(); render(); toast('Photo and analysis removed. Your confirmed preferences are kept.'); break;
      case 'analyze': void analyzePhoto(); break;
      case 'use-color': {
        if (!analysis || analysis.status !== 'ready') return;
        const family = $('#photo-color-family').value;
        const profile = confirmPhotoColor(createInstantProfile(getProfile()), analysis, family);
        if (!profile.slots.includes('lip')) {
          profile.slots.push('lip');
          profile.scope = profile.slots.some(s => ['cleanser', 'moisturizer', 'daytime_sunscreen'].includes(s)) ? 'both' : 'makeup';
        }
        setProfile(profile); render(); toast('Color preference saved. Your kit has been rechecked.');
        break;
      }
      case 'refine':
        preferencesOpen = true;
        $('.preferences-disclosure').open = true;
        $('#quick-title').focus(); break;
    }
  });
  document.addEventListener('toggle', event => {
    if (event.target.matches('.preferences-disclosure')) preferencesOpen = event.target.open;
    if (event.target.matches('.routine-disclosure')) routineOpen = event.target.open;
  }, true);
  document.addEventListener('keydown', event => {
    const tab = event.target.closest('.face-detail-tabs [role="tab"]');
    if (tab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const tabs = [...document.querySelectorAll('.face-detail-tabs [role="tab"]')], index = tabs.indexOf(tab);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
      tabs[next]?.click();
    }
    if (event.key === 'Escape' && showAllRegions && event.target.closest('.face-workspace')) {
      event.preventDefault(); showAllRegions = false;
      keepFaceViewport(window, () => { $('#face-area-list').hidden = true; $('[data-face-all]').setAttribute('aria-expanded', 'false'); $('[data-face-all]').focus({ preventScroll: true }); });
    }
  });
  window.addEventListener('resize', () => { updateCameraGuidance(); fitPhotoView(); });
  document.addEventListener('change', async event => {
    const el = event.target;
    if (['selfie-file', 'selfie-native'].includes(el.id)) {
      const file = el.files?.[0];
      el.value = '';
      if (file) await camera.readFile(file);
      return;
    }
    if (!el.hasAttribute('data-quick')) return;
    let value = el.value;
    const profile = createInstantProfile(getProfile());
    if (el.dataset.quick === 'budgetCents') {
      if (!el.validity.valid) { $('#quick-error').textContent = 'Enter a nonnegative budget with up to two decimal places.'; return; }
      value = value.trim() === '' ? null : Math.round(Number(value) * 100);
      if (value !== null && (!Number.isSafeInteger(value) || value < profile.reserveCents) || value === null && profile.reserveCents > 0) {
        $('#quick-error').textContent = `Your budget must cover the ${money(profile.reserveCents)} fee reserve. Edit the full questionnaire to change the reserve.`;
        return;
      }
    }
    if (el.dataset.quick === 'itemCap') {
      value = Number(value);
      if (!el.validity.valid || !Number.isInteger(value) || value < 1 || value > 12) { $('#quick-error').textContent = 'Choose between 1 and 12 daily products.'; return; }
    }
    updateProfile(el.dataset.quick, value);
  });
  window.addEventListener('pagehide', () => { camera.stop(); clearPhoto(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && camera.isActive()) camera.stop(); });
  window.addEventListener('dewdrop:camera-pause', () => { if (camera.isActive()) camera.stop(); });
  return {
    render: page => page === 'selfie' ? captureScreen() : results(),
    leave: () => camera.stop(),
    clear: () => { camera.stop(); clearPhoto(); },
  };
}
