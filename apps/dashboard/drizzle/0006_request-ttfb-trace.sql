ALTER TABLE "requests" ADD COLUMN "time_to_first_byte_ms" double precision;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "trace_id" text;