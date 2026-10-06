# Dewdrop Android app

`com.dewdrop.beauty` is an offline Android application for Android 8.0 (API 26) and newer, with Android System WebView/Chrome 89 or newer. It targets Android 16 (API 36). The native Java activity packages the shared `../web` application; product matching and questionnaire data run on the device. Devices with an older or missing WebView receive an update message.

## Build on Windows

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/android-setup.ps1
powershell -ExecutionPolicy Bypass -File scripts/build-android.ps1
```

Setup downloads portable Eclipse Temurin JDK 17 and official Android SDK 36 / Build Tools 36.0.0 into `.android-tools`, verifies their published checksums, and writes `android/local.properties`. It does not change system settings or install an IDE. Downloading the Android SDK is subject to Google's SDK license: <https://developer.android.com/studio/terms>.

The build compiles native resources and Java, converts bytecode with D8, bundles current web assets, aligns the APK, signs it with a local development key, and verifies the signature. Output: `outputs/Dewdrop-debug.apk`, with a SHA-256 sidecar. It uses a debug key stored in `.android-tools/debug.keystore`; keep that local key to install future builds over the same app without resetting local data.

## Android Studio / Gradle

Open this `android` folder in Android Studio with JDK 17 and SDK 36 installed. The project includes the official Gradle 8.13 wrapper with its distribution checksum and Android Gradle Plugin 8.13.0.

```powershell
cd android
.\gradlew.bat assembleDebug
```

Gradle output is `app/build/outputs/apk/debug/app-debug.apk`. Both build paths package the same shared `web` source. A release build for distribution needs your own protected signing key and release process.

## Install

Transfer `Dewdrop-debug.apk` to an Android device, open it, and allow installation from the app used to open the file if Android requests it. Alternatively, with USB debugging and Android platform tools:

```text
adb install -r outputs/Dewdrop-debug.apk
```

## Runtime boundaries

- Local assets use `https://appassets.androidplatform.net/` through `WebViewClient.shouldInterceptRequest`. The app requests camera permission only when taking a selfie; it does not request internet, microphone, location, contacts, or storage permissions. Camera hardware is optional so choosing a photo and using the questionnaire remain available.
- `WebChromeClient` grants only video capture to the exact bundled HTTPS origin after Android camera permission succeeds. Denied and canceled requests are returned to the web UI. The web app requests the front camera and stops live streams when capture ends or the app is backgrounded.
- Image inputs use the Android document picker or, for `capture` inputs, the device camera app. The document picker grants access only to the chosen image; non-content URIs, this app's provider, and non-image types are rejected. The camera fallback writes a JPEG through a nonexported, temporarily URI-granted provider restricted to the selfie cache. Its default camera depends on the device camera app; users may need to switch it to the front camera.
- Native capture cache files are deleted on the next selection or activity destruction. Files left by an interrupted process are pruned after 24 hours when native capture is next used. Camera URI grants are revoked as soon as the camera returns. No selfie is uploaded by the offline shell.
- Every nonlocal resource request is blocked. User-tapped HTTPS product links open in the device's browser.
- File/content access, mixed content, cookies, popups, and native JavaScript bridges are disabled. A content security policy restricts active content to bundled assets.
- The shared web app stores preferences and results in WebView local storage on the device. Android backup is disabled. Clearing app storage or uninstalling removes them.
- Native system-bar, cutout and keyboard insets keep the interface visible. Android back closes an open modal, then follows WebView history; rotation restores browser state. Semantic web controls remain accessible to Android's WebView accessibility support.

The build scripts compile both the activity and photo provider and verify the APK's signing and alignment. A device/emulator smoke test is still required before release: first-use camera permission, denial/retry, front-camera preview and capture, camera-app fallback, photo selection and cancellation, retake, background/return, rotation during capture, keyboard layout, screen reader interaction, system back navigation, and opening retailer links. No AndroidX dependency is needed for the scoped photo provider.

References: [Android 16 SDK configuration](https://developer.android.com/about/versions/16/setup-sdk), [AGP 8.13 compatibility](https://developer.android.com/build/releases/agp-8-13-0-release-notes), [loading bundled WebView content](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content), [WebView file selection](https://developer.android.com/reference/android/webkit/WebChromeClient.FileChooserParams), [camera permission and intents](https://developer.android.com/privacy-and-security/minimize-permission-requests).

## Offline selfie analysis

The APK bundles MediaPipe Face Landmarker and both WASM variants. The same worker-based pixel analysis runs in WebView without an internet permission. A Chromium 100+ WebView with OffscreenCanvas/WebGL is required. CSP allows local worker scripts and WebAssembly compilation; it does not enable arbitrary JavaScript eval. The build checks all pinned vision assets before packaging. Physical-device analysis, memory use, and camera/picker handoff still need a smoke test.
