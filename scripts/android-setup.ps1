param()
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$toolsRoot = Join-Path $projectRoot '.android-tools'
New-Item -ItemType Directory -Force -Path $toolsRoot | Out-Null

function Move-ToolFolder([string]$Source, [string]$Destination) {
    $allowedRoot = [IO.Path]::GetFullPath($toolsRoot) + [IO.Path]::DirectorySeparatorChar
    foreach ($path in @($Source, $Destination)) {
        if (-not [IO.Path]::GetFullPath($path).StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to move outside the workspace tool directory: $path"
        }
    }
    Move-Item -LiteralPath $Source -Destination $Destination
}

function Get-VerifiedArchive([string]$Uri, [string]$Name, [string]$Hash, [string]$Algorithm) {
    $destination = Join-Path $toolsRoot $Name
    if (-not (Test-Path -LiteralPath $destination)) {
        Write-Host "Downloading $Name from $(([uri]$Uri).Host)..."
        Invoke-WebRequest -Uri $Uri -OutFile $destination
    }
    if ((Get-FileHash -LiteralPath $destination -Algorithm $Algorithm).Hash -ne $Hash) {
        throw "Checksum mismatch for $destination. Remove that archive and retry."
    }
    return $destination
}

if (-not (Test-Path -LiteralPath (Join-Path $toolsRoot 'jdk'))) {
    # Metadata and SHA-256 are published by Eclipse Adoptium.
    $metadataPath = Join-Path $toolsRoot 'jdk-release.json'
    if (-not (Test-Path -LiteralPath $metadataPath)) {
        Invoke-WebRequest -Uri 'https://api.adoptium.net/v3/assets/latest/17/hotspot?architecture=x64&image_type=jdk&os=windows' -OutFile $metadataPath
    }
    $jdkPackage = (Get-Content -Raw -LiteralPath $metadataPath | ConvertFrom-Json)[0].binary.package
    $archive = Get-VerifiedArchive $jdkPackage.link 'jdk17.zip' $jdkPackage.checksum 'SHA256'
    $extractPath = Join-Path $toolsRoot 'jdk-extracted'
    Expand-Archive -LiteralPath $archive -DestinationPath $extractPath -Force
    $jdkFolder = Get-ChildItem -LiteralPath $extractPath -Directory | Select-Object -First 1
    Move-ToolFolder $jdkFolder.FullName (Join-Path $toolsRoot 'jdk')
}

# Official Android repository archives, pinned to SDK 36 and Build Tools 36.0.0.
# Repository checksums: https://dl.google.com/android/repository/repository2-1.xml
$sdkRoot = Join-Path $toolsRoot 'sdk'
New-Item -ItemType Directory -Force -Path $sdkRoot | Out-Null
if (-not (Test-Path -LiteralPath (Join-Path $sdkRoot 'platforms\android-36\android.jar'))) {
    $archive = Get-VerifiedArchive 'https://dl.google.com/android/repository/platform-36_r02.zip' 'platform-36.zip' '2c1a80dd4d9f7d0e6dd336ec603d9b5c55a6f576' 'SHA1'
    $extractPath = Join-Path $toolsRoot 'platform-extracted'
    Expand-Archive -LiteralPath $archive -DestinationPath $extractPath -Force
    $platformFolder = Get-ChildItem -LiteralPath $extractPath -Directory | Select-Object -First 1
    New-Item -ItemType Directory -Force -Path (Join-Path $sdkRoot 'platforms') | Out-Null
    Move-ToolFolder $platformFolder.FullName (Join-Path $sdkRoot 'platforms\android-36')
}
if (-not (Test-Path -LiteralPath (Join-Path $sdkRoot 'build-tools\36.0.0\aapt2.exe'))) {
    $archive = Get-VerifiedArchive 'https://dl.google.com/android/repository/build-tools_r36_windows.zip' 'build-tools-36.zip' 'f16ccffd34de8790dede813a6c7d8e2c11a27b50' 'SHA1'
    $extractPath = Join-Path $toolsRoot 'build-tools-extracted'
    Expand-Archive -LiteralPath $archive -DestinationPath $extractPath -Force
    $buildToolsFolder = Get-ChildItem -LiteralPath $extractPath -Directory | Select-Object -First 1
    New-Item -ItemType Directory -Force -Path (Join-Path $sdkRoot 'build-tools') | Out-Null
    Move-ToolFolder $buildToolsFolder.FullName (Join-Path $sdkRoot 'build-tools\36.0.0')
}

$properties = 'sdk.dir=' + $sdkRoot.Replace('\', '/').Replace(':', '\:')
[IO.File]::WriteAllText((Join-Path $projectRoot 'android\local.properties'), "$properties`n")
Write-Host "Portable Android toolchain ready at $toolsRoot"
Write-Host 'Run: powershell -ExecutionPolicy Bypass -File scripts/build-android.ps1'
