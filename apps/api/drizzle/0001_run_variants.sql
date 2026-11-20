CREATE TABLE "run_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
DROP INDEX "attempts_run_item_repeat_uq";--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "variant_id" uuid;--> statement-breakpoint
-- Backfill: every existing run gets one "default" variant carrying the run's config.
INSERT INTO "run_variants" ("run_id", "name", "position", "config") SELECT "id", 'default', 0, "config" FROM "runs";--> statement-breakpoint
UPDATE "attempts" a SET "variant_id" = v."id" FROM "run_variants" v WHERE v."run_id" = a."run_id";--> statement-breakpoint
ALTER TABLE "attempts" ALTER COLUMN "variant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "leased_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "run_variants" ADD CONSTRAINT "run_variants_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "run_variants_run_name_uq" ON "run_variants" USING btree ("run_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "run_variants_run_position_uq" ON "run_variants" USING btree ("run_id","position");--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_variant_id_run_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."run_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attempts_run_item_repeat_variant_uq" ON "attempts" USING btree ("run_id","item_id","repeat_index","variant_id");