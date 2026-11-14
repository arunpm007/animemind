# Testing

```bash
pnpm db:up     # Postgres, once
pnpm test      # creates and migrates animemind_test on first run
```

The suite provisions its **own** database. It used to share the development one
and clean up by deleting catalog rows by MyAnimeList id — the same ids the dev
seed uses — so running the tests silently destroyed local data through a
foreign-key cascade. Isolation turned out to be cheaper than remembering.

---

## What's covered, and why there

Coverage is concentrated where a mistake would be expensive or invisible,
rather than spread evenly.

| File | Guards |
|---|---|
| `series.test.ts` | The watch-order algorithm, against franchises picked to break it |
| `jikan.test.ts` | The normaliser, against a **captured live payload** |
| `mal.test.ts` | The official-API normaliser and the provider chain |
| `rls.test.ts` | That the **database** refuses cross-user reads and writes |
| `ingest.test.ts` | That long franchises keep their newest seasons |
| `api.test.ts` | The HTTP surface and every sync merge rule |
| `search-fallback.test.ts` | That search survives the provider being down |
| `resilience.test.ts` | Regressions from the manual QA run |

Most of these are **integration** tests against a real Postgres. That's
deliberate: the guarantees worth having here — row-level security, the merge
rules, the trigger that maintains rewatch counts — live in the database. Mocking
them would test the mock.

### The tests that matter most

**`rls.test.ts`** — the one that must never be deleted. Everything else is a
convenience; this is the difference between a private library and a data
breach. It proves a user cannot read another's rows *even with an explicit
`WHERE`*, cannot write a row attributed to someone else, and that identity does
not leak between pooled transactions.

**`api.test.ts` sync section** — encodes the guarantees a client may rely on.
Chiefly: progress **never goes backwards** when two devices disagree, and a
rewatch may legitimately reset to zero.

**`jikan.test.ts`** — uses a real captured response rather than a synthetic
one. Synthetic fixtures agree with whatever the normaliser happens to do;
captured ones disagree when the provider changes. That's how the `"Spin-Off"`
casing bug was found — the live API's capitalisation differed from its
documentation, and an exact-match table was silently dropping every OVA and
spin-off from every franchise.

---

## Verifying by hand

Automated tests won't catch a rendering failure, a misleading label, or a
button that doesn't exist. Every defect in
[QA-2026-11-14.md](QA-2026-11-14.md) was found by hand.

A pass worth repeating before any release:

1. **Fresh account.** Register, confirm empty states read sensibly.
2. **Second account.** Confirm it sees none of the first one's library.
3. **Add a title**, then check the database — not just the screen.
4. **Walk the lifecycle:** watch a few → complete → rewatch → complete. Check
   `user_work` and `watch_session` after each.
5. **Expire the session.** Delete the `am_access` cookie, reload, confirm it
   recovers silently instead of dumping you at sign-in.
6. **Break the provider.** Point `api.jikan.moe` at nothing, or just test
   during one of its outages. Search must fall back and say so; adding a cached
   title must still work.
7. **Disable hardware acceleration.** The app must render without WebGL.
8. **Mobile width.** 375px, no horizontal scroll.

Useful during step 3 and 4:

```bash
docker exec animemind-db psql -U animemind -d animemind -c "
SELECT w.title_romaji, uw.status, uw.progress, uw.rewatching, uw.rewatch_count
  FROM user_work uw
  JOIN work w ON w.id = uw.work_id
  JOIN account a ON a.id = uw.user_id
 WHERE a.email = 'you@example.com';"
```

---

## Working without the provider

Jikan is unreliable and has been unreachable for entire sessions. To develop
regardless:

```bash
pnpm seed you@example.com
```

Three real franchises, built offline, including a complete spine with every
kind of extra, an aired-but-unwatched sequel, and an announced season with no
date — enough to exercise every state the UI has.
