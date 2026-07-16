#Requires -Version 5.1
<#
AFCT Dashboard installer and operations helper (Windows / Docker Desktop).

This script mirrors deploy/install.sh as closely as PowerShell allows: the same
commands, the same guided flow, the same configuration handling, and the same
safety rules (generated secrets are never written to install.log).

Guided installation:
  .\install.ps1

Unattended installation:
  $env:ADMIN_EMAIL = 'admin@example.edu'
  $env:ADMIN_PASSWORD_FILE = 'C:\secrets\afct-admin-password.txt'
  $env:APP_URL = 'https://afct.example.edu'
  .\install.ps1 -NonInteractive

Operational commands:
  .\install.ps1 status
  .\install.ps1 logs
  .\install.ps1 update
  .\install.ps1 restart
  .\install.ps1 stop
  .\install.ps1 doctor
  .\install.ps1 diagnostics

If PowerShell blocks the script, run it once as:
  powershell -ExecutionPolicy Bypass -File .\install.ps1
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)][string]$Command = 'install',
  [Alias('y')][switch]$Yes,
  [switch]$NonInteractive,
  [switch]$Reconfigure,
  [switch]$WithUpdater,
  [switch]$NoColor,
  [switch]$Help
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

# --------------------------------------------------------------------------- #
# Installer configuration (mirrors install.sh)
# --------------------------------------------------------------------------- #
$InstallerVersion = '2.1.1'

$InvocationDir = (Get-Location).Path
Set-Location -LiteralPath $PSScriptRoot
# Keep the .NET current directory in sync: Set-Location alone does not move it,
# and the [System.IO.File] helpers resolve relative paths against the .NET one.
[Environment]::CurrentDirectory = $PSScriptRoot

function Get-EnvOr([string]$name, [string]$fallback) {
  $v = [Environment]::GetEnvironmentVariable($name)
  if ([string]::IsNullOrEmpty($v)) { return $fallback }
  return $v
}

$ComposeFile    = Get-EnvOr 'AFCT_COMPOSE_FILE' 'docker-compose.yml'
$EnvFile        = Get-EnvOr 'AFCT_ENV_FILE' '.env.production'
$EnvExample     = Get-EnvOr 'AFCT_ENV_EXAMPLE' '.env.production.example'
$LogFile        = Get-EnvOr 'AFCT_LOG_FILE' 'install.log'
$AppService     = Get-EnvOr 'AFCT_APP_SERVICE' 'app'
$UpdaterService = Get-EnvOr 'AFCT_UPDATER_SERVICE' 'updater'
$HealthPath     = Get-EnvOr 'AFCT_HEALTH_PATH' '/api/health'
$HealthTimeout  = [int](Get-EnvOr 'AFCT_HEALTH_TIMEOUT' '300')
$HealthInterval = [int](Get-EnvOr 'AFCT_HEALTH_INTERVAL' '5')
$DiagPrefix     = 'afct-diagnostics'

$script:LogEnabled     = $false
$script:DiagOnExit     = $false
$script:DiagInProgress = $false
$script:LockHeld       = $false
$script:ComposeKind    = ''
$script:StepNum        = 0
$script:Reconfiguring  = $false
$script:AdminPasswordGenerated = $false
$script:UpdateImageSnapshot = @()

# Configuration produced by the install flow (initialized for strict mode).
$script:AppUrlIn = ''
$script:AdminEmailIn = ''
$script:AdminPasswordIn = ''
$script:PostgresPasswordIn = ''
$script:DatabaseUrlIn = ''
$script:NextAuthSecretIn = ''

# A lock name derived from this deploy directory, so two copies of the installer
# in different folders don't contend.
$lockKeyBytes = [System.Text.Encoding]::UTF8.GetBytes($PSScriptRoot.ToLowerInvariant())
$lockKeyHash = [System.Security.Cryptography.SHA256]::Create().ComputeHash($lockKeyBytes)
$LockKey = ([BitConverter]::ToString($lockKeyHash, 0, 8)) -replace '-', ''
$LockDir = Join-Path $env:TEMP "afct-installer-$LockKey.lock"

$UseColor = (-not $NoColor) -and (-not [Console]::IsOutputRedirected) -and -not $env:NO_COLOR

# --------------------------------------------------------------------------- #
# Output and logging
# --------------------------------------------------------------------------- #
function Add-LogLine([string]$line) {
  if (-not $script:LogEnabled) { return }
  try { Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8 } catch { $script:LogEnabled = $false }
}

function Write-Info([string]$m) {
  $line = "[afct] $m"
  Write-Host $line
  Add-LogLine $line
}

function Write-Success([string]$m) {
  $line = "[afct] OK: $m"
  if ($UseColor) { Write-Host $line -ForegroundColor Green } else { Write-Host $line }
  Add-LogLine $line
}

function Write-WarnMsg([string]$m) {
  $line = "[afct] WARNING: $m"
  if ($UseColor) { Write-Host $line -ForegroundColor Yellow } else { Write-Host $line }
  Add-LogLine $line
}

function Write-ErrorMsg([string]$m) {
  $line = "[afct] ERROR: $m"
  if ($UseColor) { Write-Host $line -ForegroundColor Red } else { Write-Host $line }
  Add-LogLine $line
}

function Write-Heading([string]$m) {
  Write-Host ''
  if ($UseColor) { Write-Host $m -ForegroundColor Cyan } else { Write-Host $m }
  Add-LogLine ''
  Add-LogLine $m
}

# Sequential step heading. A running counter (not "N of 4") so a run that skips
# configuration/review still reads 1, 2, ... with no confusing gaps.
function Write-Step([string]$m) {
  $script:StepNum++
  Write-Heading "Step $($script:StepNum): $m"
}

# Never route secrets through the installer log: console only.
function Show-Secret([string]$m) {
  if ($UseColor) { Write-Host $m -ForegroundColor Cyan } else { Write-Host $m }
}

function Invoke-LogRotation {
  if (-not (Test-Path -LiteralPath $LogFile)) { return }
  try {
    $size = (Get-Item -LiteralPath $LogFile).Length
    if ($size -lt 5MB) { return }
    Remove-Item -LiteralPath "$LogFile.5" -Force -ErrorAction SilentlyContinue
    foreach ($n in 4, 3, 2, 1) {
      if (Test-Path -LiteralPath "$LogFile.$n") {
        Move-Item -LiteralPath "$LogFile.$n" -Destination "$LogFile.$($n + 1)" -Force -ErrorAction SilentlyContinue
      }
    }
    Move-Item -LiteralPath $LogFile -Destination "$LogFile.1" -Force -ErrorAction SilentlyContinue
  } catch {}
}

function Initialize-Log {
  Invoke-LogRotation
  try {
    $stamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    $header = "`n============================================================`nAFCT installer run: $stamp`nInstaller version: $InstallerVersion`nMode: $Command"
    Add-Content -LiteralPath $LogFile -Value $header -Encoding UTF8
    $script:LogEnabled = $true
    Protect-File $LogFile
  } catch {
    $script:LogEnabled = $false
    Write-WarnMsg "the installer log cannot be written at $PSScriptRoot\$LogFile; continuing without file logging."
  }
}

function Stop-Install([string]$m) {
  Write-ErrorMsg $m
  throw "afct-fatal: $m"
}

# Best-effort: restrict a file to the current user (the Windows analog of chmod 600).
function Protect-File([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return }
  try { icacls $path /inheritance:r /grant:r "$($env:USERNAME):F" *> $null } catch {}
}

# --------------------------------------------------------------------------- #
# Native-command helpers (PowerShell 5.1 safe)
# --------------------------------------------------------------------------- #
# Capture a native command's combined output as plain strings without letting
# 5.1's stderr-as-ErrorRecord behavior abort under $ErrorActionPreference = Stop.
# $LASTEXITCODE remains that of the native command.
function Invoke-NativeCapture([scriptblock]$block) {
  $eap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $block 2>&1 | ForEach-Object { "$_" } }
  finally { $ErrorActionPreference = $eap }
}

# Run a native command with output flowing to the console (so docker can render
# its own progress bars) and return its exit code. stdout goes through Out-Host
# so it displays live instead of being captured into the caller's assignment;
# stderr (where docker draws progress) reaches the console directly.
function Invoke-NativeConsole([scriptblock]$block) {
  $eap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $block | Out-Host } finally { $ErrorActionPreference = $eap }
  return $LASTEXITCODE
}

# --------------------------------------------------------------------------- #
# Lock (single installer instance per deploy directory; reentrant)
# --------------------------------------------------------------------------- #
function Lock-Installer {
  if ($script:LockHeld) { return }

  $tryCreate = {
    try {
      New-Item -ItemType Directory -Path $LockDir -ErrorAction Stop | Out-Null
      return $true
    } catch { return $false }
  }

  if (& $tryCreate) {
    $script:LockHeld = $true
    try { Set-Content -LiteralPath (Join-Path $LockDir 'pid') -Value $PID -Encoding ASCII } catch {}
    return
  }

  $lockPid = $null
  try { $lockPid = [int](Get-Content -LiteralPath (Join-Path $LockDir 'pid') -ErrorAction Stop) } catch {}
  if ($lockPid) {
    $proc = Get-Process -Id $lockPid -ErrorAction SilentlyContinue
    if ($proc) { Stop-Install "another AFCT installer operation is already running (PID $lockPid)." }
  }

  Write-WarnMsg 'removing a stale installer lock.'
  try { Remove-Item -Recurse -Force -LiteralPath $LockDir -ErrorAction Stop } catch { Stop-Install "could not remove the stale lock at $LockDir." }
  if (-not (& $tryCreate)) { Stop-Install "could not acquire the installer lock at $LockDir." }
  $script:LockHeld = $true
  try { Set-Content -LiteralPath (Join-Path $LockDir 'pid') -Value $PID -Encoding ASCII } catch {}
}

function Unlock-Installer {
  if ($script:LockHeld) {
    Remove-Item -Recurse -Force -LiteralPath $LockDir -ErrorAction SilentlyContinue
    $script:LockHeld = $false
  }
}

# --------------------------------------------------------------------------- #
# Docker and Compose wrappers
# --------------------------------------------------------------------------- #
function Find-Compose {
  Invoke-NativeCapture { docker compose version } | Out-Null
  if ($LASTEXITCODE -eq 0) { $script:ComposeKind = 'v2'; return $true }
  if (Get-Command docker-compose -ErrorAction SilentlyContinue) { $script:ComposeKind = 'v1'; return $true }
  $script:ComposeKind = ''
  return $false
}

# Emits ('--profile','updater') when the in-app updater sidecar has been enabled,
# so every compose action - pull/up/ps/config/stop - includes it.
function Get-UpdaterProfileArgs {
  if ((Read-EnvValue 'AFCT_UPDATER_ENABLED' $EnvFile) -eq 'true') { return @('--profile', 'updater') }
  return @()
}

# Argument list for a compose invocation against the production env file.
# Plain functions using $args (not an advanced param block) so pass-through
# flags such as -f, -q, and --tail are never parsed as our own parameters.
function Get-ComposeArgList([object[]]$composeArgs) {
  $profileArgs = Get-UpdaterProfileArgs
  if (Test-Path -LiteralPath $EnvFile) { $baseArgs = @('--env-file', $EnvFile, '-f', $ComposeFile) }
  else { $baseArgs = @('-f', $ComposeFile) }
  return @($profileArgs) + @($baseArgs) + @($composeArgs)
}

# docker compose against the production env file. Returns output lines; check
# $LASTEXITCODE afterward.
function Invoke-Compose {
  $all = Get-ComposeArgList $args
  if ($script:ComposeKind -eq 'v1') {
    Invoke-NativeCapture { docker-compose @all }
  } else {
    Invoke-NativeCapture { docker compose @all }
  }
}

# Same, but output flows to the console (docker renders its own progress).
function Invoke-ComposeConsole {
  $all = Get-ComposeArgList $args
  if ($script:ComposeKind -eq 'v1') {
    return Invoke-NativeConsole { docker-compose @all }
  }
  return Invoke-NativeConsole { docker compose @all }
}

function Resolve-DockerAccess {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Stop-Install 'Docker is not installed. Install Docker Desktop: https://docs.docker.com/desktop/install/windows-install/'
  }
  Invoke-NativeCapture { docker info } | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Stop-Install 'Docker is installed, but its daemon is not reachable. Start Docker Desktop and try again.'
  }
  if (-not (Find-Compose)) {
    Stop-Install 'Docker Compose was not found. Update Docker Desktop (it includes Compose).'
  }
  if ($script:ComposeKind -eq 'v1') {
    Write-WarnMsg "legacy docker-compose v1 is being used. Install the current 'docker compose' plugin when practical."
  }
}

# Diagnostics must remain useful even when Docker is broken: never throw.
function Resolve-DockerAccessSoft {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { return $false }
  Invoke-NativeCapture { docker info } | Out-Null
  if ($LASTEXITCODE -ne 0) { return $false }
  Find-Compose | Out-Null
  return $true
}

# --------------------------------------------------------------------------- #
# Prompt helpers and validation
# --------------------------------------------------------------------------- #
function Test-CanPrompt {
  return (-not $NonInteractive) -and (-not [Console]::IsInputRedirected)
}

function Read-Default([string]$question, [string]$default) {
  if (-not (Test-CanPrompt)) { return $default }
  $a = Read-Host "$question [$default]"
  if ([string]::IsNullOrWhiteSpace($a)) { return $default }
  return $a
}

function Read-Required([string]$question) {
  if (-not (Test-CanPrompt)) { return $null }
  while ($true) {
    $a = Read-Host $question
    if (-not [string]::IsNullOrWhiteSpace($a)) { return $a }
    Write-WarnMsg 'a value is required.'
  }
}

function Read-SecretValue([string]$question) {
  if (-not (Test-CanPrompt)) { return $null }
  $sec = Read-Host $question -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function Confirm-Action([string]$question, [string]$default = 'y') {
  if ($Yes) { $answer = $default }
  else { $answer = Read-Default $question $default }
  return $answer -match '^(y|Y|yes|YES|Yes)$'
}

function Test-Email([string]$value) {
  if ($value -match '\s') { return $false }
  return $value -match '^[^@]+@[^@]+\.[^@]+$'
}

# Returns the normalized origin, or $null when the URL is not a plain
# http(s)://host[:port] origin (no spaces, paths, queries, fragments, or userinfo).
function ConvertTo-NormalizedAppUrl([string]$url) {
  if ($url -match '\s') { return $null }
  $scheme = $null
  if ($url -like 'http://*') { $scheme = 'http' }
  elseif ($url -like 'https://*') { $scheme = 'https' }
  else { return $null }

  $authority = $url.Substring($scheme.Length + 3).TrimEnd('/')
  if ([string]::IsNullOrEmpty($authority)) { return $null }
  if ($authority -match '[/?#@]') { return $null }
  return "${scheme}://$authority"
}

function Write-AppUrlWarnings([string]$url) {
  $hostPart = ($url -replace '^[a-z]+://', '') -split '/' | Select-Object -First 1
  $hostOnly = ($hostPart -split ':')[0]

  $isLocalHttp = $url -match '^http://(localhost|127\.0\.0\.1|\[::1\])'
  if ($url -notlike 'https://*' -and -not $isLocalHttp) {
    Write-WarnMsg 'the public URL is not HTTPS. Authentication cookies and redirects may not work safely in production.'
  }
  if ($hostOnly -match '^[0-9]+(\.[0-9]+){3}$') {
    Write-WarnMsg 'the public URL uses a bare IPv4 address. A hostname with a matching TLS certificate is strongly recommended.'
  }
}

# Password policy, mirroring src/lib/password-policy.ts: 8-72 chars with an
# upper, a lower, a digit, and a special (non-alphanumeric) character.
function Test-StrongPassword([string]$pw) {
  return ($pw.Length -ge 8 -and $pw.Length -le 72 -and
          $pw -cmatch '[A-Z]' -and $pw -cmatch '[a-z]' -and
          $pw -match '[0-9]' -and $pw -match '[^A-Za-z0-9]')
}

# Values are written unquoted into the env file, which Compose reads literally to
# end-of-line. Reject inputs that would be reinterpreted rather than stored
# verbatim (mirrors is_env_value_safe in install.sh).
function Test-EnvValueSafe([string]$value) {
  if ($value -match "[`"'\\]") { return $false }
  if ($value -match "[`r`n`t]") { return $false }
  if ($value -ne $value.Trim()) { return $false }
  if ($value -like '* #*') { return $false }
  return $true
}

function Read-PasswordSource {
  $envPassword = $env:ADMIN_PASSWORD
  $envPasswordFile = $env:ADMIN_PASSWORD_FILE
  if ($envPassword -and $envPasswordFile) {
    Stop-Install 'set only one of ADMIN_PASSWORD or ADMIN_PASSWORD_FILE.'
  }
  if ($envPasswordFile) {
    $path = $envPasswordFile
    if (-not [System.IO.Path]::IsPathRooted($path)) { $path = Join-Path $InvocationDir $path }
    if (-not (Test-Path -LiteralPath $path)) { Stop-Install "ADMIN_PASSWORD_FILE does not exist: $envPasswordFile" }
    return ([System.IO.File]::ReadAllText($path)).TrimEnd("`r", "`n")
  }
  if ($envPassword) { return $envPassword }
  return ''
}

# --------------------------------------------------------------------------- #
# Environment-file helpers
# --------------------------------------------------------------------------- #
function Test-EnvFileComplete([string]$file) {
  if (-not (Test-Path -LiteralPath $file)) { return $false }
  $content = Get-Content -LiteralPath $file -ErrorAction SilentlyContinue
  if (-not $content) { return $false }
  foreach ($key in 'POSTGRES_PASSWORD', 'DATABASE_URL', 'NEXTAUTH_SECRET', 'NEXTAUTH_URL') {
    $found = $content | Where-Object { $_ -match "^\s*$key=.+" } | Select-Object -First 1
    if (-not $found) { return $false }
  }
  return $true
}

function Read-EnvValue([string]$key, [string]$file) {
  if (-not (Test-Path -LiteralPath $file)) { return '' }
  foreach ($line in Get-Content -LiteralPath $file -ErrorAction SilentlyContinue) {
    $trimmed = $line.TrimStart()
    if ($trimmed.StartsWith("$key=")) {
      $raw = $trimmed.Substring($key.Length + 1)
      if ($raw.Length -ge 2) {
        if (($raw.StartsWith("'") -and $raw.EndsWith("'")) -or ($raw.StartsWith('"') -and $raw.EndsWith('"'))) {
          $raw = $raw.Substring(1, $raw.Length - 2)
        }
      }
      return $raw
    }
  }
  return ''
}

# Write .env content as UTF-8 WITHOUT a BOM; a BOM would corrupt the first
# variable when Docker Compose reads the env_file.
function Write-EnvContent([string]$path, [string[]]$lines) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, (($lines -join "`n") + "`n"), $enc)
}

# Set or replace a single unmanaged KEY=VALUE line in the env file, preserving
# everything else. Used for the AFCT_UPDATER_ENABLED toggle.
function Set-EnvFlag([string]$key, [string]$value) {
  if (-not (Test-Path -LiteralPath $EnvFile)) { Stop-Install "$EnvFile not found. Run the installer first." }
  $lines = @(Get-Content -LiteralPath $EnvFile)
  $replaced = $false
  $out = foreach ($line in $lines) {
    if (-not $replaced -and $line -match "^$key=") { $replaced = $true; "$key=$value" }
    else { $line }
  }
  $out = @($out)
  if (-not $replaced) { $out += "$key=$value" }
  $tmp = "$EnvFile.tmp.$PID"
  Write-EnvContent $tmp $out
  Move-Item -LiteralPath $tmp -Destination $EnvFile -Force
  Protect-File $EnvFile
}

function Backup-EnvFile {
  if (-not (Test-Path -LiteralPath $EnvFile)) { return }
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $backup = "$EnvFile.backup.$stamp.$PID"
  Copy-Item -LiteralPath $EnvFile -Destination $backup
  Protect-File $backup
  Write-Info "saved the previous configuration as $backup."
}

function Write-EnvAssignment([string]$key, [string]$value) {
  if (-not (Test-EnvValueSafe $value)) {
    Stop-Install "$key contains characters that cannot be stored safely in $EnvFile (line breaks, quotes, backslashes, tabs, leading or trailing spaces, or a space before '#')."
  }
  return "$key=$value"
}

function Write-EnvironmentFile {
  $managed = @('NODE_ENV', 'POSTGRES_PASSWORD', 'DATABASE_URL', 'ADMIN_EMAIL',
               'ADMIN_PASSWORD', 'NEXTAUTH_SECRET', 'NEXTAUTH_URL', 'AUTH_TRUST_HOST')

  $baseFile = $null
  if (Test-Path -LiteralPath $EnvFile) { $baseFile = $EnvFile }
  elseif (Test-Path -LiteralPath $EnvExample) { $baseFile = $EnvExample }

  # Preserve comments and application-specific settings, but remove every key
  # managed by this installer (and any previous managed block) so each appears
  # exactly once in the final file.
  $kept = @()
  if ($baseFile) {
    $inManagedBlock = $false
    foreach ($line in Get-Content -LiteralPath $baseFile) {
      if ($line -eq '# BEGIN AFCT INSTALLER MANAGED SETTINGS') { $inManagedBlock = $true; continue }
      if ($line -eq '# END AFCT INSTALLER MANAGED SETTINGS') { $inManagedBlock = $false; continue }
      if ($inManagedBlock) { continue }
      $key = ($line.TrimStart() -split '[=:]', 2)[0].TrimEnd()
      if ($managed -contains $key) { continue }
      $kept += $line
    }
  }

  $stamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  $block = @(
    '',
    '# BEGIN AFCT INSTALLER MANAGED SETTINGS',
    "# Managed by AFCT install.ps1 $InstallerVersion",
    "# Updated: $stamp",
    '# Keep this file private. Reconfiguration preserves infrastructure secrets.',
    '# Change an existing administrator password from inside AFCT, not here.',
    (Write-EnvAssignment 'NODE_ENV' 'production'),
    (Write-EnvAssignment 'POSTGRES_PASSWORD' $script:PostgresPasswordIn),
    (Write-EnvAssignment 'DATABASE_URL' $script:DatabaseUrlIn),
    (Write-EnvAssignment 'ADMIN_EMAIL' $script:AdminEmailIn),
    (Write-EnvAssignment 'ADMIN_PASSWORD' $script:AdminPasswordIn),
    (Write-EnvAssignment 'NEXTAUTH_SECRET' $script:NextAuthSecretIn),
    (Write-EnvAssignment 'NEXTAUTH_URL' $script:AppUrlIn),
    (Write-EnvAssignment 'AUTH_TRUST_HOST' 'true'),
    '# END AFCT INSTALLER MANAGED SETTINGS'
  )

  $tmp = "$EnvFile.tmp.$PID"
  Write-EnvContent $tmp ($kept + $block)
  Move-Item -LiteralPath $tmp -Destination $EnvFile -Force
  Protect-File $EnvFile
}

# --------------------------------------------------------------------------- #
# Secret generation (mirrors gen_secret: 48 hex characters)
# --------------------------------------------------------------------------- #
function New-Secret {
  $bytes = New-Object 'System.Byte[]' 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $hex = ([BitConverter]::ToString($bytes)) -replace '-', ''
  return $hex.Substring(0, 48).ToLowerInvariant()
}

# A random core plus one char from each required class. The admin should change
# it at first login, so the fixed policy suffix on a random core is harmless.
function New-AdminPassword { return (New-Secret) + 'Aa1!' }

# --------------------------------------------------------------------------- #
# Prerequisite checks
# --------------------------------------------------------------------------- #
function Test-PortInUse([int]$port) {
  try {
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop | Select-Object -First 1
    return [bool]$conn
  } catch { return $false }
}

function Test-DiskSpace {
  try {
    $free = (Get-Item -LiteralPath $PSScriptRoot).PSDrive.Free
    if ($free -and $free -lt 5GB) {
      Write-WarnMsg "less than approximately 5 GB is free in $PSScriptRoot. Docker images may exhaust the disk."
    }
  } catch {}
}

function Test-ClockSync {
  # Windows analog of the Linux NTP check: the Windows Time service.
  try {
    $svc = Get-Service -Name W32Time -ErrorAction Stop
    if ($svc.Status -ne 'Running') {
      Write-WarnMsg 'the Windows Time service is not running. Incorrect time can break TLS and authentication.'
      return $false
    }
  } catch {}
  return $true
}

function Invoke-Preflight {
  Write-Step 'System checks'

  if (-not (Test-Path -LiteralPath $ComposeFile)) { Stop-Install "$ComposeFile was not found next to this script." }
  if (-not (Test-Path -LiteralPath $EnvExample)) {
    Write-WarnMsg "$EnvExample was not found; the installer will create a minimal production configuration."
  }
  if ($HealthTimeout -lt 1) { Stop-Install 'AFCT_HEALTH_TIMEOUT must be a positive integer.' }
  if ($HealthInterval -lt 1) { Stop-Install 'AFCT_HEALTH_INTERVAL must be a positive integer.' }

  # Docker cannot be auto-installed on Windows the way get.docker.com covers
  # Linux; Resolve-DockerAccess points at Docker Desktop instead.
  Resolve-DockerAccess

  $dockerVersion = (Invoke-NativeCapture { docker version --format '{{.Server.Version}}' } | Select-Object -First 1)
  if ($LASTEXITCODE -ne 0 -or -not $dockerVersion) { $dockerVersion = 'unknown' }
  $composeVersion = (Invoke-NativeCapture { docker compose version --short } | Select-Object -First 1)
  if ($LASTEXITCODE -ne 0 -or -not $composeVersion) { $composeVersion = 'unknown' }
  Write-Success "Docker $dockerVersion is available."
  Write-Success "Docker Compose $composeVersion is available."

  if (-not (Test-EnvFileComplete $EnvFile)) {
    foreach ($port in 80, 443) {
      if (Test-PortInUse $port) {
        Write-WarnMsg "TCP port $port is already in use. The AFCT web service may be unable to bind it."
      }
    }
  }

  Test-DiskSpace
  Test-ClockSync | Out-Null
}

# --------------------------------------------------------------------------- #
# Compose deployment and health checks
# --------------------------------------------------------------------------- #
function Test-ComposeConfig {
  Invoke-Compose config | Out-Null
  if ($LASTEXITCODE -ne 0) { Stop-Install "the Docker Compose configuration is invalid. Review $LogFile." }
}

function Get-Images {
  Write-Info 'downloading AFCT container images...'
  if (-not [Console]::IsOutputRedirected) {
    # On a terminal, let Docker render its own download progress.
    $code = Invoke-ComposeConsole pull
  } else {
    $out = Invoke-Compose pull
    $code = $LASTEXITCODE
    foreach ($line in $out) { Add-LogLine $line }
  }
  if ($code -ne 0) {
    Stop-Install "container images could not be downloaded. Check the network and registry authentication. If the images are private, run 'docker login ghcr.io' and re-run."
  }
  Write-Success 'Container images downloaded.'
}

function Start-Stack {
  Write-Info 'starting the AFCT stack...'
  $out = Invoke-Compose up -d
  $code = $LASTEXITCODE
  foreach ($line in $out) { Add-LogLine $line }
  if ($code -ne 0) { Stop-Install "the AFCT stack could not be started. Review $LogFile." }
}

# Best-effort end-to-end check that nginx serves the app, not just that the
# container reports healthy. Self-signed cert on first boot, so bypass cert
# validation for this one localhost call (restored afterward).
function Test-HttpHealth {
  $prev = [System.Net.ServicePointManager]::ServerCertificateValidationCallback
  [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
  try {
    foreach ($scheme in 'https', 'http') {
      try {
        Invoke-WebRequest -Uri "${scheme}://localhost$HealthPath" -TimeoutSec 10 -UseBasicParsing | Out-Null
        return $true
      } catch {}
    }
    return $false
  } finally {
    [System.Net.ServicePointManager]::ServerCertificateValidationCallback = $prev
  }
}

function Get-AppContainerState {
  $appId = (Invoke-Compose ps -q $AppService | Where-Object { $_ } | Select-Object -First 1)
  if (-not $appId) { return $null }
  $state = (Invoke-NativeCapture {
    docker inspect -f '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' $appId
  } | Select-Object -First 1)
  if ($LASTEXITCODE -ne 0 -or -not $state) { return 'missing|none' }
  return $state
}

function Wait-ForHealth {
  Write-Info 'waiting for the application health check...'
  $elapsed = 0
  while ($elapsed -lt $HealthTimeout) {
    $state = Get-AppContainerState
    if ($state) {
      $containerState, $healthState = $state -split '\|', 2
      if ($containerState -eq 'running' -and $healthState -eq 'healthy') {
        Write-Success 'The AFCT application is healthy.'
        if (Test-HttpHealth) { Write-Success "The web service is responding at $HealthPath." }
        else { Write-WarnMsg 'the container is healthy, but the local web endpoint did not respond yet.' }
        return
      }
      if ($containerState -eq 'running' -and $healthState -eq 'unhealthy') {
        Stop-Install 'the application container reported an unhealthy state.'
      }
      if ($containerState -in 'exited', 'dead') {
        Stop-Install 'the application container stopped before becoming healthy.'
      }
      if ($containerState -eq 'running' -and $healthState -eq 'none') {
        Stop-Install "the $AppService service has no Docker health check configured."
      }
    }
    Start-Sleep -Seconds $HealthInterval
    $elapsed += $HealthInterval
  }
  Stop-Install "the application did not become healthy within $HealthTimeout seconds."
}

function Invoke-DeployStack {
  Test-ComposeConfig
  Get-Images
  Start-Stack
  Wait-ForHealth
}

function Invoke-RestartStack {
  Test-ComposeConfig
  Start-Stack
  Wait-ForHealth
}

# --------------------------------------------------------------------------- #
# Diagnostics
# --------------------------------------------------------------------------- #
function Copy-RedactedEnv([string]$source, [string]$destination) {
  $out = foreach ($line in Get-Content -LiteralPath $source -ErrorAction SilentlyContinue) {
    if ($line -match '^\s*#' -or $line -match '^\s*$') { $line }
    elseif ($line -match '=') {
      $key = ($line -split '=', 2)[0]
      if ($key.Trim().ToUpper() -match 'PASSWORD|SECRET|TOKEN|PRIVATE|CREDENTIAL|DATABASE_URL|API_KEY') { "$key=***REDACTED***" }
      else { $line }
    }
    else { $line }
  }
  Set-Content -LiteralPath $destination -Value $out -Encoding UTF8
}

# Replace the exact values of known secrets anywhere in the bundle (logs can
# echo them, e.g. a DATABASE_URL in a stack trace).
function Hide-ExactSecretsInTree([string]$root) {
  if (-not (Test-Path -LiteralPath $EnvFile)) { return }
  $secrets = @()
  foreach ($key in 'POSTGRES_PASSWORD', 'DATABASE_URL', 'NEXTAUTH_SECRET', 'ADMIN_PASSWORD') {
    $value = Read-EnvValue $key $EnvFile
    if ($value) { $secrets += $value }
  }
  if (-not $secrets) { return }
  foreach ($file in Get-ChildItem -LiteralPath $root -File -Recurse -ErrorAction SilentlyContinue) {
    try {
      $text = [System.IO.File]::ReadAllText($file.FullName)
      foreach ($secret in $secrets) { $text = $text.Replace($secret, '***REDACTED***') }
      [System.IO.File]::WriteAllText($file.FullName, $text)
    } catch {}
  }
}

function Invoke-Diagnostics([string]$reason = 'manual') {
  $script:DiagInProgress = $true
  $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $bundleName = "$DiagPrefix-$timestamp-$PID"
  $work = Join-Path $env:TEMP "$DiagPrefix-work-$PID"
  $bundleDir = Join-Path $work $bundleName
  Remove-Item -Recurse -Force -LiteralPath $work -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $bundleDir -Force | Out-Null

  Write-Info 'collecting AFCT diagnostics...'

  $sysLines = @(
    "AFCT installer version: $InstallerVersion",
    "Collection reason: $reason",
    "Collected: $((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'))",
    '',
    [Environment]::OSVersion.VersionString,
    ($PSVersionTable | Out-String)
  )
  Set-Content -LiteralPath (Join-Path $bundleDir 'system.txt') -Value $sysLines -Encoding UTF8

  if (Resolve-DockerAccessSoft) {
    Invoke-NativeCapture { docker version } | Set-Content (Join-Path $bundleDir 'docker-version.txt')
    Invoke-NativeCapture { docker info } | Set-Content (Join-Path $bundleDir 'docker-info.txt')
    if ($script:ComposeKind -and (Test-Path -LiteralPath $ComposeFile)) {
      Invoke-Compose ps | Set-Content (Join-Path $bundleDir 'compose-ps.txt')
      Invoke-Compose logs --no-color --tail 400 | Set-Content (Join-Path $bundleDir 'compose-logs.txt')
    }
  } else {
    Set-Content -LiteralPath (Join-Path $bundleDir 'docker-unavailable.txt') -Value 'Docker was unavailable or its daemon could not be reached.'
  }

  if (Test-Path -LiteralPath $ComposeFile) { Copy-Item $ComposeFile (Join-Path $bundleDir 'docker-compose.yml') -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath $LogFile) { Copy-Item $LogFile (Join-Path $bundleDir 'install.log') -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath $EnvFile) { Copy-RedactedEnv $EnvFile (Join-Path $bundleDir 'env.redacted.txt') }

  $manifest = @("Installer version: $InstallerVersion", 'Files included:')
  $manifest += Get-ChildItem -LiteralPath $bundleDir -File | ForEach-Object { "  - $($_.Name)" }
  $manifest += ''
  $manifest += 'Known configuration values were redacted by key and by exact value.'
  Set-Content -LiteralPath (Join-Path $bundleDir 'manifest.txt') -Value $manifest -Encoding UTF8

  Hide-ExactSecretsInTree $bundleDir

  $archive = Join-Path $PSScriptRoot "$bundleName.zip"
  try {
    Remove-Item -Force -LiteralPath $archive -ErrorAction SilentlyContinue
    Compress-Archive -Path $bundleDir -DestinationPath $archive
  } catch {
    # The deploy directory may not be writable; fall back to TEMP.
    $archive = Join-Path $env:TEMP "$bundleName.zip"
    Remove-Item -Force -LiteralPath $archive -ErrorAction SilentlyContinue
    Compress-Archive -Path $bundleDir -DestinationPath $archive
  }
  Remove-Item -Recurse -Force -LiteralPath $work -ErrorAction SilentlyContinue

  Write-Success "Diagnostics saved to $archive"
  Write-WarnMsg 'known configuration secrets were redacted, but logs and Compose files can still contain sensitive information. Review the archive before sharing it.'
  $script:DiagInProgress = $false
}

# --------------------------------------------------------------------------- #
# Installation configuration flow
# --------------------------------------------------------------------------- #
function Set-NewInstallConfig {
  Write-Step 'AFCT configuration'

  $defaultUrl = "https://$([System.Net.Dns]::GetHostName())"
  $requestedUrl = $env:APP_URL
  if (-not $requestedUrl) { $requestedUrl = Read-Default 'Public URL' $defaultUrl }
  $script:AppUrlIn = ConvertTo-NormalizedAppUrl $requestedUrl
  if (-not $script:AppUrlIn) {
    Stop-Install 'APP_URL must be a valid http:// or https:// origin without spaces, paths, queries, or fragments.'
  }
  if (-not (Test-EnvValueSafe $script:AppUrlIn)) { Stop-Install 'APP_URL contains unsupported characters.' }
  Write-AppUrlWarnings $script:AppUrlIn

  $script:AdminEmailIn = $env:ADMIN_EMAIL
  if (-not $script:AdminEmailIn) {
    $script:AdminEmailIn = Read-Required 'Administrator email'
    if (-not $script:AdminEmailIn) {
      Stop-Install 'ADMIN_EMAIL is required. Set it as an environment variable or run interactively.'
    }
  }
  if (-not (Test-Email $script:AdminEmailIn)) { Stop-Install "the administrator email does not appear valid: $($script:AdminEmailIn)" }
  if (-not (Test-EnvValueSafe $script:AdminEmailIn)) { Stop-Install 'ADMIN_EMAIL contains unsupported characters.' }

  $providedPassword = Read-PasswordSource
  $passwordGenerated = $false
  $policyMsg = 'the password must be 8-72 characters and include uppercase, lowercase, a number, and a special character.'

  if ($providedPassword) {
    $script:AdminPasswordIn = $providedPassword
  }
  elseif (-not (Test-CanPrompt)) {
    if ($NonInteractive) { Stop-Install 'ADMIN_PASSWORD or ADMIN_PASSWORD_FILE is required in non-interactive mode.' }
    $script:AdminPasswordIn = New-AdminPassword
    $passwordGenerated = $true
  }
  else {
    $choice = Read-Default 'Set the administrator password yourself (t) or generate one (g)?' 'g'
    if ($choice -match '^(g|G|generate)$') {
      $script:AdminPasswordIn = New-AdminPassword
      $passwordGenerated = $true
    } else {
      while ($true) {
        $script:AdminPasswordIn = Read-SecretValue 'Administrator password'
        if (-not (Test-StrongPassword $script:AdminPasswordIn)) { Write-WarnMsg $policyMsg; continue }
        if (-not (Test-EnvValueSafe $script:AdminPasswordIn)) {
          Write-WarnMsg "the password cannot contain line breaks, quotes, backslashes, tabs, leading or trailing spaces, or a space before '#'."
          continue
        }
        $confirmation = Read-SecretValue 'Confirm administrator password'
        if ($script:AdminPasswordIn -eq $confirmation) { break }
        Write-WarnMsg 'the passwords did not match.'
      }
    }
  }

  if (-not (Test-StrongPassword $script:AdminPasswordIn)) { Stop-Install "the administrator $policyMsg" }
  if (-not (Test-EnvValueSafe $script:AdminPasswordIn)) {
    Stop-Install "the administrator password cannot contain line breaks, quotes, backslashes, tabs, leading or trailing spaces, or a space before '#'."
  }

  $script:PostgresPasswordIn = New-Secret
  $script:NextAuthSecretIn = New-Secret
  $script:DatabaseUrlIn = "postgresql://afct_user:$($script:PostgresPasswordIn)@postgres:5432/afct"
  $script:AdminPasswordGenerated = $passwordGenerated
}

function Set-ExistingInstallConfig {
  Write-Step 'Reconfiguration'

  $existingUrl = Read-EnvValue 'NEXTAUTH_URL' $EnvFile
  $existingEmail = Read-EnvValue 'ADMIN_EMAIL' $EnvFile
  $existingPassword = Read-EnvValue 'ADMIN_PASSWORD' $EnvFile

  $defaultUrl = $existingUrl
  if (-not $defaultUrl) { $defaultUrl = "https://$([System.Net.Dns]::GetHostName())" }
  $requestedUrl = $env:APP_URL
  if (-not $requestedUrl) { $requestedUrl = Read-Default 'Public URL' $defaultUrl }
  $script:AppUrlIn = ConvertTo-NormalizedAppUrl $requestedUrl
  if (-not $script:AppUrlIn) {
    Stop-Install 'APP_URL must be a valid http:// or https:// origin without spaces, paths, queries, or fragments.'
  }
  if (-not (Test-EnvValueSafe $script:AppUrlIn)) { Stop-Install 'APP_URL contains unsupported characters.' }
  Write-AppUrlWarnings $script:AppUrlIn

  $script:AdminEmailIn = $env:ADMIN_EMAIL
  if (-not $script:AdminEmailIn) { $script:AdminEmailIn = $existingEmail }
  if (-not $script:AdminEmailIn) { Stop-Install 'ADMIN_EMAIL is missing from the existing configuration.' }
  if (-not (Test-Email $script:AdminEmailIn)) { Stop-Install "the administrator email does not appear valid: $($script:AdminEmailIn)" }

  $providedPassword = Read-PasswordSource
  if ($providedPassword) {
    $script:AdminPasswordIn = $providedPassword
    Write-WarnMsg 'updating ADMIN_PASSWORD only changes the bootstrap setting; it does not change an already-created AFCT account password.'
  } else {
    $script:AdminPasswordIn = $existingPassword
  }
  if (-not $script:AdminPasswordIn) { Stop-Install 'ADMIN_PASSWORD is missing from the existing configuration.' }
  # The saved value only seeds the bootstrap admin on first run; don't block a
  # reconfigure on it - just warn.
  if (-not (Test-StrongPassword $script:AdminPasswordIn)) {
    Write-WarnMsg 'the saved administrator bootstrap password does not meet the current strength policy; keeping it unchanged (it only affects first-run seeding).'
  }
  if (-not (Test-EnvValueSafe $script:AdminPasswordIn)) {
    Stop-Install "the saved administrator password contains characters this installer cannot rewrite safely; edit $EnvFile manually."
  }

  $script:PostgresPasswordIn = Read-EnvValue 'POSTGRES_PASSWORD' $EnvFile
  $script:DatabaseUrlIn = Read-EnvValue 'DATABASE_URL' $EnvFile
  $script:NextAuthSecretIn = Read-EnvValue 'NEXTAUTH_SECRET' $EnvFile
  if (-not $script:PostgresPasswordIn) { Stop-Install "POSTGRES_PASSWORD is missing from $EnvFile." }
  if (-not $script:DatabaseUrlIn) { Stop-Install "DATABASE_URL is missing from $EnvFile." }
  if (-not $script:NextAuthSecretIn) { Stop-Install "NEXTAUTH_SECRET is missing from $EnvFile." }

  if ($env:POSTGRES_PASSWORD -or $env:DATABASE_URL -or $env:NEXTAUTH_SECRET) {
    Write-WarnMsg 'exported infrastructure credentials were ignored during reconfiguration to avoid breaking the existing database or invalidating sessions.'
  }

  $script:AdminPasswordGenerated = $false
}

function Confirm-Configuration {
  Write-Step 'Review'
  Write-Info "Public URL:        $($script:AppUrlIn)"
  Write-Info "Administrator:     $($script:AdminEmailIn)"
  Write-Info "Compose file:      $ComposeFile"
  Write-Info "Environment file:  $EnvFile"
  if ($script:Reconfiguring) { Write-Info 'Database and authentication secrets will be preserved.' }

  if ((Test-CanPrompt) -and -not $Yes) {
    if (-not (Confirm-Action 'Continue with this configuration?' 'y')) { Stop-Install 'installation cancelled.' }
  }
}

# Existing AFCT data volumes but a missing/incomplete config: generating new
# credentials would orphan the database, so route the user to `recover`.
function Test-DataWithoutConfig {
  if ((Test-Path -LiteralPath $EnvFile) -and (Test-EnvFileComplete $EnvFile)) { return $false }
  if (-not (Resolve-DockerAccessSoft)) { return $false }
  if (-not $script:ComposeKind) { return $false }
  $volumes = Invoke-Compose config --volumes
  if ($LASTEXITCODE -ne 0 -or -not $volumes) { return $false }
  $existing = Invoke-NativeCapture { docker volume ls --format '{{.Name}}' }
  foreach ($volume in $volumes) {
    if (-not $volume) { continue }
    $match = $existing | Where-Object { $_ -match "(^|_)$([regex]::Escape($volume))$" } | Select-Object -First 1
    if ($match) { return $true }
  }
  return $false
}

function Show-ExistingInstallMenu {
  Write-Heading 'Existing AFCT installation detected'
  Write-Info '1. Start or repair the installation'
  Write-Info '2. Update to the latest published images'
  Write-Info '3. Reconfigure the public URL or bootstrap settings'
  Write-Info '4. Run system checks'
  Write-Info '5. Create a diagnostics archive'
  Write-Info '6. Exit'
  $choice = Read-Default 'Choose an action' '1'
  switch ($choice) {
    '1' { return }
    ''  { return }
    '2' { Invoke-Update; exit 0 }
    '3' { $script:Reconfiguring = $true; return }
    '4' { $ok = Invoke-Doctor; if ($ok) { exit 0 } else { exit 1 } }
    '5' { Invoke-Diagnostics 'manual'; exit 0 }
    '6' { Write-Info 'no changes were made.'; exit 0 }
    default { Stop-Install "unknown menu choice: $choice" }
  }
}

function Invoke-Install {
  $script:DiagOnExit = $false
  Lock-Installer
  Invoke-Preflight

  if (Test-DataWithoutConfig) {
    Stop-Install "existing AFCT data volumes were detected, but $EnvFile is missing or incomplete. Restore a protected configuration backup with '.\install.ps1 recover' instead of generating new database credentials."
  }

  $script:Reconfiguring = $false
  $existingComplete = (Test-Path -LiteralPath $EnvFile) -and (Test-EnvFileComplete $EnvFile)

  if ($existingComplete -and -not $Reconfigure) {
    if (Test-CanPrompt) {
      Show-ExistingInstallMenu
      if (-not $script:Reconfiguring) {
        Write-Info "using the existing $EnvFile."
        Write-Step 'Deploy'
        $script:DiagOnExit = $true
        Invoke-DeployStack
        Show-Completion
        $script:DiagOnExit = $false
        Invoke-MaybeEnableUpdater
        return
      }
    } else {
      Write-Info "using the existing $EnvFile. Pass -Reconfigure to replace managed settings."
      Write-Step 'Deploy'
      $script:DiagOnExit = $true
      Invoke-DeployStack
      Show-Completion
      $script:DiagOnExit = $false
      Invoke-MaybeEnableUpdater
      return
    }
  } elseif ($existingComplete) {
    $script:Reconfiguring = $true
  } elseif (Test-Path -LiteralPath $EnvFile) {
    Write-WarnMsg "$EnvFile is incomplete and will be rebuilt after a backup is created."
  }

  if ($script:Reconfiguring) { Set-ExistingInstallConfig } else { Set-NewInstallConfig }

  Confirm-Configuration
  Backup-EnvFile
  Write-EnvironmentFile
  Write-Success "Configuration written to $EnvFile."

  Write-Step 'Deploy'
  $script:DiagOnExit = $true
  Invoke-DeployStack
  Show-Completion
  $script:DiagOnExit = $false
  Invoke-MaybeEnableUpdater
}

function Show-Completion {
  Write-Heading 'AFCT Dashboard is ready'
  $url = $script:AppUrlIn
  if (-not $url) { $url = Read-EnvValue 'NEXTAUTH_URL' $EnvFile }
  $email = $script:AdminEmailIn
  if (-not $email) { $email = Read-EnvValue 'ADMIN_EMAIL' $EnvFile }
  Write-Info "Open:          $url"
  Write-Info "Administrator: $email"

  if ($script:AdminPasswordGenerated) {
    Show-Secret ''
    Show-Secret "Generated administrator password: $($script:AdminPasswordIn)"
    Show-Secret 'Save this password now. It is intentionally not written to install.log.'
  }

  Write-Info ''
  Write-Info 'Useful commands:'
  Write-Info '  .\install.ps1 status'
  Write-Info '  .\install.ps1 doctor'
  Write-Info '  .\install.ps1 logs'
  Write-Info '  .\install.ps1 update'
  Write-Info '  .\install.ps1 diagnostics'
  Write-Info ''
  Write-Info 'A self-signed certificate may trigger a browser warning until a trusted certificate is configured.'
  Write-Info "Tip: in Docker Desktop, turn on 'Start Docker Desktop when you log in' so AFCT comes back after a reboot."
}

# --------------------------------------------------------------------------- #
# Update with automatic image rollback
# --------------------------------------------------------------------------- #
function Save-RunningImages {
  $script:UpdateImageSnapshot = @()
  $references = Invoke-Compose config --images
  if ($LASTEXITCODE -ne 0) { $references = @() }
  foreach ($reference in $references) {
    if (-not $reference) { continue }
    $id = (Invoke-NativeCapture { docker image inspect -f '{{.Id}}' $reference } | Select-Object -First 1)
    if ($LASTEXITCODE -eq 0 -and $id) {
      $script:UpdateImageSnapshot += [pscustomobject]@{ Reference = $reference; Id = $id }
    }
  }
  if ($script:UpdateImageSnapshot.Count -gt 0) {
    Write-Info 'recorded the currently deployed image IDs for automatic rollback.'
  } else {
    Write-WarnMsg 'no existing image snapshot could be recorded; automatic rollback may be unavailable.'
  }
}

function Restore-PreviousImages {
  if ($script:UpdateImageSnapshot.Count -eq 0) { return $false }
  Write-WarnMsg 'restoring the previously deployed container images...'
  foreach ($entry in $script:UpdateImageSnapshot) {
    Invoke-NativeCapture { docker image tag $entry.Id $entry.Reference } | Out-Null
    if ($LASTEXITCODE -ne 0) { return $false }
  }
  $out = Invoke-Compose up -d
  if ($LASTEXITCODE -ne 0) { return $false }
  foreach ($line in $out) { Add-LogLine $line }
  try {
    Wait-ForHealth
    Write-Success 'The previous AFCT images were restored successfully.'
    return $true
  } catch { return $false }
}

function Invoke-Update {
  Lock-Installer
  Confirm-ExistingStack
  $script:DiagOnExit = $true
  Write-Info 'updating AFCT to the latest published images...'

  Test-ComposeConfig
  Save-RunningImages
  Get-Images

  $updateOk = $true
  try {
    Start-Stack
    Wait-ForHealth
  } catch { $updateOk = $false }

  if ($updateOk) {
    Write-Success 'AFCT update completed.'
    $script:DiagOnExit = $false
    return
  }

  Write-ErrorMsg 'the newly downloaded AFCT version did not pass its health check.'
  try { Invoke-Diagnostics 'failed-update-before-rollback' } catch {}
  $script:DiagOnExit = $false

  if (Restore-PreviousImages) {
    Write-WarnMsg 'the update failed, but AFCT was returned to the previously deployed images.'
    exit 1
  }
  Stop-Install 'the update failed and automatic rollback was unsuccessful. Review the diagnostics archive.'
}

# --------------------------------------------------------------------------- #
# Operational commands
# --------------------------------------------------------------------------- #
function Confirm-ExistingStack {
  if (-not (Test-Path -LiteralPath $ComposeFile)) { Stop-Install "$ComposeFile was not found next to this script." }
  if (-not (Test-Path -LiteralPath $EnvFile)) { Stop-Install "$EnvFile was not found. Run the installer first." }
  Resolve-DockerAccess
}

function Show-Status {
  Confirm-ExistingStack
  Invoke-Compose ps | ForEach-Object { Write-Host $_ }

  $state = Get-AppContainerState
  if (-not $state) {
    Write-WarnMsg "the $AppService container is not running."
    exit 1
  }
  $containerState, $healthState = $state -split '\|', 2
  Write-Info "application state: $containerState"
  Write-Info "application health: $healthState"
}

function Show-Logs {
  Confirm-ExistingStack
  Write-Info "following $AppService logs; press Ctrl+C to stop..."
  Invoke-ComposeConsole logs -f --tail 200 $AppService | Out-Null
}

function Invoke-Restart {
  Lock-Installer
  Confirm-ExistingStack
  $script:DiagOnExit = $true
  Write-Info 'recreating the AFCT stack...'
  Invoke-RestartStack
  Write-Success 'AFCT restart completed.'
  $script:DiagOnExit = $false
}

function Invoke-Stop {
  Lock-Installer
  Confirm-ExistingStack
  Write-Info 'stopping the AFCT stack...'
  Invoke-Compose stop | ForEach-Object { Write-Host $_ }
  if ($LASTEXITCODE -ne 0) { Stop-Install 'the AFCT stack could not be stopped.' }
  Write-Success 'AFCT stopped. Persistent data volumes were not deleted.'
}

# --------------------------------------------------------------------------- #
# In-app updater sidecar (enable/disable)
# --------------------------------------------------------------------------- #
# Set the flag and pull+start the updater. Returns $false on failure so the
# caller decides whether that is fatal (a standalone enable) or a warning
# (during install, where the rest of the stack is already up).
function Start-Updater {
  Set-EnvFlag 'AFCT_UPDATER_ENABLED' 'true'
  Write-Info 'downloading the updater image...'
  if (-not [Console]::IsOutputRedirected) {
    $code = Invoke-ComposeConsole pull $UpdaterService
  } else {
    $out = Invoke-Compose pull $UpdaterService
    $code = $LASTEXITCODE
    foreach ($line in $out) { Add-LogLine $line }
  }
  if ($code -ne 0) { return $false }

  Write-Info 'starting the updater...'
  $out = Invoke-Compose up -d $UpdaterService
  $code = $LASTEXITCODE
  foreach ($line in $out) { Add-LogLine $line }
  return ($code -eq 0)
}

function Invoke-EnableUpdater {
  Lock-Installer
  Confirm-ExistingStack

  Write-Heading 'Enabling the in-app updater'
  Write-WarnMsg 'the updater container holds the Docker socket, which is root-equivalent on this host. Enable it only if you want to run upgrades and downgrades from Admin -> System Settings.'
  if (-not (Confirm-Action 'Enable the in-app updater now?' 'y')) { Stop-Install 'left the updater disabled.' }

  $script:DiagOnExit = $true
  if (-not (Start-Updater)) {
    Stop-Install "could not pull or start the updater image. If this repository's afct-updater package is private, make it public or run 'docker login ghcr.io'. See $LogFile."
  }
  $script:DiagOnExit = $false
  Write-Success 'in-app updater enabled. Manage versions in Admin -> System Settings -> Updates.'
}

# Offer to enable the updater at the end of a guided install (or honor
# -WithUpdater). Non-fatal: the base stack is already healthy.
function Invoke-MaybeEnableUpdater {
  if ((Read-EnvValue 'AFCT_UPDATER_ENABLED' $EnvFile) -eq 'true') { return }

  if (-not $WithUpdater) {
    if (-not (Test-CanPrompt)) { return }
    Write-Heading 'Optional: in-app updater'
    Write-Info 'The updater sidecar lets admins upgrade and downgrade AFCT from'
    Write-Info 'System Settings. It holds the Docker socket (root-equivalent on this host),'
    Write-Info 'so it is off unless you turn it on.'
    if (-not (Confirm-Action 'Enable the in-app updater now?' 'n')) {
      Write-Info 'skipped. Enable it later with: .\install.ps1 enable-updater'
      return
    }
  }

  if (Start-Updater) {
    Write-Success 'in-app updater enabled.'
  } else {
    Set-EnvFlag 'AFCT_UPDATER_ENABLED' 'false'
    Write-WarnMsg 'could not start the updater (the afct-updater image may be private or unpublished). The rest of AFCT is running; enable it later with: .\install.ps1 enable-updater'
  }
}

function Invoke-DisableUpdater {
  Lock-Installer
  Confirm-ExistingStack
  Write-Info 'disabling the in-app updater...'
  # The profile must be active for compose to see the service, so remove it
  # before clearing the flag.
  Invoke-Compose rm -sf $UpdaterService | Out-Null
  Set-EnvFlag 'AFCT_UPDATER_ENABLED' 'false'
  Write-Success 'in-app updater disabled and its container removed.'
}

# --------------------------------------------------------------------------- #
# Doctor, recover, version
# --------------------------------------------------------------------------- #
function Invoke-Doctor {
  Write-Heading 'AFCT system check'
  $ok = 0
  $warnings = 0

  $check = {
    param([string]$label, [bool]$passed)
    if ($passed) { Write-Success $label; return $true }
    Write-WarnMsg $label
    return $false
  }

  if (& $check 'Compose file exists' (Test-Path -LiteralPath $ComposeFile)) { $ok++ } else { $warnings++ }
  if (& $check 'Environment file exists' (Test-Path -LiteralPath $EnvFile)) { $ok++ } else { $warnings++ }
  if (& $check 'Environment configuration is complete' (Test-EnvFileComplete $EnvFile)) { $ok++ } else { $warnings++ }

  $free = $null
  try { $free = (Get-Item -LiteralPath $PSScriptRoot).PSDrive.Free } catch {}
  $diskOk = (-not $free) -or ($free -ge 5GB)
  if (& $check 'At least 5 GB of disk space is available' $diskOk) { $ok++ } else { $warnings++ }

  if (& $check 'Windows Time service is running' (Test-ClockSync)) { $ok++ } else { $warnings++ }

  if (Resolve-DockerAccessSoft) {
    Write-Success 'Docker daemon is reachable'
    $ok++
    Invoke-Compose config | Out-Null
    if (& $check 'Docker Compose configuration is valid' ($LASTEXITCODE -eq 0)) { $ok++ } else { $warnings++ }
    $state = Get-AppContainerState
    $healthy = $false
    if ($state) { $healthy = ($state -split '\|', 2)[1] -eq 'healthy' }
    if (& $check 'Application container is healthy' $healthy) { $ok++ } else { $warnings++ }
    if (& $check 'Local AFCT health endpoint responds' (Test-HttpHealth)) { $ok++ } else { $warnings++ }
    Show-Versions
  } else {
    Write-WarnMsg 'Docker or Docker Compose is unavailable.'
    $warnings++
  }

  Write-Info ''
  Write-Info "Doctor result: $ok checks passed; $warnings warnings or failures."
  return ($warnings -eq 0)
}

function Invoke-Recover {
  Lock-Installer
  if (Test-Path -LiteralPath $EnvFile) {
    Stop-Install "$EnvFile already exists. Recovery is intended for a missing configuration."
  }
  $backups = Get-ChildItem -Path "$EnvFile.backup.*" -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
  if (-not $backups) { Stop-Install "no protected $EnvFile.backup.* files were found." }
  $latest = $backups | Select-Object -First 1
  Write-Info "newest configuration backup: $($latest.Name)"
  if ((Test-CanPrompt) -and -not $Yes) {
    if (-not (Confirm-Action 'Restore this configuration backup?' 'y')) { Stop-Install 'recovery cancelled.' }
  }
  Copy-Item -LiteralPath $latest.FullName -Destination $EnvFile
  Protect-File $EnvFile
  if (-not (Test-EnvFileComplete $EnvFile)) { Stop-Install 'the restored environment file is incomplete.' }
  Write-Success "Configuration restored from $($latest.Name)."
  Write-Info 'Run: .\install.ps1 doctor'
  Write-Info 'Then run: .\install.ps1 restart'
}

function Show-Versions {
  Write-Info "installer version: $InstallerVersion"
  if (-not (Resolve-DockerAccessSoft)) { return }
  if (-not $script:ComposeKind) { return }
  if (-not (Test-Path -LiteralPath $ComposeFile)) { return }
  $appId = (Invoke-Compose ps -q $AppService | Where-Object { $_ } | Select-Object -First 1)
  if (-not $appId) { return }
  $image = (Invoke-NativeCapture { docker inspect -f '{{.Config.Image}}' $appId } | Select-Object -First 1)
  if ($LASTEXITCODE -eq 0 -and $image) { Write-Info "application image: $image" }
  $imageId = (Invoke-NativeCapture { docker inspect -f '{{.Image}}' $appId } | Select-Object -First 1)
  if ($LASTEXITCODE -eq 0 -and $imageId) { Write-Info "application image ID: $imageId" }
}

function Show-Usage {
  Write-Host @'
AFCT Dashboard installer (Windows)

Usage:
  .\install.ps1 [command] [options]

Commands:
  install       Run the guided installer. This is the default command.
  status        Show container and application health status.
  logs          Follow application logs. Press Ctrl+C to stop.
  update        Pull the latest images, recreate the stack, and verify health.
  restart       Recreate the stack without pulling new images.
  stop          Stop the stack without deleting its data volumes.
  enable-updater  Enable the in-app updater sidecar (in-app upgrades/downgrades).
                  It holds the Docker socket, so it is off by default.
  disable-updater Stop and remove the updater sidecar.
  doctor        Run a comprehensive, read-only system check.
  recover       Restore the newest protected .env.production backup.
  diagnostics   Create a support archive with known secrets redacted.
  version       Show installer and deployed application version information.
  help          Show this help.

Options:
  -Yes (-y)
      Accept confirmation prompts using their default answers. Missing values
      such as the administrator email are still requested interactively.

  -NonInteractive
      Never prompt. Required values must be supplied through environment
      variables or password files. Docker Desktop must already be installed.

  -Reconfigure
      Rebuild .env.production even when a complete configuration already exists.
      Infrastructure credentials are preserved; this does not rotate the active
      PostgreSQL password or change an existing administrator account password.

  -WithUpdater
      During install, also enable the in-app updater sidecar (in-app upgrades and
      downgrades). It holds the Docker socket, so it is otherwise off by default.
      Equivalent to running enable-updater afterward.

  -NoColor
      Disable colored terminal output.

Environment variables:
  APP_URL                 Public URL, such as https://afct.example.edu
  ADMIN_EMAIL             Initial administrator email
  ADMIN_PASSWORD          Initial administrator password
  ADMIN_PASSWORD_FILE     File containing the initial administrator password

Advanced overrides:
  AFCT_COMPOSE_FILE       Compose file name
  AFCT_ENV_FILE           Production environment file name
  AFCT_ENV_EXAMPLE        Environment template file name
  AFCT_LOG_FILE           Installer log file name
  AFCT_APP_SERVICE        Compose service name for the application (default: app)
  AFCT_HEALTH_PATH        HTTP health endpoint (default: /api/health)
  AFCT_HEALTH_TIMEOUT     Health timeout in seconds (default: 300)
  AFCT_HEALTH_INTERVAL    Health polling interval in seconds (default: 5)

If PowerShell blocks the script, run it once as:
  powershell -ExecutionPolicy Bypass -File .\install.ps1
'@
}

# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #
$exitCode = 0
try {
  if ($Help -or $Command -in @('help', '-h', '--help')) {
    Show-Usage
  }
  elseif ($Command -eq 'version') {
    Show-Versions
  }
  elseif ($Command -eq 'doctor') {
    if (-not (Invoke-Doctor)) { $exitCode = 1 }
  }
  elseif ($Command -eq 'recover') {
    Initialize-Log
    Invoke-Recover
  }
  elseif ($Command -eq 'diagnostics') {
    Invoke-Diagnostics 'manual'
  }
  elseif ($Command -eq 'status') {
    Show-Status
  }
  elseif ($Command -eq 'logs') {
    Show-Logs
  }
  elseif ($Command -eq 'update') {
    Initialize-Log
    Invoke-Update
  }
  elseif ($Command -eq 'restart') {
    Initialize-Log
    Invoke-Restart
  }
  elseif ($Command -eq 'stop') {
    Initialize-Log
    Invoke-Stop
  }
  elseif ($Command -eq 'enable-updater') {
    Initialize-Log
    Invoke-EnableUpdater
  }
  elseif ($Command -eq 'disable-updater') {
    Initialize-Log
    Invoke-DisableUpdater
  }
  elseif ($Command -eq 'install') {
    Initialize-Log
    Invoke-Install
  }
  else {
    Write-Host "[afct] ERROR: unknown option or command: $Command"
    Write-Host '[afct] Run: .\install.ps1 -Help'
    $exitCode = 2
  }
}
catch {
  $message = "$_"
  if ($message -notlike 'afct-fatal:*') { Write-ErrorMsg "operation failed: $message" }
  if ($script:DiagOnExit -and -not $script:DiagInProgress) {
    Write-ErrorMsg 'creating a support archive...'
    try { Invoke-Diagnostics 'automatic' } catch {}
  }
  $exitCode = 1
}
finally {
  Unlock-Installer
}
exit $exitCode
