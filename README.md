# AnimeMind

> Never forget what you watched.

A personal anime memory. You tell it *"I watched this"* once; it works out which
seasons that covers, where you stopped, what comes next, and whether the next
season has actually arrived.

It is deliberately **not** a social network, a catalogue, or a second
MyAnimeList. There are no reviews, no follows, no rankings and no feed.

---

## Getting started

Requires Node 22+, pnpm and Docker.

```bash
pnpm install
cp .env.example .env.local     # then fill in the two secrets below
pnpm db:up                     # Postgres on :55432
pnpm db:migrate
pnpm dev                       # http://localhost:3000
```

Generate the secrets:

```bash
echo "AUTH_SECRET=$(openssl rand -base64 48)"
echo "CRON_SECRET=$(openssl rand -hex 32)"
```

Create an account at `/sign-in`, then optionally load sample data:

```bash
pnpm seed you@example.com
```

The seed builds three real franchises offline. It exists because the upstream
data provider is a scraper of MyAnimeList and inherits its downtime — you
should not be blocked from working because someone else's server is having a
bad afternoon.

### Commands

| Command | Does |
|---|---|
| `pnpm dev` | Development server |
| `pnpm test` | Full suite, against an isolated test database it creates itself |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm db:up` / `db:down` | Postgres container |
| `pnpm db:migrate` | Apply migrations |
| `pnpm seed [email]` | Load sample franchises |

---

## Documentation

| | |
|---|---|
| **[docs/GUIDE.md](docs/GUIDE.md)** | How to use it — every flow, and what gets recorded |
| **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** | Why the code is shaped this way |
| **[docs/API.md](docs/API.md)** | The HTTP contract, written for a mobile developer |
| **[docs/TESTING.md](docs/TESTING.md)** | Running the suite, and verifying by hand |
| **[docs/QA-2026-11-14.md](docs/QA-2026-11-14.md)** | A manual test run and the defects it found |

---

## How it is put together

```
src/
├── contracts/     wire format (zod). No framework imports — this is the
│                  package a mobile app would consume.
├── server/
│   ├── domain/    pure logic. No I/O, no database, no framework.
│   ├── providers/ upstream adapters + rate limiting + caching
│   ├── db/        schema, migrations, the RLS-scoped client
│   ├── services/  use cases. Transport-agnostic.
│   ├── sync/      the background refresh worker
│   └── http/      thin adapters: request -> service -> envelope
├── app/
│   ├── api/v1/    the public API
│   └── ...        the web UI
└── components/
```

The dependency rule is one-directional: `app` → `services` → `domain`, and
nothing in `domain` or `contracts` may import a framework. That is what makes
the hard part — deriving a watch order from a messy relation graph — testable
without a database and reusable from any transport.

### Three ideas worth knowing before reading the code

**1. A "series" does not exist upstream.** MyAnimeList has no concept of
seasons. Every season is its own top-level entry, connected only by typed
relation edges. `src/server/domain/series.ts` derives the watch order from that
graph, and that derivation is the product. See `docs/ARCHITECTURE.md`.

**2. Per-user isolation is enforced by Postgres, not by discipline.** Every
user-owned table has row-level security; the app connects as a non-owner role
so the policies actually apply to it. A handler that forgets its `WHERE` clause
returns nothing rather than someone else's library.

**3. Progress never goes backwards.** Two devices watching the same show merge
with `max()` within a rewatch pass, not last-write-wins. The rules are in
`src/contracts/sync.ts` and the tests that hold them honest are in
`tests/api.test.ts`.

---

## Data

Three sources, chained, with **Kitsu** as primary:

| | Role | Why |
|---|---|---|
| **Kitsu** | primary | No API key, typed relations with the neighbour's format inline, episode lists, poster *and* banner art |
| **MyAnimeList API v2** | optional | Richer broadcast data (day and time of week). Needs a free `MAL_CLIENT_ID` |
| **Jikan** | last resort | Carries filler-episode flags nothing else does |

Kitsu leads because it is the only key-free source with **typed** relations
(`sequel`, `spinoff`, `alternative_version`…), which the series builder cannot
work without — and because it is actually up. Measured over three sessions:
Jikan answered 1/10, then 0/10, then 0/10; Kitsu answered 8/8 in under a
second. A fresh clone works with no signup at all.

Everything upstream is cached, rate-limited, given a per-attempt timeout, and
fronted by a circuit breaker. When every provider fails, search falls back to
your own catalog and says so rather than pretending no such anime exists.

AniList is **not** used: its terms prohibit use of the API "within competing,
non-complementary services of the same nature… including anime and manga list
or tracker services", which describes this project exactly.

---

## Testing

```bash
pnpm test
```

Creates and migrates `animemind_test` on first run, so the suite never touches
development data. Coverage is concentrated where the risk is:

- `series.test.ts` — the watch-order algorithm against franchises chosen to
  break it (Attack on Titan's OVA prequel, Fate's parallel retellings,
  a deliberately cyclic graph)
- `jikan.test.ts` — the normaliser against a **captured live payload**
- `rls.test.ts` — that the database refuses cross-user reads and writes
- `ingest.test.ts` — that long franchises keep their newest seasons
- `api.test.ts` — the HTTP surface and every sync merge rule

## Deployment

Any Node host plus a Postgres database. `vercel.json` schedules the refresh
worker every six hours; on another host, call `GET /api/v1/cron/sync` with
`Authorization: Bearer $CRON_SECRET` on the same cadence.

Set `DATABASE_URL` to the **non-owner** role and `DATABASE_MIGRATION_URL` to
the owner. Collapsing them into one silently disables row-level security.
