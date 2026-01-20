# Ensure Docker Desktop is running
$dockerProcess = Get-Process "Docker Desktop" -ErrorAction SilentlyContinue

if (-not $dockerProcess) {
    Write-Host "Docker Desktop is not running. Starting it..." -ForegroundColor Yellow
    Start-Process -FilePath "C:\Program Files\Docker\Docker\Docker Desktop.exe" -WindowStyle Hidden
    
    Write-Host "Waiting for Docker Desktop to be ready..." -ForegroundColor Yellow
    $timeout = 120  # 2 minutes timeout
    $elapsed = 0
    do {
        Start-Sleep -Seconds 3
        $elapsed += 3
        try {
            $dockerInfo = docker info 2>$null
            if ($dockerInfo) {
                # Additional check to ensure Docker daemon is fully ready
                docker ps 2>$null | Out-Null
                if ($LASTEXITCODE -eq 0) {
                    break
                }
            }
        } catch {
            # Continue waiting
        }
        if ($elapsed -gt $timeout) {
            Write-Host "Timeout waiting for Docker Desktop to be ready." -ForegroundColor Red
            exit 1
        }
    } while ($true)
    
    Write-Host "Docker Desktop is ready!" -ForegroundColor Green
} else {
    Write-Host "Docker Desktop is already running." -ForegroundColor Green
    # Quick check to ensure it's fully operational
    try {
        docker ps 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Docker Desktop is running but not ready yet. Waiting..." -ForegroundColor Yellow
            Start-Sleep -Seconds 5
        }
    } catch {
        Write-Host "Docker Desktop is starting up. Waiting..." -ForegroundColor Yellow
        Start-Sleep -Seconds 5
    }
}
