# Auto-start Docker Desktop if not running, then start dev containers
$dockerProcess = Get-Process -Name "Docker Desktop" -ErrorAction SilentlyContinue
if (-not $dockerProcess) {
    Write-Host "Starting Docker Desktop..."
    Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    Write-Host "Waiting for Docker to initialize..."
    Start-Sleep -Seconds 15
}

# Wait until Docker is actually available
$maxWait = 60
$waited = 0
while ($true) {
    try {
        docker info | Out-Null
        break
    } catch {
        if ($waited -ge $maxWait) {
            Write-Error "Docker did not start within $maxWait seconds."
            exit 1
        }
        Start-Sleep -Seconds 2
        $waited += 2
    }
}

Write-Host "Docker is running. Starting containers..."
npm run docker:dev:fast
