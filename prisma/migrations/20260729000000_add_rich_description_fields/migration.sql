-- CreateEnum
CREATE TYPE "DescriptionFormat" AS ENUM ('PLAIN_TEXT', 'TIPTAP_JSON');

-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "descriptionFormat" "DescriptionFormat" NOT NULL DEFAULT 'PLAIN_TEXT',
ADD COLUMN     "descriptionJson" JSONB;

-- AlterTable
ALTER TABLE "Problem" ADD COLUMN     "descriptionFormat" "DescriptionFormat" NOT NULL DEFAULT 'PLAIN_TEXT',
ADD COLUMN     "descriptionJson" JSONB;
