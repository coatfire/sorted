ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "import_offer_closed_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "users" SET "import_offer_closed_at" = now() WHERE "import_offer_closed_at" IS NULL AND EXISTS (SELECT 1 FROM "imports" WHERE "imports"."user_id" = "users"."id");
