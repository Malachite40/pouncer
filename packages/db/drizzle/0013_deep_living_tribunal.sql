ALTER TABLE "watches" ADD COLUMN "check_queued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "watches" ADD COLUMN "check_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "watches" ADD COLUMN "check_lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "watches" ADD COLUMN "last_check_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "watches" ADD COLUMN "last_check_error_type" text;