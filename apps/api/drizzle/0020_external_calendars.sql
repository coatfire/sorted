CREATE TABLE IF NOT EXISTS "external_calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "external_calendars" ADD CONSTRAINT "external_calendars_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "external_calendars_user_url_idx" ON "external_calendars" USING btree ("user_id","url");
--> statement-breakpoint
-- The links are private. The API connects as the table owner, which RLS doesn't restrict;
-- with no policies, Supabase's public Data API roles can't read this table.
ALTER TABLE "external_calendars" ENABLE ROW LEVEL SECURITY;
