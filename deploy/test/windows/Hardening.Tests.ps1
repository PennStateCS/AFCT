<#
Hardening.Tests.ps1 - Pester tests for the doctor clock-sync check and the critical-file
ACL policy. Get-Service and Set-Acl are mocked, so no real service or filesystem ACL is
touched.
#>

BeforeAll {
    $script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
    $script:LibDir   = Join-Path $RepoRoot 'deploy\windows\lib'
    foreach ($m in 'Output', 'Docker', 'Validation', 'Environment') {
        . (Join-Path $LibDir "$m.ps1")
    }
    $script:Work = Join-Path ([IO.Path]::GetTempPath()) ("afct-hard-" + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $Work -Force | Out-Null
    function New-TmpFile { $p = Join-Path $Work ((New-Guid).ToString('N') + '.dat'); Set-Content -LiteralPath $p -Value 'x'; $p }
    $script:MySid = ([Security.Principal.WindowsIdentity]::GetCurrent()).User.Value
}

AfterAll { Remove-Item -LiteralPath $Work -Recurse -Force -ErrorAction SilentlyContinue }

Describe 'Test-AfctClockSync' {
    It 'is true only when W32Time is running' {
        Mock -CommandName Get-Service -MockWith { [pscustomobject]@{ Status = 'Running' } }
        Test-AfctClockSync | Should -BeTrue
    }
    It 'is false when the service is stopped' {
        Mock -CommandName Get-Service -MockWith { [pscustomobject]@{ Status = 'Stopped' } }
        Test-AfctClockSync | Should -BeFalse
    }
    It 'is false when the service is missing (Get-Service errors)' {
        Mock -CommandName Get-Service -MockWith { throw [Microsoft.PowerShell.Commands.ServiceCommandException]::new('no such service') }
        Test-AfctClockSync | Should -BeFalse
    }
    It 'is false when Get-Service throws an arbitrary error' {
        Mock -CommandName Get-Service -MockWith { throw 'access denied' }
        Test-AfctClockSync | Should -BeFalse
    }
}

Describe 'Protect-AfctFile and the critical/best-effort wrappers' {
    It 'restricts the file to the current account by SID literal (offline-safe)' {
        Mock -CommandName Set-AfctFileAcl -MockWith { }
        $f = New-TmpFile
        Protect-AfctFile $f
        # The grant is keyed on the SID, so a username with spaces or a domain-qualified
        # account needs no name parsing and no domain-controller round trip.
        Should -Invoke Set-AfctFileAcl -Times 1 -ParameterFilter { $Sid -eq $script:MySid }
    }
    It 'is a no-op when the file does not exist' {
        Mock -CommandName Set-AfctFileAcl -MockWith { }
        Protect-AfctFile (Join-Path $Work 'does-not-exist.dat')
        Should -Invoke Set-AfctFileAcl -Times 0
    }
    It 'critical: a lockdown failure is fatal (afct-fatal)' {
        Mock -CommandName Set-AfctFileAcl -MockWith { throw 'access is denied' }
        $f = New-TmpFile
        { Protect-AfctCriticalFile $f } | Should -Throw -ExpectedMessage '*afct-fatal*'
    }
    It 'critical: succeeds silently when the ACL applies' {
        Mock -CommandName Set-AfctFileAcl -MockWith { }
        $f = New-TmpFile
        { Protect-AfctCriticalFile $f } | Should -Not -Throw
    }
    It 'best-effort: a lockdown failure warns but does not throw' {
        Mock -CommandName Set-AfctFileAcl -MockWith { throw 'access is denied' }
        Mock -CommandName Write-AfctWarn -MockWith { }
        $f = New-TmpFile
        { Protect-AfctFileBestEffort $f } | Should -Not -Throw
        Should -Invoke Write-AfctWarn -Times 1
    }
    It 'reports a clear error when icacls is unavailable' {
        Mock -CommandName Get-Command -MockWith { $null } -ParameterFilter { $Name -eq 'icacls' }
        $f = New-TmpFile
        { Protect-AfctFile $f } | Should -Throw -ExpectedMessage '*icacls is not available*'
    }
}

Describe 'ci-windows-version.ps1' {
    BeforeAll {
        $script:Helper = Join-Path $RepoRoot 'deploy\ci-windows-version.ps1'
        # Invoke through Start-Process -PassThru and read ExitCode, so the helper's stderr
        # diagnostic is never routed through PowerShell's error stream (which Windows
        # PowerShell 5.1 wraps as a terminating NativeCommandError under Pester).
        function Invoke-Helper {
            param([string]$ControllerPath)
            $o = Join-Path $Work ((New-Guid).ToString('N') + '.out')
            $e = Join-Path $Work ((New-Guid).ToString('N') + '.err')
            $p = Start-Process -FilePath 'powershell.exe' -PassThru -Wait -WindowStyle Hidden `
                -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $Helper, '-ControllerPath', $ControllerPath) `
                -RedirectStandardOutput $o -RedirectStandardError $e
            $stdout = ''
            if (Test-Path $o) { $stdout = (Get-Content -LiteralPath $o -Raw); if ($null -eq $stdout) { $stdout = '' } }
            return [pscustomobject]@{ ExitCode = $p.ExitCode; StdOut = $stdout.Trim() }
        }
    }
    It 'prints the version parsed from a controller' {
        $fix = Join-Path $Work 'ctl.ps1'
        Set-Content -LiteralPath $fix -Value "Set-StrictMode -Version Latest`n`$InstallerVersion = '9.9.9'`n"
        $r = Invoke-Helper $fix
        $r.ExitCode | Should -Be 0
        $r.StdOut | Should -Be '9.9.9'
    }
    It 'exits nonzero when the version cannot be parsed' {
        $fix = Join-Path $Work 'noversion.ps1'
        Set-Content -LiteralPath $fix -Value "# nothing to parse here`n"
        (Invoke-Helper $fix).ExitCode | Should -Be 1
    }
    It 'reads the real Windows controller version' {
        $r = Invoke-Helper (Join-Path $RepoRoot 'deploy\windows\bin\afctctl.ps1')
        $r.ExitCode | Should -Be 0
        $r.StdOut | Should -Match '^[0-9]+\.[0-9]+\.[0-9]+$'
    }
}
