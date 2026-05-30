$ErrorActionPreference = "Stop"

$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$RepositoryUrl = if ($env:REPOSITORY_URL) { $env:REPOSITORY_URL } else { "https://github.com/KOSFin/MooDuSh-from-syncshare" }
$ArtifactName = if ($env:ARTIFACT_NAME) { $env:ARTIFACT_NAME } else { "moodush-extension.zip" }
$ApiUrl = ($RepositoryUrl -replace "https://github.com/", "https://api.github.com/repos/") + "/releases/latest"
$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("moodush-update-" + [System.Guid]::NewGuid().ToString("N"))

New-Item -ItemType Directory -Path $TempDir | Out-Null

try {
    Write-Host "MooDuSh: locating latest GitHub Release..."
    $Release = Invoke-RestMethod -Uri $ApiUrl -Headers @{ "User-Agent" = "MooDuSh updater" }
    $Asset = $Release.assets | Where-Object { $_.name -eq $ArtifactName } | Select-Object -First 1
    if (-not $Asset) {
        throw "Could not find $ArtifactName in latest release."
    }

    $ZipPath = Join-Path $TempDir $ArtifactName
    Write-Host "MooDuSh: downloading $ArtifactName..."
    Invoke-WebRequest -Uri $Asset.browser_download_url -OutFile $ZipPath -Headers @{ "User-Agent" = "MooDuSh updater" }

    Write-Host "MooDuSh: replacing extension files..."
    Expand-Archive -Path $ZipPath -DestinationPath $RootDir -Force

    Write-Host "Done. Open chrome://extensions/ and reload MooDuSh."
}
finally {
    Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
}
