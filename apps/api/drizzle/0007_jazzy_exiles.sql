ALTER TABLE "expenses" ADD COLUMN "vat_cents" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "vat_registered" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "vat_rate_bp" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "vat_period_months" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "income_tax_rate_bp" integer;