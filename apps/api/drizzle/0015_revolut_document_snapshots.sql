ALTER TABLE "invoices" ADD COLUMN "document_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "revolut_link" text;