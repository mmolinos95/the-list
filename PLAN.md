# CBS Futbol Club — Attendance App Plan

_Status: planning (last updated 2026-10-07)_

## Problem

Practice sign-ups start with a Google Form. Then everyone spams the WhatsApp group adding their names to the list. Nobody can easily tell who's in, who's waitlisted, or who dropped out. Anyone can edit anyone else's spot.

## Goal (proof of concept)

A web app, linked from the club WhatsApp group, where presidents schedule and launch sign-up lists. Members sign up up to a cap, and the overflow goes to a waitlist that promotes people automatically. Notifications go out by email.

## Club context

- ~200 members; 20–60 show up to a given practice.
- Practices: Monday, Wednesday, Friday.
- Usual cap: 40 per list.
- 3–5 presidents today, but the number of admins should be unlimited.

## Roles

| Role | How they access | What they can do |
|---|---|---|
| **President** (admin) | Real login | Manage templates and events, launch lists, manually promote, build teams, see drop history |
| **Member** | No account. Signs up with name, email, and phone | Sign up, drop out via a personal link |

## Features

### 1. Event templates & scheduling (presidents)
- Create **templates** for recurring practices (e.g., Mon/Wed/Fri), with day, time, location, and cap.
- Each template sets a **launch mode**:
  - **Auto**: the list opens at a scheduled time (e.g., "Sunday 8pm").
  - **Manual**: a president presses "Launch".
- A single occurrence can be edited (time, location, cap) without changing the template.
- An event can have **multiple lists** (e.g., Skills and Games), each with its own cap. A member can sign up for **both**.

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
- **Public list:** everyone sees the main list and waitlist **names** in order. Emails and phones stay hidden.
- Returning members are recognized by email, so drop history follows the person across events.

### 3. Lock (2 hours before kickoff)
- The list locks **2 hours before start time**. No new sign-ups after that.
- **Automatic waitlist promotion stops** at the lock.
- Presidents can **manually promote** someone from the waitlist after the lock.
- Members **can still drop out** after the lock. That's frowned upon, so the app will:
  - **record** it (who dropped, when, how close to kickoff),
  - **notify the presidents** by email,
  - keep a **drop history** that presidents can review.

### 4. Teams
- Presidents split the final list into **4 teams of ~10**:
  - **Black**
  - **White**
  - **Red**
  - **Light Blue**
- Teams are built with **drag-and-drop**.
- Each player is **told their team color by email**.

### 5. Notifications (email only for the proof of concept)
- Sign-up confirmation (main list or waitlist position) + drop-out link.
- Promoted from the waitlist.
- Team color assignment.
- Presidents are told about drops after the lock.

## Out of scope for now
- WhatsApp/SMS notifications. They may come later if the club wants them.
- Non-practice events (games, socials, tournaments). We'll add them after feedback.
- Member accounts / login.
- Payments, skill ratings, attendance check-in.

## Open questions
- Team emails: teams are built after sign-up, so a team color can't be in the *sign-up* confirmation. Assumption: a separate "your team" email goes out when presidents publish teams.
- If someone drops after teams are made, the president fixes the teams by hand. No automatic rebalancing.

## Tech stack (decided 2026-10-07)

| Layer | Choice |
|---|---|
| App (frontend + server) | Next.js, React, TypeScript |
| Hosting | Vercel (free tier) |
| Database + president login | Supabase (Postgres, free tier) |
| Email | Resend (free tier) |
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

### Launch announcements
- No "sign-ups are open" email. Presidents post the link in WhatsApp as they do today. This keeps email volume within the free tiers.

## Where we left off (2026-10-07)
- Requirements and tech stack are settled. Nothing is built yet.
- Martin is designing a logo and visuals in Figma first.
- Next planning topics, in suggested order:
  1. **Screens and flows**: sign-up page, president dashboard, team builder.
  2. **Data model**: templates, events, lists, sign-ups, drops, teams.
  3. **Build phases**: v1 → v2 → v3, to get club feedback early.
