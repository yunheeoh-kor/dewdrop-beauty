package com.dewdrop.beauty;

import android.app.Activity;
import android.app.AlertDialog;
import android.Manifest;
import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/** Offline shell: only packaged assets execute; no native JavaScript bridge or network permission. */
public final class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/index.html";
    private static final int CAMERA_WEB_PERMISSION = 40;
    private static final int CAMERA_CAPTURE_PERMISSION = 41;
    private static final int PICK_IMAGE = 42;
    private static final int CAPTURE_IMAGE = 43;
    private WebView webView;
    private boolean handlingBack;
    private PermissionRequest cameraRequest;
    private boolean permissionPromptActive;
    private ValueCallback<Uri[]> imageCallback;
    private File capturedPhoto;
    private Uri capturedPhotoUri;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // The system owns the launch window. Use the plain app background for content,
        // including WebView errors, without a second splash Activity or a timed overlay.
        setTheme(R.style.AppTheme);
        super.onCreate(savedInstanceState);
        if (!hasSupportedWebView()) {
            new AlertDialog.Builder(this)
                .setTitle("Update Android System WebView")
                .setMessage("Dewdrop needs an updated web component. Update Android System WebView or Chrome in your device's app store, then reopen Dewdrop.")
                .setPositiveButton("Close", (dialog, which) -> finish())
                .setOnCancelListener(dialog -> finish())
                .show();
            return;
        }
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(getColor(R.color.app_background));
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
                | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        }
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                Insets safe = insets.getInsets(WindowInsets.Type.systemBars()
                    | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });

        webView = new WebView(this);
        webView.setBackgroundColor(getColor(R.color.app_background));
        webView.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_YES);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setGeolocationEnabled(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        CookieManager.getInstance().setAcceptCookie(false);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        webView.setWebViewClient(new LocalAssetsClient());
        webView.setWebChromeClient(new CameraChromeClient());
        root.addView(webView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        root.requestApplyInsets();

        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::navigateBack);
        }
        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            webView.loadUrl(START_URL);
        }
    }

    private void navigateBack() {
        if (handlingBack || webView == null) return;
        handlingBack = true;
        // Let system back dismiss the active HTML modal before leaving its underlying screen.
        webView.evaluateJavascript("(function(){var d=document.querySelector('dialog[open]');"
                + "if(d){d.close();return true;}return false;})()", closedDialog -> {
            handlingBack = false;
            if (isFinishing() || isDestroyed() || webView == null || "true".equals(closedDialog)) return;
            if (webView.canGoBack()) webView.goBack();
            else finish();
        });
    }

    private static boolean hasSupportedWebView() {
        try {
            PackageInfo provider = WebView.getCurrentWebViewPackage();
            // Chromium 100+ supports the bundled vision runtime and restrictive WASM CSP.
            return provider != null && provider.versionName != null
                && Integer.parseInt(provider.versionName.split("\\.")[0]) >= 100;
        } catch (RuntimeException unavailable) {
            return false;
        }
    }

    // Used only on API 26–32. API 33+ registers OnBackInvokedDispatcher in onCreate above.
    @SuppressLint("GestureBackNavigation")
    @Override public void onBackPressed() { navigateBack(); }
    @Override protected void onSaveInstanceState(Bundle outState) {
        if (webView != null) webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }
    @Override protected void onResume() { super.onResume(); if (webView != null) webView.onResume(); }
    @Override protected void onPause() {
        if (webView != null) {
            webView.evaluateJavascript("window.dispatchEvent(new Event('dewdrop:camera-pause'))", null);
            webView.onPause();
        }
        super.onPause();
    }
    @Override protected void onDestroy() {
        if (cameraRequest != null) { cameraRequest.deny(); cameraRequest = null; }
        finishImageSelection(null);
        clearCapturedPhoto();
        if (webView != null) {
            ((FrameLayout) webView.getParent()).removeView(webView);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private static boolean isLocal(Uri uri) {
        return uri != null && "https".equals(uri.getScheme()) && HOST.equals(uri.getHost())
            && uri.getUserInfo() == null && (uri.getPort() == -1 || uri.getPort() == 443);
    }

    private boolean isLocalPage() {
        return webView != null && webView.getUrl() != null && isLocal(Uri.parse(webView.getUrl()));
    }

    private void finishImageSelection(Uri[] images) {
        ValueCallback<Uri[]> callback = imageCallback;
        imageCallback = null;
        if (callback != null) callback.onReceiveValue(images);
    }

    private void clearCapturedPhoto() {
        if (capturedPhotoUri != null) {
            revokeUriPermission(capturedPhotoUri, Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            capturedPhotoUri = null;
        }
        if (capturedPhoto != null) { capturedPhoto.delete(); capturedPhoto = null; }
    }

    private void openImagePicker() {
        Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE).setType("image/*")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            startActivityForResult(picker, PICK_IMAGE);
        } catch (ActivityNotFoundException | SecurityException unavailable) {
            finishImageSelection(null);
            Toast.makeText(this, "Photo picker unavailable on this device.", Toast.LENGTH_LONG).show();
        }
    }

    private void openCameraCapture() {
        if (imageCallback == null || !isLocalPage() || isFinishing() || isDestroyed()) {
            finishImageSelection(null);
            return;
        }
        try {
            capturedPhoto = SelfiePhotoProvider.createPhoto(this);
            capturedPhotoUri = SelfiePhotoProvider.uriForPhoto(this, capturedPhoto);
            Intent capture = new Intent(MediaStore.ACTION_IMAGE_CAPTURE)
                .putExtra(MediaStore.EXTRA_OUTPUT, capturedPhotoUri)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            capture.setClipData(ClipData.newRawUri("Selfie", capturedPhotoUri));
            startActivityForResult(capture, CAPTURE_IMAGE);
        } catch (IOException | ActivityNotFoundException | SecurityException unavailable) {
            clearCapturedPhoto();
            // Devices without a camera app can still choose a selfie from the system picker.
            Toast.makeText(this, "Camera unavailable. Choose an existing selfie instead.", Toast.LENGTH_LONG).show();
            openImagePicker();
        }
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != CAMERA_WEB_PERMISSION && requestCode != CAMERA_CAPTURE_PERMISSION) return;
        permissionPromptActive = false;
        boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED
            && checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
        if (requestCode == CAMERA_WEB_PERMISSION) {
            PermissionRequest request = cameraRequest;
            cameraRequest = null;
            if (request != null) {
                if (granted && isLocal(request.getOrigin()) && isLocalPage() && !isFinishing() && !isDestroyed()) {
                    request.grant(new String[] { PermissionRequest.RESOURCE_VIDEO_CAPTURE });
                } else request.deny();
            }
        } else if (granted) {
            openCameraCapture();
        } else {
            finishImageSelection(null);
            Toast.makeText(this, "Camera access was not allowed. You can choose a photo instead.", Toast.LENGTH_LONG).show();
        }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != PICK_IMAGE && requestCode != CAPTURE_IMAGE) return;
        Uri selected = null;
        if (resultCode == RESULT_OK && imageCallback != null && isLocalPage()) {
            if (requestCode == CAPTURE_IMAGE) {
                if (capturedPhoto != null && capturedPhoto.length() > 0) selected = capturedPhotoUri;
            } else if (data != null && data.getData() != null) {
                Uri candidate = data.getData();
                // Only content explicitly granted by a picker, never file paths or our own provider.
                if ("content".equals(candidate.getScheme()) && candidate.getAuthority() != null
                        && candidate.getAuthority().indexOf('@') == -1
                        && !candidate.getAuthority().equals(getPackageName() + ".selfie")
                        && (data.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION) != 0) {
                    try {
                        String type = getContentResolver().getType(candidate);
                        if (type != null && type.startsWith("image/")) {
                            try (InputStream input = getContentResolver().openInputStream(candidate)) {
                                if (input != null) selected = candidate;
                            }
                        }
                    } catch (IOException | RuntimeException ignored) { /* Return a canceled selection. */ }
                }
            }
        }
        finishImageSelection(selected == null ? null : new Uri[] { selected });
        if (requestCode == CAPTURE_IMAGE) {
            if (capturedPhotoUri != null) revokeUriPermission(capturedPhotoUri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            // WebView reads the successful photo asynchronously; retain it until next selection/destruction.
            if (selected == null) clearCapturedPhoto();
        }
    }

    private final class CameraChromeClient extends WebChromeClient {
        @Override public void onPermissionRequest(PermissionRequest request) {
            boolean wantsVideo = false;
            for (String resource : request.getResources()) {
                if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) wantsVideo = true;
            }
            if (!wantsVideo || !isLocal(request.getOrigin()) || !isLocalPage()
                    || permissionPromptActive || isFinishing() || isDestroyed()) {
                request.deny();
                return;
            }
            // Grant only camera even if future WebView versions request additional resources.
            if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                request.grant(new String[] { PermissionRequest.RESOURCE_VIDEO_CAPTURE });
            } else {
                cameraRequest = request;
                permissionPromptActive = true;
                requestPermissions(new String[] { Manifest.permission.CAMERA }, CAMERA_WEB_PERMISSION);
            }
        }

        @Override public void onPermissionRequestCanceled(PermissionRequest request) {
            if (cameraRequest == request) cameraRequest = null;
        }

        @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                FileChooserParams params) {
            if (!isLocalPage() || permissionPromptActive || imageCallback != null
                    || params.getMode() != FileChooserParams.MODE_OPEN) {
                callback.onReceiveValue(null);
                return true;
            }
            boolean acceptsImage = false;
            for (String type : params.getAcceptTypes()) {
                if (type != null && type.startsWith("image/")) acceptsImage = true;
            }
            if (!acceptsImage) { callback.onReceiveValue(null); return true; }
            clearCapturedPhoto();
            imageCallback = callback;
            if (params.isCaptureEnabled()) {
                if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                    openCameraCapture();
                } else {
                    permissionPromptActive = true;
                    requestPermissions(new String[] { Manifest.permission.CAMERA }, CAMERA_CAPTURE_PERMISSION);
                }
            } else openImagePicker();
            return true;
        }
    }

    private final class LocalAssetsClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (isLocal(uri)) return false;
            if (request.isForMainFrame() && request.hasGesture()
                    && "https".equals(uri.getScheme()) && uri.getHost() != null) {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE));
                } catch (ActivityNotFoundException ignored) {
                    Toast.makeText(MainActivity.this, R.string.browser_unavailable, Toast.LENGTH_LONG).show();
                }
            }
            return true;
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (!isLocal(uri) || !"GET".equals(request.getMethod())) return error(403, "Forbidden");
            String path = uri.getPath();
            if (path == null || path.equals("/")) path = "/index.html";
            if (path.contains("..") || path.contains("\\") || path.indexOf('\0') >= 0) return error(403, "Forbidden");
            try {
                InputStream content = getAssets().open(path.substring(1));
                Map<String, String> headers = new HashMap<>();
                headers.put("X-Content-Type-Options", "nosniff");
                headers.put("Cache-Control", "no-cache");
                headers.put("Content-Security-Policy", "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; "
                    + "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; "
                    + "media-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'self'");
                return new WebResourceResponse(mime(path), "UTF-8", 200, "OK", headers, content);
            } catch (IOException ignored) {
                return error(404, "Not Found");
            }
        }
    }

    private static String mime(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".js") || path.endsWith(".mjs")) return "text/javascript";
        if (path.endsWith(".wasm")) return "application/wasm";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".json")) return "application/json";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
        if (path.endsWith(".webp")) return "image/webp";
        if (path.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }

    private static WebResourceResponse error(int status, String reason) {
        return new WebResourceResponse("text/plain", "UTF-8", status, reason,
            new HashMap<>(), new ByteArrayInputStream(reason.getBytes(StandardCharsets.UTF_8)));
    }
}
