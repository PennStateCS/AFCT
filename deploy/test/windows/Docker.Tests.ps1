<#
Docker.Tests.ps1 - Regression tests for the docker seams in lib\Docker.ps1.

These use a real `docker.cmd` shim on PATH that writes to stderr and exits non-zero,
because that is what reproduces the failure: under the installer's global
ErrorActionPreference='Stop', PowerShell 5.1 turns a native command's stderr into a
terminating NativeCommandError. A missing-image inspect (the routine "not present, pull
it" case), a failed pull, and a blocked mount all hit that path, so each seam must
soften ErrorActionPreference and surface the child exit code instead of throwing. A
Pester function mock cannot exercise this, since only a real native command produces the
stderr that triggers the behavior.
#>

BeforeAll {
    $script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
    $script:LibDir   = Join-Path $RepoRoot 'deploy\windows\lib'
    foreach ($m in 'Output', 'Environment', 'Docker') { . (Join-Path $LibDir "$m.ps1") }

    # A stand-in `docker` that behaves like every failing invocation these seams guard
    # against: noise on stderr, non-zero exit. Prepended to PATH so it wins resolution.
    $script:ShimDir = Join-Path ([IO.Path]::GetTempPath()) ("afct-dockershim-" + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $ShimDir -Force | Out-Null
    $shim = @"
@echo off
echo Error response from daemon: No such image: alpine:3.20 1>&2
exit /b 1
"@
    Set-Content -LiteralPath (Join-Path $ShimDir 'docker.cmd') -Value $shim -Encoding ASCII
    $script:OldPath = $env:PATH
    $env:PATH = $ShimDir + [IO.Path]::PathSeparator + $env:PATH
    $script:LogFile = ''
}

AfterAll {
    if ($null -ne $script:OldPath) { $env:PATH = $script:OldPath }
    Remove-Item -LiteralPath $ShimDir -Recurse -Force -ErrorAction SilentlyContinue
}

Describe 'Docker seams under ErrorActionPreference=Stop' {
    # A direct call is the assertion: without the ErrorActionPreference guard these throw
    # a terminating NativeCommandError under Stop, which fails the test outright.
    It 'Test-AfctDockerImagePresent returns false, never throws, when the image is absent' {
        $ErrorActionPreference = 'Stop'
        Test-AfctDockerImagePresent 'alpine:3.20' | Should -BeFalse
    }

    It 'Invoke-AfctDockerPull returns the non-zero exit code instead of throwing' {
        $ErrorActionPreference = 'Stop'
        Invoke-AfctDockerPull 'alpine:3.20' | Should -Be 1
    }

    It 'Test-AfctDockerBindMount returns false, never throws, when the run fails' {
        $ErrorActionPreference = 'Stop'
        Test-AfctDockerBindMount 'alpine:3.20' 'C:\afct\nope' | Should -BeFalse
    }

    It 'leaves the caller ErrorActionPreference untouched afterward' {
        $ErrorActionPreference = 'Stop'
        Test-AfctDockerImagePresent 'alpine:3.20' | Out-Null
        $ErrorActionPreference | Should -Be 'Stop'
    }
}

Describe 'Set-AfctRuntimeComposeEnv exports the runtime interpolation vars' {
    # The runtime Compose file interpolates these; without them the per-service env_file
    # falls back to .env.production next to the compose file (shared\runtime\) instead of the
    # real one in shared\, and `docker compose config` fails with "env file ... not found".
    It 'points the runtime vars at the shared locations, with forward slashes' {
        $script:EnvFile        = 'C:\Users\me\AppData\Local\AFCT\shared\.env.production'
        $script:RuntimeCompose = 'C:\Users\me\AppData\Local\AFCT\shared\runtime\docker-compose.yml'
        Set-AfctRuntimeComposeEnv
        $env:AFCT_RUNTIME_ENV_FILE    | Should -Be 'C:/Users/me/AppData/Local/AFCT/shared/.env.production'
        $env:AFCT_RUNTIME_SHARED_DIR  | Should -Be 'C:/Users/me/AppData/Local/AFCT/shared'
        $env:AFCT_RUNTIME_COMPOSE_DIR | Should -Be 'C:/Users/me/AppData/Local/AFCT/shared/runtime'
    }
}
