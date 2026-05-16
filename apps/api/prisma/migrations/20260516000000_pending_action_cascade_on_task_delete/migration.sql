-- DropForeignKey
ALTER TABLE "PendingAction" DROP CONSTRAINT IF EXISTS "PendingAction_taskId_fkey";

-- AddForeignKey
ALTER TABLE "PendingAction" ADD CONSTRAINT "PendingAction_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
