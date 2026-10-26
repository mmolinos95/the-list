# CBS FC · The List

**A WhatsApp AI bot and web app that run practice sign-ups for a ~200-member soccer club at Columbia Business School.** Members sign up, drop out and see who's coming without leaving the group chat (`!in`, `!out`, `!list`), or just ask in plain English ("@bot will it rain Friday?"). A waitlist moves up on its own, and the board runs practices and teams from their phones.

> Showcase copy of a club project by [Martin Molinos](https://github.com/mmolinos95). The club's own repositories are private; this copy has the same code and full commit history (Oct 7–30, 2026). No secrets or member data are included.

### At a glance

| | |
|---|---|
| **Problem** | Sign-ups ran through a Google Form plus people re-posting the list in a 148-person WhatsApp chat: nobody knew who was in, and anyone could edit anyone's spot |
| **Web app** | Next.js 16 + Supabase (Postgres) on Vercel. Private per-practice links, first-come-first-served with a concurrency-safe last spot, automatic waitlist, 2-hour lock, late-drop tracking, team builder, board tools, email login without passwords. Live in about a day |
| **WhatsApp bot** ([bot/](bot/)) | Node.js service on a free-tier Google Cloud VM. Connects as a linked WhatsApp device (Baileys). `!` commands for everything, Google Gemini for plain-English questions (tool calling with the same permission checks, short memory, model fallback), live weather from Open-Meteo, batched list posts for the sign-up rush, down alerts by email |
| **One rulebook** | Every sign-up rule is a Postgres function shared by the website and the bot, so they can't disagree |
| **Privacy** | Names are shown like the public list; phones and emails never. Member names never reach the AI provider (tested) |
| **Quality** | 208 automated tests (59 app, 149 bot) against an in-memory Postgres with the real migrations; everything runs offline |
| **Cost** | $0/month on free tiers |
| **How it was built** | I owned the product (problem discovery, ~80 documented decisions, brand and UX, testing with real users, release and cost decisions) and directed AI coding agents (Claude Code, local and in the cloud) that wrote the code. Planning docs and the agent brief are in the repo: [PLAN.md](PLAN.md), [SCREENS.md](SCREENS.md), [DATA_MODEL.md](DATA_MODEL.md), [bot/BRIEF.md](bot/BRIEF.md) |

The rest of this README is the club's setup and operations guide.

---

_Your spot, sorted._ The practice sign-up list for CBS FC: members sign up from the link the board posts in WhatsApp for each practice, the overflow goes to a waitlist that moves up on its own, and the board runs practices and teams from their phones.

- **Members** (no account): the practice's link from WhatsApp (`/p/<date-day>?k=…`) → sign up. Drop out with the personal link in their email. Without a valid link, the site only says "Get the link in WhatsApp".
- **Board** (email login link, no password): `/admin`.
- Requirements: [PLAN.md](PLAN.md) · Screens: [SCREENS.md](SCREENS.md) · Database: [DATA_MODEL.md](DATA_MODEL.md)

It runs for free on Vercel (app), Supabase (database + login) and the club Gmail (email).

---

## Setup (about 30 minutes, once)

You need: a GitHub account with this repo, and the club Google account. Use the club account for every service below, so the next board inherits everything.

### 1. Supabase (database)

1. Create a free project at [supabase.com](https://supabase.com). Region: US East. Save the database password somewhere safe.
2. **SQL Editor → New query**: paste and run, in order:
   1. `supabase/migrations/20261008000001_schema.sql`
   2. `supabase/migrations/20261008000002_functions.sql`
   3. `supabase/migrations/20261008000003_list_times.sql`
   4. `supabase/migrations/20261008000004_board_daily.sql`
   5. `supabase/seed.sql`, **after** changing the president's email (and the practice times and place, if you know them; they can also be fixed later in the app).
3. **Authentication → Sign In / Providers**: turn **off** "Allow new users to sign up". (The app creates board logins itself; this stops strangers from making accounts.)
4. **Project Settings → API Keys**: copy the **Project URL**, the **publishable** key and a **secret** key for the next step.

> Using the Supabase CLI instead? `supabase link` then `supabase db push` runs the migrations; run `seed.sql` in the SQL editor.

### 2. Gmail (sending email)

1. On the club Google account, turn on **2-Step Verification** (Google Account → Security).
2. Go to **Security → App passwords**, create one called "The List", and copy the 16-letter password.
3. Gmail allows about 500 emails a day. The app stops at 450, so login links always get through. A full Games list getting team emails is 40.

### 3. Vercel (the app)

Deploys go through the Vercel CLI, not Git: Vercel's free plan won't build a private repo owned by a GitHub organization. Pushing to GitHub does **not** deploy.

1. Sign up at [vercel.com](https://vercel.com) with the club Google account (Hobby plan), then in this folder run `npx vercel login` and `npx vercel link`.
2. Add the environment variables below to **Production** (`npx vercel env add NAME production`, or Settings → Environment Variables). Don't copy `SITE_URL=http://localhost:3000` from `.env.local`.

   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | Project URL from Supabase |
   | `SUPABASE_PUBLISHABLE_KEY` | Publishable key |
   | `SUPABASE_SECRET_KEY` | Secret key (keep it secret: it can read everything) |
   | `DROP_LINK_SECRET` | A long random string (`openssl rand -base64 32`). Signs drop-out, sign-up and one-tap board links; changing it breaks the ones already sent. |
   | `CRON_SECRET` | Another long random string. Vercel sends it to the daily job automatically. |
   | `GMAIL_USER` | The club Gmail address |
   | `GMAIL_APP_PASSWORD` | The app password from step 2 |
   | `SITE_URL` | Optional. Defaults to the Vercel production URL. Set it if you add a custom domain. |

3. **Deploy:** commit, then `npm run deploy`. It deploys the last commit (see [scripts/deploy.sh](scripts/deploy.sh)). The daily job in [vercel.json](vercel.json) is picked up automatically (Settings → Cron Jobs shows it).
4. Open `https://<your-app>.vercel.app/admin/login`, enter the president's email, and press the link in the email.
5. On **Schedule**, check the practices. On **Board**, invite the rest of the board.
6. For each practice, open it under **Practices**, press **Copy WhatsApp post**, and paste it in the group. Each practice has its own link that stops working when it ends, so there's no permanent link to pin.

---

## Day to day

Nothing to do. The board's guide is in the app at `/admin/help`.

- **Daily job** (`/api/cron`, 10:00 UTC): creates practices two weeks ahead, sends any emails still waiting, retries failed ones, and deletes members who haven't signed up in 12 months.
- **Emails failing?** The board home shows a **Retry** button. Common causes: the Gmail app password was revoked (make a new one and update `GMAIL_APP_PASSWORD` on Vercel, then `npm run deploy`), or the daily limit was hit (they go out the next day).
- **Supabase paused?** Free projects pause after about a week without activity. The daily job normally prevents that, but if the site shows errors after a long break, open the Supabase dashboard and press **Restore project**.
- **Locked out of the board?** If every president lost access, add one back in the Supabase SQL editor:
  ```sql
  insert into board_members (email, name, role) values ('new.president@example.com', 'Name', 'president')
  on conflict (email) do update set role = 'president';
  ```
- **Yearly handover:** the outgoing presidents invite the new board in the app, make the new presidents presidents, then remove themselves. Then hand over the club Google account (it owns Vercel, Supabase and the Gmail), and make the new maintainer an owner of the [cbs-futbol-club](https://github.com/cbs-futbol-club) GitHub organization, which holds the code.

---

## Development

```bash
npm install
cp .env.example .env.local   # fill in the Supabase keys; leave Gmail empty to print emails to the terminal
npm run dev                  # http://localhost:3000
npm test                     # database rules, against an in-memory Postgres (PGlite)
npm run lint && npx tsc --noEmit && npm run build
```

Point `.env.local` at a separate Supabase project for development, not the club's live one.

### How it's built

| | |
|---|---|
| `supabase/migrations/` | Tables, and every rule as a Postgres function: caps, waitlist, auto-promotion, the lock, late drops, teams, the weekly schedule. Sign-ups lock the list row, so two people can never take the last spot. |
| `tests/db/` | Tests for those rules. |
| `src/lib/` | Server helpers: database client, board auth, New York time, drop-out links, email. |
| `src/lib/notify/` | Notifications. Emails are queued in the database with the change, then sent right after the response. `channel.ts` is the seam for adding WhatsApp/SMS later. |
| `src/app/` | Member pages (`/`, `/p/[slug]`, `/drop/[token]`), board pages (`/admin/...`) and the daily job (`/api/cron`). |

Next.js 16 with Cache Components: pages render a static shell and stream the live data inside `<Suspense>`. Read `node_modules/next/dist/docs/` before changing framework-level code (see [AGENTS.md](AGENTS.md)).

All times are stored in UTC and shown in New York time. Each list has its own time; a practice runs from its first list to its last and locks 2 hours before the first one.
