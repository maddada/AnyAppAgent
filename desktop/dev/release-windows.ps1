# Certum signing follows Ghostex's certum-sign.ps1: a mounted SimplySign
# certificate, SHA-256 and an RFC 3161 timestamp. Never logs in or handles codes.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$thumbprint = if ($env:KIWIMAKE_CERTUM_CERT_SHA1) {
    ($env:KIWIMAKE_CERTUM_CERT_SHA1 -replace '\s', '').ToUpperInvariant()
} else {
    'E81BEDC91DEA38C8BB2DA3651E161ADA280B6734'
}
if ($thumbprint -notmatch '^[0-9A-F]{40}$') { throw 'Invalid Certum certificate thumbprint.' }
$certificate = Get-Item -LiteralPath "Cert:\CurrentUser\My\$thumbprint" -ErrorAction SilentlyContinue
if (-not $certificate -or -not $certificate.HasPrivateKey) {
    throw 'Certum signing is unavailable. Install SimplySign Desktop and sign in yourself with the phone code, then run npm run dist again. Nothing will be published.'
}
if ($certificate.NotAfter -le (Get-Date) -or $certificate.NotBefore -gt (Get-Date)) {
    throw 'The Certum certificate is outside its validity period.'
}
$signtool = $env:SIGNTOOL_PATH
if (-not $signtool) {
    $sdkBin = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
    $signtool = Get-ChildItem -LiteralPath $sdkBin -Directory |
        Sort-Object Name -Descending |
        ForEach-Object { Join-Path $_.FullName 'x64\signtool.exe' } |
        Where-Object { Test-Path -LiteralPath $_ } |
        Select-Object -First 1
}
if (-not $signtool -or -not (Test-Path -LiteralPath $signtool)) {
    throw 'The x64 Windows SDK signtool.exe is required. Set SIGNTOOL_PATH to its path.'
}
$env:SIGNTOOL_PATH = $signtool
if ($env:ELECTRON_BUILDER_OFFLINE -eq 'true') {
    throw 'Release signing requires online timestamping. Unset ELECTRON_BUILDER_OFFLINE.'
}

function Assert-Signed([string]$File) {
    & $signtool verify /pa /v $File
    if ($LASTEXITCODE -ne 0) { throw "Authenticode verification failed: $File" }
    $signature = Get-AuthenticodeSignature -LiteralPath $File
    if ($signature.Status -ne 'Valid' -or
        $signature.SignerCertificate.Thumbprint -ne $thumbprint -or
        -not $signature.TimeStamperCertificate) {
        throw "Expected a valid, timestamped Certum signature: $File"
    }
}

Push-Location (Join-Path $PSScriptRoot '..')
try {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Desktop compilation failed.' }
    # electron-builder signs Kiwimake.exe before packaging, plus the NSIS
    # uninstaller and final installer. Only public certificate metadata is passed.
    & .\node_modules\.bin\electron-builder.cmd --win nsis --publish never `
        '-c.forceCodeSigning=true' `
        "-c.win.signtoolOptions.certificateSha1=$thumbprint"
    if ($LASTEXITCODE -ne 0) { throw 'Signed Windows packaging failed. Do not publish its output.' }
    $version = (Get-Content -LiteralPath package.json -Raw | ConvertFrom-Json).version
    $installer = "dist\Kiwimake-Setup-$version.exe"
    Assert-Signed 'dist\win-unpacked\Kiwimake.exe'
    Assert-Signed $installer
    foreach ($name in @('Kiwimake-Setup.exe', 'AnyAppAgent-Setup.exe')) {
        $copy = Join-Path 'dist' $name
        Copy-Item -LiteralPath $installer -Destination $copy -Force
        Assert-Signed $copy
    }
    Write-Host "Release installer signed by $($certificate.Subject)."
} finally {
    Pop-Location
}
