<#
build-bundle.ps1 - assemble the versioned AFCT Windows deployment bundle.

Shares the same sources of truth as the Linux/macOS builders: the Windows controller and
libraries in deploy/windows, the Windows bootstrap, and the SHARED Compose file and env
template in deploy/. Produces, in the output directory (default deploy/dist):

  afct-windows-deploy-<version>.zip
  afct-windows-deploy-<version>.zip.sha256
  deployment-manifest-windows.json

The ZIP is written with .NET so entries are sorted and timestamped deterministically,
giving stable bytes (and therefore a stable content digest) across rebuilds.

Usage: pwsh/powershell -File deploy/windows/build-bundle.ps1 [-OutDir <dir>]
#>
[CmdletBinding()]
param([string]$OutDir)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem | Out-Null

$WindowsDir = $PSScriptRoot
$DeployDir  = Split-Path -Parent $WindowsDir
if ([string]::IsNullOrEmpty($OutDir)) { $OutDir = Join-Path $DeployDir 'dist' }

$controller = Join-Path $WindowsDir 'bin\afctctl.ps1'
$version = (Select-String -LiteralPath $controller -Pattern "^\s*\`$InstallerVersion\s*=\s*'([^']+)'" |
            Select-Object -First 1).Matches.Groups[1].Value
if ([string]::IsNullOrEmpty($version)) { throw "could not read `$InstallerVersion from $controller" }

$name = "afct-windows-deploy-$version"

# Required sources.
$required = @(
    $controller,
    (Join-Path $WindowsDir 'install.ps1'),
    (Join-Path $DeployDir 'docker-compose.yml'),
    (Join-Path $DeployDir '.env.production.example')
)
foreach ($f in $required) {
    if (-not (Test-Path -LiteralPath $f)) { throw "missing source file: $f" }
}
$libFiles = @(Get-ChildItem -LiteralPath (Join-Path $WindowsDir 'lib') -Filter '*.ps1' -File)
if ($libFiles.Count -eq 0) { throw "no library modules found under $WindowsDir\lib" }

# Stage the exact tree we want in the ZIP: <name>/...
$stage = Join-Path ([System.IO.Path]::GetTempPath()) ("afct-winbundle-" + [Guid]::NewGuid().ToString('N'))
$root  = Join-Path $stage $name
New-Item -ItemType Directory -Path (Join-Path $root 'bin') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $root 'lib') -Force | Out-Null
try {
    Copy-Item -LiteralPath $controller -Destination (Join-Path $root 'bin\afctctl.ps1')
    Copy-Item -LiteralPath (Join-Path $WindowsDir 'install.ps1') -Destination (Join-Path $root 'install.ps1')
    foreach ($lf in $libFiles) { Copy-Item -LiteralPath $lf.FullName -Destination (Join-Path $root ('lib\' + $lf.Name)) }
    Copy-Item -LiteralPath (Join-Path $DeployDir 'docker-compose.yml') -Destination (Join-Path $root 'docker-compose.yml')
    Copy-Item -LiteralPath (Join-Path $DeployDir '.env.production.example') -Destination (Join-Path $root '.env.production.example')
    Set-Content -LiteralPath (Join-Path $root 'DEPLOY_VERSION') -Value $version -Encoding ASCII

    New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
    $zipPath = Join-Path $OutDir "$name.zip"
    if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }

    # Collect files relative to the stage root, sorted, for deterministic ordering.
    $entries = Get-ChildItem -LiteralPath $stage -Recurse -File |
        ForEach-Object { $_.FullName.Substring($stage.Length + 1).Replace('\', '/') } |
        Sort-Object -CaseSensitive

    $fixed = [DateTimeOffset]::new(1980, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
    $fs = [System.IO.File]::Open($zipPath, [System.IO.FileMode]::CreateNew)
    try {
        $zip = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
        try {
            foreach ($rel in $entries) {
                $srcFile = Join-Path $stage ($rel.Replace('/', '\'))
                $entry = $zip.CreateEntry($rel, [System.IO.Compression.CompressionLevel]::Optimal)
                $entry.LastWriteTime = $fixed
                $es = $entry.Open()
                try {
                    $bytes = [System.IO.File]::ReadAllBytes($srcFile)
                    $es.Write($bytes, 0, $bytes.Length)
                } finally { $es.Dispose() }
            }
        } finally { $zip.Dispose() }
    } finally { $fs.Dispose() }

    $hash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLower()
    # sha256sum-compatible line so any platform's tools can check it.
    Set-Content -LiteralPath "$zipPath.sha256" -Value ("{0}  {1}.zip" -f $hash, $name) -Encoding ASCII

    $manifest = [ordered]@{
        schema                = 'afct-deployment-manifest/v1'
        deploymentToolVersion = $version
        bundle                = "$name.zip"
        sha256                = $hash
        bootstrap             = 'install-windows.ps1'
    }
    ($manifest | ConvertTo-Json) | Set-Content -LiteralPath (Join-Path $OutDir 'deployment-manifest-windows.json') -Encoding ASCII

    Write-Output $zipPath
} finally {
    Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
}
