# Output.ps1 - console + log helpers for the AFCT Windows controller.
#
# Dot-sourced by afctctl.ps1. Defines functions only; no side effects on load. Keeps
# Windows PowerShell 5.1 compatibility (no ternary, no ?., no null-coalescing).

Set-StrictMode -Version Latest

function Write-AfctInfo    { param([string]$Message) Write-Host "[afct] $Message" }
function Write-AfctSuccess { param([string]$Message) Write-Host "[afct] $Message" -ForegroundColor Green }
function Write-AfctWarn    { param([string]$Message) Write-Host "[afct] WARNING: $Message" -ForegroundColor Yellow }
function Write-AfctError   { param([string]$Message) Write-Host "[afct] ERROR: $Message" -ForegroundColor Red }

# Append a line to the shared install log when one is configured. Never throws.
function Add-AfctLogLine {
    param([string]$Line, [string]$LogFile)
    if ([string]::IsNullOrEmpty($LogFile)) { return }
    try {
        $stamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
        Add-Content -LiteralPath $LogFile -Value "$stamp $Line" -ErrorAction Stop
    } catch { }
}
