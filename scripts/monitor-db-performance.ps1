# Database Performance Monitoring Script for AFCT Development Environment (PowerShell)

Write-Host "🔍 AFCT Database Performance Monitor" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

# Function to run SQL query and format output
function Invoke-DatabaseQuery {
    param(
        [string]$Query,
        [string]$Title
    )
    
    Write-Host "📊 $Title" -ForegroundColor Yellow
    Write-Host ("-" * 50) -ForegroundColor Gray
    
    try {
        $result = docker exec afct-postgres-1 psql -U afct_user -d afct_dev -c "$Query" 2>$null
        if ($result) {
            Write-Host $result
        }
    }
    catch {
        Write-Host "❌ Error running query: $($_.Exception.Message)" -ForegroundColor Red
    }
    Write-Host ""
}

# Check if containers are running
$postgresRunning = docker ps --format "table {{.Names}}" | Select-String "afct-postgres-1"
if (-not $postgresRunning) {
    Write-Host "❌ PostgreSQL container is not running!" -ForegroundColor Red
    Write-Host "Run: docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d" -ForegroundColor Yellow
    exit 1
}

# Database configuration check
Invoke-DatabaseQuery "SELECT name, setting, unit, short_desc FROM pg_settings WHERE name IN ('shared_buffers', 'effective_cache_size', 'work_mem', 'fsync', 'synchronous_commit', 'wal_level') ORDER BY name;" "Database Configuration"

# Performance statistics
Invoke-DatabaseQuery "SELECT datname, numbackends as active_connections, xact_commit as commits, xact_rollback as rollbacks, blks_read as disk_reads, blks_hit as cache_hits, ROUND((blks_hit::float/(blks_hit+blks_read+1))*100, 2) as cache_hit_ratio FROM pg_stat_database WHERE datname = 'afct_dev';" "Database Statistics"

# Connection information
Invoke-DatabaseQuery "SELECT count(*) as total_connections, count(*) FILTER (WHERE state = 'active') as active, count(*) FILTER (WHERE state = 'idle') as idle FROM pg_stat_activity;" "Connection Status"

# Database size
Invoke-DatabaseQuery "SELECT pg_size_pretty(pg_database_size('afct_dev')) as database_size;" "Database Size"

# Table sizes (top 10)
Invoke-DatabaseQuery "SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size FROM pg_tables WHERE schemaname NOT IN ('information_schema', 'pg_catalog') ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC LIMIT 10;" "Largest Tables"

# Memory usage
Invoke-DatabaseQuery "SELECT name, setting, unit FROM pg_settings WHERE name LIKE '%mem%' AND name IN ('shared_buffers', 'work_mem', 'maintenance_work_mem', 'temp_buffers') ORDER BY name;" "Memory Configuration"

# Performance test
Write-Host "⚡ Performance Test" -ForegroundColor Yellow
Write-Host ("-" * 50) -ForegroundColor Gray
Write-Host "Testing database connection speed..."

$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
try {
    docker exec afct-postgres-1 psql -U afct_user -d afct_dev -c "SELECT 1;" 2>$null | Out-Null
    $stopwatch.Stop()
    $duration = $stopwatch.ElapsedMilliseconds
    Write-Host "✅ Database connection time: ${duration}ms" -ForegroundColor Green
}
catch {
    Write-Host "❌ Error testing connection: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""

# Container resource usage
Write-Host "🐳 Container Resource Usage" -ForegroundColor Yellow
Write-Host ("-" * 50) -ForegroundColor Gray
try {
    $stats = docker stats afct-postgres-1 --no-stream --format "table {{.Name}}`t{{.CPUPerc}}`t{{.MemUsage}}`t{{.MemPerc}}`t{{.NetIO}}`t{{.BlockIO}}"
    Write-Host $stats
}
catch {
    Write-Host "❌ Error getting container stats: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""

Write-Host "✅ Performance monitoring complete!" -ForegroundColor Green
Write-Host ""
Write-Host "💡 Tips for better performance:" -ForegroundColor Cyan
Write-Host "   - Monitor cache hit ratio (should be >95%)" -ForegroundColor White
Write-Host "   - Keep active connections low for development" -ForegroundColor White
Write-Host "   - Watch for slow queries in application logs" -ForegroundColor White
Write-Host "   - Use EXPLAIN ANALYZE for query optimization" -ForegroundColor White
