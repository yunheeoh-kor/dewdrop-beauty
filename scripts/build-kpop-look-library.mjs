// Build the offline editorial library from attributed, byte-verified source photos.
// Run fetch-kpop-style-assets.ps1 only when deliberately refreshing source assets.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const research = JSON.parse(readFileSync(path.join(root, 'research/kpop-style-sources.json'), 'utf8').replace(/^\uFEFF/, ''));
const catalog = JSON.parse(readFileSync(path.join(root, 'web/data/catalog.json'), 'utf8'));
const products = new Map(catalog.products.map(product => [product.id, product]));
const region = (id, title, description, crop, productCategories, productIds = []) => ({
  id, title, description, crop: Object.fromEntries(['x', 'y', 'width', 'height'].map((key, index) => [key, crop[index]])), productCategories, productIds,
});
const editorialNote = 'Editorial style inspiration based on this photograph. Suggested products are alternatives, not confirmed products worn. Lighting and image resolution affect apparent color and finish.';
const looks = [
  {
    id: 'jennie-coco-crush-2024', artistId: 'jennie', title: 'Soft rose gloss & delicate liner',
    summary: 'A glossy rose lip and softly pink cheeks balance a fine upper lash line. Face-framing braids and a dark outfit keep the overall look playful and polished.',
    tags: ['rose', 'glossy lips', 'soft liner', 'photocall', '제니'], occasion: 'Chanel Coco Crush photocall · 3 July 2024',
    sourceTitle: 'Jennie at the Chanel Coco Crush photocall', sourceDate: '2024-07-03',
    regions: [
      region('face', 'Soft, even complexion', 'The photographed complexion reads smooth with restrained shine. For a similar effect, apply a thin cushion layer and spot-conceal only where desired; choose a shade that matches your own skin.', [.34,.095,.355,.32], ['cushion','concealer','powder'], ['kbeauty-037']),
      region('eyes', 'Fine extended upper line', 'A narrow dark lash line and short outward extension frame the eyes. Try a fine pencil line with light mascara; keep the lid color softly neutral.', [.355,.205,.225,.055], ['eyeliner','mascara','eyeshadow'], ['kbeauty-029','kbeauty-028']),
      region('brows', 'Softly defined brows', 'The visible brow sections look softly filled rather than sharply outlined. Brush in the direction of growth and add small strokes only in gaps.', [.365,.18,.19,.04], ['brow'], ['kbeauty-050']),
      region('cheeks', 'Diffused pink flush', 'A pink flush sits across the upper cheeks. Blend a small amount of blush outward with a soft edge so it merges into the base.', [.36,.247,.26,.07], ['blush','highlighter'], ['kbeauty-026']),
      region('lips', 'Glossy rose center', 'The lips have a rose tone and visible reflected shine. Tap on a rose tint, soften the edge, and add clear gloss at the center for a related finish.', [.41,.305,.14,.06], ['lip_tint','lip_gloss','lip_liner'], ['kbeauty-025','kbeauty-027']),
    ], campaignProducts: ['kbeauty-037'],
  },
  {
    id: 'jisoo-airport-2024', artistId: 'jisoo', title: 'Muted rose everyday makeup',
    summary: 'A muted rose lip, soft brows, and close-to-lash definition create a relaxed everyday reference. The loose hair and denim styling reinforce the understated feel.',
    tags: ['muted rose', 'natural finish', 'everyday', 'airport', '지수'], occasion: 'Incheon Airport departure · 26 February 2024',
    sourceTitle: 'Jisoo departing Incheon Airport', sourceDate: '2024-02-26',
    regions: [
      region('face', 'Natural-looking coverage', 'The base appears even with a soft, skin-like finish in bright ambient light. Use sheer, buildable coverage and blend around the nose and jaw without trying to duplicate the photo’s lighting.', [.285,.12,.37,.40], ['cushion','foundation','concealer'], ['kbeauty-044']),
      region('eyes', 'Close-to-lash definition', 'The upper lash line is subtly defined, with a small outer extension. A brown or softly blended dark liner can reproduce the low-contrast effect.', [.31,.243,.29,.07], ['eyeliner','eyeshadow','mascara'], ['kbeauty-029']),
      region('brows', 'Gentle natural arch', 'The brows retain visible softness at the front and a gentle arch. Brush through a small amount of brow color and avoid a hard inner edge.', [.31,.207,.28,.06], ['brow'], ['kbeauty-050']),
      region('cheeks', 'Low-contrast rosy warmth', 'The cheeks show a restrained rosy tone. Blend a muted blush lightly across the cheek area; the photograph alone does not establish how much is makeup or lighting.', [.31,.30,.30,.09], ['blush'], ['kbeauty-026']),
      region('lips', 'Soft rose satin lip', 'The lip looks softly defined and less reflective than a high-shine gloss. Blur a muted rose tint at the edge and build a little more color at the center.', [.398,.375,.165,.065], ['lip_tint','lipstick'], ['kbeauty-031']),
    ], campaignProducts: [],
  },
  {
    id: 'wonyoung-mma-2024', artistId: 'wonyoung', title: 'Rose glow for an evening look',
    summary: 'Glossy rose lips, pink cheeks, and bright-looking eyes complement an updo, delicate jewelry, and a black evening dress. Use the reference for placement and finish rather than an exact shade match.',
    tags: ['rose', 'glow', 'glossy lips', 'red carpet', '장원영', '원영'], occasion: 'Melon Music Awards · 30 November 2024',
    sourceTitle: 'Jang Wonyoung at the 2024 Melon Music Awards', sourceDate: '2024-11-30',
    regions: [
      region('face', 'Luminous center of the face', 'The forehead, nose, and upper cheeks catch the light. Start with light-reflecting base coverage and reserve a small highlight for high points; the image also includes strong event lighting.', [.285,.17,.41,.274], ['cushion','concealer','highlighter'], ['kbeauty-044']),
      region('eyes', 'Defined lashes with a bright lower eye', 'Dark upper lashes contrast with a lighter-looking lower-eye area. Try separating mascara, a fine upper liner, and a small amount of light shadow just below the eye.', [.46,.236,.218,.07], ['mascara','eyeliner','eyeshadow'], ['kbeauty-028','kbeauty-029']),
      region('brows', 'Soft brow framing beneath a fringe', 'The fringe partly covers the eyebrows, so the full shape cannot be assessed here. Keep any inspired brow styling soft and lightly brushed; this crop preserves the visible area.', [.455,.215,.23,.047], ['brow'], ['kbeauty-050']),
      region('cheeks', 'Rosy upper-cheek glow', 'Pink color and reflected light are visible over the upper cheeks. Blend a sheer pink blush high on the cheeks and soften its edges before adding any highlight.', [.375,.292,.30,.063], ['blush','highlighter'], ['kbeauty-048']),
      region('lips', 'Defined glossy rose', 'A rose-toned lip with a glossy surface anchors the look. Build tint evenly and add shine; use a liner close to your own lip color if you want a more defined edge.', [.463,.35,.15,.054], ['lip_tint','lip_gloss','lip_liner'], ['kbeauty-047','kbeauty-027']),
    ], campaignProducts: ['kbeauty-047'],
  },
  {
    id: 'karina-airport-2025', artistId: 'karina', title: 'Soft pink with crisp eye definition',
    summary: 'A softly pink lip and cheek palette pairs with a neat upper lash line. A short bob and dark puffer jacket frame this relaxed airport look.',
    tags: ['soft pink', 'everyday', 'defined eyes', 'airport', '카리나'], occasion: 'Incheon Airport departure · 26 February 2025',
    sourceTitle: 'Karina departing Incheon Airport', sourceDate: '2025-02-26',
    regions: [
      region('face', 'Light, even-looking base', 'The face appears softly luminous in bright outdoor light. Use light coverage and blend into the jaw; the photographed brightness is not a target skin tone.', [.353,.08,.33,.345], ['cushion','foundation','concealer'], ['kbeauty-044']),
      region('eyes', 'Neat upper-lash emphasis', 'A dark upper lash line gives definition while the rest of the eye area stays soft. Keep pencil close to the lashes, extend only slightly, and comb through mascara.', [.365,.2,.235,.06], ['eyeliner','mascara','eyeshadow'], ['kbeauty-029','kbeauty-028']),
      region('brows', 'Lightly filled natural arch', 'The brows form a gentle arch with a diffused front. Brush them in place and add color in small strokes rather than drawing a solid outline.', [.373,.169,.23,.045], ['brow'], ['kbeauty-050']),
      region('cheeks', 'Sheer pink cheek wash', 'A low-contrast pink impression is visible over the cheeks. Apply sheer blush and soften the edges; ambient light may contribute to the color in the reference.', [.382,.258,.254,.073], ['blush'], ['kbeauty-026']),
      region('lips', 'Fresh softly glossy pink', 'The lip looks pink with a small amount of shine and a soft perimeter. Layer a sheer tint lightly and add gloss only where you want reflection.', [.451,.315,.127,.056], ['lip_tint','lip_gloss'], ['kbeauty-025','kbeauty-027']),
    ], campaignProducts: [],
  },
  {
    id: 'karina-mma-2024', artistId: 'karina', title: 'Defined eyes & muted rose balance',
    summary: 'A dark, elongated upper lash line contrasts with a restrained rose lip and soft cheek color. Burgundy-toned hair, black clothing, and silver jewelry complete the evening reference.',
    tags: ['defined eyes', 'muted rose', 'evening', 'red carpet', '카리나'], occasion: 'Melon Music Awards · 30 November 2024',
    sourceTitle: 'Karina at the 2024 Melon Music Awards', sourceDate: '2024-11-30',
    resolutionNote: 'The licensed source is 416 × 582 pixels; enlarged details are soft. Use it for broad placement, not fine texture or exact shade judgments.',
    regions: [
      region('face', 'Smooth satin impression', 'The complexion has an even, softly matte-to-satin appearance in this small source image. Use a light base layer and powder only the areas where you prefer less shine.', [.328,.144,.33,.294], ['cushion','foundation','powder'], ['kbeauty-043']),
      region('eyes', 'Elongated dark upper line', 'The strongest visible makeup feature is the dark upper lash line extending toward the outer corners. Keep the inner line thin and build the outer third gradually.', [.35,.247,.27,.05], ['eyeliner','mascara','eyeshadow'], ['kbeauty-029','kbeauty-028']),
      region('brows', 'Subtle brow definition', 'The visible brows frame the eyes without a strongly outlined front. Brush them into place and lightly fill gaps; the source resolution limits inspection of individual hairs.', [.36,.217,.25,.047], ['brow'], ['kbeauty-050']),
      region('cheeks', 'Quiet rose cheek color', 'A soft pink-rose impression balances the eye definition. Apply a light veil of blush and blend broadly; exact color cannot be isolated from the event lighting.', [.353,.283,.28,.068], ['blush','contour'], ['kbeauty-026']),
      region('lips', 'Muted rose with a soft edge', 'The lip has a muted rose impression that keeps attention on the eyes. Try a softly blended tint or satin lipstick rather than a heavily outlined shape.', [.439,.354,.13,.051], ['lip_tint','lipstick'], ['kbeauty-032']),
    ], campaignProducts: [],
  },
  {
    id: 'felix-airport-2024', artistId: 'felix', title: 'Soft definition & natural texture',
    summary: 'Visible skin texture, softly shaded eyes, and a muted lip give this airport portrait an understated feel. Light hair and a dark jacket create contrast without a high-shine makeup finish.',
    tags: ['natural texture', 'soft definition', 'muted lips', 'airport', '필릭스'], occasion: 'Incheon Airport departure · 8 July 2024',
    sourceTitle: 'Felix departing Incheon Airport', sourceDate: '2024-07-08',
    regions: [
      region('face', 'Keep visible skin texture', 'Small freckles and natural-looking texture remain visible. For an inspired base, use sheer coverage or spot concealer rather than covering every variation; the photo does not establish which base products were used.', [.315,.076,.338,.29], ['foundation','cushion','concealer'], ['kbeauty-044']),
      region('eyes', 'Soft neutral shading', 'A muted brown impression around the lash line gives definition without a large graphic wing. Blend a small amount of neutral shadow and soften pencil along the outer lash line.', [.35,.175,.245,.045], ['eyeshadow','eyeliner'], ['kbeauty-029']),
      region('brows', 'Brushed brow structure', 'The dark brows contrast with the light hair and retain a soft edge. Brush them into place, then add minimal color in the direction of the hairs.', [.35,.151,.24,.031], ['brow'], ['kbeauty-050']),
      region('cheeks', 'Restrained cheek definition', 'The cheek area has a subdued warm impression and visible texture. If recreating the balance, use a light hand with blush or contour; the photograph does not verify either product was applied.', [.344,.207,.255,.07], ['blush','contour'], ['kbeauty-026']),
      region('lips', 'Muted natural-looking lip', 'The lip appears softly rose-toned with limited shine. Tap on a small amount of tint and diffuse the edge; a later official gloss promotion is recorded separately below.', [.398,.278,.125,.042], ['lip_tint','lipstick'], ['kbeauty-031']),
    ], campaignProducts: ['kbeauty-038'],
  },
  {
    id: 'nayeon-kitsune-2024', artistId: 'nayeon', title: 'Fresh coral gloss & open lashes',
    summary: 'A warm coral-red glossy lip, separated lashes, and softly colored cheeks create an upbeat everyday-to-event reference. The side part and simple knit top keep the overall styling relaxed.',
    tags: ['coral', 'glossy lips', 'defined lashes', 'photocall', '나연'], occasion: 'Maison Kitsuné event · 24 October 2024',
    sourceTitle: 'Nayeon at a Maison Kitsuné event', sourceDate: '2024-10-24',
    regions: [
      region('face', 'Fresh, even base', 'The face reads even with a gentle glow under warm event lighting. Blend thin base layers and add targeted concealer instead of using the image as an exact skin-color target.', [.292,.123,.40,.378], ['cushion','foundation','concealer'], ['kbeauty-044']),
      region('eyes', 'Separated upper lashes', 'Visible upper lashes and a fine lash line create an open-eye effect. Comb mascara through carefully and keep the liner narrow so the lashes remain the focus.', [.362,.252,.28,.047], ['mascara','eyeliner','eyeshadow'], ['kbeauty-028','kbeauty-029']),
      region('brows', 'Soft brown brow frame', 'The brows look softly filled with a gentle arch. A light coat of tinted brow gel can add structure while preserving a diffused front.', [.347,.228,.30,.04], ['brow'], ['kbeauty-050']),
      region('cheeks', 'Warm peach-pink wash', 'The cheeks show a warm peach-pink impression. Blend a sheer blush over the apples and outward; the red background and warm lighting influence the visible color.', [.34,.305,.32,.072], ['blush','highlighter'], ['kbeauty-048']),
      region('lips', 'Glossy coral-red accent', 'The smiling lip has a warm red-coral impression and reflective shine. Use a sheer warm tint and a little gloss for an inspired finish, adjusting the color to your preference.', [.427,.371,.165,.068], ['lip_tint','lip_gloss','lipstick'], ['kbeauty-025','kbeauty-027']),
    ], campaignProducts: [],
  },
];

looks.push(
  {
    id: 'v-airport-2022', artistId: 'v', title: 'Muted rose & soft neutral depth',
    summary: 'A muted rose lip and softly shaded eyes complement loose waves and a patterned shirt. The restrained finish offers a warm, low-shine everyday reference.',
    tags: ['natural finish', 'neutral eyes', 'muted rose', 'airport', '뷔', '태형'], occasion: 'Incheon Airport departure · 24 June 2022',
    sourceTitle: 'V departing Incheon Airport', sourceDate: '2022-06-24',
    regions: [
      region('face', 'Thin satin coverage', 'The face has a softly even, low-shine appearance in shaded light. Try a thin base layer and spot concealer, retaining skin texture and matching your own tone.', [.285,.12,.265,.255], ['foundation','concealer','powder'], ['kbeauty-059','kbeauty-060']),
      region('eyes', 'Diffused neutral lash line', 'Soft darkness sits close to the upper and lower lash lines. Blend a small amount of brown pencil at the outer edge instead of drawing a large wing.', [.342,.15,.168,.061], ['eyeshadow','eyeliner'], ['kbeauty-077']),
      region('brows', 'Partial brow view beneath waves', 'Wavy hair hides much of the brow shape. Only the visible sections can be used as a reference; softly brush and fill gaps without treating the covered areas as evidence.', [.336,.123,.173,.05], ['brow'], ['kbeauty-080']),
      region('cheeks', 'Restrained warm balance', 'The cheeks read warm and low-contrast in the shaded setting. A light touch of muted blush or neutral contour can echo the balance, although the photograph does not establish either product was used.', [.321,.201,.21,.097], ['blush','contour'], ['kbeauty-081']),
      region('lips', 'Blurred muted rose', 'The lip has a muted pink-rose impression with little visible gloss. Tap on a small amount of tint and soften the perimeter for an understated finish.', [.402,.255,.095,.052], ['lip_tint','lipstick'], ['kbeauty-030']),
    ], campaignProducts: [],
  },
  {
    id: 'jimin-radio-2023', artistId: 'jimin', title: 'Barely-there satin & soft pink',
    summary: 'A soft pink lip, understated eye definition, and a natural-looking satin complexion pair with a simple black knit. This relaxed radio-arrival portrait is a gentle everyday reference.',
    tags: ['barely there', 'satin', 'soft pink', 'everyday', '지민'], occasion: 'SBS Radio arrival · 31 March 2023',
    sourceTitle: 'Jimin arriving for SBS Radio', sourceDate: '2023-03-31',
    regions: [
      region('face', 'Soft satin skin finish', 'The complexion looks even with restrained highlights. Use light coverage only where desired and blend well around the nose; an image cannot reveal the skincare routine underneath.', [.303,.23,.45,.30], ['cushion','concealer','powder'], ['kbeauty-071','kbeauty-072']),
      region('eyes', 'Quiet close-to-lash shading', 'The visible lash line is softly defined without a long wing. Smudge a little neutral pencil into the outer lash line and keep any shadow sheer.', [.345,.274,.29,.049], ['eyeliner','eyeshadow'], ['kbeauty-077']),
      region('brows', 'Fringe-covered brow reference', 'The fringe hides most of the brow area, so the full brow styling cannot be assessed. This view records the limitation instead of inventing a shape beneath the hair.', [.345,.244,.29,.048], ['brow'], ['kbeauty-086']),
      region('cheeks', 'Subtle rosy warmth', 'The cheeks show a low-contrast rosy impression with no sharp visible contour. Blend a sheer blush lightly if desired; the ambient light contributes to the observed color.', [.337,.32,.34,.073], ['blush'], ['kbeauty-068']),
      region('lips', 'Soft pink satin lip', 'A pale pink impression and gentle reflection keep the smiling lip understated. Apply a sheer tint sparingly and blot once if you prefer less shine.', [.395,.404,.17,.05], ['lip_tint','lipstick'], ['kbeauty-075']),
    ], campaignProducts: [],
  },
  {
    id: 'jimin-bbmas-2019', artistId: 'jimin', title: 'Warm rose lip & bronze-toned eyes',
    summary: 'Coral-pink hair, warm brown eye definition, and a richer rose lip make this red-carpet close-up more expressive. A hand partly covers the face, so the cheek reference uses the unobscured side.',
    tags: ['warm bronze', 'warm rose', 'soft smoky', 'red carpet', '지민'], occasion: 'Billboard Music Awards red carpet · 1 May 2019',
    sourceTitle: 'Jimin on the 2019 Billboard Music Awards red carpet', sourceDate: '2019-05-01',
    resolutionNote: 'The source is 382 pixels wide and the hand obscures part of the face. Use the visible areas for broad color placement rather than fine skin texture.',
    regions: [
      region('face', 'Satin base against warm color', 'The visible complexion is softly satin, balancing the warm hair and lip color. Blend a light base layer and choose coverage to suit your own skin; the hand blocks part of the face.', [.07,.246,.83,.536], ['foundation','concealer','powder'], ['kbeauty-070','kbeauty-095']),
      region('eyes', 'Soft warm-brown definition', 'Warm brown shading hugs the eyes with softly dark outer lash lines. Blend a bronze-toned or brown shadow thinly and soften pencil at the outer corner for a related effect.', [.335,.45,.50,.073], ['eyeshadow','eyeliner'], ['kbeauty-074','kbeauty-077']),
      region('brows', 'Defined brown arch', 'The exposed brow area shows a gently structured brown shape. Use short strokes and brush through them, keeping the front less dense than the tail.', [.43,.41,.395,.041], ['brow'], ['kbeauty-080']),
      region('cheeks', 'Warm cheek on the visible side', 'This crop selects the cheek that is less obscured by the hand. Its warm peach impression can inspire a sheer blush placement, but event lighting affects the apparent color.', [.605,.497,.23,.116], ['blush','contour'], ['kbeauty-068','kbeauty-081']),
      region('lips', 'Rich warm-rose accent', 'The lip is noticeably deeper and warmer than the surrounding complexion, with a little shine. Layer a warm rose tint and keep the edge softly defined for a wearable statement.', [.50,.637,.235,.076], ['lip_tint','lipstick','lip_gloss'], ['kbeauty-076']),
    ], campaignProducts: [],
  },
  {
    id: 'jungkook-bbmas-2019', artistId: 'jungkook', title: 'Soft rose with a polished satin base',
    summary: 'A softly rosy lip and subtle brown eye definition balance a formal dark suit. The low-contrast complexion makes this a useful polished, everyday-to-event reference.',
    tags: ['soft rose', 'satin', 'natural finish', 'red carpet', '정국'], occasion: 'Billboard Music Awards red carpet · 1 May 2019',
    sourceTitle: 'Jungkook on the 2019 Billboard Music Awards red carpet', sourceDate: '2019-05-01',
    regions: [
      region('face', 'Even satin base', 'The complexion is softly even and retains some visible texture. Try thin base layers and targeted concealer; match the shade to your own skin rather than the photographed brightness.', [.265,.11,.44,.34], ['foundation','concealer','powder'], ['kbeauty-070','kbeauty-072']),
      region('eyes', 'Soft brown lash definition', 'A muted brown impression surrounds the lash line, with a subtle outer extension. Blend pencil softly and keep the lid shading light for a similar low-contrast finish.', [.345,.23,.29,.047], ['eyeliner','eyeshadow'], ['kbeauty-077']),
      region('brows', 'Softly structured visible brow', 'The side part hides much of one brow while the other has a gentle, filled shape. Use the visible brow for soft stroke direction without assuming symmetry under the hair.', [.338,.20,.28,.04], ['brow'], ['kbeauty-088']),
      region('cheeks', 'Muted rosy cheek', 'A quiet rosy tone sits across the cheek area without a strongly reflective highlight. Blend a sheer blush broadly, keeping the outer edge soft.', [.30,.265,.36,.08], ['blush','contour'], ['kbeauty-026']),
      region('lips', 'Softly defined rosy center', 'The lips show a pink-rose center and a soft satin reflection. Build a tint gradually and blur the edge; a subtle liner can add definition if you prefer.', [.416,.345,.15,.052], ['lip_tint','lip_liner'], ['kbeauty-025','kbeauty-073']),
    ], campaignProducts: [],
  },
  {
    id: 'hyunjin-airport-2024', artistId: 'hyunjin', title: 'Rose-washed eyes & fresh glow',
    summary: 'A rose wash around the eyes and a fuller rose lip accompany a gently reflective complexion. Long hair and pale denim soften the overall airport styling.',
    tags: ['rose eyes', 'glow', 'soft smoky', 'airport', '현진'], occasion: 'Incheon Airport departure · 3 May 2024',
    sourceTitle: 'Hyunjin departing Incheon Airport', sourceDate: '2024-05-03',
    regions: [
      region('face', 'Gentle reflected glow', 'Light catches the nose and upper cheek while the rest of the base stays soft. Use a thin luminous base and control shine selectively; the bright setting contributes to the photographed glow.', [.245,.09,.385,.34], ['primer','cushion','concealer'], ['kbeauty-058','kbeauty-071']),
      region('eyes', 'Soft rose wash', 'A muted rose impression surrounds the visible lids and lower lash line. Blend a sheer rose shadow with soft edges, adding only a little pencil close to the lashes.', [.25,.195,.225,.056], ['eyeshadow','eyeliner'], ['kbeauty-082','kbeauty-077']),
      region('brows', 'Dark brow with a gentle front', 'Visible brow sections create a dark frame while hair overlaps the outer area. Brush and lightly fill the visible shape, keeping the front diffused.', [.25,.167,.236,.047], ['brow'], ['kbeauty-086']),
      region('cheeks', 'Quiet rose and reflected light', 'The visible cheek reads softly rosy with restrained reflection. Use a sheer cheek color and add a small highlighter touch only where you want more shine.', [.26,.233,.275,.09], ['blush','highlighter'], ['kbeauty-048','kbeauty-079']),
      region('lips', 'Soft full rose lip', 'A rose-toned lip is more pronounced than the cheek color, with a soft edge and gentle shine. Build tint at the center and blend outward, adding a little clear gloss if desired.', [.30,.315,.145,.06], ['lip_tint','lip_gloss','lip_liner'], ['kbeauty-047','kbeauty-084']),
    ], campaignProducts: [],
  },
  {
    id: 'jungkook-stage-2019', artistId: 'jungkook', title: 'Smoky stage eyes & vivid rose lip',
    summary: 'Dark eye definition and a saturated rose lip hold their contrast under colored stage lighting. A black embellished outfit reinforces the stronger performance styling.',
    tags: ['smoky eyes', 'stage', 'defined eyes', 'statement lip', '정국'], occasion: 'Seoul Music Awards · Fake Love performance · 15 January 2019',
    sourceTitle: 'Jungkook performing Fake Love at the Seoul Music Awards', sourceDate: '2019-01-15',
    resolutionNote: 'This performance still includes colored lighting and a tilted head. Detail views preserve that angle; apparent shades and shine are influenced by the stage.',
    regions: [
      region('face', 'Stage contrast and selective shine', 'The cheek catches a strong highlight while the dark outfit and background increase contrast. Use an even base and selective powder for your own conditions; the photo cannot separate makeup shine from stage lighting.', [.242,.232,.52,.38], ['foundation','concealer','powder','setting_spray'], ['kbeauty-070','kbeauty-063','kbeauty-064']),
      region('eyes', 'Dark smoky upper and lower line', 'Dark definition surrounds the eyes, especially near the outer lash line. Blend shadow and a soft pencil together, building depth gradually instead of keeping a sharp graphic edge.', [.455,.33,.28,.112], ['eyeshadow','eyeliner','mascara'], ['kbeauty-077','kbeauty-085']),
      region('brows', 'Structured frame at an angle', 'The exposed brow gives a stronger frame above the smoky eye. This crop follows the tilted head and includes nearby eye area; use short brow strokes and soften the front.', [.445,.273,.315,.145], ['brow'], ['kbeauty-086']),
      region('cheeks', 'Reflective cheek against a smoky eye', 'The visible cheek catches pale reflected stage light. For an inspired balance, keep blush restrained and concentrate any highlight on a small area instead of copying the lighting color.', [.323,.37,.185,.113], ['highlighter','blush','contour'], ['kbeauty-079','kbeauty-081']),
      region('lips', 'Saturated rose stage accent', 'The lip has a vivid rose-red impression that remains visible against the smoky eye. Build a stain or lipstick in thin layers and refine the edge to the level of definition you prefer.', [.44,.475,.17,.083], ['lip_tint','lipstick','lip_liner'], ['kbeauty-030','kbeauty-073']),
    ], campaignProducts: [],
  },
);

const styleIdsByLook = {
  'felix-airport-2024': ['barely_there'],
  'jennie-coco-crush-2024': ['soft_rose','dewy_glow'],
  'v-airport-2022': ['barely_there','soft_smoky'],
  'jisoo-airport-2024': ['barely_there','soft_rose'],
  'jimin-radio-2023': ['barely_there','soft_rose'],
  'wonyoung-mma-2024': ['dewy_glow','soft_rose'],
  'hyunjin-airport-2024': ['soft_rose','dewy_glow','soft_smoky'],
  'karina-airport-2025': ['soft_rose','dewy_glow'],
  'jungkook-stage-2019': ['stage_definition','soft_smoky','statement_lip'],
  'nayeon-kitsune-2024': ['statement_lip','dewy_glow'],
  'jimin-bbmas-2019': ['warm_bronze','soft_smoky','statement_lip'],
  'karina-mma-2024': ['soft_smoky','soft_rose'],
  'jungkook-bbmas-2019': ['barely_there','soft_rose'],
};
const displayOrder = Object.keys(styleIdsByLook);
looks.sort((a, b) => displayOrder.indexOf(a.id) - displayOrder.indexOf(b.id));
for (const look of looks) look.styleIds = styleIdsByLook[look.id];

const plainText = html => String(html || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
for (const look of looks) {
  const record = research.sources.find(source => source.id === look.id);
  const info = record.metadata;
  const file = readFileSync(path.join(root, 'web/assets/looks', record.localFilename));
  const sha256 = createHash('sha256').update(file).digest('hex');
  if (sha256 !== record.sha256 || file.length !== info.size) throw new Error(`Photo integrity failed: ${look.id}`);
  const credit = plainText(info.extmetadata.Attribution?.value || info.extmetadata.Artist.value);
  const videoUrl = plainText(info.extmetadata.Credit.value.match(/href="(https:\/\/www\.youtube\.com\/watch\?[^\"]+)"/)?.[1] || '');
  look.source = { url: info.descriptionurl, title: look.sourceTitle, date: look.sourceDate, kind: 'licensed_event_photo', originalUrl: videoUrl };
  look.image = {
    src: `assets/looks/${record.localFilename}`, width: info.width, height: info.height,
    alt: `${look.sourceTitle}; ${look.sourceDate}.`, sourceUrl: info.descriptionurl,
    imageUrl: info.url.split('?')[0], credit, license: info.extmetadata.LicenseShortName.value,
    licenseUrl: info.extmetadata.LicenseUrl.value, sha256, bytes: file.length, displayAllowed: true,
    displayScope: 'Attributed editorial style reference; no artist endorsement or advertising permission is represented.',
    modificationNote: 'Source image bytes are unchanged. Detail views crop the displayed image using saved coordinates.',
    modelRelease: 'Not provided by source',
  };
  look.productLinks = look.campaignProducts.map(productId => {
    const evidence = products.get(productId).kpop_connection;
    return {
      productId, relationship: 'documented_campaign', scope: evidence.association_scope,
      sourceUrl: evidence.source_url, evidenceDate: evidence.evidence_date,
      note: `${evidence.connection_summary} This separate promotion does not identify products worn in the displayed event photograph.`,
    };
  });
  look.editorialNote = editorialNote;
  delete look.sourceTitle;
  delete look.sourceDate;
  delete look.campaignProducts;
  record.licenseReviewUrl = record.artistId === 'felix'
    ? 'https://commons.wikimedia.org/wiki/File:Felix_Lee_of_Stray_Kids,_July_8,_2024_(2)_(cropped).png'
    : info.descriptionurl;
  record.licenseReviewScope = record.artistId === 'felix'
    ? 'The Commons derivative page records review of the same source video; this library bundles its linked original still.'
    : 'The file description page records review of the source license.';
}

const bioSources = {
  blackpink: [{url:'https://ygfamily.com/en/artists/blackpink/profile', title:'YG Entertainment — BLACKPINK profile', evidence:'Official member list includes Jisoo and Jennie; awards identify BLACKPINK as a girl group.'}],
  ive: [{url:'https://www.sonymusic.co.jp/artist/IVE/profile/', title:'Sony Music — IVE profile', evidence:'Official profile lists Wonyoung and describes IVE within female-artist chart records.'}],
  aespa: [{url:'https://prtimes.jp/main/html/rd/p/000000496.000005358.html', title:'SM Entertainment Japan — aespa official website announcement', evidence:'The company-issued profile lists Karina as a member of the K-pop girl group aespa.'}],
  twice: [{url:'https://twice.jype.com/discography/9g1kq9h8', title:'JYP Entertainment — Nayeon NA', evidence:'Official release describes Nayeon as a female solo artist and member of TWICE.'}],
  bts: [
    {url:'https://bts.ibighit.com/eng/profile/', title:'BIGHIT MUSIC — BTS profile', evidence:'Official profile names V, Jimin, and Jung Kook among the BTS members.'},
    {url:'https://bts.ibighit.com/eng/discography/detail/hwayangyeonhwa-pt2.html', title:'BIGHIT MUSIC — The most beautiful moment in life pt.2', evidence:'Official album introduction describes the BTS members as seven young men.'},
  ],
  straykids: [
    {url:'https://straykids.jype.com/profile', title:'JYP Entertainment — Stray Kids profile', evidence:'Official profile lists Hyunjin and Felix.'},
    {url:'https://www.versace.com/om/en/stories/', title:'Versace — Hyunjin for Holiday 2023 story listing', evidence:'Official campaign summary describes Hyunjin as a member of the boy group Stray Kids.'},
  ],
};
const artist = (id, name, group, referenceGroup, sources) => ({id, name, group, referenceGroup, referenceGroupSources: sources});
const library = {
  schemaVersion: 1, researchedOn: '2026-10-05',
  title: 'K-pop makeup reference library',
  description: 'Save the whole look or individual face, eye, brow, cheek, and lip details. Style notes are editorial observations, and product suggestions are inspired alternatives.',
  rightsNote: 'Photos retain source credits and Creative Commons license links. The library is an editorial reference collection; image licenses do not establish artist endorsement, a model release, or permission to advertise products using an artist’s likeness.',
  regionMethod: 'Normalized 0–1 crop rectangles were set after visually inspecting each named source photograph. They select display areas and are not facial recognition or a diagnosis.',
  productLinkMethod: 'Region productIds and productCategories are style-inspired alternatives. productLinks with documented_campaign record separate official promotions and preserve product-family, shade, date, and personal-use limits.',
  referenceGroupMethod: 'Artist reference groups follow public biographies and official group descriptions, not appearance. They organize references only; every style and product can be explored by anyone.',
  styleMethod: 'Style IDs describe visible editorial qualities of a particular photograph, not an artist’s identity, exact products, or a verified skincare routine.',
  regions: [{id:'face',label:'Face / base'},{id:'eyes',label:'Eyes'},{id:'brows',label:'Brows'},{id:'cheeks',label:'Cheeks'},{id:'lips',label:'Lips'}],
  artists: [
    artist('felix','Felix · 필릭스','Stray Kids','men',bioSources.straykids),
    artist('jennie','Jennie · 제니','BLACKPINK','women',bioSources.blackpink),
    artist('v','V · 뷔','BTS','men',bioSources.bts),
    artist('jisoo','Jisoo · 지수','BLACKPINK','women',bioSources.blackpink),
    artist('jimin','Jimin · 지민','BTS','men',bioSources.bts),
    artist('wonyoung','Jang Wonyoung · 장원영','IVE','women',bioSources.ive),
    artist('hyunjin','Hyunjin · 현진','Stray Kids','men',bioSources.straykids),
    artist('karina','Karina · 카리나','aespa','women',bioSources.aespa),
    artist('jungkook','Jungkook · 정국','BTS','men',bioSources.bts),
    artist('nayeon','Nayeon · 나연','TWICE','women',bioSources.twice),
  ],
  looks,
};
writeFileSync(path.join(root, 'web/data/kpop-looks.json'), JSON.stringify(library, null, 2) + '\n');
const notices = ['K-pop style photograph attributions', '', library.rightsNote, '', ...looks.flatMap(look => [
  `${look.image.src}: ${look.source.title} (${look.source.date})`,
  `Credit: ${look.image.credit}`, `Source: ${look.image.sourceUrl}`,
  `Original image: ${look.image.imageUrl}`, `License: ${look.image.license} — ${look.image.licenseUrl}`,
  look.image.modificationNote, '',
])];
writeFileSync(path.join(root, 'web/assets/looks/ATTRIBUTION.txt'), notices.join('\n'));
research.campaignSources = looks.flatMap(look => look.productLinks.map(link => ({lookId: look.id, ...link, imageReuse: 'Source link only; campaign images are not bundled.'})));
research.artistSources = library.artists.map(({id, referenceGroup, referenceGroupSources}) => ({artistId:id, referenceGroup, sources:referenceGroupSources, reviewedOn:library.researchedOn}));
writeFileSync(path.join(root, 'research/kpop-style-sources.json'), JSON.stringify(research, null, 2) + '\n');
console.log(`Built ${looks.length} looks, ${looks.reduce((total, look) => total + look.regions.length, 0)} region views, and ${research.campaignSources.length} separate sourced campaign links.`);
