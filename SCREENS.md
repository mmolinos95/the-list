# CBS FC · The List: Screens & Flows

_Last updated 2026-10-08. See [PLAN.md](PLAN.md) for requirements and the stack, and the [Figma brand file](https://www.figma.com/design/exUHggj6mP8kuJxiZF6iEW) for visuals._

## Design rules

Board members change every year, so the app has to explain itself.

- **One obvious main button per screen.** Secondary actions go in a "⋯" menu.
- **Plain words, no app jargon.** "Weekly schedule", not "templates". "Open sign-ups", not "launch mode".
- **Lead with status** (from the brand voice): "You're in", "You're #3 on the waitlist", "Needs teams".
- **Say what will happen before it happens.** Anything that sends email or can't be undone gets a confirm sheet that names the effect: "Email 34 players".
- **Empty states teach.** A screen with nothing on it says what to do next, and nobody needs a manual.
- **Mobile first for everyone.** Members sign up from WhatsApp, and the board runs practice from the field. Desktop just gets more room.
- **Brand:** Bebas Neue for headlines, dates and team names, Inter for everything else. Core Blue only on buttons and links, Kickoff Red only for alerts (locked, late drops, cancelled).

---

## Member screens (no login)

### M1. Home (`/`): the permanent WhatsApp link
Pin it in the group once and nobody has to post a new link.

- Header: logo + "YOUR SPOT, SORTED."
- **This week**: one card per upcoming practice, in date order. Each card shows:
  - Day + time + place ("WEDNESDAY · 12:30 PM · Riverside Park")
  - A status chip: `OPENS TUE 9:00 AM` · `OPEN · 31/40` · `FULL · 3 WAITING` · `LOCKED` · `TEAMS ARE OUT` · `CANCELLED`
  - Your own status if the browser remembers you: "You're in" / "Waitlist #3"
- Tap a card to go to its practice page.
- Empty state: "No practices scheduled right now. Check the WhatsApp group for news."

### M2. Practice page (`/p/<date-day>`, e.g. `/p/2026-10-08-wed`)
Shareable on its own when the board wants to point at one practice. Header (Columbia Blue): **WEDNESDAY PRACTICE**, date · time · place, plus a chip for when it locks.

The body changes with the practice's stage:

| Stage | What the member sees |
|---|---|
| **Opens soon** | "OPENS TUE AT 9:00 AM" with a live countdown, plus details and caps. At zero it **switches to the sign-up form on its own**, with no refresh. |
| **Open** | Sign-up card (below), then the public list. |
| **Full** | Same as Open, but full lists say "FULL · you'd be #4 on the waitlist" and the button reads **JOIN THE WAITLIST**. |
| **Locked** | Red banner: "Sign-ups closed at 10:30 AM." No form. Your status and drop button stay. The list is still visible. |
| **Teams are out** | Your color, big: **YOU'RE ON RED**. Then all four teams below. |
| **Cancelled** | **PRACTICE IS OFF** + the board's reason. |
| **Past** | Read-only final list and teams. |

**Sign-up card (Open/Full)**
- First time: name, email, phone (with a country-code picker; it defaults to +1, and the number is saved in international format).
- Returning: "Welcome back, Martin 👋", your saved email · phone, and "Not you? Edit details".
- **List checkboxes**: ☐ Skills (31/40) ☐ Games (FULL · 3 waiting). They default to whatever you picked last time.
- One button: **SAVE MY SPOT**, or **JOIN THE WAITLIST** if every list you picked is full.
- One combined confirmation email, even if you picked both lists.

**After signing up**: the card turns into your status, one line per list:
- "YOU'RE IN · Skills #23 of 40" with a **Drop out** link next to it
- "YOU'RE #3 ON THE WAITLIST · Games". Below that: "If someone drops before 10:30 AM, you move up automatically and we'll email you."
- "We emailed you a confirmation. It has a drop-out link that works on any device."

**Edge cases, in plain words**
- Already on that list: "You're already on the Skills list (#12)." Nothing changes.
- Someone took the last spot while you were filling in the form: the sign-up still goes through, and the result says "The last spot just went, so you're #1 on the waitlist."

**The public list**: one tab per list (SKILLS · GAMES), with numbered full names, gold checks for confirmed spots, then a **WAITLIST** section in order. Your own row is highlighted.

### M3. Drop out (`/drop/<token>`): opened from the email, or the page's Drop out link
- "Drop out of Wednesday practice?" with your spots listed and a checkbox for each list. All are ticked by default.
- Before the lock: "Your spot goes to the next teammate on the waitlist."
- After the lock, a gentle note with no guilt trip: "The list is locked, so your spot won't be refilled automatically. We'll let the board know so they can sort it out."
- Button: **DROP OUT**
- Done: "You're off the list. Thanks for freeing up the spot." / "Changed your mind? Sign up again. You'll join the end of the list."
- Invalid or used link: "This link has already been used or has expired." plus a link to the home page.

---

## Board screens (`/admin`, login required)

### Roles

| | Board member | President |
|---|---|---|
| Run practices: open sign-ups, edit one practice, add/remove sign-ups, promote, build & publish teams, cancel, message the list | ✅ | ✅ |
| See late drops | ✅ | ✅ |
| Edit the weekly schedule | view only | ✅ |
| Invite/remove board members, change roles | — | ✅ |

### B0. Log in (`/admin/login`)
- One field: "Your email". Button: **SEND ME A LOGIN LINK**.
- Always replies "If you're on the board, a login link is on its way.", so it doesn't reveal who has access.
- No passwords.

### B1. Practices home (`/admin`): a to-do list, not a dashboard
- Bottom nav (sidebar on desktop): **Practices · Schedule · Late drops · Board**
- One card per upcoming practice, in date order, each with its status and **the one thing it needs next**:
  - Sign-ups open by hand and it isn't open yet: **OPEN SIGN-UPS**
  - Open: counts ("Skills 31/40 · Games 40/40 + 3 waiting"), button **VIEW**
  - Locked and the Games list has no teams yet: **BUILD TEAMS**
  - Teams sent: "Teams sent ✓"
  - Late drops: red chip "2 LATE DROPS"
- First run (empty): "No practices yet. Set up your weekly schedule and practices will appear here automatically." **SET UP SCHEDULE**
- Footer link: "How this works": a single help page for new board members.

### B2. Practice detail (`/admin/p/<date-day>`)
- Header: practice info + stage chip. Main button depends on stage: **OPEN SIGN-UPS** / **BUILD TEAMS** / **VIEW TEAMS**.
- "⋯" menu: **Edit this practice** · **Message the list** · **Cancel practice**
- Tabs per list (SKILLS · GAMES):
  - **Main list**: numbered names. Tap a name to see email, phone and sign-up time, plus **Remove from list**.
  - **Waitlist**: in order. After the lock, each row has a **PROMOTE** button. Before the lock a hint says "Promotion is automatic until 10:30 AM."
  - **+ ADD SOMEONE**: name required; email and phone optional (for walk-ins). They go to the end of the list.
  - **Dropped (3)**, collapsed: who left and when. Late drops are flagged red.
- Removing someone before the lock automatically promotes the first person on the waitlist (and emails them). The confirm sheet says so.

### B3. Edit this practice
- Time, place, and cap per list. Changes apply to this practice only: "To change every Wednesday, edit the weekly schedule."
- Raising a cap before the lock promotes people from the waitlist automatically.
- Lowering a cap never removes anyone already in. The help text says so.
- Checkbox: ☐ "Email everyone on the list about this change". Default on if the time or place changed.

### B4. Message the list
- Text box, with recipient checkboxes: ☑ Main list ☐ Waitlist
- Preview of the email in brand style, then **SEND TO 34 PLAYERS**.

### B5. Cancel practice
- Optional reason ("Field closed for rain").
- Confirm sheet: "Cancel Wednesday practice? We'll email the 43 people signed up. This can't be undone." **CANCEL PRACTICE**

### B6. Team builder (`/admin/p/<date-day>/teams`)
Uses the main list of every list marked "Split into teams" (Games).

- **Unassigned** tray at the top, then four sections: **BLACK · WHITE · RED · LIGHT BLUE**, each with a count ("RED · 10").
- Two ways in, both always available:
  - **SHUFFLE INTO TEAMS** splits everyone randomly and evenly. If teams are already filled, it asks first: "Reshuffle everyone?"
  - Place by hand: tap a name, then tap a color in the sheet that pops up (on phones). Drag and drop on desktop.
- People added late show up in Unassigned with a "New" tag.
- Main button: **SEND TEAMS** → confirm "Email 40 players their team color and show teams on the practice page." Members then see their color on M2.
- After sending, moving someone shows **SEND UPDATES (2)**, which emails only the players who moved.

### B7. Weekly schedule (`/admin/schedule`)
- One card per recurring practice: "WEDNESDAY · 12:30–2:00 PM · Riverside Park · Skills 40 · Games 40 · Opens Tue 9:00 AM".
- Edit form that reads like a sentence:
  - Every **[Wednesday]** from **[12:30 PM]** to **[2:00 PM]** at **[Riverside Park]**
  - Lists: **[Skills]** cap **[40]** ☐ split into teams · **[Games]** cap **[40]** ☑ split into teams · + Add list
  - Sign-ups open: ◉ **[the day before]** at **[9:00 AM]** ○ when a board member presses "Open sign-ups"
  - Locks 2 hours before kickoff (fixed, with the explanation shown)
- **Pause** toggle per practice, for breaks and exams: no new practices are created while it's paused.
- Board members see this screen read-only, with "Only presidents can change the schedule."

### B8. Late drops (`/admin/drops`)
- Newest first: name · practice · "dropped 1h 10m before kickoff".
- Tap a name to see that person's history: "3 late drops this semester".
- Empty state: "No late drops. 🙌"

### B9. Board (`/admin/board`)
- Everyone with access, with a role badge: PRESIDENT / BOARD.
- Presidents see: **INVITE** (email + role), plus on each person: **Make president / Make board member**, **Remove**.
- The last president can't be removed or demoted. The button is disabled with "The club needs at least one president."
- Anyone can **Leave the board** (except the last president).
- Handover tip shown to presidents: "New board? Invite them, make the new presidents presidents, then remove yourselves."

---

## Key flows

**1. A normal Wednesday (fully automatic)**
Daily cron creates Wed practice → Tue 9:00 AM sign-ups open on their own → members sign up from the pinned link → drops before 10:30 AM promote the waitlist + email → 10:30 AM lock → board opens the app, sees **BUILD TEAMS**, shuffles, tweaks, **SEND TEAMS** → players get their color.

**2. Member signs up for the first time**
WhatsApp link → Home → Wednesday card → fills in name/email/phone, ticks Skills + Games → **SAVE MY SPOT** → status card + one email with the drop link. Next time: open the link, tap **SAVE MY SPOT**.

**3. Late drop**
Member taps the drop link after 10:30 → sees the gentle note → **DROP OUT** → board gets an email and a red "1 LATE DROP" chip on the home screen → board promotes someone from the waitlist (who gets an email) → if teams were already sent, the builder shows the gap and **SEND UPDATES**.

**4. Rainout**
Board member → practice → ⋯ → Cancel practice → reason → confirm → everyone gets an email, and the page shows PRACTICE IS OFF.

**5. Yearly handover**
Outgoing president → Board → Invite incoming board (new presidents as PRESIDENT) → new people tap their login link → outgoing board removes themselves.

---

## Emails (all in brand style, via club Gmail)

| Email | Sent to | Trigger |
|---|---|---|
| You're in / you're on the waitlist (one email for all lists picked) + drop link | Member | Sign-up |
| A spot opened up and it's yours | Member | Auto or manual promotion |
| Your team: RED | Each player on a teams list | Send teams / send updates |
| Practice is off | Everyone on the lists + waitlist | Cancel practice |
| Practice changed | Everyone on the list | Edit practice with the email box ticked |
| Message from the board | Chosen recipients | Message the list |
| Late drop heads-up | All board members | Drop after the lock |
| Login link / board invite | Board member | Login, invite (Supabase Auth sent through the club Gmail) |
