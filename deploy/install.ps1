#Requires -Version 5.1
<#
AFCT Dashboard - Windows installer (Docker Desktop).

Usage:
  .\install.ps1               Run the guided install (default).
  .\install.ps1 diagnostics   Collect a redacted support zip and exit.
  .\install.ps1 -Help

Non-interactive install (advanced): set the values as environment variables and
pass -Yes, e.g.
  $env:ADMIN_EMAIL='admin@x.edu'; $env:ADMIN_PASSWORD='...'; $env:APP_URL='https://afct.x.edu'
  .\install.ps1 -Yes

Needs Docker Desktop (with the Compose plugin) plus this folder's
docker-compose.yml and .env.production.example.

If PowerShell blocks the script, run it once as:
  powershell -ExecutionPolicy Bypass -File .\install.ps1
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)][string]$Command = 'install',
  [switch]$Yes,
  [switch]$Help
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$ComposeFile = 'docker-compose.yml'
$EnvFile     = '.env.production'
$EnvExample  = '.env.production.example'
$LogFile     = 'install.log'

# --------------------------------------------------------------------------- #
# Output helpers (teed to the install log)
# --------------------------------------------------------------------------- #
function Write-Log([string]$m) {
  $line = "[afct] $m"
  Write-Host $line
  Add-Content -LiteralPath $LogFile -Value $line
}
function Write-WarnLog([string]$m) {
  $line = "[afct] WARNING: $m"
  Write-Host $line -ForegroundColor Yellow
  Add-Content -LiteralPath $LogFile -Value $line
}
function Stop-WithError([string]$m) { Write-WarnLog $m; throw $m }

# --------------------------------------------------------------------------- #
# Secret generation (cryptographically random, alphanumeric)
# --------------------------------------------------------------------------- #
function New-Secret([int]$Length = 40) {
  $bytes = New-Object 'System.Byte[]' 48
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $s = ([Convert]::ToBase64String($bytes)) -replace '[^A-Za-z0-9]', ''
  if ($s.Length -lt $Length) { $s } else { $s.Substring(0, $Length) }
}

# Password policy, mirroring src/lib/password-policy.ts and the production seed:
# 8-72 chars with an upper, a lower, a digit, and a special (non-alphanumeric)
# char. (-cmatch is case-sensitive; plain -match is not.)
function Test-StrongPassword([string]$pw) {
  return ($pw.Length -ge 8 -and $pw.Length -le 72 -and
          $pw -cmatch '[A-Z]' -and $pw -cmatch '[a-z]' -and
          $pw -match '[0-9]' -and $pw -match '[^A-Za-z0-9]')
}

# Generate an admin password that satisfies Test-StrongPassword: a random
# alphanumeric core (New-Secret strips punctuation) plus one char from each
# required class. The admin must change it at first login, so the fixed policy
# suffix on a random core is harmless.
function New-AdminPassword { (New-Secret) + 'Aa1_' }

# Warn (never block) if the public URL will cause auth problems: a non-https URL
# or a bare IP produces NEXTAUTH_URL mismatches and silent login redirect loops.
function Test-AppUrl([string]$url) {
  if ($url -notmatch '^https://') {
    Write-WarnLog "the public URL should start with https:// (got '$url'); http or a bare IP causes login redirect loops."
    return
  }
  $h = (($url -replace '^https://', '') -split '/')[0]
  $h = ($h -split ':')[0]
  if ($h -match '^[0-9]+(\.[0-9]+){3}$') {
    Write-WarnLog "the public URL uses a bare IP ('$h'); a real hostname with a matching TLS certificate is recommended."
  }
}

# --------------------------------------------------------------------------- #
# Prompt helpers
# --------------------------------------------------------------------------- #
function Read-Default([string]$q, [string]$d) {
  if ($Yes) { return $d }
  $a = Read-Host "$q [$d]"
  if ([string]::IsNullOrWhiteSpace($a)) { $d } else { $a }
}
function Read-Required([string]$q) {
  while ($true) {
    $a = Read-Host $q
    if (-not [string]::IsNullOrWhiteSpace($a)) { return $a }
    Write-WarnLog 'a value is required.'
  }
}
function Read-Secret([string]$q) {
  $sec = Read-Host $q -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

# Write .env as UTF-8 WITHOUT a BOM; a BOM would corrupt the first variable when
# Docker Compose reads the env_file.
function Write-EnvFile([string[]]$lines) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  $path = Join-Path $PSScriptRoot $EnvFile
  [System.IO.File]::WriteAllText($path, (($lines -join "`n") + "`n"), $enc)
  # Best-effort: restrict the file to the current user.
  try { icacls $EnvFile /inheritance:r /grant:r "$($env:USERNAME):F" *> $null } catch {}
}

# --------------------------------------------------------------------------- #
# Diagnostics: a redacted support bundle the user can send to the maintainer.
# --------------------------------------------------------------------------- #
function Get-Diagnostics {
  $ts = Get-Date -Format 'yyyyMMdd-HHmmss'
  $work = "afct-diagnostics-$ts"
  $dir = Join-Path $PSScriptRoot $work
  Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $dir | Out-Null

  Write-Log "collecting diagnostics into $work ..."

  "$([Environment]::OSVersion.VersionString)`n`n$($PSVersionTable | Out-String)" |
    Set-Content -LiteralPath (Join-Path $dir 'system.txt')
  (docker version 2>&1)                                   | Set-Content (Join-Path $dir 'docker-version.txt')
  (docker info 2>&1)                                      | Set-Content (Join-Path $dir 'docker-info.txt')
  (docker compose -f $ComposeFile ps 2>&1)               | Set-Content (Join-Path $dir 'compose-ps.txt')
  (docker compose -f $ComposeFile logs --no-color --tail 400 2>&1) | Set-Content (Join-Path $dir 'compose-logs.txt')
  if (Test-Path $ComposeFile) { Copy-Item $ComposeFile (Join-Path $dir 'docker-compose.yml') }
  if (Test-Path $LogFile)     { Copy-Item $LogFile     (Join-Path $dir 'install.log') }

  # Redacted env: keep keys, mask any value whose key looks secret.
  if (Test-Path $EnvFile) {
    Get-Content $EnvFile | ForEach-Object {
      if ($_ -match '^\s*#' -or $_ -match '^\s*$') { $_ }
      elseif ($_ -match '=') {
        $key = ($_ -split '=', 2)[0]
        if ($key.ToUpper() -match 'PASSWORD|SECRET|KEY|TOKEN|DATABASE_URL') { "$key=***REDACTED***" } else { $_ }
      }
      else { $_ }
    } | Set-Content (Join-Path $dir 'env.redacted.txt')
  }

  $zip = Join-Path $PSScriptRoot "$work.zip"
  Remove-Item -Force $zip -ErrorAction SilentlyContinue
  Compress-Archive -Path $dir -DestinationPath $zip
  Remove-Item -Recurse -Force $dir

  Write-Log ''
  Write-Log "Diagnostics saved to: $zip"
  Write-Log 'Secret values were redacted. Send this file to your administrator for help.'
}

# --------------------------------------------------------------------------- #
# Preflight
# --------------------------------------------------------------------------- #
function Test-Prereqs {
  Write-Log 'checking prerequisites...'

  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Stop-WithError 'Docker is not installed. Install Docker Desktop: https://docs.docker.com/desktop/install/windows-install/'
  }
  docker info *> $null
  if ($LASTEXITCODE -ne 0) { Stop-WithError 'Docker is installed but not running. Start Docker Desktop and re-run.' }

  docker compose version *> $null
  if ($LASTEXITCODE -ne 0) { Stop-WithError 'Docker Compose not found. Update Docker Desktop (it includes Compose).' }

  # Best-effort disk check: the container images total a few GB.
  try {
    $free = (Get-Item -LiteralPath $PSScriptRoot).PSDrive.Free
    if ($free -and $free -lt 5GB) { Write-WarnLog 'less than ~5 GB free on this drive; the images need a few GB.' }
  } catch {}

  Write-Log 'prerequisites OK.'
}

# Best-effort end-to-end check that nginx serves the app, not just that the
# container reports healthy. Self-signed cert on first boot, so bypass cert
# validation for this one localhost call (restored afterward).
function Invoke-SmokeTest {
  try {
    $prev = [System.Net.ServicePointManager]::ServerCertificateValidationCallback
    [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
    try {
      Invoke-WebRequest -Uri 'https://localhost/api/health' -TimeoutSec 10 -UseBasicParsing | Out-Null
      Write-Log 'web front is responding at /api/health.'
    }
    catch {
      Write-WarnLog "the app is healthy but the web front didn't answer /api/health yet; nginx may still be warming up."
    }
    finally {
      [System.Net.ServicePointManager]::ServerCertificateValidationCallback = $prev
    }
  }
  catch {}
}

# --------------------------------------------------------------------------- #
# Bring the stack up
# --------------------------------------------------------------------------- #
function Start-Stack {
  Write-Log 'pulling images (first run can take a few minutes)...'
  # Capture without a pipe so $LASTEXITCODE reflects docker, not a downstream cmdlet.
  $pullOut = docker compose -f $ComposeFile pull 2>&1
  $pullOut | ForEach-Object { Write-Log $_ }
  if (($pullOut | Out-String) -match 'unauthorized|denied|authentication required|forbidden') {
    Write-WarnLog "some images could not be pulled. If they are private, run 'docker login ghcr.io' and re-run."
  }

  Write-Log 'starting the stack...'
  $upOut = docker compose -f $ComposeFile up -d 2>&1
  $upCode = $LASTEXITCODE
  $upOut | ForEach-Object { Write-Log $_ }
  if ($upCode -ne 0) { Stop-WithError 'the stack failed to start. Run: .\install.ps1 diagnostics' }

  Write-Log 'waiting for the app to become healthy...'
  for ($i = 0; $i -lt 60; $i++) {
    $state = (docker inspect -f '{{ .State.Health.Status }}' afct-app 2>$null)
    if ($state -eq 'healthy') { Write-Log 'app is healthy.'; Invoke-SmokeTest; return }
    if ($state -eq 'unhealthy') { Stop-WithError 'app reported unhealthy; run: .\install.ps1 diagnostics' }
    Start-Sleep -Seconds 5
  }
  Write-WarnLog 'app did not report healthy within ~5 min; it may still be migrating. Check: docker compose logs -f app'
}

# --------------------------------------------------------------------------- #
# Install
# --------------------------------------------------------------------------- #
function Invoke-Install {
  if (-not (Test-Path $ComposeFile)) { Stop-WithError 'docker-compose.yml not found next to this script.' }
  if (-not (Test-Path $EnvExample))  { Stop-WithError "$EnvExample not found next to this script." }

  Test-Prereqs

  if (Test-Path $EnvFile) {
    $keep = Read-Default "Existing $EnvFile found. Keep it (k) or reconfigure (r)?" 'k'
    if ($keep -notmatch '^(r|R)') { Write-Log "keeping existing $EnvFile."; Start-Stack; return }
  }

  Write-Log ''
  Write-Log "Let's configure your AFCT Dashboard."

  $defaultUrl = "https://$([System.Net.Dns]::GetHostName())"
  if ($env:APP_URL) { $appUrl = $env:APP_URL } else { $appUrl = Read-Default 'Public URL (how people reach the site)' $defaultUrl }
  Test-AppUrl $appUrl

  if ($env:ADMIN_EMAIL) { $adminEmail = $env:ADMIN_EMAIL }
  elseif ($Yes) { Stop-WithError 'ADMIN_EMAIL is required in -Yes (non-interactive) mode.' }
  else { $adminEmail = Read-Required 'Administrator email' }
  if ($adminEmail -notmatch '.+@.+\..+') { Write-WarnLog "administrator email '$adminEmail' doesn't look like an email address." }

  # Enforce the app's password policy so a weak value can't fail the first-run seed.
  $pwPolicyMsg = 'password must be 8-72 characters with an upper, a lower, a number, and a special character.'
  $genPass = $false
  if ($env:ADMIN_PASSWORD) {
    $adminPass = $env:ADMIN_PASSWORD
    if (-not (Test-StrongPassword $adminPass)) { Stop-WithError "ADMIN_PASSWORD is too weak: $pwPolicyMsg" }
  }
  elseif ($Yes) {
    $adminPass = New-AdminPassword; $genPass = $true
  }
  else {
    $choice = Read-Default 'Set the admin password yourself (t) or auto-generate one (g)?' 't'
    if ($choice -match '^(g|G)') { $adminPass = New-AdminPassword; $genPass = $true }
    else {
      while ($true) {
        $adminPass = Read-Secret 'Administrator password'
        if (Test-StrongPassword $adminPass) { break }
        Write-WarnLog $pwPolicyMsg
      }
    }
  }

  # Auto-generated infrastructure secrets, never prompted.
  $pgPass = New-Secret
  $authSecret = New-Secret

  Write-Log "writing $EnvFile ..."
  $stamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  $lines = @(
    "# Generated by install.ps1 on $stamp.",
    '# Keep this file secret. Regenerate by re-running the installer with (r).',
    '',
    'NODE_ENV=production',
    '',
    '# --- Database (auto-generated) ---',
    "POSTGRES_PASSWORD=$pgPass",
    "DATABASE_URL=postgresql://afct_user:$pgPass@postgres:5432/afct",
    '',
    '# --- Initial admin (seeded on first run) ---',
    "ADMIN_EMAIL=$adminEmail",
    "ADMIN_PASSWORD=$adminPass",
    '',
    '# --- Auth (auto-generated) ---',
    "NEXTAUTH_SECRET=$authSecret",
    "NEXTAUTH_URL=$appUrl",
    'AUTH_TRUST_HOST=true'
  )
  Write-EnvFile $lines

  Start-Stack

  Write-Log ''
  Write-Log '==================================================================='
  Write-Log ' AFCT Dashboard is starting.'
  Write-Log "   URL:        $appUrl"
  Write-Log "   Admin user: $adminEmail"
  if ($genPass) { Write-Log "   Admin pass: $adminPass   <-- save this now; it won't be shown again" }
  Write-Log ''
  Write-Log ' The site uses a self-signed certificate at first, so your browser will warn'
  Write-Log ' you. Install a real certificate later in Admin -> System Settings.'
  Write-Log ''
  Write-Log " Tip: in Docker Desktop, turn on 'Start Docker Desktop when you log in' so the"
  Write-Log ' app comes back automatically after a reboot.'
  Write-Log '==================================================================='
}

# --------------------------------------------------------------------------- #
# Entry
# --------------------------------------------------------------------------- #
if ($Help -or $Command -in @('-h', '--help', 'help')) {
  Get-Content -LiteralPath $PSCommandPath | Select-Object -Skip 1 -First 22 | ForEach-Object { $_ -replace '^#', '' }
  return
}

switch ($Command) {
  'diagnostics' { Get-Diagnostics }
  default {
    try { Invoke-Install }
    catch {
      Write-WarnLog "install failed: $_"
      try { Get-Diagnostics } catch {}
      exit 1
    }
  }
}
