CREATE TYPE "public"."provider" AS ENUM('jikan', 'mal', 'manual');--> statement-breakpoint
CREATE TYPE "public"."release_status" AS ENUM('finished', 'airing', 'not_yet_aired', 'cancelled', 'hiatus', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."track" AS ENUM('movie', 'ova', 'special', 'spinoff', 'side_story', 'recap', 'alternative', 'other');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('member', 'admin');--> statement-breakpoint
CREATE TYPE "public"."user_tier" AS ENUM('free', 'plus');--> statement-breakpoint
CREATE TYPE "public"."watch_state" AS ENUM('planned', 'watching', 'completed', 'on_hold', 'dropped');--> statement-breakpoint
CREATE TYPE "public"."work_kind" AS ENUM('tv', 'ona', 'movie', 'ova', 'special', 'music', 'unknown');--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'member' NOT NULL,
	"tier" "user_tier" DEFAULT 'free' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applied_op" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"client" text DEFAULT 'web' NOT NULL,
	"device_label" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "episode" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text,
	"air_date" date,
	"is_filler" boolean,
	"is_recap" boolean
);
--> statement-breakpoint
CREATE TABLE "provider_cache" (
	"url" text PRIMARY KEY NOT NULL,
	"body" jsonb NOT NULL,
	"status" integer NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"root_work_id" uuid NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"ambiguous" boolean DEFAULT false NOT NULL,
	"diagnostics" jsonb,
	"graph_version" integer DEFAULT 1 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "series_member" (
	"series_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"spine_ord" integer,
	"track" "track",
	"via" text,
	CONSTRAINT "series_member_series_id_work_id_pk" PRIMARY KEY("series_id","work_id")
);
--> statement-breakpoint
CREATE TABLE "user_notification" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" bigint NOT NULL,
	"seen_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_work" (
	"user_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"status" "watch_state" DEFAULT 'planned' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"rewatching" boolean DEFAULT false NOT NULL,
	"rewatch_count" integer DEFAULT 0 NOT NULL,
	"rating" smallint,
	"notes" text,
	"favorite" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_watched_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_seq" bigint DEFAULT nextval('change_seq') NOT NULL,
	CONSTRAINT "user_work_user_id_work_id_pk" PRIMARY KEY("user_id","work_id")
);
--> statement-breakpoint
CREATE TABLE "watch_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"pass_no" integer NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"device_id" text
);
--> statement-breakpoint
CREATE TABLE "work" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "provider" NOT NULL,
	"provider_id" text NOT NULL,
	"kind" "work_kind" DEFAULT 'unknown' NOT NULL,
	"title_romaji" text NOT NULL,
	"title_english" text,
	"title_native" text,
	"synonyms" text[] DEFAULT '{}'::text[] NOT NULL,
	"synopsis" text,
	"cover_url" text,
	"banner_url" text,
	"accent_hex" text,
	"episode_count" integer,
	"duration_min" integer,
	"release_status" "release_status" DEFAULT 'unknown' NOT NULL,
	"start_date" date,
	"end_date" date,
	"season_year" integer,
	"broadcast_dow" smallint,
	"broadcast_time" time,
	"broadcast_tz" text,
	"genres" text[] DEFAULT '{}'::text[] NOT NULL,
	"studios" text[] DEFAULT '{}'::text[] NOT NULL,
	"score" text,
	"popularity" integer,
	"raw" jsonb,
	"content_hash" text,
	"last_synced_at" timestamp with time zone,
	"next_sync_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sync_failures" smallint DEFAULT 0 NOT NULL,
	"relations_hydrated" boolean DEFAULT false NOT NULL,
	"episodes_hydrated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"type" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_relation" (
	"from_work_id" uuid NOT NULL,
	"to_work_id" uuid NOT NULL,
	"kind" text NOT NULL,
	CONSTRAINT "work_relation_from_work_id_to_work_id_kind_pk" PRIMARY KEY("from_work_id","to_work_id","kind")
);
--> statement-breakpoint
ALTER TABLE "applied_op" ADD CONSTRAINT "applied_op_user_id_account_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_account_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode" ADD CONSTRAINT "episode_work_id_work_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."work"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_root_work_id_work_id_fk" FOREIGN KEY ("root_work_id") REFERENCES "public"."work"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_member" ADD CONSTRAINT "series_member_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_member" ADD CONSTRAINT "series_member_work_id_work_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."work"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notification" ADD CONSTRAINT "user_notification_user_id_account_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notification" ADD CONSTRAINT "user_notification_event_id_work_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."work_event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_work" ADD CONSTRAINT "user_work_user_id_account_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_work" ADD CONSTRAINT "user_work_work_id_work_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."work"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_session" ADD CONSTRAINT "watch_session_user_id_account_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_session" ADD CONSTRAINT "watch_session_work_id_work_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."work"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_event" ADD CONSTRAINT "work_event_work_id_work_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."work"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_relation" ADD CONSTRAINT "work_relation_from_work_id_work_id_fk" FOREIGN KEY ("from_work_id") REFERENCES "public"."work"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_relation" ADD CONSTRAINT "work_relation_to_work_id_work_id_fk" FOREIGN KEY ("to_work_id") REFERENCES "public"."work"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_email_uq" ON "account" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "applied_op_user_idx" ON "applied_op" USING btree ("user_id","applied_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_token_uq" ON "auth_session" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_family_idx" ON "auth_session" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "auth_user_idx" ON "auth_session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "episode_uq" ON "episode" USING btree ("work_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "series_slug_uq" ON "series" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "member_work_idx" ON "series_member" USING btree ("work_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_uq" ON "user_notification" USING btree ("user_id","event_id");--> statement-breakpoint
CREATE INDEX "notification_user_idx" ON "user_notification" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "user_work_cursor_idx" ON "user_work" USING btree ("user_id","updated_seq");--> statement-breakpoint
CREATE INDEX "user_work_status_idx" ON "user_work" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "session_pass_uq" ON "watch_session" USING btree ("user_id","work_id","pass_no");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "watch_session" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "work_provider_uq" ON "work" USING btree ("provider","provider_id");--> statement-breakpoint
CREATE INDEX "work_due_idx" ON "work" USING btree ("next_sync_at");--> statement-breakpoint
CREATE INDEX "work_status_idx" ON "work" USING btree ("release_status");--> statement-breakpoint
CREATE INDEX "event_work_idx" ON "work_event" USING btree ("work_id","detected_at");--> statement-breakpoint
CREATE INDEX "rel_to_idx" ON "work_relation" USING btree ("to_work_id");