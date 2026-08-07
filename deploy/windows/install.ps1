<#
install-windows.ps1 - AFCT Windows bootstrap installer.

Windows is for testing, evaluation, development, and demonstrations. For a long-running
production deployment, use the Linux installer on a Linux server.

This is a small, self-contained bootstrap (it dot-sources nothing from the bundle it is
about to download). It downloads ONE verified, versioned Windows deployment bundle,
installs it under %LOCALAPPDATA%\AFCT as the current user (no Administrator rights), and
hands off to the bundled controller. Everything else (configuration, deployment, updates,
diagnostics) lives in the downloaded tooling, not here.

  Invoke-WebRequest -UseBasicParsing `
    https://github.com/PennStateCS/AFCT/releases/latest/download/install-windows.ps1 `
    -OutFile install-windows.ps1
  powershell -ExecutionPolicy Bypass -File .\install-windows.ps1

A SHA-256 checksum published alongside the bundle protects against corruption and a
mismatched or wrong asset. It is not a digital signature.
#>
[CmdletBinding()]
param(
    [string]$DeployVersion,
    [string]$BundleFile,
    [string]$Prefix,
    [switch]$SwitchOnly,
    [switch]$Help,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Rest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.IO.Compression | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem | Out-Null

# --------------------------------------------------------------------------- #
# Configuration (env overrides mirror the Linux/macOS bootstraps).
# --------------------------------------------------------------------------- #
function Get-EnvOr([string]$name, [string]$fallback) {
    $v = [Environment]::GetEnvironmentVariable($name)
    if ([string]::IsNullOrEmpty($v)) { return $fallback }
    return $v
}

$Repo        = Get-EnvOr 'AFCT_REPO' 'PennStateCS/AFCT'
$AssetBase   = Get-EnvOr 'AFCT_DEPLOY_ASSET_BASE' "https://github.com/$Repo/releases/latest/download"
$ManifestUrl = Get-EnvOr 'AFCT_DEPLOY_MANIFEST_URL' "$AssetBase/deployment-manifest-windows.json"
$AssetPrefix = 'afct-windows-deploy-'
if ([string]::IsNullOrEmpty($Prefix))     { $Prefix = Get-EnvOr 'AFCT_PREFIX' (Join-Path $env:LOCALAPPDATA 'AFCT') }
if ([string]::IsNullOrEmpty($BundleFile)) { $BundleFile = Get-EnvOr 'AFCT_BUNDLE_FILE' '' }
if ([string]::IsNullOrEmpty($DeployVersion)) { $DeployVersion = Get-EnvOr 'AFCT_DEPLOY_VERSION' '' }
if (-not $SwitchOnly -and (Get-EnvOr 'AFCT_SWITCH_ONLY' '') -eq '1') { $SwitchOnly = $true }

function Write-Log  { param([string]$m) Write-Host "[afct] $m" }
function Write-Err  { param([string]$m) Write-Host "[afct] ERROR: $m" -ForegroundColor Red }
function Fail       { param([string]$m) Write-Err $m; exit 1 }

if ($Help) {
    Write-Host "AFCT Windows bootstrap. Options: -DeployVersion <v> -BundleFile <path> -Prefix <dir> -SwitchOnly"
    exit 0
}

# --------------------------------------------------------------------------- #
# Preconditions
# --------------------------------------------------------------------------- #
$osOverride = [Environment]::GetEnvironmentVariable('AFCT_OS')
$isWindows = if (-not [string]::IsNullOrEmpty($osOverride)) { $osOverride -eq 'Windows' }
             elseif ($null -eq (Get-Variable -Name IsWindows -ValueOnly -ErrorAction SilentlyContinue)) { $true }
             else { [bool](Get-Variable -Name IsWindows -ValueOnly) }
if (-not $isWindows) { Fail "this bootstrap installs AFCT on Windows only. On Linux/macOS use install.sh / install-macos.sh." }

Write-Log "This Windows installer is for testing, evaluation, and development."
Write-Log "For a long-running production deployment, use the Linux installer on a Linux server."

# Require an absolute, traversal-free prefix.
if (-not [System.IO.Path]::IsPathRooted($Prefix)) { Fail "the install prefix must be an absolute path (got '$Prefix')." }
if ($Prefix -match '\.\.[\\/]') { Fail "the install prefix must not contain '..' path segments (got '$Prefix')." }
$Prefix = [System.IO.Path]::GetFullPath($Prefix)

$Releases = Join-Path $Prefix 'releases'
$Shared   = Join-Path $Prefix 'shared'
$RootBin  = Join-Path $Prefix 'bin'

# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
function Get-AfctFile([string]$url, [string]$dest) {
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $dest -TimeoutSec 300
}

function Test-Hex([string]$s) { return ($s -match '^[0-9a-fA-F]+$') }

# Reject ZIP entries that could escape the staging directory.
function Test-EntrySafe([string]$name) {
    if ([string]::IsNullOrWhiteSpace($name)) { return $false }
    if ($name -match '[\\:]') { return $false }        # backslash separators or a drive/ADS colon
    if ($name.StartsWith('/')) { return $false }        # absolute or UNC
    foreach ($part in $name.Split('/')) { if ($part -eq '..') { return $false } }
    return $true
}

# Safely extract a validated ZIP into $dest, confirming every path stays under $dest.
function Expand-BundleSafe([string]$zipPath, [string]$dest) {
    New-Item -ItemType Directory -Path $dest -Force | Out-Null
    $destFull = [System.IO.Path]::GetFullPath($dest).TrimEnd('\') + '\'
    $zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
        foreach ($entry in $zip.Entries) {
            $rel = $entry.FullName
            if ($rel.EndsWith('/')) { continue }        # directory marker
            if (-not (Test-EntrySafe $rel)) { Fail "the bundle contains an unsafe path ('$rel'); refusing to extract." }
            $target = [System.IO.Path]::GetFullPath((Join-Path $dest ($rel -replace '/', '\')))
            if (-not $target.StartsWith($destFull, [StringComparison]::OrdinalIgnoreCase)) {
                Fail "the bundle would extract outside the staging directory ('$rel'); refusing to extract."
            }
            New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
        }
    } finally { $zip.Dispose() }
}

function Get-ControllerVersion([string]$controllerPath) {
    $m = Select-String -LiteralPath $controllerPath -Pattern "^\s*\`$InstallerVersion\s*=\s*'([^']+)'" | Select-Object -First 1
    if ($null -eq $m) { return '' }
    return $m.Matches.Groups[1].Value
}

# Restrict a file's ACL to the current user (no inheritance). Throws on failure so callers
# can make it fatal for critical secrets/markers. Uses icacls with the current user's SID as
# a literal (leading '*'), so it never resolves a name and never contacts a domain
# controller: a domain-joined machine with an unreachable DC can still lock its own files
# (Set-Acl and name-based grants fail there with a trust-relationship error).
function Protect-AfctFile([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) { return }
    if (-not (Get-Command icacls -ErrorAction SilentlyContinue)) { throw 'icacls is not available to restrict file permissions.' }
    $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $out = & icacls $path /inheritance:r /grant:r "*${sid}:(F)" 2>&1
    if ($LASTEXITCODE -ne 0) { throw "icacls could not restrict $path (exit $LASTEXITCODE): $($out -join ' ')" }
}

# Install the stable command wrappers under <prefix>\bin. The launcher resolves the active
# release from state (or the current junction) so the command works from any directory and
# survives release switches without depending on symlink privileges.
function Install-AfctWrappers([string]$prefix) {
    $bin = Join-Path $prefix 'bin'
    New-Item -ItemType Directory -Path $bin -Force | Out-Null
    $launcher = @'
# AFCT command launcher: resolves the active release and invokes its controller.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$active = ''
$state = Join-Path $root 'shared\active-release'
if (Test-Path -LiteralPath $state) { $active = (Get-Content -LiteralPath $state -TotalCount 1).Trim() }
if ([string]::IsNullOrEmpty($active) -or -not (Test-Path -LiteralPath $active)) {
    $cur = Join-Path $root 'current'
    if (Test-Path -LiteralPath $cur) { $active = $cur }
}
if ([string]::IsNullOrEmpty($active)) { Write-Error 'AFCT: no active release found.'; exit 1 }
& (Join-Path $active 'bin\afctctl.ps1') @args
exit $LASTEXITCODE
'@
    Set-Content -LiteralPath (Join-Path $bin 'afctctl.ps1') -Value $launcher -Encoding UTF8
    $cmd = "@echo off`r`npowershell.exe -NoProfile -ExecutionPolicy Bypass -File `"%~dp0afctctl.ps1`" %*`r`n"
    Set-Content -LiteralPath (Join-Path $bin 'afctctl.cmd') -Value $cmd -Encoding ASCII
}

# Keep the active + previous + newest N release directories; remove older ones. Uses .NET
# file objects (whitespace-safe) and only ever removes directories that match the AFCT
# release-id shape under the releases root.
function Remove-AfctOldReleases([string]$releases, [string]$active, [string]$prev) {
    $keep = 2
    $envKeep = [Environment]::GetEnvironmentVariable('AFCT_KEEP_RELEASES')
    if ($envKeep -match '^[0-9]+$') { $keep = [int]$envKeep }
    $dirs = @(Get-ChildItem -LiteralPath $releases -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^[0-9A-Za-z._-]+-[0-9a-f]{12}$' } |
        Sort-Object LastWriteTimeUtc -Descending)
    $i = 0
    foreach ($d in $dirs) {
        $i++
        if ($i -le $keep) { continue }
        if ($d.FullName -eq $active) { continue }
        if (-not [string]::IsNullOrEmpty($prev) -and $d.FullName -eq $prev) { continue }
        Remove-Item -LiteralPath $d.FullName -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# --------------------------------------------------------------------------- #
# Resolve, download, and verify the bundle into a work directory.
# --------------------------------------------------------------------------- #
$Work = Join-Path ([System.IO.Path]::GetTempPath()) ("afct-winboot-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Work -Force | Out-Null
try {
    $archive  = Join-Path $Work 'bundle.zip'
    $expectedSha = ''
    $manifestBundle = ''

    if (-not [string]::IsNullOrEmpty($BundleFile)) {
        if (-not (Test-Path -LiteralPath $BundleFile)) { Fail "bundle file not found: $BundleFile" }
        Copy-Item -LiteralPath $BundleFile -Destination $archive
        $shaSidecar = "$BundleFile.sha256"
        if (Test-Path -LiteralPath $shaSidecar) {
            $expectedSha = ((Get-Content -LiteralPath $shaSidecar -TotalCount 1) -split '\s+')[0]
        } else {
            Fail "no $shaSidecar alongside the local bundle. Provide the checksum file."
        }
    } else {
        Write-Log "resolving the AFCT Windows deployment bundle from $Repo..."
        $mf = Join-Path $Work 'manifest.json'
        Get-AfctFile $ManifestUrl $mf
        $manifest = Get-Content -LiteralPath $mf -Raw | ConvertFrom-Json
        if ($manifest.schema -ne 'afct-deployment-manifest/v1') { Fail "unexpected manifest schema: $($manifest.schema)" }
        $manifestBundle = [string]$manifest.bundle
        $expectedSha    = [string]$manifest.sha256
        $mVer           = [string]$manifest.deploymentToolVersion
        if ([string]::IsNullOrEmpty($DeployVersion)) { $DeployVersion = $mVer }
        elseif ($DeployVersion -ne $mVer) { Fail "requested deployment version $DeployVersion, but the manifest offers $mVer." }
        if ($manifestBundle -ne "$AssetPrefix$mVer.zip") { Fail "manifest bundle name '$manifestBundle' does not match version $mVer." }
        Write-Log "downloading the deployment bundle ($manifestBundle)..."
        Get-AfctFile "$AssetBase/$manifestBundle" $archive
    }

    # Verify BEFORE reading anything from the archive.
    if ([string]::IsNullOrEmpty($expectedSha) -or -not (Test-Hex $expectedSha)) { Fail "the bundle checksum is missing or malformed." }
    Write-Log "verifying the bundle checksum..."
    $actualSha = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLower()
    if ($actualSha -ne $expectedSha.ToLower()) { Fail "bundle checksum mismatch (expected $expectedSha, got $actualSha); refusing to install." }
    Write-Log "checksum verified."
    $digestPrefix = $actualSha.Substring(0, 12)

    # --------------------------------------------------------------------------- #
    # Inspect + extract into staging, then validate.
    # --------------------------------------------------------------------------- #
    Write-Log "inspecting and extracting the bundle..."
    $stage = Join-Path $Work 'stage'
    Expand-BundleSafe $archive $stage

    # Normalize to the directory that actually contains bin\afctctl.ps1.
    $rootDir = $stage
    if (-not (Test-Path -LiteralPath (Join-Path $rootDir 'bin\afctctl.ps1'))) {
        $sub = Get-ChildItem -LiteralPath $stage -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'bin\afctctl.ps1') } | Select-Object -First 1
        if ($null -ne $sub) { $rootDir = $sub.FullName }
    }
    foreach ($req in @('bin\afctctl.ps1', 'lib', 'docker-compose.yml', 'DEPLOY_VERSION')) {
        if (-not (Test-Path -LiteralPath (Join-Path $rootDir $req))) { Fail "the bundle is missing $req." }
    }

    # Version agreement: DEPLOY_VERSION, the bundled controller's $InstallerVersion, any
    # requested/manifest version, and the bundle filename must all name the SAME version.
    $dv = (Get-Content -LiteralPath (Join-Path $rootDir 'DEPLOY_VERSION') -TotalCount 1).Trim()
    $cv = Get-ControllerVersion (Join-Path $rootDir 'bin\afctctl.ps1')
    if ([string]::IsNullOrEmpty($dv)) { Fail "the bundle is missing a usable DEPLOY_VERSION." }
    if ([string]::IsNullOrEmpty($cv)) { Fail "the bundle controller is missing `$InstallerVersion." }
    if ($dv -ne $cv) { Fail "bundle version metadata disagrees: DEPLOY_VERSION=$dv but controller=$cv." }
    if (-not [string]::IsNullOrEmpty($DeployVersion) -and $DeployVersion -ne $dv) { Fail "requested version $DeployVersion, but the bundle contains $dv." }
    if (-not [string]::IsNullOrEmpty($manifestBundle) -and $manifestBundle -ne "$AssetPrefix$dv.zip") { Fail "manifest bundle name does not match the bundle version $dv." }
    # The bundle filename is the leaf of the local -BundleFile, or the manifest's bundle
    # name on the download path (where $BundleFile is empty). Using $BundleFile alone
    # threw "empty path" on every downloaded install.
    $bundleName = if ([string]::IsNullOrEmpty($BundleFile)) { $manifestBundle } else { Split-Path -Leaf $BundleFile }
    if (-not [string]::IsNullOrEmpty($bundleName) -and $bundleName -like "$AssetPrefix*.zip") {
        $fver = $bundleName.Substring($AssetPrefix.Length); $fver = $fver.Substring(0, $fver.Length - 4)
        if ($fver -ne $dv) { Fail "bundle filename $bundleName does not match its DEPLOY_VERSION $dv." }
    }
    $version = $dv

    # Parse-check the controller we are about to make active.
    $perr = $null; $ptok = $null
    [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $rootDir 'bin\afctctl.ps1'), [ref]$ptok, [ref]$perr) | Out-Null
    if ($perr.Count -gt 0) { Fail "the bundled controller failed its syntax check; refusing to install." }

    # --------------------------------------------------------------------------- #
    # Publish immutably under releases\<version>-<digest-prefix>.
    # --------------------------------------------------------------------------- #
    New-Item -ItemType Directory -Path $Releases -Force | Out-Null
    New-Item -ItemType Directory -Path $Shared   -Force | Out-Null
    New-Item -ItemType Directory -Path $RootBin  -Force | Out-Null

    $releaseId = "$version-$digestPrefix"
    $target    = Join-Path $Releases $releaseId

    # A version's bytes are fixed: refuse a different bundle under an already-installed version.
    Get-ChildItem -LiteralPath $Releases -Directory -Filter "$version-*" -ErrorAction SilentlyContinue | ForEach-Object {
        if ($_.Name -ne $releaseId -and $_.Name -notlike '*.incoming.*' -and $_.Name -notlike '*.corrupt.*') {
            Fail "deployment version $version is already installed with different content ($($_.Name)). Bump the deployment-tool version."
        }
    }

    # Capture the previous active release for rollback.
    $stateFile = Join-Path $Shared 'active-release'
    $prevActive = ''
    if (Test-Path -LiteralPath $stateFile) {
        $p = (Get-Content -LiteralPath $stateFile -TotalCount 1).Trim()
        if ((Test-Path -LiteralPath $p) -and ($p -ne $target)) { $prevActive = $p }
    }

    if (Test-Path -LiteralPath $target) {
        Write-Log "deployment tooling $version ($digestPrefix) is already installed; not re-extracting."
    } else {
        $incoming = "$target.incoming.$PID"
        if (Test-Path -LiteralPath $incoming) { Remove-Item -LiteralPath $incoming -Recurse -Force }
        Copy-Item -LiteralPath $rootDir -Destination $incoming -Recurse
        Move-Item -LiteralPath $incoming -Destination $target
    }

    # --------------------------------------------------------------------------- #
    # Record the canonical install-root marker (required for a safe uninstall). Atomic +
    # ACL-restricted; a failure is fatal before we switch the active release.
    # --------------------------------------------------------------------------- #
    $marker = Join-Path $Shared 'install-root'
    $markerTmp = Join-Path $Shared (".install-root." + [Guid]::NewGuid().ToString('N'))
    try {
        Set-Content -LiteralPath $markerTmp -Value $Prefix -Encoding ASCII -ErrorAction Stop
    } catch {
        Remove-Item -LiteralPath $markerTmp -Force -ErrorAction SilentlyContinue
        Fail "could not write the install-root marker in $Shared. $($_.Exception.Message)"
    }
    # The install-root marker is a safety marker (a later uninstall trusts it before deleting
    # the tree), so restrict it to the current user and treat a lockdown failure as fatal:
    # stop rather than leave a safety marker world-writable. It already lives under the
    # per-user profile; the ACL is defense in depth.
    try { Protect-AfctFile $markerTmp } catch {
        Remove-Item -LiteralPath $markerTmp -Force -ErrorAction SilentlyContinue
        Fail "could not restrict permissions on the install-root marker in $Shared. $($_.Exception.Message)"
    }
    try {
        Move-Item -LiteralPath $markerTmp -Destination $marker -Force -ErrorAction Stop
    } catch {
        Remove-Item -LiteralPath $markerTmp -Force -ErrorAction SilentlyContinue
        Fail "could not publish the install-root marker. $($_.Exception.Message)"
    }

    # --------------------------------------------------------------------------- #
    # Switch the active release. The state file is the atomic source of truth; a `current`
    # junction is a best-effort convenience (may be unavailable without privilege).
    # --------------------------------------------------------------------------- #
    $stateTmp = "$stateFile.tmp.$PID"
    Set-Content -LiteralPath $stateTmp -Value $target -Encoding ASCII
    Move-Item -LiteralPath $stateTmp -Destination $stateFile -Force
    # The active-release pointer decides which controller runs, so lock it to the current
    # user; a lockdown failure is fatal (another user must not be able to redirect it).
    try { Protect-AfctFile $stateFile } catch { Fail "could not restrict permissions on the active-release pointer in $Shared. $($_.Exception.Message)" }
    $current = Join-Path $Prefix 'current'
    try {
        if (Test-Path -LiteralPath $current) { (Get-Item -LiteralPath $current).Delete() }
        New-Item -ItemType Junction -Path $current -Target $target -ErrorAction Stop | Out-Null
    } catch {
        Write-Log "note: could not create a 'current' junction; the command wrapper resolves the active release from state instead."
    }

    Install-AfctWrappers $Prefix
    Write-Log "installed the AFCT deployment tooling $version at $target."

    # --------------------------------------------------------------------------- #
    # Validate the new controller; roll back on failure.
    # --------------------------------------------------------------------------- #
    $newController = Join-Path $target 'bin\afctctl.ps1'
    $valid = $true
    $global:LASTEXITCODE = 0
    try { & $newController version *> $null } catch { $valid = $false }
    if ($LASTEXITCODE -ne 0) { $valid = $false }
    if (-not $valid) {
        Write-Err "the new deployment tooling failed validation; rolling back."
        if (-not [string]::IsNullOrEmpty($prevActive)) {
            Set-Content -LiteralPath $stateFile -Value $prevActive -Encoding ASCII
            try { if (Test-Path -LiteralPath $current) { (Get-Item -LiteralPath $current).Delete() }; New-Item -ItemType Junction -Path $current -Target $prevActive -ErrorAction Stop | Out-Null } catch { }
            $quarantine = "$target.corrupt.$PID"
            Move-Item -LiteralPath $target -Destination $quarantine -Force -ErrorAction SilentlyContinue
            Fail "rolled back to the previous deployment tooling."
        }
        Fail "no previous release to roll back to; the deployment tooling may be broken."
    }

    Remove-AfctOldReleases $Releases $target $prevActive

    if ($SwitchOnly) { Write-Log "the deployment tooling is now $version."; exit 0 }

    Write-Log "Remember: Windows is for testing and evaluation. Use Linux for production."
    & $newController install @Rest
    exit $LASTEXITCODE
}
finally {
    Remove-Item -LiteralPath $Work -Recurse -Force -ErrorAction SilentlyContinue
}
