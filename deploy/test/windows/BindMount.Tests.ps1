<#
BindMount.Tests.ps1 - Pester tests for the Docker Desktop bind-mount preflight. The docker
seams (image inspect, pull, run) are mocked, so no real daemon is needed. Verifies that a
pull failure is reported as a network problem (never file sharing) and a mount failure names
the exact directory.
#>

BeforeAll {
    $script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
    $script:LibDir   = Join-Path $RepoRoot 'deploy\windows\lib'
    foreach ($m in 'Output', 'Environment', 'Docker') { . (Join-Path $LibDir "$m.ps1") }
    $script:Work = Join-Path ([IO.Path]::GetTempPath()) ("afct-bm-" + [Guid]::NewGuid().ToString('N'))
    $script:Shared = Join-Path $Work 'shared'
    $script:Runtime = Join-Path $Work 'shared\runtime'
    New-Item -ItemType Directory -Path $Runtime -Force | Out-Null
    $script:LogFile = ''
}
AfterAll {
    Remove-Item -LiteralPath $Work -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item Env:\AFCT_SKIP_BIND_MOUNT_CHECK -ErrorAction SilentlyContinue
    Remove-Item Env:\AFCT_BIND_CHECK_IMAGE -ErrorAction SilentlyContinue
}

Describe 'Assert-AfctBindMounts' {
    BeforeEach {
        Mock -CommandName Write-AfctInfo -MockWith { }
        Mock -CommandName Write-AfctWarn -MockWith { }
        Mock -CommandName Test-AfctPathIsNetworkish -MockWith { $false }
        Remove-Item Env:\AFCT_SKIP_BIND_MOUNT_CHECK -ErrorAction SilentlyContinue
    }

    It 'is skipped entirely when AFCT_SKIP_BIND_MOUNT_CHECK=1' {
        $env:AFCT_SKIP_BIND_MOUNT_CHECK = '1'
        Mock -CommandName Test-AfctDockerImagePresent -MockWith { $true }
        { Assert-AfctBindMounts @($Shared) } | Should -Not -Throw
        Should -Invoke Test-AfctDockerImagePresent -Times 0
    }

    It 'does not pull when the image is already present, then mounts each dir' {
        Mock -CommandName Test-AfctDockerImagePresent -MockWith { $true }
        Mock -CommandName Invoke-AfctDockerPull -MockWith { 0 }
        Mock -CommandName Test-AfctDockerBindMount -MockWith { $true }
        { Assert-AfctBindMounts @($Shared, $Runtime) } | Should -Not -Throw
        Should -Invoke Invoke-AfctDockerPull -Times 0
        Should -Invoke Test-AfctDockerBindMount -Times 2
    }

    It 'pulls when the image is missing and the pull succeeds' {
        Mock -CommandName Test-AfctDockerImagePresent -MockWith { $false }
        Mock -CommandName Invoke-AfctDockerPull -MockWith { 0 }
        Mock -CommandName Test-AfctDockerBindMount -MockWith { $true }
        { Assert-AfctBindMounts @($Shared) } | Should -Not -Throw
        Should -Invoke Invoke-AfctDockerPull -Times 1
    }

    It 'reports a pull failure as a network problem, never file sharing' {
        Mock -CommandName Test-AfctDockerImagePresent -MockWith { $false }
        Mock -CommandName Invoke-AfctDockerPull -MockWith { 1 }
        Mock -CommandName Test-AfctDockerBindMount -MockWith { $true }
        $err = $null
        try { Assert-AfctBindMounts @($Shared) } catch { $err = "$($_.Exception.Message)" }
        $err | Should -Match 'could not download'
        $err | Should -Not -Match 'file.sharing'
        $err | Should -Not -Match 'could not mount'
        Should -Invoke Test-AfctDockerBindMount -Times 0
    }

    It 'reports a mount failure and names the exact directory' {
        Mock -CommandName Test-AfctDockerImagePresent -MockWith { $true }
        Mock -CommandName Test-AfctDockerBindMount -MockWith { $false }
        $err = $null
        try { Assert-AfctBindMounts @($Shared) } catch { $err = "$($_.Exception.Message)" }
        $err | Should -Match 'could not mount'
        $err | Should -Match ([regex]::Escape($Shared))
    }

    It 'passes the exact directory (including spaces) to the mount test' {
        $spaced = Join-Path $Work 'App Support\AFCT\shared'
        New-Item -ItemType Directory -Path $spaced -Force | Out-Null
        Mock -CommandName Test-AfctDockerImagePresent -MockWith { $true }
        Mock -CommandName Test-AfctDockerBindMount -MockWith { $true }
        Assert-AfctBindMounts @($spaced)
        Should -Invoke Test-AfctDockerBindMount -Times 1 -ParameterFilter { $Dir -eq $spaced }
    }

    It 'warns (does not fail) for a network or removable path before testing the mount' {
        Mock -CommandName Test-AfctDockerImagePresent -MockWith { $true }
        Mock -CommandName Test-AfctDockerBindMount -MockWith { $true }
        Mock -CommandName Test-AfctPathIsNetworkish -MockWith { $true }
        { Assert-AfctBindMounts @($Shared) } | Should -Not -Throw
        Should -Invoke Write-AfctWarn -Times 1
    }

    It 'honors a custom bind-check image' {
        $env:AFCT_BIND_CHECK_IMAGE = 'mirror.example/alpine:3.20'
        Get-AfctBindCheckImage | Should -Be 'mirror.example/alpine:3.20'
        Remove-Item Env:\AFCT_BIND_CHECK_IMAGE
        Get-AfctBindCheckImage | Should -Be 'alpine:3.20'
    }
}
