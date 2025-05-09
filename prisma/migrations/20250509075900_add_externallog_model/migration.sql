-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "externalCode" TEXT;

-- CreateTable
CREATE TABLE "ExternalLog" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL,
    "description" TEXT,
    "source" TEXT NOT NULL,
    "externalId" TEXT,
    "projectCode" TEXT NOT NULL,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalLog_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ExternalLog" ADD CONSTRAINT "ExternalLog_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalLog" ADD CONSTRAINT "ExternalLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
