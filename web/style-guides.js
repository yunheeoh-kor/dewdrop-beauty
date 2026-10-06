import { defaultProfile, evaluateProduct } from './engine.js';

export const STYLE_LABELS = Object.freeze({ barely_there:'Barely there', dewy_glow:'Dewy glow', soft_rose:'Soft rose', soft_smoky:'Soft smoky', stage_definition:'Stage definition', warm_bronze:'Warm bronze', statement_lip:'Statement lip' });
export const STYLE_PALETTES = Object.freeze({
  barely_there:['#c6a68d','#967b65','#b78078'], dewy_glow:['#ead7bd','#d9aba0','#bd817d'],
  soft_rose:['#d2a3ad','#ad7a91','#b06578'], soft_smoky:['#a88d89','#66525b','#39333c'],
  stage_definition:['#302e3a','#6b546c','#ba768c'], warm_bronze:['#c7a17c','#956d50','#b57862'],
  statement_lip:['#c99085','#9e4e5c','#b73548'],
});
const PREFERENCES = {
  finish:['unknown','natural','dewy','matte'], coverage:['unknown','spot_only','light_all_over','more_coverage'],
  eyeEffect:['unknown','definition','volume','length','soft_color'], colorFamily:['unknown','pink','rose','coral','red','nude','berry'],
  texture:['unknown','lightweight','rich','nonsticky'],
};
const GOALS = new Set(['quick_easy','hydration_comfort','less_shine','natural_makeup','longer_wear']);

export function findGuide(data, id) {
  for (const kind of ['makeup','skincare']) {
    const guide = (data?.[kind] || []).find(item => item.id === id);
    if (guide) return { guide, kind };
  }
  return null;
}

/** Only the visible preference choices change. Personal constraints and exact picks survive. */
export function applyStyleGuide(profile, guide, kind, updatedAt = new Date().toISOString()) {
  if (!guide?.id || !['makeup','skincare'].includes(kind)) throw new TypeError('Choose a known style guide.');
  const next = { ...defaultProfile(), reactionHistory:'unknown', ...profile };
  const patch = guide.profilePatch || {};
  const changes = [];
  for (const [field, values] of Object.entries(PREFERENCES)) {
    if (kind === 'skincare' && field !== 'texture') continue;
    if (values.includes(patch[field])) { next[field] = patch[field]; changes.push(field); }
  }
  if (Array.isArray(patch.goals)) {
    next.goals = [...new Set(patch.goals.filter(goal => GOALS.has(goal)))].slice(0, 2);
    changes.push('goals');
  }
  const key = `${kind}StyleId`;
  next[key] = guide.id;
  changes.push(key);
  next.answerProvenance = [
    ...(Array.isArray(profile?.answerProvenance) ? profile.answerProvenance.filter(answer => !changes.includes(answer.field)) : []),
    ...changes.map(field => ({field,value:next[field],source:'style_guide',style_id:guide.id,confirmed:true,updated_at:updatedAt,observation_id:null})),
  ];
  return next;
}

/** A curated shelf of independent options; it never adds products to a kit. */
export function guideProducts(guide, products, evidence, profile = {}) {
  const normalized = { ...defaultProfile(), reactionHistory:'unknown', ...profile };
  const list = [], excluded = [];
  for (const selection of guide.selections || []) {
    const product = products.find(p => p.id === selection.productId);
    if (!product) continue;
    const slots = evidence[product.id]?.slots || [];
    const slot = slots[0];
    if (!slot) { excluded.push({product,reason:'This product has no reviewed planning category.'}); continue; }
    const evaluation = evaluateProduct(product, slot, normalized, evidence);
    if (evaluation.state === 'excluded') { excluded.push({product,reason:evaluation.reasons.join(' ')}); continue; }
    list.push({product,selection,slot,evaluation});
  }
  return { list, excluded };
}

export function guidePreferenceSummary(guide, kind) {
  const p = guide.profilePatch || {};
  const names = { finish:'Finish',coverage:'Coverage',eyeEffect:'Eyes',colorFamily:'Color',texture:'Texture' };
  const preferences = Object.entries(PREFERENCES).filter(([field,values]) => (kind === 'makeup' || field === 'texture') && values.includes(p[field]))
    .map(([field]) => `${names[field]}: ${p[field] === 'unknown' ? 'no preference' : p[field].replaceAll('_',' ')}`);
  if (Array.isArray(p.goals)) preferences.push(`Priorities: ${p.goals.filter(goal=>GOALS.has(goal)).slice(0,2).map(goal=>goal.replaceAll('_',' ')).join(', ')}`);
  return preferences;
}
