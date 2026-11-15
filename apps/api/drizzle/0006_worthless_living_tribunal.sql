DROP INDEX IF EXISTS "invoices_user_booking_kind_idx";--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "payment_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "receipt_snapshot" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_user_booking_invoice_idx" ON "invoices" USING btree ("user_id","booking_id") WHERE "invoices"."kind" = 'invoice';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_user_payment_receipt_idx" ON "invoices" USING btree ("user_id","payment_id") WHERE "invoices"."kind" = 'receipt';