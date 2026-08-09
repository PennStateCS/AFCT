<#
Operational.Tests.ps1 - Pester tests for the ported operational modules: input validation,
environment-file handling, secret generation, config resolution, diagnostics redaction, and
the recover command. These modules are pure (explicit paths, env-driven) so they are tested
directly without a running Docker daemon.
#>

BeforeAll {
    $script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
    $script:LibDir   = Join-Path $RepoRoot 'deploy\windows\lib'
    foreach ($m in 'Output', 'Docker', 'Validation', 'Environment', 'Config', 'Compose', 'Diagnostics', 'Update') {
        . (Join-Path $LibDir "$m.ps1")
    }
    $script:Bootstrap   = Join-Path $RepoRoot 'deploy\windows\install.ps1'
    $script:BuildBundle = Join-Path $RepoRoot 'deploy\windows\build-bundle.ps1'
    $script:Work = Join-Path ([IO.Path]::GetTempPath()) ("afct-optest-" + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $Work -Force | Out-Null

    function New-TmpFile { Join-Path $Work ((New-Guid).ToString('N') + '.env') }
    # Clear any admin-password env from the surrounding shell so config tests are hermetic.
    Remove-Item Env:\ADMIN_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:\ADMIN_PASSWORD_FILE -ErrorAction SilentlyContinue
}

AfterAll {
    Remove-Item -LiteralPath $Work -Recurse -Force -ErrorAction SilentlyContinue
    foreach ($v in 'APP_URL','ADMIN_EMAIL','ADMIN_PASSWORD','ADMIN_PASSWORD_FILE','AFCT_OS') {
        Remove-Item "Env:\$v" -ErrorAction SilentlyContinue
    }
}

Describe 'Validation' {
    It 'accepts and rejects emails' {
        Test-AfctEmail 'admin@example.edu' | Should -BeTrue
        Test-AfctEmail 'no-at-sign' | Should -BeFalse
        Test-AfctEmail 'has space@x.com' | Should -BeFalse
    }
    It 'normalizes valid origins and rejects the rest' {
        ConvertTo-AfctNormalizedAppUrl 'https://afct.example.edu/' | Should -Be 'https://afct.example.edu'
        ConvertTo-AfctNormalizedAppUrl 'http://localhost:3000' | Should -Be 'http://localhost:3000'
        ConvertTo-AfctNormalizedAppUrl 'https://host/path' | Should -BeNullOrEmpty
        ConvertTo-AfctNormalizedAppUrl 'ftp://host' | Should -BeNullOrEmpty
        ConvertTo-AfctNormalizedAppUrl 'https://user@host' | Should -BeNullOrEmpty
    }
    It 'warns about non-HTTPS and bare IPs' {
        @(Get-AfctAppUrlWarnings 'http://afct.example.edu').Count | Should -BeGreaterThan 0
        @(Get-AfctAppUrlWarnings 'https://192.168.1.10').Count | Should -BeGreaterThan 0
        @(Get-AfctAppUrlWarnings 'https://afct.example.edu').Count | Should -Be 0
        @(Get-AfctAppUrlWarnings 'http://localhost:3000').Count | Should -Be 0
    }
    It 'enforces the password policy' {
        Test-AfctStrongPassword 'Aa1!aaaa' | Should -BeTrue
        Test-AfctStrongPassword 'short1!A' | Should -BeTrue
        Test-AfctStrongPassword 'alllowercase1!' | Should -BeFalse
        Test-AfctStrongPassword 'NoSpecial123' | Should -BeFalse
        Test-AfctStrongPassword 'aB1!' | Should -BeFalse
    }
    It 'rejects env values that would not round-trip' {
        Test-AfctEnvValueSafe 'plain-value' | Should -BeTrue
        Test-AfctEnvValueSafe 'has"quote' | Should -BeFalse
        Test-AfctEnvValueSafe 'has\backslash' | Should -BeFalse
        Test-AfctEnvValueSafe ' leading' | Should -BeFalse
        Test-AfctEnvValueSafe 'trailing ' | Should -BeFalse
        Test-AfctEnvValueSafe 'value #comment' | Should -BeFalse
    }
}

Describe 'Environment' {
    It 'generates a 48-char lowercase-hex secret and a policy-compliant password' {
        $s = New-AfctSecret
        $s | Should -Match '^[0-9a-f]{48}$'
        Test-AfctStrongPassword (New-AfctAdminPassword) | Should -BeTrue
    }
    It 'writes env content as UTF-8 without a BOM' {
        $f = New-TmpFile
        Write-AfctEnvContent $f @('A=1', 'B=2')
        $bytes = [IO.File]::ReadAllBytes($f)
        # No UTF-8 BOM (EF BB BF) at the start.
        ($bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) | Should -BeFalse
        $bytes[0] | Should -Be ([byte][char]'A')
    }
    It 'reads values, stripping one layer of matching quotes' {
        $f = New-TmpFile
        Write-AfctEnvContent $f @('PLAIN=abc', "QUOTED=`"def`"", "SINGLE='ghi'", '# comment')
        Read-AfctEnvValue 'PLAIN' $f | Should -Be 'abc'
        Read-AfctEnvValue 'QUOTED' $f | Should -Be 'def'
        Read-AfctEnvValue 'SINGLE' $f | Should -Be 'ghi'
        Read-AfctEnvValue 'MISSING' $f | Should -Be ''
    }
    It 'reports completeness by required keys' {
        $f = New-TmpFile
        Write-AfctEnvContent $f @('POSTGRES_PASSWORD=x', 'DATABASE_URL=y', 'NEXTAUTH_SECRET=z')
        Test-AfctEnvFileComplete $f | Should -BeFalse
        Add-Content -LiteralPath $f -Value 'NEXTAUTH_URL=https://h'
        Test-AfctEnvFileComplete $f | Should -BeTrue
    }
    It 'sets a flag by replacing or appending' {
        $f = New-TmpFile
        Write-AfctEnvContent $f @('A=1', 'AFCT_UPDATER_ENABLED=false', 'B=2')
        Set-AfctEnvFlag 'AFCT_UPDATER_ENABLED' 'true' $f
        Read-AfctEnvValue 'AFCT_UPDATER_ENABLED' $f | Should -Be 'true'
        @(Get-Content $f | Where-Object { $_ -match '^AFCT_UPDATER_ENABLED=' }).Count | Should -Be 1
        Set-AfctEnvFlag 'AFCT_APP_TAG' 'v9.9.9' $f
        Read-AfctEnvValue 'AFCT_APP_TAG' $f | Should -Be 'v9.9.9'
    }
    It 'writes a single managed block and preserves other lines, idempotently' {
        $f = New-TmpFile
        Write-AfctEnvContent $f @('# keep me', 'CUSTOM_SETTING=hello')
        $cfg = @{
            AppUrl = 'https://afct.example.edu'; AdminEmail = 'a@b.edu'; AdminPassword = 'Aa1!aaaa'
            PostgresPassword = 'pg'; DatabaseUrl = 'postgresql://afct_user:pg@postgres:5432/afct'; NextAuthSecret = 'ns'; SecretKey = 'sk'
        }
        Write-AfctEnvironmentFile $f $cfg $null '2.2.3'
        Write-AfctEnvironmentFile $f $cfg $null '2.2.3'
        $content = Get-Content $f
        @($content | Where-Object { $_ -eq '# BEGIN AFCT INSTALLER MANAGED SETTINGS' }).Count | Should -Be 1
        @($content | Where-Object { $_ -eq 'CUSTOM_SETTING=hello' }).Count | Should -Be 1
        Read-AfctEnvValue 'NEXTAUTH_URL' $f | Should -Be 'https://afct.example.edu'
        Test-AfctEnvFileComplete $f | Should -BeTrue
    }
    It 'refuses to write an unsafe managed value' {
        $f = New-TmpFile
        $cfg = @{
            AppUrl = 'https://afct.example.edu'; AdminEmail = 'a@b.edu'; AdminPassword = 'bad"pw'
            PostgresPassword = 'pg'; DatabaseUrl = 'u'; NextAuthSecret = 'ns'; SecretKey = 'sk'
        }
        { Write-AfctEnvironmentFile $f $cfg $null '2.2.3' } | Should -Throw
    }
    It 'backs up an existing env file' {
        $f = New-TmpFile
        Write-AfctEnvContent $f @('A=1')
        $b = Backup-AfctEnvFile $f
        $b | Should -Not -BeNullOrEmpty
        Test-Path $b | Should -BeTrue
    }
}

# Wait-AfctHealth reads the controller globals; the docker-facing seams
# (Get-AfctAppContainerState, Test-AfctHttpHealth) are mocked so each failure mode can be
# driven without a daemon.
Describe 'Wait-AfctHealth failure modes' {
    BeforeAll {
        $script:HealthTimeout = 30
        $script:HealthInterval = 1
        $script:AppService = 'app'
        $script:HealthPath = '/api/health'
    }
    BeforeEach {
        Mock -CommandName Write-AfctInfo -MockWith { }
        Mock -CommandName Write-AfctSuccess -MockWith { }
        Mock -CommandName Write-AfctWarn -MockWith { }
        Mock -CommandName Start-Sleep -MockWith { }
    }

    It 'returns when the container is healthy' {
        Mock -CommandName Get-AfctAppContainerState -MockWith { 'running|healthy' }
        Mock -CommandName Test-AfctHttpHealth -MockWith { $true }
        { Wait-AfctHealth } | Should -Not -Throw
    }
    It 'names an unhealthy container as the reason' {
        Mock -CommandName Get-AfctAppContainerState -MockWith { 'running|unhealthy' }
        { Wait-AfctHealth } | Should -Throw '*unhealthy state*'
    }
    It 'fails fast on a crash loop instead of waiting out the timeout' {
        Mock -CommandName Get-AfctAppContainerState -MockWith { 'restarting|none' }
        { Wait-AfctHealth } | Should -Throw '*crash loop*'
        Should -Invoke Get-AfctAppContainerState -Exactly 3
    }
    It 'still reports a plain timeout when the container never appears' {
        $script:HealthTimeout = 3
        try {
            Mock -CommandName Get-AfctAppContainerState -MockWith { $null }
            { Wait-AfctHealth } | Should -Throw '*did not become healthy*'
        } finally { $script:HealthTimeout = 30 }
    }
}

# A pinned update ($env:AFCT_APP_TAG = 'vX.Y.Z'; afctctl update) deploys the exported tag,
# which Compose prefers over the env file. After a healthy deploy the tag must be written
# back, or the next plain update silently redeploys the old pin.
Describe 'Deployed-tag persistence (Save-AfctDeployedAppTag)' {
    BeforeEach {
        $script:f = New-TmpFile
        Write-AfctEnvContent $f @('NODE_ENV=production', 'AFCT_APP_TAG=v0.1.0', 'NEXTAUTH_SECRET=keepme')
    }
    AfterEach { Remove-Item Env:\AFCT_APP_TAG -ErrorAction SilentlyContinue }

    It 'records an exported pin, preserving the rest of the file' {
        $env:AFCT_APP_TAG = 'v0.2.0'
        Save-AfctDeployedAppTag $f
        Read-AfctEnvValue 'AFCT_APP_TAG' $f | Should -Be 'v0.2.0'
        Read-AfctEnvValue 'NEXTAUTH_SECRET' $f | Should -Be 'keepme'
        @(Get-Content $f | Where-Object { $_ -match '^AFCT_APP_TAG=' }).Count | Should -Be 1
    }
    It 'does nothing without an exported pin' {
        Save-AfctDeployedAppTag $f
        Read-AfctEnvValue 'AFCT_APP_TAG' $f | Should -Be 'v0.1.0'
    }
    It 'never records the rolling main build' {
        $env:AFCT_APP_TAG = 'main'
        Save-AfctDeployedAppTag $f
        Read-AfctEnvValue 'AFCT_APP_TAG' $f | Should -Be 'v0.1.0'
    }
    It 'refuses a tag with unsupported characters' {
        $env:AFCT_APP_TAG = 'v0.2.0 or 1=1'
        Save-AfctDeployedAppTag $f
        Read-AfctEnvValue 'AFCT_APP_TAG' $f | Should -Be 'v0.1.0'
    }
}

Describe 'Config resolution (non-interactive)' {
    It 'builds a new-install config from environment variables' {
        $env:APP_URL = 'https://afct.example.edu'
        $env:ADMIN_EMAIL = 'admin@example.edu'
        $env:ADMIN_PASSWORD = 'Aa1!aaaa'
        try {
            $cfg = Get-AfctNewInstallConfig (New-TmpFile) $Work $true
            $cfg.AppUrl | Should -Be 'https://afct.example.edu'
            $cfg.AdminEmail | Should -Be 'admin@example.edu'
            $cfg.AdminPassword | Should -Be 'Aa1!aaaa'
            $cfg.PostgresPassword | Should -Match '^[0-9a-f]{48}$'
            $cfg.DatabaseUrl | Should -Match 'postgresql://afct_user:.+@postgres:5432/afct'
            $cfg.Reconfiguring | Should -BeFalse
        } finally {
            Remove-Item Env:\APP_URL, Env:\ADMIN_EMAIL, Env:\ADMIN_PASSWORD -ErrorAction SilentlyContinue
        }
    }
    It 'fails a non-interactive new install with no password source' {
        $env:APP_URL = 'https://afct.example.edu'
        $env:ADMIN_EMAIL = 'admin@example.edu'
        try {
            { Get-AfctNewInstallConfig (New-TmpFile) $Work $true } | Should -Throw
        } finally {
            Remove-Item Env:\APP_URL, Env:\ADMIN_EMAIL -ErrorAction SilentlyContinue
        }
    }
    It 'rejects an invalid admin email' {
        $env:APP_URL = 'https://afct.example.edu'
        $env:ADMIN_EMAIL = 'not-an-email'
        $env:ADMIN_PASSWORD = 'Aa1!aaaa'
        try {
            { Get-AfctNewInstallConfig (New-TmpFile) $Work $true } | Should -Throw
        } finally {
            Remove-Item Env:\APP_URL, Env:\ADMIN_EMAIL, Env:\ADMIN_PASSWORD -ErrorAction SilentlyContinue
        }
    }
    It 'preserves infrastructure secrets on reconfigure' {
        $f = New-TmpFile
        Write-AfctEnvContent $f @(
            'NEXTAUTH_URL=https://old.example.edu', 'ADMIN_EMAIL=old@example.edu', 'ADMIN_PASSWORD=Aa1!aaaa',
            'POSTGRES_PASSWORD=keep-pg', 'DATABASE_URL=keep-url', 'NEXTAUTH_SECRET=keep-ns'
        )
        $env:APP_URL = 'https://new.example.edu'
        try {
            $cfg = Get-AfctReconfigureConfig $f $Work $true
            $cfg.AppUrl | Should -Be 'https://new.example.edu'
            $cfg.PostgresPassword | Should -Be 'keep-pg'
            $cfg.DatabaseUrl | Should -Be 'keep-url'
            $cfg.NextAuthSecret | Should -Be 'keep-ns'
            $cfg.Reconfiguring | Should -BeTrue
            # This env file predates secret encryption, so a key is generated rather than
            # demanded. Refusing to reconfigure an older install would be absurd.
            $cfg.SecretKey.Length | Should -BeGreaterOrEqual 32
        } finally {
            Remove-Item Env:\APP_URL -ErrorAction SilentlyContinue
        }
    }

    # Replacing the key would make every already-encrypted secret unreadable, which is the one
    # unrecoverable mistake available here.
    It 'preserves an existing secret-encryption key' {
        $f = New-TmpFile
        Write-AfctEnvContent $f @(
            'NEXTAUTH_URL=https://old.example.edu', 'ADMIN_EMAIL=old@example.edu',
            'ADMIN_PASSWORD=Aa1!aaaa', 'POSTGRES_PASSWORD=keep-pg', 'DATABASE_URL=keep-url',
            'NEXTAUTH_SECRET=keep-ns', 'AFCT_SECRET_KEY=keep-this-exact-key-value-keep-this'
        )
        $env:APP_URL = 'https://new.example.edu'
        try {
            $cfg = Get-AfctReconfigureConfig $f $Work $true
            $cfg.SecretKey | Should -Be 'keep-this-exact-key-value-keep-this'
        } finally {
            Remove-Item Env:\APP_URL -ErrorAction SilentlyContinue
        }
    }

    # The paths that deploy WITHOUT rewriting the env file have to top the key up themselves,
    # or an existing install reaches a version that needs one and comes up without it.
    It 'tops up a missing key without touching an existing one' {
        $f = New-TmpFile
        Write-AfctEnvContent $f @('NEXTAUTH_SECRET=keep-ns')

        Confirm-AfctSecretKey $f
        $generated = Read-AfctEnvValue 'AFCT_SECRET_KEY' $f
        $generated.Length | Should -BeGreaterOrEqual 32

        Confirm-AfctSecretKey $f
        Read-AfctEnvValue 'AFCT_SECRET_KEY' $f | Should -Be $generated
    }
}

Describe 'Diagnostics redaction' {
    It 'redacts sensitive keys by name and preserves comments' {
        $src = New-TmpFile
        $dst = New-TmpFile
        Write-AfctEnvContent $src @('# a comment', 'POSTGRES_PASSWORD=supersecret', 'NODE_ENV=production')
        Copy-AfctRedactedEnv $src $dst
        $out = Get-Content $dst
        $out | Should -Contain '# a comment'
        $out | Should -Contain 'NODE_ENV=production'
        @($out | Where-Object { $_ -match 'supersecret' }).Count | Should -Be 0
        @($out | Where-Object { $_ -match 'POSTGRES_PASSWORD=\*\*\*REDACTED\*\*\*' }).Count | Should -Be 1
    }
    It 'scrubs exact secret values anywhere in a tree' {
        $envF = New-TmpFile
        Write-AfctEnvContent $envF @('POSTGRES_PASSWORD=hunter2xyz', 'DATABASE_URL=u', 'NEXTAUTH_SECRET=s', 'ADMIN_PASSWORD=p')
        $tree = Join-Path $Work ((New-Guid).ToString('N'))
        New-Item -ItemType Directory -Path $tree -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $tree 'log.txt') -Value 'a stack trace leaked hunter2xyz here'
        Hide-AfctSecretsInTree $tree $envF
        (Get-Content (Join-Path $tree 'log.txt')) | Should -Not -Match 'hunter2xyz'
    }
}

Describe 'Runtime Compose seeding' {
    It 'seeds runtime from the release template, then refreshes with a backup on change' {
        $ComposeTemplate = Join-Path $Work ((New-Guid).ToString('N') + '-template.yml')
        $RuntimeDir = Join-Path $Work ((New-Guid).ToString('N') + '-runtime')
        $RuntimeCompose = Join-Path $RuntimeDir 'docker-compose.yml'
        Set-Content -LiteralPath $ComposeTemplate -Value "services:`n  app: {}"

        # First seed: runtime file created from the template.
        Sync-AfctRuntimeCompose
        Test-Path $RuntimeCompose | Should -BeTrue
        (Get-FileHash $RuntimeCompose).Hash | Should -Be (Get-FileHash $ComposeTemplate).Hash

        # Unchanged template: no backup produced.
        Sync-AfctRuntimeCompose
        @(Get-ChildItem -Path "$RuntimeCompose.bak.*" -ErrorAction SilentlyContinue).Count | Should -Be 0

        # Template changes: runtime refreshed, previous runtime backed up.
        Set-Content -LiteralPath $ComposeTemplate -Value "services:`n  app: {}`n  worker: {}"
        Sync-AfctRuntimeCompose
        (Get-FileHash $RuntimeCompose).Hash | Should -Be (Get-FileHash $ComposeTemplate).Hash
        @(Get-ChildItem -Path "$RuntimeCompose.bak.*" -ErrorAction SilentlyContinue).Count | Should -BeGreaterThan 0
    }
}

Describe 'afctctl recover (integration)' {
    It 'restores the newest backup when the env file is missing' {
        $env:AFCT_OS = 'Windows'
        $dist = Join-Path $Work 'dist'
        $zip = (& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $BuildBundle -OutDir $dist).Trim()
        $p = Join-Path $Work ("pfx-" + [Guid]::NewGuid().ToString('N'))
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Bootstrap -BundleFile $zip -Prefix $p -SwitchOnly | Out-Null

        $envFile = Join-Path $p 'shared\.env.production'
        $backup = "$envFile.backup.20260101-000000.999"
        Write-AfctEnvContent $backup @('POSTGRES_PASSWORD=x', 'DATABASE_URL=y', 'NEXTAUTH_SECRET=z', 'NEXTAUTH_URL=https://h')
        Test-Path $envFile | Should -BeFalse

        $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -Command `
            "`$env:AFCT_OS='Windows'; & '$p\bin\afctctl.ps1' recover -Yes -NonInteractive" 2>&1 | Out-String
        $out | Should -Match 'Configuration restored'
        Test-Path $envFile | Should -BeTrue
        Test-AfctEnvFileComplete $envFile | Should -BeTrue
    }
}
