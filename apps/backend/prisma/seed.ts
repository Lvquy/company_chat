import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';

const prisma = new PrismaClient();

async function main() {
  const department = await prisma.department.upsert({
    where: { code: 'IT' },
    update: {},
    create: {
      name: 'Công nghệ thông tin',
      code: 'IT',
      description: 'Bộ phận kỹ thuật nội bộ',
    },
  });

  const existing = await prisma.user.findUnique({
    where: { username: 'admin' },
  });

  if (!existing) {
    await prisma.user.create({
      data: {
        username: 'admin',
        fullName: 'System Admin',
        passwordHash: createHash('sha256').update('admin123').digest('hex'),
        departments: {
          create: [{ departmentId: department.id }],
        },
      },
    });
  }

  console.log('Seeded admin user: admin / admin123');
}

main()
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
