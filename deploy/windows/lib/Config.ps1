# Config.ps1 - resolve the AFCT install/reconfigure configuration for the Windows
# controller.
#
# Dot-sourced by afctctl.ps1. Depends on Validation.ps1 and Environment.ps1. Produces the
# configuration hashtable that Write-AfctEnvironmentFile consumes. Values come from
# environment variables (APP_URL, ADMIN_EMAIL, ADMIN_PASSWORD[_FILE]) and, when a terminal
# is attached and -NonInteractive was not given, interactive prompts. Windows PowerShell
# 5.1 compatible. Mirrors Set-NewInstallConfig / Set-ExistingInstallConfig in the monolith.

Set-StrictMode -Version Latest

$script:AfctPasswordPolicyMsg = 'the password must be 8-72 characters and include uppercase, lowercase, a number, and a special character.'

# True only when prompting is allowed: not -NonInteractive and stdin is a real console.
function Test-AfctCanPrompt {
    param([bool]$NonInteractive)
    return (-not $NonInteractive) -and (-not [Console]::IsInputRedirected)
}

function Read-AfctDefault {
    param([string]$Question, [string]$Default, [bool]$NonInteractive)
    if (-not (Test-AfctCanPrompt $NonInteractive)) { return $Default }
    $a = Read-Host "$Question [$Default]"
    if ([string]::IsNullOrWhiteSpace($a)) { return $Default }
    return $a
}

function Read-AfctSecretValue {
    param([string]$Question)
    $sec = Read-Host $Question -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

# Resolve configuration for a brand-new install. Generates fresh infrastructure secrets.
function Get-AfctNewInstallConfig {
    param([string]$EnvFile, [string]$BaseDir, [bool]$NonInteractive)

    $defaultUrl = "https://$([System.Net.Dns]::GetHostName())"
    $requestedUrl = [Environment]::GetEnvironmentVariable('APP_URL')
    if (-not $requestedUrl) { $requestedUrl = Read-AfctDefault 'Public URL' $defaultUrl $NonInteractive }
    $appUrl = ConvertTo-AfctNormalizedAppUrl $requestedUrl
    if (-not $appUrl) { throw 'afct-fatal: APP_URL must be a valid http:// or https:// origin without spaces, paths, queries, or fragments.' }
    if (-not (Test-AfctEnvValueSafe $appUrl)) { throw 'afct-fatal: APP_URL contains unsupported characters.' }
    foreach ($w in (Get-AfctAppUrlWarnings $appUrl)) { Write-AfctWarn $w }

    $adminEmail = [Environment]::GetEnvironmentVariable('ADMIN_EMAIL')
    if (-not $adminEmail -and (Test-AfctCanPrompt $NonInteractive)) {
        while (-not $adminEmail) {
            $adminEmail = Read-Host 'Administrator email'
            if ([string]::IsNullOrWhiteSpace($adminEmail)) { Write-AfctWarn 'a value is required.'; $adminEmail = $null }
        }
    }
    if (-not $adminEmail) { throw 'afct-fatal: ADMIN_EMAIL is required. Set it as an environment variable or run interactively.' }
    if (-not (Test-AfctEmail $adminEmail)) { throw "afct-fatal: the administrator email does not appear valid: $adminEmail" }
    if (-not (Test-AfctEnvValueSafe $adminEmail)) { throw 'afct-fatal: ADMIN_EMAIL contains unsupported characters.' }

    $provided = Read-AfctPasswordSource $BaseDir
    $generated = $false
    if ($provided) {
        $adminPassword = $provided
    } elseif (-not (Test-AfctCanPrompt $NonInteractive)) {
        throw 'afct-fatal: ADMIN_PASSWORD or ADMIN_PASSWORD_FILE is required in non-interactive mode.'
    } else {
        $choice = Read-AfctDefault 'Set the administrator password yourself (t) or generate one (g)?' 'g' $NonInteractive
        if ($choice -match '^(g|G|generate)$') {
            $adminPassword = New-AfctAdminPassword
            $generated = $true
        } else {
            while ($true) {
                $adminPassword = Read-AfctSecretValue 'Administrator password'
                if (-not (Test-AfctStrongPassword $adminPassword)) { Write-AfctWarn $script:AfctPasswordPolicyMsg; continue }
                if (-not (Test-AfctEnvValueSafe $adminPassword)) {
                    Write-AfctWarn "the password cannot contain line breaks, quotes, backslashes, tabs, leading or trailing spaces, or a space before '#'."
                    continue
                }
                $confirm = Read-AfctSecretValue 'Confirm administrator password'
                if ($adminPassword -eq $confirm) { break }
                Write-AfctWarn 'the passwords did not match.'
            }
        }
    }

    if (-not (Test-AfctStrongPassword $adminPassword)) { throw "afct-fatal: the administrator $script:AfctPasswordPolicyMsg" }
    if (-not (Test-AfctEnvValueSafe $adminPassword)) {
        throw "afct-fatal: the administrator password cannot contain line breaks, quotes, backslashes, tabs, leading or trailing spaces, or a space before '#'."
    }

    $postgres = New-AfctSecret
    return @{
        AppUrl            = $appUrl
        AdminEmail        = $adminEmail
        AdminPassword     = $adminPassword
        PostgresPassword  = $postgres
        DatabaseUrl       = "postgresql://afct_user:$postgres@postgres:5432/afct"
        NextAuthSecret    = New-AfctSecret
        SecretKey         = New-AfctSecret
        PasswordGenerated = $generated
        Reconfiguring     = $false
    }
}

# Resolve configuration for a reconfigure over an existing complete env file. Infrastructure
# secrets (POSTGRES_PASSWORD, DATABASE_URL, NEXTAUTH_SECRET) are preserved so the database
# and existing sessions keep working.
function Get-AfctReconfigureConfig {
    param([string]$EnvFile, [string]$BaseDir, [bool]$NonInteractive)

    $existingUrl = Read-AfctEnvValue 'NEXTAUTH_URL' $EnvFile
    $existingEmail = Read-AfctEnvValue 'ADMIN_EMAIL' $EnvFile
    $existingPassword = Read-AfctEnvValue 'ADMIN_PASSWORD' $EnvFile

    $defaultUrl = $existingUrl
    if (-not $defaultUrl) { $defaultUrl = "https://$([System.Net.Dns]::GetHostName())" }
    $requestedUrl = [Environment]::GetEnvironmentVariable('APP_URL')
    if (-not $requestedUrl) { $requestedUrl = Read-AfctDefault 'Public URL' $defaultUrl $NonInteractive }
    $appUrl = ConvertTo-AfctNormalizedAppUrl $requestedUrl
    if (-not $appUrl) { throw 'afct-fatal: APP_URL must be a valid http:// or https:// origin without spaces, paths, queries, or fragments.' }
    if (-not (Test-AfctEnvValueSafe $appUrl)) { throw 'afct-fatal: APP_URL contains unsupported characters.' }
    foreach ($w in (Get-AfctAppUrlWarnings $appUrl)) { Write-AfctWarn $w }

    $adminEmail = [Environment]::GetEnvironmentVariable('ADMIN_EMAIL')
    if (-not $adminEmail) { $adminEmail = $existingEmail }
    if (-not $adminEmail) { throw 'afct-fatal: ADMIN_EMAIL is missing from the existing configuration.' }
    if (-not (Test-AfctEmail $adminEmail)) { throw "afct-fatal: the administrator email does not appear valid: $adminEmail" }

    $provided = Read-AfctPasswordSource $BaseDir
    if ($provided) {
        $adminPassword = $provided
        Write-AfctWarn 'updating ADMIN_PASSWORD only changes the bootstrap setting; it does not change an already-created AFCT account password.'
    } else {
        $adminPassword = $existingPassword
    }
    if (-not $adminPassword) { throw 'afct-fatal: ADMIN_PASSWORD is missing from the existing configuration.' }
    if (-not (Test-AfctStrongPassword $adminPassword)) {
        Write-AfctWarn 'the saved administrator bootstrap password does not meet the current strength policy; keeping it unchanged (it only affects first-run seeding).'
    }
    if (-not (Test-AfctEnvValueSafe $adminPassword)) {
        throw "afct-fatal: the saved administrator password contains characters this installer cannot rewrite safely; edit $EnvFile manually."
    }

    $postgres = Read-AfctEnvValue 'POSTGRES_PASSWORD' $EnvFile
    $databaseUrl = Read-AfctEnvValue 'DATABASE_URL' $EnvFile
    $nextAuth = Read-AfctEnvValue 'NEXTAUTH_SECRET' $EnvFile
    if (-not $postgres) { throw "afct-fatal: POSTGRES_PASSWORD is missing from $EnvFile." }
    if (-not $databaseUrl) { throw "afct-fatal: DATABASE_URL is missing from $EnvFile." }
    if (-not $nextAuth) { throw "afct-fatal: NEXTAUTH_SECRET is missing from $EnvFile." }

    # Generated rather than required: installs predating secret encryption have no key, and
    # refusing to upgrade them would be absurd. A fresh key is correct there, because nothing
    # has been encrypted under an older one yet. An existing key is preserved untouched, since
    # replacing it would make every stored secret unreadable.
    $secretKey = Read-AfctEnvValue 'AFCT_SECRET_KEY' $EnvFile
    if (-not $secretKey) {
        $secretKey = New-AfctSecret
        Write-AfctInfo 'generated a secret-encryption key for this install; it protects stored settings such as mail and sign-in credentials.'
    }

    if ([Environment]::GetEnvironmentVariable('POSTGRES_PASSWORD') -or
        [Environment]::GetEnvironmentVariable('DATABASE_URL') -or
        [Environment]::GetEnvironmentVariable('NEXTAUTH_SECRET')) {
        Write-AfctWarn 'exported infrastructure credentials were ignored during reconfiguration to avoid breaking the existing database or invalidating sessions.'
    }

    return @{
        AppUrl            = $appUrl
        AdminEmail        = $adminEmail
        AdminPassword     = $adminPassword
        PostgresPassword  = $postgres
        DatabaseUrl       = $databaseUrl
        NextAuthSecret    = $nextAuth
        SecretKey         = $secretKey
        PasswordGenerated = $false
        Reconfiguring     = $true
    }
}
