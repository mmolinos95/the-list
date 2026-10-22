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
- **Email** with `nodemailer` + the club Gmail (same as the app). With no Gmail settings, print emails to the terminal, the way the app does in development.
- Local state (linked WhatsApp IDs, pending link codes, rate limits) in `node:sqlite`, in a file next to the auth state, gitignored. It holds personal data, so it lives only on the VM.

## How it behaves in WhatsApp (ban safety)

The bot number is unofficial (Baileys), so WhatsApp can ban it. Behave like a quiet human:

- Listen only in the groups named in `ALLOWED_GROUPS`. Ignore every other group.
- Only react to messages starting with `!list` (case-insensitive) or @mentioning the bot.
- Reply quoted under the question. Show "typing…" while working. One question at a time per chat; queue the rest.
- Never @mention everyone. Never send a message nobody asked for, except a board-triggered `!list post`.
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
   - If no member has that email (new member), also ask their full name and phone with country code, then keep them as a pending member in local state. The database row is created by their first `sign_up`, which takes name, email and phone.
   - Say "you're set, go back to the group" and stop.

**Board:** a sender is board if their linked member's email is in `board_members`. Board actions that take `p_by` get that board member's id.

## Commands

Practices are picked with loose input: `thu`, `thursday`, `10/23`, `next`. Times are shown in New York time (see `src/lib/time.ts`). Keep replies short and WhatsApp-formatted (`*bold*`).

| Phase | Who | Command | Does |
|---|---|---|---|
| 1 | Anyone | `!list` or `!list help` | Upcoming practices with spots left per list; short help |
| 1 | Anyone | `!list thu` | Time, place, each list's count / cap and waitlist size |
| 1 | Member | `!list me` | Their spots and waitlist positions |
| 2 | Board | `!list post thu` | Posts the same text as **Copy WhatsApp post** (`src/lib/share.ts`), with the signed link (`src/lib/signup-link.ts`, uses `DROP_LINK_SECRET`) |
| 3 | Member | `!list in thu [list]` | `sign_up(event, lists, name, email, phone)`. If the practice has more than one list and none was named, ask which. Reply with main/waitlist result |
| 3 | Member | `!list out thu [list]` | `drop_signups(event, member, lists)` |
| 4 | Board | `!list lock thu` / `!list open thu` | The same as the app's buttons (check `src/app/admin/actions.ts` for which functions they call) |
| 4 | Board | `!list cancel thu [reason]` | `cancel_event(event, reason, by)`. Ask to confirm first (`!list cancel thu yes`) |
| 4 | Board | `!list add thu Name [list] [waitlist]` | `add_signup(list, name, null, null, spot, by)` |
| 4 | Board | `!list teams thu` | `shuffle_teams`, then show the teams |
| 5 | Anyone | `@bot <any question>` or `!list <free text>` | Gemini picks one of the commands above (function calling) and the bot runs it with the same permission checks. Gemini never writes to the database directly. |

Notices about spots opening or cancellations are **not** automatic. They only go out when the board asks.

**Gemini privacy:** the free tier may be used by Google for training. Only send Gemini the question, practice times, places and counts, and the asker's own status. Never send other members' names, emails or phones. If Gemini is out of quota or slow (over 20s), say so and suggest the plain commands.

## Config (`bot/.env.example`)

```
SUPABASE_URL=
SUPABASE_SECRET_KEY=
DROP_LINK_SECRET=          # same value as the app's, so posted links work
SITE_URL=https://cbsfc-the-list.vercel.app
GMAIL_USER=
GMAIL_APP_PASSWORD=
GEMINI_API_KEY=
BOT_PHONE=                 # E.164, the bot's own number (pairing + wa.me links)
ALLOWED_GROUPS=            # exact group names, comma-separated
BOT_FEATURES=read          # any of: read,post,signup,board,ai
DATA_DIR=./data            # auth state + local db
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

## Order of work

Build phases 1 → 5 in order, committing after each with its tests passing. Push to `origin` (the fork) when done.

## Needs a decision

_(Add anything here that needs Martin, instead of guessing.)_

### 1. `!list lock` has nothing to call (phase 4)

The app has no lock button: `src/app/admin/actions.ts` only has **Open sign-ups** (`open_event`). A list locks on its own 2 hours before its first list starts (`locks_at`, kept by the `events_locks_at` trigger), and there is no database function to lock earlier. Locking early would need a migration (e.g. a `lock_event` function, plus letting `locks_at` differ from `starts_at − 2h`), which the hard rules rule out.

**What the bot does now:** `!list lock thu` (board only) replies with when the list locks on its own. `!list open thu` calls `open_event`, like the app's button.

**Decide:** keep that, drop the command, or add an early-lock function to the app (upstream) first.
