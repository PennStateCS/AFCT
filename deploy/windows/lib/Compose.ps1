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
        if ($a -eq $b) { return }
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        Copy-Item -LiteralPath $RuntimeCompose -Destination "$RuntimeCompose.bak.$stamp" -Force -ErrorAction SilentlyContinue
        Write-AfctInfo "the runtime Compose file changed with this release; saved the previous one as docker-compose.yml.bak.$stamp."
    }
    Copy-Item -LiteralPath $ComposeTemplate -Destination $RuntimeCompose -Force
}

function Test-AfctComposeConfig {
    # Capture the output so a failure reports the actual reason (e.g. a missing env file)
    # instead of a bare "invalid configuration" the operator cannot act on.
    $out = Invoke-AfctCompose config
    if ($LASTEXITCODE -ne 0) {
        $detail = (@($out) | Where-Object { $_ } | Select-Object -Last 3) -join ' '
        if ($detail) { throw "afct-fatal: the Docker Compose configuration is invalid: $detail" }
        throw 'afct-fatal: the Docker Compose configuration is invalid.'
    }
}

function Get-AfctImages {
    Write-AfctInfo 'downloading AFCT container images...'
    if (-not [Console]::IsOutputRedirected) {
        $code = Invoke-AfctComposeConsole pull
    } else {
        Invoke-AfctCompose pull | Out-Null
        $code = $LASTEXITCODE
    }
    if ($code -ne 0) {
        throw "afct-fatal: container images could not be downloaded. Check the network and registry authentication. If the images are private, run 'docker login ghcr.io' and re-run."
    }
    Write-AfctSuccess 'Container images downloaded.'
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
    return @(
        [pscustomobject]@{ Name = 'postgres';  Label = 'PostgreSQL';      RequiresHealth = $true },
        [pscustomobject]@{ Name = $AppService; Label = 'AFCT application'; RequiresHealth = $true },
        [pscustomobject]@{ Name = 'worker';    Label = 'Worker';          RequiresHealth = $false },
        [pscustomobject]@{ Name = 'nginx';     Label = 'nginx';           RequiresHealth = $true },
        [pscustomobject]@{ Name = 'db-backup'; Label = 'Backup service';  RequiresHealth = $true }
    )
}

# Read one service's container state as "<status>|<health>|<image>".
#
# `ps -q` then `docker inspect -f`, deliberately not `compose ps --format json`: that is a
# JSON array in older Compose and newline-delimited objects in 2.21 and later, and under the
# Set-StrictMode every module here sets, reading a property some versions do not emit throws
# rather than returning empty. A Go template gives the same three fields on every version.
#
# Captures output and reads $LASTEXITCODE BEFORE narrowing with Select-Object: piping a
# native command straight into `Select-Object -First 1` stops the pipeline early and corrupts
# $LASTEXITCODE to -1 even on success, which would report a healthy stack as missing.
function Get-AfctServiceState {
    param([string]$Service)
    $id = (Invoke-AfctCompose ps -q $Service | Where-Object { $_ } | Select-Object -First 1)
    if (-not $id) { return 'missing|none|' }
    $eap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & docker inspect -f '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.Config.Image}}' $id 2>&1 | ForEach-Object { "$_" }
    } finally { $ErrorActionPreference = $eap }
    $code = $LASTEXITCODE
    $state = $out | Select-Object -First 1
    if ($code -ne 0 -or -not $state) { return 'missing|none|' }
    return $state
}

# The app's "<status>|<health>" pair, which is what the existing status and health callers
# want. Kept as its own name because several commands ask only about the application.
function Get-AfctAppContainerState {
    $parts = (Get-AfctServiceState $AppService) -split '\|', 3
    if ($parts[0] -eq 'missing') { return $null }
    return "$($parts[0])|$($parts[1])"
}

# Is this service as far along as it needs to be?
function Test-AfctServiceReady {
    param([string]$State, [bool]$RequiresHealth)
    $parts = $State -split '\|', 3
    if ($parts[0] -ne 'running') { return $false }
    if (-not $RequiresHealth) { return $true }
    return ($parts[1] -eq 'healthy')
}

# A single reading of the whole deployment: every expected service, whether each is ready,
# and whether the application answers over HTTP at the tag this install is pinned to.
#
# The one observer. Install, restart, update, doctor and the failure report all ask this
# rather than each deriving "is AFCT up" from a different query, which is how those four
# would otherwise drift apart.
#
# -SkipHttp keeps it cheap for the progress loop, which calls it every few seconds; the HTTP
# probe has its own ten-second timeout and belongs at the end, not in a poll.
function Get-AfctStackState {
    param([switch]$SkipHttp)
    $services = @()
    $allReady = $true
    foreach ($svc in Get-AfctExpectedServices) {
        $state = Get-AfctServiceState $svc.Name
        $parts = $state -split '\|', 3
        $ready = Test-AfctServiceReady -State $state -RequiresHealth $svc.RequiresHealth
        if (-not $ready) { $allReady = $false }
        $services += [pscustomobject]@{
            Name   = $svc.Name
            Label  = $svc.Label
            Status = $parts[0]
            Health = $parts[1]
            Image  = $parts[2]
            Ready  = $ready
        }
    }
    $app = $services | Where-Object { $_.Name -eq $AppService } | Select-Object -First 1
    $httpOk = $false
    if (-not $SkipHttp) { $httpOk = (Test-AfctHttpHealth) }

    # The pinned release, compared against what the app container is actually running. A
    # stack that is up but on the wrong tag is not the deployment the operator asked for, so
    # a rerun must not mistake it for one and skip the work. No pin recorded means nothing to
    # disagree with.
    $wantTag = Read-AfctEnvValue 'AFCT_APP_TAG' $EnvFile
    $imageMatches = $true
    if ($wantTag -and $app -and $app.Image) { $imageMatches = ($app.Image -like "*:$wantTag") }

    return [pscustomobject]@{
        Services     = $services
        AllReady     = $allReady
        AppReady     = ($null -ne $app -and $app.Ready)
        HttpOk       = $httpOk
        ExpectedTag  = $wantTag
        ImageMatches = $imageMatches
    }
}

# One line per service, for a heartbeat or a failure report. "nginx: running (healthy)".
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

# Bring the stack up, with a deadline, and report what happened.
#
# Returns the number of seconds it took so the caller can subtract it from the shared
# budget. Throws afct-fatal when the stack genuinely did not start.
#
# The deadline is the documented AFCT_HEALTH_TIMEOUT rather than a new number: `up` is
# already most of the waiting, because Compose honours the dependency conditions in the
# Compose file (app waits for postgres to be healthy, nginx waits for app), so bounding the
# two separately with a full timeout each would quietly double the worst case an operator
# was told to expect.
function Start-AfctStack {
    param([int]$TimeoutSeconds = 0)
    if ($TimeoutSeconds -le 0) { $TimeoutSeconds = $HealthTimeout }

    Write-AfctInfo 'Starting AFCT containers...'
    Write-AfctTrace "compose up --detach starting (deadline ${TimeoutSeconds}s)"
    $result = Invoke-AfctComposeBounded -TimeoutSeconds $TimeoutSeconds up --detach

    if ($result.TimedOut) {
        # The CLI stopped making progress. That is not the same as the stack failing to
        # start, and the difference matters: the tester who prompted this work had all five
        # containers up and running while the CLI sat there. So ask the daemon what is
        # actually true before calling the installation a failure.
        #
        # Deliberately narrow. Continuing needs every expected service ready, the application
        # healthy, and the pinned version running. Anything less is reported as the failure it
        # is, and nothing here stops, removes or recreates anything on the way past.
        Write-AfctWarn "the Docker Compose command did not finish within $TimeoutSeconds seconds and was stopped. Checking whether AFCT started anyway..."
        Write-AfctTrace "compose up --detach timed out after $($result.Seconds)s; CLI terminated"
        $state = Get-AfctStackState
        Write-AfctTrace "post-timeout state: $(Format-AfctStackState $state)"
        if ($state.AllReady -and $state.ImageMatches) {
            Write-AfctWarn 'AFCT itself started correctly; only the Docker command had to be stopped. Continuing.'
            return $result.Seconds
        }
        Show-AfctComposeFailure $result
        throw "afct-fatal: AFCT did not finish starting within $TimeoutSeconds seconds. Current state: $(Format-AfctStackState $state)"
    }

    if ($result.ExitCode -ne 0) {
        Write-AfctTrace "compose up --detach failed with exit code $($result.ExitCode) after $($result.Seconds)s"
        Show-AfctComposeFailure $result
        throw "afct-fatal: the AFCT stack could not be started (docker compose exited $($result.ExitCode))."
    }

    Write-AfctTrace "compose up --detach completed in $($result.Seconds)s"
    return $result.Seconds
}

# Print what Docker actually said. Replacing a real Docker error with "the AFCT stack could
# not be started" is what left the failing tester with nothing to act on. The tail is capped
# so a wall of progress lines does not bury the message that matters, and the whole capture
# reaches the diagnostics bundle regardless.
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
    $prev = [System.Net.ServicePointManager]::ServerCertificateValidationCallback
    [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
    try {
        foreach ($scheme in 'https', 'http') {
            try {
                Invoke-WebRequest -Uri "${scheme}://localhost$HealthPath" -TimeoutSec 10 -UseBasicParsing | Out-Null
                return $true
            } catch { }
        }
        return $false
    } finally {
        [System.Net.ServicePointManager]::ServerCertificateValidationCallback = $prev
    }
}

# Wait for the stack to come up, saying what it is waiting for.
#
# The old version printed one line and then nothing at all until it either finished or gave
# up. On a first install that is several minutes of an apparently frozen window, which is
# what the failing tester saw and reasonably read as a hang.
#
# Every stage printed here is one this can actually observe: a service is reported starting
# when its container exists and is not ready yet, and healthy when Docker says so. Nothing is
# announced that has not been read back from the daemon.
#
# -TimeoutSeconds carries the REMAINING budget from the caller. Startup and health are two
# halves of one wait, not two independent ones, so the worst case stays the timeout the
# operator was told about rather than twice it.
function Wait-AfctHealth {
    param([int]$TimeoutSeconds = 0)
    if ($TimeoutSeconds -le 0) { $TimeoutSeconds = $HealthTimeout }
    if ($TimeoutSeconds -lt $HealthInterval) { $TimeoutSeconds = $HealthInterval }

    $elapsed = 0
    # A single restart can happen during a normal recreate, but repeated restarts mean a
    # crash loop that will never become healthy, so fail fast instead of waiting out the
    # whole timeout (mirrors the Unix controller).
    $restarting = 0
    $announced = @{}
    $lastHeartbeat = 0

    while ($elapsed -lt $TimeoutSeconds) {
        $state = Get-AfctStackState -SkipHttp

        # Stage lines, once each. A service that goes straight to ready between two polls
        # gets only its "healthy" line, which is the honest thing to print: the starting
        # stage was never observed.
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

        $appState = Get-AfctAppContainerState
        if ($appState) {
            $containerState, $healthState = $appState -split '\|', 2
            if ($containerState -eq 'running' -and $healthState -eq 'unhealthy') {
                throw 'afct-fatal: the application container reported an unhealthy state.'
            }
            if ($containerState -in 'exited', 'dead') {
                throw 'afct-fatal: the application container stopped before becoming healthy.'
            }
            if ($containerState -eq 'restarting') {
                $restarting++
                if ($restarting -ge 3) {
                    throw "afct-fatal: the $AppService container keeps restarting (crash loop) instead of becoming healthy. Check the logs: afctctl logs"
                }
            }
            if ($containerState -eq 'running' -and $healthState -eq 'none') {
                throw "afct-fatal: the $AppService service has no Docker health check configured."
            }
        }

        if ($state.AllReady) {
            Write-AfctInfo 'Verifying the web service...'
            if (Test-AfctHttpHealth) { Write-AfctSuccess "The web service is responding at $HealthPath." }
            else { Write-AfctWarn 'the containers are healthy, but the local web endpoint did not respond yet.' }
            Write-AfctTrace "stack ready after ${elapsed}s: $(Format-AfctStackState $state)"
            return
        }

        # A periodic line while the wait runs long, so a slow first start still looks alive
        # without turning into a per-poll scroll. Every 30 seconds, and only once anything
        # takes longer than that.
        if (($elapsed - $lastHeartbeat) -ge 30) {
            $lastHeartbeat = $elapsed
            Write-AfctInfo "still starting after ${elapsed}s: $(Format-AfctStackState $state)"
        }

        Start-Sleep -Seconds $HealthInterval
        $elapsed += $HealthInterval
    }

    $final = Get-AfctStackState -SkipHttp
    Write-AfctTrace "health wait timed out after ${elapsed}s: $(Format-AfctStackState $final)"
    throw "afct-fatal: AFCT did not finish starting within $TimeoutSeconds seconds. Current state: $(Format-AfctStackState $final)"
}

# Startup and the health wait share one budget, spent in order. Whatever `up` used is taken
# off what the health wait gets, so the total stays inside the documented timeout.
function Invoke-AfctStartAndWait {
    $spent = Start-AfctStack
    Wait-AfctHealth -TimeoutSeconds ($HealthTimeout - $spent)
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
