const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

console.log('Available models on prisma client:');
console.log(Object.keys(prisma));

// Close the connection
prisma.$disconnect();
