# Dewdrop — Korean beauty kit planner

An offline Android prototype built from the 98-product Korean cosmetics catalog (including 58 makeup products), the beginner questionnaire, and `recommendation-rules.json`.

## Try it

The installable Android debug build is `outputs/Dewdrop-debug.apk`. Transfer it to an Android 8.0+ device and open it to install, or use `adb install -r outputs/Dewdrop-debug.apk` from a computer with a connected device. A current Android System WebView (Chromium 100+) is required. This is a development build, not a Play Store release.

For a desktop or phone-sized browser preview, run from this folder:

```powershell
node scripts/serve.mjs
```

Open <http://127.0.0.1:4173>. The server binds only to this computer. Node 20.11+ is required; there are no npm dependencies.

## Included

- Selfie-first home and navigation with a live front-camera preview. Continuous focus is requested on supported cameras; one centered, clear, exposed and stable face triggers capture automatically after a 1.2-second hold. A manual shutter, gallery selection and Android system-camera fallback remain available.
- A large face-framed selfie with up to three recommendation markers. Tap a marker to zoom that area in the same photo workspace, with observations, recommendation reasons, products and K-pop style comparisons beside it. Explore all seven areas on demand; editable preferences and the routine planner are secondary expandable panels.
- Photos undergo actual on-device face-landmark inference and pixel sampling. They are never uploaded or saved in the profile. Native camera fallback uses a temporary app-private JPEG until another image is chosen or the activity is destroyed. MediaPipe detects face regions; robust lip/cheek samples feed color-family exploration against reviewed catalog shades. The user can correct and confirm the color before it changes the kit. No diagnosis, skin feel, undertone, identity, or exact shade match is inferred.
- Four skin-detail cards give best-effort appearance estimates for pore-like texture, pigment/color variation, fine line-like detail and moisture appearance. Readable photos receive estimates even with limited detail, together with a brief indication of uncertainty. Moisture appearance describes the visible finish, while user-reported skin feel remains separate from the image estimate.

- Seven guided screens covering the six core questions and relevant follow-ups: kit scope, whole-kit USD budget and optional fee reserve, retained products, ordered goals, routine complexity, skin feel, reaction history, exclusions, texture, makeup preferences, requirements, and exact catalog shade choice.
- Editable category priorities, retained-product counts, explainable fit scores, evidence coverage, missing-slot reasons, and swaps that recheck the whole kit.
- All 98 catalog products, including 58 makeup products across 17 types, with brand/category/face-region search, local favorites, source links, and carefully scoped K-pop campaign information.
- A K-pop style library with 10 artists, 13 attributed event/airport photographs, 65 face-region views, category-linked makeup alternatives, and separately saved full looks or individual regions. Photos are bundled offline with CC BY 3.0 source and license credits.
- Profile and draft persistence on the device, data deletion controls, offline bundled assets, and Android back navigation.
- A consistent sage droplet icon across the Android launcher, browser, and app header. Branded Android launch artwork leads into a cream Dewdrop loading screen with gentle animation, reduced-motion support, and an immediate handoff when the app is ready. Failed or stalled startup offers a retry without clearing saved choices. Android 13+ launchers can use the themed monochrome icon.
- Standard Gradle project, a portable Windows build script, and automated engine/evidence tests.

## What the prototype can and cannot verify

The app produces **planning estimates**, never purchase-ready checkout guarantees. Product prices are the catalog's October 5, 2026 snapshot; shipping, taxes, stock, and current exact-variant prices are not live. A user-entered reserve is a planning allowance, not a verified charge.

The first catalog supports U.S./USD planning. Other shopping markets cannot fill new-purchase slots. Product cards, recommendations, kit items, and details use bundled photographs from the brands and catalog retailers. Each product's details link to the photo source; any product-family or variant limitation is noted there. Packaging and on-screen colors can vary.

Reviewed skincare products can fill a complete kit if the budget, item cap, and other constraints allow it. Makeup remains browsable and previewable, but currently stays pending because product-specific removal instructions and compatible removal requirements are unverified. Choosing a cataloged base shade does not establish a personal shade match.

Ingredient lists contain selected ingredients, not complete INCI lists. Explicit exclusions cannot be cleared from these partial lists. Uncertain or unexplained reaction history stays pending; free-text notes are not treated as validated evidence. Keeping an owned product does not certify tolerance or compatibility.

Selfie analysis runs locally with a bundled MediaPipe Face Landmarker model. Real landmarks guide brow/eye/lip geometry and nose/cheek placement, while actual pixels supply color, fine local contrast and broader color variation. Resolution, focus, pose, lighting and noise qualify best-effort skin estimates instead of routinely blocking them. Invalid or unreadable input still cannot produce an observation. Visible detail can guide cosmetic texture/tone product exploration, but does not identify pores, pigmentation disorders, skin type or a cause. Image-driven ideas remain alternatives outside the planned total; questionnaire choices refine them and confirmed color choices update the plan. There is no diagnosis, account, backend, analytics, purchase flow, or cloud synchronization. Unanswered reaction history stays pending. No medical safety or efficacy score is calculated.

## Build and test

```powershell
node --test tests/*.test.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-android.ps1 -Setup
```

The setup script downloads checksum-verified portable JDK/Android tooling into ignored `.android-tools/` inside this workspace. Once downloaded, omit `-Setup` for subsequent builds. It does not change machine-wide Java or Android settings. See `android/README.md` for Android Studio/Gradle instructions.

The standard Gradle project uses AGP 8.13.0, Gradle 8.13, Java 17, compile/target SDK 36, and minimum SDK 26. The portable build produces the same Java WebView application through `aapt2`, `javac`, D8, `zipalign`, and `apksigner`. It packages all files in `web/` into the APK and verifies signing/alignment.

## Project structure

| Path | Purpose |
| --- | --- |
| `web/app.js`, `web/styles.css` | Responsive app screens and local device state |
| `web/startup.js`, `web/launch.css`, `web/icon.svg` | Branded startup, readiness/error handling, reduced motion, and shared web icon |
| `web/camera.js`, `web/selfie-ui.js`, `web/selfie.css` | Session-only photo capture, picker, instant results, and quick questionnaire |
| `web/instant.js` | Immediate previews with the same engine constraints and pending checks |
| `web/photo-analysis.js`, `web/analysis-worker.js` | Local worker inference and lifecycle/cancellation |
| `web/photo-measurements.js`, `web/photo-shortlist.js` | Measured pixel colors, editorial color exploration, and explicit confirmation |
| `web/skin-insights.js`, `web/skin-insights-ui.js` | Best-effort cheek appearance estimates, visible finish, uncertainty notes and four skin-detail cards |
| `web/capture-worker.js`, `web/capture-quality.js` | Real live face detection, technical quality checks and a stable auto-capture hold |
| `web/face-regions.js`, `web/face-recommendations.js` | Seven measured face regions, image-driven style/care directions and constrained product alternatives |
| `web/face-studio.js`, `web/face-studio.css` | Face framing, original-pixel region zoom, three markers and progressive disclosure |
| `web/face-style-comparison.js` | Region-specific K-pop reference crops, styling differences and attributed source links |
| `web/vendor/mediapipe/`, `web/models/` | Pinned offline runtime and face model, checked before every APK build |
| `web/engine.js` | Deterministic filters, scores, whole-kit optimization, and audit records |
| `web/data/catalog.json` | Expanded live catalog with source-dated products and makeup taxonomy; original exports remain historical snapshots |
| `web/beauty-library.js`, `web/lookbook.js`, `web/lookbook.css` | Makeup browsing, artist/style filters, region views and device-local bookmarks |
| `web/style-guides.js`, `web/style-guide-ui.js`, `web/style-guides.css`, `web/data/beauty-styles.json` | Distinct makeup/skincare edits and explicit preference selection |
| `web/data/kpop-looks.json`, `web/assets/looks/` | Artist/whole-look/region references, licensed source photographs and attribution |
| `research/makeup-expansion.json`, `research/kpop-style-sources.json` | Research provenance for expanded makeup and style references |
| `web/data/product-images.json`, `web/assets/products/` | Bundled product photographs, source links, and image checksums |
| `web/data/evidence.json` | Explicitly reviewed traits, exact variants, requirements, and evidence provenance |
| `web/data/recommendation-rules.json` | Original recommendation specification bundled for reference |
| `android/` | Native Android shell and standard Gradle project |
| `scripts/` | Local preview and portable APK build/setup |
| `tests/` | Recommendation acceptance cases and metadata verification |
| `outputs/Dewdrop-debug.apk` | Installable development build |

Runtime recommendations never turn product prose into traits automatically. The evidence adapter records structured editorial mappings separately from brand facts. A newer catalog adds foundation SKUs missing from the older rules' gap description; each remains gated by exact-shade confirmation and removal evidence. BHA/exfoliating/retinoid products flagged by review require an explicit product choice instead of automatic addition.

The native shell serves only bundled assets at an HTTPS origin, disables file/content URL access and cookies, declares camera permission only (no network or microphone permission), and has no JavaScript-to-native bridge. Camera access is runtime-gated to video only at the bundled app origin. The system image picker grants access only to the selected image. User-tapped external HTTPS source links open in the device browser. Android app backups are disabled.

## Validation

Automated tests cover camera denial/cancellation, automatic capture hold and aspect-ratio independence, worker cleanup, real-pixel appearance estimates, image-to-product mapping, region crops, exclusions and whole-kit constraints. Browser testing uses the official MediaPipe portrait for real model inference and checks the three-marker face map, all seven areas, the in-place photo inspector, product suggestions and K-pop references at desktop and 390-pixel phone widths. Existing questionnaire, kit, catalog and reference-library checks remain covered. Current test totals and APK verification are recorded in `outputs/studio-estimates-validation.txt`.

The skin-insight extension adds synthetic dot/patch/line/reflection tests, multiple skin-color fixtures, gentle illumination gradients, adaptive small-image sampling, and seeded grain regressions. Softness, small photos, lighting differences and grain qualify the estimates instead of routinely blocking them. Strong grain still suppresses unsupported numerical diameters, and unreadable pixels cannot produce an estimate. Browser checks with the public portrait confirm all four appearance estimates, moisture-finish wording and usable texture/color regions. The inspector tests cover viewport preservation, bounded crops, all-area navigation, tab accessibility, selected styles and region-specific K-pop reference links. These checks validate software behavior, not clinical accuracy.

An isolated browser fixture (`node scripts/serve-capture-test.mjs`, then `http://127.0.0.1:4181/capture-harness.html`) exercised the production camera controller, real MediaPipe VIDEO worker and a canvas video source. A clear framed portrait advanced through the stable hold and produced exactly one capture, releasing its stream and worker. A no-face scene did not capture automatically; the manual shutter still worked. This test uses a public fixture, not camera hardware. Harness files are outside the packaged `web/` directory.

Startup browser checks cover normal and delayed readiness, missing catalog and app-module recovery through retry, a 15-second stalled-load timeout, and keyboard access to retry in a short landscape viewport. The loading screen was visually checked at a 390-pixel phone width. Android launch resources compile and are included in the verified APK; their appearance and transition still need a physical-device check.

No Android device or emulator was available, so installation, launch, physical front-camera capture, runtime permission prompts, gallery/native-camera handoff, system back, external browser handoff, and keyboard behavior still need a device smoke test before distribution.

## On-device image analysis

The app bundles MediaPipe Tasks Vision 0.10.35 and Face Landmarker model float16 version 1 (about 25 MiB before APK compression). It runs on a dedicated worker, supports both SIMD and non-SIMD WebAssembly, and requires a recent WebView/browser with OffscreenCanvas and WebGL. Runtime requests stay at the app origin; the Android app still has no internet permission. Worker termination releases model buffers after each analysis or cancellation.

Still photos now preserve up to 1920 pixels on the long edge at JPEG quality 0.95; smaller sources are never upscaled. The live capture preview remains capped at 640 pixels. Capture, decode and worker limits agree, so larger photos can retain more genuine detail without enlarging the live-preview workload.

Skin insights sample the central cheeks, not the entire face. Compact dark texture features, broad local color variation, and directional line contrast are deterministic, unvalidated photo heuristics. Adaptive sampling makes a best-effort estimate from smaller or softer photos; limited evidence is described rather than replaced by an unavailable result. Feature widths, when resolvable, are measured only in analyzed-image pixels; no physical pore size/count, melanin level, wrinkle depth, severity or calibrated confidence score is reported. Hair, makeup, shadows, expression, image processing and compression can still confound these observations. Low visual signal does not prove an absence of pores, pigmentation or wrinkles. These observations do not automatically select treatments or change the user's answers.

Moisture appearance leads with an estimated visible finish (low sheen, balanced-looking or dewy-looking) from photo reflection cues. It does not claim a water-content measurement or hydration percentage; the user's skin-feel answer remains explicitly self-reported. Instrument context and implementation limits are documented in `research/skin-analysis-methods.json`, using [Courage + Khazaka's instrument descriptions](https://www.courage-khazaka.com/en/scientific-products/all-products) and [Canfield's controlled imaging system](https://www.canfieldsci.com/imaging-systems/visia-cr/). Those sources do not validate this prototype's algorithms.

No-face, multiple-face, clipped, cropped, or insufficient-pixel cases ask for a retake without inventing observations. Technical sampling gates are operational heuristics, not a validated image-quality or skin assessment. Makeup, lighting, filters, white balance and occlusion can affect color observations. The displayed swatches describe only the pixels in the photo. There is no calibrated confidence, cosmetic efficacy score or foundation matching.

Only pink and coral currently have reviewed catalog color-family evidence. Other observed families use the closest available family in the editorial palette, visibly labeled as an alternative. Questionnaire color choices take precedence; budget, exclusions, requirements, owned products and item limits still apply. Prices shown together are alternatives, not a combined cart. Confirming a color stores the choice and provenance only. Photos, sample values and face geometry are not stored.

Verify bundled assets offline with `node scripts/setup-vision.mjs --check`; restore pinned assets with `node scripts/setup-vision.mjs --download` when needed. Download URLs, hashes, licenses and test-image attribution are in `THIRD_PARTY_NOTICES.txt` and `web/vendor/mediapipe/manifest.json`. See the [official Face Landmarker guide](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js) for the model API.

Verify all 98 bundled product photographs with `node scripts/check-product-images.mjs`. This checks catalog coverage, local image formats, source metadata, and file hashes. The Android build runs this check before packaging; product photos do not require a network connection at runtime.

## Makeup and K-pop reference expansion

The live catalog adds 42 source-checked products to the original 56: primer, cushion, foundation, concealer, powder, setting spray, blush, contour, highlighter, eyeshadow, eyeliner, mascara, brow makeup, lip tint, lipstick, lip gloss and lip liner. All 98 products have bundled photographs. Exact variant prices are recorded from official USD storefronts, while missing net content, full ingredient lists, removal instructions and shade suitability remain explicitly unverified. Browsing metadata never clears the recommendation engine’s evidence gates.

Looks includes five men (Felix, V, Jimin, Jungkook and Hyunjin) and five women (Jennie, Jisoo, Jang Wonyoung, Karina and Nayeon), with 13 whole-photo references and 65 regional views. Each reference contains the full source photograph, editable normalized crop metadata for complexion/eyes/brows/cheeks/lips, style notes, product-category associations, original dimensions, source URLs, creator credit, license and file checksum. Region views use the original image without rewriting it. Whole-look and individual-region bookmarks are independent, persist in `dewdrop.v1` local storage, and appear under saved references and the profile. Photographs are bundled reference assets; this does not save the user’s selfie.

Three separately documented campaign links preserve the distinction between brand/product-family promotion and what an artist wore in the displayed photograph. Related products are category-based editorial alternatives, not exact shade matches or confirmed artist-use claims. The photos’ CC BY licenses cover the attributed reference images, not a model release or artist endorsement. Source/credit/license links are visible in the app and bundled in `web/assets/looks/ATTRIBUTION.txt`.

Expansion validation covers combined catalog filters, independently saved full/region views, reload persistence, artist search, related products, all 17 categories, source metadata, crop bounds, asset bytes and hashes. Browser checks covered a 390-pixel mobile viewport. Run `node --test tests/library.test.mjs` for the focused data/filter checks.

## Different people, styles and routines

The home screen presents two coordinated AI-created editorial portraits for subtle definition and soft rose makeup, with natural skin texture and bundled offline image assets. Artist references can be filtered by Men, Women and style direction; these are browsing filters, not user identity or product eligibility rules. The initial photo order mixes men and women so male examples are visible immediately.

The Styles & routines section contains seven makeup directions (barely there, dewy glow, soft rose, soft smoky, stage definition, warm bronze and statement lip) with 39 different featured makeup products, plus four skincare approaches (minimal routine, cushioned hydration, lightweight layers and comfort before makeup) featuring 13 skincare products. Each has its own techniques, product edit and source-linked explanations. Product photos, exact variants and uncertainty labels come from the live catalog.

Use these preferences explicitly sets the displayed finish, coverage, eye effect, color, texture and priorities and saves the selected makeup/skincare guide ID with `style_guide` provenance. Applying a skincare guide changes only texture and goals. Neither flow infers user gender or skin type, changes budget/exclusions/reaction history, confirms a shade, adds a product, changes kit categories, or replaces owned/exact product choices. Manual answers continue to govern evidence-based ranking.

The selected direction changes regional application instructions and ranks corresponding products among already-qualified face recommendations. Artist look detail shelves prioritize the associated style edits rather than repeating the catalog’s first products. Guide selections alone never prove a product trait or override photo quality, region evidence, formula checks, remaining kit budget, item limits or removal dependencies. A missing reviewed trait remains an explained gap in personal suggestions even when the editorial style shelf offers options to research.
