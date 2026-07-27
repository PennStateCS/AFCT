# Docker.ps1 - Docker Desktop access + Compose helpers for the AFCT Windows controller.
#
# Dot-sourced by afctctl.ps1. Functions only. Reads controller script-scope variables
# ($RuntimeCompose, $EnvFile, $ComposeProject). Windows PowerShell 5.1 compatible.
#
# Docker Desktop runs the daemon for the current user, so there is no sudo/elevation dance
# and no legacy docker-compose fallback: AFCT requires `docker compose` v2.

Set-StrictMode -Version Latest

# True when the docker CLI exists and the daemon answers (Docker Desktop running). Never
# throws; used by read-only/soft paths such as uninstall and diagnostics.
function Test-AfctDockerReady {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { return $false }
    try { & docker info *> $null; return ($LASTEXITCODE -eq 0) } catch { return $false }
}

# Resolve the Compose project name (keeps data volumes attached). Persisted in deploy.state
# during install/migration; defaults to 'afct' until then.
function Get-AfctComposeProject {
    $state = Join-Path $SharedDir 'deploy.state'
    if (Test-Path -LiteralPath $state) {
        $m = Select-String -LiteralPath $state -Pattern '^PROJECT_NAME=(.+)$' | Select-Object -First 1
        if ($null -ne $m) { return $m.Matches.Groups[1].Value.Trim() }
    }
    return 'afct'
}

# Invoke `docker compose` against the runtime Compose file + production env file, scoped to
# the resolved project. Returns the child exit code; never throws on a nonzero compose exit.
function Invoke-AfctCompose {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
    $base = @('compose', '-p', (Get-AfctComposeProject), '-f', $RuntimeCompose)
    if (Test-Path -LiteralPath $EnvFile) { $base += @('--env-file', $EnvFile) }
    & docker @base @Args
    return $LASTEXITCODE
}
