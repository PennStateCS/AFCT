# =============================================================================
# ActivityLog Enhancement Migration Script (PowerShell)
# =============================================================================
# This script migrates existing ActivityLog entries to use the new enhanced
# schema with foreign keys and categorization.
# =============================================================================

param(
    [switch]$Verbose
)

# Colors
$Red = "`e[31m"
$Green = "`e[32m"
$Yellow = "`e[33m"
$Blue = "`e[34m"
$NC = "`e[0m"

function Write-Log {
    param([string]$Message)
    Write-Host "${Blue}[MIGRATION]${NC} $Message"
}

function Write-Success {
    param([string]$Message)
    Write-Host "${Green}[SUCCESS]${NC} $Message"
}

function Write-Warning {
    param([string]$Message)
    Write-Host "${Yellow}[WARNING]${NC} $Message"
}

function Write-Error {
    param([string]$Message)
    Write-Host "${Red}[ERROR]${NC} $Message"
}

# Check if we're in the project root
if (-not (Test-Path "package.json") -or -not (Test-Path "prisma")) {
    Write-Error "Please run this script from the project root directory"
    exit 1
}

Write-Log "Starting ActivityLog Enhancement Migration..."

# Check if the migration has already been applied
try {
    $null = npx prisma db execute --stdin --input "SELECT category FROM ActivityLog LIMIT 1;" 2>$null
    Write-Success "Enhanced ActivityLog schema is already applied!"
} catch {
    Write-Warning "Enhanced ActivityLog schema not yet applied. Please run migration first:"
    Write-Host "  npx prisma migrate dev --name 'enhance-activity-log-with-foreign-keys'"
    exit 1
}

# Create a Node.js script to backfill the data
$backfillScript = @'
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
'@

$backfillScript | Out-File -FilePath "temp_backfill.js" -Encoding UTF8

Write-Log "Running ActivityLog backfill migration..."
try {
    node temp_backfill.js
    Write-Success "ActivityLog backfill completed successfully!"
} catch {
    Write-Error "ActivityLog backfill failed!"
    Remove-Item "temp_backfill.js" -ErrorAction SilentlyContinue
    exit 1
}

# Clean up
Remove-Item "temp_backfill.js" -ErrorAction SilentlyContinue

Write-Log "Verifying migration results..."

# Show some statistics
$verifyScript = @'
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
'@

$verifyScript | Out-File -FilePath "temp_verify.js" -Encoding UTF8
node temp_verify.js
Remove-Item "temp_verify.js" -ErrorAction SilentlyContinue

Write-Success "ActivityLog Enhancement Migration completed successfully!"
Write-Host ""
Write-Log "The ActivityLog system now supports:"
Write-Host "  ✅ Fast entity-based filtering (courseId, assignmentId, etc.)"
Write-Host "  ✅ Activity categorization (SYSTEM, COURSE, ASSIGNMENT, etc.)"
Write-Host "  ✅ Extracted IP addresses and user agents"
Write-Host "  ✅ Comprehensive indexing for performance"
Write-Host ""
Write-Log "You can now use the enhanced query patterns in your application!"
Write-Host "  See: src/lib/activity-log-utils.ts for helper functions"
