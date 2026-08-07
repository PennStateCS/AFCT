# Uninstall.ps1 - safe removal of an AFCT Windows installation.
#
# Dot-sourced by afctctl.ps1. Reads controller script-scope variables ($Prefix, $SharedDir,
# $RuntimeCompose). Windows PowerShell 5.1 compatible.
#
# Data (database, uploaded files, backup volumes) is PRESERVED by default. Docker volumes
# are deleted only with an explicit opt-in (-PurgeData or AFCT_PURGE_DATA=1), never inferred
# from -Yes. The install root is removed only when a protected marker proves it is really
# an AFCT install created by this tooling.

Set-StrictMode -Version Latest

# Decide whether the install root may be recursively deleted. Deliberately strict.
function Test-AfctUninstallSafe {
    param([string]$Root)
    if ([string]::IsNullOrWhiteSpace($Root)) { return $false }
    $full = [IO.Path]::GetFullPath($Root)

    # Never a drive root or a well-known shallow/home directory.
    $deny = @(
        [IO.Path]::GetPathRoot($full),
        $env:USERPROFILE, $env:LOCALAPPDATA, $env:APPDATA, $env:SystemRoot, $env:SystemDrive
    ) | Where-Object { $_ } | ForEach-Object { $_.TrimEnd('\') }
    if ($deny -contains $full.TrimEnd('\')) { return $false }
    # Require at least two path segments below the drive root (reject C:\Foo).
    $rel = $full.Substring([IO.Path]::GetPathRoot($full).Length)
    if (($rel.Split('\') | Where-Object { $_ }).Count -lt 2) { return $false }

    # The marker must exist and record exactly this root.
    $marker = Join-Path $full 'shared\install-root'
    if (-not (Test-Path -LiteralPath $marker)) { return $false }
    $recorded = (Get-Content -LiteralPath $marker -TotalCount 1)
    if ($null -eq $recorded) { return $false }
    if ($recorded.Trim() -ne $full.TrimEnd('\')) { return $false }

    # The expected release structure must be present.
    if (-not (Test-Path -LiteralPath (Join-Path $full 'releases'))) { return $false }
    if (-not (Test-Path -LiteralPath (Join-Path $full 'shared'))) { return $false }
    $state = Join-Path $full 'shared\active-release'
    $current = Join-Path $full 'current'
    if (-not (Test-Path -LiteralPath $state) -and -not (Test-Path -LiteralPath $current)) { return $false }
    return $true
}

function Invoke-AfctUninstall {
    param([bool]$Yes, [bool]$NonInteractive, [bool]$PurgeData)

    Write-AfctInfo "Uninstall AFCT (Windows)."
    Write-AfctInfo "This removes the AFCT tooling and containers. Your data (the database and"
    Write-AfctInfo "uploaded files, in Docker Desktop volumes) is PRESERVED unless you choose to delete it."

    $purge = $PurgeData -or ([Environment]::GetEnvironmentVariable('AFCT_PURGE_DATA') -eq '1')
    if (-not $purge -and -not $NonInteractive) {
        $a = Read-Host 'Also DELETE the database and uploaded files (Docker volumes)? This is irreversible [y/N]'
        if ($a -match '^(y|yes)$') { $purge = $true }
    }

    if ((Test-AfctDockerReady) -and (Test-Path -LiteralPath $RuntimeCompose)) {
        if ($purge) {
            Write-AfctWarn "stopping AFCT and removing its data volumes (irreversible)..."
            Invoke-AfctCompose down -v *> $null
        } else {
            Write-AfctInfo "stopping AFCT containers (keeping data volumes)..."
            Invoke-AfctCompose down *> $null
        }
    } else {
        Write-AfctWarn "Docker Desktop is not running, or no stack is configured; skipping container removal."
        Write-AfctWarn "Start Docker Desktop and rerun 'afctctl uninstall' if you still need containers removed."
    }

    if (-not $NonInteractive) {
        $a = Read-Host "Remove the tooling directory $Prefix ? [Y/n]"
        if ($a -match '^(n|no)$') { Write-AfctInfo "left $Prefix in place."; return }
    }

    if (Test-AfctUninstallSafe $Prefix) {
        # The running controller and the command wrapper both live under $Prefix, so deleting
        # it synchronously would pull the batch file out from under cmd.exe (it re-reads the
        # .cmd after the child exits) and yield a spurious nonzero exit. Hand the removal to a
        # short detached process that runs after this command returns.
        $deleter = "Start-Sleep -Seconds 2; try { Remove-Item -LiteralPath '$Prefix' -Recurse -Force -ErrorAction Stop } catch { }"
        Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden `
            -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $deleter) | Out-Null
        Write-AfctInfo "removing $Prefix; this completes in the background a moment after this command exits."
    } else {
        Write-AfctWarn "not removing $Prefix automatically: it does not look like an AFCT install created by"
        Write-AfctWarn "this tooling (missing or mismatched shared\install-root marker, or an unexpected layout)."
        Write-AfctInfo  "If you are sure, remove it by hand: Remove-Item -Recurse -Force `"$Prefix`""
    }

    Write-AfctInfo "AFCT uninstalled. Application images remain in Docker Desktop; remove them with:"
    Write-AfctInfo "  docker image ls | Select-String afct"
}
