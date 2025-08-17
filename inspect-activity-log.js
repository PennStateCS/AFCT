import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function inspectActivityLogs() {
  try {
    console.log('Fetching ActivityLog entries...');
    
    const logs = await prisma.activityLog.findMany({
      take: 50,
      orderBy: { timestamp: 'desc' },
      select: {
        id: true,
        userId: true,
        action: true,
        timestamp: true,
        metadata: true,
      },
    });

    console.log(`Found ${logs.length} logs:`);
    console.log('==========================================');
    
    logs.forEach((log, index) => {
      console.log(`${index + 1}. ID: ${log.id}`);
      console.log(`   User ID: ${log.userId || 'null'}`);
      console.log(`   Action: ${log.action}`);
      console.log(`   Timestamp: ${log.timestamp}`);
      console.log(`   Metadata: ${JSON.stringify(log.metadata, null, 2)}`);
      console.log(`   Metadata is null/undefined: ${log.metadata === null || log.metadata === undefined}`);
      console.log('------------------------------------------');
    });

    // Check for empty metadata specifically
    const totalLogs = await prisma.activityLog.count();
    console.log(`\nTotal logs in database: ${totalLogs}`);
    
    // Look for logs with potentially incomplete metadata
    const logsWithoutIP = await prisma.activityLog.findMany({
      where: {
        NOT: {
          metadata: {
            path: ['ipAddress'],
            not: null
          }
        }
      },
      take: 10,
      select: {
        id: true,
        action: true,
        metadata: true,
        timestamp: true
      }
    });
    
    console.log(`\nLogs without ipAddress in metadata (${logsWithoutIP.length}):`);
    logsWithoutIP.forEach(log => {
      console.log(`- ${log.action}: ${JSON.stringify(log.metadata)}`);
    });

    // Check for specific actions that might have empty metadata
    const actionStats = await prisma.activityLog.groupBy({
      by: ['action'],
      _count: {
        id: true,
      },
      orderBy: {
        _count: {
          id: 'desc'
        }
      }
    });

    console.log('\nAction statistics:');
    actionStats.forEach(stat => {
      console.log(`${stat.action}: ${stat._count.id} entries`);
    });

  } catch (error) {
    console.error('Error inspecting ActivityLog:', error);
  } finally {
    await prisma.$disconnect();
  }
}

inspectActivityLogs();
