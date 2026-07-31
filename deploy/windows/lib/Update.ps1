# Update.ps1 - application update (with image rollback), release pinning, the in-app updater
# sidecar, and tooling self-update for the AFCT Windows controller.
#
# Dot-sourced by afctctl.ps1. Depends on Output.ps1, Docker.ps1, Compose.ps1, Environment.ps1.
# Reads controller globals ($EnvFile, $UpdaterService, $InstallerBaseUrl, $Prefix,
# $ReleaseDir, $InstallerVersion). Windows PowerShell 5.1 compatible.

Set-StrictMode -Version Latest

$script:AfctImageSnapshot = @()

# --- release manifest + pinning ----------------------------------------------------------
# Download a URL to a file with a bounded timeout and a few retries. Returns $true/$false;
# never throws. TLS 1.2 is opted in because older 5.1 defaults break raw.githubusercontent.
function Get-AfctRemoteFile {
    param([string]$Url, [string]$Dest)
    try {
        [Net.ServicePointManager]::SecurityProtocol =
            [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    } catch { }
    for ($i = 1; $i -le 3; $i++) {
        try {
            $prev = $ProgressPreference
            $ProgressPreference = 'SilentlyContinue'
            try { Invoke-WebRequest -Uri $Url -OutFile $Dest -TimeoutSec 120 -UseBasicParsing -ErrorAction Stop | Out-Null }
            finally { $ProgressPreference = $prev }
            return $true
        } catch {
            if ($i -lt 3) { Start-Sleep -Seconds 2 }
        }
    }
    return $false
}

# Every curated release tag from versions.json (newest first), excluding the rolling "main"
# build. Empty when the manifest cannot be fetched or parsed.
function Get-AfctReleaseTags {
    $tmp = Join-Path $env:TEMP "afct-versions.$PID.json"
    try {
        if (-not (Get-AfctRemoteFile "$InstallerBaseUrl/versions.json" $tmp)) { return @() }
        if (-not (Test-Path -LiteralPath $tmp) -or (Get-Item -LiteralPath $tmp).Length -eq 0) { return @() }
        $data = (Get-Content -LiteralPath $tmp -Raw -ErrorAction Stop) | ConvertFrom-Json -ErrorAction Stop
        if (-not ($data.PSObject.Properties['versions'])) { return @() }
        $tags = @()
        foreach ($v in @($data.versions)) {
            if ($v -and $v.PSObject.Properties['tag']) {
                $t = $v.tag
                if ($t -and $t -cne 'main') { $tags += $t }
            }
        }
        return $tags
    } catch {
        return @()
    } finally {
        Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    }
}

# On a fresh install, pin AFCT_APP_TAG to a published RELEASE (never the rolling "main"
# build) so a box runs a reproducible version. An explicit AFCT_APP_TAG is honored only if
# it names a real release (validated against the manifest when reachable). An existing
# release pin is left alone.
function Set-AfctReleasePin {
    $existing = Read-AfctEnvValue 'AFCT_APP_TAG' $EnvFile
    if ($existing -and $existing -cne 'main') { return }

    $want = [Environment]::GetEnvironmentVariable('AFCT_APP_TAG')
    if (-not $want) { $want = '' }
    if ($want -ceq 'main') {
        throw 'afct-fatal: AFCT_APP_TAG=main is not allowed: the installer deploys published releases only. Set AFCT_APP_TAG to a release (for example v0.1.1), or leave it unset to install the latest.'
    }

    $releases = @(Get-AfctReleaseTags)
    if ($want) {
        if ($want -match '[^A-Za-z0-9._-]') { throw 'afct-fatal: AFCT_APP_TAG contains unsupported characters.' }
        if ($releases.Count -gt 0 -and ($releases -cnotcontains $want)) {
            throw "afct-fatal: AFCT_APP_TAG='$want' is not a published release. Known releases: $($releases -join ' ')."
        }
        $tag = $want
    } else {
        if ($releases.Count -eq 0) {
            throw "afct-fatal: could not determine the latest release to install (is $InstallerBaseUrl/versions.json reachable?). Re-run with AFCT_APP_TAG=vX.Y.Z to pin a specific release."
        }
        $tag = $releases[0]
    }
    Set-AfctEnvFlag 'AFCT_APP_TAG' $tag $EnvFile
    Write-AfctInfo "pinned this install to release $tag. Change it later from Admin -> System Settings -> Updates."
}

# --- update with automatic image rollback ------------------------------------------------
function Save-AfctRunningImages {
    $script:AfctImageSnapshot = @()
    $references = Invoke-AfctCompose config --images
    if ($LASTEXITCODE -ne 0) { $references = @() }
    foreach ($reference in $references) {
        if (-not $reference) { continue }
        $id = (& docker image inspect -f '{{.Id}}' $reference 2>&1 | ForEach-Object { "$_" } | Select-Object -First 1)
        if ($LASTEXITCODE -eq 0 -and $id) {
            $script:AfctImageSnapshot += [pscustomobject]@{ Reference = $reference; Id = $id }
        }
    }
    if ($script:AfctImageSnapshot.Count -gt 0) { Write-AfctInfo 'recorded the currently deployed image IDs for automatic rollback.' }
    else { Write-AfctWarn 'no existing image snapshot could be recorded; automatic rollback may be unavailable.' }
}

function Restore-AfctPreviousImages {
    if ($script:AfctImageSnapshot.Count -eq 0) { return $false }
    Write-AfctWarn 'restoring the previously deployed container images...'
    foreach ($entry in $script:AfctImageSnapshot) {
        & docker image tag $entry.Id $entry.Reference *> $null
        if ($LASTEXITCODE -ne 0) { return $false }
    }
    Invoke-AfctCompose up -d | Out-Null
    if ($LASTEXITCODE -ne 0) { return $false }
    try { Wait-AfctHealth; Write-AfctSuccess 'The previous AFCT images were restored successfully.'; return $true }
    catch { return $false }
}

# Delete AFCT images that are neither running nor needed for rollback. Protected images are
# kept by ID; anything not positively identified is kept. -ProtectTag names a previous
# release whose images are also kept (the operator's downgrade path after a pinned
# update, which the snapshot does not cover). Never fails the update.
function Remove-AfctSupersededImages {
    param([string]$ProtectTag)
    try {
        $keepIds = @{}
        foreach ($entry in $script:AfctImageSnapshot) { if ($entry.Id) { $keepIds[$entry.Id] = $true } }
        $current = Invoke-AfctCompose config --images
        if ($LASTEXITCODE -eq 0) {
            foreach ($reference in $current) {
                if (-not $reference) { continue }
                $id = (& docker image inspect -f '{{.Id}}' $reference 2>&1 | ForEach-Object { "$_" } | Select-Object -First 1)
                if ($LASTEXITCODE -eq 0 -and $id) { $keepIds[$id] = $true }
            }
        }
        if ($ProtectTag) {
            $saved = [Environment]::GetEnvironmentVariable('AFCT_APP_TAG')
            try {
                $env:AFCT_APP_TAG = $ProtectTag
                $previous = Invoke-AfctCompose config --images
                if ($LASTEXITCODE -eq 0) {
                    foreach ($reference in $previous) {
                        if (-not $reference) { continue }
                        $id = (& docker image inspect -f '{{.Id}}' $reference 2>&1 | ForEach-Object { "$_" } | Select-Object -First 1)
                        if ($LASTEXITCODE -eq 0 -and $id) { $keepIds[$id] = $true }
                    }
                }
            } finally {
                if ($null -eq $saved) { Remove-Item Env:\AFCT_APP_TAG -ErrorAction SilentlyContinue }
                else { $env:AFCT_APP_TAG = $saved }
            }
        }
        if ($keepIds.Count -eq 0) { return }
        $rows = & docker images --no-trunc --format '{{.ID}}|{{.Repository}}:{{.Tag}}' 2>&1 | ForEach-Object { "$_" }
        if ($LASTEXITCODE -ne 0) { return }
        $removed = 0
        foreach ($row in $rows) {
            if (-not $row) { continue }
            $id, $reference = $row -split '\|', 2
            if (-not $reference) { continue }
            if ($reference -notmatch '/afct-') { continue }
            if ($reference -match '<none>') { continue }
            if ($keepIds.ContainsKey($id)) { continue }
            & docker rmi $reference *> $null
            if ($LASTEXITCODE -eq 0) { $removed++ }
        }
        & docker image prune -f *> $null
        if ($removed -gt 0) {
            $free = Get-AfctDockerFreeBytes
            $suffix = ''
            if ($free) { $suffix = (" ({0:N1} GB free)" -f ($free / 1GB)) }
            Write-AfctInfo ("removed {0} superseded AFCT image(s){1}." -f $removed, $suffix)
        }
    } catch {
        Write-AfctWarn 'could not clean up superseded images; the update itself succeeded.'
    }
}

# Compose interpolation prefers a process-level AFCT_APP_TAG over the value in the env
# file, so a pinned update ($env:AFCT_APP_TAG = 'vX.Y.Z'; afctctl update) deploys that tag
# while the file keeps the old pin, and the next plain update would silently redeploy the
# OLD release. After a healthy deploy, record the effective tag back to the env file. The
# rolling "main" is never recorded: pins name published releases only, matching
# Set-AfctReleasePin.
function Save-AfctDeployedAppTag {
    param([string]$File)
    $deployed = [Environment]::GetEnvironmentVariable('AFCT_APP_TAG')
    if (-not $deployed) { return }
    if ((Read-AfctEnvValue 'AFCT_APP_TAG' $File) -ceq $deployed) { return }
    if ($deployed -ceq 'main') {
        Write-AfctWarn "deployed the rolling main build without recording it as a pin (pins name published releases only). A plain 'afctctl update' will redeploy the release pinned in $File."
        return
    }
    if ($deployed -match '[^A-Za-z0-9._-]') {
        Write-AfctWarn "AFCT_APP_TAG contains unsupported characters; not recording it in $File."
        return
    }
    Set-AfctEnvFlag 'AFCT_APP_TAG' $deployed $File
    Write-AfctInfo "recorded the deployed version (AFCT_APP_TAG=$deployed) in $File."
}

# Redeploy the release that was pinned before this update. The image snapshot only
# covers same-tag updates (it re-tags recorded IDs under the deployed references), so a
# failed PINNED update to a different tag has nothing to re-tag; its rollback is simply
# recreating the stack on the previous tag, whose images are still local.
function Restore-AfctPreviousRelease {
    param([string]$Tag)
    Write-AfctWarn "restoring the previously pinned release $Tag..."
    $saved = [Environment]::GetEnvironmentVariable('AFCT_APP_TAG')
    try {
        $env:AFCT_APP_TAG = $Tag
        Invoke-AfctCompose up -d | Out-Null
        if ($LASTEXITCODE -ne 0) { return $false }
        Wait-AfctHealth
        Write-AfctSuccess "The previously pinned AFCT release ($Tag) was restored."
        return $true
    } catch {
        return $false
    } finally {
        if ($null -eq $saved) { Remove-Item Env:\AFCT_APP_TAG -ErrorAction SilentlyContinue }
        else { $env:AFCT_APP_TAG = $saved }
    }
}

function Invoke-AfctUpdate {
    Assert-AfctStack
    $prevTag = Read-AfctEnvValue 'AFCT_APP_TAG' $EnvFile
    if (-not $prevTag) { $prevTag = 'main' }
    $targetTag = [Environment]::GetEnvironmentVariable('AFCT_APP_TAG')
    if (-not $targetTag) { $targetTag = $prevTag }
    if ($targetTag -cne $prevTag) { Write-AfctInfo "updating AFCT from $prevTag to the pinned $targetTag..." }
    else { Write-AfctInfo "updating AFCT to the latest published $targetTag images..." }
    Test-AfctComposeConfig
    Assert-AfctUpdateDiskSpace
    Save-AfctRunningImages
    Get-AfctImages

    $ok = $true
    $failReason = ''
    try { Start-AfctStack; Wait-AfctHealth } catch {
        $ok = $false
        $failReason = ($_.Exception.Message -replace '^afct-fatal:\s*', '')
    }

    if ($ok) {
        Save-AfctDeployedAppTag $EnvFile
        Write-AfctSuccess 'AFCT update completed.'
        # The previous tag stays protected as the operator's downgrade path.
        Remove-AfctSupersededImages -ProtectTag $prevTag
        return
    }

    Write-AfctError "AFCT $targetTag did not pass its health check."
    if ($failReason) { Write-AfctError $failReason }
    try { Invoke-AfctDiagnostics -Reason "failed-update-from-$prevTag-to-$targetTag" | Out-Null }
    catch { Write-AfctWarn 'could not collect a diagnostics archive.' }

    if (Restore-AfctPreviousImages) {
        Write-AfctWarn 'the update failed, but AFCT was returned to the previously deployed images.'
        exit 1
    }
    if (($targetTag -cne $prevTag) -and (Restore-AfctPreviousRelease $prevTag)) {
        Write-AfctWarn "the update to $targetTag failed, but AFCT was returned to $prevTag."
        exit 1
    }
    throw 'afct-fatal: the update failed and automatic rollback was unsuccessful. Review the logs with: afctctl logs'
}

# --- in-app updater sidecar --------------------------------------------------------------
# Set the flag and pull+start the updater. Returns $false on failure so the caller decides
# whether that is fatal (a standalone enable) or a warning (during install).
function Start-AfctUpdater {
    Set-AfctEnvFlag 'AFCT_UPDATER_ENABLED' 'true' $EnvFile
    Write-AfctInfo 'downloading the updater image...'
    if (-not [Console]::IsOutputRedirected) { $code = Invoke-AfctComposeConsole pull $UpdaterService }
    else { Invoke-AfctCompose pull $UpdaterService | Out-Null; $code = $LASTEXITCODE }
    if ($code -ne 0) { return $false }
    Write-AfctInfo 'starting the updater...'
    Invoke-AfctCompose up -d $UpdaterService | Out-Null
    return ($LASTEXITCODE -eq 0)
}

function Invoke-AfctEnableUpdater {
    param([bool]$Yes, [bool]$NonInteractive)
    Assert-AfctStack
    Write-AfctInfo 'Enabling the in-app updater (EXPERIMENTAL on Windows).'
    Write-AfctWarn 'the updater container holds the Docker socket, which is root-equivalent on this host. Enable it only if you want to run upgrades and downgrades from Admin -> System Settings.'
    if ((-not $Yes) -and (-not $NonInteractive) -and (-not [Console]::IsInputRedirected)) {
        $a = Read-Host 'Enable the in-app updater now? [Y/n]'
        if ($a -match '^(n|no)$') { throw 'afct-fatal: left the updater disabled.' }
    }
    if (-not (Start-AfctUpdater)) {
        throw "afct-fatal: could not pull or start the updater image. If the afct-updater package is private, make it public or run 'docker login ghcr.io'."
    }
    Write-AfctSuccess 'in-app updater enabled. Manage versions in Admin -> System Settings -> Updates.'
}

# Offer to enable the updater at the end of a guided install (or honor -WithUpdater).
# Non-fatal: the base stack is already healthy. EXPERIMENTAL on Windows.
function Invoke-AfctMaybeEnableUpdater {
    param([bool]$WithUpdater, [bool]$NonInteractive)
    if ((Read-AfctEnvValue 'AFCT_UPDATER_ENABLED' $EnvFile) -eq 'true') { return }
    if (-not $WithUpdater) {
        if ($NonInteractive -or [Console]::IsInputRedirected) { return }
        Write-AfctInfo 'Optional: the in-app updater sidecar lets admins upgrade and downgrade AFCT from'
        Write-AfctInfo 'System Settings. It holds the Docker socket (root-equivalent on this host), and is'
        Write-AfctInfo 'EXPERIMENTAL on Windows, so it is off unless you turn it on.'
        $a = Read-Host 'Enable the in-app updater now? [y/N]'
        if ($a -notmatch '^(y|yes)$') { Write-AfctInfo 'skipped. Enable it later with: afctctl enable-updater'; return }
    }
    if (Start-AfctUpdater) { Write-AfctSuccess 'in-app updater enabled.' }
    else {
        Set-AfctEnvFlag 'AFCT_UPDATER_ENABLED' 'false' $EnvFile
        Write-AfctWarn 'could not start the updater (its image may be private or unpublished). The rest of AFCT is running; enable it later with: afctctl enable-updater'
    }
}

function Invoke-AfctDisableUpdater {
    Assert-AfctStack
    Write-AfctInfo 'disabling the in-app updater...'
    Invoke-AfctCompose rm -sf $UpdaterService | Out-Null
    Set-AfctEnvFlag 'AFCT_UPDATER_ENABLED' 'false' $EnvFile
    Write-AfctSuccess 'in-app updater disabled and its container removed.'
}

# --- tooling self-update -----------------------------------------------------------------
# Update the deployment tooling itself to the newest verified bundle. Downloads the Windows
# bootstrap from the release assets and runs it in switch-only mode, which fetches the newest
# bundle, verifies its SHA-256, publishes an immutable release, switches the active pointer,
# and rolls back if the new controller fails validation. Data and the running stack are not
# touched.
function Invoke-AfctSelfUpdate {
    $bootstrapUrl = [Environment]::GetEnvironmentVariable('AFCT_BOOTSTRAP_URL')
    if (-not $bootstrapUrl) { $bootstrapUrl = "$InstallerBaseUrl/install-windows.ps1" }
    Write-AfctInfo "refreshing the AFCT deployment tooling from $bootstrapUrl ..."
    $tmp = Join-Path $env:TEMP "afct-bootstrap.$PID.ps1"
    try {
        if (-not (Get-AfctRemoteFile $bootstrapUrl $tmp)) {
            throw 'afct-fatal: could not download the deployment bootstrap. Check network access to the repository.'
        }
        $parseErrors = $null
        try { [System.Management.Automation.Language.Parser]::ParseFile($tmp, [ref]$null, [ref]$parseErrors) | Out-Null }
        catch { $parseErrors = @($_) }
        if ((-not (Test-Path -LiteralPath $tmp)) -or ((Get-Item -LiteralPath $tmp).Length -eq 0) -or
            ($parseErrors -and $parseErrors.Count -gt 0)) {
            throw 'afct-fatal: the downloaded bootstrap is invalid; keeping the current tooling.'
        }
        # Target this install and only switch the tooling (no stack deploy).
        $env:AFCT_PREFIX = $Prefix
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $tmp -SwitchOnly
        if ($LASTEXITCODE -ne 0) { throw 'afct-fatal: the self-update failed; the previous tooling is still active.' }
        Write-AfctSuccess 'The AFCT deployment tooling was updated. Apply any new image or Compose changes with: afctctl update'
    } finally {
        Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    }
}
