# Output.ps1 - console + log helpers for the AFCT Windows controller.
#
# Dot-sourced by afctctl.ps1. Defines functions only; no side effects on load. Keeps
# Windows PowerShell 5.1 compatibility (no ternary, no ?., no null-coalescing).
#
# Every console message is also mirrored to the install log, which is what makes
# shared\install.log a usable deployment trace and what makes the diagnostics bundle worth
# collecting. Before this, Add-AfctLogLine existed and nothing in the controller called it:
# the log the bundle shipped was empty exactly when somebody needed it.
#
# Two rules keep the mirror safe. The writer never writes to the console, so it cannot
# recurse through these functions; and it never throws, so a locked or missing log file can
# never turn a successful install into a failure.

Set-StrictMode -Version Latest

# Mirror a console message to the log. Blank lines are console spacing and are not worth a
# timestamped row, so they are dropped. $LogFile is a controller global that is empty until
# the controller sets it, which is what makes these safe to call from anywhere.
function Write-AfctMirror {
    param([string]$Level, [string]$Message)
    if ([string]::IsNullOrWhiteSpace($Message)) { return }
    $file = ''
    if (Test-Path Variable:\LogFile) { $file = "$LogFile" }
    if ([string]::IsNullOrEmpty($file)) { return }
    Add-AfctLogLine "$Level $Message" $file
}

function Write-AfctInfo    { param([string]$Message) Write-Host "[afct] $Message"; Write-AfctMirror 'INFO ' $Message }
function Write-AfctSuccess { param([string]$Message) Write-Host "[afct] $Message" -ForegroundColor Green; Write-AfctMirror 'OK   ' $Message }
function Write-AfctWarn    { param([string]$Message) Write-Host "[afct] WARNING: $Message" -ForegroundColor Yellow; Write-AfctMirror 'WARN ' $Message }
function Write-AfctError   { param([string]$Message) Write-Host "[afct] ERROR: $Message" -ForegroundColor Red; Write-AfctMirror 'ERROR' $Message }

# Record something in the log without printing it. For deployment facts that belong in a
# trace but would be noise on an installer's screen: tool versions, the Compose project,
# phase boundaries, timings.
#
# Callers pass facts, never values read out of the environment file. Nothing here inspects
# what it is given, so a secret handed to it would be written; the discipline is at the call
# sites, and the tests assert it holds.
function Write-AfctTrace {
    param([string]$Message)
    Write-AfctMirror 'TRACE' $Message
}

# Append a line to the shared install log when one is configured. Never throws.
function Add-AfctLogLine {
    param([string]$Line, [string]$LogFile)
    if ([string]::IsNullOrEmpty($LogFile)) { return }
    try {
        $stamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
        Add-Content -LiteralPath $LogFile -Value "$stamp $Line" -ErrorAction Stop
    } catch { }
}
