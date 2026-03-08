ALTER TABLE "watches" ADD COLUMN "notify_price" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "watches" ADD COLUMN "notify_stock" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "watches" ADD COLUMN "price_threshold" numeric;