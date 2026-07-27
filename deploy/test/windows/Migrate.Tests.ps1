<#
Migrate.Tests.ps1 - Pester tests for legacy flat-install import (Import-AfctLegacyInstall).
Docker volume detection is mocked. The controller globals the function reads ($Prefix,
$SharedDir, $EnvFile, $RuntimeCompose) are set in each test and seen via dynamic scope, the
same pattern the runtime-Compose seeding test uses.
#>

BeforeAll {
    $script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
    $script:LibDir   = Join-Path $RepoRoot 'deploy\windows\lib'
    foreach ($m in 'Output', 'Validation', 'Environment', 'Docker', 'Migrate') { . (Join-Path $LibDir "$m.ps1") }
    $script:Work = Join-Path ([IO.Path]::GetTempPath()) ("afct-mig-" + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $Work -Force | Out-Null

    function New-LegacyDir {
        param([hashtable]$Opts = @{})
        $name = if ($Opts.ContainsKey('Name')) { $Opts.Name } else { 'afct' }
        $dir = Join-Path $Work ((New-Guid).ToString('N').Substring(0, 8) + '\' + $name)
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        $env = @('NODE_ENV=production', 'POSTGRES_PASSWORD=keep-pg', 'DATABASE_URL=postgresql://afct_user:keep-pg@postgres:5432/afct',
                 'NEXTAUTH_SECRET=keep-ns', 'NEXTAUTH_URL=https://afct.example.edu', 'AFCT_APP_TAG=v0.1.27', 'AFCT_UPDATER_ENABLED=true')
        if ($Opts.ContainsKey('ExtraEnv')) { $env += $Opts.ExtraEnv }
        if (-not $Opts.ContainsKey('OmitEnv')) {
            if ($Opts.ContainsKey('Incomplete')) { $env = @('NODE_ENV=production', 'POSTGRES_PASSWORD=x') }
            Set-Content -LiteralPath (Join-Path $dir '.env.production') -Value $env -Encoding ASCII
        }
        if (-not $Opts.ContainsKey('OmitCompose')) { Set-Content -LiteralPath (Join-Path $dir 'docker-compose.yml') -Value "services:`n  app: {}" }
        Set-Content -LiteralPath (Join-Path $dir 'install.ps1') -Value '# legacy'
        if ($Opts.ContainsKey('Backups')) {
            Set-Content -LiteralPath (Join-Path $dir '.env.production.backup.20260101-000000') -Value 'NEXTAUTH_URL=https://old'
            Set-Content -LiteralPath (Join-Path $dir '.env.production.backup.20260102-000000') -Value 'NEXTAUTH_URL=https://older'
        }
        if ($Opts.ContainsKey('State')) { Set-Content -LiteralPath (Join-Path $dir 'deploy.state') -Value "PROJECT_NAME=$($Opts.State)" -Encoding ASCII }
        return $dir
    }

    function New-Dest {
        $p = Join-Path $Work ('dest-' + (New-Guid).ToString('N').Substring(0, 8))
        New-Item -ItemType Directory -Path (Join-Path $p 'shared\runtime') -Force | Out-Null
        $script:Prefix = $p
        $script:SharedDir = Join-Path $p 'shared'
        $script:EnvFile = Join-Path $p 'shared\.env.production'
        $script:RuntimeCompose = Join-Path $p 'shared\runtime\docker-compose.yml'
        return $p
    }

    function Get-TreeManifest {
        param([string]$Dir)
        Get-ChildItem -LiteralPath $Dir -Recurse -File | Sort-Object FullName |
            ForEach-Object { "$($_.FullName.Substring($Dir.Length))=$((Get-FileHash $_.FullName).Hash)" }
    }
    # No live import artifacts landed in the destination shared directory.
    function Test-NoLiveImport {
        (-not (Test-Path -LiteralPath $EnvFile)) -and
        (-not (Test-Path -LiteralPath (Join-Path $SharedDir 'deploy.state'))) -and
        (@(Get-ChildItem -LiteralPath $SharedDir -Filter '.env.production.backup.*' -File -ErrorAction SilentlyContinue).Count -eq 0)
    }
    # No staging directory left behind.
    function Test-NoStaging {
        @(Get-ChildItem -LiteralPath $SharedDir -Directory -Filter '.import-*' -ErrorAction SilentlyContinue).Count -eq 0
    }
    # A Move-Item mock that really moves (via .NET, so it bypasses the mock) except for one
    # destination, which throws. Update $script:MoveFailTarget to stop injecting the failure.
    function New-FailingMoveAt {
        param([string]$FailDestination)
        $script:MoveFailTarget = $FailDestination
        Mock -CommandName Move-Item -MockWith {
            if ($Destination -eq $script:MoveFailTarget) { throw 'simulated publication failure' }
            [System.IO.File]::Move($LiteralPath, $Destination)
        }
    }
}

AfterAll { Remove-Item -LiteralPath $Work -Recurse -Force -ErrorAction SilentlyContinue }

Describe 'Import-AfctLegacyInstall' {
    BeforeEach {
        Mock -CommandName Write-AfctInfo -MockWith { }
        Mock -CommandName Write-AfctWarn -MockWith { }
        Mock -CommandName Get-AfctDockerVolumeNames -MockWith { @() }
    }

    It 'imports a valid legacy installation and preserves secrets and the release pin' {
        $legacy = New-LegacyDir; New-Dest | Out-Null
        Import-AfctLegacyInstall -LegacyDir $legacy
        Test-Path $EnvFile | Should -BeTrue
        Test-AfctEnvFileComplete $EnvFile | Should -BeTrue
        Read-AfctEnvValue 'POSTGRES_PASSWORD' $EnvFile | Should -Be 'keep-pg'
        Read-AfctEnvValue 'DATABASE_URL' $EnvFile | Should -Be 'postgresql://afct_user:keep-pg@postgres:5432/afct'
        Read-AfctEnvValue 'NEXTAUTH_SECRET' $EnvFile | Should -Be 'keep-ns'
        Read-AfctEnvValue 'AFCT_APP_TAG' $EnvFile | Should -Be 'v0.1.27'
        Read-AfctEnvValue 'AFCT_UPDATER_ENABLED' $EnvFile | Should -Be 'true'
    }

    It 'copies the .env.production bytes exactly' {
        $legacy = New-LegacyDir; New-Dest | Out-Null
        Import-AfctLegacyInstall -LegacyDir $legacy
        (Get-FileHash $EnvFile).Hash | Should -Be (Get-FileHash (Join-Path $legacy '.env.production')).Hash
    }

    It 'fails when .env.production is missing' {
        $legacy = New-LegacyDir @{ OmitEnv = $true }; New-Dest | Out-Null
        { Import-AfctLegacyInstall -LegacyDir $legacy } | Should -Throw -ExpectedMessage '*does not look like*'
    }

    It 'fails when the configuration is incomplete' {
        $legacy = New-LegacyDir @{ Incomplete = $true }; New-Dest | Out-Null
        { Import-AfctLegacyInstall -LegacyDir $legacy } | Should -Throw -ExpectedMessage '*incomplete*'
    }

    It 'carries over configuration backups' {
        $legacy = New-LegacyDir @{ Backups = $true }; New-Dest | Out-Null
        Import-AfctLegacyInstall -LegacyDir $legacy
        @(Get-ChildItem -LiteralPath $SharedDir -Filter '.env.production.backup.*').Count | Should -Be 2
    }

    It 'preserves the Compose project from COMPOSE_PROJECT_NAME' {
        $legacy = New-LegacyDir @{ ExtraEnv = @('COMPOSE_PROJECT_NAME=myproj') }; New-Dest | Out-Null
        Import-AfctLegacyInstall -LegacyDir $legacy
        (Get-Content (Join-Path $SharedDir 'deploy.state') | Select-String '^PROJECT_NAME=').Line | Should -Be 'PROJECT_NAME=myproj'
    }

    It 'derives the Compose project from the directory name when none is set' {
        $legacy = New-LegacyDir @{ Name = 'AFCT-Prod' }; New-Dest | Out-Null
        Import-AfctLegacyInstall -LegacyDir $legacy
        (Get-Content (Join-Path $SharedDir 'deploy.state')) | Should -Contain 'PROJECT_NAME=afct-prod'
    }

    It 'stops on an ambiguous project (env vs deploy.state disagree)' {
        $legacy = New-LegacyDir @{ ExtraEnv = @('COMPOSE_PROJECT_NAME=fromenv'); State = 'fromstate' }; New-Dest | Out-Null
        { Import-AfctLegacyInstall -LegacyDir $legacy } | Should -Throw -ExpectedMessage '*ambiguous*'
    }

    It 'detects existing Docker volumes for the project' {
        $legacy = New-LegacyDir @{ ExtraEnv = @('COMPOSE_PROJECT_NAME=myproj') }; New-Dest | Out-Null
        Mock -CommandName Get-AfctDockerVolumeNames -MockWith { @('myproj_postgres_data', 'other_vol') }
        Import-AfctLegacyInstall -LegacyDir $legacy
        Should -Invoke Write-AfctInfo -ParameterFilter { $Message -match 'existing Docker volume' }
    }

    It 'leaves the legacy directory completely unchanged' {
        $legacy = New-LegacyDir @{ Backups = $true; State = 'afct' }; New-Dest | Out-Null
        $before = Get-TreeManifest $legacy
        Import-AfctLegacyInstall -LegacyDir $legacy
        (Get-TreeManifest $legacy) | Should -Be $before
    }

    It 'prints preservation and rollback guidance' {
        $legacy = New-LegacyDir; New-Dest | Out-Null
        Import-AfctLegacyInstall -LegacyDir $legacy
        Should -Invoke Write-AfctInfo -ParameterFilter { $Message -match 'was NOT modified' }
        Should -Invoke Write-AfctInfo -ParameterFilter { $Message -match 'archive or remove' }
    }

    It 'handles a source path containing spaces' {
        $legacy = New-LegacyDir @{ Name = 'AFCT Deploy' }; New-Dest | Out-Null
        Import-AfctLegacyInstall -LegacyDir $legacy
        Test-AfctEnvFileComplete $EnvFile | Should -BeTrue
    }

    It 'refuses when the source equals the destination install root' {
        New-Dest | Out-Null
        { Import-AfctLegacyInstall -LegacyDir $Prefix } | Should -Throw -ExpectedMessage '*same as the new installation*'
    }

    It 'refuses to overwrite an already-configured installation' {
        $legacy = New-LegacyDir; New-Dest | Out-Null
        Set-Content -LiteralPath $EnvFile -Value 'NEXTAUTH_URL=https://existing'
        { Import-AfctLegacyInstall -LegacyDir $legacy } | Should -Throw -ExpectedMessage '*already exists*'
    }
}

Describe 'Import-AfctLegacyInstall (transactional)' {
    BeforeEach {
        Mock -CommandName Write-AfctInfo -MockWith { }
        Mock -CommandName Write-AfctWarn -MockWith { }
        Mock -CommandName Write-AfctError -MockWith { }
        Mock -CommandName Get-AfctDockerVolumeNames -MockWith { @() }
    }

    # --- success paths -----------------------------------------------------------
    It 'stages then publishes, and removes the staging directory on success' {
        $legacy = New-LegacyDir @{ Backups = $true }; New-Dest | Out-Null
        Import-AfctLegacyInstall -LegacyDir $legacy
        Test-Path -LiteralPath $EnvFile | Should -BeTrue
        Test-Path -LiteralPath (Join-Path $SharedDir 'deploy.state') | Should -BeTrue
        Test-NoStaging | Should -BeTrue
    }
    It 'publishes with no backup files' {
        $legacy = New-LegacyDir; New-Dest | Out-Null
        Import-AfctLegacyInstall -LegacyDir $legacy
        @(Get-ChildItem -LiteralPath $SharedDir -Filter '.env.production.backup.*').Count | Should -Be 0
        Test-AfctEnvFileComplete $EnvFile | Should -BeTrue
        Test-NoStaging | Should -BeTrue
    }
    It 'publishes multiple backup files' {
        $legacy = New-LegacyDir @{ Backups = $true }; New-Dest | Out-Null
        Import-AfctLegacyInstall -LegacyDir $legacy
        @(Get-ChildItem -LiteralPath $SharedDir -Filter '.env.production.backup.*').Count | Should -Be 2
    }
    It 'works through the full real flow with spaces in source and destination' {
        $legacy = New-LegacyDir @{ Name = 'AFCT Deploy'; Backups = $true }
        $p = Join-Path $Work 'Dest Root\AFCT'
        New-Item -ItemType Directory -Path (Join-Path $p 'shared\runtime') -Force | Out-Null
        $script:Prefix = $p; $script:SharedDir = Join-Path $p 'shared'
        $script:EnvFile = Join-Path $p 'shared\.env.production'; $script:RuntimeCompose = Join-Path $p 'shared\runtime\docker-compose.yml'
        Import-AfctLegacyInstall -LegacyDir $legacy
        Test-AfctEnvFileComplete $EnvFile | Should -BeTrue
        Test-NoStaging | Should -BeTrue
    }

    # --- staging failures (nothing published) ------------------------------------
    It 'rolls back a staged environment copy failure with no live files' {
        $legacy = New-LegacyDir; New-Dest | Out-Null
        Mock -CommandName Copy-Item -MockWith { throw 'disk full' } -ParameterFilter { $Destination -like '*\.env.production' }
        { Import-AfctLegacyInstall -LegacyDir $legacy } | Should -Throw -ExpectedMessage '*before publication*'
        Test-NoLiveImport | Should -BeTrue
        Test-NoStaging | Should -BeTrue
    }
    It 'rolls back a staged environment ACL failure' {
        $legacy = New-LegacyDir; New-Dest | Out-Null
        Mock -CommandName Protect-AfctCriticalFile -MockWith { throw 'afct-fatal: could not restrict permissions' } -ParameterFilter { $Path -like '*\.import-*\.env.production' }
        { Import-AfctLegacyInstall -LegacyDir $legacy } | Should -Throw
        Test-NoLiveImport | Should -BeTrue
        Test-NoStaging | Should -BeTrue
    }
    It 'rolls back a staged backup copy failure' {
        $legacy = New-LegacyDir @{ Backups = $true }; New-Dest | Out-Null
        Mock -CommandName Copy-Item -MockWith { throw 'disk full' } -ParameterFilter { $Destination -like '*.env.production.backup.*' }
        { Import-AfctLegacyInstall -LegacyDir $legacy } | Should -Throw -ExpectedMessage '*before publication*'
        Test-NoLiveImport | Should -BeTrue
        Test-NoStaging | Should -BeTrue
    }
    It 'rolls back a staged backup ACL failure' {
        $legacy = New-LegacyDir @{ Backups = $true }; New-Dest | Out-Null
        Mock -CommandName Protect-AfctCriticalFile -MockWith { throw 'afct-fatal: could not restrict permissions' } -ParameterFilter { $Path -like '*.env.production.backup.*' }
        { Import-AfctLegacyInstall -LegacyDir $legacy } | Should -Throw
        Test-NoLiveImport | Should -BeTrue
        Test-NoStaging | Should -BeTrue
    }
    It 'rolls back a deploy.state write failure' {
        $legacy = New-LegacyDir; New-Dest | Out-Null
        Mock -CommandName Set-Content -MockWith { throw 'disk full' } -ParameterFilter { "$Value" -like 'PROJECT_NAME=*' }
        { Import-AfctLegacyInstall -LegacyDir $legacy } | Should -Throw -ExpectedMessage '*before publication*'
        Test-NoLiveImport | Should -BeTrue
        Test-NoStaging | Should -BeTrue
    }
    It 'rolls back a deploy.state ACL failure' {
        $legacy = New-LegacyDir; New-Dest | Out-Null
        Mock -CommandName Protect-AfctCriticalFile -MockWith { throw 'afct-fatal: could not restrict permissions' } -ParameterFilter { $Path -like '*\deploy.state' }
        { Import-AfctLegacyInstall -LegacyDir $legacy } | Should -Throw
        Test-NoLiveImport | Should -BeTrue
        Test-NoStaging | Should -BeTrue
    }
    It 'rolls back when the staged environment fails revalidation' {
        $legacy = New-LegacyDir; New-Dest | Out-Null
        Mock -CommandName Test-AfctEnvFileComplete -MockWith { $true }   # legacy pre-check stays complete
        Mock -CommandName Test-AfctEnvFileComplete -MockWith { $false } -ParameterFilter { $File -like '*\.import-*' }
        { Import-AfctLegacyInstall -LegacyDir $legacy } | Should -Throw -ExpectedMessage '*failed validation*'
        Test-NoLiveImport | Should -BeTrue
        Test-NoStaging | Should -BeTrue
    }

    # --- publication failures (rollback of published files) ----------------------
    It 'rolls back cleanly when the first publication move fails' {
        $legacy = New-LegacyDir; New-Dest | Out-Null
        New-FailingMoveAt (Join-Path $SharedDir 'deploy.state')   # first in the plan when no backups
        { Import-AfctLegacyInstall -LegacyDir $legacy } | Should -Throw -ExpectedMessage '*rolled back*'
        Test-NoLiveImport | Should -BeTrue
        Test-NoStaging | Should -BeTrue
    }
    It 'rolls back files created when a later publication move fails' {
        $legacy = New-LegacyDir @{ Backups = $true }; New-Dest | Out-Null
        New-FailingMoveAt $EnvFile   # env is published last, after backups + deploy.state
        { Import-AfctLegacyInstall -LegacyDir $legacy } | Should -Throw -ExpectedMessage '*rolled back*'
        Test-NoLiveImport | Should -BeTrue   # the already-moved backups + deploy.state were removed
        Test-NoStaging | Should -BeTrue
    }
    It 'leaves preexisting destination files untouched after a rollback' {
        $legacy = New-LegacyDir @{ Backups = $true }; New-Dest | Out-Null
        $unrelated = Join-Path $SharedDir 'install.log'
        Set-Content -LiteralPath $unrelated -Value 'prior log line'
        New-FailingMoveAt $EnvFile
        { Import-AfctLegacyInstall -LegacyDir $legacy } | Should -Throw
        Test-Path -LiteralPath $unrelated | Should -BeTrue
        (Get-Content -LiteralPath $unrelated) | Should -Be 'prior log line'
        Test-Path -LiteralPath (Join-Path $SharedDir 'runtime') | Should -BeTrue
    }
    It 'retry succeeds after a rolled-back import' {
        $legacy = New-LegacyDir @{ Backups = $true }; New-Dest | Out-Null
        New-FailingMoveAt $EnvFile
        { Import-AfctLegacyInstall -LegacyDir $legacy } | Should -Throw
        Test-NoLiveImport | Should -BeTrue
        # Stop injecting the failure; the mock now moves everything for real.
        $script:MoveFailTarget = 'no-such-target'
        Import-AfctLegacyInstall -LegacyDir $legacy
        Test-AfctEnvFileComplete $EnvFile | Should -BeTrue
        Test-NoStaging | Should -BeTrue
    }
    It 'reports the exact remaining paths when rollback cleanup fails' {
        $legacy = New-LegacyDir @{ Backups = $true }; New-Dest | Out-Null
        New-FailingMoveAt $EnvFile
        $script:RemoveFailTarget = Join-Path $SharedDir 'deploy.state'
        # Full replacement mock: throw for the stuck path, do real .NET deletes otherwise.
        Mock -CommandName Remove-Item -MockWith {
            if ($LiteralPath -eq $script:RemoveFailTarget) { throw 'file is locked' }
            if (Test-Path -LiteralPath $LiteralPath -PathType Container) { [System.IO.Directory]::Delete($LiteralPath, $true) }
            elseif (Test-Path -LiteralPath $LiteralPath) { [System.IO.File]::Delete($LiteralPath) }
        }
        { Import-AfctLegacyInstall -LegacyDir $legacy } | Should -Throw -ExpectedMessage '*could not be fully rolled back*'
        Should -Invoke Write-AfctError -ParameterFilter { $Message -match 'deploy\.state' }
    }

    # --- source integrity + stale staging ---------------------------------------
    It 'leaves the legacy source unchanged after a failed publication' {
        $legacy = New-LegacyDir @{ Backups = $true; State = 'afct' }; New-Dest | Out-Null
        $before = Get-TreeManifest $legacy
        New-FailingMoveAt $EnvFile
        { Import-AfctLegacyInstall -LegacyDir $legacy } | Should -Throw
        (Get-TreeManifest $legacy) | Should -Be $before
    }
    It 'refuses when a destination deploy.state already exists' {
        $legacy = New-LegacyDir; New-Dest | Out-Null
        Set-Content -LiteralPath (Join-Path $SharedDir 'deploy.state') -Value 'PROJECT_NAME=preexisting'
        { Import-AfctLegacyInstall -LegacyDir $legacy } | Should -Throw -ExpectedMessage '*deploy.state already exists*'
    }
    It 'preserves and reports an unrelated stale .import directory' {
        $legacy = New-LegacyDir; New-Dest | Out-Null
        $stale = Join-Path $SharedDir '.import-oldstalexxxxxxxxxxxxxxxxxxxxxxxx'
        New-Item -ItemType Directory -Path $stale -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $stale 'leftover') -Value 'x'
        Import-AfctLegacyInstall -LegacyDir $legacy
        Test-Path -LiteralPath $stale | Should -BeTrue   # not deleted
        Should -Invoke Write-AfctWarn -ParameterFilter { $Message -match 'staging directory' }
    }
}
