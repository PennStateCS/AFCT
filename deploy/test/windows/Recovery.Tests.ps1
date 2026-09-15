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
              [bool]$Required = $true,
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
            Image = "img:$Tag"; Ready = $ready; Versioned = $Versioned; Required = $Required
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
            @{ Name = 'postgres';  Label = 'PostgreSQL';       Health = $true;  Ver = $false; Req = $true },
            @{ Name = 'app';       Label = 'AFCT application'; Health = $true;  Ver = $true;  Req = $true },
            @{ Name = 'worker';    Label = 'Worker';           Health = $false; Ver = $true;  Req = $true },
            @{ Name = 'nginx';     Label = 'nginx';            Health = $true;  Ver = $true;  Req = $true },
            @{ Name = 'db-backup'; Label = 'Backup service';   Health = $true;  Ver = $true;  Req = $true }
        )
        if ($WithUpdater) {
            $spec += @{ Name = 'updater'; Label = 'In-app updater'; Health = $true; Ver = $true; Req = $false }
        }
        $rows = @()
        foreach ($item in $spec) {
            $status = 'running'
            if ($item.Name -eq $Missing) { $status = 'missing' }
            $tag = $want
            if ($item.Name -eq $StaleService) { $tag = $StaleTag }
            $rows += New-ServiceRow -Name $item.Name -Label $item.Label `
                -RequiresHealth $item.Health -Versioned $item.Ver -Required $item.Req `
                -Status $status -Tag $tag -Want $want
        }
        $app = $rows | Where-Object { $_.Name -eq 'app' } | Select-Object -First 1
        [pscustomobject]@{
            Services     = $rows
            AllReady     = (@($rows | Where-Object { $_.Required -and -not $_.Ready }).Count -eq 0)
            AppReady     = $app.Ready
            HttpOk       = $HttpOk
            ExpectedTag  = $want
            ImageMatches = (@($rows | Where-Object { $_.Required -and $_.Versioned -and -not $_.ImageMatches }).Count -eq 0)
            OptionalWarnings = @($rows | Where-Object { -not $_.Required -and -not $_.Ready } |
                                 ForEach-Object { "$($_.Label) is not running" })
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
<#
  Configuration can change without the Compose YAML changing.

  Reconciling only on a changed Compose file left two holes. `afctctl install -Reconfigure`
  writes a new .env.production and, if the Compose file happened not to change and the
  containers looked healthy, skipped `up` entirely: the operator's new settings sat on disk
  while the containers kept running the old ones, with nothing on screen to say so. And the
  key-repair helpers can add AFCT_SECRET_KEY or BACKUP_ENCRYPTION_KEY to a file the running
  containers were started without.
#>
Describe 'Configuration changes force reconciliation' {
    BeforeEach {
        Mock -CommandName Write-AfctInfo -MockWith { }
        Mock -CommandName Write-AfctSuccess -MockWith { }
        Mock -CommandName Write-AfctWarn -MockWith { }
        Set-Content -LiteralPath $EnvFile -Encoding UTF8 -Value @('AFCT_APP_TAG=v1.2.3')
    }

    It 'reports that it added a missing secret key, and stays quiet when one exists' {
        Confirm-AfctSecretKey $EnvFile | Should -BeTrue
        # Called twice is not changed twice: the existing key is left exactly as it was.
        $after = Read-AfctEnvValue 'AFCT_SECRET_KEY' $EnvFile
        Confirm-AfctSecretKey $EnvFile | Should -BeFalse
        Read-AfctEnvValue 'AFCT_SECRET_KEY' $EnvFile | Should -Be $after
    }

    It 'reports that it added a missing backup key, and stays quiet when one exists' {
        Confirm-AfctBackupKey $EnvFile | Should -BeTrue
        $after = Read-AfctEnvValue 'BACKUP_ENCRYPTION_KEY' $EnvFile
        Confirm-AfctBackupKey $EnvFile | Should -BeFalse
        Read-AfctEnvValue 'BACKUP_ENCRYPTION_KEY' $EnvFile | Should -Be $after
    }

    It 'never regenerates a key that is already there' {
        Set-Content -LiteralPath $EnvFile -Encoding UTF8 -Value @(
            'AFCT_APP_TAG=v1.2.3',
            'AFCT_SECRET_KEY=existing-secret-value-0001',
            'BACKUP_ENCRYPTION_KEY=existing-backup-value-0002')
        Confirm-AfctSecretKey $EnvFile | Should -BeFalse
        Confirm-AfctBackupKey $EnvFile | Should -BeFalse
        Read-AfctEnvValue 'AFCT_SECRET_KEY' $EnvFile | Should -Be 'existing-secret-value-0001'
        Read-AfctEnvValue 'BACKUP_ENCRYPTION_KEY' $EnvFile | Should -Be 'existing-backup-value-0002'
    }

    It 'does not reconcile when nothing about the configuration changed' {
        # The whole point of the rerun optimisation, and it has to survive the new triggers.
        Set-Content -LiteralPath $EnvFile -Encoding UTF8 -Value @(
            'AFCT_APP_TAG=v1.2.3',
            'AFCT_SECRET_KEY=existing-secret-value-0001',
            'BACKUP_ENCRYPTION_KEY=existing-backup-value-0002')
        $secret = [bool](Confirm-AfctSecretKey $EnvFile)
        $backup = [bool](Confirm-AfctBackupKey $EnvFile)
        ($false -or $secret -or $backup) | Should -BeFalse
    }
}

<#
  Existing data plus missing configuration means recovery, not a fresh install.

  Generating new database credentials against an existing PostgreSQL volume orphans every
  record in it. The check exists to stop that, and it used to ask `docker compose config
  --volumes` for the volume names, which needs a valid environment file: with the file
  missing, the call failed, the function returned false, and the guard went quiet in exactly
  the situation it was written for.
#>
Describe 'Existing data volumes without configuration' {
    BeforeEach {
        Mock -CommandName Test-AfctDockerReady -MockWith { $true }
        Mock -CommandName Test-AfctEnvFileComplete -MockWith { $false }
        Set-Content -LiteralPath $RuntimeCompose -Encoding UTF8 -Value @(
            'services:',
            '  app:',
            '    image: x',
            'volumes:',
            '  postgres_data:',
            '  uploads_data:')
    }
    AfterEach {
        Set-Content -LiteralPath $EnvFile -Encoding UTF8 -Value @('AFCT_APP_TAG=v1.2.3')
        Set-Content -LiteralPath $RuntimeCompose -Value 'services: {}' -Encoding UTF8
    }

    It 'reads the volume names without needing a valid environment file' {
        Remove-Item -LiteralPath $EnvFile -Force -ErrorAction SilentlyContinue
        @(Get-AfctDeclaredVolumes) | Should -Be @('postgres_data', 'uploads_data')
    }

    It 'requires recovery when the env file is gone and the database volume exists' {
        Remove-Item -LiteralPath $EnvFile -Force -ErrorAction SilentlyContinue
        Mock -CommandName Invoke-AfctDockerBounded -MockWith {
            @{ ExitCode = 0; TimedOut = $false; StdOut = @('afct_postgres_data', 'other'); StdErr = @(); Seconds = 0 }
        }
        Test-AfctDataWithoutConfig | Should -BeTrue
    }

    It 'requires recovery when the env file is incomplete and the volumes exist' {
        Mock -CommandName Invoke-AfctDockerBounded -MockWith {
            @{ ExitCode = 0; TimedOut = $false; StdOut = @('afct_uploads_data'); StdErr = @(); Seconds = 0 }
        }
        Test-AfctDataWithoutConfig | Should -BeTrue
    }

    It 'allows a fresh install when no AFCT volumes exist' {
        Remove-Item -LiteralPath $EnvFile -Force -ErrorAction SilentlyContinue
        Mock -CommandName Invoke-AfctDockerBounded -MockWith {
            @{ ExitCode = 0; TimedOut = $false; StdOut = @(); StdErr = @(); Seconds = 0 }
        }
        Test-AfctDataWithoutConfig | Should -BeFalse
    }

    It 'ignores volumes belonging to another Compose project' {
        # Compose names volumes "<project>_<volume>". An AFCT install left behind under a
        # different project name is a harmless leftover and must not block this one.
        Remove-Item -LiteralPath $EnvFile -Force -ErrorAction SilentlyContinue
        Mock -CommandName Invoke-AfctDockerBounded -MockWith {
            @{ ExitCode = 0; TimedOut = $false; StdOut = @('afct-old_postgres_data', 'someproj_postgres_data')
               StdErr = @(); Seconds = 0 }
        }
        Test-AfctDataWithoutConfig | Should -BeFalse
    }

    It 'ignores unrelated Docker volumes entirely' {
        Remove-Item -LiteralPath $EnvFile -Force -ErrorAction SilentlyContinue
        Mock -CommandName Invoke-AfctDockerBounded -MockWith {
            @{ ExitCode = 0; TimedOut = $false; StdOut = @('postgres_data', 'my_project_data', 'jenkins_home')
               StdErr = @(); Seconds = 0 }
        }
        Test-AfctDataWithoutConfig | Should -BeFalse
    }

    <#
      Fails closed. A false answer here is permission to generate fresh database credentials,
      and against an existing volume that orphans every record in it, so "I could not find
      out" must not take the same branch as "I looked and there is nothing". It stops with
      something the operator can act on instead.
    #>
    It 'refuses to continue when the volume listing times out' {
        Remove-Item -LiteralPath $EnvFile -Force -ErrorAction SilentlyContinue
        Mock -CommandName Invoke-AfctDockerBounded -MockWith {
            @{ ExitCode = $null; TimedOut = $true; StdOut = @(); StdErr = @(); Seconds = 20 }
        }
        { Test-AfctDataWithoutConfig } | Should -Throw '*could not verify whether existing data volumes*'
        # And says so: nothing was written, which is the reassurance somebody needs before
        # they run it again.
        { Test-AfctDataWithoutConfig } | Should -Throw '*No new credentials were generated*'
    }

    It 'refuses to continue when the volume listing fails outright' {
        Remove-Item -LiteralPath $EnvFile -Force -ErrorAction SilentlyContinue
        Mock -CommandName Invoke-AfctDockerBounded -MockWith {
            @{ ExitCode = 1; TimedOut = $false; StdOut = @(); StdErr = @('cannot connect'); Seconds = 0 }
        }
        { Test-AfctDataWithoutConfig } | Should -Throw '*could not verify whether existing data volumes*'
    }

    <#
      An unreachable daemon must not read as "there is no data". It used to: a bounded
      `docker info` that missed its deadline returned $false here, which is permission to
      generate fresh database credentials against whatever volumes are actually there. The
      question was never answered, so the only safe answer is to stop.
    #>
    It 'refuses to continue when Docker itself is unavailable' {
        Remove-Item -LiteralPath $EnvFile -Force -ErrorAction SilentlyContinue
        Mock -CommandName Test-AfctDockerReady -MockWith { $false }
        Mock -CommandName Invoke-AfctDockerBounded -MockWith {
            @{ ExitCode = $null; TimedOut = $true; StdOut = @(); StdErr = @(); Seconds = 20 }
        }
        { Test-AfctDataWithoutConfig } | Should -Throw '*could not verify whether existing data volumes*'
    }
}

Describe 'The in-app updater when it is enabled' {
    AfterEach {
        Set-Content -LiteralPath $EnvFile -Value @('AFCT_APP_TAG=v1.2.3') -Encoding UTF8
    }

    It 'is not expected at all while it is disabled' {
        Set-Content -LiteralPath $EnvFile -Value @('AFCT_APP_TAG=v1.2.3') -Encoding UTF8
        @(Get-AfctExpectedServices).Name | Should -Not -Contain 'updater'
    }

    It 'joins the expected services once it is enabled, but never as a required one' {
        Set-Content -LiteralPath $EnvFile -Encoding UTF8 -Value @(
            'AFCT_APP_TAG=v1.2.3', 'AFCT_UPDATER_ENABLED=true')
        $svc = @(Get-AfctExpectedServices) | Where-Object { $_.Name -eq 'updater' }
        $svc | Should -Not -BeNullOrEmpty
        # Published under the same release tag as everything else...
        $svc.Versioned | Should -BeTrue
        # ...and optional, which is what keeps it out of the readiness verdict.
        $svc.Required | Should -BeFalse
        # Everything else is required, or an install could pass with no database.
        foreach ($core in @(Get-AfctExpectedServices | Where-Object { $_.Name -ne 'updater' })) {
            $core.Required | Should -BeTrue
        }
    }

    <#
      Driven through the real observer rather than a fixture, because the fixture has its own
      idea of which services are required and would happily agree with a wrong table.
    #>
    It 'leaves the real stack state ready when only the updater is missing' {
        Set-Content -LiteralPath $EnvFile -Encoding UTF8 -Value @(
            'AFCT_APP_TAG=v1.2.3', 'AFCT_UPDATER_ENABLED=true')
        Mock -CommandName Get-AfctServiceState -MockWith {
            if ($Service -eq 'updater') { return 'missing|none|' }
            if ($Service -eq 'postgres') { return 'running|healthy|postgres:15-alpine@sha256:abc' }
            if ($Service -eq 'worker') { return 'running|none|img:v1.2.3' }
            return 'running|healthy|img:v1.2.3'
        }
        Mock -CommandName Test-AfctHttpHealth -MockWith { $true }

        $state = Get-AfctStackState
        $state.AllReady | Should -BeTrue
        @($state.OptionalWarnings).Count | Should -Be 1
        @($state.OptionalWarnings)[0] | Should -Match 'In-app updater is not running'
    }

    It 'leaves the real stack state ready when the updater is merely stale' {
        Set-Content -LiteralPath $EnvFile -Encoding UTF8 -Value @(
            'AFCT_APP_TAG=v1.2.3', 'AFCT_UPDATER_ENABLED=true')
        Mock -CommandName Get-AfctServiceState -MockWith {
            if ($Service -eq 'updater') { return 'running|healthy|img:v0.9.9' }
            if ($Service -eq 'postgres') { return 'running|healthy|postgres:15-alpine@sha256:abc' }
            if ($Service -eq 'worker') { return 'running|none|img:v1.2.3' }
            return 'running|healthy|img:v1.2.3'
        }
        Mock -CommandName Test-AfctHttpHealth -MockWith { $true }

        $state = Get-AfctStackState
        $state.AllReady | Should -BeTrue
        # The required services all agree, so the deployment is on the expected release even
        # though the optional sidecar is behind.
        $state.ImageMatches | Should -BeTrue
        @($state.OptionalWarnings)[0] | Should -Match 'In-app updater is on v0.9.9'
    }

    It 'still fails the real stack state when a required service is missing too' {
        Set-Content -LiteralPath $EnvFile -Encoding UTF8 -Value @(
            'AFCT_APP_TAG=v1.2.3', 'AFCT_UPDATER_ENABLED=true')
        Mock -CommandName Get-AfctServiceState -MockWith {
            if ($Service -in 'updater', 'nginx') { return 'missing|none|' }
            if ($Service -eq 'postgres') { return 'running|healthy|postgres:15-alpine@sha256:abc' }
            if ($Service -eq 'worker') { return 'running|none|img:v1.2.3' }
            return 'running|healthy|img:v1.2.3'
        }
        Mock -CommandName Test-AfctHttpHealth -MockWith { $true }
        (Get-AfctStackState).AllReady | Should -BeFalse
    }

    It 'pulls the optional updater image separately from the required ones' {
        # With the updater enabled, every compose call carries --profile updater, so a plain
        # `pull` included the updater image and an unavailable one failed the whole download
        # before the base installation could start.
        Set-Content -LiteralPath $EnvFile -Encoding UTF8 -Value @(
            'AFCT_APP_TAG=v1.2.3', 'AFCT_UPDATER_ENABLED=true')
        Mock -CommandName Write-AfctInfo -MockWith { }
        Mock -CommandName Write-AfctSuccess -MockWith { }
        Mock -CommandName Write-AfctWarn -MockWith { }
        $script:pulls = New-Object System.Collections.ArrayList
        Mock -CommandName Invoke-AfctComposeBounded -MockWith {
            $line = (@($ComposeArgs) -join ' ')
            $null = $script:pulls.Add($line)
            # The optional pull fails; the required one does not.
            if ($line -match 'updater') {
                return @{ ExitCode = 1; TimedOut = $false; StdOut = @(); StdErr = @('manifest unknown'); Seconds = 1 }
            }
            @{ ExitCode = 0; TimedOut = $false; StdOut = @(); StdErr = @(); Seconds = 1 }
        }

        { Get-AfctImages } | Should -Not -Throw
        Should -Invoke Write-AfctWarn -ParameterFilter { $Message -match 'optional updater image' }
        # The required services were pulled by name, without the updater among them.
        @($script:pulls)[0] | Should -Not -Match 'updater'
        @($script:pulls)[0] | Should -Match 'postgres'
    }

    <#
      Optional means the base deployment still counts as ready. The updater is experimental
      on Windows and nonfatal everywhere else in the code; letting it into the readiness
      verdict would fail the install of a working AFCT site over a feature nobody had to
      turn on. It is reported instead, and repaired below.
    #>
    It 'still reports the deployment ready when only the optional updater is missing' {
        Mock -CommandName Get-AfctStackState -MockWith { New-StackState -WithUpdater $true -Missing 'updater' }
        Mock -CommandName Write-AfctInfo -MockWith { }
        Mock -CommandName Write-AfctTrace -MockWith { }
        Test-AfctDeploymentReady | Should -BeTrue
    }

    It 'carries the missing updater as a warning rather than a failure' {
        $s = New-StackState -WithUpdater $true -Missing 'updater'
        $s.AllReady | Should -BeTrue
        @($s.OptionalWarnings).Count | Should -Be 1
        @($s.OptionalWarnings)[0] | Should -Match 'In-app updater'
    }

    It 'still fails the deployment when a required service is missing alongside it' {
        # An optional problem must not become cover for a real one.
        $s = New-StackState -WithUpdater $true -Missing 'nginx'
        $s.AllReady | Should -BeFalse
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

        # Nothing that could start, stop or recreate a container was called. Doctor does
        # run bounded compose calls, but only `config` and `ps`, which are reads.
        Should -Invoke Start-AfctStack -Exactly 0
        Should -Not -Invoke Invoke-AfctComposeBounded -ParameterFilter {
            (@($ComposeArgs) -join ' ') -match '^(up|down|stop|restart|rm|pull)'
        }
    }

    It 'reports Docker being unreachable instead of failing' {
        Mock -CommandName Test-AfctDockerReady -MockWith { $false }
        Invoke-AfctDoctor | Should -BeFalse
        Should -Invoke Write-AfctWarn -ParameterFilter { $Message -match 'Docker Desktop is unavailable' }
    }
}

<#
  An update that leaves the stack half-upgraded must not be recorded as a success.

  Save-AfctDeployedAppTag writes the deployed release back into .env.production, and that
  pin is what a later plain `afctctl update` redeploys. Recording it for a stack whose worker
  is still a release behind would make the wrong version the one AFCT considers current, and
  the operator would have been told the update completed.
#>
Describe 'An update with a stale service' {
    BeforeEach {
        Mock -CommandName Write-AfctInfo -MockWith { }
        Mock -CommandName Write-AfctSuccess -MockWith { }
        Mock -CommandName Write-AfctWarn -MockWith { }
        Mock -CommandName Write-AfctError -MockWith { }
        Mock -CommandName Write-AfctTrace -MockWith { }
        Mock -CommandName Assert-AfctStack -MockWith { }
        Mock -CommandName Confirm-AfctSecretKey -MockWith { $false }
        Mock -CommandName Confirm-AfctBackupKey -MockWith { $false }
        Mock -CommandName Test-AfctComposeConfig -MockWith { }
        Mock -CommandName Assert-AfctUpdateDiskSpace -MockWith { }
        Mock -CommandName Save-AfctRunningImages -MockWith { }
        Mock -CommandName Get-AfctImages -MockWith { }
        Mock -CommandName Save-AfctDeployedAppTag -MockWith { }
        Mock -CommandName Remove-AfctSupersededImages -MockWith { }
        # Rollback declines, so the failure path ends at the final throw rather than at the
        # `exit 1` a successful rollback takes, which would end the Pester run itself.
        Mock -CommandName Restore-AfctPreviousImages -MockWith { $false }
        Mock -CommandName Restore-AfctPreviousRelease -MockWith { $false }
        Mock -CommandName Invoke-AfctDiagnostics -MockWith { 'C:\afct\bundle.zip' }
    }

    It 'records the pin and reports success when the upgrade is complete' {
        Mock -CommandName Invoke-AfctStartAndWait -MockWith { }
        Invoke-AfctUpdate | Out-Null
        Should -Invoke Save-AfctDeployedAppTag -Exactly 1
        Should -Invoke Write-AfctSuccess -ParameterFilter { $Message -eq 'AFCT update completed.' }
    }

    It 'records nothing and claims nothing when a service is left behind' {
        Mock -CommandName Invoke-AfctStartAndWait -MockWith {
            throw 'afct-fatal: the running containers are not all on the expected release. Worker is running on v0.9.9; expected v1.0.0.'
        }
        try { Invoke-AfctUpdate | Out-Null } catch { }
        Should -Invoke Save-AfctDeployedAppTag -Exactly 0
        Should -Invoke Write-AfctSuccess -Exactly 0 -ParameterFilter { $Message -eq 'AFCT update completed.' }
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
