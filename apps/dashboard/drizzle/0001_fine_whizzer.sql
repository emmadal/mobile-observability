DROP INDEX "issues_project_last_seen_idx";--> statement-breakpoint
DROP INDEX "error_events_issue_ts_idx";--> statement-breakpoint
DROP INDEX "sessions_project_started_idx";--> statement-breakpoint
CREATE INDEX "issues_project_status_last_seen_idx" ON "issues" USING btree ("project_id","status","last_seen","id");--> statement-breakpoint
CREATE INDEX "error_events_issue_ts_idx" ON "error_events" USING btree ("issue_id","timestamp","id");--> statement-breakpoint
CREATE INDEX "sessions_project_started_idx" ON "sessions" USING btree ("project_id","started_at","id");