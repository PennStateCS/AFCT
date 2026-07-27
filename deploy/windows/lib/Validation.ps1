# Validation.ps1 - input validators for the AFCT Windows controller.
#
# Dot-sourced by afctctl.ps1. Pure functions (no side effects, no globals): each takes its
# input and returns a value, so they are trivially unit-testable. Windows PowerShell 5.1
# compatible. Behaviour mirrors the validators in deploy/install.sh and the monolithic
# Windows installer so the three platforms accept and reject exactly the same inputs.

Set-StrictMode -Version Latest

function Test-AfctEmail {
    param([string]$Value)
    if ($Value -match '\s') { return $false }
    return [bool]($Value -match '^[^@]+@[^@]+\.[^@]+$')
}

# Return the normalized origin, or $null when the URL is not a plain http(s)://host[:port]
# origin (no spaces, paths, queries, fragments, or userinfo).
function ConvertTo-AfctNormalizedAppUrl {
    param([string]$Url)
    if ($Url -match '\s') { return $null }
    $scheme = $null
    if ($Url -like 'http://*') { $scheme = 'http' }
    elseif ($Url -like 'https://*') { $scheme = 'https' }
    else { return $null }

    $authority = $Url.Substring($scheme.Length + 3).TrimEnd('/')
    if ([string]::IsNullOrEmpty($authority)) { return $null }
    if ($authority -match '[/?#@]') { return $null }
    return "${scheme}://$authority"
}

# Return the human-readable warnings a public URL warrants (empty when none). Returning
# strings instead of printing keeps this pure and testable; the caller emits them.
function Get-AfctAppUrlWarnings {
    param([string]$Url)
    $warnings = @()
    $hostPart = ($Url -replace '^[a-z]+://', '') -split '/' | Select-Object -First 1
    $hostOnly = ($hostPart -split ':')[0]

    $isLocalHttp = $Url -match '^http://(localhost|127\.0\.0\.1|\[::1\])'
    if ($Url -notlike 'https://*' -and -not $isLocalHttp) {
        $warnings += 'the public URL is not HTTPS. Authentication cookies and redirects may not work safely in production.'
    }
    if ($hostOnly -match '^[0-9]+(\.[0-9]+){3}$') {
        $warnings += 'the public URL uses a bare IPv4 address. A hostname with a matching TLS certificate is strongly recommended.'
    }
    return $warnings
}

# Password policy, mirroring src/lib/password-policy.ts: 8-72 chars with an uppercase, a
# lowercase, a digit, and a special (non-alphanumeric) character.
function Test-AfctStrongPassword {
    param([string]$Password)
    return [bool]($Password.Length -ge 8 -and $Password.Length -le 72 -and
        $Password -cmatch '[A-Z]' -and $Password -cmatch '[a-z]' -and
        $Password -match '[0-9]' -and $Password -match '[^A-Za-z0-9]')
}

# Values are written unquoted into the env file, which Compose reads literally to
# end-of-line. Reject inputs that would be reinterpreted rather than stored verbatim
# (mirrors is_env_value_safe in install.sh).
function Test-AfctEnvValueSafe {
    param([string]$Value)
    if ($Value -match "[`"'\\]") { return $false }
    if ($Value -match "[`r`n`t]") { return $false }
    if ($Value -ne $Value.Trim()) { return $false }
    if ($Value -like '* #*') { return $false }
    return $true
}
