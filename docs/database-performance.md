# Database Performance Optimization Guide

## Overview
This document outlines the PostgreSQL performance optimizations implemented for the AFCT development environment.

## Key Optimizations Implemented

### Memory Configuration
- **shared_buffers**: 256MB (increased from default 128MB)
- **effective_cache_size**: 1GB (tells PostgreSQL about available system memory)
- **work_mem**: 8MB (memory for sorting and hashing operations)
- **maintenance_work_mem**: 128MB (memory for maintenance operations like VACUUM)
- **temp_buffers**: 32MB (temporary table memory)

### Write-Ahead Logging (WAL) Optimizations
- **wal_level**: minimal (reduces WAL overhead for development)
- **fsync**: off ⚠️ (dev only - never use in production)
- **synchronous_commit**: off ⚠️ (dev only - faster commits)
- **full_page_writes**: off ⚠️ (dev only - reduces WAL size)
- **wal_compression**: on (compresses WAL records)
- **wal_buffers**: 16MB (WAL buffer size)
- **min_wal_size**: 1GB (minimum WAL size)
- **max_wal_size**: 4GB (maximum WAL size before checkpoint)

### Checkpoint Configuration
- **checkpoint_completion_target**: 0.9 (spread checkpoints over 90% of interval)
- **checkpoint_timeout**: 30min (longer intervals for development)

### Query Execution Optimizations
- **random_page_cost**: 1.1 (assumes SSD storage)
- **effective_io_concurrency**: 200 (parallel I/O operations)
- **seq_page_cost**: 1.0 (sequential read cost)
- **cpu_tuple_cost**: 0.01 (CPU cost per tuple)
- **cpu_index_tuple_cost**: 0.005 (CPU cost per index tuple)
- **cpu_operator_cost**: 0.0025 (CPU cost per operator)

### Parallel Processing
- **max_worker_processes**: 8 (background worker processes)
- **max_parallel_workers**: 8 (parallel workers for queries)
- **max_parallel_workers_per_gather**: 4 (parallel workers per query node)
- **max_parallel_maintenance_workers**: 4 (parallel maintenance workers)

### Connection Management
- **max_connections**: 50 (reduced from default 100 for development)
- **superuser_reserved_connections**: 3 (reserved superuser connections)
- **tcp_keepalives_idle**: 600 (TCP keepalive settings)
- **tcp_keepalives_interval**: 30
- **tcp_keepalives_count**: 3

### Autovacuum Configuration
- **autovacuum**: on (enabled for automatic maintenance)
- **autovacuum_max_workers**: 2 (reduced workers for development)
- **autovacuum_naptime**: 60s (vacuum interval)

### Background Writer
- **bgwriter_delay**: 50ms (background writer sleep time)
- **bgwriter_lru_maxpages**: 100 (pages written per round)
- **bgwriter_lru_multiplier**: 2.0 (multiplier for next round)

### Logging (Disabled for Performance)
- **log_statement**: none (no statement logging)
- **log_duration**: off (no duration logging)
- **log_lock_waits**: off (no lock wait logging)
- **log_min_duration_statement**: -1 (no slow query logging)

## Performance Features

### tmpfs Mounts
Multiple tmpfs mounts are used for maximum I/O speed:
- `/tmp` - Temporary files (512MB)
- `/var/run/postgresql` - Runtime files (64MB)
- `/dev/shm` - Shared memory (512MB)

### Resource Limits
- **Memory Limit**: 1GB container limit
- **Memory Reservation**: 512MB guaranteed

## ⚠️ IMPORTANT WARNINGS

**DEVELOPMENT ONLY SETTINGS:**
These settings are optimized for development speed and **MUST NOT** be used in production:

- `fsync=off` - Disables forced synchronization (data loss risk)
- `synchronous_commit=off` - Allows asynchronous commits (data loss risk)
- `full_page_writes=off` - Disables full page writes (corruption risk)
- `wal_level=minimal` - Minimal WAL logging (no replication/backup)
- `archive_mode=off` - Disables WAL archiving

## Performance Testing

### Measuring Database Performance

1. **Connection Time Test:**
   ```bash
   docker exec -it afct-dashboard-postgres-1 psql -U afct_user -d afct_dev -c "SELECT 1;" -o /dev/null
   ```

2. **Query Performance Test:**
   ```sql
   EXPLAIN ANALYZE SELECT * FROM "User" LIMIT 100;
   ```

3. **Memory Usage Check:**
   ```sql
   SELECT 
     setting,
     unit,
     short_desc
   FROM pg_settings 
   WHERE name IN ('shared_buffers', 'effective_cache_size', 'work_mem');
   ```

### Expected Performance Improvements
- **Faster Startup**: Reduced database initialization time
- **Quicker Queries**: Optimized memory allocation and query planning
- **Faster Writes**: Reduced synchronization overhead
- **Better Concurrency**: Improved parallel processing

## Troubleshooting

### Common Issues

1. **Out of Memory Errors:**
   - Reduce `shared_buffers` or `work_mem`
   - Check Docker memory limits

2. **Slow Queries:**
   - Check query execution plans with `EXPLAIN ANALYZE`
   - Verify indexes are being used

3. **Connection Issues:**
   - Verify `max_connections` settings
   - Check network configuration

### Performance Monitoring

Monitor performance with these queries:

```sql
-- Active connections
SELECT count(*) FROM pg_stat_activity;

-- Database size
SELECT pg_size_pretty(pg_database_size('afct_dev'));

-- Table sizes
SELECT schemaname,tablename,pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

## Development vs Production

This configuration is specifically tuned for development environments where:
- Data durability is less critical than performance
- Single-user workloads are common
- Fast iteration is prioritized over data safety

For production environments, use the production Docker configuration which includes proper durability settings.
