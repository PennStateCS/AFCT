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

# The runtime Compose file interpolates these three so each service's env_file and the
# updater's bind mounts resolve to the shared install locations, not to paths relative to the
# runtime compose directory. The Unix controller sets the same three in compose_project();
# Windows must too, or the app/nginx/backup env_file falls back to `.env.production` next to
# the compose file (shared\runtime\) instead of the real one in shared\, and compose config
# fails with "env file ... not found". Forward slashes so Docker Desktop reads the paths cleanly.
function Set-AfctRuntimeComposeEnv {
    $env:AFCT_RUNTIME_ENV_FILE = ($EnvFile -replace '\\', '/')
    $env:AFCT_RUNTIME_COMPOSE_DIR = ((Split-Path -Parent $RuntimeCompose) -replace '\\', '/')
    $env:AFCT_RUNTIME_SHARED_DIR = ((Split-Path -Parent $EnvFile) -replace '\\', '/')
}

# Invoke `docker compose` and return its combined output as strings. $LASTEXITCODE holds the
# child exit code afterward. Never throws on a nonzero compose exit.
function Invoke-AfctCompose {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
    Set-AfctRuntimeComposeEnv
    $eap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & docker @(Get-AfctComposeBaseArgs) @Args 2>&1 | ForEach-Object { "$_" } }
    finally { $ErrorActionPreference = $eap }
}

# Same, but let output flow to the console so docker can draw its own progress bars. Returns
# the child exit code.
function Invoke-AfctComposeConsole {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
    Set-AfctRuntimeComposeEnv
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

# --------------------------------------------------------------------------- #
# Docker Desktop bind-mount preflight
# --------------------------------------------------------------------------- #
# Docker Desktop can only bind-mount host paths on its file-sharing list. The default prefix
# under %LOCALAPPDATA% is local and shared, but a custom prefix may sit on a network drive, a
# removable drive, or an otherwise unshared path, and would fail with a confusing mount error
# at `up` time. This preflight catches that before the stack starts. The four docker steps
# below are separate seams so tests can mock them without a real daemon.

# The tiny image used only to test path access. Overridable so a locked-down environment can
# point at a mirror or an already-present image.
function Get-AfctBindCheckImage {
    $v = [Environment]::GetEnvironmentVariable('AFCT_BIND_CHECK_IMAGE')
    if ([string]::IsNullOrEmpty($v)) { return 'alpine:3.20' }
    return $v
}

# True when the image is already present locally (no pull needed).
function Test-AfctDockerImagePresent {
    param([string]$Image)
    # `docker image inspect` exits non-zero and writes to stderr when the image is
    # absent -- the routine "not present, pull it" case. Under the caller's
    # ErrorActionPreference='Stop', PowerShell 5.1 turns that native stderr into a
    # terminating NativeCommandError, which would crash the check instead of returning
    # false. Soften it locally, exactly as the compose wrappers above do, and read the
    # child exit code afterward.
    $eap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & docker image inspect $Image *> $null } finally { $ErrorActionPreference = $eap }
    return ($LASTEXITCODE -eq 0)
}

# Pull the bind-check image. Docker's (noisy, non-secret) output goes to the install log when
# one is configured and is otherwise discarded, so the terminal stays readable. Returns the
# child exit code.
function Invoke-AfctDockerPull {
    param([string]$Image)
    # A failed pull writes to stderr and exits non-zero; soften ErrorActionPreference so
    # that surfaces as a return code the caller can report, not a terminating error.
    $eap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        if (-not [string]::IsNullOrEmpty($LogFile)) {
            & docker pull $Image *>> $LogFile
        } else {
            & docker pull $Image *> $null
        }
    } finally { $ErrorActionPreference = $eap }
    return $LASTEXITCODE
}

# True when Docker Desktop can bind-mount $Dir read-only. Mounts the directory and checks it
# is visible inside the container.
function Test-AfctDockerBindMount {
    param([string]$Image, [string]$Dir)
    # A blocked mount makes `docker run` exit non-zero with stderr; soften
    # ErrorActionPreference so the check returns false instead of throwing.
    $eap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & docker run --rm -v "${Dir}:/afct-bind-check:ro" $Image test -d /afct-bind-check *> $null }
    finally { $ErrorActionPreference = $eap }
    return ($LASTEXITCODE -eq 0)
}

# Heuristic: a UNC path or a non-fixed (network/removable) drive is a soft warning, because
# Docker Desktop mounts of such paths are unreliable. Never throws.
function Test-AfctPathIsNetworkish {
    param([string]$Path)
    if ([string]::IsNullOrEmpty($Path)) { return $false }
    if ($Path.StartsWith('\\')) { return $true }
    try {
        $root = [System.IO.Path]::GetPathRoot($Path)
        if ([string]::IsNullOrEmpty($root)) { return $false }
        $di = New-Object System.IO.DriveInfo($root)
        return ($di.DriveType -ne [System.IO.DriveType]::Fixed)
    } catch { return $false }
}

# Verify Docker Desktop can bind-mount each required host directory before the stack starts.
# Skipped when AFCT_SKIP_BIND_MOUNT_CHECK=1 (used by test mocks). A pull failure is a
# network/registry problem and is reported as such, never as a file-sharing problem; a mount
# failure names the exact directory and points at the fix.
function Assert-AfctBindMounts {
    param([string[]]$Directories)
    if ([Environment]::GetEnvironmentVariable('AFCT_SKIP_BIND_MOUNT_CHECK') -eq '1') { return }
    $img = Get-AfctBindCheckImage

    # Step 1: make the tiny test image available. A pull failure is network/registry, NOT
    # file sharing, so it gets its own message and never mentions file sharing.
    if (-not (Test-AfctDockerImagePresent $img)) {
        Write-AfctInfo "downloading the small image used to test Docker Desktop path access ($img)..."
        if ((Invoke-AfctDockerPull $img) -ne 0) {
            throw "afct-fatal: Docker Desktop could not download the small image used for the path-access test ($img). Check your network connection and Docker registry access, then rerun the installer."
        }
    }

    # Step 2: the image is present. Now verify each directory can be mounted. A failure here
    # IS a file-sharing problem.
    foreach ($dir in $Directories) {
        if ([string]::IsNullOrEmpty($dir) -or -not (Test-Path -LiteralPath $dir)) { continue }
        if (Test-AfctPathIsNetworkish $dir) {
            Write-AfctWarn "the installation directory is on a network or removable drive ($dir). Docker Desktop may not mount it reliably; a local path such as $(Join-Path $env:LOCALAPPDATA 'AFCT') is recommended."
        }
        if (-not (Test-AfctDockerBindMount -Image $img -Dir $dir)) {
            $rec = Join-Path $env:LOCALAPPDATA 'AFCT'
            throw ("afct-fatal: Docker Desktop could not mount the installation directory: $dir. " +
                "Docker Desktop can only bind-mount host paths on its file-sharing list; the current drive or path may not be available to it, and network or removable drives may not work reliably. " +
                "Fix this by adding the directory under Docker Desktop > Settings > Resources > File sharing, or reinstall using the default prefix ($rec), which is local and already shared.")
        }
    }
}
