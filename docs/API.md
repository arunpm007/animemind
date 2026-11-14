# The AnimeMind API

**Base:** `/api/v1` · **Format:** JSON · **Auth:** bearer token or cookie

This API is the product's only interface to its data. The web app is one
client; a native app is another, and neither is privileged. If something is
possible on the web and not over HTTP, that is a bug.

---

## Building a mobile client

Everything a client needs is here, but four things do most of the work.

### 1. Types come from the repo, not from this document

`src/contracts/` is framework-free zod schemas with inferred TypeScript types.
It is designed to be lifted out and published as `@animemind/contracts`:

```ts
import { syncRequest, type SyncResponse, type LibraryEntry } from '@animemind/contracts';
```

The same schemas validate on the server, so the client and server cannot drift.
For Swift or Kotlin, generate from the zod schemas rather than hand-writing
models.

### 2. One envelope, one error type

Every response is one of two shapes:

```jsonc
{ "data": <payload>, "meta": { "cursor": "…", "hasMore": false } }
{ "error": { "code": "unauthorized", "message": "…", "requestId": "…" } }
```

Branch on the envelope, not on the HTTP status — a native fetch layer should
need one decode path, not one per endpoint.

`code` is stable and safe to switch on. `message` is human-facing and may be
reworded at any time; never parse it.

| code | HTTP | Meaning |
|---|---|---|
| `bad_request` | 400 | Malformed request |
| `unauthorized` | 401 | Missing/expired access token — refresh, then retry |
| `forbidden` | 403 | Authenticated but not allowed |
| `not_found` | 404 | No such resource |
| `conflict` | 409 | Already exists (e.g. email taken) |
| `validation_failed` | 422 | See `details`, keyed by field path |
| `rate_limited` | 429 | Back off |
| `provider_unavailable` | 503 | Upstream anime database is down. **The user's own data is fine** — say so, and do not clear local state |
| `internal` | 500 | Report `requestId` |

### 3. Auth: same endpoints, different storage

Send `"client": "ios"` (or `android`, `cli`) and tokens come back in the body.
Send `"client": "web"` and the server sets httpOnly cookies instead.

```
POST /auth/login  { email, password, client: "ios" }
  -> { user, accessToken, expiresIn, refreshToken }

  accessToken   15 minutes.  Send as `Authorization: Bearer <token>`.
  refreshToken  60 days.     Keychain / Keystore. Never UserDefaults.
```

Refresh tokens **rotate**: each one works once, and using it returns a new one.
Presenting an already-used refresh token is treated as theft and revokes the
entire session family, signing that session out everywhere. So:

- store the new refresh token before you use it again;
- never refresh concurrently from two tasks — serialise it behind one lock, or
  you will race yourself into a logout.

On `401`, refresh once and retry the original request. If the refresh also
fails, sign the user out.

### 4. Sync is the whole client

Do not build a client that calls `/library` and `/dashboard` on every screen.
Build a local store, and reconcile it with one endpoint.

---

## `POST /sync` — the important one

Push local changes and pull remote ones in a single round trip.

```jsonc
// request
{
  "cursor": "djE6MTIzNA",        // omit on first sync for a full snapshot
  "ops": [
    { "id": "01J…", "clientTs": 1727200000000, "deviceId": "…",
      "t": "set_progress", "workId": "…", "pass": 1, "value": 10 }
  ]
}

// response
{
  "cursor": "djE6MTI0MA",
  "changed": [ { "work": {...}, "progress": {...} } ],
  "deleted": [ "workId" ],
  "results": [ { "id": "01J…", "status": "applied" } ],
  "hasMore": false,
  "serverTime": "2026-09-24T18:00:00.000Z"
}
```

### Guarantees you may rely on

**Ops are idempotent by `id`.** Retrying an entire batch after a timeout is
always safe. On mobile this is the normal case, not the exceptional one —
generate a ULID per op, persist the queue, and retry without thinking about it.

**The cursor is opaque.** Persist it, send it back, never parse it. It is not a
timestamp, specifically so that device clock skew cannot cause rows to be
silently skipped.

**The response is authoritative.** Replace local rows wholesale. Do not merge
on the client — there is exactly one merge implementation and it is on the
server where it is tested.

**`hasMore: true` means call again immediately** with the new cursor.

**`results[].status`**

| status | Do |
|---|---|
| `applied` | Remove from the queue |
| `duplicate` | Remove from the queue — it already landed |
| `rejected` | **Drop it.** Never retry; a permanently invalid op will wedge the queue behind it forever |

### Merge rules

Last-write-wins is right for almost everything here and catastrophically wrong
for progress.

| Field | Rule |
|---|---|
| `progress` | `max()` **within the same pass**; a higher pass wins outright |
| `status` | LWW by `clientTs` |
| `rewatchCount` | `max()` |
| `rating`, `notes`, `favorite` | LWW by `clientTs` |
| removal | tombstone, returned in `deleted` |

The scenario this protects: you watch an episode on the sofa (phone, offline)
and another on the laptop. Both sync. Under LWW whichever lands second wipes
the other and the user is silently rewound. `max()` makes that impossible.

`pass` is the rewatch pass an op belongs to:

```
pass = rewatchCount + 1 + (rewatching ? 1 : 0)
```

It is what lets `start_rewatch` legitimately reset progress to zero while a
late-arriving op from the previous pass is correctly ignored.

### Op types

```ts
{ t: 'add',           workId, status? }
{ t: 'set_progress',  workId, pass, value }
{ t: 'set_status',    workId, value }   // planned|watching|completed|on_hold|dropped
{ t: 'start_rewatch', workId, pass }
{ t: 'complete',      workId, pass }
{ t: 'rate',          workId, value }   // 1–10 or null
{ t: 'favorite',      workId, value }
{ t: 'note',          workId, value }
{ t: 'remove',        workId }
```

Every op also carries `id` (ULID), `clientTs` (ms) and `deviceId`. Max 500 per
request.

---

## Endpoints

### Auth

| | |
|---|---|
| `POST /auth/register` | `{ email, password, displayName?, client }` |
| `POST /auth/login` | `{ email, password, client }` |
| `POST /auth/refresh` | `{ refreshToken?, client }` — web omits it (cookie) |
| `POST /auth/logout` | Revokes the session family |
| `GET /auth/me` | Current user |

Passwords are minimum 10 characters. Login is deliberately constant-time
across known and unknown emails, so it cannot be used to enumerate accounts.

### Catalog

**`GET /search?q=&limit=`** — works signed out. Each result carries:

```jsonc
{ "id": "…", "title": "…", "inLibrary": true, "libraryStatus": "completed" }
```

`inLibrary` is the field that matters. It answers *"have I already seen this?"*
in the results list, with no second request. Render it prominently.

`id` here is the **provider id** (a MyAnimeList id), which is what `POST
/library` expects. Elsewhere, `work.id` is our internal UUID.

**`GET /series/{slug}`** — the derived structure:

```jsonc
{
  "title": "Attack on Titan",
  "ambiguous": false,
  "spine": [ { "ord": 1, "work": {...}, "progress": {...} } ],
  "extras": [ { "track": "movie", "work": {...} } ],
  "alternativeLines": [],
  "nextUp": { "reason": "continue_episode", "work": {...}, "episode": 10 },
  "releaseSummary": { "airing": false, "hasUnairedSequel": true }
}
```

> **`ambiguous: true` is a contract, not a hint.** It means the franchise has
> parallel retellings and cannot honestly be reduced to one order (Fate is the
> canonical case). When it is set, `nextUp` is `null` and a client **must not**
> present a single "watch this next". Show the story lines and let the user
> choose. Inventing an order here is worse than admitting there isn't one.

`extras[].track` is one of `movie | ova | special | spinoff | side_story |
recap | alternative | other`. Group by it; `recap` is safely skippable.

### Library

| | |
|---|---|
| `GET /library?status=` | All entries |
| `POST /library` | `{ providerId, status?, progress? }` — 201 |
| `GET /dashboard` | The home screen, precomputed |

`GET /dashboard` returns `continueWatching`, `newlyAvailable` (a sequel aired
and you finished the previous entry) and `waitingOn` (announced, not yet
aired). Prefer it over assembling the home screen client-side — the
"because you finished X" attribution comes from the series graph.

### Operations

`GET /cron/sync` with `Authorization: Bearer $CRON_SECRET` runs the refresh
worker. Not for clients.

---

## Things that will bite you

**Never conflate `episodeCount: null` with `0`.** `null` means unknown or still
airing. Rendering it as `0` makes every currently-airing show look finished.
Render `9/?`.

**Dates are calendar dates, not instants.** `startDate` is `YYYY-MM-DD`.
Parsing it as a timestamp and localising it shifts air dates by a day.

**Rewatching does not change `status`.** It stays `completed` with
`rewatching: true`, so the user's completed count never drops when they start a
rewatch. A "currently watching" view must check both.

**`provider_unavailable` is not the user's problem.** The upstream anime
database goes down regularly. Say so specifically, keep the local library fully
usable, and do not clear cached data.
