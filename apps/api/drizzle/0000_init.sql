CREATE TYPE "public"."booking_status" AS ENUM('enquiry', 'confirmed', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."expense_category" AS ENUM('materials', 'travel', 'equipment', 'software', 'phone_internet', 'insurance', 'training', 'marketing', 'other');--> statement-breakpoint
CREATE TYPE "public"."expense_status" AS ENUM('needs_review', 'confirmed');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('sent', 'delivered', 'failed');--> statement-breakpoint
CREATE TYPE "public"."message_template" AS ENUM('confirmation', 'reminder', 'payment_request', 'review_request');--> statement-breakpoint
CREATE TYPE "public"."payment_kind" AS ENUM('deposit', 'balance', 'full', 'custom');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('stripe', 'revolut', 'cash', 'bank_transfer');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'paid', 'cancelled');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"service" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone,
	"price_cents" integer NOT NULL,
	"deposit_cents" integer DEFAULT 0 NOT NULL,
	"status" "booking_status" DEFAULT 'enquiry' NOT NULL,
	"location" text,
	"notes" text,
	"gcal_event_id" text,
	"reminder_sent_at" timestamp with time zone,
	"review_requested_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"merchant" text,
	"amount_cents" integer,
	"category" "expense_category",
	"expense_date" timestamp with time zone,
	"receipt_key" text,
	"ocr_raw" jsonb,
	"status" "expense_status" DEFAULT 'needs_review' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "message_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"booking_id" uuid,
	"client_id" uuid,
	"channel" text DEFAULT 'whatsapp' NOT NULL,
	"template" "message_template" NOT NULL,
	"status" "message_status" DEFAULT 'sent' NOT NULL,
	"meta" jsonb,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"kind" "payment_kind" NOT NULL,
	"amount_cents" integer NOT NULL,
	"method" "payment_method",
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"stripe_payment_link_id" text,
	"link_url" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"content_type" text NOT NULL,
	"data_base64" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"business_name" text,
	"phone" text,
	"review_link" text,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bookings" ADD CONSTRAINT "bookings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bookings" ADD CONSTRAINT "bookings_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "clients" ADD CONSTRAINT "clients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "expenses" ADD CONSTRAINT "expenses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message_log" ADD CONSTRAINT "message_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message_log" ADD CONSTRAINT "message_log_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message_log" ADD CONSTRAINT "message_log_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "receipts" ADD CONSTRAINT "receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookings_user_start_idx" ON "bookings" USING btree ("user_id","start_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clients_user_idx" ON "clients" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expenses_user_date_idx" ON "expenses" USING btree ("user_id","expense_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_log_booking_idx" ON "message_log" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_user_status_idx" ON "payments" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "receipts_user_idx" ON "receipts" USING btree ("user_id");