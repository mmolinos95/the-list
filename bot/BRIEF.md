# The List bot: build brief

_For the session that builds the bot. Written 2026-10-22 from planning with Martin (the club's maintainer). Read this, then [../README.md](../README.md), [../DATA_MODEL.md](../DATA_MODEL.md) and [../AGENTS.md](../AGENTS.md)._

## What this is

A WhatsApp bot for The List, the CBS FC practice sign-up app in this repo. It lives in the club's main WhatsApp chat (a group inside a WhatsApp Community). Members ask it about practices and sign up or drop out from the chat; the board posts sign-up messages and runs practices from the chat. The web app stays exactly as it is and remains the fallback if the bot is down or banned.

This repo is a fork of `cbs-futbol-club/cbs-futbol-club-app` (remote `upstream`). The original is frozen while the club board reviews it.

## Hard rules

- **Don't change the live app or the database.** No edits to `supabase/migrations/`, no deploys, nothing pushed to `upstream`. The bot talks to the live Supabase through the Postgres functions that already exist. If something truly needs a schema or app change, stop and write it up under "Needs a decision" at the end of this file instead.
- **Keep `src/` changes minimal** so the fork can merge back cleanly. If the bot needs app logic that imports `server-only` or `env.ts` (the sign-up link key, the WhatsApp post text), re-implement it in `bot/` and add a test that checks the bot's output matches `src/lib/` for the same input.
- **No secrets in the repo or in this session.** Everything secret comes from `bot/.env` (gitignored). Ship a `bot/.env.example`.
- **Writes are off by default.** Each phase is switched on with a setting (see Config), so the live bot can start read-only.

## Stack

- Node 24, TypeScript, its own `bot/package.json`. Run with `tsx` or compile; your call.
- **Baileys** (`@whiskeysockets/baileys`, latest stable) for WhatsApp, logged in as a linked device of the bot's WhatsApp Business account (a Google Voice number). Log in with a **pairing code** (`requestPairingCode`), not a QR, so it can be done from a terminal: `npm run link` prints an 8-character code that Martin types on the phone. The auth state dir is gitignored.
- **Supabase** with `@supabase/supabase-js` and the secret key, calling the existing functions via `rpc()` and reading tables directly.
- **Gemini** with `@google/genai`, free tier. Check Google's docs for the current free Flash model name; don't hardcode an old one.
- **Email** with `nodemailer` + the club Gmail (same as the app), **only for the 6-digit linking code** and, since R2, down alerts to `ALERT_EMAILS`. Every notification about practices goes to WhatsApp (see Notifications). With no Gmail settings, print emails to the terminal, the way the app does in development.
- Local state (linked WhatsApp IDs, pending link codes, rate limits) in `node:sqlite`, in a file next to the auth state, gitignored. It holds personal data, so it lives only on the VM.

## How it behaves in WhatsApp (ban safety)

The bot number is unofficial (Baileys), so WhatsApp can ban it. Behave like a quiet human:

- Listen only in the groups named in `ALLOWED_GROUPS`. Ignore every other group.
- Only react to messages starting with `!list` (case-insensitive) or @mentioning the bot.
- Reply quoted under the question. Show "typing…" while working. One question at a time per chat; queue the rest.
- Never @mention everyone. Never send a message nobody asked for, except a board-triggered `!list post` or cancellation notice.
- Keep a minimum gap between the bot's own messages (a couple of seconds) and a per-minute cap.
- **DMs:** never start one. Answer a DM only if it's part of the linking flow below (the user sent `link`, or is mid-flow). Ignore all other DMs.
- Reconnect with backoff after disconnects. If logged out, log it loudly and stop; don't loop.

## Who is asking

Members are keyed by **email** in the database (`members.email`); `members.phone` is E.164 and optional.

1. **Linked already:** the sender's WhatsApp ID (phone JID or hidden `@lid`) is in local state → that member.
2. **Phone visible:** if Baileys gives the sender's phone number (the `@s.whatsapp.net` JID, or the LID-to-phone mapping when WhatsApp has shared it), match `members.phone`. If several members share it, use the most recently updated. Save the link.
3. **Unknown** (hidden number, or no member with that phone): reply in the group with a short message and a `wa.me/<bot number>?text=link` link, so the **member** opens the DM (the bot never DMs first). In the DM:
   - Ask for the email they sign up with.
   - Email a 6-digit code to that address (expires in 10 minutes; max 3 codes per WhatsApp ID per hour). The email is the proof; never accept an email or phone number without the code.
   - They reply with the code → link their WhatsApp ID to that member in local state.
   - If no member has that email (new member), also ask their full name, then keep them as a pending member in local state. Their phone is the number WhatsApp shows, or none if it's hidden; never a typed one, since typed numbers can't be checked and phones are used to match people (decided 2026-10-23, after a tester typed a number that wasn't his WhatsApp). The database row is created by their first `sign_up`, which takes name, email and phone.
   - Say "you're set, go back to the group" and stop.

**Board:** a sender is board if their linked member's email is in `board_members`. Board actions that take `p_by` get that board member's id.

## Commands

> **Changed 2026-10-23 (Martin):** commands are now `!` plus the word (`!in thu`, `!out thu`, `!me`, `!post thu`, …); unknown `!` words are ignored. `!list [day]` shows the practice with everyone's names (no day: the next one) and the old overview is `!week`. After every sign-up, drop-out and walk-in the reply carries the full list, and the bot deletes its previous list message for that practice so only the newest stays. [README.md](README.md) has the current table; the one below is the original plan.

Practices are picked with loose input: `thu`, `thursday`, `10/23`, `next`. Times are shown in New York time (see `src/lib/time.ts`). Keep replies short and WhatsApp-formatted (`*bold*`).

| Phase | Who | Command | Does |
|---|---|---|---|
| 1 | Anyone | `!list` or `!list help` | Upcoming practices with spots left per list; short help |
| 1 | Anyone | `!list thu` | Time, place, each list's count / cap and waitlist size |
| 1 | Member | `!list me` | Their spots and waitlist positions |
| 2 | Board | `!list post thu` | Posts the same text as **Copy WhatsApp post** (`src/lib/share.ts`), with the signed link (`src/lib/signup-link.ts`, uses `DROP_LINK_SECRET`) |
| 3 | Member | `!list in thu [list]` | `sign_up(event, lists, name, email, phone)`. If the practice has more than one list and none was named, ask which. Reply with main/waitlist result |
| 3 | Member | `!list out thu [list]` | `drop_signups(event, member, lists)` |
| 4 | Board | `!list open thu` | `open_event`, the same as the app's **Open sign-ups** button. There is no lock command: a list locks on its own 2 hours before its first list starts |
| 4 | Board | `!list cancel thu [reason]` | `cancel_event(event, reason, by)`. Ask to confirm first (`!list cancel thu yes`) |
| 4 | Board | `!list add thu Name [list] [waitlist]` | `add_signup(list, name, null, null, spot, by)` |
| 4 | Board | `!list teams thu` | `shuffle_teams`, then show the teams |
| 5 | Anyone | `@bot <any question>` or `!list <free text>` | Gemini picks one of the commands above (function calling) and the bot runs it with the same permission checks. Gemini never writes to the database directly. |

Notices about spots opening or cancellations are **not** automatic. They only go out as part of answering a command.

## Notifications: WhatsApp only

Members are expected to use the bot, not the website, so everything the bot does is announced in WhatsApp, never by email. After each bot write (`sign_up`, `drop_signups`, `add_signup`, `cancel_event`) the bot handles the emails that write queued in the `emails` table:

- **Delete them**, don't send them. Only the ones caused by the bot's own call: same event, member and kind, created during that call. Emails from the website or the board's app are never touched.
- **The person who asked** gets the quoted reply.
- **Anyone promoted off the waitlist** gets an @mention in that reply if their WhatsApp is linked, or their name in plain text if not (names are already public on the list).
- **Cancellations** get one group message, with no mass @mentions.
- Late-drop heads-ups to the board are deleted like the rest (board emails are paused on live).

The emailed 6-digit linking code stays: it's identity proof, not a notification.

**Gemini privacy:** the free tier may be used by Google for training. Only send Gemini the question, practice times, places and counts, and the asker's own status. Never send other members' names, emails or phones. If Gemini is out of quota or slow (over 20s), say so and suggest the plain commands.

## Config (`bot/.env.example`)

```
SUPABASE_URL=
SUPABASE_SECRET_KEY=
DROP_LINK_SECRET=          # same value as the app's, so posted links work
SITE_URL=https://cbsfc-the-list.vercel.app
GMAIL_USER=                # only for the linking code
GMAIL_APP_PASSWORD=
GEMINI_API_KEY=
BOT_PHONE=                 # E.164, the bot's own number (pairing + wa.me links)
ALLOWED_GROUPS=            # exact group names, comma-separated
BOT_FEATURES=read          # any of: read,post,signup,board,ai
DATA_DIR=./data            # auth state + local db
ALERT_EMAILS=              # R2: who gets an email when the bot is down; empty = no alerts
```

## Testing

- `npm test` in `bot/` (vitest), runnable with no network and no secrets.
- Unit-test command parsing, practice picking (dates, weekdays, New York time edge cases), permission checks, the linking flow, rate limits, and the Gemini tool loop (Gemini mocked).
- Put the WhatsApp side behind a small interface so commands are tested without Baileys.
- Database behavior: [../tests/db/harness.ts](../tests/db/harness.ts) gives an in-memory Postgres (PGlite) with the real migrations. Use it to test the bot's data layer against the real functions. Direct SQL there vs `supabase-js` in production is fine; keep the queries in one data module with both implementations, or whatever keeps it honest.
- `npm run cli` runs commands in the terminal as a given member (`--as email`) against whatever `SUPABASE_URL` points to, with no WhatsApp.
- Also keep the root `npm test`, `npm run lint` and `npx tsc --noEmit` passing.

## Deploy files (written now, run later by Martin's local session)

- `bot/deploy/setup.sh`: one-time setup of an Ubuntu 24.04 Google Cloud e2-micro (free tier, us-east1): Node 24, a `listbot` user, swap, the app dir.
- `bot/deploy/listbot.service`: systemd unit; restarts on crash.
- `bot/deploy/upload.sh`: copies the build to the VM with `gcloud compute scp` and restarts the service.
- `bot/README.md`: how to link WhatsApp, configure, run, deploy, and what the board needs to know at handover. This includes: the Google Voice number must send a text every month or two or Google reclaims it, and the bot phone must open WhatsApp at least every 14 days.

## Round 2: before the board sees it (planned 2026-10-23)

Phases 1–5 are built and tested live in the test group (see [README.md](README.md) for how the bot works today: `!` commands, the full list after every change, Gemini on @mention / swipe-reply, weather). Build these four, in this order, with the same hard rules as above (no schema or app changes, no deploys, no secrets, nothing pushed to `upstream`). Commit after each with `bot` tests, root `npm test`, lint and `tsc` passing.

### R1. Rush handling (most important)

**Problem.** When sign-ups open, 30–40 people send `!in` within a minute or two. The pacer allows one bot message every 2.5 s, at most 12 a minute, and each change is now two actions (the reply with the full list, then deleting the previous list). 40 sign-ups means about 7 minutes of replies, and the per-chat queue waits for each send, so processing lags too. People will think it's broken, and a burst of messages is exactly what gets numbers banned.

**Build.**
- Writes (`!in`, `!out`, `!add`, and the same through Gemini) still run **immediately and in arrival order**: the database is the source of truth and the order is fair. Don't let sending block the next write.
- The **list message** is batched per practice per chat: the first change schedules one post; it goes out after 5 s with no further change for that practice, or 15 s after the first change at the latest. One message carries a summary of everything in the batch and then the full list, and it replaces the previous list (the existing `listOf` delete logic). Example top:
  `✅ In: Ana Diaz (#12), Ben Ode (#13) · ❌ Out: Cy Fox · ⬆️ @Dee moves up (#40)`
  @mentions for promotions keep working (linked → @mention, else plain name).
- A lone change outside a rush behaves the same; it just arrives after the 5 s quiet window. Keep it simple: one code path.
- Replies that aren't list changes stay immediate and quoted: errors, "which list?", "you're already on it", late-drop confirmation, `!me`, `!list`, Gemini text.
- Typing indicator while a batch is pending is fine; don't spam presence updates.
- Tests with fake timers: 40 sign-ups in 30 s produce a handful of list posts (not 40), all names in order, mentions kept, previous lists deleted, and a single change still posts within ~5 s.

**Done (R1).** `src/batch.ts` batches list changes per practice per chat (5 s quiet, 15 s at most); `src/bot.ts` now has a work queue and a separate send queue per chat, so pacing never holds up a write, and "typing…" is reference-counted so a rush keeps it on. The summary is one line per kind (`✅ In`, `⏳ Waitlist`, `❌ Out`, `⬆️ Moved up from the waitlist`) rather than one line joined with " · ", since a rush can name 20 people. Tested with a fake clock in `test/rush.test.ts`: 40 sign-ups and a drop in 30 s make 2 list posts, names in order, the promotion @mentioned, the first list deleted; a lone change posts after 5 s, quoted.

### R2. Down alert

**Problem.** If WhatsApp disconnects or logs the bot out, nobody notices until members complain.

**Build.** Email the addresses in a new `ALERT_EMAILS` setting (comma-separated; empty = no alerts) through the existing mailer (club Gmail):
- **Logged out** (exit 78 path): immediately, with what to do (`npm run link` again; the bot phone must have opened WhatsApp in the last 14 days).
- **Disconnected for more than 10 minutes** without reconnecting: once, then a "back online" email when it reconnects.
- **Crash on start** (anything but NotLinked): once.
- At most one email per kind per hour, so a flapping connection doesn't flood the inbox. Keep the alert state in memory or `bot.sqlite`, your call.
- Add `ALERT_EMAILS` to `.env.example`, config, README. Tests with a fake mailer and fake clock.

**Done (R2).** `src/alerts.ts`, hooked into the WhatsApp connection events and `main.ts`. The last send of each kind is kept in `bot.sqlite` (`alert_sends`), so the one-per-hour limit also holds across systemd restarts. Tested with a fake mailer and clock in `test/alerts.test.ts`.

### R3. `!where` and a club FAQ for Gemini

- **`!where [day]`** (feature `read`): the practice's place and a Google Maps link built from `event.location` (`https://www.google.com/maps/search/?api=1&query=<url-encoded location>`). No day: the next practice. Add it to `!help`, the Gemini tools (`where`), README.
- **Club FAQ.** A `bot/FAQ.md` that the board fills in, loaded at start and added to Gemini's context. Write it as a **template**: headings and short "(board: fill in)" lines for late-drop policy, what to bring, fees/dues, guests, who to contact, weather cancellations. Only state facts already true in the app (lists lock 2 hours before the first list; the waitlist moves up on its own until the lock; dropping after the lock is a late drop). Don't invent club rules. Gemini must answer club questions only from the FAQ and say "ask the board" when it isn't there. A missing or empty file is fine (no FAQ in the context). Keep the FAQ out of the privacy problem: it's club info, no member data. Test that the FAQ text reaches the prompt and that a missing file doesn't break anything.

**Done (R3).** `!where` (`read`; aliases `!location`, `!map`), in `!help` and as the Gemini tool `where`. `bot/FAQ.md` is the template; `src/faq.ts` loads it at start, leaving out the comment for the board, lines still saying "(board: fill in)" and empty sections, so Gemini only sees real answers plus the "How the list works" facts. `deploy/upload.sh` now ships `FAQ.md`. Tested in `test/where-faq.test.ts`.

### R4. Wrap-up

- README: update the commands table, the behaviour notes and config for R1–R3.
- Mark R1–R4 done here, and add anything that needs Martin under "Needs a decision".
- Push to `origin main`. Summarize what changed and what Martin's local session must do (new `.env` settings, restart, what to test in the group).

**Done (R4).** README updated (commands, batching, ban-safety notes, config, down alerts, FAQ, first live test, handover); open questions below.

## Order of work

Build phases 1 → 5 in order, committing after each with its tests passing. Push to `origin` (the fork) when done.

## Needs a decision

_(Add anything here that needs Martin, instead of guessing.)_

### 1. `!list lock` — DECIDED: removed

The app has no lock button and no function to lock early (a list locks on its own 2 hours before its first list starts). **Martin:** remove `!list lock` completely; keep `!list open`. Done: no command, help text, Gemini tool or tests for it; `!list lock thu` is now just unrecognized text.

### 2. Baileys version — DECIDED: keep 7.0.0-rc14

npm's `latest` tag is the release candidate `7.0.0-rc14`; the newest non-RC is `6.7.24` (`legacy`). v7 is needed for hidden-number (`@lid`) support: `participantAlt` on messages and the LID-to-phone mapping. **Martin:** keep 7.0.0-rc14 (pinned exactly). Only `src/whatsapp.ts` and `src/link.ts` touch Baileys.

### 3. Gemini model name — DECIDED: Martin checks it during local setup

This session couldn't reach Google's docs. `GEMINI_MODEL` defaults to `gemini-flash-latest` (Google's alias for the current Flash model) and can be set in `bot/.env`. **Martin** checks in AI Studio that it's on the free tier when setting up. No code change.

### 4. Emails — DECIDED: WhatsApp only

The first build sent the emails the bot's writes queued, through the club Gmail. **Martin:** WhatsApp only; members are expected to use the bot, not the website. Done as described under **Notifications: WhatsApp only** above (`src/quiet.ts`). The outbox-sending code is gone; the linking code email stays.

How "caused by the bot's own call" is matched: every row a Postgres function writes in one call carries that call's `now()`, and the change records it too (`members.last_signup_at` for `sign_up`, `signups.dropped_at` for `drop_signups`, `events.cancelled_at` for `cancel_event`, the walk-in's `members.created_at` for `add_signup`). The bot deletes only unsent emails with that event, that kind, a matching member, and exactly that `created_at`.

### 5. Smaller choices — DECIDED

- **Late drops ask first** — kept. `!list out thu` after the lock replies "The list has locked, so this counts as a late drop. Still drop?" and waits for `!list out thu yes`. **Martin:** keep the step, but don't say "the board is told" (board emails are paused on live). Done.
- **`!list teams thu`** shuffles and shows the draft teams in the group; sending stays in the app — fine as built.
- **Phone matching skips members without an email** (walk-ins) — fine as built.
- **Root config:** `tsconfig.json` excludes `bot/` and `eslint.config.mjs` ignores `bot/**`; nothing else outside `bot/` changed — fine as built.

### 6. Round 2 choices (say if you want them different)

- **No personal confirmation after `!in` any more.** The asker's name in the next list post is the confirmation: about 5 s later for a lone sign-up (quoted under their message), up to 15 s in a rush (not quoted). Errors, "which list?" and "you're already on it" are still instant.
- **Pending list posts are lost if the bot restarts in those 5–15 s.** The sign-ups themselves are saved; only that one list post doesn't go out, and the next change or `!list` shows the right list.
- **Alert emails name the VM:** they include the `gcloud` commands for `listbot` in `us-east1-b`, as in the README. If the VM ends up with another name or zone, those lines need changing (`src/alerts.ts`).
- **If `bot.sqlite` itself can't be opened,** the crash alert falls back to an in-memory limit, so a crash loop could send up to 10 emails before systemd stops retrying (10 starts in 10 minutes).
- **`FAQ.md` is read at start only:** after the board edits it, `upload.sh` (which restarts the bot) puts it live.
