<#
Uninstall.Tests.ps1 - Pester tests for the marker-guarded AFCT Windows uninstall.

Unit tests exercise the Test-AfctUninstallSafe guard directly; an integration test installs
a bundle (switch-only) and runs the real `afctctl uninstall` through the command wrapper,
with Docker absent (containers are skipped). Data-volume deletion is never exercised here.
#>

BeforeAll {
    $script:RepoRoot   = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
    $script:Bootstrap  = Join-Path $RepoRoot 'deploy\windows\install.ps1'
    $script:BuildBundle = Join-Path $RepoRoot 'deploy\windows\build-bundle.ps1'
    $script:Work       = Join-Path ([IO.Path]::GetTempPath()) ("afct-untest-" + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $Work -Force | Out-Null

    # Bring Test-AfctUninstallSafe into scope for the unit tests.
    . (Join-Path $RepoRoot 'deploy\windows\lib\Uninstall.ps1')

    function New-FakeInstall([string]$root) {
        New-Item -ItemType Directory -Path (Join-Path $root 'releases\1.0.0-abcdef012345') -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $root 'shared') -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $root 'shared\active-release') -Value (Join-Path $root 'releases\1.0.0-abcdef012345')
        Set-Content -LiteralPath (Join-Path $root 'shared\install-root') -Value (([IO.Path]::GetFullPath($root)).TrimEnd('\'))
    }
    function New-Root { $r = Join-Path $Work ("root-" + [Guid]::NewGuid().ToString('N')); $r }
}

AfterAll {
    Remove-Item -LiteralPath $Work -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item Env:\AFCT_OS -ErrorAction SilentlyContinue
}

Describe 'Test-AfctUninstallSafe' {
    It 'accepts a complete AFCT install whose marker matches' {
        $r = New-Root; New-FakeInstall $r
        Test-AfctUninstallSafe $r | Should -BeTrue
    }
    It 'rejects a missing marker' {
        $r = New-Root; New-FakeInstall $r
        Remove-Item -LiteralPath (Join-Path $r 'shared\install-root') -Force
        Test-AfctUninstallSafe $r | Should -BeFalse
    }
    It 'rejects a mismatched marker' {
        $r = New-Root; New-FakeInstall $r
        Set-Content -LiteralPath (Join-Path $r 'shared\install-root') -Value 'C:\somewhere\else'
        Test-AfctUninstallSafe $r | Should -BeFalse
    }
    It 'rejects an incomplete structure (no releases)' {
        $r = New-Root; New-FakeInstall $r
        Remove-Item -LiteralPath (Join-Path $r 'releases') -Recurse -Force
        Test-AfctUninstallSafe $r | Should -BeFalse
    }
    It 'rejects a drive root and well-known shallow directories' {
        Test-AfctUninstallSafe ([IO.Path]::GetPathRoot($env:LOCALAPPDATA)) | Should -BeFalse
        Test-AfctUninstallSafe $env:LOCALAPPDATA | Should -BeFalse
        Test-AfctUninstallSafe $env:USERPROFILE | Should -BeFalse
    }
}

Describe 'afctctl uninstall (integration, Docker absent)' {
    It 'preserves data, skips containers, and removes the install root' {
        $env:AFCT_OS = 'Windows'
        $dist = Join-Path $Work 'dist'
        $zip = (& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $BuildBundle -OutDir $dist).Trim()
        $p = Join-Path $Work ("pfx-" + [Guid]::NewGuid().ToString('N'))
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Bootstrap -BundleFile $zip -Prefix $p -SwitchOnly | Out-Null
        Test-Path (Join-Path $p 'shared\install-root') | Should -BeTrue

        # Docker absent for this invocation so container removal is skipped deterministically.
        $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -Command `
            "`$env:AFCT_OS='Windows'; `$env:PATH='C:\Windows\System32'; & '$p\bin\afctctl.ps1' uninstall -NonInteractive" 2>&1 | Out-String
        $out | Should -Match 'skipping container removal'
        $out | Should -Match 'uninstalled'
        # Removal is handed to a short detached process; wait for it to finish.
        $deadline = (Get-Date).AddSeconds(25)
        while ((Test-Path -LiteralPath $p) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 300 }
        Test-Path -LiteralPath $p | Should -BeFalse
    }
}
