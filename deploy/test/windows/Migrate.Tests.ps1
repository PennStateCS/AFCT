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
