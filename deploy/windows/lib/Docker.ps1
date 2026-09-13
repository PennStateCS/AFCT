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
    # Bounded, because `docker info` against a half-started or wedged Docker Desktop does not
    # answer at all. This is called from uninstall and diagnostics, which run precisely when
    # something is already wrong, so a daemon that never replies has to read as "not ready"
    # rather than as a place to wait forever.
    try {
        $r = Invoke-AfctDockerBounded info
        return ((-not $r.TimedOut) -and $r.ExitCode -eq 0)
    } catch { return $false }
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

# NEVER pass a literal -d or -v to these helpers. Use --detach and --volumes.
#
# This is what made a Windows install hang for hours. `Invoke-AfctCompose up -d` looks like
# it runs `docker compose up -d`, and it does not: the `[Parameter()]` attribute below makes
# this an advanced function, which gives it PowerShell's common parameters, and a literal
# `-d` is an unambiguous prefix of `-Debug`. PowerShell binds it there and it never reaches
# docker. The command that actually ran was `docker compose up`, attached, which starts every
# container and then streams their logs until interrupted. Docker Desktop showed the whole
# stack running while the installer sat on one line forever, because from Compose's point of
# view it was doing exactly what it was told.
#
# `-v` goes the same way, to `-Verbose`, which is how `down -v` in the uninstall path quietly
# stopped removing the volumes it was asked to remove.
#
# Only literal tokens bind: a flag built into a variable is passed through. That is why this
# survived review and testing and only showed up on a real machine. Short flags that collide
# with no common parameter (-q, -f, -sf, -p) are safe, but the long form is the rule here so
# nobody has to remember which ones those are.
#
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

# --------------------------------------------------------------------------- #
# Bounded compose invocation
# --------------------------------------------------------------------------- #
# Starting the stack had no upper bound of any kind. The documented AFCT_HEALTH_TIMEOUT
# governs the health wait, which does not begin until the CLI returns, so a CLI that never
# returns is waited on forever.
#
# The swallowed `-d` above is what made that happen in practice, and it is fixed. This exists
# because "the CLI came back" should not have been taken on trust in the first place: an
# installer that can wait forever will eventually wait forever for some other reason, and an
# instructor watching a frozen window has no way to tell the difference. A deadline means the
# caller always gets an answer, and capturing the child's streams to files keeps this
# process's pipeline out of the path of Compose's progress renderer as well.

# How long any single Docker inspection may take before it is assumed wedged. Short, because
# every command bounded by it answers in well under a second on a working daemon; the only
# thing this number changes is how long a broken one can hold the installer.
function Get-AfctDockerCommandTimeout {
    $v = [int]([Environment]::GetEnvironmentVariable('AFCT_DOCKER_COMMAND_TIMEOUT'))
    if ($v -le 0) { $v = 20 }
    return $v
}

# Run a native command with its output captured to files and a hard deadline.
#
# Returns @{ ExitCode; TimedOut; StdOut; StdErr; Seconds }. Never throws: the caller decides
# what a nonzero code or a timeout means. On a timeout the whole process tree is killed and
# ExitCode is $null.
#
# -OnHeartbeat is called with the elapsed seconds roughly every -HeartbeatSeconds while the
# wait runs long, so a caller can keep the terminal alive without this function knowing
# anything about what it is running.
function Invoke-AfctNativeBounded {
    param(
        [string]$FilePath,
        [string[]]$ArgumentList,
        [int]$TimeoutSeconds,
        [scriptblock]$OnHeartbeat,
        [int]$HeartbeatSeconds = 30
    )
    $stamp = [Guid]::NewGuid().ToString('N')
    $outFile = Join-Path ([IO.Path]::GetTempPath()) "afct-native-$stamp.out"
    $errFile = Join-Path ([IO.Path]::GetTempPath()) "afct-native-$stamp.err"
    $started = Get-Date
    try {
        # Quote here rather than handing Start-Process the array. -ArgumentList joins an
        # array with spaces and quotes nothing, so the compose file path alone breaks the
        # command for anybody whose profile directory has a space in it ("C:\Users\Jane
        # Doe\..."), which is most people with a two-word name.
        $proc = Start-Process -FilePath $FilePath -ArgumentList (ConvertTo-AfctCommandLine $ArgumentList) `
            -NoNewWindow -PassThru `
            -RedirectStandardOutput $outFile -RedirectStandardError $errFile
        # Touch the handle. Start-Process -PassThru hands back a Process object that has not
        # cached the native handle, and without it .ExitCode reads as $null even after a
        # clean exit; every successful startup would then look like a failed one. Reading
        # .Handle once is what caches it.
        $null = $proc.Handle

        # Waited in slices rather than one long block, purely so a heartbeat can fire. The
        # deadline is unchanged: the slices add up to exactly $TimeoutSeconds.
        $slice = $HeartbeatSeconds
        if ($slice -le 0 -or $slice -gt $TimeoutSeconds) { $slice = $TimeoutSeconds }
        $waited = 0
        $exited = $false
        while ($waited -lt $TimeoutSeconds) {
            $chunk = [Math]::Min($slice, $TimeoutSeconds - $waited)
            if ($proc.WaitForExit($chunk * 1000)) { $exited = $true; break }
            $waited += $chunk
            if ($OnHeartbeat -and $waited -lt $TimeoutSeconds) { & $OnHeartbeat $waited }
        }

        if (-not $exited) {
            Stop-AfctProcessTree $proc.Id
            # Give the kill a moment to land so the output files are closed before they are
            # read; a failure to reap is not worth failing the install over.
            try { $proc.WaitForExit(5000) | Out-Null } catch { }
            return @{
                ExitCode = $null
                TimedOut = $true
                StdOut   = (Read-AfctTextFile $outFile)
                StdErr   = (Read-AfctTextFile $errFile)
                Seconds  = [int]((Get-Date) - $started).TotalSeconds
            }
        }
        # The parameterless wait after a timed one, as .NET asks, so the child is fully
        # reaped and ExitCode is populated rather than null.
        $proc.WaitForExit()
        return @{
            ExitCode = $proc.ExitCode
            TimedOut = $false
            StdOut   = (Read-AfctTextFile $outFile)
            StdErr   = (Read-AfctTextFile $errFile)
            Seconds  = [int]((Get-Date) - $started).TotalSeconds
        }
    } finally {
        Remove-Item -LiteralPath $outFile, $errFile -Force -ErrorAction SilentlyContinue
    }
}

# A plain `docker ...` call with a short deadline. For inspection: reading state, versions,
# and anything collected while something has already gone wrong. A wedged daemon answers
# none of these, and an installer that hangs while reporting a hang is worse than useless.
function Invoke-AfctDockerBounded {
    param(
        [int]$TimeoutSeconds = 0,
        [Parameter(Position = 0, ValueFromRemainingArguments = $true)][string[]]$DockerArgs
    )
    if ($TimeoutSeconds -le 0) { $TimeoutSeconds = Get-AfctDockerCommandTimeout }
    return Invoke-AfctNativeBounded -FilePath 'docker' -ArgumentList $DockerArgs -TimeoutSeconds $TimeoutSeconds
}

# A `docker compose ...` call with a deadline, carrying this deployment's project, profile,
# compose file and env file.
function Invoke-AfctComposeBounded {
    param(
        [int]$TimeoutSeconds,
        [scriptblock]$OnHeartbeat,
        # Named ComposeArgs, not Args: $Args is an automatic variable, and a parameter that
        # shadows it reads back unreliably (notably inside a test double).
        #
        # Position 0 on this one, so the compose verb is the only thing that binds
        # positionally. Without it `Invoke-AfctComposeBounded -TimeoutSeconds 30 up --detach`
        # hands "up" to whichever scalar parameter happens to come next in the declaration,
        # which is the same class of silent misbinding as the -d that started all this.
        [Parameter(Position = 0, ValueFromRemainingArguments = $true)][string[]]$ComposeArgs
    )
    Set-AfctRuntimeComposeEnv

    # Deterministic, non-interactive output for this one call. Compose reads both from the
    # environment, and a version that does not know them ignores them, so no capability
    # detection is needed. Scoped to this call: the image pull deliberately keeps Docker's
    # interactive progress, which works well and is the one place a long wait is explained.
    $savedAnsi = [Environment]::GetEnvironmentVariable('COMPOSE_ANSI')
    $savedProgress = [Environment]::GetEnvironmentVariable('COMPOSE_PROGRESS')
    $env:COMPOSE_ANSI = 'never'
    $env:COMPOSE_PROGRESS = 'plain'
    try {
        $all = @(Get-AfctComposeBaseArgs) + @($ComposeArgs)
        return Invoke-AfctNativeBounded -FilePath 'docker' -ArgumentList $all `
            -TimeoutSeconds $TimeoutSeconds -OnHeartbeat $OnHeartbeat
    } finally {
        if ($null -eq $savedAnsi) { Remove-Item Env:\COMPOSE_ANSI -ErrorAction SilentlyContinue }
        else { $env:COMPOSE_ANSI = $savedAnsi }
        if ($null -eq $savedProgress) { Remove-Item Env:\COMPOSE_PROGRESS -ErrorAction SilentlyContinue }
        else { $env:COMPOSE_PROGRESS = $savedProgress }
    }
}

# Build a Windows command line from an argument list.
#
# Anything containing whitespace or a quote is wrapped, and the backslash-before-quote rule
# CommandLineToArgvW uses is honoured, so a path ending in a backslash does not escape the
# closing quote. Without this, an install prefix with a space in it produces a command line
# docker reads as extra arguments.
function ConvertTo-AfctCommandLine {
    param([string[]]$Arguments)
    $parts = @()
    foreach ($arg in $Arguments) {
        if ($null -eq $arg) { continue }
        if ($arg.Length -gt 0 -and $arg -notmatch '[\s"]') { $parts += $arg; continue }
        $escaped = $arg -replace '(\\*)"', '$1$1\"'
        $escaped = $escaped -replace '(\\+)$', '$1$1'
        $parts += '"' + $escaped + '"'
    }
    return ($parts -join ' ')
}

# Read a captured stream as an array of lines. Missing or unreadable is an empty array, not
# an error: this only ever runs while reporting something that already went wrong.
function Read-AfctTextFile {
    param([string]$Path)
    try {
        if (-not (Test-Path -LiteralPath $Path)) { return @() }
        return @(Get-Content -LiteralPath $Path -ErrorAction Stop)
    } catch { return @() }
}

# Kill a stuck CLI and everything it started.
#
# The tree, not the process: `docker compose` runs the Compose binary as a child, so killing
# docker.exe alone leaves that child behind still holding the same job. `taskkill /T` is the
# Windows way to take the whole tree.
#
# This ends a *client* process. Containers belong to the Docker daemon and keep running
# exactly as they were; nothing here stops, removes or recreates anything, and no volume is
# touched. That is the entire reason a watchdog is safe to have: the worst case is that AFCT
# stops watching a job the daemon has already finished.
function Stop-AfctProcessTree {
    param([int]$ProcessId)
    try { & taskkill /PID $ProcessId /T /F *> $null } catch { }
}

# Does the installed Compose understand `up --wait`?
#
# Recorded rather than used. `up -d --wait` blocks until Compose decides the stack is up,
# which would put the whole startup back behind one opaque call and take away the staged
# progress an installer needs to not look frozen; and `--wait-timeout` bounds Compose's
# waiting, not a process that has stopped making progress, which is the failure actually
# seen. The bound comes from the watchdog above instead. Knowing whether the option exists
# is still worth having in the deployment trace.
function Test-AfctComposeSupportsWait {
    $eap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $out = & docker compose up --help 2>&1 | ForEach-Object { "$_" } }
    finally { $ErrorActionPreference = $eap }
    foreach ($line in @($out)) { if ($line -match '--wait\b') { return $true } }
    return $false
}

# Fatal Docker Desktop preflight: the CLI must exist, the daemon must answer, and Compose v2
# must be present. Throws afct-fatal with an actionable message otherwise.
function Assert-AfctDockerReady {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw 'afct-fatal: Docker Desktop is not installed. Install it: https://docs.docker.com/desktop/install/windows-install/'
    }
    # Both bounded: a preflight that hangs is the same outcome for the operator as a failed
    # one, except that nothing tells them so.
    $info = Invoke-AfctDockerBounded info
    if ($info.TimedOut) {
        throw 'afct-fatal: Docker Desktop did not respond. It may still be starting up, or it may need to be restarted. Wait for the Docker Desktop window to say it is running, then try again.'
    }
    if ($info.ExitCode -ne 0) {
        throw 'afct-fatal: Docker is installed, but its daemon is not reachable. Start Docker Desktop and try again.'
    }
    $cv = Invoke-AfctDockerBounded compose version
    if ($cv.TimedOut -or $cv.ExitCode -ne 0) {
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
