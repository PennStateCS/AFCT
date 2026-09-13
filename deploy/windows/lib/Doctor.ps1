# Doctor.ps1 - a comprehensive, read-only system check for the AFCT Windows controller.
#
# Dot-sourced by afctctl.ps1. Depends on Output.ps1, Docker.ps1, Compose.ps1, Environment.ps1.
# Reads controller globals ($RuntimeCompose, $ComposeTemplate, $EnvFile, $AppService,
# $InstallerVersion). Windows PowerShell 5.1 compatible. Read-only: it inspects, never
# changes state. Returns $true when there are no warnings or failures.
#
# Read-only is a rule, not a description. Every docker call below is an inspection
# (`compose config`, `compose ps`, `docker inspect`) and an HTTP GET; nothing here starts,
# stops, recreates or removes anything, and a doctor run on a broken deployment must leave it
# exactly as broken as it found it so the operator can still diagnose it.

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
            # Every expected service, not just the application. After an interrupted
            # install the useful question is which part of the stack did not come up, and
            # reporting only the app is how a missing nginx or worker stayed invisible.
            #
            # What counts as passing differs per service, and the shared table
            # (Get-AfctExpectedServices) is what decides: a service with a Docker health
            # check has to report healthy, and the worker, which defines none, only has to
            # be running. Anything else would either fail a good install or pass a bad one.
            $state = Get-AfctStackState -SkipHttp
            foreach ($svc in $state.Services) {
                $label = "$($svc.Label) is ready"
                if ($svc.Ready) {
                    if ($svc.Health -eq 'healthy') { $label = "$($svc.Label) is healthy" }
                    else { $label = "$($svc.Label) is running" }
                } elseif ($svc.Status -eq 'missing') {
                    $label = "$($svc.Label) is not running"
                } else {
                    $label = "$($svc.Label) is $($svc.Status)"
                    if ($svc.Health -and $svc.Health -ne 'none') { $label += " ($($svc.Health))" }
                }
                if (& $check $label $svc.Ready) { $ok++ } else { $warn++ }
            }
            if (-not $state.ImageMatches) {
                Write-AfctWarn "the running application is not the pinned version ($($state.ExpectedTag))"
                $warn++
            }
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
