# Platform.ps1 - Windows platform facts for the AFCT controller.
#
# Dot-sourced by afctctl.ps1. Functions only. Windows PowerShell 5.1 compatible.
# The parity goal with Linux/macOS is consistent behavior and safety, not shared code.

Set-StrictMode -Version Latest

function Get-AfctPlatformName { 'Windows' }

# Release-asset family names, matching the Linux/macOS scheme.
function Get-AfctBundlePrefix   { 'afct-windows-deploy-' }
function Get-AfctManifestAsset  { 'deployment-manifest-windows.json' }

# Windows runs AFCT through Docker Desktop as the current user: no service account, no
# sudo-equivalent, no systemd. These mirror the macOS answers.
function Test-AfctSupportsServiceUser { $false }

# The in-app updater has not been validated end to end on real Windows hardware, so it is
# offered but flagged experimental (help, install prompt, enable-updater, docs).
function Test-AfctUpdaterExperimental { $true }

# Confirm we are on Windows. Honors AFCT_OS for tests (real installs never set it). On
# Windows PowerShell 5.1 $IsWindows is undefined, so treat that as Windows.
function Test-AfctIsWindows {
    $osOverride = [Environment]::GetEnvironmentVariable('AFCT_OS')
    if (-not [string]::IsNullOrEmpty($osOverride)) { return ($osOverride -eq 'Windows') }
    $isWin = Get-Variable -Name IsWindows -ValueOnly -ErrorAction SilentlyContinue
    if ($null -eq $isWin) { return $true }   # Windows PowerShell 5.1
    return [bool]$isWin
}
