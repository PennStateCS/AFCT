# Docker.ps1 - Docker Desktop access + Compose helpers for the AFCT Windows controller.
#
# Dot-sourced by afctctl.ps1. Functions only. Reads controller script-scope variables
# ($RuntimeCompose, $EnvFile, $ComposeProject). Windows PowerShell 5.1 compatible.
#
# Docker Desktop runs the daemon for the current user, so there is no sudo/elevation dance
# and no legacy docker-compose fallback: AFCT requires `docker compose` v2.

Set-StrictMode -Version Latest

# True when the docker CLI exists and the daemon answers (Docker Desktop running). Never
# throws; used by read-only/soft paths such as uninstall and diagnostics.
function Test-AfctDockerReady {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { return $false }
    try { & docker info *> $null; return ($LASTEXITCODE -eq 0) } catch { return $false }
}

# Resolve the Compose project name (keeps data volumes attached). Persisted in deploy.state
# during install/migration; defaults to 'afct' until then.
function Get-AfctComposeProject {
    $state = Join-Path $SharedDir 'deploy.state'
    if (Test-Path -LiteralPath $state) {
        $m = Select-String -LiteralPath $state -Pattern '^PROJECT_NAME=(.+)$' | Select-Object -First 1
        if ($null -ne $m) { return $m.Matches.Groups[1].Value.Trim() }
    }
    return 'afct'
}

# Emit ('--profile','updater') when the in-app updater sidecar is enabled, so every compose
# action (pull/up/ps/config/stop/down) includes it. Read from the env file, defaulting off.
function Get-AfctUpdaterProfileArgs {
    if ((Read-AfctEnvValue 'AFCT_UPDATER_ENABLED' $EnvFile) -eq 'true') { return @('--profile', 'updater') }
    return @()
}

# The common `docker compose` prefix: project, updater profile, runtime compose file, and
# the production env file when present.
function Get-AfctComposeBaseArgs {
    $base = @('compose', '-p', (Get-AfctComposeProject)) + (Get-AfctUpdaterProfileArgs) + @('-f', $RuntimeCompose)
    if (Test-Path -LiteralPath $EnvFile) { $base += @('--env-file', $EnvFile) }
    return $base
}

# Invoke `docker compose` and return its combined output as strings. $LASTEXITCODE holds the
# child exit code afterward. Never throws on a nonzero compose exit.
function Invoke-AfctCompose {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
    $eap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & docker @(Get-AfctComposeBaseArgs) @Args 2>&1 | ForEach-Object { "$_" } }
    finally { $ErrorActionPreference = $eap }
}

# Same, but let output flow to the console so docker can draw its own progress bars. Returns
# the child exit code.
function Invoke-AfctComposeConsole {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
    $eap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & docker @(Get-AfctComposeBaseArgs) @Args | Out-Host } finally { $ErrorActionPreference = $eap }
    return $LASTEXITCODE
}

# Fatal Docker Desktop preflight: the CLI must exist, the daemon must answer, and Compose v2
# must be present. Throws afct-fatal with an actionable message otherwise.
function Assert-AfctDockerReady {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw 'afct-fatal: Docker Desktop is not installed. Install it: https://docs.docker.com/desktop/install/windows-install/'
    }
    & docker info *> $null
    if ($LASTEXITCODE -ne 0) {
        throw 'afct-fatal: Docker is installed, but its daemon is not reachable. Start Docker Desktop and try again.'
    }
    & docker compose version *> $null
    if ($LASTEXITCODE -ne 0) {
        throw 'afct-fatal: Docker Compose v2 was not found. Update Docker Desktop (it includes Compose).'
    }
}

# Free bytes on the volume backing Docker's image store. Under Docker Desktop the images
# live in a WSL2 virtual disk beneath %LOCALAPPDATA%, usually the system drive and not
# necessarily the drive AFCT sits on, so take the smallest plausible location. Returns $null
# when nothing can be measured (callers treat that as "unknown", not "full").
function Get-AfctDockerFreeBytes {
    $candidates = @()
    foreach ($path in @($env:LOCALAPPDATA, $env:SystemDrive, $SharedDir)) {
        if ([string]::IsNullOrWhiteSpace($path)) { continue }
        try {
            $drive = (Get-Item -LiteralPath $path -ErrorAction Stop).PSDrive
            if ($drive -and $drive.Free) { $candidates += [int64]$drive.Free }
        } catch { }
    }
    if ($candidates.Count -eq 0) { return $null }
    return ($candidates | Measure-Object -Minimum).Minimum
}

# Warn (install-time) when free space is below the generous install threshold.
function Test-AfctInstallDiskSpace {
    $min = [int64]([Environment]::GetEnvironmentVariable('AFCT_INSTALL_MIN_FREE_GB'))
    if ($min -le 0) { $min = 15 }
    $free = Get-AfctDockerFreeBytes
    if ($free -and $free -lt ($min * 1GB)) {
        Write-AfctWarn ("less than approximately {0:N0} GB is free. The AFCT images need roughly that much to download and unpack." -f $min)
    }
}

# Hard gate before an update pulls new images: the app image alone is ~4.7 GB and Docker
# needs the compressed download and the unpacked layers at once. Throws afct-fatal when
# space is short, while the running version is still untouched. Unknown free space does not
# block.
function Assert-AfctUpdateDiskSpace {
    $min = [int64]([Environment]::GetEnvironmentVariable('AFCT_UPDATE_MIN_FREE_GB'))
    if ($min -le 0) { $min = 12 }
    $free = Get-AfctDockerFreeBytes
    if (-not $free) { return }
    if ($free -lt ($min * 1GB)) {
        throw ("afct-fatal: only {0:N1} GB is free, but about {1:N0} GB is needed to download the new images. Reclaim space (for example: docker image prune -a -f) and re-run." -f ($free / 1GB), $min)
    }
}

# True when a TCP port is already being listened on. Never throws.
function Test-AfctPortInUse {
    param([int]$Port)
    try {
        $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1
        return [bool]$conn
    } catch { return $false }
}

# The Windows analog of the Linux NTP check: the Windows Time service should be running.
# Returns $true only when the service exists and is running; $false when it is stopped,
# missing, or cannot be queried at all. This is a diagnostic/warning signal, never an
# installation blocker.
function Test-AfctClockSync {
    try {
        $svc = Get-Service -Name W32Time -ErrorAction Stop
        return ($svc.Status -eq 'Running')
    } catch {
        return $false
    }
}
