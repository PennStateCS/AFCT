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
    $script:UpdaterService   = 'updater'
    $script:InstallerBaseUrl = 'https://example.invalid'

    # A stack state with every service ready at the expected release, which individual
    # tests then spoil one dimension at a time. Mirrors the real shape exactly, including
    # the per-service version fields, because Set-StrictMode makes a missing property a
    # thrown error rather than a null.
    function New-ServiceRow {
        param([string]$Name, [string]$Label, [bool]$RequiresHealth, [bool]$Versioned,
              [string]$Status = 'running', [string]$Tag = 'v1.2.3', [string]$Want = 'v1.2.3')
        $health = 'healthy'
        if (-not $RequiresHealth) { $health = 'none' }
        if ($Status -eq 'missing') { $health = 'none'; $Tag = '' }
        $ready = ($Status -eq 'running') -and (($health -eq 'healthy') -or (-not $RequiresHealth))
        $matches = (-not $Versioned) -or ($Status -eq 'missing') -or (-not $Tag) -or ($Tag -ceq $Want)
        $expected = ''
        if ($Versioned) { $expected = $Want }
        [pscustomobject]@{
            Name = $Name; Label = $Label; Status = $Status; Health = $health
            Image = "img:$Tag"; Ready = $ready; Versioned = $Versioned
            ExpectedImageTag = $expected; ActualImageTag = $Tag; ImageMatches = $matches
        }
    }

    function New-StackState {
        param(
            [bool]$HttpOk = $true,
            # Name a service to knock out, and/or a service to leave on an older release.
            [string]$Missing = '',
            [string]$StaleService = '',
            [string]$StaleTag = 'v0.9.9',
            [bool]$WithUpdater = $false
        )
        $want = 'v1.2.3'
        $spec = @(
            @{ Name = 'postgres';  Label = 'PostgreSQL';       Health = $true;  Ver = $false },
            @{ Name = 'app';       Label = 'AFCT application'; Health = $true;  Ver = $true },
            @{ Name = 'worker';    Label = 'Worker';           Health = $false; Ver = $true },
            @{ Name = 'nginx';     Label = 'nginx';            Health = $true;  Ver = $true },
            @{ Name = 'db-backup'; Label = 'Backup service';   Health = $true;  Ver = $true }
        )
        if ($WithUpdater) {
            $spec += @{ Name = 'updater'; Label = 'In-app updater'; Health = $true; Ver = $true }
        }
        $rows = @()
        foreach ($item in $spec) {
            $status = 'running'
            if ($item.Name -eq $Missing) { $status = 'missing' }
            $tag = $want
            if ($item.Name -eq $StaleService) { $tag = $StaleTag }
            $rows += New-ServiceRow -Name $item.Name -Label $item.Label `
                -RequiresHealth $item.Health -Versioned $item.Ver `
                -Status $status -Tag $tag -Want $want
        }
        $app = $rows | Where-Object { $_.Name -eq 'app' } | Select-Object -First 1
        [pscustomobject]@{
            Services     = $rows
            AllReady     = (@($rows | Where-Object { -not $_.Ready }).Count -eq 0)
            AppReady     = $app.Ready
            HttpOk       = $HttpOk
            ExpectedTag  = $want
            ImageMatches = (@($rows | Where-Object { $_.Versioned -and -not $_.ImageMatches }).Count -eq 0)
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
        Mock -CommandName Get-AfctStackState -MockWith { New-StackState -Missing 'app' }
        Invoke-AfctEnsureDeployed
        Should -Invoke Invoke-AfctDeployStack -Exactly 1
    }

    It 'starts the stack when the containers run but the web service does not answer' {
        Mock -CommandName Get-AfctStackState -MockWith { New-StackState -HttpOk $false }
        Invoke-AfctEnsureDeployed
        Should -Invoke Invoke-AfctDeployStack -Exactly 1
    }

    It 'starts the stack when the running application is the wrong version' {
        Mock -CommandName Get-AfctStackState -MockWith { New-StackState -StaleService 'app' }
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

<#
  A changed Compose definition always gets one reconciliation pass.

  The rerun optimisation is only safe while the definition on disk is the one the containers
  are running. A new deployment-tool release can change mounts, environment, health checks,
  security options, resource limits, networking or the container command, and the healthy
  containers would keep running the old one indefinitely.
#>
Describe 'Reconciling after the Compose definition changes' {
    BeforeEach {
        Mock -CommandName Write-AfctInfo -MockWith { }
        Mock -CommandName Write-AfctSuccess -MockWith { }
        Mock -CommandName Write-AfctWarn -MockWith { }
        Mock -CommandName Write-AfctTrace -MockWith { }
        Mock -CommandName Invoke-AfctDeployStack -MockWith { }
        Mock -CommandName Invoke-AfctComposeBounded -MockWith {
            @{ ExitCode = 0; TimedOut = $false; StdOut = @(); StdErr = @(); Seconds = 0 }
        }
        Mock -CommandName Write-AfctEnvironmentFile -MockWith { }
    }

    It 'reconciles a healthy stack when the definition changed' {
        Mock -CommandName Get-AfctStackState -MockWith { New-StackState }
        Mock -CommandName Test-AfctDeploymentReady -MockWith { $true }

        Invoke-AfctEnsureDeployed -ForceReconcile $true

        Should -Invoke Invoke-AfctDeployStack -Exactly 1
        # And it does not even ask: the answer would not change what it does.
        Should -Invoke Test-AfctDeploymentReady -Exactly 0
    }

    It 'leaves a healthy stack alone when the definition did not change' {
        Mock -CommandName Get-AfctStackState -MockWith { New-StackState }
        Invoke-AfctEnsureDeployed -ForceReconcile $false
        Should -Invoke Invoke-AfctDeployStack -Exactly 0
    }

    It 'reconciles a partial stack the same way it always would' {
        Mock -CommandName Get-AfctStackState -MockWith { New-StackState -Missing 'nginx' }
        Invoke-AfctEnsureDeployed -ForceReconcile $true
        Should -Invoke Invoke-AfctDeployStack -Exactly 1
    }

    <#
      Reconciling is `up --detach` and nothing else. Compose recreates only the services
      whose definition actually changed; nothing is stopped first, nothing is removed, and
      no volume is touched. A reconciliation that took the database with it would be far
      worse than a stale container.
    #>
    It 'reconciles without any destructive command, and without rewriting configuration' {
        Mock -CommandName Get-AfctStackState -MockWith { New-StackState }
        Mock -CommandName Backup-AfctEnvFile -MockWith { }
        $before = Get-Content -LiteralPath $EnvFile -Raw

        Invoke-AfctEnsureDeployed -ForceReconcile $true

        # Deployment goes through the one shared path, which the startup tests already prove
        # issues only `up --detach`.
        Should -Invoke Invoke-AfctDeployStack -Exactly 1
        Should -Invoke Invoke-AfctComposeBounded -Exactly 0
        Should -Invoke Write-AfctEnvironmentFile -Exactly 0
        Should -Invoke Backup-AfctEnvFile -Exactly 0
        (Get-Content -LiteralPath $EnvFile -Raw) | Should -Be $before
    }
}

<#
  The optional updater.

  It is off by default. When it is on, its container is part of the deployment, and a
  deployment whose env file says enabled while the container is gone was previously read as
  complete: the enable path declined because the flag already said true, and nothing else
  looked.
#>
Describe 'The in-app updater when it is enabled' {
    AfterEach {
        Set-Content -LiteralPath $EnvFile -Value @('AFCT_APP_TAG=v1.2.3') -Encoding UTF8
    }

    It 'is not expected at all while it is disabled' {
        Set-Content -LiteralPath $EnvFile -Value @('AFCT_APP_TAG=v1.2.3') -Encoding UTF8
        @(Get-AfctExpectedServices).Name | Should -Not -Contain 'updater'
    }

    It 'joins the expected services once it is enabled' {
        Set-Content -LiteralPath $EnvFile -Encoding UTF8 -Value @(
            'AFCT_APP_TAG=v1.2.3', 'AFCT_UPDATER_ENABLED=true')
        $svc = @(Get-AfctExpectedServices) | Where-Object { $_.Name -eq 'updater' }
        $svc | Should -Not -BeNullOrEmpty
        # Published under the same release tag as everything else.
        $svc.Versioned | Should -BeTrue
    }

    It 'reports a deployment as incomplete when the enabled updater is missing' {
        Mock -CommandName Get-AfctStackState -MockWith { New-StackState -WithUpdater $true -Missing 'updater' }
        Mock -CommandName Write-AfctInfo -MockWith { }
        Mock -CommandName Write-AfctTrace -MockWith { }
        Test-AfctDeploymentReady | Should -BeFalse
    }

    It 'reports a deployment as complete when the enabled updater is running' {
        Mock -CommandName Get-AfctStackState -MockWith { New-StackState -WithUpdater $true }
        Mock -CommandName Write-AfctInfo -MockWith { }
        Mock -CommandName Write-AfctTrace -MockWith { }
        Test-AfctDeploymentReady | Should -BeTrue
    }

    It 'restarts an enabled updater whose container has gone' {
        Set-Content -LiteralPath $EnvFile -Encoding UTF8 -Value @(
            'AFCT_APP_TAG=v1.2.3', 'AFCT_UPDATER_ENABLED=true')
        Mock -CommandName Write-AfctInfo -MockWith { }
        Mock -CommandName Write-AfctSuccess -MockWith { }
        Mock -CommandName Write-AfctWarn -MockWith { }
        Mock -CommandName Get-AfctServiceState -MockWith { 'missing|none|' }
        Mock -CommandName Start-AfctUpdater -MockWith { $true }

        Invoke-AfctMaybeEnableUpdater -WithUpdater $false -NonInteractive $true

        Should -Invoke Start-AfctUpdater -Exactly 1
    }

    <#
      Optional means optional. AFCT is already up by the time this runs, so a sidecar that
      will not start is worth saying out loud and nothing more.
    #>
    It 'does not fail the install when the updater will not start' {
        Set-Content -LiteralPath $EnvFile -Encoding UTF8 -Value @(
            'AFCT_APP_TAG=v1.2.3', 'AFCT_UPDATER_ENABLED=true')
        Mock -CommandName Write-AfctInfo -MockWith { }
        Mock -CommandName Write-AfctSuccess -MockWith { }
        Mock -CommandName Write-AfctWarn -MockWith { }
        Mock -CommandName Get-AfctServiceState -MockWith { 'missing|none|' }
        Mock -CommandName Start-AfctUpdater -MockWith { $false }

        { Invoke-AfctMaybeEnableUpdater -WithUpdater $false -NonInteractive $true } | Should -Not -Throw
        Should -Invoke Write-AfctWarn -ParameterFilter { $Message -match 'could not be started' }
    }

    It 'leaves a running updater alone' {
        Set-Content -LiteralPath $EnvFile -Encoding UTF8 -Value @(
            'AFCT_APP_TAG=v1.2.3', 'AFCT_UPDATER_ENABLED=true')
        Mock -CommandName Write-AfctWarn -MockWith { }
        Mock -CommandName Get-AfctServiceState -MockWith { 'running|healthy|img:v1.2.3' }
        Mock -CommandName Start-AfctUpdater -MockWith { $true }

        Invoke-AfctMaybeEnableUpdater -WithUpdater $false -NonInteractive $true

        Should -Invoke Start-AfctUpdater -Exactly 0
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
        foreach ($label in 'PostgreSQL is healthy', 'AFCT application is healthy (v1.2.3)',
                           'Worker is running (v1.2.3)', 'nginx is healthy (v1.2.3)',
                           'Backup service is healthy (v1.2.3)') {
            Should -Invoke Write-AfctSuccess -ParameterFilter { $Message -eq $label }
        }
    }

    <#
      The report that was missing after the interrupted install: which service did not come
      up. Reporting only the application said nothing about nginx at all.
    #>
    It 'names the service that is not ready' {
        Mock -CommandName Get-AfctStackState -MockWith { New-StackState -Missing 'nginx' }
        Invoke-AfctDoctor | Should -BeFalse
        Should -Invoke Write-AfctWarn -ParameterFilter { $Message -eq 'nginx is not running' }
    }

    <#
      Naming the service and both versions is the point. "Something is on the wrong
      release" sends an operator looking through five containers by hand.
    #>
    It 'names the stale service and both versions' {
        Mock -CommandName Get-AfctStackState -MockWith { New-StackState -StaleService 'worker' }
        Invoke-AfctDoctor | Should -BeFalse
        Should -Invoke Write-AfctWarn -ParameterFilter {
            $Message -eq 'Worker is running but is on v0.9.9; expected v1.2.3'
        }
        # The services that ARE correct still report their version, so the contrast is
        # visible without running anything else.
        Should -Invoke Write-AfctSuccess -ParameterFilter { $Message -eq 'AFCT application is healthy (v1.2.3)' }
        # PostgreSQL is pinned by digest on its own schedule and carries no release suffix.
        Should -Invoke Write-AfctSuccess -ParameterFilter { $Message -eq 'PostgreSQL is healthy' }
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
