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
        if ($a -eq $b) { return }
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        Copy-Item -LiteralPath $RuntimeCompose -Destination "$RuntimeCompose.bak.$stamp" -Force -ErrorAction SilentlyContinue
        Write-AfctInfo "the runtime Compose file changed with this release; saved the previous one as docker-compose.yml.bak.$stamp."
    }
    Copy-Item -LiteralPath $ComposeTemplate -Destination $RuntimeCompose -Force
}

function Test-AfctComposeConfig {
    # Capture the output so a failure reports the actual reason (e.g. a missing env file)
    # instead of a bare "invalid configuration" the operator cannot act on.
    $out = Invoke-AfctCompose config
    if ($LASTEXITCODE -ne 0) {
        $detail = (@($out) | Where-Object { $_ } | Select-Object -Last 3) -join ' '
        if ($detail) { throw "afct-fatal: the Docker Compose configuration is invalid: $detail" }
        throw 'afct-fatal: the Docker Compose configuration is invalid.'
    }
}

function Get-AfctImages {
    Write-AfctInfo 'downloading AFCT container images...'
    if (-not [Console]::IsOutputRedirected) {
        $code = Invoke-AfctComposeConsole pull
    } else {
        Invoke-AfctCompose pull | Out-Null
        $code = $LASTEXITCODE
    }
    if ($code -ne 0) {
        throw "afct-fatal: container images could not be downloaded. Check the network and registry authentication. If the images are private, run 'docker login ghcr.io' and re-run."
    }
    Write-AfctSuccess 'Container images downloaded.'
}

function Start-AfctStack {
    Write-AfctInfo 'starting the AFCT stack...'
    Invoke-AfctCompose up -d | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'afct-fatal: the AFCT stack could not be started.' }
}

# Read the app container's "<containerState>|<healthState>" string. Captures output first
# and reads $LASTEXITCODE BEFORE narrowing with Select-Object: piping a native command
# straight into `Select-Object -First 1` stops the pipeline early and corrupts $LASTEXITCODE
# to -1 even on success, which would report a healthy stack as missing.
function Get-AfctAppContainerState {
    $appId = (Invoke-AfctCompose ps -q $AppService | Where-Object { $_ } | Select-Object -First 1)
    if (-not $appId) { return $null }
    $eap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & docker inspect -f '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' $appId 2>&1 | ForEach-Object { "$_" }
    } finally { $ErrorActionPreference = $eap }
    $code = $LASTEXITCODE
    $state = $out | Select-Object -First 1
    if ($code -ne 0 -or -not $state) { return 'missing|none' }
    return $state
}

# Best-effort end-to-end check that nginx serves the app. Self-signed cert on first boot, so
# bypass cert validation for this one localhost call (restored afterward).
function Test-AfctHttpHealth {
    $prev = [System.Net.ServicePointManager]::ServerCertificateValidationCallback
    [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
    try {
        foreach ($scheme in 'https', 'http') {
            try {
                Invoke-WebRequest -Uri "${scheme}://localhost$HealthPath" -TimeoutSec 10 -UseBasicParsing | Out-Null
                return $true
            } catch { }
        }
        return $false
    } finally {
        [System.Net.ServicePointManager]::ServerCertificateValidationCallback = $prev
    }
}

function Wait-AfctHealth {
    Write-AfctInfo 'waiting for the application health check...'
    $elapsed = 0
    # A single restart can happen during a normal recreate, but repeated restarts mean a
    # crash loop that will never become healthy, so fail fast instead of waiting out the
    # whole timeout (mirrors the Unix controller).
    $restarting = 0
    while ($elapsed -lt $HealthTimeout) {
        $state = Get-AfctAppContainerState
        if ($state) {
            $containerState, $healthState = $state -split '\|', 2
            if ($containerState -eq 'running' -and $healthState -eq 'healthy') {
                Write-AfctSuccess 'The AFCT application is healthy.'
                if (Test-AfctHttpHealth) { Write-AfctSuccess "The web service is responding at $HealthPath." }
                else { Write-AfctWarn 'the container is healthy, but the local web endpoint did not respond yet.' }
                return
            }
            if ($containerState -eq 'running' -and $healthState -eq 'unhealthy') {
                throw 'afct-fatal: the application container reported an unhealthy state.'
            }
            if ($containerState -in 'exited', 'dead') {
                throw 'afct-fatal: the application container stopped before becoming healthy.'
            }
            if ($containerState -eq 'restarting') {
                $restarting++
                if ($restarting -ge 3) {
                    throw "afct-fatal: the $AppService container keeps restarting (crash loop) instead of becoming healthy. Check the logs: afctctl logs"
                }
            }
            if ($containerState -eq 'running' -and $healthState -eq 'none') {
                throw "afct-fatal: the $AppService service has no Docker health check configured."
            }
        }
        Start-Sleep -Seconds $HealthInterval
        $elapsed += $HealthInterval
    }
    throw "afct-fatal: the application did not become healthy within $HealthTimeout seconds."
}

function Invoke-AfctDeployStack {
    Test-AfctComposeConfig
    Get-AfctImages
    Start-AfctStack
    Wait-AfctHealth
}

function Invoke-AfctRestartStack {
    Test-AfctComposeConfig
    Start-AfctStack
    Wait-AfctHealth
}
