<#
.SYNOPSIS
    Signs a Windows test artefact (e.g., installer/windows/test-artefact.exe) with the procured
    EV code-signing cert, then verifies the signature. This is the Plan 01-03 Task 2 smoke that
    starts the SmartScreen reputation-warm-up clock per D-05.

.DESCRIPTION
    Wraps `signtool sign` with the canonical Phase 1 flag set:
      /td sha256   — timestamp digest = SHA-256
      /fd sha256   — file digest      = SHA-256
      /tr <url>    — RFC 3161 timestamp URL (DigiCert by default; override via -TimestampUrl)
      /v           — verbose

    Then verifies with:
      signtool verify /pa /v <artefact>

    The script reads the cert subject CN from a parameter (or env var FENNEC_EV_CERT_SUBJECT),
    so callers do not have to hardcode the identity. The cert MUST already be installed in the
    current user's certificate store (via the HSM driver / cloud-signing client) — see
    CERT-PROCUREMENT.md Step 5.

.PARAMETER ArtefactPath
    Path to the .exe / .msi / .dll to sign. Default: installer\windows\test-artefact.exe.

.PARAMETER CertSubject
    Common Name of the EV cert (e.g., "Jane Doe" for Individual EV, "Fennec Inc." for Business
    EV). Falls back to env var FENNEC_EV_CERT_SUBJECT. Required.

.PARAMETER TimestampUrl
    RFC 3161 timestamping server URL. Defaults to http://timestamp.digicert.com.
    Alternatives: http://timestamp.sectigo.com, http://timestamp.entrust.net/TSS/RFC3161sha2TS

.PARAMETER SignToolPath
    Optional explicit path to signtool.exe. If not specified the script searches the standard
    Windows SDK locations.

.EXAMPLE
    .\sign-test-artefact.ps1 -ArtefactPath .\installer\windows\test-artefact.exe `
                              -CertSubject "Jane Doe"

.EXAMPLE
    # With env var:
    $env:FENNEC_EV_CERT_SUBJECT = "Jane Doe"
    .\sign-test-artefact.ps1

.NOTES
    Plan: 01-foundations / 01-03 Task 2
    Companion: installer/windows/CERT-PROCUREMENT.md (the procurement playbook)
    First-signature timestamp from this script's output goes into 01-CERT-STATUS.md
    (starts the SmartScreen reputation-warm-up clock per D-05).
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string] $ArtefactPath = "installer\windows\test-artefact.exe",

    [Parameter(Mandatory = $false)]
    [string] $CertSubject = $env:FENNEC_EV_CERT_SUBJECT,

    [Parameter(Mandatory = $false)]
    [string] $TimestampUrl = "http://timestamp.digicert.com",

    [Parameter(Mandatory = $false)]
    [string] $SignToolPath = $null
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# ─────────────────────────────────────────────────────────────────────────
# 1. Validate inputs
# ─────────────────────────────────────────────────────────────────────────

if ([string]::IsNullOrWhiteSpace($CertSubject)) {
    Write-Error @"
CertSubject is required.

Pass via parameter:
    .\sign-test-artefact.ps1 -CertSubject "Your Name"

Or set environment variable:
    `$env:FENNEC_EV_CERT_SUBJECT = "Your Name"

The subject must match the Common Name (CN) of the EV cert installed in your user
certificate store. To see what's available:
    certutil -store -user My
"@
    exit 1
}

if (-not (Test-Path -LiteralPath $ArtefactPath -PathType Leaf)) {
    Write-Error @"
Artefact not found: $ArtefactPath

Build a tiny test executable first (any small .exe works). Example with Go (from any platform):
    GOOS=windows GOARCH=amd64 go build -ldflags='-s -w' -o installer\windows\test-artefact.exe ./path/to/hello.go

Or use a pre-built binary you already have. The signing pipeline doesn't care about contents —
the first-signature timestamp is what matters for the SmartScreen reputation-warm-up clock.
"@
    exit 1
}

# ─────────────────────────────────────────────────────────────────────────
# 2. Locate signtool.exe
# ─────────────────────────────────────────────────────────────────────────

function Find-SignTool {
    param([string] $ExplicitPath)

    if ($ExplicitPath) {
        if (Test-Path -LiteralPath $ExplicitPath -PathType Leaf) {
            return (Resolve-Path -LiteralPath $ExplicitPath).Path
        }
        throw "SignToolPath parameter '$ExplicitPath' does not exist."
    }

    # Try PATH first
    $cmd = Get-Command -Name "signtool.exe" -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Path }

    # Standard Windows SDK locations (newest first, x64 preferred)
    $sdkRoots = @(
        "${env:ProgramFiles(x86)}\Windows Kits\10\bin",
        "${env:ProgramFiles}\Windows Kits\10\bin"
    )
    foreach ($root in $sdkRoots) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        $versions = Get-ChildItem -LiteralPath $root -Directory `
                    -ErrorAction SilentlyContinue | Sort-Object Name -Descending
        foreach ($v in $versions) {
            $candidate = Join-Path $v.FullName "x64\signtool.exe"
            if (Test-Path -LiteralPath $candidate) { return $candidate }
            $candidate = Join-Path $v.FullName "x86\signtool.exe"
            if (Test-Path -LiteralPath $candidate) { return $candidate }
        }
    }

    throw @"
signtool.exe not found.

Install the Windows SDK ('Windows 10/11 SDK' from Visual Studio Installer or standalone
from https://developer.microsoft.com/en-us/windows/downloads/windows-sdk/), or pass
-SignToolPath explicitly. Cross-platform alternative: osslsigncode on macOS/Linux
(see installer/windows/CERT-PROCUREMENT.md §Step 6).
"@
}

$signtool = Find-SignTool -ExplicitPath $SignToolPath
Write-Host "signtool: $signtool" -ForegroundColor Cyan

# ─────────────────────────────────────────────────────────────────────────
# 3. Sign
# ─────────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "Signing $ArtefactPath" -ForegroundColor Yellow
Write-Host "  cert subject : $CertSubject" -ForegroundColor Yellow
Write-Host "  timestamp    : $TimestampUrl" -ForegroundColor Yellow
Write-Host ""

# /n  = pick cert by CN match in user store
# /td = timestamp digest algorithm
# /fd = file digest algorithm
# /tr = RFC 3161 timestamp server (REQUIRED — signatures without it expire when the cert does)
# /v  = verbose
& $signtool sign `
    /n  $CertSubject `
    /td sha256 `
    /fd sha256 `
    /tr $TimestampUrl `
    /v `
    $ArtefactPath

if ($LASTEXITCODE -ne 0) {
    Write-Error "signtool sign FAILED with exit code $LASTEXITCODE"
    Write-Error @"
Troubleshooting:
  1. 'No certificates were found' → cert not in current user's 'My' store.
     Run: certutil -store -user My
  2. PIN prompt loops → SafeNet client not initialised; replug HSM, restart SAC.
  3. 'The specified timestamp server either could not be reached' → corporate firewall
     blocking port 80 to the timestamp domain; try -TimestampUrl http://timestamp.sectigo.com.
"@
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Signing succeeded." -ForegroundColor Green
Write-Host ""

# ─────────────────────────────────────────────────────────────────────────
# 4. Verify
# ─────────────────────────────────────────────────────────────────────────

Write-Host "Verifying $ArtefactPath" -ForegroundColor Yellow
Write-Host ""

& $signtool verify /pa /v $ArtefactPath
$verifyExit = $LASTEXITCODE

if ($verifyExit -ne 0) {
    Write-Error "signtool verify FAILED with exit code $verifyExit"
    Write-Error @"
The signature was applied but does not verify. Common causes:
  1. Timestamp server returned a malformed response (re-sign with a different /tr URL).
  2. Cert chain trust missing roots (run: certutil -generateSSTFromWU roots.sst
     && certutil -enterprise -f -v -AddStore root roots.sst).
  3. The cert is not yet valid (NotBefore in the future) — wait + retry.
"@
    exit $verifyExit
}

Write-Host ""
Write-Host "Successfully verified $ArtefactPath" -ForegroundColor Green
Write-Host ""
Write-Host "─────────────────────────────────────────────────────────────────────" -ForegroundColor Cyan
Write-Host "Next step: copy the signed file's signature timestamp from the output" -ForegroundColor Cyan
Write-Host "above into .planning/phases/01-foundations/01-CERT-STATUS.md under" -ForegroundColor Cyan
Write-Host "'First Signature Timestamp' (this starts the SmartScreen reputation" -ForegroundColor Cyan
Write-Host "warm-up clock per D-05)." -ForegroundColor Cyan
Write-Host "─────────────────────────────────────────────────────────────────────" -ForegroundColor Cyan

exit 0
