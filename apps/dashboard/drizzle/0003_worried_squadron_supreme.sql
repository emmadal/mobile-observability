CREATE TABLE "workspace_claim" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"email" text NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_claim_singleton" CHECK ("workspace_claim"."id" = 1)
);
