param([switch]$Setup)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$toolsRoot = Join-Path $projectRoot '.android-tools'
if ($Setup) { & (Join-Path $PSScriptRoot 'android-setup.ps1') }
$javaRoot = Join-Path $toolsRoot 'jdk'
$sdkRoot = Join-Path $toolsRoot 'sdk'
$buildTools = Join-Path $sdkRoot 'build-tools\36.0.0'
$androidJar = Join-Path $sdkRoot 'platforms\android-36\android.jar'
if (-not (Test-Path -LiteralPath (Join-Path $javaRoot 'bin\javac.exe')) -or -not (Test-Path -LiteralPath $androidJar)) {
    throw 'Run scripts/android-setup.ps1 first, or use -Setup. This builds with a portable toolchain inside the workspace.'
}
$webRoot = Join-Path $projectRoot 'web'
foreach ($requiredAsset in @(
    'index.html', 'startup.js', 'launch.css', 'icon.svg', 'app.js', 'lookbook.js', 'lookbook.css', 'beauty-library.js', 'style-guides.js', 'style-guide-ui.js', 'style-guides.css', 'engine.js', 'camera.js', 'instant.js', 'selfie-ui.js', 'styles.css', 'selfie.css',
    'photo-analysis.js', 'analysis-worker.js', 'photo-measurements.js', 'photo-shortlist.js', 'photo-analysis.css',
    'capture-worker.js', 'capture-quality.js', 'face-regions.js', 'face-recommendations.js', 'face-studio.js', 'face-studio.css', 'face-style-comparison.js', 'skin-insights.js', 'skin-insights-ui.js',
    'vendor\mediapipe\manifest.json', 'vendor\mediapipe\vision_bundle.mjs', 'vendor\mediapipe\LICENSE.txt',
    'vendor\mediapipe\wasm\vision_wasm_internal.js', 'vendor\mediapipe\wasm\vision_wasm_internal.wasm',
    'vendor\mediapipe\wasm\vision_wasm_nosimd_internal.js', 'vendor\mediapipe\wasm\vision_wasm_nosimd_internal.wasm',
    'models\face_landmarker.task', 'data\catalog.json', 'data\evidence.json', 'data\recommendation-rules.json', 'data\kpop-looks.json', 'data\beauty-styles.json', 'assets\looks\ATTRIBUTION.txt'
)) {
    if (-not (Test-Path -LiteralPath (Join-Path $webRoot $requiredAsset))) { throw "Missing app asset: web/$requiredAsset" }
}

function Invoke-Checked([string]$Command, [string[]]$Arguments) {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Build tool failed ($LASTEXITCODE): $Command" }
}

# Fail before producing an APK if model/runtime files are incomplete or modified.
# This check is entirely local; builds never fetch dependencies or model weights.
$nodeCommand = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $nodeCommand) { throw 'Node.js 20 or newer is required to verify the bundled image-analysis assets.' }
Write-Host 'Verifying pinned offline image-analysis assets...'
Invoke-Checked $nodeCommand.Source @((Join-Path $PSScriptRoot 'setup-vision.mjs'), '--check')
Write-Host 'Verifying bundled product photographs...'
Invoke-Checked $nodeCommand.Source @((Join-Path $PSScriptRoot 'check-product-images.mjs'))

$previousJavaHome = $env:JAVA_HOME
try {
    $env:JAVA_HOME = $javaRoot
    $buildRoot = Join-Path $projectRoot ('android\build\direct-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
    $classesDir = Join-Path $buildRoot 'classes'
    $generatedDir = Join-Path $buildRoot 'generated'
    $dexDir = Join-Path $buildRoot 'dex'
    $outputsDir = Join-Path $projectRoot 'outputs'
    New-Item -ItemType Directory -Force -Path $buildRoot, $classesDir, $generatedDir, $dexDir, $outputsDir | Out-Null
    $sourceRoot = Join-Path $projectRoot 'android\app\src\main'
    $compiledRes = Join-Path $buildRoot 'resources.zip'
    $unsignedApk = Join-Path $buildRoot 'unsigned.apk'
    $alignedApk = Join-Path $buildRoot 'aligned.apk'
    $signedApk = Join-Path $buildRoot 'signed.apk'
    $outputApk = Join-Path $outputsDir 'Dewdrop-debug.apk'

    # Gradle gets the package from namespace. The direct aapt2 pipeline needs it in its generated manifest.
    [xml]$manifest = Get-Content -Raw -LiteralPath (Join-Path $sourceRoot 'AndroidManifest.xml')
    $manifest.manifest.SetAttribute('package', 'com.dewdrop.beauty')
    $manifestPath = Join-Path $buildRoot 'AndroidManifest.xml'
    $manifest.Save($manifestPath)

    Write-Host 'Compiling Android resources and bundling offline web assets...'
    Invoke-Checked (Join-Path $buildTools 'aapt2.exe') @('compile', '--dir', (Join-Path $sourceRoot 'res'), '-o', $compiledRes)
    Invoke-Checked (Join-Path $buildTools 'aapt2.exe') @('link', '-o', $unsignedApk, '--manifest', $manifestPath, '-I', $androidJar, '--java', $generatedDir, '--debug-mode', '--auto-add-overlay', $compiledRes)

    # aapt2 on Windows can put backslashes into nested asset ZIP names. Add them with canonical / paths.
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $apkArchive = [IO.Compression.ZipFile]::Open($unsignedApk, [IO.Compression.ZipArchiveMode]::Update)
    try {
        foreach ($asset in Get-ChildItem -LiteralPath $webRoot -File -Recurse) {
            $assetName = 'assets/' + $asset.FullName.Substring($webRoot.Length + 1).Replace('\', '/')
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($apkArchive, $asset.FullName, $assetName, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
    } finally { $apkArchive.Dispose() }

    Write-Host 'Compiling Java and converting bytecode to DEX...'
    $javaFiles = @(Get-ChildItem -LiteralPath (Join-Path $sourceRoot 'java'), $generatedDir -Filter '*.java' -File -Recurse | ForEach-Object { $_.FullName })
    Invoke-Checked (Join-Path $javaRoot 'bin\javac.exe') (@('-encoding', 'UTF-8', '--release', '8', '-classpath', $androidJar, '-d', $classesDir) + $javaFiles)
    $classesJar = Join-Path $buildRoot 'classes.jar'
    Invoke-Checked (Join-Path $javaRoot 'bin\jar.exe') @('cf', $classesJar, '-C', $classesDir, '.')
    # Calling D8 through java avoids Windows batch quoting problems for workspace paths with spaces.
    Invoke-Checked (Join-Path $javaRoot 'bin\java.exe') @('-cp', (Join-Path $buildTools 'lib\d8.jar'), 'com.android.tools.r8.D8', '--lib', $androidJar, '--min-api', '26', '--output', $dexDir, $classesJar)
    Invoke-Checked (Join-Path $javaRoot 'bin\jar.exe') @('uf', $unsignedApk, '-C', $dexDir, 'classes.dex')
    Invoke-Checked (Join-Path $buildTools 'zipalign.exe') @('-f', '-p', '4', $unsignedApk, $alignedApk)

    $keystore = Join-Path $toolsRoot 'debug.keystore'
    if (-not (Test-Path -LiteralPath $keystore)) {
        Invoke-Checked (Join-Path $javaRoot 'bin\keytool.exe') @('-genkeypair', '-keystore', $keystore, '-storepass', 'android', '-keypass', 'android', '-alias', 'androiddebugkey', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000', '-dname', 'CN=Android Debug,O=Android,C=US')
    }
    Write-Host 'Signing and verifying installable debug APK...'
    $signerJar = Join-Path $buildTools 'lib\apksigner.jar'
    Invoke-Checked (Join-Path $javaRoot 'bin\java.exe') @('-jar', $signerJar, 'sign', '--ks', $keystore, '--ks-key-alias', 'androiddebugkey', '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--v4-signing-enabled', 'false', '--out', $signedApk, $alignedApk)
    Invoke-Checked (Join-Path $javaRoot 'bin\java.exe') @('-jar', $signerJar, 'verify', '--verbose', $signedApk)
    Invoke-Checked (Join-Path $buildTools 'zipalign.exe') @('-c', '-p', '4', $signedApk)
    $checkArchive = [IO.Compression.ZipFile]::OpenRead($signedApk)
    try {
        foreach ($asset in Get-ChildItem -LiteralPath $webRoot -File -Recurse) {
            $entryName = 'assets/' + $asset.FullName.Substring($webRoot.Length + 1).Replace('\', '/')
            $entry = $checkArchive.GetEntry($entryName)
            if ($null -eq $entry) { throw "APK is missing $entryName" }
            $assetStream = $entry.Open()
            $hasher = [Security.Cryptography.SHA256]::Create()
            try {
                $actualHash = [BitConverter]::ToString($hasher.ComputeHash($assetStream)).Replace('-', '')
                if ($actualHash -ne (Get-FileHash -LiteralPath $asset.FullName -Algorithm SHA256).Hash) {
                    throw "APK asset differs from source: $entryName. Rebuild after source changes finish."
                }
            } finally { $assetStream.Dispose(); $hasher.Dispose() }
        }
        Write-Host 'Verified every bundled asset against its source SHA256.'
    } finally { $checkArchive.Dispose() }
    Copy-Item -LiteralPath $signedApk -Destination $outputApk -Force
    $apkHash = (Get-FileHash -LiteralPath $outputApk -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText((Join-Path $outputsDir 'Dewdrop-debug.apk.sha256'), "$apkHash  Dewdrop-debug.apk`n")
    Write-Host "APK ready: $outputApk"
    Write-Host "SHA256: $apkHash"
} finally {
    $env:JAVA_HOME = $previousJavaHome
}
