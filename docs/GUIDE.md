# Using AnimeMind

The whole idea: **you say "I watched this" once, and never have to remember it
again.** Everything else — which seasons that covers, where you stopped, what
comes next, whether it's out yet — the app works out for you.

---

## The six screens

| Screen | Answers |
|---|---|
| **Today** | "What wants my attention right now?" |
| **Up next** | "What could I actually watch tonight?" |
| **Watching** | "What am I partway through?" |
| **Waiting** | "What am I waiting on?" |
| **Library** | "What have I got?" |
| **Series** | "Where am I in *this* show, and what's next?" |

Anything in your library is clickable — a poster takes you to its series page,
where every season, film and OVA is listed and editable.

Plus **search**, on `⌘K` (or `Ctrl+K`, or just `/`), from anywhere.

---

## Flow 1 — Adding something you've watched

This is the flow the app exists for.

```
⌘K  →  type a name  →  see the results
                            │
                   ┌────────┴────────┐
                   ▼                 ▼
          ✓ In your library       + Add
          (you've seen it —          │
           question answered)        ▼
                            ┌──────────────────────┐
                            │ Where are you with   │
                            │ this?                │
                            │  ○ Plan to watch     │
                            │  ○ Currently watching│
                            │      → which episode │
                            │  ○ Already watched   │
                            │  ○ On hold / Dropped │
                            └──────────────────────┘
```

**`✓ In your library` is the point.** You searched because you couldn't
remember whether you'd seen it. The answer is right there in the results list,
before you click anything.

**Adding asks where you are**, rather than assuming. Choosing *Currently
watching* asks which episode; *Already watched* fills the whole thing in. This
is the "tell it once" moment — say you've seen three seasons here and you never
have to correct it later.

Other seasons, films and OVAs appear on the **series page** a few seconds after
you add — the app works out the rest of the franchise in the background. You
set where you are with each of them there.

> **Keyboard:** `↑` `↓` to move, `↵` to add the highlighted result, `esc` to
> close.

---

## Flow 2 — Recording what you've watched

Open the series (click the title anywhere), and you'll see the **main story**
as a numbered spine:

```
①  Season 1     ● Aired        ████████████  12/12     ✓ Done
②  Season 2     ● Aired        ████░░░░░░░░   4/12    + Ep 5
③  Season 3     ● Announced    No release date announced
```

Press **`+ Ep 5`** each time you watch one. It saves instantly — you don't
confirm anything, and you can close the tab straight after.

**What the app records when you do that:**

| You do | It records |
|---|---|
| Press `+ Ep 5` | progress = 5, and marks the title **Watching** if it was Planned |
| Reach the last episode | status becomes **Completed**, with the date |
| Press **Watch again** | a new *rewatch pass* — see Flow 4 |

A season you haven't added yet shows **"12 episodes · not in your library"**
with an **Add** button — so you can start the next season without going back
to search.

---

## Flow 3 — Catching up

**Today** is a call sheet, not a catalogue. It only shows things that want a
decision:

```
NEW SEASON AVAILABLE
  Solo Leveling Season 2
  because you finished Solo Leveling          [ Start ]

CONTINUE WATCHING
  Attack on Titan Final Season   9/16          + Ep 10

WAITING ON
  One Punch Man 3rd Season   ● Announced   no date yet
```

**"because you finished Solo Leveling" is derived, not entered.** The app knows
Season 2 follows Season 1, knows you finished Season 1, and knows Season 2 has
aired and isn't in your library. Nobody told it any of that.

If nothing needs you, it says **"Nothing is waiting on you."** That's the win
condition, not an empty state.

---

## Flow 4 — Changing anything

Every title in your library has a **status chip** on the series page — it reads
*Watching*, *Completed*, *Planned* and so on. Click it for everything you can
change:

```
EPISODE      14/24  ✎  jump to…     ← type any episode number
STATUS       ● Watching
             Completed
             Plan to watch
             On hold
             Dropped
─────────────────────────────
↻ Watch again                       ← on completed titles
☆ Add to favourites
🗑 Remove from library
```

Setting the episode to the last one marks it **Completed** automatically —
there's no need to do both.

## Flow 5 — Rewatching

On a completed title, the status chip offers **Watch again**.

The important behaviour: **your completed count does not drop.** The title
stays Completed and starts tracking a second pass alongside it. Rewatching
Steins;Gate shouldn't make it look like you never finished it.

```
Before      Completed · 24/24 · watched 1×
Rewatching  Completed · 7/24  · rewatching      ← still Completed
After       Completed · 24/24 · watched 2×
```

Rewatches appear in **Watching** while they're in progress, and the series page
shows **↻ watched 2×**.

---

## Flow 6 — Deciding what to watch next

**Up next** is the backlog: everything you *could* start tonight, ordered by
how much you have already put in.

| Section | What's in it |
|---|---|
| **Paused** | Marked *On hold* — shows where you stopped, and how long ago |
| **Ready to start** | Marked *Plan to watch*, and already out |
| **Continue the series** | Not in your library, but follows something you finished |

Nothing appears in two sections at once, and **a franchise gets one row**, not
one per season. If four parts of Bleach are all waiting, the row names the one
to watch next and the count tells you the rest are there.

Films, OVAs and alternative versions are not folded in — those are separate
things to decide about, so they keep their own rows and their own numbers.

Every row carries the same three numbers, so you never have to open a series
page to work out where you stand:

```
BLEACH: Thousand-Year Blood War
13 episodes · 2022
▓▓▓▓▓▓▓▓▓░░  366/416
1 of 5 watched · 366/416 eps · 4 ready
```

Read it as: five entries in this franchise, you have finished one of them,
that is 366 episodes of 416, and four are out and waiting.

- **4 of 8 watched** — seasons, films and OVAs on the main line
- **59/115 eps** — the same thing in episodes, which is the honest version:
  "1 of 2 entries" of One Piece is nowhere near half of One Piece
- **4 ready** — entries that have aired and you haven't finished

If a season hasn't been announced yet, the total is shown as **?** rather than
guessed. A confident wrong number is worse than an admitted gap.

Anything you planned that **isn't out yet** is not listed here — it's on
**Waiting**, and the foot of the page says how many and links there.

> Marking something *Plan to watch* used to make it vanish: it dropped off
> Today (which only shows sequels you haven't acknowledged) and the library
> had no way to filter for it. Recording your intent hid the thing. This page
> is where it goes instead.

---

## Flow 7 — Waiting for the next season

**Waiting** has two halves:

- **Arrived since you last looked** — a sequel you were waiting for has aired
- **Still waiting** — announced, not out yet

Expected dates show exactly what's known. If no date has been announced it says
**"no date yet"** — the app will not invent one.

You're only shown as "waiting" on a season that *directly follows* something
you finished. If you've finished Season 1 and Season 2 is already out, the app
tells you to watch Season 2 rather than claiming you're waiting on Season 3.

---

## Finding things in the library

The **Library** filters by status and sorts:

- **All / Watching / Planned / On hold / Completed / Dropped** — only the
  filters that would actually return something are offered
- **Recent** (default), **Most left to watch**, **Title**

*Most left to watch* leads with how many aired entries you haven't finished,
then by episodes outstanding — so a franchise with four seasons sitting ready
beats one with a single episode left.

Both live in the URL (`/library?status=planned&sort=left`), so a filtered
library is linkable, and the counters on **Today** point straight at them.

---

## When a franchise has no single order

Some franchises genuinely cannot be put in one order — Fate is the classic
case, where several entries retell the same story rather than continuing it.

When that happens the series page says so plainly:

> ⚠ **This franchise has parallel story lines.** Some entries retell the same
> story rather than continuing it, so there is no single correct order.

and **no "next up" is shown**. The app would rather admit it doesn't know than
confidently send you to the wrong episode.

---

## When the anime database is down

The app depends on an outside service for titles and air dates, and that
service is unreliable. When it's unreachable you'll see:

> The anime database is unreachable — searching titles you already have. New
> titles will appear once it is back.

What still works: **everything about your own library.** Search finds anything
you've looked up before, progress saves normally, every screen works. The only
thing you can't do is add a title the app has never seen.

Your data is never affected by an outage.

---

## Things worth knowing

**Episode counts can be unknown.** A currently-airing show often has no final
count, shown as `9/?`. That's the provider not knowing yet, not a bug.

**Air dates are calendar dates.** A show that aired "7 April 2013" aired on
that date in Japan. The app doesn't shift it into your timezone, because that
would silently move half the episodes to the wrong day.

**Extras are grouped by medium.** Films, OVAs, Specials, Spin-offs and Recaps
each get their own section on the series page. Recaps are labelled
**skippable** — that's usually the useful thing to know about one.

**Staying signed in.** Sessions last 60 days and renew silently. You should
never be asked to sign in again unless you sign out or leave it two months.

**Multiple devices.** If you watch an episode on your laptop and another on
your phone, the app takes the higher number. It will never rewind your
progress because two devices disagreed.
