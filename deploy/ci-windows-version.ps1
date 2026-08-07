#Requires -Version 5.1
<#
ci-windows-version.ps1 - print the AFCT Windows controller's deployment-tool version.

Parses the single `$InstallerVersion = '<version>'` assignment from the Windows controller
and prints just the version. Exits 1 (printing nothing to stdout) when the file is missing
or the version cannot be parsed, so CI can rely on a clean value or a hard failure rather
than a fragile inline shell expression.

Usage:
  pwsh -File deploy/ci-windows-version.ps1 [-ControllerPath <path>]
Default ControllerPath: deploy/windows/bin/afctctl.ps1 (relative to this script).
#>
[CmdletBinding()]
param([string]$ControllerPath)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrEmpty($ControllerPath)) {
    $ControllerPath = Join-Path $PSScriptRoot 'windows\bin\afctctl.ps1'
}
if (-not (Test-Path -LiteralPath $ControllerPath)) {
    [Console]::Error.WriteLine("ci-windows-version: controller not found at $ControllerPath")
    exit 1
}

$m = Select-String -LiteralPath $ControllerPath -Pattern "^\s*\`$InstallerVersion\s*=\s*'([^']+)'" | Select-Object -First 1
if ($null -eq $m) {
    [Console]::Error.WriteLine("ci-windows-version: could not parse `$InstallerVersion from $ControllerPath")
    exit 1
}
Write-Output $m.Matches.Groups[1].Value
