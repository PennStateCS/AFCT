<#
afctctl.ps1 - the AFCT Windows deployment control command.

Installed at %LOCALAPPDATA%\AFCT\current\bin\afctctl.ps1 and invoked through the stable
%LOCALAPPDATA%\AFCT\bin\afctctl.cmd wrapper (or directly). It dot-sources the library
modules next to it and dispatches the operational commands. All persistent configuration
and data live under %LOCALAPPDATA%\AFCT\shared and in Docker Desktop volumes, never inside
a versioned release directory.

Windows is for testing, evaluation, development, and demonstrations. Linux is the
recommended production platform.

FOUNDATION BUILD: this controller currently implements version/help and the dispatch
surface. The full operational commands (install/status/update/...) are ported from the
existing installer in the next phase; they are recognized here and report that clearly.
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$Command = 'help',
    [switch]$Yes,
    [switch]$NonInteractive,
    [switch]$Reconfigure,
    [switch]$WithUpdater,
    [switch]$NoColor,
    [switch]$PurgeData,
    [switch]$Help,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Rest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$InstallerVersion = '2.2.3'

# --- resolve this controller's release, lib, and install-root layout ---------------------
$BinDir     = $PSScriptRoot
$ReleaseDir = Split-Path -Parent $BinDir
$LibDir     = Join-Path $ReleaseDir 'lib'

# The install root (the parent of releases\). Overridable so the controller can run from a
# bundle checkout in tests or a non-default prefix.
$Prefix = [Environment]::GetEnvironmentVariable('AFCT_PREFIX')
if ([string]::IsNullOrEmpty($Prefix)) {
    $releasesParent = Split-Path -Parent $ReleaseDir          # ...\releases
    if ((Split-Path -Leaf $releasesParent) -eq 'releases') {
        $Prefix = Split-Path -Parent $releasesParent
    } else {
        $Prefix = $ReleaseDir
    }
}
$SharedDir = Join-Path $Prefix 'shared'
$LogFile   = Join-Path $SharedDir 'install.log'

# --- load library modules (functions only) -----------------------------------------------
foreach ($mod in @('Output', 'Platform')) {
    . (Join-Path $LibDir "$mod.ps1")
}

# --- test-only dispatch recorder (never used in production) -------------------------------
# When AFCT_TEST_RECORD_DISPATCH names a file, record the resolved command, forwarded args
# (order + spaces preserved), controller path, install prefix, and version, then exit before
# any Docker or deployment action. It only writes a file; it never executes or evaluates
# input. Used to prove the bootstrap-to-controller handoff in tests.
$recordPath = [Environment]::GetEnvironmentVariable('AFCT_TEST_RECORD_DISPATCH')
if (-not [string]::IsNullOrEmpty($recordPath)) {
    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add("self=$PSCommandPath")
    $lines.Add("prefix=$Prefix")
    $lines.Add("version=$InstallerVersion")
    $lines.Add("command=$Command")
    if ($null -ne $Rest) { foreach ($a in $Rest) { $lines.Add("arg=$a") } }
    Set-Content -LiteralPath $recordPath -Value $lines -Encoding UTF8
    exit 0
}

function Show-AfctUsage {
    @"
afctctl: AFCT deployment control (Windows)

Windows is intended for testing, evaluation, development, and demonstrations. For a
long-running production deployment, use the Linux installer on a Linux server.

Usage:
  afctctl <command> [options]

Commands:
  install          Configure and deploy AFCT (run by the installer).
  status           Show container and application health status.
  logs             Follow application logs. Press Ctrl+C to stop.
  update           Pull the latest application images, recreate the stack, verify health.
  self-update      Update the deployment tooling to the newest verified bundle.
  restart          Recreate the stack without pulling new images.
  stop             Stop the stack without deleting its data volumes.
  enable-updater   Enable the in-app updater sidecar (EXPERIMENTAL on Windows).
  disable-updater  Stop and remove the updater sidecar.
  doctor           Run a comprehensive, read-only system check.
  recover          Restore the newest protected .env.production backup.
  uninstall        Remove AFCT. Preserves data volumes unless you opt in explicitly.
  diagnostics      Create a support archive with known secrets redacted.
  version          Show deployment-tool and deployed application version information.
  help             Show this help.

AFCT runs as the current user; no Administrator rights are required. Configuration and data
live in $SharedDir and in Docker Desktop volumes, never inside a versioned release
directory.
"@
}

function Show-AfctVersion {
    Write-AfctInfo "deployment tool version: $InstallerVersion"
    $dv = Join-Path $ReleaseDir 'DEPLOY_VERSION'
    if (Test-Path -LiteralPath $dv) {
        Write-AfctInfo ("release: " + ((Get-Content -LiteralPath $dv -TotalCount 1).Trim()))
    }
}

if ($Help) { $Command = 'help' }

switch ($Command) {
    'help'    { Show-AfctUsage; break }
    'version' { Show-AfctVersion; break }
    { $_ -in @('install','status','logs','update','self-update','restart','stop',
               'enable-updater','disable-updater','doctor','recover','uninstall','diagnostics') } {
        Write-AfctInfo "the '$Command' command is ported from the existing installer in the next AFCT Windows build."
        break
    }
    default {
        Write-AfctError "unknown option or command: $Command"
        Write-AfctInfo  "Run: afctctl help"
        exit 2
    }
}

# Explicit success exit so callers (the bootstrap's post-switch validation, the wrapper
# launcher) get a reliable $LASTEXITCODE from this PowerShell script.
exit 0
