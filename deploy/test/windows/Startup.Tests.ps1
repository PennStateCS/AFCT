<#
Startup.Tests.ps1 - regression tests for the Windows startup path, written from a real
failure.

A Windows tester ran the documented installer. It downloaded and verified the bundle,
reused the existing .env.production, pulled every image, printed

    [afct] starting the AFCT stack...

and stayed there for hours, while Docker Desktop showed all five AFCT containers up and
running. Rerunning the installer replayed the same startup and stopped at the same line.

Three separate defects produced that, and each has tests here: `docker compose up -d` had
no upper bound of any kind (AFCT_HEALTH_TIMEOUT only governs the health wait, which does
not begin until the CLI returns); its output was discarded, so there was nothing to look
at; and nothing ever asked whether the stack was already running before starting it again.

The hang cases use a real `docker.cmd` shim rather than a Pester mock, because the thing
under test is what happens to a native child process that does not exit. Everything else is
mocked, so none of this needs a Docker daemon.
#>

BeforeAll {
    $script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
    $script:LibDir   = Join-Path $RepoRoot 'deploy\windows\lib'
    foreach ($m in 'Output', 'Docker', 'Validation', 'Environment', 'Config', 'Compose',
                   'Update', 'Diagnostics', 'Doctor') {
        . (Join-Path $LibDir "$m.ps1")
    }

    $script:Work = Join-Path ([IO.Path]::GetTempPath()) ("afct-startup-" + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $Work -Force | Out-Null

    # A path with a space in it, because the install prefix legitimately can have one
    # (a user profile named "Jane Doe") and Start-Process argument handling is exactly the
    # kind of code that breaks on it.
    $script:SharedDir      = Join-Path $Work 'My AFCT\shared'
    $script:RuntimeDir     = Join-Path $SharedDir 'runtime'
    New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null
    $script:RuntimeCompose = Join-Path $RuntimeDir 'docker-compose.yml'
    Set-Content -LiteralPath $RuntimeCompose -Value 'services: {}' -Encoding UTF8
    $script:EnvFile        = Join-Path $SharedDir '.env.production'
    $script:LogFile        = Join-Path $SharedDir 'install.log'
    $script:AppService     = 'app'
    $script:HealthPath     = '/api/health'
    $script:HealthTimeout  = 30
    $script:HealthInterval = 1
    $script:InstallerVersion = 'test'
    $script:UpdaterService   = 'updater'
    $script:InstallerBaseUrl = 'https://example.invalid'
    $script:Prefix           = Join-Path $Work 'My AFCT'

    # Build a docker shim with the given .cmd body and put it first on PATH.
    function Use-DockerShim {
        param([string]$Body)
        $dir = Join-Path $Work ("shim-" + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $dir 'docker.cmd') -Value $Body -Encoding ASCII
        $script:ShimDir = $dir
        $env:PATH = $dir + [IO.Path]::PathSeparator + $script:OriginalPath
    }

    $script:OriginalPath = $env:PATH
}

AfterAll {
    $env:PATH = $script:OriginalPath
    Remove-Item -LiteralPath $Work -Recurse -Force -ErrorAction SilentlyContinue
}

Describe 'Invoke-AfctComposeBounded' {
    AfterEach { $env:PATH = $script:OriginalPath }

    It 'returns the exit code when compose finishes normally' {
        Use-DockerShim "@echo off`r`necho Container afct-app Started`r`nexit /b 0"
        $r = Invoke-AfctComposeBounded -TimeoutSeconds 30 up -d
        $r.TimedOut | Should -BeFalse
        $r.ExitCode | Should -Be 0
    }

    It 'returns a nonzero exit code and keeps what docker said' {
        Use-DockerShim "@echo off`r`necho no such service: nope 1>&2`r`nexit /b 17"
        $r = Invoke-AfctComposeBounded -TimeoutSeconds 30 up -d
        $r.TimedOut | Should -BeFalse
        $r.ExitCode | Should -Be 17
        # The useful Docker error survives. Replacing it with "the stack could not be
        # started" is what left the failing tester with nothing to act on.
        (@($r.StdErr) -join ' ') | Should -Match 'no such service'
    }

    <#
      The original failure, reproduced: a CLI that never exits. Without a deadline this
      test would hang the suite forever, which is exactly what it did to the tester.
    #>
    It 'gives up on a compose process that never exits, and says so' {
        Use-DockerShim "@echo off`r`nping -n 120 127.0.0.1 >nul`r`nexit /b 0"
        $started = Get-Date
        $r = Invoke-AfctComposeBounded -TimeoutSeconds 3 up -d
        $r.TimedOut | Should -BeTrue
        $r.ExitCode | Should -BeNullOrEmpty
        ((Get-Date) - $started).TotalSeconds | Should -BeLessThan 60
    }

    It 'leaves nothing of the killed process behind' {
        # The tree, not the pid: `docker compose` runs its own child, and killing only the
        # parent leaves that child running.
        Use-DockerShim "@echo off`r`nping -n 120 127.0.0.1 >nul`r`nexit /b 0"
        Invoke-AfctComposeBounded -TimeoutSeconds 3 up -d | Out-Null
        Start-Sleep -Seconds 1
        $stragglers = @(Get-CimInstance Win32_Process -Filter "Name='PING.EXE'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -and $_.CommandLine -match '-n 120' })
        $stragglers.Count | Should -Be 0
    }

    It 'quotes arguments containing spaces, and leaves plain ones alone' {
        ConvertTo-AfctCommandLine @('compose', '-f', 'C:\My AFCT\docker-compose.yml') |
            Should -Be 'compose -f "C:\My AFCT\docker-compose.yml"'
        # A trailing backslash must not escape the closing quote.
        ConvertTo-AfctCommandLine @('-f', 'C:\My AFCT\') | Should -Be '-f "C:\My AFCT\\"'
    }

    It 'works when the compose file path contains spaces' {
        # $RuntimeCompose is under "My AFCT\shared". An argument array that lost the
        # quoting would make docker see two arguments and fail.
        Use-DockerShim "@echo off`r`necho %*`r`nexit /b 0"
        $r = Invoke-AfctComposeBounded -TimeoutSeconds 30 up -d
        $r.ExitCode | Should -Be 0
        (@($r.StdOut) -join ' ') | Should -Match 'My AFCT'
    }
}

Describe 'Start-AfctStack' {
    BeforeEach {
        Mock -CommandName Write-AfctInfo -MockWith { }
        Mock -CommandName Write-AfctSuccess -MockWith { }
        Mock -CommandName Write-AfctWarn -MockWith { }
        Mock -CommandName Write-AfctTrace -MockWith { }
        Mock -CommandName Write-Host -MockWith { }
    }

    It 'returns the elapsed seconds on success' {
        Mock -CommandName Invoke-AfctComposeBounded -MockWith {
            @{ ExitCode = 0; TimedOut = $false; StdOut = @(); StdErr = @(); Seconds = 12 }
        }
        Start-AfctStack -TimeoutSeconds 30 | Should -Be 12
    }

    It 'fails with the docker error when compose exits nonzero' {
        Mock -CommandName Invoke-AfctComposeBounded -MockWith {
            @{ ExitCode = 1; TimedOut = $false; StdOut = @(); StdErr = @('port is already allocated'); Seconds = 2 }
        }
        { Start-AfctStack -TimeoutSeconds 30 } | Should -Throw '*docker compose exited 1*'
    }

    <#
      The conservative edge case. The CLI stopped making progress, but the daemon says
      every service is up, the app is healthy and the pinned version is running, so the
      installation is finished rather than failed. This is the exact situation the tester
      was in for hours.
    #>
    It 'continues when the CLI was stopped but the stack actually came up' {
        Mock -CommandName Invoke-AfctComposeBounded -MockWith {
            @{ ExitCode = $null; TimedOut = $true; StdOut = @(); StdErr = @(); Seconds = 30 }
        }
        Mock -CommandName Get-AfctStackState -MockWith {
            [pscustomobject]@{ Services = @(); AllReady = $true; AppReady = $true; HttpOk = $true
                               ExpectedTag = 'v1.0.0'; ImageMatches = $true; OptionalWarnings = @() }
        }
        { Start-AfctStack -TimeoutSeconds 30 } | Should -Not -Throw
    }

    It 'fails when the CLI was stopped and the stack did not come up' {
        Mock -CommandName Invoke-AfctComposeBounded -MockWith {
            @{ ExitCode = $null; TimedOut = $true; StdOut = @(); StdErr = @(); Seconds = 30 }
        }
        Mock -CommandName Get-AfctStackState -MockWith {
            [pscustomobject]@{ Services = @(); AllReady = $false; AppReady = $false; HttpOk = $false
                               ExpectedTag = 'v1.0.0'; ImageMatches = $true; OptionalWarnings = @() }
        }
        { Start-AfctStack -TimeoutSeconds 30 } | Should -Throw '*did not finish starting*'
    }

    It 'fails when the CLI was stopped and the wrong version is running' {
        # Every container up, but not the release this install asked for. Reporting that as
        # a finished installation would be worse than failing.
        Mock -CommandName Invoke-AfctComposeBounded -MockWith {
            @{ ExitCode = $null; TimedOut = $true; StdOut = @(); StdErr = @(); Seconds = 30 }
        }
        Mock -CommandName Get-AfctStackState -MockWith {
            [pscustomobject]@{ Services = @(); AllReady = $true; AppReady = $true; HttpOk = $true
                               ExpectedTag = 'v1.0.0'; ImageMatches = $false; OptionalWarnings = @() }
        }
        { Start-AfctStack -TimeoutSeconds 30 } | Should -Throw '*did not finish starting*'
    }

    It 'only ever runs `up --detach`, never anything destructive' {
        # No `down`, no `rm`, no volume removal: a startup that stops making progress must
        # not take the database with it.
        $script:composeCalls = New-Object System.Collections.ArrayList
        Mock -CommandName Invoke-AfctComposeBounded -MockWith {
            $null = $script:composeCalls.Add((@($ComposeArgs) -join ' '))
            @{ ExitCode = 0; TimedOut = $false; StdOut = @(); StdErr = @(); Seconds = 1 }
        }
        Start-AfctStack -TimeoutSeconds 30 | Out-Null
        # The required services by name: a bare `up` would include the optional updater
        # whenever its profile is active, and an unavailable updater image would then fail
        # the base installation.
        @($script:composeCalls) | Should -Be @('up --detach postgres app worker nginx db-backup')
    }
}

<#
  The defect that caused the original hang, guarded directly.

  `Invoke-AfctCompose up -d` does not run `docker compose up -d`. These helpers take their
  arguments through a [Parameter()] attribute, which makes them advanced functions and gives
  them PowerShell's common parameters, and a literal `-d` binds to `-Debug` instead of being
  forwarded. What ran was `docker compose up`, attached, which starts every container and
  then streams their logs forever: exactly the "all five containers running, installer stuck
  on one line for hours" that was reported.

  A test that mocks the helper cannot see this, because the argument is lost at the call
  site. So these assert on the command line a real docker would have received.
#>
Describe 'Compose flags that PowerShell would otherwise swallow' {
    AfterEach { $env:PATH = $script:OriginalPath }

    It 'sends --detach, so the stack starts in the background' {
        Use-DockerShim "@echo off`r`necho %*`r`nexit /b 0"
        $r = Invoke-AfctComposeBounded -TimeoutSeconds 30 up --detach
        $line = (@($r.StdOut) -join ' ')
        $line | Should -Match '--detach'
        # The failure mode is silent: `up` on its own is a perfectly valid command that
        # never returns, so the absence of the flag is the whole bug.
        $line | Should -Match '\bup\b'
    }

    It 'loses a literal -d, which is why the long form is mandatory' {
        # Demonstrates the trap rather than the fix. If a future PowerShell ever stopped
        # binding -d to -Debug this would fail, and the rule could be relaxed.
        function Test-RemainingBinding {
            param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest)
            return (@($Rest) -join ' ')
        }
        Test-RemainingBinding up -d | Should -Be 'up'
        Test-RemainingBinding down -v | Should -Be 'down'
        Test-RemainingBinding up --detach | Should -Be 'up --detach'
        Test-RemainingBinding down --volumes | Should -Be 'down --volumes'
    }

    It 'never passes a bare -d or -v anywhere in the Windows deployment code' {
        $root = Join-Path $RepoRoot 'deploy\windows'
        $offenders = @()
        foreach ($file in Get-ChildItem -LiteralPath $root -Filter *.ps1 -Recurse) {
            $n = 0
            foreach ($line in Get-Content -LiteralPath $file.FullName) {
                $n++
                if ($line -match '^\s*#') { continue }
                if ($line -match 'Invoke-AfctCompose(Console|Bounded)?\b[^#]*\s-(d|v)(\s|$)') {
                    $offenders += "$($file.Name):$n"
                }
            }
        }
        $offenders | Should -BeNullOrEmpty
    }
}

<#
  A long Compose call must not look like a dead terminal.

  `up --detach` is most of the wait on a first install, because Compose honours the
  dependency conditions itself: it does not return until postgres is healthy, then the app
  is healthy, then nginx has started. The per-service progress cannot begin until then, so
  without this the window shows one line for minutes.
#>
Describe 'Startup heartbeat' {
    AfterEach { $env:PATH = $script:OriginalPath }

    It 'reports that it is still waiting, without extending the deadline' {
        Use-DockerShim "@echo off`r`nping -n 120 127.0.0.1 >nul`r`nexit /b 0"
        $script:beats = New-Object System.Collections.ArrayList
        $started = Get-Date

        $r = Invoke-AfctNativeBounded -FilePath 'docker' -ArgumentList @('compose', 'up') `
            -TimeoutSeconds 4 -HeartbeatSeconds 1 -OnHeartbeat {
                param($elapsed) $null = $script:beats.Add($elapsed)
            }

        $r.TimedOut | Should -BeTrue
        # Several beats, and the last one strictly inside the deadline: a heartbeat that
        # fired on the way out would prove nothing about the terminal staying alive.
        @($script:beats).Count | Should -BeGreaterThan 1
        ($script:beats | Select-Object -Last 1) | Should -BeLessThan 4
        # And the deadline itself is unchanged by the slicing.
        ((Get-Date) - $started).TotalSeconds | Should -BeLessThan 20
    }

    It 'does not fire a heartbeat when the command returns promptly' {
        Use-DockerShim "@echo off`r`nexit /b 0"
        $script:beats = New-Object System.Collections.ArrayList
        Invoke-AfctNativeBounded -FilePath 'docker' -ArgumentList @('compose', 'ps') `
            -TimeoutSeconds 30 -HeartbeatSeconds 1 -OnHeartbeat {
                param($elapsed) $null = $script:beats.Add($elapsed)
            } | Out-Null
        @($script:beats).Count | Should -Be 0
    }

    It 'prints a still-waiting line from the startup path' {
        Mock -CommandName Write-AfctInfo -MockWith { }
        Mock -CommandName Write-AfctTrace -MockWith { }
        Mock -CommandName Write-AfctSuccess -MockWith { }
        Mock -CommandName Invoke-AfctComposeBounded -MockWith {
            # Stand in for Compose taking its time: fire the caller's own heartbeat block.
            & $OnHeartbeat 30
            & $OnHeartbeat 60
            @{ ExitCode = 0; TimedOut = $false; StdOut = @(); StdErr = @(); Seconds = 65 }
        }
        Start-AfctStack -TimeoutSeconds 300 | Out-Null
        Should -Invoke Write-AfctInfo -ParameterFilter {
            $Message -eq 'Docker Compose is still starting containers after 30s...'
        }
        Should -Invoke Write-AfctInfo -ParameterFilter {
            $Message -eq 'Docker Compose is still starting containers after 60s...'
        }
    }
}

<#
  Bounded inspection.

  Diagnostics run after something has already failed, which is when the daemon is most
  likely to be wedged. An unbounded inspection there replaces a reported failure with an
  unreported one: "Collecting diagnostics..." and then nothing, forever.
#>
Describe 'Docker inspection cannot hang' {
    AfterEach { $env:PATH = $script:OriginalPath }

    It 'treats a wedged daemon as not ready rather than waiting for it' {
        Use-DockerShim "@echo off`r`nping -n 120 127.0.0.1 >nul`r`nexit /b 0"
        $env:AFCT_DOCKER_COMMAND_TIMEOUT = '2'
        try {
            $started = Get-Date
            Test-AfctDockerReady | Should -BeFalse
            ((Get-Date) - $started).TotalSeconds | Should -BeLessThan 30
        } finally { Remove-Item Env:\AFCT_DOCKER_COMMAND_TIMEOUT -ErrorAction SilentlyContinue }
    }

    It 'says so, rather than hanging, when the preflight gets no answer' {
        Use-DockerShim "@echo off`r`nping -n 120 127.0.0.1 >nul`r`nexit /b 0"
        $env:AFCT_DOCKER_COMMAND_TIMEOUT = '2'
        try { { Assert-AfctDockerReady } | Should -Throw '*did not respond*' }
        finally { Remove-Item Env:\AFCT_DOCKER_COMMAND_TIMEOUT -ErrorAction SilentlyContinue }
    }

    It 'reads a service as missing when compose ps or inspect never answers' {
        Use-DockerShim "@echo off`r`nping -n 120 127.0.0.1 >nul`r`nexit /b 0"
        $env:AFCT_DOCKER_COMMAND_TIMEOUT = '2'
        try {
            $started = Get-Date
            Get-AfctServiceState 'app' | Should -Be 'missing|none|'
            ((Get-Date) - $started).TotalSeconds | Should -BeLessThan 30
        } finally { Remove-Item Env:\AFCT_DOCKER_COMMAND_TIMEOUT -ErrorAction SilentlyContinue }
    }

    It 'leaves no child process behind after a bounded inspection times out' {
        Use-DockerShim "@echo off`r`nping -n 121 127.0.0.1 >nul`r`nexit /b 0"
        Invoke-AfctDockerBounded -TimeoutSeconds 2 info | Out-Null
        Start-Sleep -Seconds 1
        @(Get-CimInstance Win32_Process -Filter "Name='PING.EXE'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -and $_.CommandLine -match '-n 121' }).Count | Should -Be 0
    }

    It 'fails the preflight with a message when compose config never answers' {
        Use-DockerShim "@echo off`r`nping -n 120 127.0.0.1 >nul`r`nexit /b 0"
        $env:AFCT_DOCKER_COMMAND_TIMEOUT = '2'
        try { { Test-AfctComposeConfig } | Should -Throw '*did not respond*' }
        finally { Remove-Item Env:\AFCT_DOCKER_COMMAND_TIMEOUT -ErrorAction SilentlyContinue }
    }

    It 'gives up on a bind-mount probe that never answers' {
        Use-DockerShim "@echo off`r`nping -n 120 127.0.0.1 >nul`r`nexit /b 0"
        $env:AFCT_DOCKER_COMMAND_TIMEOUT = '2'
        try {
            $started = Get-Date
            Test-AfctDockerBindMount 'alpine:3.20' 'C:\afct' | Should -BeFalse
            ((Get-Date) - $started).TotalSeconds | Should -BeLessThan 30
        } finally { Remove-Item Env:\AFCT_DOCKER_COMMAND_TIMEOUT -ErrorAction SilentlyContinue }
    }

    <#
      The bind-mount probe is the one command in the installer carrying both a -v and a -d.
      Written as loose tokens, PowerShell binds them to the common -Verbose and -Debug
      parameters and docker receives a run with no volume and no test flag: the same silent
      misbinding that produced the original hang. The argument array is what prevents it.
    #>
    It 'sends the bind-mount volume and test flags through to docker' {
        Use-DockerShim "@echo off`r`necho %*`r`nexit /b 0"
        $r = Invoke-AfctDockerBounded -DockerArgs @(
            'run', '--rm', '--volume', 'C:\afct:/afct-bind-check:ro', 'alpine:3.20',
            'test', '-d', '/afct-bind-check')
        $line = (@($r.StdOut) -join ' ')
        $line | Should -Match '--volume'
        $line | Should -Match '-d'
        $line | Should -Match '/afct-bind-check'
    }

    It 'gives up on an image-presence check that never answers' {
        Use-DockerShim "@echo off`r`nping -n 120 127.0.0.1 >nul`r`nexit /b 0"
        $env:AFCT_DOCKER_COMMAND_TIMEOUT = '2'
        try { Test-AfctDockerImagePresent 'alpine:3.20' | Should -BeFalse }
        finally { Remove-Item Env:\AFCT_DOCKER_COMMAND_TIMEOUT -ErrorAction SilentlyContinue }
    }

    It 'reports a pull that never finishes as a failure rather than waiting' {
        Use-DockerShim "@echo off`r`nping -n 120 127.0.0.1 >nul`r`nexit /b 0"
        $env:AFCT_DOCKER_PULL_TIMEOUT = '2'
        try { Invoke-AfctDockerPull 'alpine:3.20' | Should -Not -Be 0 }
        finally { Remove-Item Env:\AFCT_DOCKER_PULL_TIMEOUT -ErrorAction SilentlyContinue }
    }

    It 'records the timeout in the diagnostics bundle instead of an empty file' {
        $dir = Join-Path $Work ('diag-' + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        Save-AfctDiagnosticCommand $dir 'docker-info.txt' {
            @{ TimedOut = $true; ExitCode = $null; StdOut = @('partial line'); StdErr = @() }
        }
        Test-Path -LiteralPath (Join-Path $dir 'docker-info.txt.timed-out.txt') | Should -BeTrue
        $text = Get-Content -LiteralPath (Join-Path $dir 'docker-info.txt.timed-out.txt') -Raw
        $text | Should -Match 'did not respond'
        # Whatever it managed to say is kept: a partial answer is still evidence.
        $text | Should -Match 'partial line'
    }

    It 'keeps collecting after one step fails outright' {
        $dir = Join-Path $Work ('diag2-' + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        { Save-AfctDiagnosticCommand $dir 'compose-ps.txt' { throw 'daemon exploded' } } | Should -Not -Throw
        Test-Path -LiteralPath (Join-Path $dir 'compose-ps.txt.failed.txt') | Should -BeTrue
    }
}

<#
  The image download is the longest step, and it was the last unbounded one.

  Leaving it unbounded would have moved the original failure rather than fixed it: the same
  motionless window, reading "downloading AFCT container images..." instead of "starting the
  AFCT stack...". It costs Docker's own progress bars, so the heartbeat prints the last line
  of the capture instead.
#>
Describe 'The image download is bounded and visible' {
    BeforeEach {
        Mock -CommandName Write-AfctInfo -MockWith { }
        Mock -CommandName Write-AfctSuccess -MockWith { }
        Mock -CommandName Write-AfctWarn -MockWith { }
        Mock -CommandName Write-AfctTrace -MockWith { }
        Mock -CommandName Write-Host -MockWith { }
        Set-Content -LiteralPath $EnvFile -Encoding UTF8 -Value @('AFCT_APP_TAG=v1.2.3')
    }

    It 'stops a download that never finishes, and says anything already fetched is kept' {
        Mock -CommandName Invoke-AfctComposeBounded -MockWith {
            @{ ExitCode = $null; TimedOut = $true; StdOut = @(); StdErr = @(); Seconds = 1800 }
        }
        { Get-AfctImages } | Should -Throw '*still downloading*'
        { Get-AfctImages } | Should -Throw '*already downloaded is kept*'
    }

    It 'reports progress from the capture while a long download runs' {
        $out = Join-Path $Work ('pull-' + [Guid]::NewGuid().ToString('N') + '.out')
        Set-Content -LiteralPath $out -Encoding UTF8 -Value @(
            'app Pulling', 'a1b2c3 Downloading [====>     ] 1.2GB/4.7GB')
        Mock -CommandName Invoke-AfctComposeBounded -MockWith {
            & $OnHeartbeat 30 $out ''
            & $OnHeartbeat 120 $out ''
            @{ ExitCode = 0; TimedOut = $false; StdOut = @(); StdErr = @(); Seconds = 130 }
        }
        Get-AfctImages
        Should -Invoke Write-AfctInfo -ParameterFilter { $Message -match 'still downloading after 30s.*1\.2GB/4\.7GB' }
        # Past a minute it reads in minutes, because "after 120s" is not how anybody waits.
        Should -Invoke Write-AfctInfo -ParameterFilter { $Message -match 'still downloading after 2m' }
    }

    It 'still says something useful when the capture has nothing in it yet' {
        Mock -CommandName Invoke-AfctComposeBounded -MockWith {
            & $OnHeartbeat 30 'C:\nope\missing.out' 'C:\nope\missing.err'
            @{ ExitCode = 0; TimedOut = $false; StdOut = @(); StdErr = @(); Seconds = 31 }
        }
        { Get-AfctImages } | Should -Not -Throw
        Should -Invoke Write-AfctInfo -ParameterFilter { $Message -eq 'still downloading after 30s...' }
    }

    It 'keeps the real Docker error when a pull fails' {
        Mock -CommandName Invoke-AfctComposeBounded -MockWith {
            @{ ExitCode = 1; TimedOut = $false; StdOut = @()
               StdErr = @('denied: requested access to the resource is denied'); Seconds = 3 }
        }
        { Get-AfctImages } | Should -Throw '*could not be downloaded*'
        Should -Invoke Write-Host -ParameterFilter { "$Object" -match 'requested access' }
    }
}

<#
  An enabled updater must not be able to fail the core startup.

  `Get-AfctComposeBaseArgs` adds `--profile updater` to every Compose command while the
  updater is enabled, so a bare `up` includes it. If its image is missing or private,
  Compose fails the whole operation and the base installation never happens, over an
  optional experimental sidecar. Naming the required services is what keeps them apart.
#>
Describe 'Starting an enabled updater separately from the core' {
    BeforeEach {
        Mock -CommandName Write-AfctInfo -MockWith { }
        Mock -CommandName Write-AfctSuccess -MockWith { }
        Mock -CommandName Write-AfctWarn -MockWith { }
        Mock -CommandName Write-AfctTrace -MockWith { }
        Mock -CommandName Write-Host -MockWith { }
        Set-Content -LiteralPath $EnvFile -Encoding UTF8 -Value @(
            'AFCT_APP_TAG=v1.2.3', 'AFCT_UPDATER_ENABLED=true')
    }
    AfterEach {
        Set-Content -LiteralPath $EnvFile -Encoding UTF8 -Value @('AFCT_APP_TAG=v1.2.3')
    }

    It 'never names the updater in the core startup' {
        $script:calls = New-Object System.Collections.ArrayList
        Mock -CommandName Invoke-AfctComposeBounded -MockWith {
            $null = $script:calls.Add((@($ComposeArgs) -join ' '))
            @{ ExitCode = 0; TimedOut = $false; StdOut = @(); StdErr = @(); Seconds = 1 }
        }
        Start-AfctStack -TimeoutSeconds 30 | Out-Null
        @($script:calls)[0] | Should -Not -Match 'updater'
        @($script:calls)[0] | Should -Match 'postgres'
        # And the updater gets its own call afterwards.
        @($script:calls)[1] | Should -Be 'up --detach updater'
    }

    It 'still succeeds when the optional updater will not start' {
        Mock -CommandName Invoke-AfctComposeBounded -MockWith {
            if ((@($ComposeArgs) -join ' ') -match 'updater') {
                return @{ ExitCode = 1; TimedOut = $false; StdOut = @()
                          StdErr = @('manifest unknown'); Seconds = 1 }
            }
            @{ ExitCode = 0; TimedOut = $false; StdOut = @(); StdErr = @(); Seconds = 1 }
        }
        { Start-AfctStack -TimeoutSeconds 30 } | Should -Not -Throw
        Should -Invoke Write-AfctWarn -ParameterFilter { $Message -match 'optional updater service could not be started' }
    }

    It 'still fails when a required service will not start' {
        # The optional path must not become cover for a real failure.
        Mock -CommandName Invoke-AfctComposeBounded -MockWith {
            @{ ExitCode = 1; TimedOut = $false; StdOut = @(); StdErr = @('port is already allocated'); Seconds = 1 }
        }
        { Start-AfctStack -TimeoutSeconds 30 } | Should -Throw '*could not be started*'
    }

    It 'issues no optional call at all while the updater is disabled' {
        Set-Content -LiteralPath $EnvFile -Encoding UTF8 -Value @('AFCT_APP_TAG=v1.2.3')
        $script:calls = New-Object System.Collections.ArrayList
        Mock -CommandName Invoke-AfctComposeBounded -MockWith {
            $null = $script:calls.Add((@($ComposeArgs) -join ' '))
            @{ ExitCode = 0; TimedOut = $false; StdOut = @(); StdErr = @(); Seconds = 1 }
        }
        Start-AfctStack -TimeoutSeconds 30 | Out-Null
        @($script:calls).Count | Should -Be 1
    }
}

Describe 'Test-AfctServiceReady' {
    <#
      The worker defines no Docker health check, so Docker reports its health as "none".
      Requiring health for it would fail every good install; not requiring it for the
      others would pass a stack whose app is unhealthy.
    #>
    It 'requires healthy only where a health check exists' {
        Test-AfctServiceReady -State 'running|healthy|img' -RequiresHealth $true  | Should -BeTrue
        Test-AfctServiceReady -State 'running|none|img'    -RequiresHealth $true  | Should -BeFalse
        Test-AfctServiceReady -State 'running|starting|img' -RequiresHealth $true | Should -BeFalse
        Test-AfctServiceReady -State 'running|none|img'    -RequiresHealth $false | Should -BeTrue
        Test-AfctServiceReady -State 'exited|none|img'     -RequiresHealth $false | Should -BeFalse
        Test-AfctServiceReady -State 'missing|none|'       -RequiresHealth $false | Should -BeFalse
    }

    It 'lists the worker as the one service without a health requirement' {
        $svcs = Get-AfctExpectedServices
        ($svcs | Where-Object { -not $_.RequiresHealth }).Name | Should -Be 'worker'
        @($svcs).Count | Should -Be 5
    }
}

Describe 'Get-AfctStackState' {
    BeforeEach {
        Mock -CommandName Test-AfctHttpHealth -MockWith { $true }
        Set-Content -LiteralPath $EnvFile -Value @('AFCT_APP_TAG=v1.2.3') -Encoding UTF8
        Remove-Item Env:\AFCT_APP_TAG -ErrorAction SilentlyContinue
    }

    It 'is ready when every service is where it should be' {
        Mock -CommandName Get-AfctServiceState -MockWith {
            if ($Service -eq 'postgres') { return 'running|healthy|postgres:15-alpine@sha256:abc' }
            if ($Service -eq 'worker') { return 'running|none|ghcr.io/x/afct-dashboard:v1.2.3' }
            return 'running|healthy|ghcr.io/x/afct-dashboard:v1.2.3'
        }
        $s = Get-AfctStackState
        $s.AllReady | Should -BeTrue
        $s.ImageMatches | Should -BeTrue
    }

    It 'is not ready when nginx never started' {
        Mock -CommandName Get-AfctServiceState -MockWith {
            if ($Service -eq 'nginx') { return 'missing|none|' }
            if ($Service -eq 'worker') { return 'running|none|img:v1.2.3' }
            return 'running|healthy|img:v1.2.3'
        }
        (Get-AfctStackState).AllReady | Should -BeFalse
    }

    It 'is not ready when the worker is missing' {
        Mock -CommandName Get-AfctServiceState -MockWith {
            if ($Service -eq 'worker') { return 'missing|none|' }
            return 'running|healthy|img:v1.2.3'
        }
        (Get-AfctStackState).AllReady | Should -BeFalse
    }

    It 'is not ready when only PostgreSQL came up' {
        # The partially-started stack: the database is fine and nothing else is.
        Mock -CommandName Get-AfctServiceState -MockWith {
            if ($Service -eq 'postgres') { return 'running|healthy|postgres:15' }
            return 'missing|none|'
        }
        $s = Get-AfctStackState
        $s.AllReady | Should -BeFalse
        ($s.Services | Where-Object { $_.Name -eq 'postgres' }).Ready | Should -BeTrue
    }

    <#
      Every AFCT service is published under one release tag, so a stack whose app is new and
      whose worker is a release behind is two releases sharing a database, not a deployment
      anybody asked for. Checking the app alone called that correct.
    #>
    It 'rejects the deployment when any single versioned service is stale' -ForEach @(
        @{ Stale = 'app' }, @{ Stale = 'worker' }, @{ Stale = 'nginx' }, @{ Stale = 'db-backup' }
    ) {
        $target = $Stale
        Mock -CommandName Get-AfctServiceState -MockWith {
            $tag = 'v1.2.3'
            if ($Service -eq $target) { $tag = 'v0.9.9' }
            if ($Service -eq 'postgres') { return 'running|healthy|postgres:15-alpine@sha256:abc' }
            if ($Service -eq 'worker') { return "running|none|img:$tag" }
            return "running|healthy|img:$tag"
        }
        $s = Get-AfctStackState
        # Everything is up. That is exactly why the version check has to be separate.
        $s.AllReady | Should -BeTrue
        $s.ImageMatches | Should -BeFalse
        @(Get-AfctStaleServices $s).Name | Should -Be $target
    }

    It 'ignores PostgreSQL, which is pinned by digest on its own schedule' {
        Mock -CommandName Get-AfctServiceState -MockWith {
            # A digest-pinned reference whose last colon belongs to the digest, not a tag.
            if ($Service -eq 'postgres') { return 'running|healthy|postgres:15-alpine@sha256:deadbeef' }
            if ($Service -eq 'worker') { return 'running|none|img:v1.2.3' }
            return 'running|healthy|img:v1.2.3'
        }
        $s = Get-AfctStackState
        $s.ImageMatches | Should -BeTrue
        ($s.Services | Where-Object { $_.Name -eq 'postgres' }).Versioned | Should -BeFalse
        ($s.Services | Where-Object { $_.Name -eq 'postgres' }).ExpectedImageTag | Should -Be ''
    }

    It 'skips the HTTP probe when asked to' {
        Mock -CommandName Get-AfctServiceState -MockWith { 'running|healthy|img:v1.2.3' }
        Get-AfctStackState -SkipHttp | Out-Null
        Should -Invoke Test-AfctHttpHealth -Exactly 0
    }
}

<#
Which release a deployment is supposed to be running.

Compose resolves ${AFCT_APP_TAG:-main} from the process environment first and the env file
second. Anything that asks "is the right version running" has to resolve it the same way,
or a cross-version update whose CLI times out compares correctly-started new containers
against the old pin still sitting in .env.production and calls them stale.
#>
Describe 'Get-AfctEffectiveAppTag' {
    BeforeEach { Remove-Item Env:\AFCT_APP_TAG -ErrorAction SilentlyContinue }
    AfterAll   { Remove-Item Env:\AFCT_APP_TAG -ErrorAction SilentlyContinue }

    It 'reads the env file when nothing is exported' {
        Set-Content -LiteralPath $EnvFile -Value @('AFCT_APP_TAG=v1.2.3') -Encoding UTF8
        Get-AfctEffectiveAppTag | Should -Be 'v1.2.3'
    }

    It 'uses the exported value when the env file has none' {
        Set-Content -LiteralPath $EnvFile -Value @('ADMIN_EMAIL=a@b.c') -Encoding UTF8
        $env:AFCT_APP_TAG = 'v2.0.0'
        Get-AfctEffectiveAppTag | Should -Be 'v2.0.0'
    }

    It 'prefers the exported value over the env file, as Compose does' {
        Set-Content -LiteralPath $EnvFile -Value @('AFCT_APP_TAG=v1.2.3') -Encoding UTF8
        $env:AFCT_APP_TAG = 'v2.0.0'
        Get-AfctEffectiveAppTag | Should -Be 'v2.0.0'
    }

    It 'falls back to main, which is the Compose file default' {
        Set-Content -LiteralPath $EnvFile -Value @('ADMIN_EMAIL=a@b.c') -Encoding UTF8
        Get-AfctEffectiveAppTag | Should -Be 'main'
    }

    <#
      The update-specific bug. A cross-version update exports the new tag and only writes it
      into .env.production after the update succeeds. If the Compose CLI times out during
      that window, the recovery check must judge the containers against the release being
      deployed, not the one still recorded on disk.
    #>
    It 'judges a mid-update deployment against the release being deployed' {
        Set-Content -LiteralPath $EnvFile -Value @('AFCT_APP_TAG=v0.9.9') -Encoding UTF8
        $env:AFCT_APP_TAG = 'v1.0.0'
        Mock -CommandName Get-AfctServiceState -MockWith {
            if ($Service -eq 'postgres') { return 'running|healthy|postgres:15-alpine@sha256:abc' }
            if ($Service -eq 'worker') { return 'running|none|img:v1.0.0' }
            return 'running|healthy|img:v1.0.0'
        }
        Mock -CommandName Test-AfctHttpHealth -MockWith { $true }

        $s = Get-AfctStackState
        $s.ExpectedTag | Should -Be 'v1.0.0'
        $s.ImageMatches | Should -BeTrue
    }

    It 'still rejects containers left on the old release mid-update' {
        Set-Content -LiteralPath $EnvFile -Value @('AFCT_APP_TAG=v0.9.9') -Encoding UTF8
        $env:AFCT_APP_TAG = 'v1.0.0'
        Mock -CommandName Get-AfctServiceState -MockWith {
            if ($Service -eq 'postgres') { return 'running|healthy|postgres:15-alpine@sha256:abc' }
            if ($Service -eq 'worker') { return 'running|none|img:v0.9.9' }
            return 'running|healthy|img:v0.9.9'
        }
        Mock -CommandName Test-AfctHttpHealth -MockWith { $true }

        (Get-AfctStackState).ImageMatches | Should -BeFalse
    }
}

Describe 'Wait-AfctHealth' {
    BeforeEach {
        Mock -CommandName Write-AfctInfo -MockWith { }
        Mock -CommandName Write-AfctSuccess -MockWith { }
        Mock -CommandName Write-AfctWarn -MockWith { }
        Mock -CommandName Write-AfctTrace -MockWith { }
        Mock -CommandName Start-Sleep -MockWith { }
        Mock -CommandName Test-AfctHttpHealth -MockWith { $true }
    }

    It 'returns once every service is ready' {
        Mock -CommandName Get-AfctStackState -MockWith {
            [pscustomobject]@{ Services = @(); AllReady = $true; AppReady = $true; HttpOk = $true
                               ExpectedTag = ''; ImageMatches = $true; OptionalWarnings = @() }
        }
        Mock -CommandName Get-AfctAppContainerState -MockWith { 'running|healthy' }
        { Wait-AfctHealth -TimeoutSeconds 30 } | Should -Not -Throw
    }

    It 'names an unhealthy application as the reason' {
        Mock -CommandName Get-AfctStackState -MockWith {
            [pscustomobject]@{ Services = @(); AllReady = $false; AppReady = $false; HttpOk = $false
                               ExpectedTag = ''; ImageMatches = $true; OptionalWarnings = @() }
        }
        Mock -CommandName Get-AfctAppContainerState -MockWith { 'running|unhealthy' }
        { Wait-AfctHealth -TimeoutSeconds 30 } | Should -Throw '*unhealthy state*'
    }

    It 'fails fast on a crash loop instead of waiting out the timeout' {
        Mock -CommandName Get-AfctStackState -MockWith {
            [pscustomobject]@{ Services = @(); AllReady = $false; AppReady = $false; HttpOk = $false
                               ExpectedTag = ''; ImageMatches = $true; OptionalWarnings = @() }
        }
        Mock -CommandName Get-AfctAppContainerState -MockWith { 'restarting|none' }
        { Wait-AfctHealth -TimeoutSeconds 300 } | Should -Throw '*crash loop*'
        Should -Invoke Get-AfctAppContainerState -Exactly 3
    }

    It 'reports an application that stopped before becoming healthy' {
        Mock -CommandName Get-AfctStackState -MockWith {
            [pscustomobject]@{ Services = @(); AllReady = $false; AppReady = $false; HttpOk = $false
                               ExpectedTag = ''; ImageMatches = $true; OptionalWarnings = @() }
        }
        Mock -CommandName Get-AfctAppContainerState -MockWith { 'exited|none' }
        { Wait-AfctHealth -TimeoutSeconds 30 } | Should -Throw '*stopped before becoming healthy*'
    }

    It 'times out with the state it last saw, rather than silently' {
        Mock -CommandName Get-AfctStackState -MockWith {
            [pscustomobject]@{
                Services = @([pscustomobject]@{ Name = 'nginx'; Label = 'nginx'; Status = 'missing'
                                                Health = 'none'; Image = ''; Ready = $false
                                                Required = $true; Versioned = $true
                                                ExpectedImageTag = 'v1.2.3'; ActualImageTag = ''
                                                ImageMatches = $true })
                AllReady = $false; AppReady = $false; HttpOk = $false
                ExpectedTag = ''; ImageMatches = $true; OptionalWarnings = @() }
        }
        Mock -CommandName Get-AfctAppContainerState -MockWith { $null }
        { Wait-AfctHealth -TimeoutSeconds 3 } | Should -Throw '*nginx: missing*'
    }

    <#
      The installer looked frozen because it printed one line and then nothing for the
      whole startup. Every stage printed is one that was read back from the daemon.
    #>
    It 'announces each service as it becomes ready' {
        $script:calls = 0
        Mock -CommandName Get-AfctStackState -MockWith {
            $script:calls++
            $ready = ($script:calls -ge 2)
            [pscustomobject]@{
                Services = @(
                    [pscustomobject]@{ Name = 'postgres'; Label = 'PostgreSQL'; Status = 'running'
                                       Health = 'healthy'; Image = 'p:v1.2.3'; Ready = $true
                                       Required = $true; Versioned = $false; ExpectedImageTag = ''
                                       ActualImageTag = 'v1.2.3'; ImageMatches = $true },
                    [pscustomobject]@{ Name = 'app'; Label = 'AFCT application'
                                       Status = 'running'
                                       Health = $(if ($ready) { 'healthy' } else { 'starting' })
                                       Image = 'a:v1.2.3'; Ready = $ready
                                       Required = $true; Versioned = $true; ExpectedImageTag = 'v1.2.3'
                                       ActualImageTag = 'v1.2.3'; ImageMatches = $true }
                )
                AllReady = $ready; AppReady = $ready; HttpOk = $ready
                ExpectedTag = 'v1.2.3'; ImageMatches = $true; OptionalWarnings = @() }
        }
        Mock -CommandName Get-AfctAppContainerState -MockWith { 'running|healthy' }

        Wait-AfctHealth -TimeoutSeconds 30

        Should -Invoke Write-AfctInfo -ParameterFilter { $Message -eq 'AFCT application is starting...' }
        Should -Invoke Write-AfctSuccess -ParameterFilter { $Message -eq 'PostgreSQL is healthy.' }
        Should -Invoke Write-AfctSuccess -ParameterFilter { $Message -eq 'AFCT application is healthy.' }
    }
}

<#
  Ready has to mean the same thing everywhere.

  The health wait used to warn on a failed HTTP probe and return success anyway, so the
  installer could announce "AFCT Dashboard is ready" for a deployment that served nothing.
  The rerun check called that same state not-ready, so the installer and the thing that
  verifies the installer disagreed about what finishing meant.
#>
Describe 'HTTP health is part of being ready' {
    BeforeEach {
        Mock -CommandName Write-AfctInfo -MockWith { }
        Mock -CommandName Write-AfctSuccess -MockWith { }
        Mock -CommandName Write-AfctWarn -MockWith { }
        Mock -CommandName Write-AfctTrace -MockWith { }
        Mock -CommandName Start-Sleep -MockWith { }
        Mock -CommandName Get-AfctAppContainerState -MockWith { 'running|healthy' }
        Mock -CommandName Get-AfctStackState -MockWith {
            [pscustomobject]@{ Services = @(); AllReady = $true; AppReady = $true; HttpOk = $true
                               ExpectedTag = ''; ImageMatches = $true; OptionalWarnings = @() }
        }
    }

    It 'succeeds when the web service answers straight away' {
        Mock -CommandName Test-AfctHttpHealth -MockWith { $true }
        { Wait-AfctHealth -TimeoutSeconds 30 } | Should -Not -Throw
        Should -Invoke Test-AfctHttpHealth -Exactly 1
    }

    <#
      nginx accepts connections a moment before the app answers through it, so one miss is
      normal and must not fail an otherwise good install.
    #>
    It 'keeps polling when the web service is not up yet' {
        $script:httpCalls = 0
        Mock -CommandName Test-AfctHttpHealth -MockWith {
            $script:httpCalls++
            return ($script:httpCalls -ge 3)
        }
        { Wait-AfctHealth -TimeoutSeconds 30 } | Should -Not -Throw
        $script:httpCalls | Should -Be 3
        # Said once, not once per poll.
        Should -Invoke Write-AfctInfo -Exactly 1 -ParameterFilter {
            $Message -eq 'Containers are healthy; waiting for the web service...'
        }
    }

    It 'fails, naming the web service, when it never answers' {
        Mock -CommandName Test-AfctHttpHealth -MockWith { $false }
        { Wait-AfctHealth -TimeoutSeconds 5 } | Should -Throw '*web service never answered*'
    }

    It 'never reports success while the web service is silent' {
        Mock -CommandName Test-AfctHttpHealth -MockWith { $false }
        try { Wait-AfctHealth -TimeoutSeconds 5 } catch { }
        Should -Invoke Write-AfctSuccess -Exactly 0 -ParameterFilter { $Message -match 'responding at' }
    }
}

<#
  One budget, spent in order.

  Compose honours the dependency conditions itself, so `up` is already most of the wait.
  Giving the health wait a fresh full timeout afterwards would quietly turn a configured 300
  seconds into 600.
#>
Describe 'The shared startup budget' {
    BeforeEach {
        Mock -CommandName Write-AfctInfo -MockWith { }
        Mock -CommandName Write-AfctSuccess -MockWith { }
        Mock -CommandName Write-AfctTrace -MockWith { }
        Mock -CommandName Test-AfctComposeConfig -MockWith { }
        Mock -CommandName Wait-AfctHealth -MockWith { }
    }

    It 'gives the health wait only what startup left' {
        $script:HealthTimeout = 300
        Mock -CommandName Invoke-AfctComposeBounded -MockWith {
            @{ ExitCode = 0; TimedOut = $false; StdOut = @(); StdErr = @(); Seconds = 250 }
        }
        Invoke-AfctStartAndWait
        Should -Invoke Wait-AfctHealth -Exactly 1 -ParameterFilter { $TimeoutSeconds -eq 50 }
    }

    It 'still calls the health wait when startup used the whole budget' {
        # The floor inside Wait-AfctHealth keeps a zero or negative remainder from turning
        # into an immediate silent success.
        $script:HealthTimeout = 300
        Mock -CommandName Invoke-AfctComposeBounded -MockWith {
            @{ ExitCode = 0; TimedOut = $false; StdOut = @(); StdErr = @(); Seconds = 300 }
        }
        Invoke-AfctStartAndWait
        Should -Invoke Wait-AfctHealth -Exactly 1 -ParameterFilter { $TimeoutSeconds -le 0 }
    }
}

<#
  A release can change the Compose definition itself.

  The new file lands on disk when the release is installed; the running containers know
  nothing about it. A rerun that skipped `up` because everything looked healthy would leave
  the deployment permanently running a configuration that no longer exists.
#>
<#
  The startup timeout has to be a real deadline, not a count of sleeps.

  Two things were wrong. A remaining budget of zero was read as "no value supplied" and
  replaced with another full timeout, so a Compose call that used all 300 seconds bought 300
  more. And elapsed time was tracked by adding the poll interval each pass, counting none of
  the real work: two bounded Docker calls per service per pass, plus an HTTP probe allowed
  ten seconds of its own. A nominal five minutes could run for a quarter of an hour.
#>
Describe 'The startup deadline is wall-clock' {
    BeforeEach {
        Mock -CommandName Write-AfctInfo -MockWith { }
        Mock -CommandName Write-AfctSuccess -MockWith { }
        Mock -CommandName Write-AfctWarn -MockWith { }
        Mock -CommandName Write-AfctTrace -MockWith { }
        Mock -CommandName Get-AfctAppContainerState -MockWith { $null }
        Mock -CommandName Get-AfctStackState -MockWith {
            [pscustomobject]@{ Services = @(); AllReady = $false; AppReady = $false; HttpOk = $false
                               ExpectedTag = ''; ImageMatches = $true; OptionalWarnings = @() }
        }
    }

    It 'does not hand out a second full timeout when nothing is left' {
        # The whole budget was spent by Compose. Real sleeps, no mock, so a reset to the
        # configured 300 would take five minutes and blow the test's own limit.
        $script:HealthTimeout = 300
        $started = Get-Date
        { Wait-AfctHealth -TimeoutSeconds 0 } | Should -Throw '*did not finish starting*'
        ((Get-Date) - $started).TotalSeconds | Should -BeLessThan 30
    }

    <#
      Time spent inside the loop counts. Each pass here burns two seconds of real time in
      the Docker inspection, so a four-second budget is gone after about two passes, where
      counting sleeps alone would have allowed four.
    #>
    It 'charges slow Docker inspection against the budget' {
        $script:HealthInterval = 1
        $script:calls = 0
        Mock -CommandName Get-AfctStackState -MockWith {
            $script:calls++
            Start-Sleep -Seconds 2
            [pscustomobject]@{ Services = @(); AllReady = $false; AppReady = $false; HttpOk = $false
                               ExpectedTag = ''; ImageMatches = $true; OptionalWarnings = @() }
        }
        $started = Get-Date
        { Wait-AfctHealth -TimeoutSeconds 4 } | Should -Throw
        $spent = ((Get-Date) - $started).TotalSeconds
        # Bounded by the budget plus one pass of overshoot, not by four sleeps plus four
        # two-second inspections.
        $spent | Should -BeLessThan 12
        $script:calls | Should -BeLessThan 5
    }

    It 'charges a slow HTTP probe against the budget' {
        $script:HealthInterval = 1
        Mock -CommandName Get-AfctStackState -MockWith {
            [pscustomobject]@{ Services = @(); AllReady = $true; AppReady = $true; HttpOk = $false
                               ExpectedTag = ''; ImageMatches = $true; OptionalWarnings = @() }
        }
        Mock -CommandName Get-AfctAppContainerState -MockWith { 'running|healthy' }
        $script:probes = 0
        Mock -CommandName Test-AfctHttpHealth -MockWith {
            $script:probes++
            Start-Sleep -Seconds 2
            return $false
        }
        $started = Get-Date
        { Wait-AfctHealth -TimeoutSeconds 4 } | Should -Throw '*web service never answered*'
        ((Get-Date) - $started).TotalSeconds | Should -BeLessThan 12
        $script:probes | Should -BeLessThan 5
    }

    It 'is not extended by heartbeat reporting' {
        $script:HealthInterval = 1
        $started = Get-Date
        { Wait-AfctHealth -TimeoutSeconds 3 } | Should -Throw
        ((Get-Date) - $started).TotalSeconds | Should -BeLessThan 12
    }

    It 'still uses the configured total when no budget is passed at all' {
        $script:HealthTimeout = 2
        $script:HealthInterval = 1
        { Wait-AfctHealth } | Should -Throw '*within 2 seconds*'
    }

    AfterAll {
        $script:HealthTimeout = 30
        $script:HealthInterval = 1
    }
}

<#
  The deadline's tail, which is the part a two-second mocked pass hides.

  A pass that begins one second inside the budget still runs two bounded Docker calls for
  each of five or six services. At the full inspection allowance each, against a daemon that
  has just wedged, that is minutes of overrun on a timeout somebody was told was five. The
  remaining budget is handed down so each call is capped by what is actually left.
#>
Describe 'The deadline caps the inspection, not just the loop' {
    AfterEach { $env:PATH = $script:OriginalPath }

    It 'shortens each Docker call to whatever is left' {
        Get-AfctInspectionTimeout 3 | Should -Be 3
        # Never longer than the normal allowance...
        Get-AfctInspectionTimeout 9999 | Should -Be (Get-AfctDockerCommandTimeout)
        # ...and no caller-supplied budget means the normal allowance, not zero.
        Get-AfctInspectionTimeout 0 | Should -Be (Get-AfctDockerCommandTimeout)
        # A nearly-spent budget still gets a second, rather than an instant kill of a call
        # that would have answered.
        Get-AfctInspectionTimeout -5 | Should -Be (Get-AfctDockerCommandTimeout)
    }

    <#
      The real thing, against a daemon that answers nothing. Five services at two bounded
      calls each would be ten full inspection allowances without the cap; with it the whole
      collection is bounded by what was handed in.
    #>
    It 'collects a whole-stack reading inside the remaining budget' {
        Use-DockerShim "@echo off`r`nping -n 120 127.0.0.1 >nul`r`nexit /b 0"
        $env:AFCT_DOCKER_COMMAND_TIMEOUT = '20'
        try {
            $started = Get-Date
            $state = Get-AfctStackState -SkipHttp -TimeoutSeconds 2
            $spent = ((Get-Date) - $started).TotalSeconds
            # Five services, so ten calls. Uncapped that is 200 seconds; capped at two each
            # it is about twenty, and generously under a minute either way.
            $spent | Should -BeLessThan 60
            $state.AllReady | Should -BeFalse
        } finally { Remove-Item Env:\AFCT_DOCKER_COMMAND_TIMEOUT -ErrorAction SilentlyContinue }
    }

    <#
      And nothing expensive happens after the budget is gone. The timeout message used to
      collect the whole stack a second time, purely to phrase itself.
    #>
    It 'does not collect the stack again to write its own timeout message' {
        Mock -CommandName Write-AfctInfo -MockWith { }
        Mock -CommandName Write-AfctSuccess -MockWith { }
        Mock -CommandName Write-AfctWarn -MockWith { }
        Mock -CommandName Write-AfctTrace -MockWith { }
        Mock -CommandName Start-Sleep -MockWith { }
        Mock -CommandName Get-AfctAppContainerState -MockWith { $null }
        Mock -CommandName Get-AfctStackState -MockWith {
            [pscustomobject]@{ Services = @(); AllReady = $false; AppReady = $false; HttpOk = $false
                               ExpectedTag = ''; ImageMatches = $true; OptionalWarnings = @() }
        }
        { Wait-AfctHealth -TimeoutSeconds 0 } | Should -Throw
        # Exactly the one pass, with no extra collection on the way out.
        Should -Invoke Get-AfctStackState -Exactly 1
    }
}

<#
  Every required service has to be on the expected release before startup can succeed.

  AFCT's services are built and published together, so a healthy stack running a new app
  against a release-old worker is two releases sharing a database. Readiness and HTTP alone
  used to be enough to call that a finished deployment.
#>
Describe 'Version agreement is part of a successful startup' {
    BeforeAll {
        # Defined in BeforeAll, not the Describe body: Pester runs a Mock's scriptblock in a
        # scope that cannot see functions declared inline during discovery.
        function New-VersionState {
            param([string]$Stale = '')
            $rows = @()
            foreach ($name in 'app', 'worker', 'nginx', 'db-backup') {
                $tag = 'v1.0.0'
                if ($name -eq $Stale) { $tag = 'v0.9.9' }
                $rows += [pscustomobject]@{
                    Name = $name; Label = $name; Status = 'running'; Health = 'healthy'
                    Image = "img:$tag"; Ready = $true; Required = $true; Versioned = $true
                    ExpectedImageTag = 'v1.0.0'; ActualImageTag = $tag
                    ImageMatches = ($tag -eq 'v1.0.0')
                }
            }
            [pscustomobject]@{
                Services = $rows; AllReady = $true; AppReady = $true; HttpOk = $true
                ExpectedTag = 'v1.0.0'
                ImageMatches = (@($rows | Where-Object { -not $_.ImageMatches }).Count -eq 0)
                OptionalWarnings = @()
            }
        }
    }

    BeforeEach {
        Mock -CommandName Write-AfctInfo -MockWith { }
        Mock -CommandName Write-AfctSuccess -MockWith { }
        Mock -CommandName Write-AfctWarn -MockWith { }
        Mock -CommandName Write-AfctTrace -MockWith { }
        Mock -CommandName Start-Sleep -MockWith { }
        Mock -CommandName Get-AfctAppContainerState -MockWith { 'running|healthy' }
        # HTTP answers throughout, so a pass or fail here is about versions and nothing else.
        Mock -CommandName Test-AfctHttpHealth -MockWith { $true }
    }

    It 'succeeds when every required service is on the expected release' {
        Mock -CommandName Get-AfctStackState -MockWith { New-VersionState }
        { Wait-AfctHealth -TimeoutSeconds 30 } | Should -Not -Throw
    }

    It 'fails, naming the service, when <_> is on an older release' -ForEach @('app', 'worker', 'nginx', 'db-backup') {
        $target = $_
        Mock -CommandName Get-AfctStackState -MockWith { New-VersionState -Stale $target }
        # Named, with both versions, because "something is stale" sends somebody looking
        # through five containers by hand.
        { Wait-AfctHealth -TimeoutSeconds 30 } | Should -Throw "*$target is running on v0.9.9; expected v1.0.0*"
    }

    It 'does not let a responding web service cover for a stale worker' {
        Mock -CommandName Get-AfctStackState -MockWith { New-VersionState -Stale 'worker' }
        { Wait-AfctHealth -TimeoutSeconds 30 } | Should -Throw '*not all on the expected release*'
        Should -Invoke Write-AfctSuccess -Exactly 0 -ParameterFilter { $Message -match 'responding at' }
    }

    <#
      And it fails immediately rather than waiting out the clock. A container does not change
      its image while you watch it, so the answer is not going to improve.
    #>
    It 'fails at once instead of waiting out the timeout' {
        Mock -CommandName Get-AfctStackState -MockWith { New-VersionState -Stale 'nginx' }
        { Wait-AfctHealth -TimeoutSeconds 300 } | Should -Throw
        Should -Invoke Get-AfctStackState -Exactly 1
    }
}

Describe 'Sync-AfctRuntimeCompose reports whether it changed anything' {
    BeforeEach {
        Mock -CommandName Write-AfctInfo -MockWith { }
        $script:ComposeTemplate = Join-Path $Work ('tmpl-' + [Guid]::NewGuid().ToString('N') + '.yml')
        $script:RuntimeCompose  = Join-Path $RuntimeDir 'docker-compose.yml'
        Set-Content -LiteralPath $ComposeTemplate -Value 'services: { app: {} }' -Encoding UTF8
        Remove-Item -LiteralPath $RuntimeCompose -Force -ErrorAction SilentlyContinue
    }

    It 'is true on the first seed' {
        Sync-AfctRuntimeCompose | Should -BeTrue
    }

    It 'is false when the template is byte-identical to what is already there' {
        Sync-AfctRuntimeCompose | Out-Null
        Sync-AfctRuntimeCompose | Should -BeFalse
    }

    It 'is true when the release changed the definition, and keeps the old one' {
        Sync-AfctRuntimeCompose | Out-Null
        Set-Content -LiteralPath $ComposeTemplate -Value 'services: { app: { read_only: true } }' -Encoding UTF8
        Sync-AfctRuntimeCompose | Should -BeTrue
        @(Get-ChildItem -LiteralPath $RuntimeDir -Filter 'docker-compose.yml.bak.*').Count |
            Should -BeGreaterThan 0
    }
}

Describe 'install.log' {
    BeforeEach {
        Remove-Item -LiteralPath $LogFile -Force -ErrorAction SilentlyContinue
        Mock -CommandName Write-Host -MockWith { }
    }

    It 'records console messages with a UTC timestamp and a level' {
        Write-AfctInfo 'starting the AFCT stack'
        Write-AfctWarn 'something is slow'
        $lines = Get-Content -LiteralPath $LogFile
        ($lines -join "`n") | Should -Match 'INFO\s+starting the AFCT stack'
        ($lines -join "`n") | Should -Match 'WARN\s+something is slow'
        $lines[0] | Should -Match '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z '
    }

    It 'does not write a row for blank console spacing' {
        Write-AfctInfo ''
        Test-Path -LiteralPath $LogFile | Should -BeFalse
    }

    <#
      The log travels inside the diagnostics archive, so anything that reaches it reaches
      whoever the archive is sent to. No generated password, database password, session
      secret or encryption key may ever be in it.
    #>
    It 'never receives a secret through the normal output path' {
        $secrets = @{
            POSTGRES_PASSWORD     = 'pg-SUPERSECRET-111111'
            NEXTAUTH_SECRET       = 'na-SUPERSECRET-222222'
            AFCT_SECRET_KEY       = 'sk-SUPERSECRET-333333'
            BACKUP_ENCRYPTION_KEY = 'bk-SUPERSECRET-444444'
            ADMIN_PASSWORD        = 'ap-SUPERSECRET-555555'
        }
        Set-Content -LiteralPath $EnvFile -Value ($secrets.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -Encoding UTF8

        Write-AfctInfo 'Starting AFCT containers...'
        Write-AfctSuccess 'AFCT Dashboard is ready.'
        Write-AfctTrace 'compose up -d completed in 42s'

        $text = Get-Content -LiteralPath $LogFile -Raw
        foreach ($value in $secrets.Values) { $text | Should -Not -Match ([regex]::Escape($value)) }
        $text | Should -Not -Match 'SUPERSECRET'
    }
}

Describe 'Diagnostics redaction' {
    It 'redacts every sensitive key by name, and keeps the rest readable' {
        $src = Join-Path $Work 'redact.env'
        $dst = Join-Path $Work 'redact.out'
        Set-Content -LiteralPath $src -Encoding UTF8 -Value @(
            '# a comment',
            'POSTGRES_PASSWORD=pg-SUPERSECRET-111111',
            'NEXTAUTH_SECRET=na-SUPERSECRET-222222',
            'AFCT_SECRET_KEY=sk-SUPERSECRET-333333',
            'BACKUP_ENCRYPTION_KEY=bk-SUPERSECRET-444444',
            'ADMIN_PASSWORD=ap-SUPERSECRET-555555',
            'DATABASE_URL=postgres://u:pw@db/afct',
            'GITHUB_TOKEN=gh-SUPERSECRET-666666',
            'ADMIN_EMAIL=admin@example.edu',
            'NEXTAUTH_URL=https://afct.example.edu'
        )
        Copy-AfctRedactedEnv $src $dst
        $text = Get-Content -LiteralPath $dst -Raw

        $text | Should -Not -Match 'SUPERSECRET'
        $text | Should -Not -Match 'postgres://'
        # Non-secret settings stay, or the bundle stops being useful.
        $text | Should -Match 'ADMIN_EMAIL=admin@example.edu'
        $text | Should -Match 'NEXTAUTH_URL=https://afct.example.edu'
        $text | Should -Match '# a comment'
    }

    It 'scrubs secret values that were echoed into other collected files' {
        $root = Join-Path $Work ('tree-' + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $root -Force | Out-Null
        $env2 = Join-Path $Work 'tree.env'
        Set-Content -LiteralPath $env2 -Encoding UTF8 -Value @(
            'POSTGRES_PASSWORD=pg-SUPERSECRET-111111',
            'AFCT_SECRET_KEY=sk-SUPERSECRET-333333'
        )
        Set-Content -LiteralPath (Join-Path $root 'compose-logs.txt') -Encoding UTF8 -Value @(
            'app | error: password authentication failed for pg-SUPERSECRET-111111',
            'app | key sk-SUPERSECRET-333333 rejected'
        )
        Hide-AfctSecretsInTree $root $env2
        (Get-Content -LiteralPath (Join-Path $root 'compose-logs.txt') -Raw) | Should -Not -Match 'SUPERSECRET'
    }
}
