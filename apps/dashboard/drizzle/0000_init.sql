CREATE TYPE "public"."api_key_kind" AS ENUM('ingest', 'upload');--> statement-breakpoint
CREATE TYPE "public"."error_origin" AS ENUM('js', 'native');--> statement-breakpoint
CREATE TYPE "public"."issue_status" AS ENUM('open', 'resolved', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('ios', 'android');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('ok', 'errored', 'crashed', 'abnormal');--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" "api_key_kind" NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"public_key" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "endpoint_templates" (
	"project_id" uuid NOT NULL,
	"day" text NOT NULL,
	"endpoint" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "error_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"event_id" text NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"session_id" text,
	"installation_id" text NOT NULL,
	"user_id" text,
	"platform" "platform" NOT NULL,
	"os_version" text,
	"device_model" text,
	"app_version" text NOT NULL,
	"app_build" text NOT NULL,
	"update_id" text,
	"runtime_version" text,
	"channel" text,
	"environment" text NOT NULL,
	"issue_id" uuid NOT NULL,
	"origin" "error_origin" NOT NULL,
	"kind" text NOT NULL,
	"fatal" boolean NOT NULL,
	"handled" boolean NOT NULL,
	"type" text NOT NULL,
	"message" text NOT NULL,
	"frames" jsonb NOT NULL,
	"symbolicated_frames" jsonb,
	"raw_stack" text,
	"breadcrumbs" jsonb NOT NULL,
	"route_name" text,
	"tags" jsonb
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"origin" "error_origin" NOT NULL,
	"kind" text NOT NULL,
	"type" text NOT NULL,
	"message" text NOT NULL,
	"culprit" text,
	"status" "issue_status" DEFAULT 'open' NOT NULL,
	"regressed" boolean DEFAULT false NOT NULL,
	"fatal" boolean DEFAULT false NOT NULL,
	"event_count" integer DEFAULT 0 NOT NULL,
	"first_seen" timestamp with time zone NOT NULL,
	"last_seen" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "log_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"event_id" text NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"session_id" text,
	"installation_id" text NOT NULL,
	"user_id" text,
	"platform" "platform" NOT NULL,
	"os_version" text,
	"device_model" text,
	"app_version" text NOT NULL,
	"app_build" text NOT NULL,
	"update_id" text,
	"runtime_version" text,
	"channel" text,
	"environment" text NOT NULL,
	"name" text NOT NULL,
	"severity" text NOT NULL,
	"body" text,
	"display_name" text,
	"attributes" jsonb
);
--> statement-breakpoint
CREATE TABLE "metrics" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"event_id" text NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"session_id" text,
	"installation_id" text NOT NULL,
	"user_id" text,
	"platform" "platform" NOT NULL,
	"os_version" text,
	"device_model" text,
	"app_version" text NOT NULL,
	"app_build" text NOT NULL,
	"update_id" text,
	"runtime_version" text,
	"channel" text,
	"environment" text NOT NULL,
	"name" text NOT NULL,
	"value_ms" double precision NOT NULL,
	"route_name" text,
	"params" jsonb
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"sdk_enabled" boolean DEFAULT true NOT NULL,
	"sample_rate" real DEFAULT 1 NOT NULL,
	"retention_days" integer DEFAULT 30 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"event_id" text NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"session_id" text,
	"installation_id" text NOT NULL,
	"user_id" text,
	"platform" "platform" NOT NULL,
	"os_version" text,
	"device_model" text,
	"app_version" text NOT NULL,
	"app_build" text NOT NULL,
	"update_id" text,
	"runtime_version" text,
	"channel" text,
	"environment" text NOT NULL,
	"method" text NOT NULL,
	"host" text NOT NULL,
	"path" text NOT NULL,
	"status_code" smallint NOT NULL,
	"duration_ms" double precision NOT NULL,
	"bytes_received" integer,
	"bytes_sent" integer,
	"error" text,
	"route_name" text
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"installation_id" text NOT NULL,
	"user_id" text,
	"status" "session_status" DEFAULT 'ok' NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone NOT NULL,
	"platform" "platform" NOT NULL,
	"os_version" text,
	"device_model" text,
	"app_version" text NOT NULL,
	"app_build" text NOT NULL,
	"update_id" text,
	"runtime_version" text,
	"environment" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_maps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"bundle_key" text NOT NULL,
	"file_name" text NOT NULL,
	"content" "bytea" NOT NULL,
	"size_bytes" integer NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" timestamp NOT NULL,
	"metadata" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"active_organization_id" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endpoint_templates" ADD CONSTRAINT "endpoint_templates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_events" ADD CONSTRAINT "error_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_events" ADD CONSTRAINT "error_events_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "log_events" ADD CONSTRAINT "log_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metrics" ADD CONSTRAINT "metrics_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_maps" ADD CONSTRAINT "source_maps_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash_idx" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_project_idx" ON "api_keys" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "endpoint_templates_idx" ON "endpoint_templates" USING btree ("project_id","day","endpoint");--> statement-breakpoint
CREATE UNIQUE INDEX "error_events_project_event_idx" ON "error_events" USING btree ("project_id","event_id");--> statement-breakpoint
CREATE INDEX "error_events_issue_ts_idx" ON "error_events" USING btree ("issue_id","timestamp");--> statement-breakpoint
CREATE INDEX "error_events_project_ts_idx" ON "error_events" USING btree ("project_id","timestamp");--> statement-breakpoint
CREATE INDEX "error_events_session_idx" ON "error_events" USING btree ("project_id","session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "issues_project_fingerprint_idx" ON "issues" USING btree ("project_id","fingerprint");--> statement-breakpoint
CREATE INDEX "issues_project_last_seen_idx" ON "issues" USING btree ("project_id","last_seen");--> statement-breakpoint
CREATE UNIQUE INDEX "log_events_project_event_idx" ON "log_events" USING btree ("project_id","event_id");--> statement-breakpoint
CREATE INDEX "log_events_project_name_ts_idx" ON "log_events" USING btree ("project_id","name","timestamp");--> statement-breakpoint
CREATE INDEX "log_events_session_idx" ON "log_events" USING btree ("project_id","session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "metrics_project_event_idx" ON "metrics" USING btree ("project_id","event_id");--> statement-breakpoint
CREATE INDEX "metrics_project_name_ts_idx" ON "metrics" USING btree ("project_id","name","timestamp");--> statement-breakpoint
CREATE INDEX "metrics_project_route_idx" ON "metrics" USING btree ("project_id","route_name","name","timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_org_slug_idx" ON "projects" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "requests_project_event_idx" ON "requests" USING btree ("project_id","event_id");--> statement-breakpoint
CREATE INDEX "requests_project_ts_idx" ON "requests" USING btree ("project_id","timestamp");--> statement-breakpoint
CREATE INDEX "requests_project_endpoint_idx" ON "requests" USING btree ("project_id","method","host","path");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_project_session_idx" ON "sessions" USING btree ("project_id","session_id");--> statement-breakpoint
CREATE INDEX "sessions_project_started_idx" ON "sessions" USING btree ("project_id","started_at");--> statement-breakpoint
CREATE INDEX "sessions_open_idx" ON "sessions" USING btree ("last_seen_at") WHERE "sessions"."ended_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "source_maps_bundle_idx" ON "source_maps" USING btree ("project_id","platform","bundle_key");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_slug_uidx" ON "organization" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");