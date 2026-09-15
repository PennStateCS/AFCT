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
# Elapsed time for a heartbeat line.
#
# Floor, not [int]: PowerShell's [int] rounds half to even, so [int](90/60) is 2 and a
# 90-second wait announced itself as "2m". With a 30-second heartbeat that also made
# consecutive lines repeat (2m, 2m, 2m) and jump (3m, then 4m at 3m30s). Two identical
# consecutive lines read as a hang, which is the exact thing these heartbeats exist to rule
# out, so the seconds are kept.
function Format-AfctElapsed {
    param([int]$Seconds)
    if ($Seconds -lt 60) { return "${Seconds}s" }
    $minutes = [math]::Floor($Seconds / 60)
    $rest = $Seconds - ($minutes * 60)
    if ($rest -eq 0) { return "${minutes}m" }
    return "${minutes}m${rest}s"
}

# The image each required service will actually run, read from the resolved Compose
# configuration so it reflects the pin in force rather than a guess. Returns nothing at all
# on any incomplete answer: a partial list would understate what has to be present, which is
# the one way this check could be dangerous.
function Get-AfctRequiredImages {
    $required = @(Get-AfctExpectedServices | Where-Object { $_.Required } | ForEach-Object { $_.Name })
    $r = Invoke-AfctComposeBounded -TimeoutSeconds (Get-AfctDockerCommandTimeout) config --format json
    if ($r.TimedOut -or $r.ExitCode -ne 0) { return @() }
    $json = (@($r.StdOut) -join "`n")
    if (-not "$json".Trim()) { return @() }
    try { $cfg = "$json" | ConvertFrom-Json } catch { return @() }
    if (-not ($cfg.PSObject.Properties.Name -contains 'services')) { return @() }
    $services = $cfg.services
    $images = @()
    foreach ($name in $required) {
        if (-not ($services.PSObject.Properties.Name -contains $name)) { return @() }
        $svc = $services.$name
        if (-not ($svc.PSObject.Properties.Name -contains 'image')) { return @() }
        $ref = [string]$svc.image
        if (-not $ref) { return @() }
        $images += [pscustomobject]@{ Service = $name; Image = $ref }
    }
    return $images
}

function Get-AfctImages {
    # The fallback below is offered on the install path only. `afctctl update` must never
    # take it: on a same-tag update it would find the images it is already running, continue,
    # and report "update completed" having updated nothing.
    param([switch]$AllowCachedFallback)

    Write-AfctInfo 'downloading AFCT container images...'
    $required = @(Get-AfctExpectedServices | Where-Object { $_.Required } | ForEach-Object { $_.Name })

    $heartbeat = {
        param($elapsed, $outPath, $errPath)
        $line = Get-AfctLastProgressLine $outPath $errPath
        $for = Format-AfctElapsed $elapsed
        if ($line) { Write-AfctInfo "still downloading after ${for}: $line" }
        else { Write-AfctInfo "still downloading after ${for}..." }
    }

    $result = Invoke-AfctComposeBounded -TimeoutSeconds (Get-AfctDockerPullTimeout) `
        -OnHeartbeat $heartbeat -ComposeArgs (@('pull') + $required)

    if ($result.TimedOut -or $result.ExitCode -ne 0) {
        if (-not $result.TimedOut) { Show-AfctComposeFailure $result }

        # An unreachable registry is not the same as a missing image. Every image this
        # release needs may already be on the machine, in which case AFCT is installable and
        # refusing to install it helps nobody. Only ever all-or-nothing, and only against the
        # references Compose itself resolved, so a wrong pin still fails.
        if ($AllowCachedFallback) {
            $images = Get-AfctRequiredImages
            if ($images) {
                $absent = @($images | Where-Object { -not (Test-AfctDockerImagePresent $_.Image) })
                if (-not $absent) {
                    Write-AfctWarn 'the images could not be downloaded, but every image this release needs is already on this machine, so the installation is continuing with those.'
                    foreach ($i in $images) { Write-AfctWarn "  using the local copy of $($i.Image)" }
                    # Said plainly, because this is the one thing the check cannot know: a
                    # tag can be re-pushed, and without the registry there is no way to tell
                    # a current local image from a stale one carrying the same name.
                    Write-AfctWarn "if a newer build was published under the same tag, it has NOT been downloaded. Run 'afctctl update' once the connection is working."
                    Write-AfctTrace 'pull failed; continued with locally present images'
                    return
                }
                Write-AfctTrace "pull failed and $($absent.Count) required image(s) are absent locally: $(($absent | ForEach-Object { $_.Image }) -join ', ')"
            }
        }

        if ($result.TimedOut) {
            throw "afct-fatal: the container images were still downloading after $([int]((Get-AfctDockerPullTimeout) / 60)) minutes and the download was stopped. Check the network connection, then run the installer again; anything already downloaded is kept."
        }
        # Docker's own message is printed immediately above by Show-AfctComposeFailure, so
        # this points at it rather than asserting a cause. It used to lead with
        # "run docker login", which sent people to fix authentication when what actually
        # happened here was a name-resolution failure inside Docker Desktop.
        throw "afct-fatal: the AFCT container images could not be downloaded. Docker's own message is above, and it usually says which: most often the registry could not be reached, and occasionally it needs a sign-in ('docker login ghcr.io'). Nothing on this machine was changed; run the installer again once the connection is working, and anything already downloaded is kept."
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

# Read one service's container state as "<status>|<health>|<image>|<reason>".
#
# Two different answers used to come back as the same string. Every failure here returned
# 'missing|none|', so "the daemon answered and there is no such container" and "I never
# found out" were indistinguishable, and a stack with four healthy containers was reported
# to the operator as `postgres: missing, app: missing, worker: missing, nginx: missing,
# db-backup: missing`. That is a confident wrong answer, which is worse than no answer.
#
# `missing` now means only what it says. Everything unverifiable is `unknown` and carries
# the reason it is unknown. Both are still not-ready, so nothing downstream becomes more
# permissive: this changes what is printed, not what is allowed.
function Get-AfctServiceState {
    param([string]$Service, [AllowNull()][Nullable[DateTime]]$Deadline)

    $bound = Get-AfctCallTimeout $Deadline
    if ($bound -le 0) { return 'unknown|none||not checked, the time budget was already spent' }

    $ps = Invoke-AfctComposeBounded -TimeoutSeconds $bound ps -q $Service
    if ($ps.TimedOut) { return "unknown|none||Docker did not answer within ${bound}s while looking for the container" }
    if ($ps.ExitCode -ne 0) { return "unknown|none||Docker could not list the container (exit $($ps.ExitCode))" }

    # The daemon answered and named no container. This is the one real 'missing'.
    $id = (@($ps.StdOut) | Where-Object { $_ -and $_.Trim() } | Select-Object -First 1)
    if (-not $id) { return 'missing|none||' }

    $bound = Get-AfctCallTimeout $Deadline
    if ($bound -le 0) { return 'unknown|none||not inspected, the time budget ran out after the container was found' }
    $inspect = Invoke-AfctDockerBounded -TimeoutSeconds $bound inspect -f '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.Config.Image}}' $id.Trim()
    if ($inspect.TimedOut) { return "unknown|none||Docker did not answer within ${bound}s while inspecting the container" }
    if ($inspect.ExitCode -ne 0) { return "unknown|none||Docker could not inspect the container (exit $($inspect.ExitCode))" }
    $state = (@($inspect.StdOut) | Where-Object { $_ -and $_.Trim() } | Select-Object -First 1)
    if (-not $state) { return 'unknown|none||Docker returned nothing when asked about the container' }
    return ($state.Trim() + '|')
}

# Parse a service-state string into its four fields, tolerating a short one.
#
# Indexing past the end of a -split result is a terminating error under Set-StrictMode, so a
# state string carrying fewer fields than expected would crash the caller outright. That is
# the worst possible failure for the code whose whole job is reporting state, and it is an
# easy one to reintroduce: any caller or test double that returns the older three-field form
# would do it. Missing fields read as empty instead.
function ConvertFrom-AfctServiceState {
    param([string]$State)
    $parts = @("$State" -split '\|', 4)
    while ($parts.Count -lt 4) { $parts += '' }
    return [pscustomobject]@{
        Status = $parts[0]
        Health = $parts[1]
        Image  = $parts[2]
        Reason = $parts[3]
    }
}

function Get-AfctAppContainerState {
    param([AllowNull()][Nullable[DateTime]]$Deadline)
    $parsed = ConvertFrom-AfctServiceState (Get-AfctServiceState -Service $AppService -Deadline $Deadline)
    # Only a real absence is $null. 'unknown' is carried through with its reason so the
    # caller can say it could not tell, rather than assert the container is not running.
    if ($parsed.Status -eq 'missing') { return $null }
    return "$($parsed.Status)|$($parsed.Health)|$($parsed.Reason)"
}

function Test-AfctServiceReady {
    param([string]$State, [bool]$RequiresHealth)
    # Requires the literal 'running', so 'unknown' is never ready. Fail closed.
    $parsed = ConvertFrom-AfctServiceState $State
    if ($parsed.Status -ne 'running') { return $false }
    if (-not $RequiresHealth) { return $true }
    return ($parsed.Health -eq 'healthy')
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
# -RequiredOnly inspects the core services and nothing else.
#
# For a caller working to a short deadline where an optional service can only cost budget:
# the verdict this returns (AllReady, ImageMatches) is already computed over required
# services alone, so inspecting an optional one contributes nothing to the answer and can
# take time away from what does. The HTTP probe runs after the service loop, so a slow
# optional inspection was able to leave nothing for it, and a healthy, serving core stack
# then read as unverifiable purely because of a sidecar nobody had to enable.
function Get-AfctStackState {
    param([switch]$SkipHttp, [switch]$RequiredOnly, [AllowNull()][Nullable[DateTime]]$Deadline)

    $wantTag = Get-AfctEffectiveAppTag

    $expected = @(Get-AfctExpectedServices)
    if ($RequiredOnly) { $expected = @($expected | Where-Object { $_.Required }) }

    $services = @()
    $allReady = $true
    $allMatch = $true
    $optionalWarnings = @()
    foreach ($svc in $expected) {
        $state = Get-AfctServiceState -Service $svc.Name -Deadline $Deadline
        $parsed = ConvertFrom-AfctServiceState $state
        $ready = Test-AfctServiceReady -State $state -RequiresHealth $svc.RequiresHealth

        $actualTag = Get-AfctImageTag $parsed.Image
        $matches = $true
        # Only compare tags for a container we actually read. 'missing' and 'unknown' both
        # yield no image, so neither can claim a version mismatch.
        if ($svc.Versioned -and $parsed.Status -eq 'running' -and $actualTag) {
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
            Status           = $parsed.Status
            Health           = $parsed.Health
            Image            = $parsed.Image
            Reason           = $parsed.Reason
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
        # An unknown state without its reason is the old bug in a new word: it still reads
        # as a finding about the container rather than about the check.
        if ($svc.Status -eq 'unknown' -and $svc.Reason) { $text += " ($($svc.Reason))" }
        elseif ($svc.Health -and $svc.Health -ne 'none') { $text += " ($($svc.Health))" }
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
        # Required services only. The grace period is short and shared, and the HTTP probe
        # comes last, so an optional service that inspects slowly could spend the whole
        # budget and leave the probe nothing: a core stack that was healthy and serving would
        # then fail its own installation because the in-app updater was enabled. The updater
        # gets its own attempt later, after the core is verified.
        $state = Get-AfctStackState -RequiredOnly -Deadline $recoveryDeadline
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

# Show what Docker actually said when a Compose call failed.
#
# stderr comes first and is never crowded out. During a pull, stdout is hundreds of
# per-layer progress lines, so taking the last 12 of the two concatenated buried the reason:
# a real "failed to copy: ... i/o timeout" was pushed off the end by "Downloading 1.049MB"
# repeated, and the operator was shown progress where the cause should have been.
function Show-AfctComposeFailure {
    param($Result)
    $errLines = @($Result.StdErr) | Where-Object { $_ -and $_.Trim() }
    $outLines = @($Result.StdOut) | Where-Object { $_ -and $_.Trim() }

    # Per-layer progress says nothing once the call has failed. Dropped only when something
    # else survives, so a failure whose entire output is progress still shows the operator
    # something rather than nothing.
    $informative = @($outLines | Where-Object {
        $_ -notmatch '^\s*\S+\s+(Pulling fs layer|Waiting|Downloading|Extracting|Verifying Checksum|Download complete|Pull complete|Already exists)\s*$' -and
        $_ -notmatch '^\s*\S+\s+(Downloading|Extracting)\s+\S+\s*$'
    })
    if ($informative) { $outLines = $informative }

    $lines = @($errLines | Select-Object -Last 12)
    $room = 12 - $lines.Count
    if ($room -gt 0 -and $outLines) { $lines += @($outLines | Select-Object -Last $room) }
    if (-not $lines) { return }
    Write-AfctInfo 'Docker reported:'
    foreach ($line in $lines) {
        Write-Host "  $line"
        Write-AfctTrace "docker: $line"
    }
}

# True when this host's Invoke-WebRequest can be told to skip certificate validation
# directly. PowerShell 7 can; Windows PowerShell 5.1 cannot, and needs the policy below.
function Test-AfctSkipCertSupported {
    $cmd = Get-Command Invoke-WebRequest -ErrorAction SilentlyContinue
    if (-not $cmd) { return $false }
    return $cmd.Parameters.ContainsKey('SkipCertificateCheck')
}

# Make this process accept the self-signed certificate AFCT starts with, returning whatever
# policy was in place so the caller can put it back (or $null when nothing was changed).
#
# Which mechanism works depends on the host, and picking the wrong one fails silently: the
# request just errors and the installer reports that the web service never answered.
#
#   Windows PowerShell 5.1 - Invoke-WebRequest is WebRequest-based. Assigning a ScriptBlock
#   to ServerCertificateValidationCallback does NOT work here: the request runs off-thread,
#   the ScriptBlock cannot be invoked from it, and it surfaces as "The underlying connection
#   was closed: An unexpected error occurred on a send." That is what shipped, and it made
#   the probe fail against a stack that was serving correctly. A compiled ICertificatePolicy
#   is honoured. It is obsolete in .NET, and it is what works on this host.
#
#   PowerShell 7+ - Invoke-WebRequest is HttpClient-based and ignores ServicePointManager
#   entirely, so only -SkipCertificateCheck has any effect. The controller really can run
#   there: install.ps1 invokes it in-process, so `pwsh .\install-windows.ps1` runs all of
#   this under 7.
function Enable-AfctSelfSignedTrust {
    if (Test-AfctSkipCertSupported) { return $null }
    try {
        if (-not ('AfctTrustAllCertificates' -as [type])) {
            Add-Type -TypeDefinition @'
using System.Net;
using System.Security.Cryptography.X509Certificates;
public class AfctTrustAllCertificates : ICertificatePolicy {
    public bool CheckValidationResult(ServicePoint sp, X509Certificate cert, WebRequest req, int problem) { return true; }
}
'@
        }
    } catch {
        # Constrained Language Mode and other locked-down hosts refuse Add-Type. Traced, not
        # thrown: this runs inside the health wait, and the operator needs to know the probe
        # was hobbled rather than be told AFCT is unreachable.
        Write-AfctTrace "health probe: could not compile the certificate policy: $($_.Exception.Message)"
        return $null
    }
    $prev = [System.Net.ServicePointManager]::CertificatePolicy
    [System.Net.ServicePointManager]::CertificatePolicy = New-Object AfctTrustAllCertificates
    return $prev
}

# Say why a health request failed, in the terms that change what the operator does next:
# nothing is listening yet, the TLS handshake failed, or AFCT answered with an error status.
function Get-AfctHttpFailureReason {
    param($ErrorRecord)
    $ex = $ErrorRecord.Exception
    try {
        if ($ex.Response -and $ex.Response.StatusCode) { return "answered HTTP $([int]$ex.Response.StatusCode)" }
    } catch { }
    $detail = "$($ex.Message)"
    $status = ''
    try { $status = "$($ex.Status)" } catch { }
    if ($status -match 'TrustFailure|SecureChannelFailure') { return "TLS or certificate failure: $detail" }
    if ($status -match 'ConnectFailure')                    { return "nothing listening yet: $detail" }
    if ($status -match 'Timeout')                           { return "timed out: $detail" }
    if ($detail -match 'actively refused|ConnectionRefused|No connection could be made') { return "nothing listening yet: $detail" }
    if ($detail -match 'SSL|TLS|certificate|secure channel|underlying connection was closed') { return "TLS or certificate failure: $detail" }
    return $detail
}

# Best-effort end-to-end check that nginx serves the app. Self-signed cert on first boot, so
# certificate validation is bypassed for this one localhost call and restored afterward.
function Test-AfctHttpHealth {
    param([AllowNull()][Nullable[DateTime]]$Deadline)

    $skipCert     = Test-AfctSkipCertSupported
    $prevPolicy   = Enable-AfctSelfSignedTrust
    $prevProtocol = [System.Net.ServicePointManager]::SecurityProtocol
    try {
        # 5.1 still negotiates SSL3/TLS1.0 by default on some builds while nginx offers
        # TLS 1.2. Ignored by 7, which does not read ServicePointManager.
        try { [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12 }
        catch { Write-AfctTrace "health probe: could not select TLS 1.2: $($_.Exception.Message)" }

        foreach ($scheme in 'https', 'http') {
            $budget = 10
            if ($null -ne $Deadline) {
                $left = Get-AfctRemainingSeconds $Deadline
                if ($left -le 0) {
                    Write-AfctTrace 'health probe: skipped, no time left in the budget'
                    return $false
                }
                $budget = [Math]::Min(10, [Math]::Max(1, $left))
            }
            $request = @{
                Uri             = "${scheme}://localhost$HealthPath"
                TimeoutSec      = $budget
                UseBasicParsing = $true
            }
            if ($skipCert) { $request['SkipCertificateCheck'] = $true }
            try {
                Invoke-WebRequest @request | Out-Null
                Write-AfctTrace "health probe: $scheme answered"
                return $true
            } catch {
                # Never silent. This is the check that decides whether the install succeeded,
                # and "the web service did not answer" on its own tells nobody anything.
                Write-AfctTrace "health probe: $scheme failed: $(Get-AfctHttpFailureReason $_)"
            }
        }
        return $false
    } finally {
        if ($null -ne $prevPolicy) { [System.Net.ServicePointManager]::CertificatePolicy = $prevPolicy }
        [System.Net.ServicePointManager]::SecurityProtocol = $prevProtocol
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
        # Required services only, for the same two reasons the recovery check uses it. The
        # verdict is computed over required services anyway, so an optional inspection can
        # only take budget from the HTTP probe that runs after this loop. And there is
        # nothing to find: the updater is not started until after this wait succeeds.
        $state = Get-AfctStackState -RequiredOnly -SkipHttp -Deadline $deadline

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
    Get-AfctImages -AllowCachedFallback
    Invoke-AfctStartAndWait
}

function Invoke-AfctRestartStack {
    Test-AfctComposeConfig
    Invoke-AfctStartAndWait
}
