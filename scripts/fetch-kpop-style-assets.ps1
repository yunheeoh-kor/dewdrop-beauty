param([switch]$RefreshMetadata)
$ErrorActionPreference = 'Stop'
$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$manifestPath = Join-Path $workspaceRoot 'research/kpop-style-sources.json'
$assetDirectory = Join-Path $workspaceRoot 'web/assets/looks'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
New-Item -ItemType Directory -Path $assetDirectory -Force | Out-Null
$agent = 'DewdropStyleLibrary/1.0 (editorial cosmetics reference; Commons attribution retained)'
foreach ($source in $manifest.sources) {
  if ($source.localFilename -notmatch '^[a-z0-9-]+\.(png|jpg)$') { throw 'Unsafe filename' }
  $metadataUrl = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url%7Cextmetadata%7Csize%7Csha1&titles=' + [Uri]::EscapeDataString($source.commonsTitle)
  $info = $source.metadata
  if (-not $info -or $RefreshMetadata) {
    $response = Invoke-RestMethod -Uri $metadataUrl -UserAgent $agent -MaximumRetryCount 2 -RetryIntervalSec 10
    $page = @($response.query.pages.PSObject.Properties.Value)[0]
    $info = $page.imageinfo[0]
  }
  if ($info.extmetadata.LicenseShortName.value -ne 'CC BY 3.0') { throw "Unexpected license for $($source.id)" }
  $imageUrl = ($info.url -split '\?')[0]
  if (([Uri]$imageUrl).Host -ne 'upload.wikimedia.org') { throw 'Unexpected download host' }
  $target = Join-Path $assetDirectory $source.localFilename
  $alreadyVerified = (Test-Path -LiteralPath $target) -and ((Get-FileHash -LiteralPath $target -Algorithm SHA1).Hash.ToLowerInvariant() -eq $info.sha1)
  if (-not $alreadyVerified) {
    Invoke-WebRequest -Uri $imageUrl -UserAgent $agent -OutFile $target -MaximumRetryCount 2 -RetryIntervalSec 10
  }
  if ((Get-Item -LiteralPath $target).Length -ne $info.size) { throw "File size mismatch for $($source.id)" }
  if ((Get-FileHash -LiteralPath $target -Algorithm SHA1).Hash.ToLowerInvariant() -ne $info.sha1) { throw "Source hash mismatch for $($source.id)" }
  $source | Add-Member -NotePropertyName metadata -NotePropertyValue $info -Force
  $source | Add-Member -NotePropertyName metadataUrl -NotePropertyValue $metadataUrl -Force
  $source | Add-Member -NotePropertyName sha256 -NotePropertyValue (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -Force
  $manifest | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $manifestPath -Encoding utf8
  Write-Output "$($source.id): $($info.width)x$($info.height), $($info.size) bytes, CC BY 3.0"
}
$manifest | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $manifestPath -Encoding utf8
