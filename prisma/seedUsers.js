import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function main() {
  const filePath = path.join(process.cwd(), 'prisma', 'users_backup.json');
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  console.log(`Inserting ${data.length} users with raw SQL...`);

  for (const user of data) {
    const query = `
    INSERT INTO "User" (
      id, email, "firstName", "lastName", password, role, avatar, inactive, "createdAt", "updatedAt"
    ) VALUES (
      '${user.id}',
      '${user.email}',
      ${user.firstName ? `'${user.firstName}'` : 'NULL'},
      ${user.lastName ? `'${user.lastName}'` : 'NULL'},
      '${user.password}',
      '${user.role}',
      ${user.avatar ? `'${user.avatar}'` : 'NULL'},
      ${user.inactive ? 1 : 0},
      '${user.createdAt}',
      '${user.updatedAt}'
    )
    ON CONFLICT(id) DO NOTHING;
  `;

    await prisma.$executeRawUnsafe(query);
    console.log(`Inserted user: ${user.email}`);
  }

  console.log('All users inserted.');
}

main()
  .catch((e) => {
    console.error('Error inserting users:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
