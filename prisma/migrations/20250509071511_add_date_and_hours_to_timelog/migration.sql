/*
  Warnings:

  - Added the required column `date` to the `TimeLog` table without a default value. This is not possible if the table is not empty.
  - Added the required column `hours` to the `TimeLog` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "TimeLog" ADD COLUMN     "date" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "hours" DOUBLE PRECISION NOT NULL;
