ALTER TABLE "error_events" ADD COLUMN "device_brand" text;--> statement-breakpoint
ALTER TABLE "error_events" ADD COLUMN "device_locale" text;--> statement-breakpoint
ALTER TABLE "error_events" ADD COLUMN "is_emulator" boolean;--> statement-breakpoint
ALTER TABLE "log_events" ADD COLUMN "device_brand" text;--> statement-breakpoint
ALTER TABLE "log_events" ADD COLUMN "device_locale" text;--> statement-breakpoint
ALTER TABLE "log_events" ADD COLUMN "is_emulator" boolean;--> statement-breakpoint
ALTER TABLE "metrics" ADD COLUMN "device_brand" text;--> statement-breakpoint
ALTER TABLE "metrics" ADD COLUMN "device_locale" text;--> statement-breakpoint
ALTER TABLE "metrics" ADD COLUMN "is_emulator" boolean;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "device_brand" text;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "device_locale" text;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "is_emulator" boolean;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "device_brand" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "device_locale" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "is_emulator" boolean;