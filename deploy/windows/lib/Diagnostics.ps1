# Diagnostics.ps1 - support-bundle collection with secret redaction for the AFCT Windows
# controller.
#
# Dot-sourced by afctctl.ps1. Depends on Output.ps1, Docker.ps1, Environment.ps1. Reads
# controller globals ($EnvFile, $RuntimeCompose, $LogFile, $SharedDir, $InstallerVersion).
# Windows PowerShell 5.1 compatible. The redaction helpers are pure (explicit paths) so
# they unit-test cleanly. Mirrors the diagnostics flow in the monolithic installer.

Set-StrictMode -Version Latest

# Copy an env file with the values of known-sensitive keys replaced. Comments and blank
# lines are preserved. Matches by key name (case-insensitive).
#
# The pattern has to be wide enough to catch a key nobody thought of and narrow enough to
# leave the settings that make the bundle worth reading. Matching a bare "AUTH" would redact
# NEXTAUTH_URL, which is the address the operator configured and the first thing anybody
# looking at a broken deployment wants to see; NEXTAUTH_SECRET is caught by SECRET anyway.
function Copy-AfctRedactedEnv {
    param([string]$Source, [string]$Destination)
    $out = foreach ($line in Get-Content -LiteralPath $Source -ErrorAction SilentlyContinue) {
        if ($line -match '^\s*#' -or $line -match '^\s*$') { $line }
        elseif ($line -match '=') {
            $key = ($line -split '=', 2)[0]
            if ($key.Trim().ToUpper() -match 'PASSWORD|PASSWD|SECRET|TOKEN|PRIVATE|CREDENTIAL|DATABASE_URL|API_KEY|_KEY$|ENCRYPTION|PASSPHRASE|SALT') { "$key=***REDACTED***" }
            else { $line }
        }
        else { $line }
    }
    Set-Content -LiteralPath $Destination -Value $out -Encoding UTF8
}

# Replace the exact values of known secrets anywhere under $Root (logs can echo them, e.g.
# a DATABASE_URL in a stack trace). $EnvFile supplies the values to hunt for.
function Hide-AfctSecretsInTree {
    param([string]$Root, [string]$EnvFile)
    if (-not (Test-Path -LiteralPath $EnvFile)) { return }
    # Every value worth hunting for by content, not only the four that used to be listed.
    # The key-name pass above hides them inside the env copy; this pass catches the same
    # values echoed anywhere else in the bundle, which is where they actually leak: a
    # DATABASE_URL in a stack trace, a key in a container log line.
    #
    # Short values are skipped. Replacing a two-character string everywhere would corrupt
    # unrelated text without protecting anything, and no real secret here is that short.
    $secrets = @()
    foreach ($key in 'POSTGRES_PASSWORD', 'DATABASE_URL', 'NEXTAUTH_SECRET', 'ADMIN_PASSWORD',
                     'AFCT_SECRET_KEY', 'BACKUP_ENCRYPTION_KEY', 'BACKUP_PASSPHRASE',
                     'SMTP_PASSWORD', 'GITHUB_TOKEN', 'REGISTRY_TOKEN') {
        $value = Read-AfctEnvValue $key $EnvFile
        if ($value -and $value.Length -ge 8) { $secrets += $value }
    }
    if (-not $secrets) { return }
    foreach ($file in Get-ChildItem -LiteralPath $Root -File -Recurse -ErrorAction SilentlyContinue) {
        try {
            $text = [System.IO.File]::ReadAllText($file.FullName)
            foreach ($secret in $secrets) { $text = $text.Replace($secret, '***REDACTED***') }
            [System.IO.File]::WriteAllText($file.FullName, $text)
        } catch { }
    }
}

function Invoke-AfctDiagnostics {
    param([string]$Reason = 'manual')
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $bundleName = "afct-diagnostics-$timestamp-$PID"
    $work = Join-Path $env:TEMP "afct-diagnostics-work-$PID"
    $bundleDir = Join-Path $work $bundleName
    Remove-Item -Recurse -Force -LiteralPath $work -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path $bundleDir -Force | Out-Null

    Write-AfctInfo 'collecting AFCT diagnostics...'

    $sysLines = @(
        "AFCT deployment tool version: $InstallerVersion",
        "Collection reason: $Reason",
        "Collected: $((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'))",
        '',
        [Environment]::OSVersion.VersionString,
        ($PSVersionTable | Out-String)
    )
    Set-Content -LiteralPath (Join-Path $bundleDir 'system.txt') -Value $sysLines -Encoding UTF8

    if (Test-AfctDockerReady) {
        & docker version *>&1 | Set-Content (Join-Path $bundleDir 'docker-version.txt')
        & docker info *>&1 | Set-Content (Join-Path $bundleDir 'docker-info.txt')
        if (Test-Path -LiteralPath $RuntimeCompose) {
            Invoke-AfctCompose ps *>&1 | Set-Content (Join-Path $bundleDir 'compose-ps.txt')
            Invoke-AfctCompose logs --no-color --tail 400 *>&1 | Set-Content (Join-Path $bundleDir 'compose-logs.txt')
        }
    } else {
        Set-Content -LiteralPath (Join-Path $bundleDir 'docker-unavailable.txt') -Value 'Docker Desktop was unavailable or its daemon could not be reached.'
    }

    if (Test-Path -LiteralPath $RuntimeCompose) { Copy-Item $RuntimeCompose (Join-Path $bundleDir 'docker-compose.yml') -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $LogFile) { Copy-Item $LogFile (Join-Path $bundleDir 'install.log') -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $EnvFile) { Copy-AfctRedactedEnv $EnvFile (Join-Path $bundleDir 'env.redacted.txt') }

    $manifest = @("Deployment tool version: $InstallerVersion", 'Files included:')
    $manifest += Get-ChildItem -LiteralPath $bundleDir -File | ForEach-Object { "  - $($_.Name)" }
    $manifest += ''
    $manifest += 'Known configuration values were redacted by key and by exact value.'
    Set-Content -LiteralPath (Join-Path $bundleDir 'manifest.txt') -Value $manifest -Encoding UTF8

    Hide-AfctSecretsInTree $bundleDir $EnvFile

    # Write the archive under the shared directory (always writable by the current user);
    # fall back to TEMP if that fails.
    $archive = Join-Path $SharedDir "$bundleName.zip"
    try {
        Remove-Item -Force -LiteralPath $archive -ErrorAction SilentlyContinue
        Compress-Archive -Path $bundleDir -DestinationPath $archive
    } catch {
        $archive = Join-Path $env:TEMP "$bundleName.zip"
        Remove-Item -Force -LiteralPath $archive -ErrorAction SilentlyContinue
        Compress-Archive -Path $bundleDir -DestinationPath $archive
    }
    Remove-Item -Recurse -Force -LiteralPath $work -ErrorAction SilentlyContinue

    # The archive can still contain host details even after redaction, so restrict it to the
    # current user. This is a diagnostics artifact, not a secret store, so a lockdown failure
    # warns rather than aborts.
    Protect-AfctFileBestEffort $archive

    Write-AfctSuccess "Diagnostics saved to $archive"
    Write-AfctWarn 'known configuration secrets were redacted, but logs and Compose files can still contain sensitive information. Review the archive before sharing it.'
    return $archive
}
