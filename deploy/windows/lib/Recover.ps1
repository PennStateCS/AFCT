# Recover.ps1 - restore the newest protected .env.production backup for the AFCT Windows
# controller.
#
# Dot-sourced by afctctl.ps1. Depends on Output.ps1, Environment.ps1. Reads controller
# globals ($EnvFile). Windows PowerShell 5.1 compatible. Recovery is for the case where
# data volumes survive but the configuration is gone: it restores a saved backup rather
# than generating fresh credentials that would orphan the database.

Set-StrictMode -Version Latest

function Invoke-AfctRecover {
    param([bool]$Yes, [bool]$NonInteractive)
    if (Test-Path -LiteralPath $EnvFile) {
        throw "afct-fatal: $EnvFile already exists. Recovery is intended for a missing configuration."
    }
    $backups = Get-ChildItem -Path "$EnvFile.backup.*" -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
    if (-not $backups) { throw "afct-fatal: no protected $EnvFile.backup.* files were found." }
    $latest = $backups | Select-Object -First 1
    Write-AfctInfo "newest configuration backup: $($latest.Name)"
    if ((-not $NonInteractive) -and (-not $Yes) -and (-not [Console]::IsInputRedirected)) {
        $a = Read-Host 'Restore this configuration backup? [Y/n]'
        if ($a -match '^(n|no)$') { throw 'afct-fatal: recovery cancelled.' }
    }
    Copy-Item -LiteralPath $latest.FullName -Destination $EnvFile
    Protect-AfctCriticalFile $EnvFile
    if (-not (Test-AfctEnvFileComplete $EnvFile)) { throw 'afct-fatal: the restored environment file is incomplete.' }
    Write-AfctSuccess "Configuration restored from $($latest.Name)."
    Write-AfctInfo 'Run: afctctl doctor'
    Write-AfctInfo 'Then run: afctctl restart'
}
