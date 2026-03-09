ALTER TABLE "watches" ADD COLUMN "auto_interval" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "watches" ADD COLUMN "base_check_interval_seconds" integer;