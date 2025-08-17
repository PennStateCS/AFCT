#!/usr/bin/env bash
# =============================================================================
# ActivityLog Enhancement Migration Script
# =============================================================================
# This script migrates existing ActivityLog entries to use the new enhanced
# schema with foreign keys and categorization.
# =============================================================================

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() {
  echo -e "${BLUE}[MIGRATION]${NC} $1"
}

success() {
  echo -e "${GREEN}[SUCCESS]${NC} $1"
}

warn() {
  echo -e "${YELLOW}[WARNING]${NC} $1"
}

error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

# Check if we're in the project root
if [[ ! -f "package.json" || ! -d "prisma" ]]; then
  error "Please run this script from the project root directory"
  exit 1
fi

log "Starting ActivityLog Enhancement Migration..."

# Check if the migration has already been applied
if npx prisma db execute --stdin <<< "SELECT category FROM ActivityLog LIMIT 1;" 2>/dev/null; then
  success "Enhanced ActivityLog schema is already applied!"
else
  warn "Enhanced ActivityLog schema not yet applied. Please run migration first:"
  echo "  npx prisma migrate dev --name 'enhance-activity-log-with-foreign-keys'"
  exit 1
fi

# Create a Node.js script to backfill the data
cat > temp_backfill.js << 'EOF'
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function getActivityCategory(action) {
  const upperAction = action.toUpperCase();
  
  if (upperAction.includes('LOGIN') || upperAction.includes('LOGOUT') || upperAction.includes('SESSION')) {
    return 'SYSTEM';
  }
  if (upperAction.includes('USER') || upperAction.includes('PASSWORD') || upperAction.includes('PROFILE')) {
    return 'USER';
  }
  if (upperAction.includes('COURSE') || upperAction.includes('ENROLL')) {
    return 'COURSE';
  }
  if (upperAction.includes('ASSIGNMENT')) {
    return 'ASSIGNMENT';
  }
  if (upperAction.includes('PROBLEM')) {
    return 'PROBLEM';
  }
  if (upperAction.includes('SUBMISSION') || upperAction.includes('GRADE')) {
    return 'SUBMISSION';
  }
  
  return 'SYSTEM';
}

async function main() {
  console.log('Starting ActivityLog backfill migration...');
  
  const logs = await prisma.activityLog.findMany({
    where: {
      OR: [
        { category: null },
        { ipAddress: null }
      ]
    }
  });

  console.log(`Found ${logs.length} logs to update`);
  let updated = 0;

  for (const log of logs) {
    const metadata = log.metadata || {};
    const updates = {};
    
    // Extract IDs from metadata
    if (metadata.courseId && typeof metadata.courseId === 'string') {
      updates.courseId = metadata.courseId;
    }
    if (metadata.assignmentId && typeof metadata.assignmentId === 'string') {
      updates.assignmentId = metadata.assignmentId;
    }
    if (metadata.problemId && typeof metadata.problemId === 'string') {
      updates.problemId = metadata.problemId;
    }
    if (metadata.submissionId && typeof metadata.submissionId === 'string') {
      updates.submissionId = metadata.submissionId;
    }
    if (metadata.ipAddress && typeof metadata.ipAddress === 'string') {
      updates.ipAddress = metadata.ipAddress;
    }
    if (metadata.userAgent && typeof metadata.userAgent === 'string') {
      updates.userAgent = metadata.userAgent;
    }
    
    // Determine category from action
    if (!log.category) {
      updates.category = getActivityCategory(log.action);
    }
    
    if (Object.keys(updates).length > 0) {
      try {
        await prisma.activityLog.update({
          where: { id: log.id },
          data: updates
        });
        updated++;
      } catch (error) {
        console.error(`Failed to update log ${log.id}:`, error.message);
      }
    }
  }

  console.log(`ActivityLog backfill migration completed. Updated ${updated} records.`);
  
  // Show summary
  const summary = await prisma.activityLog.groupBy({
    by: ['category'],
    _count: { category: true }
  });
  
  console.log('\nActivityLog Summary by Category:');
  summary.forEach(item => {
    console.log(`  ${item.category || 'NULL'}: ${item._count.category} records`);
  });
}

main()
  .catch((e) => {
    console.error('Migration failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
EOF

log "Running ActivityLog backfill migration..."
if node temp_backfill.js; then
  success "ActivityLog backfill completed successfully!"
else
  error "ActivityLog backfill failed!"
  rm -f temp_backfill.js
  exit 1
fi

# Clean up
rm -f temp_backfill.js

log "Verifying migration results..."

# Show some statistics
cat > temp_verify.js << 'EOF'
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function verify() {
  const total = await prisma.activityLog.count();
  const withCategory = await prisma.activityLog.count({ where: { category: { not: null } } });
  const withCourse = await prisma.activityLog.count({ where: { courseId: { not: null } } });
  const withAssignment = await prisma.activityLog.count({ where: { assignmentId: { not: null } } });
  const withIP = await prisma.activityLog.count({ where: { ipAddress: { not: null } } });
  
  console.log('ActivityLog Migration Verification:');
  console.log(`  Total records: ${total}`);
  console.log(`  With category: ${withCategory} (${Math.round(withCategory/total*100)}%)`);
  console.log(`  With courseId: ${withCourse} (${Math.round(withCourse/total*100)}%)`);
  console.log(`  With assignmentId: ${withAssignment} (${Math.round(withAssignment/total*100)}%)`);
  console.log(`  With ipAddress: ${withIP} (${Math.round(withIP/total*100)}%)`);
}

verify()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
EOF

node temp_verify.js
rm -f temp_verify.js

success "ActivityLog Enhancement Migration completed successfully!"
echo ""
log "The ActivityLog system now supports:"
echo "  ✅ Fast entity-based filtering (courseId, assignmentId, etc.)"
echo "  ✅ Activity categorization (SYSTEM, COURSE, ASSIGNMENT, etc.)"
echo "  ✅ Extracted IP addresses and user agents"
echo "  ✅ Comprehensive indexing for performance"
echo ""
log "You can now use the enhanced query patterns in your application!"
echo "  See: src/lib/activity-log-utils.ts for helper functions"
