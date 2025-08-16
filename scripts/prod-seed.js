// Production seed script for AFCT Dashboard
// This script creates basic users for production deployment

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting production database seeding...');

  try {
    // Hash password for all users
    const hashedPassword = await bcrypt.hash('password123', 10);

    // Create Admin User
    const admin = await prisma.user.upsert({
      where: { email: 'admin@afct.edu' },
      update: {
        password: hashedPassword, // Update password if user exists
      },
      create: {
        email: 'admin@afct.edu',
        firstName: 'System',
        lastName: 'Administrator',
        password: hashedPassword,
        role: 'ADMIN',
      },
    });
    console.log('✓ Created/updated admin user:', admin.email);

    // Create Faculty User
    const faculty = await prisma.user.upsert({
      where: { email: 'faculty@afct.edu' },
      update: {
        password: hashedPassword,
      },
      create: {
        email: 'faculty@afct.edu',
        firstName: 'Jeffrey',
        lastName: 'Chiampi',
        password: hashedPassword,
        role: 'FACULTY',
      },
    });
    console.log('✓ Created/updated faculty user:', faculty.email);

    // Create Student User
    const student = await prisma.user.upsert({
      where: { email: 'student@afct.edu' },
      update: {
        password: hashedPassword,
      },
      create: {
        email: 'student@afct.edu',
        firstName: 'John',
        lastName: 'Student',
        password: hashedPassword,
        role: 'STUDENT',
      },
    });
    console.log('✓ Created/updated student user:', student.email);

    console.log('\n🎉 Database seeding completed successfully!');
    console.log('\n📋 Default user credentials:');
    console.log('   Admin:   admin@afct.edu   / password123');
    console.log('   Faculty: faculty@afct.edu / password123');
    console.log('   Student: student@afct.edu / password123');
    console.log('\n⚠️  Please change these passwords after first login!');
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    throw error;
  }
}

main()
  .catch((e) => {
    console.error('💥 Fatal error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    console.log('📡 Database connection closed');
  });
