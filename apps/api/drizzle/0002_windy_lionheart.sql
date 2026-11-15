CREATE TABLE IF NOT EXISTS "login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "login_tokens" ADD COLUMN "purpose" text DEFAULT 'verify' NOT NULL;--> statement-breakpoint
ALTER TABLE "login_tokens" ADD COLUMN "pending_password_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "iban" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "bic" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "login_attempts_email_idx" ON "login_attempts" USING btree ("email");