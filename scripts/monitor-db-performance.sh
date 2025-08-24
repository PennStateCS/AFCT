#!/usr/bin/env bash
# Database Performance Monitoring Script for AFCT Development Environment

echo "🔍 AFCT Database Performance Monitor"
echo "====================================="
echo ""

# Function to run SQL query and format output
run_query() {
    local query="$1"
    local title="$2"
    echo "📊 $title"
    echo "$(printf '%.0s-' {1..50})"
    docker exec afct-postgres-1 psql -U afct_user -d afct_dev -c "$query" 2>/dev/null
    echo ""
}

# Check if containers are running
if ! docker ps | grep -q "afct-postgres-1"; then
    echo "❌ PostgreSQL container is not running!"
    echo "Run: docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d"
    exit 1
fi

# Database configuration check
run_query "SELECT name, setting, unit, short_desc FROM pg_settings WHERE name IN ('shared_buffers', 'effective_cache_size', 'work_mem', 'fsync', 'synchronous_commit', 'wal_level') ORDER BY name;" "Database Configuration"

# Performance statistics
run_query "SELECT datname, numbackends as active_connections, xact_commit as commits, xact_rollback as rollbacks, blks_read as disk_reads, blks_hit as cache_hits, ROUND((blks_hit::float/(blks_hit+blks_read+1))*100, 2) as cache_hit_ratio FROM pg_stat_database WHERE datname = 'afct_dev';" "Database Statistics"

# Connection information
run_query "SELECT count(*) as total_connections, count(*) FILTER (WHERE state = 'active') as active, count(*) FILTER (WHERE state = 'idle') as idle FROM pg_stat_activity;" "Connection Status"

# Database size
run_query "SELECT pg_size_pretty(pg_database_size('afct_dev')) as database_size;" "Database Size"

# Table sizes (top 10)
run_query "SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size FROM pg_tables WHERE schemaname NOT IN ('information_schema', 'pg_catalog') ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC LIMIT 10;" "Largest Tables"

# Memory usage
run_query "SELECT name, setting, unit FROM pg_settings WHERE name LIKE '%mem%' AND name IN ('shared_buffers', 'work_mem', 'maintenance_work_mem', 'temp_buffers') ORDER BY name;" "Memory Configuration"

# Performance test
echo "⚡ Performance Test"
echo "$(printf '%.0s-' {1..50})"
echo "Testing database connection speed..."

start_time=$(date +%s%N)
docker exec afct-postgres-1 psql -U afct_user -d afct_dev -c "SELECT 1;" > /dev/null 2>&1
end_time=$(date +%s%N)
duration=$(( (end_time - start_time) / 1000000 ))

echo "✅ Database connection time: ${duration}ms"
echo ""

# Container resource usage
echo "🐳 Container Resource Usage"
echo "$(printf '%.0s-' {1..50})"
docker stats afct-postgres-1 --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}\t{{.BlockIO}}"
echo ""

echo "✅ Performance monitoring complete!"
echo ""
echo "💡 Tips for better performance:"
echo "   - Monitor cache hit ratio (should be >95%)"
echo "   - Keep active connections low for development"
echo "   - Watch for slow queries in application logs"
echo "   - Use EXPLAIN ANALYZE for query optimization"
