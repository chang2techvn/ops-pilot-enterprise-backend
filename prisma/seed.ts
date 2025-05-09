// @ts-ignore - Bỏ qua lỗi TypeScript cho import Prisma
import client from '@prisma/client';
import * as bcrypt from 'bcrypt';

// @ts-ignore - Truy cập PrismaClient động
const PrismaClient = client?.PrismaClient || client;
const prisma = new PrismaClient();

// Import the enums directly since they're generated
enum Role {
  ADMIN = 'ADMIN',
  USER = 'USER'
}

enum OrgRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  MEMBER = 'MEMBER'
}

async function main() {
  console.log('Seeding database...');

  // Clear existing data (optional, comment out if not needed)
  await prisma.taskDependency.deleteMany();
  await prisma.timeLog.deleteMany();
  await prisma.task.deleteMany();
  await prisma.project.deleteMany();
  await prisma.userOrg.deleteMany();
  await prisma.organization.deleteMany();
  await prisma.user.deleteMany();

  // Create admin user
  const adminPassword = await bcrypt.hash('admin123', 10);
  const admin = await prisma.user.create({
    data: {
      email: 'admin@opspilot.com',
      password: adminPassword,
      name: 'System Administrator',
      role: Role.ADMIN
    }
  });
  console.log('Created admin user:', admin.email);

  // Create regular users
  const userPassword = await bcrypt.hash('user123', 10);
  const user1 = await prisma.user.create({
    data: {
      email: 'john@example.com',
      password: userPassword,
      name: 'John Doe',
      role: Role.USER
    }
  });
  console.log('Created user:', user1.email);

  const user2 = await prisma.user.create({
    data: {
      email: 'jane@example.com',
      password: userPassword,
      name: 'Jane Smith',
      role: Role.USER
    }
  });
  console.log('Created user:', user2.email);

  const user3 = await prisma.user.create({
    data: {
      email: 'mike@example.com',
      password: userPassword,
      name: 'Mike Johnson',
      role: Role.USER
    }
  });
  console.log('Created user:', user3.email);

  // Create organizations
  const org1 = await prisma.organization.create({
    data: {
      name: 'Acme Corporation',
      description: 'Leading provider of everything'
    }
  });
  console.log('Created organization:', org1.name);

  const org2 = await prisma.organization.create({
    data: {
      name: 'TechStart Inc',
      description: 'Innovative tech startup'
    }
  });
  console.log('Created organization:', org2.name);

  // Add users to organizations
  await prisma.userOrg.create({
    data: {
      userId: user1.id,
      organizationId: org1.id,
      role: OrgRole.OWNER
    }
  });

  await prisma.userOrg.create({
    data: {
      userId: user2.id,
      organizationId: org1.id,
      role: OrgRole.ADMIN
    }
  });

  await prisma.userOrg.create({
    data: {
      userId: user3.id,
      organizationId: org1.id,
      role: OrgRole.MEMBER
    }
  });

  await prisma.userOrg.create({
    data: {
      userId: user1.id,
      organizationId: org2.id,
      role: OrgRole.MEMBER
    }
  });

  await prisma.userOrg.create({
    data: {
      userId: user2.id,
      organizationId: org2.id,
      role: OrgRole.OWNER
    }
  });

  // Create projects for Acme Corporation
  const project1 = await prisma.project.create({
    data: {
      name: 'Website Redesign',
      description: 'Complete redesign of the company website',
      organizationId: org1.id,
      ownerId: user1.id
    }
  });
  console.log('Created project:', project1.name);

  const project2 = await prisma.project.create({
    data: {
      name: 'Mobile App Development',
      description: 'Develop a mobile app for our customers',
      organizationId: org1.id,
      ownerId: user2.id
    }
  });
  console.log('Created project:', project2.name);

  // Create projects for TechStart Inc
  const project3 = await prisma.project.create({
    data: {
      name: 'Product Launch',
      description: 'Planning and execution of our new product launch',
      organizationId: org2.id,
      ownerId: user2.id
    }
  });
  console.log('Created project:', project3.name);

  // Create tasks for Website Redesign project
  const task1 = await prisma.task.create({
    data: {
      title: 'Design mockups',
      description: 'Create design mockups for the website',
      projectId: project1.id,
      assigneeId: user2.id,
      status: 'TODO',
      priority: 'HIGH'
    }
  });
  console.log('Created task:', task1.title);

  const task2 = await prisma.task.create({
    data: {
      title: 'Front-end development',
      description: 'Implement the front-end based on the mockups',
      projectId: project1.id,
      assigneeId: user3.id,
      status: 'TODO',
      priority: 'MEDIUM'
    }
  });
  console.log('Created task:', task2.title);

  // Create tasks for Mobile App Development project
  const task3 = await prisma.task.create({
    data: {
      title: 'App wireframing',
      description: 'Create wireframes for the mobile app',
      projectId: project2.id,
      assigneeId: user1.id,
      status: 'IN_PROGRESS',
      priority: 'HIGH'
    }
  });
  console.log('Created task:', task3.title);

  // Create task dependencies
  await prisma.taskDependency.create({
    data: {
      taskId: task2.id,
      dependsOnId: task1.id
    }
  });
  console.log('Created task dependency: task2 depends on task1');

  console.log('Database seeding completed!');
}

main()
  .catch((e) => {
    console.error('Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
