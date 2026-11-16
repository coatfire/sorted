ALTER TABLE "bookings" ALTER COLUMN "start_at" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "time_tbc" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "price_cents" DROP NOT NULL;
