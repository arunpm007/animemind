import {
  bigint,
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/* ────────────────────────────── enums ────────────────────────────── */

export const providerEnum = pgEnum('provider', ['jikan', 'mal', 'manual', 'kitsu']);
export const workKindEnum = pgEnum('work_kind', [
  'tv',
  'ona',
  'movie',
  'ova',
  'special',
  'music',
  'unknown',
]);
export const releaseStatusEnum = pgEnum('release_status', [
  'finished',
  'airing',
  'not_yet_aired',
  'cancelled',
  'hiatus',
  'unknown',
]);
export const trackEnum = pgEnum('track', [
  'movie',
  'ova',
  'special',
  'spinoff',
  'side_story',
  'recap',
  'alternative',
  'other',
]);
export const watchStateEnum = pgEnum('watch_state', [
  'planned',
  'watching',
  'completed',
  'on_hold',
  'dropped',
]);
export const userRoleEnum = pgEnum('user_role', ['member', 'admin']);
export const userTierEnum = pgEnum('user_tier', ['free', 'plus']);

/* ──────────────────────────── catalog ─────────────────────────────
 * Provider-derived, shared by every user, no row-level security.
 * ------------------------------------------------------------------ */

export const work = pgTable(
  'work',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: providerEnum('provider').notNull(),
    providerId: text('provider_id').notNull(),

    kind: workKindEnum('kind').notNull().default('unknown'),
    titleRomaji: text('title_romaji').notNull(),
    titleEnglish: text('title_english'),
    titleNative: text('title_native'),
    synonyms: text('synonyms').array().notNull().default(sql`'{}'::text[]`),
    synopsis: text('synopsis'),

    coverUrl: text('cover_url'),
    bannerUrl: text('banner_url'),
    /** Dominant colour sampled from the cover; drives per-page lighting. */
    accentHex: text('accent_hex'),

    /** NULL means unknown or still running — never conflate with 0. */
    episodeCount: integer('episode_count'),
    durationMin: integer('duration_min'),

    releaseStatus: releaseStatusEnum('release_status').notNull().default('unknown'),
    startDate: date('start_date'),
    endDate: date('end_date'),
    seasonYear: integer('season_year'),
    broadcastDow: smallint('broadcast_dow'),
    broadcastTime: time('broadcast_time'),
    broadcastTz: text('broadcast_tz'),

    genres: text('genres').array().notNull().default(sql`'{}'::text[]`),
    studios: text('studios').array().notNull().default(sql`'{}'::text[]`),
    score: text('score'),
    popularity: integer('popularity'),

    raw: jsonb('raw'),
    /** Hash over only the fields we watch for change. See sync/changes.ts. */
    contentHash: text('content_hash'),

    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    nextSyncAt: timestamp('next_sync_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    syncFailures: smallint('sync_failures').notNull().default(0),
    /** True once the relation neighbourhood has been walked. */
    relationsHydrated: boolean('relations_hydrated').notNull().default(false),
    episodesHydrated: boolean('episodes_hydrated').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('work_provider_uq').on(t.provider, t.providerId),
    index('work_due_idx').on(t.nextSyncAt),
    index('work_status_idx').on(t.releaseStatus),
  ],
);

export const workRelation = pgTable(
  'work_relation',
  {
    fromWorkId: uuid('from_work_id')
      .notNull()
      .references(() => work.id, { onDelete: 'cascade' }),
    toWorkId: uuid('to_work_id')
      .notNull()
      .references(() => work.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.fromWorkId, t.toWorkId, t.kind] }),
    index('rel_to_idx').on(t.toWorkId),
  ],
);

/**
 * A derived grouping. Recomputed by the series builder, never written by hand.
 * `graphVersion` lets a change to the algorithm invalidate every cached series
 * without a migration.
 */
export const series = pgTable(
  'series',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rootWorkId: uuid('root_work_id')
      .notNull()
      .references(() => work.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    /** Mirrors SeriesDiagnostics.ambiguous — the UI must not claim one order. */
    ambiguous: boolean('ambiguous').notNull().default(false),
    diagnostics: jsonb('diagnostics'),
    graphVersion: integer('graph_version').notNull().default(1),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('series_slug_uq').on(t.slug)],
);

export const seriesMember = pgTable(
  'series_member',
  {
    seriesId: uuid('series_id')
      .notNull()
      .references(() => series.id, { onDelete: 'cascade' }),
    workId: uuid('work_id')
      .notNull()
      .references(() => work.id, { onDelete: 'cascade' }),
    /** Non-null means it sits on the main story line, 1-based. */
    spineOrd: integer('spine_ord'),
    track: trackEnum('track'),
    via: text('via'),
  },
  (t) => [
    primaryKey({ columns: [t.seriesId, t.workId] }),
    index('member_work_idx').on(t.workId),
  ],
);

export const episode = pgTable(
  'episode',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workId: uuid('work_id')
      .notNull()
      .references(() => work.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    title: text('title'),
    airDate: date('air_date'),
    /** NULL = unknown. Never render "canon" from a null. */
    isFiller: boolean('is_filler'),
    isRecap: boolean('is_recap'),
  },
  (t) => [uniqueIndex('episode_uq').on(t.workId, t.number)],
);

/**
 * Cross-provider identity.
 *
 * The same anime exists under a different id at every provider, so without
 * this the catalog holds one row per provider per title. A library seeded from
 * one provider then shows "Add" for a title the user has already finished,
 * because the ids never meet — the worst answer this product can give.
 *
 * The primary key is (site, external_id), NOT (work_id, site): it is a global
 * claim. Two works cannot both say they are MyAnimeList 16498, and an attempt
 * to do so raises a conflict that ingestion resolves by merging them.
 */
export const workExternalId = pgTable(
  'work_external_id',
  {
    site: text('site').notNull(),
    externalId: text('external_id').notNull(),
    workId: uuid('work_id')
      .notNull()
      .references(() => work.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.site, t.externalId] }),
    index('external_work_idx').on(t.workId),
  ],
);

/** Raw provider responses, so development and retries cost no rate budget. */
export const providerCache = pgTable('provider_cache', {
  url: text('url').primaryKey(),
  body: jsonb('body').notNull(),
  status: integer('status').notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ───────────────────────── user-owned data ────────────────────────
 * Every table here is protected by row-level security. See 0001_rls.sql.
 * ------------------------------------------------------------------ */

export const account = pgTable(
  'account',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    displayName: text('display_name'),
    passwordHash: text('password_hash').notNull(),
    role: userRoleEnum('role').notNull().default('member'),
    tier: userTierEnum('tier').notNull().default('free'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('account_email_uq').on(sql`lower(${t.email})`)],
);

/**
 * Refresh-token family for rotating sessions. One row per issued refresh
 * token; reuse of a revoked token revokes the whole family (theft detection).
 * Works identically for web cookies and a mobile keychain.
 */
export const authSession = pgTable(
  'auth_session',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => account.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    /** 'web' | 'ios' | 'android' | 'cli' — for a device list later. */
    client: text('client').notNull().default('web'),
    deviceLabel: text('device_label'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('auth_token_uq').on(t.tokenHash),
    index('auth_family_idx').on(t.familyId),
    index('auth_user_idx').on(t.userId),
  ],
);

export const userWork = pgTable(
  'user_work',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => account.id, { onDelete: 'cascade' }),
    workId: uuid('work_id')
      .notNull()
      .references(() => work.id, { onDelete: 'cascade' }),

    status: watchStateEnum('status').notNull().default('planned'),
    /** Episodes watched on the CURRENT pass. Resets when a rewatch starts. */
    progress: integer('progress').notNull().default(0),
    /** A rewatch in flight. Status stays `completed` so stats never dip. */
    rewatching: boolean('rewatching').notNull().default(false),
    /** Completed passes AFTER the first. Derived from watch_session. */
    rewatchCount: integer('rewatch_count').notNull().default(0),

    rating: smallint('rating'),
    notes: text('notes'),
    favorite: boolean('favorite').notNull().default(false),

    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    lastWatchedAt: timestamp('last_watched_at', { withTimezone: true }),

    /** Tombstone. Sync needs deletes to be observable, so rows are never gone. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Global monotonic cursor, assigned by trigger. THIS is the sync protocol —
     * never use timestamps, client clocks drift and rows get silently skipped.
     */
    updatedSeq: bigint('updated_seq', { mode: 'number' })
      .notNull()
      .default(sql`nextval('change_seq')`),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.workId] }),
    index('user_work_cursor_idx').on(t.userId, t.updatedSeq),
    index('user_work_status_idx').on(t.userId, t.status),
  ],
);

/** Append-only. The source of truth for rewatch counts and the activity feed. */
export const watchSession = pgTable(
  'watch_session',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => account.id, { onDelete: 'cascade' }),
    workId: uuid('work_id')
      .notNull()
      .references(() => work.id, { onDelete: 'cascade' }),
    /** 1 = first watch, 2+ = rewatch. */
    passNo: integer('pass_no').notNull(),
    progress: integer('progress').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    deviceId: text('device_id'),
  },
  (t) => [
    uniqueIndex('session_pass_uq').on(t.userId, t.workId, t.passNo),
    index('session_user_idx').on(t.userId, t.startedAt),
  ],
);

/**
 * Idempotency ledger for the offline op queue. A retried op is a no-op.
 * Pruned on a rolling window; see sync/ops.ts.
 */
export const appliedOp = pgTable(
  'applied_op',
  {
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => account.id, { onDelete: 'cascade' }),
    appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('applied_op_user_idx').on(t.userId, t.appliedAt)],
);

/* ───────────────────────── change feed ────────────────────────── */

export const workEvent = pgTable(
  'work_event',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    workId: uuid('work_id')
      .notNull()
      .references(() => work.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('event_work_idx').on(t.workId, t.detectedAt)],
);

export const userNotification = pgTable(
  'user_notification',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => account.id, { onDelete: 'cascade' }),
    eventId: bigint('event_id', { mode: 'number' })
      .notNull()
      .references(() => workEvent.id, { onDelete: 'cascade' }),
    seenAt: timestamp('seen_at', { withTimezone: true }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('notification_uq').on(t.userId, t.eventId),
    index('notification_user_idx').on(t.userId, t.createdAt),
  ],
);
