ALTER TABLE "error_events" ADD COLUMN "client_ip" text;--> statement-breakpoint
ALTER TABLE "error_events" ADD COLUMN "client_country" text;--> statement-breakpoint
ALTER TABLE "error_events" ADD COLUMN "client_city" text;--> statement-breakpoint
ALTER TABLE "log_events" ADD COLUMN "client_ip" text;--> statement-breakpoint
ALTER TABLE "log_events" ADD COLUMN "client_country" text;--> statement-breakpoint
ALTER TABLE "log_events" ADD COLUMN "client_city" text;--> statement-breakpoint
ALTER TABLE "metrics" ADD COLUMN "client_ip" text;--> statement-breakpoint
ALTER TABLE "metrics" ADD COLUMN "client_country" text;--> statement-breakpoint
ALTER TABLE "metrics" ADD COLUMN "client_city" text;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "client_ip" text;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "client_country" text;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "client_city" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "client_ip" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "client_country" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "client_city" text;