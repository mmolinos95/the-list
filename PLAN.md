# CBS Futbol Club — Attendance App Plan

_Status: built, waiting on accounts to deploy (last updated 2026-10-08)_

## Problem

Practice sign-ups start with a Google Form. Then everyone spams the WhatsApp group adding their names to the list. Nobody can easily tell who's in, who's waitlisted, or who dropped out. Anyone can edit anyone else's spot.

## Goal (proof of concept)

A web app, linked from the club WhatsApp group, where presidents schedule and launch sign-up lists. Members sign up up to a cap, and the overflow goes to a waitlist that promotes people automatically. Notifications go out by email.

## Club context

- ~200 members; 20–60 show up to a given practice.
- Practices: Monday, Wednesday, Friday.
- Usual cap: 40 per list.
- 3–5 presidents today, plus other board members. Admin access is unlimited, and the board changes every year, so the app must need no onboarding.

## Roles

| Role | How they access | What they can do |
|---|---|---|
| **President** | Email login link (no password) | Everything a board member can do, plus edit the weekly schedule and invite/remove board members and change roles |
| **Board member** | Email login link (no password) | Run practices: open sign-ups, edit/cancel a practice, add/remove sign-ups, manually promote, build & send teams, message the list, see drop history |
| **Member** | No account. Signs up with name, email, and phone | Sign up, drop out via a personal link |

- **Handover:** presidents invite the new board and promote successors to president, then remove themselves. The app never allows removing the last president.
- Full screen-by-screen detail is in [SCREENS.md](SCREENS.md).

## Features

### 1. Event templates & scheduling (presidents)
- Create **templates** for recurring practices (e.g., Mon/Wed/Fri), with day, time, location, and cap.
- Each template sets a **launch mode**:
  - **Auto**: the list opens at a time set on the template (today the club opens lists the morning before practice).
  - **Manual**: a president presses "Launch".
- A single occurrence can be edited (time, location, cap) without changing the template.
- An event can have **multiple lists** (e.g., Skills and Games), each with its own cap. A member can sign up for **both** in one tap, which sends one combined email.
- A template can be **paused** (breaks, exams), and then no events get created.
- The board can **cancel** a practice (with an optional reason, emailing everyone), **message the list**, **remove** a sign-up (fakes/duplicates), and **add someone by hand** (walk-ins; email optional).
- Members reach everything from **one permanent link** pinned in WhatsApp, which shows this week's practices. Each practice also has its own shareable link.

### 2. Sign-up & waitlist
- **First-come-first-served.** Sign-ups must be atomic, so two near-simultaneous submissions can never both take the last spot.
- The sign-up confirmation email includes a **personal drop-out link**, so only that person can remove themselves.
- Once the main list is full, sign-ups go to the **waitlist** in order.
- If someone drops **before the lock**:
  - The first person on the waitlist is **auto-promoted**.
  - That person gets an email.
- **Sign-up fields** (all required):
  - **Name**
  - **Email** (any domain)
  - **Phone number** (collected now so WhatsApp can be added later)
- Phone numbers are stored in international format (e.g., +1…, +44…), since many members have non-US numbers.
- **Remember me:** name, email, and phone are saved in the member's browser, so the next sign-up is one tap.
- **Public list:** everyone sees the main list and waitlist **full names** in order. Emails and phones stay hidden.
- **One spot per email per list.** The same email can't sign up twice for the same list. There's no email-confirmation step, so spots are instant.
- Returning members are recognized by email, so drop history follows the person across events. If they sign up with a new name or phone, the **latest details win**.
- **Data retention:** members who haven't signed up in 12 months are deleted automatically, along with their history.

### 3. Lock (2 hours before kickoff)
- The list locks **2 hours before start time**. No new sign-ups after that.
- **Automatic waitlist promotion stops** at the lock.
- The board can **manually promote anyone** from the waitlist after the lock. The next in line is suggested, and every promotion records who did it.
- Walk-ins added by hand: the board chooses main list (can exceed the cap) or waitlist (default).
- Members **can still drop out** after the lock. That's frowned upon, so the app will:
  - **record** it (who dropped, when, how close to kickoff),
  - **notify the presidents** by email,
  - keep a **drop history** that presidents can review.

### 4. Teams
- Each list has a **"split into teams"** setting. Today that's on for Games only.
- The board splits the final list into **4 teams of ~10**:
  - **Black**
  - **White**
  - **Red**
  - **Light Blue**
- **Shuffle into teams** (random, even split), then tweak by hand: tap a name, then a color, on phones, or drag and drop on desktop. Building from scratch by hand also works.
- Each player is **told their team color by email**.

### 5. Notifications (email only for the proof of concept)
- Sign-up confirmation (main list or waitlist position) + drop-out link.
- Promoted from the waitlist.
- Team color assignment.
- Board members are told about drops after the lock.
- Practice cancelled; practice changed (optional); message from the board.

## Out of scope for now
- WhatsApp/SMS notifications. They may come later if the club wants them.
- Non-practice events (games, socials, tournaments). We'll add them after feedback.
- Member accounts / login.
- Payments, skill ratings, attendance check-in.

## Open questions
- Team emails: teams are built after sign-up, so a team color can't be in the *sign-up* confirmation. Assumption: a separate "your team" email goes out when presidents publish teams.
- If someone drops after teams are made, the board fixes the teams by hand and **sends updates** only to the players who moved. No automatic rebalancing.

## Tech stack (decided 2026-10-07)

| Layer | Choice |
|---|---|
| App (frontend + server) | Next.js, React, TypeScript |
| Hosting | Vercel (free tier) |
| Database + president login | Supabase (Postgres, free tier) |
| Email | Club Gmail via SMTP (free, ~500/day, no domain needed) |
| Drag-and-drop teams | dnd-kit |

### Guiding principles
- **Maintainable and handoff-ready.** Use mainstream tools, keep it well documented, and keep it free to run. A future club board should be able to take it over.
- **Built to expand.** Paid add-ons like WhatsApp are likely later. To prepare:
  - Notifications go through one **channel interface**. Email is the first implementation, and WhatsApp/SMS can plug in later without touching the sign-up logic.
  - Generic "events", so games, socials, and tournaments can be added without a redesign.
- **Sign-ups are atomic.** A database transaction locks the list before counting and inserting.
- **Status is derived from timestamps.** "Open", "locked", and "full" are computed from the event's times rather than flipped by background jobs.

### Accounts
- Personal accounts for the proof of concept. Move to a club-owned Gmail that owns GitHub, Vercel, Supabase, and Resend once the club adopts the app.

### Event creation
- A daily **Vercel cron job** creates upcoming events from templates ahead of time.
- The list opens at the event's `opens_at` timestamp, which comes from the template's open time. The cron job only creates events, so lists still open on the dot even though free-tier cron timing is approximate.

### Presidents
- Presidents **invite new presidents by email**, and the invitee gets a login link. Any president can remove another.

### Time zone
- Times are stored in UTC and shown in New York time. The 2-hour lock uses the same clock.

### Launch announcements
- No "sign-ups are open" email. Presidents post the link in WhatsApp as they do today. This keeps email volume within the free tiers.

### Operations notes (for handoff docs)
- Supabase free projects pause after ~1 week with no activity, e.g. over winter/summer break. Unpause from the dashboard, or add a keep-alive ping.
- Gmail SMTP needs an app password on the club Gmail account.
- Login links are generated by the app and sent from the club Gmail, so Supabase's own (rate-limited) mailer is never used and needs no setup.

## Brand & design
- Figma: https://www.figma.com/design/exUHggj6mP8kuJxiZF6iEW (Brand Identity page)
- Product name: **CBS FC · The List**. Tagline: "Your spot, sorted."
- Colors: Columbia Blue `#B9D9EB`, White `#FFFFFF`, Crest Gold `#E3B43C` (confirmed checks), Core Blue `#1D4F91` (buttons/links only), Kickoff Red `#D6453D` (alerts only: locked, late drops), Black `#111418`.
- Type: Bebas Neue (all-caps display: headlines, dates, team names) + Inter (body, UI, emails).
- Voice: clear, warm, fair. Lead with status ("You're in", "You're #3 on the waitlist").
- Existing mockups: mobile sign-up screen, sign-up confirmation email, practice poster.
  - Note: the mock's list shows "Sofia R."; we decided on **full names**.

## Build plan (decided 2026-10-08)

**Goal: the full app built this weekend, ready to roll out to the club by Sunday morning, Oct 11.** Paid features (WhatsApp/SMS, custom domain) wait until after the club has tested it. The link is a free `*.vercel.app` URL.

Build in this order, so there's always a complete, working app to launch, even if the last steps slip:

| # | Milestone | Done when |
|---|---|---|
| 0 | **Setup**: Next.js app, Supabase schema + RLS + functions, brand tokens (Bebas Neue, Inter, palette), deployed to Vercel | A blank branded page is live, and migrations run |
| 1 | **Members**: home, practice page (all stages), sign-up, waitlist + auto-promotion, drop page, sign-up/promoted/late-drop emails | A member can sign up and drop out end to end on the live URL |
| 2 | **Board core**: magic-link login, practices to-do home, practice detail (open sign-ups, add/remove/promote), weekly schedule, daily cron | The board can run a practice without touching the database |
| 3 | **Teams**: shuffle + tap/drag builder, send teams, send updates, teams on the practice page | Teams go out by email |
| 4 | **Board tools**: edit practice, cancel, message the list, late drops page, board invite/roles, help page | Everything in SCREENS.md exists |
| 5 | **Hardening**: concurrency test for sign-ups, 12-month cleanup, email retry, handoff README, board dry run | Ready to post in WhatsApp |

### Needed from Martin (accounts Claude can't create)
- Supabase project (free) → project URL, anon key, service-role key.
- Vercel account linked to GitHub, and a GitHub repo.
- A Gmail account to send from, with 2-Step Verification on, plus an **app password**.
- Emails of the first presidents (seeded by hand; after that they invite everyone else in the app).
- Real Mon/Wed/Fri times, places, lists and caps. These can be entered in the app's schedule screen, so they don't block the build.

## Where we left off (2026-10-08)
- Milestones 0–5 are built: member pages, board login and every board screen in SCREENS.md, teams, the daily job, email retry, the 12-month cleanup, and the handoff [README](README.md).
- Checks: `npm test` (database rules, seed, email templates), lint, typecheck and `next build` all pass. Nothing has run against a real Supabase project yet.
- Next: Martin creates the accounts (Supabase, Vercel, club Gmail app password), follows the README setup, and does a board dry run before posting the link in WhatsApp.
- Any new Figma work goes in Martin's Figma **Drafts**, not the UI/UX class folder.
