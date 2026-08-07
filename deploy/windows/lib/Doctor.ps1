# Doctor.ps1 - a comprehensive, read-only system check for the AFCT Windows controller.
#
# Dot-sourced by afctctl.ps1. Depends on Output.ps1, Docker.ps1, Compose.ps1, Environment.ps1.
# Reads controller globals ($RuntimeCompose, $ComposeTemplate, $EnvFile, $AppService,
# $InstallerVersion). Windows PowerShell 5.1 compatible. Read-only: it inspects, never
# changes state. Returns $true when there are no warnings or failures.

Set-StrictMode -Version Latest

function Invoke-AfctDoctor {
    Write-AfctInfo 'AFCT system check'
    $ok = 0
    $warn = 0
    $check = {
        param([string]$Label, [bool]$Passed)
        if ($Passed) { Write-AfctSuccess $Label; return $true }
        Write-AfctWarn $Label
        return $false
    }

    $composePresent = (Test-Path -LiteralPath $RuntimeCompose) -or (Test-Path -LiteralPath $ComposeTemplate)
    if (& $check 'Compose file exists' $composePresent) { $ok++ } else { $warn++ }
    if (& $check 'Environment file exists' (Test-Path -LiteralPath $EnvFile)) { $ok++ } else { $warn++ }
    if (& $check 'Environment configuration is complete' (Test-AfctEnvFileComplete $EnvFile)) { $ok++ } else { $warn++ }

    $min = [int64]([Environment]::GetEnvironmentVariable('AFCT_UPDATE_MIN_FREE_GB'))
    if ($min -le 0) { $min = 12 }
    $free = Get-AfctDockerFreeBytes
    $diskOk = (-not $free) -or ($free -ge ($min * 1GB))
    if (& $check ("At least {0:N0} GB of disk space is available for image downloads" -f $min) $diskOk) { $ok++ } else { $warn++ }

    if (& $check 'Windows Time service is running' (Test-AfctClockSync)) { $ok++ } else { $warn++ }

    if (Test-AfctDockerReady) {
        Write-AfctSuccess 'Docker Desktop daemon is reachable'
        $ok++
        if (Test-Path -LiteralPath $RuntimeCompose) {
            Invoke-AfctCompose config | Out-Null
            if (& $check 'Docker Compose configuration is valid' ($LASTEXITCODE -eq 0)) { $ok++ } else { $warn++ }
            $state = Get-AfctAppContainerState
            $healthy = $false
            if ($state) { $healthy = ($state -split '\|', 2)[1] -eq 'healthy' }
            if (& $check 'Application container is healthy' $healthy) { $ok++ } else { $warn++ }
            if (& $check 'Local AFCT health endpoint responds' (Test-AfctHttpHealth)) { $ok++ } else { $warn++ }
        }
    } else {
        Write-AfctWarn 'Docker Desktop is unavailable or its daemon is not reachable.'
        $warn++
    }

    Write-AfctInfo ''
    Write-AfctInfo "Doctor result: $ok checks passed; $warn warnings or failures."
    return ($warn -eq 0)
}
