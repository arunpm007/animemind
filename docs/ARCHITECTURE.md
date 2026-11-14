# Architecture

Notes on the decisions that are not obvious from reading the code, and the
reasons behind them.

---

## 1. The problem is a graph, not a list

Every upstream source models anime as **independent entries connected by typed
relations**. There is no "season 2 of X" — there is a separate work whose
relation to X is `Sequel`. The schema in `src/server/db/schema.ts` mirrors that
exactly:

```
work            one provider entry
work_relation   typed, directed edge
series          a COMPUTED cluster — not from the provider
series_member   membership, with a spine position or an extras track
```

Deriving `series` from `work_relation` is the product. Everything else is CRUD.

### The derivation

`src/server/domain/series.ts`, pure and dependency-free:

```
1. franchise  = closure over all edges except `character` and `adaptation`
                (those cross into other franchises and other media)
2. spine      = works reachable from the seed through sequel/prequel edges
                AND of a primary kind (tv/ona, falling back to movie)
3. order      = Kahn topological sort, ties broken by start date then id
4. extras     = everything else, classified by track
```

Step 2's kind check is the part people get wrong. Attack on Titan has an
**OVA declared as a prequel of season 1**; a prequel-walk that ignores medium
puts it at position 1 and shifts every season by one. The check is applied
during traversal, not after, so an OVA also cannot act as a bridge between two
TV seasons.

### Cycles are real

Provider data contains genuine cycles from mislabelled edges. Kahn's algorithm
alone never terminates on them. When no node has in-degree zero, the algorithm
drops the **most chronologically backwards** edge — almost always the
mislabelled one — records it in `diagnostics.cyclesBroken`, and continues.
Degrading is correct; hanging is not.

### Some franchises have no single order

Fate cannot be linearised: Unlimited Blade Works retells the route
Fate/stay night already covered. It is not a sequel and ordering it as one
produces nonsense.

So retellings are never placed on the spine. They are reported in
`alternativeLines`, and the series is flagged `ambiguous`. When that flag is
set, `nextUp` is `null` and the UI shows a story-line switcher instead of an
answer.

**This is the most important design decision in the codebase.** The product's
value is being trusted about what to watch next. Inventing an order for Fate
would be a confident lie, and one confident lie costs more trust than ten
honest "I don't know"s.

### Depth limits are a trap

The recursive CTE that gathers a franchise originally capped at four hops.
Attack on Titan's sequel chain is six entries long, so the two newest seasons
were silently dropped — nothing threw, nothing logged, the series page just
ended early. For a product whose entire purpose is *"is there another season?"*,
quietly losing the newest season is the worst possible failure.

The limit is now far beyond any real franchise, and `tests/ingest.test.ts`
holds a nine-entry chain to keep it that way.

---

## 2. Isolation is the database's job

Every user-owned table has row-level security, and the application connects as
`animemind_app` — a role that does **not** own the tables.

That matters more than it looks: **Postgres exempts a table's owner from its
own RLS unless `FORCE` is set.** An app running as the owner has policies that
look right, pass review, and do nothing at all. Both the separate role and
`FORCE ROW LEVEL SECURITY` are applied.

Identity is set per transaction:

```sql
SELECT set_config('app.user_id', $1, true);   -- true = transaction-local
```

Transaction-local, not session-local. A session-local setting survives on a
pooled connection and carries one user's identity into the next request — a
cross-tenant leak that only appears under concurrency and is near-impossible to
reproduce. `tests/rls.test.ts` has a regression test for exactly that.

There is one entry point per intent, and no third option:

```ts
asUser(userId, fn)   // user data. RLS applies.
unscoped()           // shared catalog, and sign-in only.
```

`account` is deliberately outside RLS, because sign-in must look a user up
before any identity exists. That lookup is confined to `src/server/auth/` — one
file to audit.

---

## 3. Sync: progress must never go backwards

Full rules in `src/contracts/sync.ts`. The short version: last-write-wins is
correct for every field except `progress`, where it is actively harmful.

Watch an episode on the sofa (phone, offline), another on the laptop, then both
sync. Under LWW whichever request lands second overwrites the other and the
user is silently rewound. So progress merges with `max()` — but only within the
same rewatch pass, because starting a rewatch legitimately resets to zero and
that reset must win.

```
pass = rewatchCount + 1 + (rewatching ? 1 : 0)
```

Derived, never stored twice.

Two supporting decisions:

- **`watch_session` is append-only.** It is the source of truth for rewatch
  counts and gives the activity feed for free. A lost sync can at worst create
  a duplicate, which a unique constraint rejects — it can never destroy history.
- **`updated_seq` comes from a database trigger**, not application code. A
  single forgotten call site would stop a row ever reaching the user's other
  devices, surfacing days later as "my phone didn't update" and being
  essentially untraceable.

The cursor is that sequence, never a timestamp. Client clocks drift; sequences
do not.

---

## 4. The provider is assumed to be down

This started on Jikan, a community mirror of MyAnimeList, and that was a
mistake worth recording. Measured availability across three sessions: **1/10,
then 0/10, then 0/10**, while MyAnimeList itself answered in about a second.
A mirror inherits the uptime of the thing it mirrors *and* its own.

**Kitsu is now primary.** It was chosen for one hard requirement and three
conveniences:

- **Typed relations, free.** `sequel`, `prequel`, `spinoff`,
  `alternative_version` — the series builder cannot work without these, and no
  other key-free source provides them. (The `anime-offline-database` dump was
  evaluated and rejected: its `relatedAnime` is a bare list of URLs with no
  types at all, and its releases had gone four months stale.)
- The neighbour's subtype arrives **inline**, removing the request-per-neighbour
  that Jikan forces.
- It has **episode lists**, which the official MyAnimeList API v2 does not.
- It has **banner art**, which neither of the others does.

AniList would have been the obvious technical pick — better structured than
all of them — but its terms prohibit use "within competing, non-complementary
services… including anime and manga list or tracker services", which describes
this product precisely.

Everything below applies regardless of which provider leads.

Consequences, all of them load-bearing:

- **One global token bucket** for every upstream request in the process.
  Scattered retry logic overruns the ~60/minute budget the moment two code
  paths fetch at once.
- **A Postgres response cache**, so development reloads and retries cost no
  API budget, and a stale body can be served when everything else fails.
- **A per-attempt timeout.** Node's `fetch` has no default timeout, so a
  stalled connection hangs the request forever. Without this the search
  endpoint spins indefinitely instead of failing.
- **Two patience budgets.** Interactive calls get two attempts and six seconds,
  then surface `provider_unavailable`. Background jobs get four attempts and
  fifteen seconds, because nobody is watching.
- **Relation hydration is a background job.** Jikan returns only
  `{id, type, name}` per relation — no format, no status — so classifying each
  neighbour costs one request. Doing that inline would mean a thirty-second
  spinner on "Add". The walk is budgeted and resumable; a partially hydrated
  series renders correctly because the builder tolerates `unknown` kinds.

### The chain

`ChainProvider` tries each source in order. It is not a redundancy hack — it is
how the app gets full coverage, because MAL v2 has **no episode endpoint** and
Jikan has no reliability. Episode lookups fall through by design.

One rule worth noting: a `ProviderNotFoundError` **stops** the chain. Ids are
per-provider, so asking Jikan about a MyAnimeList id that does not exist could
at best waste a request and at worst return a different show.

With MAL primary, `hydrateRelations` can place a neighbour straight from the
inline hint without fetching it, which is what removes the N+1. With Jikan the
hint is title-only and the old per-neighbour fetch still applies — so the
budgeted background walk stays necessary either way.

### Why not AniList

Better graph: relations come back with `format`, `status` and `startDate`
inline, which removes the N+1 entirely. But its terms prohibit use "within
competing, non-complementary services of the same nature… including anime and
manga list or tracker services", and separately prohibit using the API "as a
backup or data storage service" — which is what our catalog cache is.

That names this product. Not used.

The intended upgrade is MyAnimeList's **official** API: first-party, free
client id, and `related_anime` carries `media_type` and `status` inline.

---

## 5. Refresh is a column, not a queue

`work.next_sync_at` plus one cron route. No Redis, no BullMQ.

```
airing                          +6h
not_yet_aired, within 30 days   +24h
not_yet_aired, no date          +7d
finished                        +30d
failure                         exponential backoff, parks after 8
```

A crashed run leaves rows due; the next one picks them up. There is nothing to
monitor and nothing to restart. Two hundred tracked works refreshing nightly is
about four minutes of wall clock at the rate limit.

The event worth catching is **a new `sequel` edge to a work we have not seen**.
That is "season 2 announced", and it is a graph delta — no news scraping, no
language model, no guessing.

The in-process token bucket is correct for a single node, which is how this
runs. If it ever fans out across serverless instances, the bucket has to move
to Redis or the worker has to be pinned to one instance.

---

## 6. Why the web app does not call its own API

Pages are server components that call the **same service functions** the HTTP
routes call:

```
route handler  ─┐
                ├─→ services/  ─→ domain/
server component┘
```

Services take a typed input and an `Actor` and return typed output; they know
nothing about HTTP. The web app gets them in-process, a mobile app reaches them
over HTTP, and there is one implementation of each behaviour.

The exception is writes. The `EpisodeStepper` posts to `/api/v1/sync` like any
other client, so the merge rules apply identically everywhere rather than
existing twice.

`src/contracts/` never imports a framework, so it can be lifted out and
published for a native client. `src/server/http/serialise.ts` maps rows to
DTOs, which is what allows a column rename without breaking a client that is
already in an app store.

---

## 7. Known gaps

- **Offline queue.** The sync protocol and server are complete; the browser
  does not yet persist an op queue to IndexedDB, so a write made offline is
  lost rather than deferred. Server-side work is done.
- **Filler data.** `episode.is_filler` exists and is always `null`. Jikan
  exposes it per-episode but episode lists are not hydrated by default.
- **Accent colour** is populated by the seed only; nothing samples cover art
  yet, so most pages fall back to a neutral key light.
- **Notifications** are recorded in `user_notification` but never delivered.
