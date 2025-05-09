/*
  Warnings:

  - You are about to drop the column `projectId` on the `Task` table. All the data in the column will be lost.
  - Added the required column `workflowId` to the `Task` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
ALTER TYPE "OrgRole" ADD VALUE 'PROJECT_MANAGER';

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'PROJECT_MANAGER';

-- AlterEnum
ALTER TYPE "TaskStatus" ADD VALUE 'COMPLETED';

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_projectId_fkey";

-- CreateTable
CREATE TABLE "Workflow" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "projectId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "status" "Status" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workflow_pkey" PRIMARY KEY ("id")
);

-- Create default workflows for existing projects
INSERT INTO "Workflow" ("id", "name", "description", "projectId", "ownerId", "order", "status", "createdAt", "updatedAt")
SELECT 
    gen_random_uuid(), 
    p."name" || ' Default Workflow', 
    'Default workflow created during migration', 
    p."id", 
    p."ownerId", 
    0, 
    'ACTIVE', 
    CURRENT_TIMESTAMP, 
    CURRENT_TIMESTAMP
FROM "Project" p;

-- Add workflowId column without constraints first
ALTER TABLE "Task" ADD COLUMN "order" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Task" ADD COLUMN "workflowId" TEXT;

-- Update existing tasks to point to the default workflows
UPDATE "Task" t
SET "workflowId" = (
    SELECT w."id" 
    FROM "Workflow" w 
    WHERE w."projectId" = t."projectId" 
    LIMIT 1
);

-- Now make workflowId NOT NULL after it has values
ALTER TABLE "Task" ALTER COLUMN "workflowId" SET NOT NULL;

-- Finally drop the projectId column
ALTER TABLE "Task" DROP COLUMN "projectId";

-- AddForeignKey
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
