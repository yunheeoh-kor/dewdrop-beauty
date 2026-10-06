import { createCameraController } from './camera.js';
import { createInstantProfile, getInstantRecommendations } from './instant.js';
import { money } from './engine.js';
import { createPhotoAnalyzer } from './photo-analysis.js';
import { getPhotoShortlist, confirmPhotoColor } from './photo-shortlist.js';

// Photos deliberately live only in this closure, never in the persisted profile.
export function createSelfieExperience({ getProfile, setProfile, products, evidence, render, nav, toast, esc, icon, bottle, goalLabels, skinLabels, slotLabel }) {
  let photo = null;
  let cameraStatus = 'idle';
  let analysis = null;
  let analysisStage = 'idle';
  let analysisError = '';
  let analysisRequest = 0;
  const $ = selector => document.querySelector(selector);
  const colorLabels = { pink: 'Pink', rose: 'Rose', coral: 'Coral', red: 'Red', nude: 'Nude', berry: 'Berry' };
  const analysisMessages = { reading_photo: 'Reading the photo on your device…', loading_model: 'Preparing your on-device face model…', analyzing: 'Finding the face and sampling visible colors…' };
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
    analysis = null; analysisError = ''; analysisStage = 'reading_photo';
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
    photo = null; analysis = null; analysisStage = 'idle'; analysisError = '';
  }
  const camera = createCameraController({
    onPhoto(value) {
      photo = value;
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
  });

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
    if (status) status.textContent = live ? 'Ready when you are. Tap the shutter below.' : busy ? (cameraStatus === 'requesting' ? 'Allow camera access to see your preview…' : 'Preparing your photo…') : 'Your camera opens only when you choose.';
    const frame = $('.camera-frame');
    if (frame) frame.classList.toggle('is-live', live);
  }

  const fileInput = '<input id="selfie-file" type="file" accept="image/jpeg,image/png,image/webp" hidden><input id="selfie-native" type="file" accept="image/*" capture="user" hidden>';
  function captureScreen() {
    return `<section id="selfie-experience" class="selfie-screen">
      <div class="page-top"><p class="eyebrow">01 · A little hello</p><h1>Start with a selfie.</h1><p>Your photo, a few favorites, and a routine you can make your own.</p></div>
      <div class="capture-layout"><div class="capture-panel">
        <div class="camera-frame"><video id="selfie-video" autoplay muted playsinline aria-label="Front camera preview"></video>
          <div class="camera-placeholder">${icon('camera')}<span>A fresh start.<br>A familiar face.</span></div><div class="face-guide" aria-hidden="true"></div><span class="camera-badge">${icon('shield')} Stays on your device</span>
        </div>
        <p id="camera-status" class="camera-status" role="status">Your camera opens only when you choose.</p>
        <p id="camera-error" class="form-error" role="alert"></p>
        <div class="capture-actions"><button class="btn" data-selfie="camera">${icon('camera')} Open front camera</button><button class="shutter" data-selfie="capture" disabled aria-label="Take selfie and show recommendations"><span></span></button></div>
        <div class="capture-alternatives"><button class="text-btn" data-selfie="upload">Choose a photo</button><button class="text-btn" data-selfie="native">Use device camera</button></div>${fileInput}
      </div><aside class="capture-copy"><span class="pill">Selfie → picks → make it yours</span><h2>A starting point.<br>Then your finishing touches.</h2><p>See product suggestions right after your photo. Tell us what you want, and watch your picks update.</p>
        <ol class="photo-tips"><li><strong>Find soft, natural light.</strong><span>Face a window and keep your face in the oval.</span></li><li><strong>Keep it simple.</strong><span>A clear photo without filters makes a useful reference.</span></li><li><strong>Make the choices yours.</strong><span>Adjust your goals, budget, and skin feel beside your results.</span></li></ol>
        <p class="photo-privacy">A face model analyzes your photo on this device and samples visible lip and cheek colors. Your photo is never uploaded or saved with your profile. Lighting and makeup affect the result; you can edit every color suggestion.</p>
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
    return `<article class="instant-card"><div class="instant-art art-${Number(p.id.split('-')[1]) % 4 + 1}">${bottle(p)}<span>FORM ILLUSTRATION</span></div><div class="instant-copy"><div class="row between wrap"><p class="eyebrow">${slotLabel(item.slot)}</p><span class="pill ${pending ? 'warn' : ''}">${pending ? 'Preview · needs checking' : 'In your plan'}</span></div><p class="instant-brand">${esc(p.brand)}</p><h3>${esc(p.product_name)}</h3><p>${item.score?.value != null ? `Preference fit ${Number(item.score.value).toFixed(0)} / 100` : 'An everyday starting option, selected by available evidence and price.'}</p>${pending ? `<p class="pending-reason">${esc((item.reasons || []).join(' '))}</p>` : ''}<div class="row between"><strong>${money(Math.round(p.price_usd * 100))}</strong><button class="text-btn" data-detail="${p.id}">View product ${icon('arrow')}</button></div></div></article>`;
  }

  function photoSummary(profile) {
    if (!photo) return `<div class="selfie-summary"><div class="selfie-summary-icon">${icon('sparkle')}</div><div><span class="pill">Your preferences come first</span><h2>A good place to begin.</h2><p>Your saved choices shape this shortlist. Add a selfie for on-device color analysis, or keep editing your answers below.</p></div></div>`;
    const ready = analysis?.status === 'ready';
    const busy = ['reading_photo', 'loading_model', 'analyzing'].includes(analysisStage);
    const markers = ready ? (analysis.markers || []).filter(m => Number.isFinite(m.x) && Number.isFinite(m.y)) : [];
    return `<section class="photo-analysis-panel" aria-label="Selfie analysis"><div class="selfie-summary analysis-summary">
      <div class="analyzed-photo"><img src="${photo.dataUrl}" width="${photo.width}" height="${photo.height}" alt="Your selfie with the sampled face regions marked">${markers.map(m => `<span class="sample-marker" style="left:${m.x * 100}%;top:${m.y * 100}%" title="${esc(m.label)}"></span>`).join('')}</div>
      <div class="analysis-copy"><span class="pill">${busy ? 'Analyzing on this device' : ready ? 'Photo analyzed · 1 face found' : 'On-device analysis'}</span><h2>${busy ? 'Getting to know your colors.' : ready ? 'Colors from your selfie.' : 'Let’s get a clearer look.'}</h2>
        <p id="analysis-status" role="status" aria-live="polite">${busy ? analysisMessages[analysisStage] : ready ? 'Face landmarks located the sampling regions below. These are colors visible in this photo, including any makeup and lighting.' : analysisStage === 'error' ? esc(analysisError) : esc((analysis?.issues || []).map(i => i.message).join(' '))}</p>
        ${ready ? `<div class="photo-swatches">${['cheek', 'lip'].filter(k => /^#[0-9a-f]{6}$/i.test(analysis.samples?.[k]?.hex || '')).map(k => `<div class="photo-swatch"><span style="background:${analysis.samples[k].hex}"></span><div><strong>${k === 'lip' ? 'Lip color' : 'Cheek color'}</strong><small>${esc(analysis.samples[k].hex)} · in this light</small></div></div>`).join('')}</div>` : ''}
        <div class="row wrap analysis-actions"><button class="text-btn" data-selfie="remove">Remove photo</button>${!busy ? '<button class="text-btn" data-selfie="analyze">Analyze again</button>' : ''}${!ready && !busy ? '<button class="text-btn" data-nav="selfie">Retake selfie</button>' : ''}</div>
      </div></div>${ready ? photoPicks(profile) : ''}</section>`;
  }

  function photoPicks(profile) {
    const shortlist = getPhotoShortlist(analysis, profile, products, evidence);
    const selected = shortlist.colorFamily || analysis.colorFamily;
    const photoChoice = shortlist.source === 'photo';
    return `<div class="photo-picks"><div class="row between wrap"><div><p class="eyebrow">${photoChoice ? 'Inspired by your photo' : 'Your chosen color comes first'}</p><h3>${colorLabels[selected] || 'Color'} shades to explore.</h3></div><span class="pill purple">Color inspiration · preview</span></div>
      <p class="small muted">${esc(shortlist.reason || 'Suggested from the measured lip color. These are alternatives to explore, not a verified shade match.')}</p>
      ${shortlist.cards.length ? `<div class="photo-product-grid">${shortlist.cards.map(item => `<article class="photo-product"><div class="photo-product-art">${bottle(item.product)}</div><p class="eyebrow">${esc(item.product.brand)}</p><h4>${esc(item.product.product_name)}</h4><p>${esc(evidence[item.product.id]?.exactShade || '')}</p><div class="row between"><strong>${money(Math.round(item.product.price_usd * 100))}</strong><button class="text-btn" data-detail="${item.product.id}">View product</button></div><details><summary>Checks before adding</summary><p>${esc(item.reasons.join(' ') || 'Review your preferences and the whole-kit budget before adding this color.')}</p></details></article>`).join('')}</div>` : ''}
      <div class="photo-confirm row wrap"><label class="field"><span>Keep or change the color family</span><select id="photo-color-family">${Object.entries(colorLabels).map(([value,label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('')}</select></label><button class="btn small" data-selfie="use-color">Use this lip color ${icon('arrow')}</button></div>
      <p class="photo-analysis-note">Confirming adds lip color to your requested categories and saves your color choice. Your skin feel, reactions, goals, and budget stay under your control. Color samples cannot establish a foundation shade, skin condition, or undertone.</p>
      <details><summary>How photo analysis works</summary><p>A bundled MediaPipe model detects face landmarks. Dewdrop samples pixels inside cheek and lip regions and compares the lip color with an editorial color palette. It does not identify you or infer skin health. Samples and face coordinates disappear with the photo; only a color choice you confirm is saved. Filters, shadows, makeup, and camera processing can change the result.</p></details></div>`;
  }

  function results() {
    const profile = createInstantProfile(getProfile());
    setProfile(profile);
    const data = getInstantRecommendations(profile, products, evidence);
    const cards = data.cards || [];
    const pending = cards.some(c => c.state === 'needs_verification');
    const missing = (data.kit?.missing || []).filter(m => !cards.some(c => c.slot === m.slot));
    const makeup = profile.slots.some(s => ['lip', 'cheek', 'eyes', 'base'].includes(s));
    return `<section id="selfie-experience" class="recommendations-screen">
      <div class="page-top row between wrap"><div><p class="eyebrow">02 · A starting point, just for you</p><h1>Your next little favorites.</h1><p>Start here. Change a few answers to make these picks your own.</p></div><button class="text-btn" data-nav="selfie">${icon('camera')} ${photo ? 'Retake selfie' : 'Add a selfie'}</button></div>
      ${photoSummary(profile)}
      <div class="instant-layout"><div class="instant-results"><div class="row between results-heading"><h2>Your product picks</h2><span class="small muted">${cards.length} suggestions</span></div>
        <p class="instant-note">${pending ? 'Preview options are ready to explore. Answer the reaction question and resolve any listed checks before adding them to your plan.' : 'Picks follow your preferences, product evidence, and budget.'}</p><button class="text-btn refine-jump" data-selfie="refine">Refine my picks ${icon('down')}</button>
        ${data.error ? `<p class="hint warning" role="alert">${esc(data.error)}</p>` : ''}
        <div id="instant-cards">${cards.map(card).join('')}${missing.map(m => `<div class="missing-card"><h3>${slotLabel(m.slot)}</h3><p>${esc(m.reason)}</p><button class="text-btn" data-start>Edit full questionnaire ${icon('arrow')}</button></div>`).join('')}${!cards.length && !missing.length ? '<div class="empty"><h2>Let’s adjust your plan.</h2><p>No suggestions fit these choices yet. Try editing your budget or product categories.</p></div>' : ''}</div>
        <p class="small muted">U.S. catalog prices, before tax and shipping. Preview options aren’t included in your planned total.</p>
        ${data.kit ? `<div class="instant-total row between wrap"><div><span class="small muted">Planned products${profile.budgetCents != null ? ` · ${money(profile.budgetCents)} budget` : ' · no budget set'}</span><strong>${money(data.kit.totalCents)}${profile.reserveCents ? ` + ${money(profile.reserveCents)} reserve` : ''}</strong></div><button class="btn secondary small" data-nav="kit">View my kit ${icon('arrow')}</button></div>` : ''}
      </div><aside class="quick-questionnaire"><p class="eyebrow">03 · Make it yours</p><h2 id="quick-title" tabindex="-1">What do you want?</h2><p class="small muted">Edit any answer. Your picks update right away.</p>
        <div class="field"><span>Your priorities · choose up to two</span><div class="chip-row">${Object.entries(goalLabels).map(([value, label]) => `<button class="chip ${profile.goals.includes(value) ? 'active' : ''}" data-quick-goal="${value}" aria-pressed="${profile.goals.includes(value)}">${label}</button>`).join('')}</div></div>
        ${select(profile, 'scope', 'What would you like help with?', [['skincare','Skincare essentials'],['makeup','Everyday makeup'],['both','Skincare & makeup'],['help_choose','Help me choose']])}
        <div class="fields-two"><label class="field"><span>Whole-kit budget · USD</span><input data-quick="budgetCents" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Optional" value="${profile.budgetCents == null ? '' : (profile.budgetCents / 100).toFixed(2)}"></label><label class="field"><span>Daily product limit</span><input data-quick="itemCap" type="number" min="1" max="12" step="1" value="${profile.itemCap}"></label></div>
        ${select(profile, 'skinFeel', 'How does your skin usually feel?', Object.entries(skinLabels))}
        ${select(profile, 'reactionHistory', 'Have products irritated your skin?', [['unknown','Choose an answer'],['no','No known reactions'],['yes','Yes — I have details'],['unsure','I’m not sure']])}
        ${profile.reactionHistory === 'yes' ? '<button class="text-btn" data-nav="quiz/4">Add reaction details & exclusions</button>' : ''}
        ${select(profile, 'texture', 'What texture feels good?', [['unknown','No preference'],['lightweight','Lightweight'],['rich','Rich & comforting'],['nonsticky','Not sticky']])}
        ${makeup ? select(profile, 'finish', 'Your preferred finish', [['unknown','No preference'],['natural','Natural'],['dewy','Dewy / glowy'],['matte','Matte']]) + select(profile, 'colorFamily', 'Your lip or cheek colors', [['unknown','No preference'],['pink','Pink'],['rose','Rose'],['coral','Coral'],['red','Red'],['nude','Nude'],['berry','Berry']]) : ''}
        <p id="quick-error" class="form-error" role="alert"></p><div class="quick-more"><button class="text-btn" data-start>Edit full questionnaire ${icon('arrow')}</button><p class="small muted">Kept products, ingredients to avoid, shopping country, shades, and more.</p></div>
      </aside></div><p id="picks-status" class="sr-only" role="status" aria-live="polite"></p></section>`;
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
      case 'refine': $('#quick-title').focus(); break;
    }
  });
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
