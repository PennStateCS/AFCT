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
        if (Test-Path -LiteralPath $ComposeTemplate) { Sync-AfctRuntimeCompose }
        else { throw 'afct-fatal: no runtime Compose file was found. Run: afctctl install' }
    }
    if (-not (Test-Path -LiteralPath $EnvFile)) { throw 'afct-fatal: no configuration was found. Run: afctctl install' }
    Assert-AfctDockerReady
}

# Existing AFCT data volumes but a missing/incomplete config: generating new credentials
# would orphan the database, so route the user to `recover`.
function Test-AfctDataWithoutConfig {
    if ((Test-Path -LiteralPath $EnvFile) -and (Test-AfctEnvFileComplete $EnvFile)) { return $false }
    if (-not (Test-AfctDockerReady)) { return $false }
    if (-not (Test-Path -LiteralPath $RuntimeCompose)) { return $false }
    $volumes = Invoke-AfctCompose config --volumes
    if ($LASTEXITCODE -ne 0 -or -not $volumes) { return $false }
    # Match only the volumes THIS project would reuse. Compose names them "<project>_<volume>",
    # so an exact name match ignores AFCT volumes left behind by an install under a different
    # project name (harmless leftovers that must not block a fresh, non-colliding install).
    # Matching by suffix across every project was the old bug.
    $project = Get-AfctComposeProject
    if (-not $project) { return $false }
    $existing = & docker volume ls --format '{{.Name}}' 2>&1 | ForEach-Object { "$_" }
    foreach ($volume in $volumes) {
        if (-not $volume) { continue }
        if (@($existing) -contains "${project}_$volume") { return $true }
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
    try {
        Invoke-AfctEnsureDeployed
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
    Sync-AfctRuntimeCompose

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
        # This path deploys without rewriting the file, so the key has to be topped up here.
        Confirm-AfctSecretKey $EnvFile
        Confirm-AfctBackupKey $EnvFile
        Invoke-AfctDeployWithDiagnostics
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

    # Fresh install only: pin to a published release before pulling images. Reconfigure
    # leaves the running version alone.
    if (-not $reconfiguring) { Set-AfctReleasePin }

    Invoke-AfctDeployWithDiagnostics
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
