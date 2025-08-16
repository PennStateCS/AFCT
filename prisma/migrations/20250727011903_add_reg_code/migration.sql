/*
  Warnings:

  - A unique constraint covering the columns `[regCode]` on the table `Course` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Course" ADD COLUMN "regCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Course_regCode_key" ON "Course"("regCode");
