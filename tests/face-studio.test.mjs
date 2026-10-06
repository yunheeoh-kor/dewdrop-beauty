import test from 'node:test';
import assert from 'node:assert/strict';
import { regionCrop, facePhotoCrop, visibleRegions, fitFaceCrop, nextFaceRegion, keepFaceViewport, renderFaceStudio } from '../web/face-studio.js';
import { defaultProfile } from '../web/engine.js';

test('a selected extra area replaces one pin instead of covering the image with more than three', () => {
  const regions = ['lips','brows','eyes','nose','cheeks','skin_texture','skin_tone'].map(id => ({id}));
  const featured = regions.slice(0,3);
  assert.deepEqual(visibleRegions(regions,featured,'skin_texture').map(r => r.id), ['lips','brows','skin_texture']);
  assert.deepEqual(visibleRegions(regions,featured,'brows'), featured);
  assert.deepEqual(visibleRegions(regions,featured,'missing'), featured);
  assert.equal(featured.length, 3);
});

test('region zoom centers the clicked eyebrow rather than the area between two brows', () => {
  const photo = {width:800,height:1200};
  const brow = {id:'brows',bounds:{x:.2,y:.22,width:.6,height:.09},point:{x:.33,y:.265}};
  const crop = regionCrop(brow,photo);
  assert.ok(Math.abs((crop.x+crop.width/2)/photo.width-brow.point.x)<.01);
  assert.ok(crop.width < brow.bounds.width * photo.width);
  assert.ok(crop.y <= brow.point.y*photo.height && crop.y+crop.height >= brow.point.y*photo.height);
});

test('face and feature viewports remain inside portrait, landscape and small source images', () => {
  for (const photo of [{width:800,height:1200},{width:1200,height:650},{width:50,height:35}]) {
    for (const bounds of [{x:0,y:0,width:.2,height:.3},{x:.78,y:.65,width:.22,height:.35},{x:.1,y:.1,width:.8,height:.8}]) {
      for (const crop of [facePhotoCrop({faceBounds:bounds},photo),regionCrop({id:'lips',bounds},photo)]) {
        assert.ok(crop.width>0 && crop.height>0);
        assert.ok(crop.x>=0 && crop.y>=0);
        assert.ok(crop.x+crop.width<=photo.width+1e-8 && crop.y+crop.height<=photo.height+1e-8);
      }
    }
  }
});

test('a narrow mobile photo pane preserves image proportions and the selected feature center', () => {
  const photo = { width: 900, height: 1200 };
  const crop = { x: 300, y: 350, width: 180, height: 100 };
  for (const aspect of [.24, .35, .8, 1.2]) {
    const fit = fitFaceCrop(crop, photo, aspect);
    assert.ok(Math.abs(fit.width / fit.height - aspect) < 1e-8);
    assert.ok(Math.abs(fit.x + fit.width / 2 - 390) < 1e-8);
    assert.ok(Math.abs(fit.y + fit.height / 2 - 400) < 1e-8);
    assert.ok(fit.x >= 0 && fit.y >= 0 && fit.x + fit.width <= photo.width && fit.y + fit.height <= photo.height);
  }
});

test('the compact mobile close-up keeps eyebrow context local instead of showing a full-height face strip', () => {
  const photo = { width: 800, height: 1000 };
  const brow = { id: 'brows', bounds: { x: .24, y: .27, width: .48, height: .07 }, point: { x: .36, y: .305 } };
  const compact = fitFaceCrop(regionCrop(brow, photo), photo, .8);
  assert.ok(compact.height < photo.height * .4);
  assert.ok(compact.width < photo.width * .4);
  assert.ok(Math.abs((compact.x + compact.width / 2) / photo.width - brow.point.x) < .01);
  assert.ok(Math.abs((compact.y + compact.height / 2) / photo.height - brow.point.y) < .01);
});

test('previous and next controls reach all seven areas and wrap without page navigation', () => {
  const regions = ['lips', 'brows', 'eyes', 'nose', 'cheeks', 'skin_texture', 'skin_tone'].map(id => ({ id }));
  let id = '';
  const visited = [];
  for (let i = 0; i < 7; i++) { id = nextFaceRegion(regions, id, 1); visited.push(id); }
  assert.deepEqual(visited, regions.map(r => r.id));
  assert.equal(nextFaceRegion(regions, 'skin_tone', 1), 'lips');
  assert.equal(nextFaceRegion(regions, 'lips', -1), 'skin_tone');
  assert.equal(nextFaceRegion(regions, '', -1), 'skin_tone');
  assert.equal(nextFaceRegion([], '', 1), '');
});

test('workspace replacement restores both exact page offsets after DOM and focus updates', () => {
  const calls = [];
  const viewport = { scrollX: 7, scrollY: 438.5, scrollTo(options) { calls.push(options); this.scrollX = options.left; this.scrollY = options.top; } };
  const result = keepFaceViewport(viewport, () => {
    viewport.scrollX = 0; viewport.scrollY = 820;
    return 'updated';
  });
  assert.equal(result, 'updated');
  assert.deepEqual(calls, [{ left: 7, top: 438.5, behavior: 'instant' }]);
  assert.equal(viewport.scrollY, 438.5);
  assert.equal(viewport.scrollX, 7);
});

const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const photo = { width: 900, height: 1200, dataUrl: 'data:image/jpeg;base64,original' };
const regions = ['lips', 'brows', 'eyes', 'nose', 'cheeks', 'skin_texture', 'skin_tone'].map((id, i) => ({ id, label: id, kind: id.startsWith('skin_') ? 'skincare' : 'makeup', point: { x: .4, y: .5 }, bounds: { x: .3, y: .45, width: .2, height: .1 }, observations: ['A visible photo detail.', 'A detail limitation.'], measurements: {}, quality: { usable: true }, priority: 90 - i }));
const render = (options = {}) => renderFaceStudio({ photo, analysis: { status: 'ready', regions, faceBounds: { x: .15, y: .15, width: .7, height: .7 } }, profile: defaultProfile(), products: [], evidence: {}, selectedId: '', showAll: false, esc, icon: name => `<svg class="icon" data-icon="${name}"></svg>`, productImage: () => '', lipControls: '', ...options });

test('selecting a point zooms the main photo and puts details in the same workspace', () => {
  const overview = render(), selected = render({ selectedId: 'lips' });
  assert.ok(overview.includes('face-workspace is-overview'));
  assert.ok(selected.includes('face-workspace is-exploring'));
  assert.equal((overview.match(/class="face-pin /g) || []).length, 3);
  assert.equal((selected.match(/href="data:image\/jpeg;base64,original"/g) || []).length, 1);
  assert.ok(!selected.includes('class="region-zoom"'));
  assert.ok(selected.includes('class="face-pane-scroll"'));
  assert.ok(selected.includes('data-face-overview'));
  assert.ok(selected.includes('data-face-step="-1"'));
  assert.ok(selected.includes('data-face-step="1"'));
  for (const region of regions) assert.ok(selected.includes(`data-face-region="${region.id}"`));
  assert.notEqual(overview.match(/data-face-photo-view viewBox="([^"]+)"/)[1], selected.match(/data-face-photo-view viewBox="([^"]+)"/)[1]);
  assert.ok(!overview.includes('class="face-photo-rail"'));
  assert.ok(selected.includes('class="face-photo-rail"'));
  const rail = selected.match(/<nav aria-label="Quick photo areas">([\s\S]*?)<\/nav>/)[1];
  assert.equal((rail.match(/data-face-region=/g) || []).length, 3);
  assert.ok(rail.includes('data-face-region="lips" aria-pressed="true"'));
  assert.ok(selected.includes('data-face-overview>Full photo'));
});

test('the inspector separates the explanation, products and K-pop comparison into accessible tabs', () => {
  for (const activeTab of ['observation', 'products', 'compare']) {
    const html = render({ selectedId: 'lips', activeTab });
    assert.equal((html.match(/role="tab" /g) || []).length, 3);
    assert.equal((html.match(/role="tabpanel"/g) || []).length, 3);
    assert.ok(html.includes(`id="face-tab-${activeTab}" data-face-tab="${activeTab}" aria-selected="true"`));
    assert.ok(html.includes(`id="face-panel-${activeTab}" role="tabpanel" aria-labelledby="face-tab-${activeTab}" >`));
    assert.equal((html.match(/role="tabpanel" aria-labelledby="[^"]+" hidden/g) || []).length, 2);
  }
  const html = render({ selectedId: 'lips' });
  assert.ok(html.indexOf('region-main-observation') < html.indexOf('Why this direction'));
  assert.ok(html.includes('K-pop inspiration'));
});

test('photo estimates distinguish moderate reliability from limited detail', () => {
  for (const reliability of ['moderate', 'limited']) {
    const html = render({ selectedId: 'skin_texture', analysis: { status: 'ready', regions: regions.map(region => region.id === 'skin_texture' ? { ...region, quality: { usable: true, estimated: true, reliability } } : region) } });
    assert.ok(html.includes(reliability === 'limited' ? 'Photo estimate · limited detail' : '>Photo estimate</span>'));
    if (reliability === 'moderate') assert.ok(!html.includes('Photo estimate · limited detail'));
  }
});
