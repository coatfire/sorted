-- Supabase exposes the public schema through its Data API, where the public "anon" role can
-- read any table that has no row level security. Sorted never uses that route: the API connects
-- as the table owner, which RLS doesn't restrict. With RLS on and no policies, nothing else can read.
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "login_tokens" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "login_attempts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "login_codes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "clients" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "bookings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "expenses" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "receipts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "message_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
