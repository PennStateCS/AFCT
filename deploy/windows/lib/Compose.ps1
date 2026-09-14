# Compose.ps1 - runtime Compose seeding and the deploy/health primitives for the AFCT
# Windows controller.
#
# Dot-sourced by afctctl.ps1. Depends on Output.ps1, Docker.ps1. Reads controller globals
# ($ComposeTemplate, $RuntimeCompose, $RuntimeDir, $EnvFile, $AppService, $HealthPath,
# $HealthTimeout, $HealthInterval). Windows PowerShell 5.1 compatible.
#
# The active release ships an immutable Compose template; the runtime Compose file under
# shared\runtime is what actually runs. Seeding copies the template into runtime so a new
# release's Compose changes apply, keeping a .bak of the previous runtime file.

Set-StrictMode -Version Latest

# Copy the active release's Compose template into the mutable runtime location. Creates the
# runtime directory on first use; backs up an existing, differing runtime file first so a
# release's Compose changes apply without silently discarding the prior file.
#
# Returns $true when the runtime file actually changed, which the caller needs: a release
# that changes mounts, environment, health checks, security options or networking writes a
# new file here while the containers keep running the old definition, and a rerun that
# skipped `up` because everything looked healthy would leave the deployment permanently
# behind its own configuration.
function Sync-AfctRuntimeCompose {
    if (-not (Test-Path -LiteralPath $ComposeTemplate)) {
        throw "afct-fatal: the release Compose template is missing at $ComposeTemplate."
    }
    if (-not (Test-Path -LiteralPath $RuntimeDir)) {
        New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null
    }
    if (Test-Path -LiteralPath $RuntimeCompose) {
        $a = (Get-FileHash -LiteralPath $ComposeTemplate -Algorithm SHA256).Hash
        $b = (Get-FileHash -LiteralPath $RuntimeCompose -Algorithm SHA256).Hash
        if ($a -eq $b) { return $false }
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        Copy-Item -LiteralPath $RuntimeCompose -Destination "$RuntimeCompose.bak.$stamp" -Force -ErrorAction SilentlyContinue
        Write-AfctInfo "the runtime Compose file changed with this release; saved the previous one as docker-compose.yml.bak.$stamp."
    }
    Copy-Item -LiteralPath $ComposeTemplate -Destination $RuntimeCompose -Force
    return $true
}

function Test-AfctComposeConfig {
    # Capture the output so a failure reports the actual reason (e.g. a missing env file)
    # instead of a bare "invalid configuration" the operator cannot act on. Bounded because
    # this is the first Docker call of a deployment: a hang here is a hang before anything
    # has even been attempted.
    $r = Invoke-AfctComposeBounded -TimeoutSeconds (Get-AfctDockerCommandTimeout) config
    if ($r.TimedOut) {
        throw 'afct-fatal: Docker did not respond while validating the configuration. Make sure Docker Desktop has finished starting, then try again.'
    }
    if ($r.ExitCode -ne 0) {
        $detail = (@($r.StdErr) + @($r.StdOut) | Where-Object { $_ -and $_.Trim() } | Select-Object -Last 3) -join ' '
        if ($detail) { throw "afct-fatal: the Docker Compose configuration is invalid: $detail" }
        throw 'afct-fatal: the Docker Compose configuration is invalid.'
    }
}

# Download the images the deployment needs.
#
# The required services are pulled by name rather than as "everything in the project", and
# the optional updater is pulled separately afterwards. With the updater enabled, every
# compose call carries `--profile updater`, so a plain `pull` included the updater image and
# an unavailable one failed the whole download: the base installation could not proceed
# because an optional, experimental sidecar's image was missing or private. That is the
# wrong failure, and it happened before anything had started.
#
# Bounded, like every other long Docker call here. This is the step that takes longest by
# far (the application image alone is about 4.7 GB), which is exactly why an unbounded one
# would have moved the original hang rather than fixed it: the window would have sat on
# "downloading AFCT container images..." instead of "starting the AFCT stack...". The
# allowance is correspondingly generous, thirty minutes by default.
#
# It costs Docker's own progress bars, so the heartbeat reads the last line out of the
# capture and prints it: not a bar, but a real answer to "is it still doing something", and
# a number the operator can watch move.
function Get-AfctImages {
    Write-AfctInfo 'downloading AFCT container images...'
    $required = @(Get-AfctExpectedServices | Where-Object { $_.Required } | ForEach-Object { $_.Name })

    $heartbeat = {
        param($elapsed, $outPath, $errPath)
        $line = Get-AfctLastProgressLine $outPath $errPath
        $minutes = [int]($elapsed / 60)
        $for = "${elapsed}s"
        if ($minutes -ge 1) { $for = "${minutes}m" }
        if ($line) { Write-AfctInfo "still downloading after ${for}: $line" }
        else { Write-AfctInfo "still downloading after ${for}..." }
    }

    $result = Invoke-AfctComposeBounded -TimeoutSeconds (Get-AfctDockerPullTimeout) `
        -OnHeartbeat $heartbeat -ComposeArgs (@('pull') + $required)

    if ($result.TimedOut) {
        throw "afct-fatal: the container images were still downloading after $([int]((Get-AfctDockerPullTimeout) / 60)) minutes and the download was stopped. Check the network connection, then run the installer again; anything already downloaded is kept."
    }
    if ($result.ExitCode -ne 0) {
        Show-AfctComposeFailure $result
        throw "afct-fatal: container images could not be downloaded. Check the network and registry authentication. If the images are private, run 'docker login ghcr.io' and re-run."
    }
    Write-AfctSuccess 'Container images downloaded.'

    # Optional, and reported rather than fatal: AFCT is fully installable without it.
    foreach ($name in @(Get-AfctExpectedServices | Where-Object { -not $_.Required } | ForEach-Object { $_.Name })) {
        $opt = Invoke-AfctComposeBounded -TimeoutSeconds (Get-AfctDockerPullTimeout) `
            -OnHeartbeat $heartbeat -ComposeArgs @('pull', $name)
        if ($opt.TimedOut -or $opt.ExitCode -ne 0) {
            Write-AfctWarn "the optional $name image could not be downloaded. AFCT itself is unaffected; the sidecar will not start until the image is available."
        }
    }
}

# The most recent line of real content from a captured pull, trimmed to fit a terminal.
# Compose writes plain per-layer progress here (COMPOSE_PROGRESS=plain is set around the
# call), so the last line is genuinely the current state. Never throws: this only ever runs
# to decorate a progress message.
function Get-AfctLastProgressLine {
    param([string]$OutPath, [string]$ErrPath)
    foreach ($path in @($ErrPath, $OutPath)) {
        try {
            if (-not $path -or -not (Test-Path -LiteralPath $path)) { continue }
            $line = (Get-Content -LiteralPath $path -Tail 1 -ErrorAction Stop |
                     Where-Object { $_ -and $_.Trim() } | Select-Object -Last 1)
            if ($line) {
                $text = $line.Trim()
                if ($text.Length -gt 90) { $text = $text.Substring(0, 90) + '...' }
                return $text
            }
        } catch { }
    }
    return ''
}

# --------------------------------------------------------------------------- #
# What the stack is expected to look like
# --------------------------------------------------------------------------- #
# One table, used by the startup progress, the rerun decision, and doctor, so those three
# cannot disagree about what "AFCT is up" means.
#
# `RequiresHealth` is the important column. Four of the five services define a Docker health
# check and the fifth, the worker, does not: it is a queue consumer with nothing sensible to
# probe. Calling a worker "unhealthy" because Docker reports no health at all would fail a
# perfectly good install, so for that one service running IS ready. Getting this wrong in
# either direction is how a stack gets reported ready when it is not.
function Get-AfctExpectedServices {
    $services = @(
        [pscustomobject]@{ Name = 'postgres';  Label = 'PostgreSQL';       RequiresHealth = $true;  Versioned = $false; Required = $true },
        [pscustomobject]@{ Name = $AppService; Label = 'AFCT application'; RequiresHealth = $true;  Versioned = $true;  Required = $true },
        [pscustomobject]@{ Name = 'worker';    Label = 'Worker';           RequiresHealth = $false; Versioned = $true;  Required = $true },
        [pscustomobject]@{ Name = 'nginx';     Label = 'nginx';            RequiresHealth = $true;  Versioned = $true;  Required = $true },
        [pscustomobject]@{ Name = 'db-backup'; Label = 'Backup service';   RequiresHealth = $true;  Versioned = $true;  Required = $true }
    )
    # The updater is optional and off by default, so it is expected only when the operator
    # has turned it on. Without this row, a deployment whose env file says the updater is
    # enabled reads as complete while its container is missing, and the enable path then
    # declines to fix it because the flag already says true.
    #
    # Expected, but NOT required. The updater is optional and experimental on Windows, and
    # the policy everywhere else already treats it that way: a sidecar that will not start
    # earns a warning, never a failed installation.
    if ((Read-AfctEnvValue 'AFCT_UPDATER_ENABLED' $EnvFile) -eq 'true') {
        $services += [pscustomobject]@{ Name = $UpdaterService; Label = 'In-app updater'
                                        RequiresHealth = $true; Versioned = $true; Required = $false }
    }
    return $services
}

# The tag part of an image reference, or '' when it carries none.
function Get-AfctImageTag {
    param([string]$Image)
    if ([string]::IsNullOrWhiteSpace($Image)) { return '' }
    $ref = $Image
    $at = $ref.IndexOf('@')
    if ($at -ge 0) { $ref = $ref.Substring(0, $at) }
    $colon = $ref.LastIndexOf(':')
    if ($colon -lt 0) { return '' }
    $slash = $ref.LastIndexOf('/')
    if ($colon -lt $slash) { return '' }
    return $ref.Substring($colon + 1)
}

# Read one service's container state as "<status>|<health>|<image>".
function Get-AfctServiceState {
    param([string]$Service, [AllowNull()][Nullable[DateTime]]$Deadline)

    $bound = Get-AfctCallTimeout $Deadline
    if ($bound -le 0) { return 'missing|none|' }

    $ps = Invoke-AfctComposeBounded -TimeoutSeconds $bound ps -q $Service
    if ($ps.TimedOut -or $ps.ExitCode -ne 0) { return 'missing|none|' }
    $id = (@($ps.StdOut) | Where-Object { $_ -and $_.Trim() } | Select-Object -First 1)
    if (-not $id) { return 'missing|none|' }

    $bound = Get-AfctCallTimeout $Deadline
    if ($bound -le 0) { return 'missing|none|' }
    $inspect = Invoke-AfctDockerBounded -TimeoutSeconds $bound inspect -f '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.Config.Image}}' $id.Trim()
    if ($inspect.TimedOut -or $inspect.ExitCode -ne 0) { return 'missing|none|' }
    $state = (@($inspect.StdOut) | Where-Object { $_ -and $_.Trim() } | Select-Object -First 1)
    if (-not $state) { return 'missing|none|' }
    return $state.Trim()
}

function Get-AfctAppContainerState {
    param([AllowNull()][Nullable[DateTime]]$Deadline)
    $parts = (Get-AfctServiceState -Service $AppService -Deadline $Deadline) -split '\|', 3
    if ($parts[0] -eq 'missing') { return $null }
    return "$($parts[0])|$($parts[1])"
}

function Test-AfctServiceReady {
    param([string]$State, [bool]$RequiresHealth)
    $parts = $State -split '\|', 3
    if ($parts[0] -ne 'running') { return $false }
    if (-not $RequiresHealth) { return $true }
    return ($parts[1] -eq 'healthy')
}

# --------------------------------------------------------------------------- #
# Deadlines
# --------------------------------------------------------------------------- #
function Get-AfctRemainingSeconds {
    param([AllowNull()][Nullable[DateTime]]$Deadline)
    if ($null -eq $Deadline) { return [int]::MaxValue }
    $left = ($Deadline - (Get-Date)).TotalSeconds
    if ($left -gt [int]::MaxValue) { return [int]::MaxValue }
    return [int][Math]::Floor($left)
}

function Get-AfctCallTimeout {
    param([AllowNull()][Nullable[DateTime]]$Deadline)
    $normal = Get-AfctDockerCommandTimeout
    if ($null -eq $Deadline) { return $normal }
    $left = Get-AfctRemainingSeconds $Deadline
    if ($left -le 0) { return 0 }
    if ($left -ge $normal) { return $normal }
    if ($left -lt 1) { return 1 }
    return $left
}

# Short, bounded grace period used only after the Compose CLI itself times out.
# This is not a second startup timeout. It exists solely to answer the original Windows
# failure mode: did the containers finish starting even though the CLI never returned?
function Get-AfctStartupRecoveryTimeout {
    $v = [int]([Environment]::GetEnvironmentVariable('AFCT_STARTUP_RECOVERY_TIMEOUT'))
    if ($v -le 0) { $v = 10 }
    return $v
}

# A single reading of the whole deployment: every expected service, whether each is ready,
# and whether the application answers over HTTP at the tag this install is pinned to.
function Get-AfctStackState {
    param([switch]$SkipHttp, [AllowNull()][Nullable[DateTime]]$Deadline)

    $wantTag = Get-AfctEffectiveAppTag

    $services = @()
    $allReady = $true
    $allMatch = $true
    $optionalWarnings = @()
    foreach ($svc in Get-AfctExpectedServices) {
        $state = Get-AfctServiceState -Service $svc.Name -Deadline $Deadline
        $parts = $state -split '\|', 3
        $ready = Test-AfctServiceReady -State $state -RequiresHealth $svc.RequiresHealth

        $actualTag = Get-AfctImageTag $parts[2]
        $matches = $true
        if ($svc.Versioned -and $parts[0] -ne 'missing' -and $actualTag) {
            $matches = ($actualTag -ceq $wantTag)
        }
        if ($svc.Required) {
            if (-not $ready) { $allReady = $false }
            if (-not $matches) { $allMatch = $false }
        } else {
            if (-not $ready) { $optionalWarnings += "$($svc.Label) is not running" }
            elseif (-not $matches) { $optionalWarnings += "$($svc.Label) is on $actualTag; expected $wantTag" }
        }

        $services += [pscustomobject]@{
            Name             = $svc.Name
            Label            = $svc.Label
            Status           = $parts[0]
            Health           = $parts[1]
            Image            = $parts[2]
            Ready            = $ready
            Required         = $svc.Required
            Versioned        = $svc.Versioned
            ExpectedImageTag = $(if ($svc.Versioned) { $wantTag } else { '' })
            ActualImageTag   = $actualTag
            ImageMatches     = $matches
        }
    }
    $app = $services | Where-Object { $_.Name -eq $AppService } | Select-Object -First 1
    $httpOk = $false
    if (-not $SkipHttp) { $httpOk = (Test-AfctHttpHealth -Deadline $Deadline) }

    return [pscustomobject]@{
        Services         = $services
        AllReady         = $allReady
        AppReady         = ($null -ne $app -and $app.Ready)
        HttpOk           = $httpOk
        ExpectedTag      = $wantTag
        ImageMatches     = $allMatch
        OptionalWarnings = $optionalWarnings
    }
}

function Get-AfctStaleServices {
    param($State, [switch]$RequiredOnly)
    $rows = @($State.Services | Where-Object { $_.Versioned -and -not $_.ImageMatches })
    if ($RequiredOnly) { $rows = @($rows | Where-Object { $_.Required }) }
    return $rows
}

function Format-AfctStaleServices {
    param($State)
    $parts = @()
    foreach ($svc in (Get-AfctStaleServices -State $State -RequiredOnly)) {
        $parts += "$($svc.Label) is running on $($svc.ActualImageTag); expected $($svc.ExpectedImageTag)"
    }
    return ($parts -join '; ')
}

function Format-AfctStackState {
    param($State)
    $parts = @()
    foreach ($svc in $State.Services) {
        $text = "$($svc.Name): $($svc.Status)"
        if ($svc.Health -and $svc.Health -ne 'none') { $text += " ($($svc.Health))" }
        $parts += $text
    }
    return ($parts -join ', ')
}

# --------------------------------------------------------------------------- #
# Starting the stack
# --------------------------------------------------------------------------- #

# Bring the required stack up. The structured result tells the caller whether the normal
# health phase still needs to run, or whether the post-timeout recovery check already proved
# the core stack ready end-to-end.
function Start-AfctStack {
    param([int]$TimeoutSeconds = 0)
    if ($TimeoutSeconds -le 0) { $TimeoutSeconds = $HealthTimeout }

    Write-AfctInfo 'Starting AFCT containers...'
    Write-AfctTrace "compose up --detach starting (deadline ${TimeoutSeconds}s)"

    $heartbeat = {
        param($elapsed)
        Write-AfctInfo "Docker Compose is still starting containers after ${elapsed}s..."
    }

    $required = @(Get-AfctExpectedServices | Where-Object { $_.Required } | ForEach-Object { $_.Name })
    $result = Invoke-AfctComposeBounded -TimeoutSeconds $TimeoutSeconds -OnHeartbeat $heartbeat `
        -ComposeArgs (@('up', '--detach') + $required)

    if ($result.TimedOut) {
        Write-AfctWarn "the Docker Compose command did not finish within $TimeoutSeconds seconds and was stopped. Checking whether AFCT started anyway..."
        Write-AfctTrace "compose up --detach timed out after $($result.Seconds)s; CLI terminated"

        # This is deliberately a short, separate grace period rather than another copy of
        # AFCT_HEALTH_TIMEOUT. The normal budget is already spent; this check only verifies
        # whether the daemon reached the desired state before the CLI was killed.
        $recoverySeconds = Get-AfctStartupRecoveryTimeout
        $recoveryDeadline = (Get-Date).AddSeconds($recoverySeconds)
        $state = Get-AfctStackState -Deadline $recoveryDeadline
        Write-AfctTrace "post-timeout recovery state: $(Format-AfctStackState $state)"

        if ($state.AllReady -and $state.ImageMatches -and $state.HttpOk) {
            Write-AfctSuccess 'AFCT services are healthy and the web service is responding.'
            Write-AfctWarn 'AFCT itself started correctly; only the Docker command had to be stopped. Continuing.'
            return [pscustomobject]@{
                Seconds                      = $result.Seconds
                Ready                        = $true
                RecoveredAfterComposeTimeout = $true
            }
        }

        Show-AfctComposeFailure $result
        throw "afct-fatal: AFCT did not finish starting within $TimeoutSeconds seconds, and the ${recoverySeconds}-second recovery check could not verify a ready stack. Current state: $(Format-AfctStackState $state)"
    }

    if ($result.ExitCode -ne 0) {
        Write-AfctTrace "compose up --detach failed with exit code $($result.ExitCode) after $($result.Seconds)s"
        Show-AfctComposeFailure $result
        throw "afct-fatal: the AFCT stack could not be started (docker compose exited $($result.ExitCode))."
    }

    Write-AfctTrace "compose up --detach completed in $($result.Seconds)s"
    return [pscustomobject]@{
        Seconds                      = $result.Seconds
        Ready                        = $false
        RecoveredAfterComposeTimeout = $false
    }
}

# Bring up anything expected but not required, reporting rather than failing.
function Start-AfctOptionalServices {
    $optional = @(Get-AfctExpectedServices | Where-Object { -not $_.Required } | ForEach-Object { $_.Name })
    foreach ($name in $optional) {
        $r = Invoke-AfctComposeBounded -TimeoutSeconds (Get-AfctDockerCommandTimeout) `
            -ComposeArgs @('up', '--detach', $name)
        if ($r.TimedOut -or $r.ExitCode -ne 0) {
            Write-AfctWarn "the optional $name service could not be started. AFCT itself is unaffected."
            Write-AfctTrace "optional service $name failed to start"
        }
    }
}

function Show-AfctComposeFailure {
    param($Result)
    $lines = @($Result.StdErr) + @($Result.StdOut) | Where-Object { $_ -and $_.Trim() }
    if (-not $lines) { return }
    Write-AfctInfo 'Docker reported:'
    foreach ($line in (@($lines) | Select-Object -Last 12)) {
        Write-Host "  $line"
        Write-AfctTrace "docker: $line"
    }
}

# Best-effort end-to-end check that nginx serves the app. Self-signed cert on first boot, so
# bypass cert validation for this one localhost call (restored afterward).
function Test-AfctHttpHealth {
    param([AllowNull()][Nullable[DateTime]]$Deadline)

    $prev = [System.Net.ServicePointManager]::ServerCertificateValidationCallback
    [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
    try {
        foreach ($scheme in 'https', 'http') {
            $budget = 10
            if ($null -ne $Deadline) {
                $left = Get-AfctRemainingSeconds $Deadline
                if ($left -le 0) { return $false }
                $budget = [Math]::Min(10, [Math]::Max(1, $left))
            }
            try {
                Invoke-WebRequest -Uri "${scheme}://localhost$HealthPath" -TimeoutSec $budget -UseBasicParsing | Out-Null
                return $true
            } catch { }
        }
        return $false
    } finally {
        [System.Net.ServicePointManager]::ServerCertificateValidationCallback = $prev
    }
}

# Wait for the required stack to come up, saying what it is waiting for.
function Wait-AfctHealth {
    param([int]$TimeoutSeconds = 0)
    if (-not $PSBoundParameters.ContainsKey('TimeoutSeconds')) { $TimeoutSeconds = $HealthTimeout }

    $clock = [System.Diagnostics.Stopwatch]::StartNew()
    $start = Get-Date
    $restarting = 0
    $announced = @{}
    $lastHeartbeat = 0
    $containersReady = $false

    while ($true) {
        $deadline = $start.AddSeconds($TimeoutSeconds)
        $elapsed = [int]$clock.Elapsed.TotalSeconds
        $state = Get-AfctStackState -SkipHttp -Deadline $deadline

        foreach ($svc in $state.Services) {
            if ($svc.Status -eq 'missing') { continue }
            if ($svc.Ready) {
                if (-not $announced.ContainsKey("$($svc.Name):ready")) {
                    $announced["$($svc.Name):ready"] = $true
                    if ($svc.Health -eq 'healthy') { Write-AfctSuccess "$($svc.Label) is healthy." }
                    else { Write-AfctSuccess "$($svc.Label) is running." }
                }
                continue
            }
            if (-not $announced.ContainsKey("$($svc.Name):starting")) {
                $announced["$($svc.Name):starting"] = $true
                Write-AfctInfo "$($svc.Label) is starting..."
            }
        }

        $app = $state.Services | Where-Object { $_.Name -eq $AppService } | Select-Object -First 1
        if ($null -ne $app -and $app.Status -ne 'missing') {
            if ($app.Status -eq 'running' -and $app.Health -eq 'unhealthy') {
                throw 'afct-fatal: the application container reported an unhealthy state.'
            }
            if ($app.Status -in 'exited', 'dead') {
                throw 'afct-fatal: the application container stopped before becoming healthy.'
            }
            if ($app.Status -eq 'restarting') {
                $restarting++
                if ($restarting -ge 3) {
                    throw "afct-fatal: the $AppService container keeps restarting (crash loop) instead of becoming healthy. Check the logs: afctctl logs"
                }
            }
            if ($app.Status -eq 'running' -and $app.Health -eq 'none') {
                throw "afct-fatal: the $AppService service has no Docker health check configured."
            }
        }

        if ($state.AllReady) {
            $stale = Format-AfctStaleServices $state
            if ($stale) {
                throw "afct-fatal: the running containers are not all on the expected release. $stale. Re-run the installer or 'afctctl update' to bring them into line."
            }

            if (-not $announced.ContainsKey('http:waiting')) {
                $announced['http:waiting'] = $true
                Write-AfctInfo 'Containers are healthy; waiting for the web service...'
            }
            if (Test-AfctHttpHealth -Deadline $deadline) {
                Write-AfctSuccess "The web service is responding at $HealthPath."
                Write-AfctTrace "stack ready after $([int]$clock.Elapsed.TotalSeconds)s: $(Format-AfctStackState $state)"
                return
            }
            $containersReady = $true
        }

        if ($clock.Elapsed.TotalSeconds -ge $TimeoutSeconds) { break }

        $elapsed = [int]$clock.Elapsed.TotalSeconds
        if (($elapsed - $lastHeartbeat) -ge 30) {
            $lastHeartbeat = $elapsed
            Write-AfctInfo "still starting after ${elapsed}s: $(Format-AfctStackState $state)"
        }

        Start-Sleep -Seconds $HealthInterval
    }

    $spent = [int]$clock.Elapsed.TotalSeconds
    Write-AfctTrace "health wait timed out after ${spent}s: $(Format-AfctStackState $state)"
    if ($containersReady) {
        throw "afct-fatal: the AFCT containers all started, but the web service never answered at $HealthPath within $TimeoutSeconds seconds. Check the logs: afctctl logs"
    }
    throw "afct-fatal: AFCT did not finish starting within $TimeoutSeconds seconds. Current state: $(Format-AfctStackState $state)"
}

function Show-AfctOptionalWarnings {
    param($State)
    if (-not ($State.PSObject.Properties.Name -contains 'OptionalWarnings')) { return }
    foreach ($warning in @($State.OptionalWarnings)) {
        if ($warning) { Write-AfctWarn "$warning. AFCT itself is unaffected." }
    }
}

# Startup and the health wait share one budget. If the Compose CLI times out but the short
# recovery check proves the entire required stack healthy, version-aligned and serving HTTP,
# that proof is final and the zero-budget normal health loop is deliberately skipped.
function Invoke-AfctStartAndWait {
    $startResult = Start-AfctStack

    if (-not $startResult.Ready) {
        $remaining = $HealthTimeout - $startResult.Seconds
        Wait-AfctHealth -TimeoutSeconds $remaining
    } elseif ($startResult.RecoveredAfterComposeTimeout) {
        Write-AfctTrace 'normal health wait skipped: post-timeout recovery already verified core readiness'
    }

    Write-AfctSuccess 'AFCT core startup completed.'
    Start-AfctOptionalServices
}

function Invoke-AfctDeployStack {
    Test-AfctComposeConfig
    Get-AfctImages
    Invoke-AfctStartAndWait
}

function Invoke-AfctRestartStack {
    Test-AfctComposeConfig
    Invoke-AfctStartAndWait
}
