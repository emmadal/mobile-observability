ALTER TABLE "requests" ADD COLUMN "error_message" text;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "response_body" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "user_phone" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "user_segment" text;--> statement-breakpoint
-- Sessions stayed anonymous when the app identified its user after the session
-- started: link each to the latest user its requests, events, metrics or errors carried.
UPDATE "sessions" AS s SET "user_id" = seen.user_id
FROM (
  SELECT DISTINCT ON (project_id, session_id) project_id, session_id, user_id
  FROM (
    SELECT project_id, session_id, user_id, "timestamp" FROM "requests"
      WHERE user_id IS NOT NULL AND session_id IS NOT NULL
    UNION ALL
    SELECT project_id, session_id, user_id, "timestamp" FROM "log_events"
      WHERE user_id IS NOT NULL AND session_id IS NOT NULL
    UNION ALL
    SELECT project_id, session_id, user_id, "timestamp" FROM "metrics"
      WHERE user_id IS NOT NULL AND session_id IS NOT NULL
    UNION ALL
    SELECT project_id, session_id, user_id, "timestamp" FROM "error_events"
      WHERE user_id IS NOT NULL AND session_id IS NOT NULL
  ) AS tagged
  ORDER BY project_id, session_id, "timestamp" DESC
) AS seen
WHERE s.project_id = seen.project_id AND s.session_id = seen.session_id AND s.user_id IS NULL;--> statement-breakpoint
-- Ids shaped "segment:rest" (e.g. "kyc:231770000001") give their segment.
UPDATE "sessions"
SET "user_segment" = lower(substring("user_id" from '^([A-Za-z][A-Za-z0-9_-]{0,31}):.'))
WHERE "user_segment" IS NULL AND "user_id" ~ '^[A-Za-z][A-Za-z0-9_-]{0,31}:.';
