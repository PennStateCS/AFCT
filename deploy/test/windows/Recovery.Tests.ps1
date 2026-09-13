<#
Recovery.Tests.ps1 - rerunning the installer, doctor's per-service report, the public
Windows command, and the documentation that describes them.

The installer is rerun far more often than anyone plans for: the first run looked like it
hung, so the tester ran it again. It found the tooling and the configuration already in
place, correctly left both alone, and then replayed the whole startup anyway, because
nothing asked whether the stack was already running. These cover the decision it makes now,
and the rules it must never break while making it.
#>

BeforeAll {
    $script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
    $script:LibDir   = Join-Path $RepoRoot 'deploy\windows\lib'
    foreach ($m in 'Output', 'Platform', 'Docker', 'Validation', 'Environment', 'Config',
                   'Compose', 'Update', 'Deploy', 'Doctor', 'Diagnostics') {
        . (Join-Path $LibDir "$m.ps1")
    }

    $script:Work = Join-Path ([IO.Path]::GetTempPath()) ("afct-recovery-" + [Guid]::NewGuid().ToString('N'))
    # A space in the prefix, because the default one under a profile named "Jane Doe" has one.
    $script:Prefix         = Join-Path $Work 'My AFCT'
    $script:SharedDir      = Join-Path $Prefix 'shared'
    $script:RuntimeDir     = Join-Path $SharedDir 'runtime'
    New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null
    $script:RuntimeCompose = Join-Path $RuntimeDir 'docker-compose.yml'
    Set-Content -LiteralPath $RuntimeCompose -Value 'services: {}' -Encoding UTF8
    $script:EnvFile        = Join-Path $SharedDir '.env.production'
    Set-Content -LiteralPath $EnvFile -Value @('AFCT_APP_TAG=v1.2.3') -Encoding UTF8
    $script:LogFile        = Join-Path $SharedDir 'install.log'
    $script:ComposeTemplate = Join-Path $Work 'template.yml'
    Set-Content -LiteralPath $ComposeTemplate -Value 'services: {}' -Encoding UTF8
    $script:AppService     = 'app'
    $script:HealthPath     = '/api/health'
    $script:HealthTimeout  = 30
    $script:HealthInterval = 1
    $script:InstallerVersion = 'test'

    # A stack state with every service ready, which individual tests then spoil.
    function New-StackState {
        param([bool]$AllReady = $true, [bool]$HttpOk = $true, [bool]$ImageMatches = $true)
        [pscustomobject]@{
            Services = @(
                [pscustomobject]@{ Name = 'postgres'; Label = 'PostgreSQL'; Status = 'running'; Health = 'healthy'; Image = 'p:v1.2.3'; Ready = $true },
                [pscustomobject]@{ Name = 'app'; Label = 'AFCT application'; Status = 'running'; Health = 'healthy'; Image = 'a:v1.2.3'; Ready = $AllReady },
                [pscustomobject]@{ Name = 'worker'; Label = 'Worker'; Status = 'running'; Health = 'none'; Image = 'a:v1.2.3'; Ready = $true },
                [pscustomobject]@{ Name = 'nginx'; Label = 'nginx'; Status = 'running'; Health = 'healthy'; Image = 'n:v1.2.3'; Ready = $AllReady },
                [pscustomobject]@{ Name = 'db-backup'; Label = 'Backup service'; Status = 'running'; Health = 'healthy'; Image = 'b:v1.2.3'; Ready = $true }
            )
            AllReady = $AllReady; AppReady = $AllReady; HttpOk = $HttpOk
            ExpectedTag = 'v1.2.3'; ImageMatches = $ImageMatches
        }
    }
}

AfterAll { Remove-Item -LiteralPath $Work -Recurse -Force -ErrorAction SilentlyContinue }

Describe 'Rerunning the installer' {
    BeforeEach {
        Mock -CommandName Write-AfctInfo -MockWith { }
        Mock -CommandName Write-AfctSuccess -MockWith { }
        Mock -CommandName Write-AfctWarn -MockWith { }
        Mock -CommandName Write-AfctTrace -MockWith { }
        Mock -CommandName Invoke-AfctDeployStack -MockWith { }
    }

    <#
      The case that prompted this: an interrupted install whose containers all came up.
      Replaying a startup that may itself be the thing that hung is both pointless and
      risky, so a deployment that is already the one being asked for is verified and left
      alone.
    #>
    It 'skips the startup when the stack is already healthy at the expected version' {
        Mock -CommandName Get-AfctStackState -MockWith { New-StackState }
        Invoke-AfctEnsureDeployed
        Should -Invoke Invoke-AfctDeployStack -Exactly 0
        Should -Invoke Write-AfctSuccess -ParameterFilter { $Message -match 'already running' }
    }

    It 'starts the stack when only PostgreSQL came up' {
        Mock -CommandName Get-AfctStackState -MockWith { New-StackState -AllReady $false }
        Invoke-AfctEnsureDeployed
        Should -Invoke Invoke-AfctDeployStack -Exactly 1
    }

    It 'starts the stack when the containers run but the web service does not answer' {
        Mock -CommandName Get-AfctStackState -MockWith { New-StackState -HttpOk $false }
        Invoke-AfctEnsureDeployed
        Should -Invoke Invoke-AfctDeployStack -Exactly 1
    }

    It 'starts the stack when the running application is the wrong version' {
        Mock -CommandName Get-AfctStackState -MockWith { New-StackState -ImageMatches $false }
        Invoke-AfctEnsureDeployed
        Should -Invoke Invoke-AfctDeployStack -Exactly 1
    }

    <#
      The safety rules, asserted rather than assumed. A recovery path that reached for
      `down -v`, removed a volume, or rewrote the configuration would destroy the database
      of somebody whose only mistake was running the installer twice.
    #>
    It 'never stops, removes, or rewrites anything while deciding' {
        Mock -CommandName Get-AfctStackState -MockWith { New-StackState }
        Mock -CommandName Write-AfctEnvironmentFile -MockWith { }
        Mock -CommandName Backup-AfctEnvFile -MockWith { }
        Mock -CommandName Invoke-AfctComposeBounded -MockWith {
            @{ ExitCode = 0; TimedOut = $false; StdOut = @(); StdErr = @(); Seconds = 0 }
        }
        $before = Get-Content -LiteralPath $EnvFile -Raw

        Invoke-AfctEnsureDeployed

        # No compose command ran at all, so none of them can have been a destructive one,
        # and the configuration is byte-for-byte what it was.
        Should -Invoke Invoke-AfctComposeBounded -Exactly 0
        Should -Invoke Write-AfctEnvironmentFile -Exactly 0
        Should -Invoke Backup-AfctEnvFile -Exactly 0
        (Get-Content -LiteralPath $EnvFile -Raw) | Should -Be $before
    }
}

Describe 'Diagnostics after a startup failure' {
    BeforeEach {
        Mock -CommandName Write-AfctInfo -MockWith { }
        Mock -CommandName Write-AfctSuccess -MockWith { }
        Mock -CommandName Write-AfctWarn -MockWith { }
        Mock -CommandName Write-AfctError -MockWith { }
        Mock -CommandName Write-AfctTrace -MockWith { }
    }

    It 'collects a bundle when the stack does not start' {
        Mock -CommandName Invoke-AfctEnsureDeployed -MockWith { throw 'afct-fatal: AFCT did not finish starting within 300 seconds.' }
        Mock -CommandName Invoke-AfctDiagnostics -MockWith { 'C:\afct\bundle.zip' }

        { Invoke-AfctDeployWithDiagnostics } | Should -Throw
        Should -Invoke Invoke-AfctDiagnostics -Exactly 1 -ParameterFilter { $Reason -eq 'startup-failure' }
    }

    <#
      Diagnostics are the extra, not the point. A failure while collecting them must not
      become the error the operator sees instead of the reason the install failed.
    #>
    It 'keeps the original failure when collecting diagnostics also fails' {
        Mock -CommandName Invoke-AfctEnsureDeployed -MockWith { throw 'afct-fatal: the application container reported an unhealthy state.' }
        Mock -CommandName Invoke-AfctDiagnostics -MockWith { throw 'the archive could not be written' }

        { Invoke-AfctDeployWithDiagnostics } | Should -Throw '*unhealthy state*'
        Should -Invoke Write-AfctWarn -ParameterFilter { $Message -match 'diagnostics could not be collected' }
    }

    It 'reports the failure once, before the diagnostics run' {
        Mock -CommandName Invoke-AfctEnsureDeployed -MockWith { throw 'afct-fatal: nginx never started.' }
        Mock -CommandName Invoke-AfctDiagnostics -MockWith { 'C:\afct\bundle.zip' }

        { Invoke-AfctDeployWithDiagnostics } | Should -Throw '*afct-reported*'
        Should -Invoke Write-AfctError -Exactly 1 -ParameterFilter { $Message -eq 'nginx never started.' }
    }

    It 'collects what it can when Docker itself is unavailable' {
        Mock -CommandName Test-AfctDockerReady -MockWith { $false }
        Mock -CommandName Protect-AfctFileBestEffort -MockWith { }
        $archive = Invoke-AfctDiagnostics 'startup-failure'
        Test-Path -LiteralPath $archive | Should -BeTrue
        Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
    }
}

Describe 'Doctor' {
    BeforeEach {
        Mock -CommandName Write-AfctInfo -MockWith { }
        Mock -CommandName Write-AfctSuccess -MockWith { }
        Mock -CommandName Write-AfctWarn -MockWith { }
        Mock -CommandName Write-AfctTrace -MockWith { }
        Mock -CommandName Test-AfctDockerReady -MockWith { $true }
        Mock -CommandName Test-AfctClockSync -MockWith { $true }
        Mock -CommandName Test-AfctEnvFileComplete -MockWith { $true }
        Mock -CommandName Get-AfctDockerFreeBytes -MockWith { 100GB }
        Mock -CommandName Test-AfctHttpHealth -MockWith { $true }
        Mock -CommandName Invoke-AfctCompose -MockWith { $global:LASTEXITCODE = 0; @() }
    }

    It 'passes and names every service when the stack is healthy' {
        Mock -CommandName Get-AfctStackState -MockWith { New-StackState }
        Invoke-AfctDoctor | Should -BeTrue
        foreach ($label in 'PostgreSQL is healthy', 'AFCT application is healthy',
                           'Worker is running', 'nginx is healthy', 'Backup service is healthy') {
            Should -Invoke Write-AfctSuccess -ParameterFilter { $Message -eq $label }
        }
    }

    <#
      The report that was missing after the interrupted install: which service did not come
      up. Reporting only the application said nothing about nginx at all.
    #>
    It 'names the service that is not ready' {
        Mock -CommandName Get-AfctStackState -MockWith {
            $s = New-StackState
            $nginx = $s.Services | Where-Object { $_.Name -eq 'nginx' }
            $nginx.Status = 'missing'; $nginx.Health = 'none'; $nginx.Ready = $false
            $s.AllReady = $false
            $s
        }
        Invoke-AfctDoctor | Should -BeFalse
        Should -Invoke Write-AfctWarn -ParameterFilter { $Message -eq 'nginx is not running' }
    }

    It 'warns when the running application is not the pinned version' {
        Mock -CommandName Get-AfctStackState -MockWith { New-StackState -ImageMatches $false }
        Invoke-AfctDoctor | Should -BeFalse
        Should -Invoke Write-AfctWarn -ParameterFilter { $Message -match 'not the pinned version' }
    }

    <#
      Doctor is what an operator runs when the deployment is already broken. If it changed
      anything, it would destroy the evidence it exists to gather.
    #>
    It 'changes nothing' {
        Mock -CommandName Get-AfctStackState -MockWith { New-StackState }
        Mock -CommandName Start-AfctStack -MockWith { }
        Mock -CommandName Invoke-AfctComposeBounded -MockWith { @{ ExitCode = 0; TimedOut = $false; StdOut = @(); StdErr = @(); Seconds = 0 } }

        Invoke-AfctDoctor | Out-Null

        # Nothing that could start, stop or recreate a container was called. The only
        # compose calls doctor makes are `config` and `ps`, which are reads.
        Should -Invoke Start-AfctStack -Exactly 0
        Should -Invoke Invoke-AfctComposeBounded -Exactly 0
    }

    It 'reports Docker being unreachable instead of failing' {
        Mock -CommandName Test-AfctDockerReady -MockWith { $false }
        Invoke-AfctDoctor | Should -BeFalse
        Should -Invoke Write-AfctWarn -ParameterFilter { $Message -match 'Docker Desktop is unavailable' }
    }
}

<#
The public Windows command.

Windows blocks PowerShell scripts by default, so the tester who followed the documentation
and ran the .ps1 directly was told "running scripts is disabled on this system". The .cmd
wrapper is the supported entry point precisely because it works on a stock machine with no
security settings changed, and the documentation has to say so.
#>
Describe 'The afctctl command wrapper' {
    BeforeAll {
        $script:Bootstrap   = Join-Path $RepoRoot 'deploy\windows\install.ps1'
        $script:BuildBundle = Join-Path $RepoRoot 'deploy\windows\build-bundle.ps1'
        $dist = Join-Path $Work 'dist'
        New-Item -ItemType Directory -Path $dist -Force | Out-Null
        $script:Bundle = (& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $BuildBundle -OutDir $dist).Trim()
        # Installed under a path with a space, which is where argument handling breaks.
        $script:WrapperPrefix = Join-Path $Work 'Program Files AFCT'
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Bootstrap `
            -BundleFile $Bundle -Prefix $WrapperPrefix -SwitchOnly | Out-Null
        $script:Cmd = Join-Path $WrapperPrefix 'bin\afctctl.cmd'
    }

    It 'bypasses the execution policy so a default Windows machine can run it' {
        $text = Get-Content -LiteralPath $Cmd -Raw
        $text | Should -Match '-ExecutionPolicy\s+Bypass'
        $text | Should -Match '-NoProfile'
        # %~dp0 keeps it working from any directory: there is nothing to cd into.
        $text | Should -Match '%~dp0afctctl\.ps1'
        $text | Should -Match '%\*'
    }

    It 'runs from an unrelated working directory' {
        Push-Location ([IO.Path]::GetTempPath())
        try {
            $out = & $Cmd version 2>&1 | Out-String
            $out | Should -Match 'deployment tool version'
        } finally { Pop-Location }
    }

    <#
      Argument forwarding, through the .cmd, through the launcher, into the controller.
      The controller's dispatch recorder writes down exactly what it was handed and exits
      before touching Docker, so this proves the handoff without a daemon.
    #>
    It 'forwards every argument in order, including ones containing spaces' {
        $record = Join-Path $Work 'dispatch.txt'
        $env:AFCT_TEST_RECORD_DISPATCH = $record
        try {
            & $Cmd install 'a value with spaces' 'second' | Out-Null
            $lines = Get-Content -LiteralPath $record
            ($lines | Where-Object { $_ -eq 'command=install' }) | Should -Not -BeNullOrEmpty
            ($lines | Where-Object { $_ -eq 'arg=a value with spaces' }) | Should -Not -BeNullOrEmpty
            ($lines | Where-Object { $_ -eq 'arg=second' }) | Should -Not -BeNullOrEmpty
            # Order is preserved, not just membership.
            $forwarded = @($lines | Where-Object { $_ -like 'arg=*' })
            $forwarded[0] | Should -Be 'arg=a value with spaces'
            $forwarded[1] | Should -Be 'arg=second'
        } finally { Remove-Item Env:\AFCT_TEST_RECORD_DISPATCH -ErrorAction SilentlyContinue }
    }

    It 'resolves the install prefix correctly from a path containing a space' {
        $record = Join-Path $Work 'dispatch2.txt'
        $env:AFCT_TEST_RECORD_DISPATCH = $record
        try {
            & $Cmd status | Out-Null
            $lines = Get-Content -LiteralPath $record
            ($lines | Where-Object { $_ -eq "prefix=$WrapperPrefix" }) | Should -Not -BeNullOrEmpty
        } finally { Remove-Item Env:\AFCT_TEST_RECORD_DISPATCH -ErrorAction SilentlyContinue }
    }
}

<#
The documentation is part of the failure. It told the tester to run the .ps1, which is the
one invocation a stock Windows machine refuses.
#>
Describe 'Windows documentation' {
    BeforeAll {
        $script:Doc = Join-Path $RepoRoot 'docs-site\docs\setup\production\windows.md'
        $script:DocText = Get-Content -LiteralPath $Doc -Raw
    }

    It 'never tells the reader to run the stable .ps1 wrapper' {
        $DocText | Should -Not -Match 'bin\\\\afctctl\.ps1"?\s+\w'
    }

    It 'uses afctctl.cmd for the full-path example' {
        $DocText | Should -Match 'afctctl\.cmd"\s+status'
    }

    It 'never asks the reader to run Set-ExecutionPolicy' {
        # Only as an instruction. Saying "you do not need to run Set-ExecutionPolicy" is
        # the point of the section, so the name appearing in prose is fine; the name
        # appearing on a command line is not.
        foreach ($line in (Get-Content -LiteralPath $Doc)) {
            if ($line -match '^\s*(PS[^>]*>)?\s*Set-ExecutionPolicy') {
                throw "documentation instructs the reader to run: $line"
            }
        }
        $DocText | Should -Not -Match '(?i)run as administrator to use afctctl'
    }

    It 'says the command works from any directory' {
        $DocText | Should -Match '(?i)works from any directory'
    }

    It 'never tells the reader to cd into an AFCT directory' {
        $DocText | Should -Not -Match '(?m)^\s*cd\s+AFCT\s*$'
    }

    It 'explains that Docker Desktop shows AFCT as a group of containers' {
        $DocText | Should -Match '(?i)several containers'
    }

    It 'points a slow startup at doctor and diagnostics' {
        $DocText | Should -Match '(?i)afctctl doctor'
        $DocText | Should -Match '(?i)afctctl diagnostics'
    }
}
