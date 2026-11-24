CREATE TYPE "public"."alert_metric" AS ENUM('crash_free_rate', 'api_error_rate', 'startup_p75');--> statement-breakpoint
CREATE TYPE "public"."alert_window" AS ENUM('1h', '6h', '24h');--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"metric" "alert_metric" NOT NULL,
	"window" "alert_window" NOT NULL,
	"threshold" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_status" text,
	"last_fired_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_rules_project_idx" ON "alert_rules" USING btree ("project_id");