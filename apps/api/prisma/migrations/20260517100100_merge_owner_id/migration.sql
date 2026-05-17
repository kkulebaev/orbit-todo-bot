-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT IF EXISTS "Task_assignedToId_fkey";

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT IF EXISTS "Task_createdById_fkey";

-- DropIndex
DROP INDEX IF EXISTS "Task_status_assignedToId_idx";

-- DropIndex
DROP INDEX IF EXISTS "Task_status_createdById_idx";

-- AlterTable
ALTER TABLE "Task" DROP COLUMN "assignedToId";

-- AlterTable
ALTER TABLE "Task" RENAME COLUMN "createdById" TO "ownerId";

-- CreateIndex
CREATE INDEX "Task_status_ownerId_idx" ON "Task"("status", "ownerId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
