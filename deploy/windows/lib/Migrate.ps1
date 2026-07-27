# Migrate.ps1 - import a legacy flat-directory AFCT installation into the new
# %LOCALAPPDATA%\AFCT layout.
#
# Dot-sourced by afctctl.ps1. Depends on Output.ps1, Environment.ps1, Docker.ps1. Reads
# controller globals ($Prefix, $SharedDir, $EnvFile, $RuntimeCompose). Windows PowerShell
# 5.1 compatible.
#
# The previous Windows installer used a flat directory (install.ps1, docker-compose.yml,
# .env.production, .env.production.backup.*, install.log) and ran `docker compose` from it.
# This importer seeds the new shared configuration from that directory WITHOUT touching it:
# the exact .env.production and its backups are copied over, the Compose project name is
# preserved so existing data volumes reattach, and infrastructure secrets and the release
# pin are carried across verbatim. It never generates new database credentials. The legacy
# directory is left unchanged; the caller deploys the imported configuration and, on
# success, the operator can archive or remove the old directory by hand.

Set-StrictMode -Version Latest

# The keys AFCT cannot run without (same set Test-AfctEnvFileComplete checks).
function Test-AfctLegacyLooksLikeAfct {
    param([string]$Dir)
    if (-not (Test-Path -LiteralPath (Join-Path $Dir '.env.production'))) { return $false }
    # Plus at least one other expected AFCT deployment file, so we do not treat an arbitrary
    # directory that merely contains a file named .env.production as an AFCT install.
    if (Test-Path -LiteralPath (Join-Path $Dir 'docker-compose.yml')) { return $true }
    if (Test-Path -LiteralPath (Join-Path $Dir 'install.ps1')) { return $true }
    return $false
}

# Compose v2's directory-derived project name: lowercase, keep [a-z0-9_-], drop leading
# separators. Returns '' when nothing usable remains.
function ConvertTo-AfctComposeProjectName {
    param([string]$Name)
    $n = $Name.ToLowerInvariant() -replace '[^a-z0-9_-]', ''
    $n = $n -replace '^[_-]+', ''
    return $n
}

# The Docker volume names currently present (best-effort seam the tests mock). Empty when
# Docker is unavailable.
function Get-AfctDockerVolumeNames {
    if (-not (Test-AfctDockerReady)) { return @() }
    $out = & docker volume ls --format '{{.Name}}' 2>&1 | ForEach-Object { "$_" }
    if ($LASTEXITCODE -ne 0) { return @() }
    return @($out | Where-Object { $_ })
}

# Resolve the Compose project name to preserve, from the safest available source:
#   1. COMPOSE_PROJECT_NAME in the legacy .env.production (explicit and authoritative)
#   2. PROJECT_NAME in a legacy deploy.state
#   3. the legacy directory basename, sanitized the way Compose v2 derives it
# If (1) and (2) both exist and disagree, the project is ambiguous and we stop rather than
# risk attaching to the wrong (or a brand-new, empty) set of volumes.
function Resolve-AfctLegacyProject {
    param([string]$LegacyDir)
    $legacyEnv = Join-Path $LegacyDir '.env.production'
    $fromEnv = Read-AfctEnvValue 'COMPOSE_PROJECT_NAME' $legacyEnv
    $fromState = ''
    $legacyState = Join-Path $LegacyDir 'deploy.state'
    if (Test-Path -LiteralPath $legacyState) {
        $m = Select-String -LiteralPath $legacyState -Pattern '^PROJECT_NAME=(.+)$' | Select-Object -First 1
        if ($null -ne $m) { $fromState = $m.Matches.Groups[1].Value.Trim() }
    }
    if ($fromEnv -and $fromState -and ($fromEnv -ne $fromState)) {
        throw "afct-fatal: the legacy Compose project name is ambiguous (COMPOSE_PROJECT_NAME='$fromEnv' but deploy.state PROJECT_NAME='$fromState'). Resolve this by hand, then set COMPOSE_PROJECT_NAME in the imported .env.production."
    }
    if ($fromEnv)   { return $fromEnv }
    if ($fromState) { return $fromState }
    $derived = ConvertTo-AfctComposeProjectName (Split-Path -Leaf $LegacyDir)
    if ([string]::IsNullOrEmpty($derived)) {
        throw "afct-fatal: could not determine the legacy Compose project name from '$LegacyDir'. Set COMPOSE_PROJECT_NAME in the legacy .env.production and rerun the import."
    }
    return $derived
}

function Import-AfctLegacyInstall {
    param([string]$LegacyDir)

    if ([string]::IsNullOrWhiteSpace($LegacyDir)) { throw 'afct-fatal: -ImportExisting requires the path to the legacy AFCT directory.' }
    if (-not (Test-Path -LiteralPath $LegacyDir -PathType Container)) {
        throw "afct-fatal: the legacy directory does not exist or is not a folder: $LegacyDir"
    }
    $legacy = [System.IO.Path]::GetFullPath($LegacyDir).TrimEnd('\')
    $prefixFull = [System.IO.Path]::GetFullPath($Prefix).TrimEnd('\')
    $sharedFull = [System.IO.Path]::GetFullPath($SharedDir).TrimEnd('\')

    # The legacy source must be a different place than the new installation.
    if ($legacy.Equals($prefixFull, [StringComparison]::OrdinalIgnoreCase) -or
        $legacy.Equals($sharedFull, [StringComparison]::OrdinalIgnoreCase)) {
        throw "afct-fatal: the legacy directory ($legacy) is the same as the new installation directory. Point -ImportExisting at your OLD flat install."
    }

    if (-not (Test-AfctLegacyLooksLikeAfct $legacy)) {
        throw "afct-fatal: $legacy does not look like an AFCT deployment (expected a .env.production plus a docker-compose.yml or install.ps1). Point -ImportExisting at your old AFCT deployment directory."
    }

    $legacyEnv = Join-Path $legacy '.env.production'
    try { $null = Get-Content -LiteralPath $legacyEnv -TotalCount 1 -ErrorAction Stop }
    catch { throw "afct-fatal: the legacy $legacyEnv cannot be read. $($_.Exception.Message)" }
    if (-not (Test-AfctEnvFileComplete $legacyEnv)) {
        throw "afct-fatal: the legacy $legacyEnv is incomplete (it must define POSTGRES_PASSWORD, DATABASE_URL, NEXTAUTH_SECRET, and NEXTAUTH_URL). Nothing was changed."
    }

    # Never overwrite an already-configured new installation.
    if (Test-Path -LiteralPath $EnvFile) {
        throw "afct-fatal: $EnvFile already exists; refusing to overwrite it from a legacy import. Use 'afctctl reconfigure' or start from a clean installation directory."
    }

    # Resolve the project BEFORE copying anything, so an ambiguous project stops the import
    # while the destination is still untouched.
    $project = Resolve-AfctLegacyProject $legacy

    Write-AfctInfo "importing the existing AFCT configuration from $legacy ..."
    New-Item -ItemType Directory -Path $SharedDir -Force | Out-Null

    # 1) The exact .env.production (secrets, release pin, updater flag all live here). Byte
    # copy: never rewrite or regenerate.
    Copy-Item -LiteralPath $legacyEnv -Destination $EnvFile -Force
    Protect-AfctCriticalFile $EnvFile

    # 2) Every protected configuration backup, so 'afctctl recover' still has history.
    $backups = @(Get-ChildItem -LiteralPath $legacy -Filter '.env.production.backup.*' -File -ErrorAction SilentlyContinue)
    foreach ($b in $backups) {
        $dest = Join-Path $SharedDir $b.Name
        Copy-Item -LiteralPath $b.FullName -Destination $dest -Force
        Protect-AfctCriticalFile $dest
    }
    if ($backups.Count -gt 0) { Write-AfctInfo "carried over $($backups.Count) configuration backup file(s)." }

    # 3) Preserve the Compose project name so existing data volumes reattach.
    $stateFile = Join-Path $SharedDir 'deploy.state'
    Set-Content -LiteralPath $stateFile -Value "PROJECT_NAME=$project" -Encoding ASCII
    Protect-AfctCriticalFile $stateFile
    Write-AfctInfo "preserved the Compose project name '$project'."

    # 4) Detect existing AFCT data volumes for that project (best effort; needs Docker).
    $volumes = @(Get-AfctDockerVolumeNames | Where-Object { $_ -like "${project}_*" })
    if ($volumes.Count -gt 0) {
        Write-AfctInfo "found $($volumes.Count) existing Docker volume(s) for project '$project'; they will be reused."
    } else {
        Write-AfctWarn "no existing Docker volumes were detected for project '$project' (Docker may be stopped). The import preserved your configuration; verify your data after the stack starts."
    }

    # The runtime Compose file is seeded from the active release by Sync-AfctRuntimeCompose
    # (the caller ran it), so there is nothing to copy from the legacy directory here.

    Write-AfctInfo "the legacy directory was NOT modified: $legacy"
    Write-AfctInfo "if the new deployment misbehaves, your old files are unchanged there. After you confirm the new"
    Write-AfctInfo "installation works, you may archive or remove that directory by hand."
}
