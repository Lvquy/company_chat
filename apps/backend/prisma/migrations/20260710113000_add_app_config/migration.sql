CREATE TABLE "AppConfig" (
    "id" TEXT NOT NULL,
    "companyName" TEXT NOT NULL DEFAULT 'Company Chat',
    "logoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppConfig_pkey" PRIMARY KEY ("id")
);

INSERT INTO "AppConfig" ("id", "companyName")
VALUES ('default', 'Company Chat')
ON CONFLICT ("id") DO NOTHING;
