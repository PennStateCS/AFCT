# Deploy.ps1 - the install flow and stack operations for the AFCT Windows controller.
#
# Dot-sourced by afctctl.ps1. Depends on Output.ps1, Docker.ps1, Compose.ps1, Config.ps1,
# Environment.ps1, Update.ps1 (release pin + updater). Reads controller globals ($EnvFile,
# $EnvExample, $RuntimeCompose, $ComposeTemplate, $Prefix, $SharedDir, $AppService,
# $InstallerVersion). Windows PowerShell 5.1 compatible.

Set-StrictMode -Version Latest

# Guard for the operational commands: the runtime Compose file and the env file must exist
# and Docker Desktop must be reachable.
function Assert-AfctStack {
    if (-not (Test-Path -LiteralPath $RuntimeCompose)) {
        # Seed it from the active release if the template is present; otherwise the install
        # never completed.
        if (Test-Path -LiteralPath $ComposeTemplate) { Sync-AfctRuntimeCompose | Out-Null }
        else { throw 'afct-fatal: no runtime Compose file was found. Run: afctctl install' }
    }
    if (-not (Test-Path -LiteralPath $EnvFile)) { throw 'afct-fatal: no configuration was found. Run: afctctl install' }
    Assert-AfctDockerReady
}

# The persistent volume names this deployment would reuse.
#
# Read straight out of the Compose file's top-level `volumes:` block rather than asked of
# `docker compose config --volumes`, and that is the whole point of this function existing.
# `config` interpolates the environment, so it fails when .env.production is missing, which
# is precisely the situation the caller below is trying to detect. The guard that protects a
# database from being orphaned cannot be the one that goes quiet when the configuration is
# gone.
#
# The names in that block are literals, so no interpolation is needed to read them.
function Get-AfctDeclaredVolumes {
    if (-not (Test-Path -LiteralPath $RuntimeCompose)) { return @() }
    $names = @()
    $inVolumes = $false
    foreach ($line in (Get-Content -LiteralPath $RuntimeCompose -ErrorAction SilentlyContinue)) {
        if ($line -match '^volumes:\s*$') { $inVolumes = $true; continue }
        if (-not $inVolumes) { continue }
        # Any other top-level key ends the block.
        if ($line -match '^\S') { break }
        if ($line -match '^\s{2}([A-Za-z0-9][A-Za-z0-9._-]*):') { $names += $Matches[1] }
    }
    return $names
}

# Existing AFCT data volumes but a missing/incomplete config: generating new credentials
# would orphan the database, so route the user to `recover`.
function Test-AfctDataWithoutConfig {
    if ((Test-Path -LiteralPath $EnvFile) -and (Test-AfctEnvFileComplete $EnvFile)) { return $false }

    # Deliberately NOT short-circuited on "is Docker ready?". That check is one bounded
    # `docker info`, and a slow daemon that misses the bound used to return $false here,
    # which is permission to generate fresh credentials: the same branch as "I looked and
    # there is nothing", for a question nobody actually answered. The bounded `volume ls`
    # below is the real check and it fails closed, so an unavailable daemon now stops the
    # install with a message instead of quietly risking the database. Callers reach this
    # only after Assert-AfctDockerReady has already passed.

    $volumes = Get-AfctDeclaredVolumes
    if (-not $volumes) { return $false }

    # Match only the volumes THIS project would reuse. Compose names them "<project>_<volume>",
    # so an exact name match ignores AFCT volumes left behind by an install under a different
    # project name (harmless leftovers that must not block a fresh, non-colliding install).
    # Matching by suffix across every project was the old bug.
    $project = Get-AfctComposeProject
    if (-not $project) { return $false }

    # Bounded, and a non-answer stops the install rather than being read as "no data".
    #
    # $false here is permission to generate fresh database credentials. Against an existing
    # PostgreSQL volume that orphans every record in it, which is the single worst thing this
    # installer can do, so "I could not find out" must never take the same branch as "I
    # looked and there is nothing". Test-AfctDockerReady above has already established the
    # daemon answers, so reaching this is a daemon that has stopped answering mid-check:
    # rare, recoverable, and worth stopping for.
    $listed = Invoke-AfctDockerBounded volume ls --format '{{.Name}}'
    if ($listed.TimedOut -or $listed.ExitCode -ne 0) {
        throw 'afct-fatal: AFCT could not verify whether existing data volumes are present, so it stopped rather than risk generating new database credentials for an existing database. Restart Docker Desktop and run the installer again. No new credentials were generated.'
    }
    $existing = @($listed.StdOut | ForEach-Object { "$_".Trim() } | Where-Object { $_ })

    foreach ($volume in $volumes) {
        if (-not $volume) { continue }
        if ($existing -contains "${project}_$volume") { return $true }
    }
    return $false
}

# --------------------------------------------------------------------------- #
# Rerunning the installer
# --------------------------------------------------------------------------- #

# Is the deployment already up, at the version this install is pinned to?
#
# A rerun after an apparent hang used to replay the whole startup, including the part that
# hung, because nothing ever asked whether the stack was already running. The tester who
# prompted this work reran the installer with all five containers up and healthy and watched
# it stop at the same line.
#
# "Container exists" is not the question. Every expected service has to be ready on its own
# terms, the application has to answer over HTTP, and the running image has to be the pinned
# one, or the rerun does the work. Anything short of that falls through to a normal startup,
# which is also what repairs a partial stack: `up` reconciles what is missing and leaves what
# is already correct alone.
function Test-AfctDeploymentReady {
    if (-not (Test-Path -LiteralPath $RuntimeCompose)) { return $false }
    $state = Get-AfctStackState
    Write-AfctTrace "deployment state: $(Format-AfctStackState $state)"
    if (-not $state.AllReady) { return $false }
    if (-not $state.ImageMatches) {
        Write-AfctInfo "the running application is not the pinned version ($($state.ExpectedTag)); it will be redeployed."
        return $false
    }
    if (-not $state.HttpOk) {
        Write-AfctInfo 'the containers are running but the web service did not answer; the stack will be restarted.'
        return $false
    }
    return $true
}

# Bring the stack up, or skip it when the deployment is already the one being asked for.
#
# Nothing here stops, removes or recreates anything, and no configuration is rewritten: the
# only two outcomes are "start it" and "leave it alone".
function Invoke-AfctEnsureDeployed {
    param([bool]$ForceReconcile)

    # A new deployment-tool release can change the Compose definition itself: mounts,
    # environment, health checks, security options, resource limits, networking, the
    # container command. The new file is on disk the moment the release is installed, and
    # the running containers know nothing about it. Skipping `up` because they look healthy
    # would leave a deployment permanently running a configuration that no longer exists on
    # disk, and the next thing to notice would be a support request.
    #
    # So a changed Compose file always gets one reconciliation pass. `up --detach` is the
    # whole of it: Compose recreates only the services whose definition actually changed and
    # leaves the rest alone. Nothing is stopped first, nothing is removed, no volume is
    # touched.
    if ($ForceReconcile) {
        Write-AfctInfo 'the deployment configuration changed with this release; applying it to the running containers...'
        Write-AfctTrace 'startup forced: runtime compose file changed'
        Invoke-AfctDeployStack
        return
    }
    if (Test-AfctDeploymentReady) {
        Write-AfctSuccess 'AFCT is already running and healthy at the expected version.'
        Write-AfctTrace 'startup skipped: deployment already ready'
        return
    }
    Invoke-AfctDeployStack
}

# Collect diagnostics after a startup failure, then re-throw what actually went wrong.
#
# The failure is the thing the operator needs, so it stays the error. Diagnostics are a
# best-effort extra: if collecting them fails as well, that is reported as a note and the
# original error still comes out unchanged, because replacing a real startup failure with
# "could not collect diagnostics" would be strictly worse than having no bundle.
function Invoke-AfctDeployWithDiagnostics {
    param([bool]$ForceReconcile)
    try {
        Invoke-AfctEnsureDeployed -ForceReconcile:$ForceReconcile
    } catch {
        # Report the failure first, so the reason is on screen above the diagnostics run
        # rather than after it, then re-throw under the "already reported" sentinel so the
        # controller exits nonzero without printing the same line a second time.
        $message = "$($_.Exception.Message)" -replace '^afct-fatal:\s*', ''
        Write-AfctError $message
        try {
            Write-AfctInfo 'Collecting diagnostics...'
            Invoke-AfctDiagnostics 'startup-failure' | Out-Null
        } catch {
            Write-AfctWarn "diagnostics could not be collected: $($_.Exception.Message)"
        }
        throw "afct-reported: $message"
    }
}

function Show-AfctCompletion {
    param([hashtable]$Config)
    Write-AfctInfo ''
    Write-AfctSuccess 'AFCT Dashboard is ready.'
    Write-AfctInfo "Open:          $($Config.AppUrl)"
    Write-AfctInfo "Administrator: $($Config.AdminEmail)"
    if ($Config.PasswordGenerated) {
        # Never route the generated password through the log; console only.
        Write-Host ''
        Write-Host "Generated administrator password: $($Config.AdminPassword)" -ForegroundColor Cyan
        Write-Host 'Save this password now. It is intentionally not written to any log.' -ForegroundColor Cyan
    }
    Write-AfctInfo ''
    Write-AfctInfo 'Useful commands: afctctl status | doctor | logs | update | diagnostics'
    Write-AfctInfo 'A self-signed certificate may trigger a browser warning until a trusted certificate is configured.'
    Write-AfctInfo "Tip: in Docker Desktop, enable 'Start Docker Desktop when you log in' so AFCT comes back after a reboot."
}

function Invoke-AfctInstall {
    param([bool]$Yes, [bool]$NonInteractive, [bool]$Reconfigure, [bool]$WithUpdater)

    Assert-AfctDockerReady
    # Captured, not discarded: whether this release changed the Compose definition decides
    # whether a healthy-looking stack may be left alone below.
    $composeChanged = [bool](Sync-AfctRuntimeCompose)

    Test-AfctInstallDiskSpace
    if (-not (Test-AfctClockSync)) {
        Write-AfctWarn 'the Windows Time service is not running. Incorrect time can break TLS and authentication.'
    }

    # Docker Desktop must be able to bind-mount the install directories, or `up` fails later
    # with a confusing error. Catch it now, before the stack starts.
    Assert-AfctBindMounts @($SharedDir, $RuntimeDir)

    if (Test-AfctDataWithoutConfig) {
        throw "afct-fatal: existing AFCT data volumes were detected, but $EnvFile is missing or incomplete. Restore a protected configuration backup with 'afctctl recover' instead of generating new database credentials."
    }

    $existingComplete = (Test-Path -LiteralPath $EnvFile) -and (Test-AfctEnvFileComplete $EnvFile)
    $reconfiguring = $Reconfigure -or ($existingComplete -and $Reconfigure)

    if ($existingComplete -and -not $Reconfigure) {
        # A complete config already exists: warn about ports only if fresh, then just deploy.
        Write-AfctInfo "using the existing $EnvFile. Pass -Reconfigure to replace managed settings."
        # This path deploys without rewriting the file, so the keys have to be topped up
        # here. Either one that actually writes has changed the environment the running
        # containers were started with, so the stack has to be handed the new value instead
        # of being left alone as healthy. Called, not written, is not a change: an existing
        # key returns false and nothing is recreated.
        $secretAdded = [bool](Confirm-AfctSecretKey $EnvFile)
        $backupAdded = [bool](Confirm-AfctBackupKey $EnvFile)
        $force = $composeChanged -or $secretAdded -or $backupAdded
        Invoke-AfctDeployWithDiagnostics -ForceReconcile:$force
        $cfg = @{
            AppUrl = (Read-AfctEnvValue 'NEXTAUTH_URL' $EnvFile)
            AdminEmail = (Read-AfctEnvValue 'ADMIN_EMAIL' $EnvFile)
            AdminPassword = ''; PasswordGenerated = $false
        }
        Show-AfctCompletion $cfg
        Invoke-AfctMaybeEnableUpdater -WithUpdater:$WithUpdater -NonInteractive:$NonInteractive
        return
    }
    if (-not $existingComplete -and (Test-Path -LiteralPath $EnvFile)) {
        Write-AfctWarn "$EnvFile is incomplete and will be rebuilt after a backup is created."
    }

    if ($existingComplete) { $reconfiguring = $true }

    foreach ($port in 80, 443) {
        if ((-not $existingComplete) -and (Test-AfctPortInUse $port)) {
            Write-AfctWarn "TCP port $port is already in use. The AFCT web service may be unable to bind it."
        }
    }

    if ($reconfiguring) { $cfg = Get-AfctReconfigureConfig $EnvFile $Prefix $NonInteractive }
    else { $cfg = Get-AfctNewInstallConfig $EnvFile $Prefix $NonInteractive }

    Backup-AfctEnvFile $EnvFile | Out-Null
    Write-AfctEnvironmentFile $EnvFile $cfg $EnvExample $InstallerVersion
    Write-AfctSuccess "Configuration written to $EnvFile."
    # The configuration the containers were started with has just been replaced, so this
    # deployment always reconciles. Without it, `afctctl install -Reconfigure` against a
    # healthy stack whose Compose file happened not to change wrote a new .env.production
    # and then skipped `up`, leaving the containers running the settings the operator had
    # just replaced and nothing on screen to say so.
    $envRewritten = $true

    # Fresh install only: pin to a published release before pulling images. Reconfigure
    # leaves the running version alone.
    if (-not $reconfiguring) { Set-AfctReleasePin }

    Invoke-AfctDeployWithDiagnostics -ForceReconcile:($composeChanged -or $envRewritten)
    Show-AfctCompletion $cfg
    Invoke-AfctMaybeEnableUpdater -WithUpdater:$WithUpdater -NonInteractive:$NonInteractive
}

function Show-AfctStatus {
    Assert-AfctStack
    Invoke-AfctCompose ps | ForEach-Object { Write-Host $_ }
    $state = Get-AfctAppContainerState
    if (-not $state) { Write-AfctWarn "the $AppService container is not running."; exit 1 }
    $containerState, $healthState = $state -split '\|', 2
    Write-AfctInfo "application state: $containerState"
    Write-AfctInfo "application health: $healthState"
}

function Show-AfctLogs {
    Assert-AfctStack
    Write-AfctInfo "following $AppService logs; press Ctrl+C to stop..."
    Invoke-AfctComposeConsole logs -f --tail 200 $AppService | Out-Null
}

function Invoke-AfctRestart {
    Assert-AfctStack
    Write-AfctInfo 'recreating the AFCT stack...'
    Invoke-AfctRestartStack
    Write-AfctSuccess 'AFCT restart completed.'
}

function Invoke-AfctStop {
    Assert-AfctStack
    Write-AfctInfo 'stopping the AFCT stack...'
    Invoke-AfctCompose stop | ForEach-Object { Write-Host $_ }
    if ($LASTEXITCODE -ne 0) { throw 'afct-fatal: the AFCT stack could not be stopped.' }
    Write-AfctSuccess 'AFCT stopped. Persistent data volumes were not deleted.'
}
