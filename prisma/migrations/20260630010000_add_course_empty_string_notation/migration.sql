-- CreateEnum
CREATE TYPE "public"."EmptyStringNotation" AS ENUM ('EPSILON', 'LAMBDA');

-- AlterTable
ALTER TABLE "public"."Course" ADD COLUMN     "emptyStringNotation" "public"."EmptyStringNotation" NOT NULL DEFAULT 'EPSILON';
