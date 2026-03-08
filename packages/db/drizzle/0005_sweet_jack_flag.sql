ALTER TABLE "watches" ADD COLUMN "price_drop_threshold" numeric;--> statement-breakpoint
ALTER TABLE "watches" ADD COLUMN "price_drop_percent_threshold" numeric;--> statement-breakpoint
ALTER TABLE "watches" ADD COLUMN "price_drop_target_price" numeric;--> statement-breakpoint
ALTER TABLE "watches" ADD COLUMN "price_increase_threshold" numeric;--> statement-breakpoint
ALTER TABLE "watches" ADD COLUMN "price_increase_percent_threshold" numeric;--> statement-breakpoint
ALTER TABLE "watches" ADD COLUMN "price_increase_target_price" numeric;--> statement-breakpoint
ALTER TABLE "watches" ADD COLUMN "notify_cooldown_seconds" integer;--> statement-breakpoint
ALTER TABLE "watches" ADD COLUMN "last_notified_at" timestamp with time zone;--> statement-breakpoint
UPDATE "watches" SET "price_drop_threshold" = "price_threshold" WHERE "price_threshold" IS NOT NULL;