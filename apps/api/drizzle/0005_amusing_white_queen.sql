CREATE TABLE IF NOT EXISTS "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"number" integer NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "invoice_logo" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "invoice_accent" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "invoice_footer" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "vat_number" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoices" ADD CONSTRAINT "invoices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_user_kind_number_idx" ON "invoices" USING btree ("user_id","kind","number");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_user_booking_kind_idx" ON "invoices" USING btree ("user_id","booking_id","kind");