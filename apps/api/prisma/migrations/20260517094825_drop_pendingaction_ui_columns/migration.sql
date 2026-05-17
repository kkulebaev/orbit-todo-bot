/*
  Warnings:

  - You are about to drop the column `panelMessageId` on the `PendingAction` table. All the data in the column will be lost.
  - You are about to drop the column `panelMode` on the `PendingAction` table. All the data in the column will be lost.
  - You are about to drop the column `panelPage` on the `PendingAction` table. All the data in the column will be lost.
  - You are about to drop the column `promptMessageId` on the `PendingAction` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "PendingAction" DROP COLUMN "panelMessageId",
DROP COLUMN "panelMode",
DROP COLUMN "panelPage",
DROP COLUMN "promptMessageId";
