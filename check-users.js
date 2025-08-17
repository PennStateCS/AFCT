// Quick script to check database users
const { PrismaClient } = require('@prisma/client');

async function checkUsers() {
  const prisma = new PrismaClient();
  
  try {
    const users = await prisma.user.findMany({
      select: {
        email: true,
        firstName: true,
        lastName: true,
        role: true
      }
    });
    
    console.log('Users in database:');
    console.table(users);
    
    if (users.length === 0) {
      console.log('\n❌ No users found! Database needs to be seeded.');
    } else {
      console.log(`\n✅ Found ${users.length} users in database.`);
    }
  } catch (error) {
    console.error('Error checking users:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkUsers();
