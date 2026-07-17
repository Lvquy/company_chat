-- CreateEnum
CREATE TYPE "CallKind" AS ENUM ('AUDIO', 'VIDEO');

-- AlterTable
ALTER TABLE "Call" ADD COLUMN     "kind" "CallKind" NOT NULL DEFAULT 'AUDIO';
