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
    # No circularity: `--profile updater` is already on every compose invocation when the
    # flag is set (Get-AfctUpdaterProfileArgs), so a normal `up --detach` starts it along
    # with everything else. Nothing has to start the updater to decide whether to expect it.
    # Expected, but NOT required. The updater is optional and experimental on Windows, and
    # the policy everywhere else already treats it that way: a sidecar that will not start
    # earns a warning, never a failed installation. Letting it into the readiness verdict
    # would have made an otherwise working AFCT site fail its own install over a feature
    # nobody had to turn on.
    if ((Read-AfctEnvValue 'AFCT_UPDATER_ENABLED' $EnvFile) -eq 'true') {
        $services += [pscustomobject]@{ Name = $UpdaterService; Label = 'In-app updater'
                                        RequiresHealth = $true; Versioned = $true; Required = $false }
    }
    return $services
}

# The tag part of an image reference, or '' when it carries none.
#
# Splits on the last colon, but only after dropping a digest: postgres is pinned as
# `postgres:15-alpine@sha256:...`, and taking the last colon of that would read the digest as
# a tag and compare it against a release.
function Get-AfctImageTag {
    param([string]$Image)
    if ([string]::IsNullOrWhiteSpace($Image)) { return '' }
    $ref = $Image
    $at = $ref.IndexOf('@')
    if ($at -ge 0) { $ref = $ref.Substring(0, $at) }
    $colon = $ref.LastIndexOf(':')
    if ($colon -lt 0) { return '' }
    # A registry port is not a tag: "localhost:5000/afct" has a colon and no tag.
    $slash = $ref.LastIndexOf('/')
    if ($colon -lt $slash) { return '' }
    return $ref.Substring($colon + 1)
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
# -TimeoutSeconds caps each of the two Docker calls. A caller working to a deadline passes
# what it has left, so a wedged daemon cannot spend the full inspection allowance per call
# per service after the budget is already gone.
function Get-AfctServiceState {
    param([string]$Service, [int]$TimeoutSeconds = 0)
    $bound = Get-AfctInspectionTimeout $TimeoutSeconds

    # Both calls are bounded. This runs inside the startup poll and inside doctor, so a
    # daemon that stops answering has to end the wait rather than become it.
    $ps = Invoke-AfctComposeBounded -TimeoutSeconds $bound ps -q $Service
    if ($ps.TimedOut -or $ps.ExitCode -ne 0) { return 'missing|none|' }
    $id = (@($ps.StdOut) | Where-Object { $_ -and $_.Trim() } | Select-Object -First 1)
    if (-not $id) { return 'missing|none|' }

    $inspect = Invoke-AfctDockerBounded -TimeoutSeconds $bound inspect -f '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.Config.Image}}' $id.Trim()
    if ($inspect.TimedOut -or $inspect.ExitCode -ne 0) { return 'missing|none|' }
    $state = (@($inspect.StdOut) | Where-Object { $_ -and $_.Trim() } | Select-Object -First 1)
    if (-not $state) { return 'missing|none|' }
    return $state.Trim()
}

# The shorter of the normal inspection allowance and whatever the caller has left.
#
# Without this the deadline had a long tail: a pass that begins one second inside the budget
# still runs two bounded calls for each of five or six services, each allowed the full
# twenty seconds against a daemon that has just wedged, which is minutes of overrun on a
# timeout somebody was told was five. A floor of one second keeps a nearly-spent budget from
# turning into an instant zero-timeout kill of a call that would have answered.
function Get-AfctInspectionTimeout {
    param([int]$Remaining)
    $normal = Get-AfctDockerCommandTimeout
    if ($Remaining -le 0) { return $normal }
    if ($Remaining -ge $normal) { return $normal }
    if ($Remaining -lt 1) { return 1 }
    return $Remaining
}

# The app's "<status>|<health>" pair, which is what the existing status and health callers
# want. Kept as its own name because several commands ask only about the application.
function Get-AfctAppContainerState {
    param([int]$TimeoutSeconds = 0)
    $parts = (Get-AfctServiceState -Service $AppService -TimeoutSeconds $TimeoutSeconds) -split '\|', 3
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
    param([switch]$SkipHttp, [int]$TimeoutSeconds = 0)

    # One expected release for the whole reading, resolved the way Compose resolves it. Asked
    # once so every service in a single reading is judged against the same answer.
    $wantTag = Get-AfctEffectiveAppTag

    $services = @()
    $allReady = $true
    $allMatch = $true
    $optionalWarnings = @()
    foreach ($svc in Get-AfctExpectedServices) {
        $state = Get-AfctServiceState -Service $svc.Name -TimeoutSeconds $TimeoutSeconds
        $parts = $state -split '\|', 3
        $ready = Test-AfctServiceReady -State $state -RequiresHealth $svc.RequiresHealth

        # Every AFCT service is built and published together under one release tag, so a
        # stack whose app is new and whose worker is a release behind is not a deployment
        # anybody asked for: it is two releases sharing a database. Checking the app alone
        # would have called that correct. PostgreSQL is pinned by digest on its own schedule
        # and is deliberately not compared against the AFCT release.
        $actualTag = Get-AfctImageTag $parts[2]
        $matches = $true
        if ($svc.Versioned -and $parts[0] -ne 'missing' -and $actualTag) {
            $matches = ($actualTag -ceq $wantTag)
        }
        # Readiness and version agreement are judged over the REQUIRED services. An optional
        # service's problems are collected and reported, not folded into the verdict.
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
    if (-not $SkipHttp) { $httpOk = (Test-AfctHttpHealth) }

    return [pscustomobject]@{
        Services         = $services
        # Required services only, both of them. The names are kept for every existing caller.
        AllReady         = $allReady
        AppReady         = ($null -ne $app -and $app.Ready)
        HttpOk           = $httpOk
        ExpectedTag      = $wantTag
        ImageMatches     = $allMatch
        OptionalWarnings = $optionalWarnings
    }
}

# The versioned services that are running something other than the expected release.
function Get-AfctStaleServices {
    param($State, [switch]$RequiredOnly)
    $rows = @($State.Services | Where-Object { $_.Versioned -and -not $_.ImageMatches })
    if ($RequiredOnly) { $rows = @($rows | Where-Object { $_.Required }) }
    return $rows
}

# "Worker is running on v0.9.9; expected v1.0.0" for each stale service, one per line.
function Format-AfctStaleServices {
    param($State)
    $parts = @()
    foreach ($svc in (Get-AfctStaleServices -State $State -RequiredOnly)) {
        $parts += "$($svc.Label) is running on $($svc.ActualImageTag); expected $($svc.ExpectedImageTag)"
    }
    return ($parts -join '; ')
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

    # A line every half minute while Compose works, because this call is most of the wait on
    # a first install: Compose honours the dependency conditions itself, so it does not
    # return until postgres is healthy, then the app is healthy, then nginx has started. The
    # per-service progress below cannot begin until it comes back, and several minutes of a
    # motionless window is what a non-technical operator reads as a crash.
    #
    # Deliberately just a clock, not a service summary. Reading service state means running
    # `compose ps` against a project that `compose up` is holding, and Compose serialises on
    # that project; a progress line is not worth contending with the thing whose progress it
    # is reporting.
    $heartbeat = {
        param($elapsed)
        Write-AfctInfo "Docker Compose is still starting containers after ${elapsed}s..."
    }
    # The required services by name, not a bare `up`.
    #
    # Every compose call carries `--profile updater` while the updater is enabled, so a bare
    # `up` includes it, and an updater image that is missing or private fails the whole
    # operation: the base installation stopped because an optional, experimental sidecar
    # could not start. Naming the required services makes the startup match the Required
    # model rather than only the health verdict afterwards. Compose still brings up each
    # named service's dependencies, and leaves anything not named exactly as it found it.
    $required = @(Get-AfctExpectedServices | Where-Object { $_.Required } | ForEach-Object { $_.Name })
    $result = Invoke-AfctComposeBounded -TimeoutSeconds $TimeoutSeconds -OnHeartbeat $heartbeat `
        -ComposeArgs (@('up', '--detach') + $required)

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
    Start-AfctOptionalServices
    return $result.Seconds
}

# Bring up anything expected but not required, reporting rather than failing.
#
# Separated from the core startup for the same reason the pull is: AFCT is installable and
# usable without any of it, so a sidecar that will not start is worth saying out loud and
# nothing more. Kept to a short deadline, because nothing is waiting on it.
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
    # A negative or zero remainder means the budget is already spent. It used to be read as
    # "no value supplied" and replaced with a fresh full timeout, which handed a startup that
    # had already used all 300 seconds another 300. The caller's number is now taken at face
    # value; only an omitted parameter falls back to the configured total.
    if (-not $PSBoundParameters.ContainsKey('TimeoutSeconds')) { $TimeoutSeconds = $HealthTimeout }

    # Wall clock, not a count of sleeps. The loop's other work is not free: two bounded Docker
    # calls per service per pass, plus an HTTP probe that is allowed ten seconds of its own.
    # Adding $HealthInterval per iteration counted none of it, so a nominal five-minute
    # timeout could run for a quarter of an hour against a slow Docker Desktop, which is the
    # same "it just sits there" the whole exercise is about.
    $clock = [System.Diagnostics.Stopwatch]::StartNew()

    # A single restart can happen during a normal recreate, but repeated restarts mean a
    # crash loop that will never become healthy, so fail fast instead of waiting out the
    # whole timeout (mirrors the Unix controller).
    $restarting = 0
    $announced = @{}
    $lastHeartbeat = 0
    # Remembered so the timeout message can say which half never finished: containers that
    # never came up, or containers that did and a web service that never answered.
    $containersReady = $false

    while ($true) {
        $elapsed = [int]$clock.Elapsed.TotalSeconds
        # What is left, handed down so the inspection cannot outlive the budget it is being
        # measured against.
        $remaining = [int]($TimeoutSeconds - $clock.Elapsed.TotalSeconds)
        $state = Get-AfctStackState -SkipHttp -TimeoutSeconds $remaining

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

        $appState = Get-AfctAppContainerState -TimeoutSeconds ([int]($TimeoutSeconds - $clock.Elapsed.TotalSeconds))
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
            # Every required service is up. Two things still have to be true before this is
            # a finished deployment.
            #
            # First, they all have to be the same release. AFCT's services are built and
            # published together, so a healthy stack running a new app against a
            # release-old worker is two releases sharing a database, and this used to call
            # that success as long as HTTP answered. It is also not something waiting will
            # fix: containers do not change image on their own, so it fails now with the
            # service named rather than after the clock runs out.
            $stale = Format-AfctStaleServices $state
            if ($stale) {
                throw "afct-fatal: the running containers are not all on the expected release. $stale. Re-run the installer or 'afctctl update' to bring them into line."
            }

            # Second, AFCT has to actually answer. Containers being healthy is not the same
            # thing, and this used to warn and return success anyway, so the installer could
            # announce "AFCT Dashboard is ready" for a deployment that served nothing while
            # the rerun check called the same state not-ready. A miss is not fatal on its
            # own: nginx accepts connections a moment before the app answers through it, so
            # this keeps polling inside the same remaining budget.
            if (-not $announced.ContainsKey('http:waiting')) {
                $announced['http:waiting'] = $true
                Write-AfctInfo 'Containers are healthy; waiting for the web service...'
            }
            if (Test-AfctHttpHealth) {
                Write-AfctSuccess "The web service is responding at $HealthPath."
                Write-AfctTrace "stack ready after $([int]$clock.Elapsed.TotalSeconds)s: $(Format-AfctStackState $state)"
                Show-AfctOptionalWarnings $state
                return
            }
            $containersReady = $true
        }

        # Checked after the work, not before it, so a pass that begins inside the budget is
        # always allowed to finish and report. This is also what lets a zero remainder get
        # one honest look at the stack rather than failing a deployment that is demonstrably
        # up: one pass of reporting overhead past the deadline, and no more.
        if ($clock.Elapsed.TotalSeconds -ge $TimeoutSeconds) { break }

        # A periodic line while the wait runs long, so a slow first start still looks alive
        # without turning into a per-poll scroll. Printing costs nothing against the clock:
        # the deadline is measured, not counted.
        $elapsed = [int]$clock.Elapsed.TotalSeconds
        if (($elapsed - $lastHeartbeat) -ge 30) {
            $lastHeartbeat = $elapsed
            Write-AfctInfo "still starting after ${elapsed}s: $(Format-AfctStackState $state)"
        }

        Start-Sleep -Seconds $HealthInterval
    }

    # The reading from the last pass, not a fresh one. Collecting the whole stack again
    # after the budget is gone is another two Docker calls per service against a daemon that
    # has just proved slow, purely to phrase an error; the state from moments ago says the
    # same thing and costs nothing.
    $spent = [int]$clock.Elapsed.TotalSeconds
    Write-AfctTrace "health wait timed out after ${spent}s: $(Format-AfctStackState $state)"
    if ($containersReady) {
        throw "afct-fatal: the AFCT containers all started, but the web service never answered at $HealthPath within $TimeoutSeconds seconds. Check the logs: afctctl logs"
    }
    throw "afct-fatal: AFCT did not finish starting within $TimeoutSeconds seconds. Current state: $(Format-AfctStackState $state)"
}

# Optional services are reported, never fatal. The base application is already up and
# serving by the time this runs.
function Show-AfctOptionalWarnings {
    param($State)
    # Guarded: Set-StrictMode turns a missing property into a thrown error, and this must
    # never be the thing that fails an otherwise finished installation.
    if (-not ($State.PSObject.Properties.Name -contains 'OptionalWarnings')) { return }
    foreach ($warning in @($State.OptionalWarnings)) {
        if ($warning) { Write-AfctWarn "$warning. AFCT itself is unaffected." }
    }
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
