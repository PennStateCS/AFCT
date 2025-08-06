import { prisma } from '@/lib/prisma';
import fs from 'fs';

async function exportUsers() {
  try {
    const users = await prisma.user.findMany();
    fs.writeFileSync('users_backup.json', JSON.stringify(users, null, 2));
    console.log(`Exported ${users.length} users to users_backup.json`);
  } catch (err) {
    console.error('Error exporting users:', err);
  } finally {
    await prisma.$disconnect();
  }
}

exportUsers();
