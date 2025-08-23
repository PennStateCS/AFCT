const { PrismaClient } = require('./node_modules/@prisma/client-postgres');

async function testData() {
  const client = new PrismaClient();
  try {
    const userCount = await client.user.count();
    const courseCount = await client.course.count();
    const activityLogCount = await client.activityLog.count();
    
    console.log('PostgreSQL Data Verification:');
    console.log('Users:', userCount);
    console.log('Courses:', courseCount);
    console.log('Activity logs:', activityLogCount);
    console.log('✅ Migration verification successful!');
  } catch (error) {
    console.error('❌ Error verifying data:', error);
  } finally {
    await client.$disconnect();
  }
}

testData();
