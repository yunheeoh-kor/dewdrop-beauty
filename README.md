# Dewdrop — Korean beauty kit planner

An offline Android prototype built from the 56-product Korean cosmetics catalog, the beginner questionnaire, and `recommendation-rules.json`.

## Try it

The installable Android debug build is `outputs/Dewdrop-debug.apk`. Transfer it to an Android 8.0+ device and open it to install, or use `adb install -r outputs/Dewdrop-debug.apk` from a computer with a connected device. A current Android System WebView (Chromium 100+) is required. This is a development build, not a Play Store release.

For a desktop or phone-sized browser preview, run from this folder:

```powershell
node scripts/serve.mjs
```

Open <http://127.0.0.1:4173>. The server binds only to this computer. Node 20.11+ is required; there are no npm dependencies.

## Included

- Selfie-first home entry with front-camera preview, shutter capture, gallery selection, and Android system-camera fallback. Permission errors offer a photo picker or the no-photo path.
- Immediate product previews after capture or selection, plus an editable questionnaire beside results. Goals, budget, skin feel, reaction history, texture, and makeup preferences update picks immediately; the full questionnaire remains available.
- Photos undergo actual on-device face-landmark inference and pixel sampling. They are never uploaded or saved in the profile. Native camera fallback uses a temporary app-private JPEG until another image is chosen or the activity is destroyed. MediaPipe detects face regions; robust lip/cheek samples feed color-family exploration against reviewed catalog shades. The user can correct and confirm the color before it changes the kit. No diagnosis, skin feel, undertone, identity, or exact shade match is inferred.

- Seven guided screens covering the six core questions and relevant follow-ups: kit scope, whole-kit USD budget and optional fee reserve, retained products, ordered goals, routine complexity, skin feel, reaction history, exclusions, texture, makeup preferences, requirements, and exact catalog shade choice.
- Editable category priorities, retained-product counts, explainable fit scores, evidence coverage, missing-slot reasons, and swaps that recheck the whole kit.
- All 56 catalog products, brand/category search, local favorites, source links, and carefully scoped K-pop campaign information.
- Profile and draft persistence on the device, data deletion controls, offline bundled assets, and Android back navigation.
- Android launcher icons, standard Gradle project, a portable Windows build script, and automated engine/evidence tests.

## What the prototype can and cannot verify

The app produces **planning estimates**, never purchase-ready checkout guarantees. Product prices are the catalog's October 5, 2026 snapshot; shipping, taxes, stock, and current exact-variant prices are not live. A user-entered reserve is a planning allowance, not a verified charge.

The first catalog supports U.S./USD planning. Other shopping markets cannot fill new-purchase slots. Product illustrations show approximate forms; they are not product photographs.

Reviewed skincare products can fill a complete kit if the budget, item cap, and other constraints allow it. Makeup remains browsable and previewable, but currently stays pending because product-specific removal instructions and compatible removal requirements are unverified. Choosing a cataloged base shade does not establish a personal shade match.

Ingredient lists contain selected ingredients, not complete INCI lists. Explicit exclusions cannot be cleared from these partial lists. Uncertain or unexplained reaction history stays pending; free-text notes are not treated as validated evidence. Keeping an owned product does not certify tolerance or compatibility.

Selfie analysis runs locally with a bundled MediaPipe Face Landmarker model. Visible cheek/lip colors are measured from actual pixels; lip color is compared with a versioned editorial palette. Photo color ideas remain separate from the planning kit until the user confirms a color preference. Skincare suggestions continue to use editable answers and catalog evidence. There is no diagnosis, account, backend, analytics, purchase flow, or cloud synchronization. Unanswered reaction history yields clearly labeled previews; these do not count toward the kit total. The questionnaire-only path is fully supported by the original rules. No medical safety or efficacy score is calculated.

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
| `web/camera.js`, `web/selfie-ui.js`, `web/selfie.css` | Session-only photo capture, picker, instant results, and quick questionnaire |
| `web/instant.js` | Immediate previews with the same engine constraints and pending checks |
| `web/photo-analysis.js`, `web/analysis-worker.js` | Local worker inference and lifecycle/cancellation |
| `web/photo-measurements.js`, `web/photo-shortlist.js` | Measured pixel colors, editorial color exploration, and explicit confirmation |
| `web/vendor/mediapipe/`, `web/models/` | Pinned offline runtime and face model, checked before every APK build |
| `web/engine.js` | Deterministic filters, scores, whole-kit optimization, and audit records |
| `web/data/catalog.json` | Unmodified copy of the supplied catalog |
| `web/data/evidence.json` | Explicitly reviewed traits, exact variants, requirements, and evidence provenance |
| `web/data/recommendation-rules.json` | Original recommendation specification bundled for reference |
| `android/` | Native Android shell and standard Gradle project |
| `scripts/` | Local preview and portable APK build/setup |
| `tests/` | Recommendation acceptance cases and metadata verification |
| `outputs/Dewdrop-debug.apk` | Installable development build |

Runtime recommendations never turn product prose into traits automatically. The evidence adapter records structured editorial mappings separately from brand facts. A newer catalog adds foundation SKUs missing from the older rules' gap description; each remains gated by exact-shade confirmation and removal evidence. BHA/exfoliating/retinoid products flagged by review require an explicit product choice instead of automatic addition.

The native shell serves only bundled assets at an HTTPS origin, disables file/content URL access and cookies, declares camera permission only (no network or microphone permission), and has no JavaScript-to-native bridge. Camera access is runtime-gated to video only at the bundled app origin. The system image picker grants access only to the selected image. User-tapped external HTTPS source links open in the device browser. Android app backups are disabled.

## Validation

107 automated tests pass, including camera denial/cancellation, stream cleanup, image validation/resizing, immediate previews, preserved exclusions, and whole-kit budget limits. Browser testing at a 390-pixel phone width covered questionnaire completion, invalid reserve rejection, two-goal limit, retained products, kit calculations, budget-constrained swaps, readable score breakdowns, search, favorites, and persistence after reload. Browser checks also cover real model inference using the official MediaPipe portrait test image, measured swatches, image-driven color alternatives, and live questionnaire updates. The Android project compiles; the APK signature, alignment, and bundled assets are verified.

No Android device or emulator was available, so installation, launch, physical front-camera capture, runtime permission prompts, gallery/native-camera handoff, system back, external browser handoff, and keyboard behavior still need a device smoke test before distribution.

## On-device image analysis

The app bundles MediaPipe Tasks Vision 0.10.35 and Face Landmarker model float16 version 1 (about 25 MiB before APK compression). It runs on a dedicated worker, supports both SIMD and non-SIMD WebAssembly, and requires a recent WebView/browser with OffscreenCanvas and WebGL. Runtime requests stay at the app origin; the Android app still has no internet permission. Worker termination releases model buffers after each analysis or cancellation.

No-face, multiple-face, clipped, cropped, or insufficient-pixel cases ask for a retake without inventing observations. Technical sampling gates are operational heuristics, not a validated image-quality or skin assessment. Makeup, lighting, filters, white balance and occlusion can affect color observations. The displayed swatches describe only the pixels in the photo. There is no calibrated confidence, cosmetic efficacy score or foundation matching.

Only pink and coral currently have reviewed catalog color-family evidence. Other observed families use the closest available family in the editorial palette, visibly labeled as an alternative. Questionnaire color choices take precedence; budget, exclusions, requirements, owned products and item limits still apply. Prices shown together are alternatives, not a combined cart. Confirming a color stores the choice and provenance only. Photos, sample values and face geometry are not stored.

Verify bundled assets offline with `node scripts/setup-vision.mjs --check`; restore pinned assets with `node scripts/setup-vision.mjs --download` when needed. Download URLs, hashes, licenses and test-image attribution are in `THIRD_PARTY_NOTICES.txt` and `web/vendor/mediapipe/manifest.json`. See the [official Face Landmarker guide](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js) for the model API.
