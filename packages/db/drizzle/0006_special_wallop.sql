ALTER TABLE "watches" ADD COLUMN "notify_price_drop" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "watches" ADD COLUMN "notify_price_increase" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "watches" DROP COLUMN "notify_price";