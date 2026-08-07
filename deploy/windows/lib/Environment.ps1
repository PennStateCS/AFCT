# Environment.ps1 - .env.production handling + secret generation for the AFCT Windows
# controller.
#
# Dot-sourced by afctctl.ps1. Functions take explicit file paths (no reliance on the
# controller globals) so they unit-test cleanly. The env file lives under
# %LOCALAPPDATA%\AFCT\shared, never inside a versioned release directory. Windows
# PowerShell 5.1 compatible. Behaviour mirrors deploy/install.sh and the monolithic
# Windows installer.

Set-StrictMode -Version Latest

# The keys the installer owns. Everything else in the file (comments, app-specific
# settings) is preserved verbatim across a rewrite.
$script:AfctManagedKeys = @('NODE_ENV', 'POSTGRES_PASSWORD', 'DATABASE_URL', 'ADMIN_EMAIL',
    'ADMIN_PASSWORD', 'NEXTAUTH_SECRET', 'NEXTAUTH_URL', 'AUTH_TRUST_HOST')

# Apply the restrictive ACL to a file with icacls: strip inheritance and grant the current
# account (by SID) FullControl. The SID is given as a literal (the leading '*'), so icacls
# never resolves a name and never contacts a domain controller. That matters on a
# domain-joined machine whose DC is unreachable, where Set-Acl and name-based grants fail
# with a trust-relationship error; it is also inherently correct when the username contains
# spaces or is domain-qualified (there is no name string to parse). Throws on a nonzero
# icacls exit or when icacls is unavailable. This is the single seam the tests mock.
function Set-AfctFileAcl {
    param([string]$Path, [string]$Sid)
    if (-not (Get-Command icacls -ErrorAction SilentlyContinue)) {
        throw 'icacls is not available to restrict file permissions.'
    }
    $out = & icacls $Path /inheritance:r /grant:r "*${Sid}:(F)" 2>&1
    if ($LASTEXITCODE -ne 0) { throw "icacls could not restrict $Path (exit $LASTEXITCODE): $($out -join ' ')" }
}

# Restrict a file to the current user (the Windows analog of chmod 600). THROWS on failure;
# callers decide whether that is fatal (secrets, safety markers) or a warning (logs,
# diagnostics). A no-op when the file does not exist.
function Protect-AfctFile {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $sid = ([Security.Principal.WindowsIdentity]::GetCurrent()).User.Value
    Set-AfctFileAcl -Path $Path -Sid $sid
}

# Critical files (secrets and safety markers: .env.production, its backups, install-root,
# active-release, deploy.state). If the ACL cannot be applied, stop before deployment
# continues rather than leaving a secret or a safety marker readable by other users. The
# message names the path and never includes its contents.
function Protect-AfctCriticalFile {
    param([string]$Path)
    try { Protect-AfctFile $Path }
    catch { throw "afct-fatal: could not restrict permissions on $Path (it must be readable only by your account). $($_.Exception.Message)" }
}

# Non-critical files (logs, diagnostics archives). A lockdown failure is surfaced
# prominently but does not stop the operation. These files must never contain secrets.
function Protect-AfctFileBestEffort {
    param([string]$Path)
    try { Protect-AfctFile $Path }
    catch { Write-AfctWarn "could not restrict permissions on $Path; it remains under your user profile. $($_.Exception.Message)" }
}

# True when the file exists and defines every key AFCT cannot run without.
function Test-AfctEnvFileComplete {
    param([string]$File)
    if (-not (Test-Path -LiteralPath $File)) { return $false }
    $content = Get-Content -LiteralPath $File -ErrorAction SilentlyContinue
    if (-not $content) { return $false }
    foreach ($key in 'POSTGRES_PASSWORD', 'DATABASE_URL', 'NEXTAUTH_SECRET', 'NEXTAUTH_URL') {
        $found = $content | Where-Object { $_ -match "^\s*$key=.+" } | Select-Object -First 1
        if (-not $found) { return $false }
    }
    return $true
}

# Read a single KEY=VALUE from the env file, stripping one layer of matching quotes.
# Returns '' when the key or file is absent.
function Read-AfctEnvValue {
    param([string]$Key, [string]$File)
    if (-not (Test-Path -LiteralPath $File)) { return '' }
    foreach ($line in Get-Content -LiteralPath $File -ErrorAction SilentlyContinue) {
        $trimmed = $line.TrimStart()
        if ($trimmed.StartsWith("$Key=")) {
            $raw = $trimmed.Substring($Key.Length + 1)
            if ($raw.Length -ge 2) {
                if (($raw.StartsWith("'") -and $raw.EndsWith("'")) -or ($raw.StartsWith('"') -and $raw.EndsWith('"'))) {
                    $raw = $raw.Substring(1, $raw.Length - 2)
                }
            }
            return $raw
        }
    }
    return ''
}

# Write .env content as UTF-8 WITHOUT a BOM; a BOM would corrupt the first variable when
# Docker Compose reads the env_file.
function Write-AfctEnvContent {
    param([string]$Path, [string[]]$Lines)
    $enc = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, (($Lines -join "`n") + "`n"), $enc)
}

# Set or replace a single unmanaged KEY=VALUE line, preserving everything else. Used for
# the AFCT_UPDATER_ENABLED / AFCT_APP_TAG toggles. Writes atomically via a temp + rename.
function Set-AfctEnvFlag {
    param([string]$Key, [string]$Value, [string]$File)
    if (-not (Test-Path -LiteralPath $File)) { throw "afct-fatal: $File not found. Run 'afctctl install' first." }
    $lines = @(Get-Content -LiteralPath $File)
    $replaced = $false
    $out = foreach ($line in $lines) {
        if (-not $replaced -and $line -match "^$Key=") { $replaced = $true; "$Key=$Value" }
        else { $line }
    }
    $out = @($out)
    if (-not $replaced) { $out += "$Key=$Value" }
    $tmp = "$File.tmp.$PID"
    Write-AfctEnvContent $tmp $out
    Move-Item -LiteralPath $tmp -Destination $File -Force
    Protect-AfctCriticalFile $File
}

# Copy the current env file aside before a rewrite. These .backup.* files are what
# 'afctctl recover' restores from, so they must stay private too.
function Backup-AfctEnvFile {
    param([string]$File)
    if (-not (Test-Path -LiteralPath $File)) { return $null }
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backup = "$File.backup.$stamp.$PID"
    Copy-Item -LiteralPath $File -Destination $backup
    Protect-AfctCriticalFile $backup
    return $backup
}

# Rewrite the env file from a config hashtable, replacing the managed block and preserving
# every other line. $Config keys: AppUrl, AdminEmail, AdminPassword, PostgresPassword,
# DatabaseUrl, NextAuthSecret. Throws (afct-fatal) if any managed value is unsafe.
function Write-AfctEnvironmentFile {
    param([string]$File, [hashtable]$Config, [string]$ExampleFile, [string]$ToolVersion)

    $assign = {
        param([string]$k, [string]$v)
        if (-not (Test-AfctEnvValueSafe $v)) {
            throw "afct-fatal: $k contains characters that cannot be stored safely in $File (line breaks, quotes, backslashes, tabs, leading or trailing spaces, or a space before '#')."
        }
        "$k=$v"
    }

    $baseFile = $null
    if (Test-Path -LiteralPath $File) { $baseFile = $File }
    elseif ($ExampleFile -and (Test-Path -LiteralPath $ExampleFile)) { $baseFile = $ExampleFile }

    $kept = @()
    if ($baseFile) {
        $inManaged = $false
        foreach ($line in Get-Content -LiteralPath $baseFile) {
            if ($line -eq '# BEGIN AFCT INSTALLER MANAGED SETTINGS') { $inManaged = $true; continue }
            if ($line -eq '# END AFCT INSTALLER MANAGED SETTINGS') { $inManaged = $false; continue }
            if ($inManaged) { continue }
            $key = ($line.TrimStart() -split '[=:]', 2)[0].TrimEnd()
            if ($script:AfctManagedKeys -contains $key) { continue }
            $kept += $line
        }
    }

    $stamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    $block = @(
        '',
        '# BEGIN AFCT INSTALLER MANAGED SETTINGS',
        "# Managed by AFCT afctctl $ToolVersion",
        "# Updated: $stamp",
        '# Keep this file private. Reconfiguration preserves infrastructure secrets.',
        '# Change an existing administrator password from inside AFCT, not here.',
        (& $assign 'NODE_ENV' 'production'),
        (& $assign 'POSTGRES_PASSWORD' $Config.PostgresPassword),
        (& $assign 'DATABASE_URL' $Config.DatabaseUrl),
        (& $assign 'ADMIN_EMAIL' $Config.AdminEmail),
        (& $assign 'ADMIN_PASSWORD' $Config.AdminPassword),
        (& $assign 'NEXTAUTH_SECRET' $Config.NextAuthSecret),
        (& $assign 'NEXTAUTH_URL' $Config.AppUrl),
        (& $assign 'AUTH_TRUST_HOST' 'true'),
        '# END AFCT INSTALLER MANAGED SETTINGS'
    )

    $tmp = "$File.tmp.$PID"
    Write-AfctEnvContent $tmp ($kept + $block)
    Move-Item -LiteralPath $tmp -Destination $File -Force
    Protect-AfctCriticalFile $File
}

# 48 lowercase hex characters (mirrors gen_secret in install.sh).
function New-AfctSecret {
    $bytes = New-Object 'System.Byte[]' 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $hex = ([BitConverter]::ToString($bytes)) -replace '-', ''
    return $hex.Substring(0, 48).ToLowerInvariant()
}

# A random core plus one character from each required class. The admin changes it at first
# login, so the fixed policy suffix on a random core is harmless.
function New-AfctAdminPassword { return (New-AfctSecret) + 'Aa1!' }

# Resolve an admin password supplied out of band: ADMIN_PASSWORD or ADMIN_PASSWORD_FILE
# (exactly one). Relative ADMIN_PASSWORD_FILE paths resolve against $BaseDir. Returns ''
# when neither is set. Throws (afct-fatal) on conflicting or missing-file input.
function Read-AfctPasswordSource {
    param([string]$BaseDir)
    $pw = [Environment]::GetEnvironmentVariable('ADMIN_PASSWORD')
    $pwFile = [Environment]::GetEnvironmentVariable('ADMIN_PASSWORD_FILE')
    if ($pw -and $pwFile) { throw 'afct-fatal: set only one of ADMIN_PASSWORD or ADMIN_PASSWORD_FILE.' }
    if ($pwFile) {
        $path = $pwFile
        if (-not [System.IO.Path]::IsPathRooted($path)) { $path = Join-Path $BaseDir $path }
        if (-not (Test-Path -LiteralPath $path)) { throw "afct-fatal: ADMIN_PASSWORD_FILE does not exist: $pwFile" }
        return ([System.IO.File]::ReadAllText($path)).TrimEnd("`r", "`n")
    }
    if ($pw) { return $pw }
    return ''
}
