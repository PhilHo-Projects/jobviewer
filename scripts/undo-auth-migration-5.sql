-- Rollback for migration 5 (server/migrations.ts), which dropped account.issuer.
-- Only needed to run better-auth 1.7.0-1.7.2 again. Stop the container, run this against
-- jobviewer.db, then build and deploy the commit that pins better-auth 1.7.1.
-- Every account 1.7.1 wrote was local, with issuer = 'local:' || providerId.
BEGIN;
ALTER TABLE "account" ADD COLUMN "issuer" text;
UPDATE "account" SET "issuer" = 'local:' || "providerId";
CREATE UNIQUE INDEX "account_issuer_accountId_uidx" ON "account" ("issuer", "accountId");
DELETE FROM schema_migrations WHERE version = 5;
COMMIT;
