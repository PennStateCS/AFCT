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
    foreach ($m in 'Output', 'Docker', 'Validation', 'Environment', 'Config', 'Compose', 'Diagnostics', 'Doctor') {
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
                               ExpectedTag = 'v1.0.0'; ImageMatches = $true }
        }
        { Start-AfctStack -TimeoutSeconds 30 } | Should -Not -Throw
    }

    It 'fails when the CLI was stopped and the stack did not come up' {
        Mock -CommandName Invoke-AfctComposeBounded -MockWith {
            @{ ExitCode = $null; TimedOut = $true; StdOut = @(); StdErr = @(); Seconds = 30 }
        }
        Mock -CommandName Get-AfctStackState -MockWith {
            [pscustomobject]@{ Services = @(); AllReady = $false; AppReady = $false; HttpOk = $false
                               ExpectedTag = 'v1.0.0'; ImageMatches = $true }
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
                               ExpectedTag = 'v1.0.0'; ImageMatches = $false }
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
        @($script:composeCalls) | Should -Be @('up --detach')
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
    }

    It 'is ready when every service is where it should be' {
        Mock -CommandName Get-AfctServiceState -MockWith {
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

    It 'reports a version mismatch even when everything is running' {
        Mock -CommandName Get-AfctServiceState -MockWith {
            if ($Service -eq 'worker') { return 'running|none|img:v0.9.0' }
            return 'running|healthy|img:v0.9.0'
        }
        $s = Get-AfctStackState
        $s.AllReady | Should -BeTrue
        $s.ImageMatches | Should -BeFalse
    }

    It 'skips the HTTP probe when asked to' {
        Mock -CommandName Get-AfctServiceState -MockWith { 'running|healthy|img:v1.2.3' }
        Get-AfctStackState -SkipHttp | Out-Null
        Should -Invoke Test-AfctHttpHealth -Exactly 0
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
                               ExpectedTag = ''; ImageMatches = $true }
        }
        Mock -CommandName Get-AfctAppContainerState -MockWith { 'running|healthy' }
        { Wait-AfctHealth -TimeoutSeconds 30 } | Should -Not -Throw
    }

    It 'names an unhealthy application as the reason' {
        Mock -CommandName Get-AfctStackState -MockWith {
            [pscustomobject]@{ Services = @(); AllReady = $false; AppReady = $false; HttpOk = $false
                               ExpectedTag = ''; ImageMatches = $true }
        }
        Mock -CommandName Get-AfctAppContainerState -MockWith { 'running|unhealthy' }
        { Wait-AfctHealth -TimeoutSeconds 30 } | Should -Throw '*unhealthy state*'
    }

    It 'fails fast on a crash loop instead of waiting out the timeout' {
        Mock -CommandName Get-AfctStackState -MockWith {
            [pscustomobject]@{ Services = @(); AllReady = $false; AppReady = $false; HttpOk = $false
                               ExpectedTag = ''; ImageMatches = $true }
        }
        Mock -CommandName Get-AfctAppContainerState -MockWith { 'restarting|none' }
        { Wait-AfctHealth -TimeoutSeconds 300 } | Should -Throw '*crash loop*'
        Should -Invoke Get-AfctAppContainerState -Exactly 3
    }

    It 'reports an application that stopped before becoming healthy' {
        Mock -CommandName Get-AfctStackState -MockWith {
            [pscustomobject]@{ Services = @(); AllReady = $false; AppReady = $false; HttpOk = $false
                               ExpectedTag = ''; ImageMatches = $true }
        }
        Mock -CommandName Get-AfctAppContainerState -MockWith { 'exited|none' }
        { Wait-AfctHealth -TimeoutSeconds 30 } | Should -Throw '*stopped before becoming healthy*'
    }

    It 'times out with the state it last saw, rather than silently' {
        Mock -CommandName Get-AfctStackState -MockWith {
            [pscustomobject]@{
                Services = @([pscustomobject]@{ Name = 'nginx'; Label = 'nginx'; Status = 'missing'
                                                Health = 'none'; Image = ''; Ready = $false })
                AllReady = $false; AppReady = $false; HttpOk = $false
                ExpectedTag = ''; ImageMatches = $true }
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
                                       Health = 'healthy'; Image = 'p'; Ready = $true },
                    [pscustomobject]@{ Name = 'app'; Label = 'AFCT application'
                                       Status = 'running'
                                       Health = $(if ($ready) { 'healthy' } else { 'starting' })
                                       Image = 'a'; Ready = $ready }
                )
                AllReady = $ready; AppReady = $ready; HttpOk = $ready
                ExpectedTag = ''; ImageMatches = $true }
        }
        Mock -CommandName Get-AfctAppContainerState -MockWith { 'running|healthy' }

        Wait-AfctHealth -TimeoutSeconds 30

        Should -Invoke Write-AfctInfo -ParameterFilter { $Message -eq 'AFCT application is starting...' }
        Should -Invoke Write-AfctSuccess -ParameterFilter { $Message -eq 'PostgreSQL is healthy.' }
        Should -Invoke Write-AfctSuccess -ParameterFilter { $Message -eq 'AFCT application is healthy.' }
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
