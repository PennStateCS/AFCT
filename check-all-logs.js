import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkAllLogs() {
  try {
    // Get all logs ordered from oldest to newest
    const allLogs = await prisma.activityLog.findMany({
      orderBy: { timestamp: 'asc' },
      select: {
        id: true,
        userId: true,
        action: true,
        timestamp: true,
        metadata: true,
      },
    });

    console.log(`Total ActivityLog entries: ${allLogs.length}`);
    console.log('\nFirst 10 entries (oldest):');
    console.log('==========================');
    
    allLogs.slice(0, 10).forEach((log, index) => {
      console.log(`${index + 1}. ${log.action} (${log.timestamp.toISOString().split('T')[0]})`);
      console.log(`   Metadata: ${JSON.stringify(log.metadata)}`);
      console.log(`   Is null/undefined: ${log.metadata === null || log.metadata === undefined}`);
      if (log.metadata && typeof log.metadata === 'object') {
        const keys = Object.keys(log.metadata);
        console.log(`   Keys: [${keys.join(', ')}]`);
        console.log(`   Empty object: ${keys.length === 0}`);
      }
      console.log('---');
    });

    // Check for any logs with truly null metadata
    const nullMetadataLogs = allLogs.filter(log => log.metadata === null || log.metadata === undefined);
    console.log(`\nLogs with null/undefined metadata: ${nullMetadataLogs.length}`);
    
    // Check for logs with empty object metadata
    const emptyObjectLogs = allLogs.filter(log => 
      log.metadata && 
      typeof log.metadata === 'object' && 
      Object.keys(log.metadata).length === 0
    );
    console.log(`Logs with empty object metadata: ${emptyObjectLogs.length}`);

    // Summary by action type
    const actionSummary = {};
    allLogs.forEach(log => {
      if (!actionSummary[log.action]) {
        actionSummary[log.action] = { total: 0, withMetadata: 0, sample: null };
      }
      actionSummary[log.action].total++;
      if (log.metadata && typeof log.metadata === 'object' && Object.keys(log.metadata).length > 0) {
        actionSummary[log.action].withMetadata++;
        if (!actionSummary[log.action].sample) {
          actionSummary[log.action].sample = log.metadata;
        }
      }
    });

    console.log('\nAction Summary:');
    console.log('================');
    Object.entries(actionSummary).forEach(([action, stats]) => {
      console.log(`${action}: ${stats.withMetadata}/${stats.total} have metadata`);
      if (stats.sample) {
        console.log(`  Sample: ${JSON.stringify(stats.sample)}`);
      }
    });

  } catch (error) {
    console.error('Error checking logs:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkAllLogs();
