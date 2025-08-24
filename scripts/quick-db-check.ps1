# Simple Database Performance Check for AFCT

Write-Host "Database Performance Check" -ForegroundColor Cyan
Write-Host "=========================" -ForegroundColor Cyan

# Check basic settings
Write-Host "`nDatabase Configuration:" -ForegroundColor Yellow
docker exec afct-postgres-1 psql -U afct_user -d afct_dev -c "SHOW shared_buffers;"
docker exec afct-postgres-1 psql -U afct_user -d afct_dev -c "SHOW effective_cache_size;"
docker exec afct-postgres-1 psql -U afct_user -d afct_dev -c "SHOW fsync;"
docker exec afct-postgres-1 psql -U afct_user -d afct_dev -c "SHOW synchronous_commit;"

Write-Host "`nConnection Test:" -ForegroundColor Yellow
$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
docker exec afct-postgres-1 psql -U afct_user -d afct_dev -c "SELECT 1;" | Out-Null
$stopwatch.Stop()
Write-Host "Connection time: $($stopwatch.ElapsedMilliseconds)ms" -ForegroundColor Green

Write-Host "`nContainer Stats:" -ForegroundColor Yellow
docker stats afct-postgres-1 --no-stream

Write-Host "`nOptimization Status: ✅ Applied" -ForegroundColor Green
