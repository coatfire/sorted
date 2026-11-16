ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "travel_metres" integer;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"trip_date" date NOT NULL,
	"destination" text NOT NULL,
	"purpose" text NOT NULL,
	"travel_metres" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trips" ADD CONSTRAINT "trips_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trips_user_date_idx" ON "trips" USING btree ("user_id","trip_date");
--> statement-breakpoint
ALTER TABLE "trips" ENABLE ROW LEVEL SECURITY;
