<#
Bootstrap.Tests.ps1 - Pester tests for the AFCT Windows bootstrap (deploy/windows/install.ps1).

These run the REAL bootstrap as a child process against crafted local bundles, exercising
the security-critical core: SHA-256 verification, ZIP archive safety, version agreement,
content-addressed immutable releases, the active-release pointer + command wrapper, and
controller validation with rollback. No Docker daemon is involved (installs use
-SwitchOnly, the tooling install/switch path), so this is NOT Docker integration coverage.

Requires Pester 5+ and Windows PowerShell 5.1 (or PowerShell 7). AFCT_OS=Windows lets the
Windows-only bootstrap run on any host.
#>

BeforeAll {
    Add-Type -AssemblyName System.IO.Compression | Out-Null
    Add-Type -AssemblyName System.IO.Compression.FileSystem | Out-Null

    $script:RepoRoot     = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
    $script:Bootstrap    = Join-Path $RepoRoot 'deploy\windows\install.ps1'
    $script:BuildBundle  = Join-Path $RepoRoot 'deploy\windows\build-bundle.ps1'
    $script:Work         = Join-Path ([IO.Path]::GetTempPath()) ("afct-wtest-" + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $Work -Force | Out-Null

    # Build the canonical good bundle once.
    $dist = Join-Path $Work 'dist'
    $script:GoodBundle = (& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $BuildBundle -OutDir $dist).Trim()
    $script:Version = (Split-Path -Leaf $GoodBundle) -replace '^afct-windows-deploy-','' -replace '\.zip$',''

    function New-Sha256Sidecar([string]$zip) {
        $h = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLower()
        Set-Content -LiteralPath "$zip.sha256" -Value ("{0}  {1}" -f $h, (Split-Path -Leaf $zip)) -Encoding ASCII
    }

    # Craft a ZIP from @{ 'path/in/zip' = 'content' }. Uses raw entry names so traversal
    # entries can be created for the safety tests.
    function New-CraftedZip([string]$path, [hashtable]$entries) {
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
        $fs = [IO.File]::Open($path, [IO.FileMode]::CreateNew)
        $z = New-Object IO.Compression.ZipArchive($fs, [IO.Compression.ZipArchiveMode]::Create)
        foreach ($k in $entries.Keys) {
            $e = $z.CreateEntry($k)
            $sw = New-Object IO.StreamWriter($e.Open())
            $sw.Write([string]$entries[$k]); $sw.Dispose()
        }
        $z.Dispose(); $fs.Dispose()
    }

    # A full, well-formed bundle tree at an arbitrary version, with a controller whose
    # `version` exit code is $ControllerExit (0 = valid, non-zero = fails validation).
    function New-BundleTree([string]$zip, [string]$ver, [int]$ControllerExit = 0) {
        $top = "afct-windows-deploy-$ver"
        $ctl = "# controller`r`n`$InstallerVersion = '$ver'`r`nexit $ControllerExit`r`n"
        New-CraftedZip $zip @{
            "$top/bin/afctctl.ps1"        = $ctl
            "$top/lib/Output.ps1"         = "# lib"
            "$top/docker-compose.yml"     = "services: {}`r`n"
            "$top/.env.production.example" = "# example`r`n"
            "$top/DEPLOY_VERSION"         = $ver
        }
        New-Sha256Sidecar $zip
    }

    function Invoke-Bootstrap([string[]]$Arguments) {
        $env:AFCT_OS = 'Windows'
        $global:LASTEXITCODE = 0
        $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Bootstrap @Arguments 2>&1 | Out-String
        [pscustomobject]@{ Code = $LASTEXITCODE; Output = $out }
    }

    function New-Prefix { $p = Join-Path $Work ("pfx-" + [Guid]::NewGuid().ToString('N')); $p }
}

AfterAll {
    Remove-Item -LiteralPath $Work -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item Env:\AFCT_OS -ErrorAction SilentlyContinue
}

Describe 'Bundle build + manifest' {
    It 'produces a bundle, a sha256 sidecar, and a manifest naming that bundle' {
        Test-Path $GoodBundle | Should -BeTrue
        Test-Path "$GoodBundle.sha256" | Should -BeTrue
        $mf = Get-Content (Join-Path (Split-Path $GoodBundle) 'deployment-manifest-windows.json') -Raw | ConvertFrom-Json
        $mf.schema | Should -Be 'afct-deployment-manifest/v1'
        $mf.bundle | Should -Be (Split-Path -Leaf $GoodBundle)
        $mf.bootstrap | Should -Be 'install-windows.ps1'
        $mf.sha256 | Should -Be ((Get-FileHash $GoodBundle -Algorithm SHA256).Hash.ToLower())
    }
    It 'builds reproducibly (same bytes on a rebuild)' {
        $d2 = Join-Path $Work 'dist2'
        $z2 = (& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $BuildBundle -OutDir $d2).Trim()
        (Get-FileHash $GoodBundle).Hash | Should -Be (Get-FileHash $z2).Hash
    }
}

Describe 'Install (switch-only) from a verified local bundle' {
    It 'publishes an immutable release, pointer, marker, and working command wrappers' {
        $p = New-Prefix
        $r = Invoke-Bootstrap @('-BundleFile', $GoodBundle, '-Prefix', $p, '-SwitchOnly')
        $r.Code | Should -Be 0
        $rel = Get-ChildItem (Join-Path $p 'releases') -Directory
        $rel.Count | Should -Be 1
        $rel.Name | Should -Match "^$([regex]::Escape($Version))-[0-9a-f]{12}$"
        (Get-Content (Join-Path $p 'shared\active-release')).Trim() | Should -Be $rel.FullName
        (Get-Content (Join-Path $p 'shared\install-root')).Trim() | Should -Be ([IO.Path]::GetFullPath($p))
        Test-Path (Join-Path $p 'bin\afctctl.cmd') | Should -BeTrue
        Test-Path (Join-Path $p 'bin\afctctl.ps1') | Should -BeTrue
        # The stable wrapper resolves the active release and runs the controller.
        $env:AFCT_OS = 'Windows'
        $v = & (Join-Path $p 'bin\afctctl.cmd') version 2>&1 | Out-String
        $v | Should -Match 'deployment tool version'
    }

    It 'is idempotent: a second install of the same bundle does not change the active release' {
        $p = New-Prefix
        Invoke-Bootstrap @('-BundleFile', $GoodBundle, '-Prefix', $p, '-SwitchOnly') | Out-Null
        $first = (Get-Content (Join-Path $p 'shared\active-release')).Trim()
        $r = Invoke-Bootstrap @('-BundleFile', $GoodBundle, '-Prefix', $p, '-SwitchOnly')
        $r.Code | Should -Be 0
        $r.Output | Should -Match 'already installed'
        (Get-Content (Join-Path $p 'shared\active-release')).Trim() | Should -Be $first
    }
}

Describe 'Verification and rejection' {
    It 'refuses a bundle whose checksum does not match' {
        $bad = Join-Path $Work 'bad.zip'
        Copy-Item $GoodBundle $bad -Force
        Set-Content -LiteralPath "$bad.sha256" -Value ("{0}  {1}" -f ('0' * 64), 'bad.zip') -Encoding ASCII
        $r = Invoke-Bootstrap @('-BundleFile', $bad, '-Prefix', (New-Prefix), '-SwitchOnly')
        $r.Code | Should -Not -Be 0
        $r.Output | Should -Match 'checksum mismatch'
    }

    It 'refuses a local bundle with no checksum sidecar' {
        $nosum = Join-Path $Work 'nosum.zip'
        Copy-Item $GoodBundle $nosum -Force
        $r = Invoke-Bootstrap @('-BundleFile', $nosum, '-Prefix', (New-Prefix), '-SwitchOnly')
        $r.Code | Should -Not -Be 0
        $r.Output | Should -Match 'no .*\.sha256'
    }

    It 'refuses a ZIP containing a path-traversal entry (and extracts nothing outside staging)' {
        $evil = Join-Path $Work 'evil.zip'
        $top = "afct-windows-deploy-$Version"
        New-CraftedZip $evil @{
            "$top/bin/afctctl.ps1" = "`$InstallerVersion = '$Version'"
            "../evil.txt"          = 'pwned'
        }
        New-Sha256Sidecar $evil
        $p = New-Prefix
        $r = Invoke-Bootstrap @('-BundleFile', $evil, '-Prefix', $p, '-SwitchOnly')
        $r.Code | Should -Not -Be 0
        $r.Output | Should -Match 'unsafe path'
        # nothing published, and no file escaped to the prefix's parent
        Test-Path (Join-Path (Split-Path $p) 'evil.txt') | Should -BeFalse
    }

    It 'refuses a ZIP entry with a drive-qualified / backslash path' {
        $evil = Join-Path $Work 'evil2.zip'
        $top = "afct-windows-deploy-$Version"
        New-CraftedZip $evil @{
            "$top/bin/afctctl.ps1" = "`$InstallerVersion = '$Version'"
            "..\\windows\\x.txt"   = 'pwned'
        }
        New-Sha256Sidecar $evil
        $r = Invoke-Bootstrap @('-BundleFile', $evil, '-Prefix', (New-Prefix), '-SwitchOnly')
        $r.Code | Should -Not -Be 0
        $r.Output | Should -Match 'unsafe path'
    }

    It 'refuses a bundle whose DEPLOY_VERSION and controller version disagree' {
        $mism = Join-Path $Work 'mismatch.zip'
        $top = "afct-windows-deploy-$Version"
        New-CraftedZip $mism @{
            "$top/bin/afctctl.ps1"    = "`$InstallerVersion = '$Version'"
            "$top/lib/Output.ps1"     = '# lib'
            "$top/docker-compose.yml" = 'services: {}'
            "$top/DEPLOY_VERSION"     = '9.9.9'
        }
        New-Sha256Sidecar $mism
        $r = Invoke-Bootstrap @('-BundleFile', $mism, '-Prefix', (New-Prefix), '-SwitchOnly')
        $r.Code | Should -Not -Be 0
        $r.Output | Should -Match 'version metadata disagrees'
    }

    It 'refuses a same-version bundle with different content' {
        $p = New-Prefix
        Invoke-Bootstrap @('-BundleFile', $GoodBundle, '-Prefix', $p, '-SwitchOnly') | Out-Null
        # A different-content bundle at the SAME version.
        $alt = Join-Path $Work "afct-windows-deploy-$Version.zip"
        New-BundleTree $alt $Version 0   # different bytes than the real build (minimal tree)
        $r = Invoke-Bootstrap @('-BundleFile', $alt, '-Prefix', $p, '-SwitchOnly')
        $r.Code | Should -Not -Be 0
        $r.Output | Should -Match 'already installed with different content'
    }
}

Describe 'Controller validation and rollback' {
    It 'rolls back to the previous release when the new controller fails validation' {
        $p = New-Prefix
        # Install a known-good release first.
        Invoke-Bootstrap @('-BundleFile', $GoodBundle, '-Prefix', $p, '-SwitchOnly') | Out-Null
        $good = (Get-Content (Join-Path $p 'shared\active-release')).Trim()
        # A higher-version bundle whose controller exits 1 on `version` (fails validation).
        $broken = Join-Path $Work 'afct-windows-deploy-9.9.9.zip'
        New-BundleTree $broken '9.9.9' 1
        $r = Invoke-Bootstrap @('-BundleFile', $broken, '-Prefix', $p, '-SwitchOnly')
        $r.Code | Should -Not -Be 0
        $r.Output | Should -Match 'rolled back'
        # Active release restored to the good one.
        (Get-Content (Join-Path $p 'shared\active-release')).Trim() | Should -Be $good
    }
}
