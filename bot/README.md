# The List bot (WhatsApp)

A WhatsApp bot for [The List](../README.md). It sits in the club's WhatsApp group: members ask it about practices and sign up or drop out from the chat, and the board posts sign-up messages and runs practices from the chat. The web app is unchanged and stays the fallback if the bot is down or banned.

- Plan and rules it was built to: [BRIEF.md](BRIEF.md) (open questions are at the end, under **Needs a decision**).
- It talks to the same Supabase database as the app, only through the Postgres functions the app already uses, so every rule (caps, waitlist, lock, late drops) holds the same way.

## Commands

Practices can be named loosely: `thu`, `thursday`, `next`, `today`, `tomorrow`, `10/23`, `oct 23`. Times are New York time.

Every command is `!` plus a word, in any case. Messages starting with `!` that aren't a command (`!!!`, `!nice`) are ignored. The old `!list in thu` form still works.

| Feature | Who | Command | Does |
|---|---|---|---|
| `read` | Anyone | `!list` / `!list thu` | The practice with everyone's names, main list and waitlist (no day: the next practice) |
| `read` | Anyone | `!week` | Upcoming practices with spots left |
| `read` | Member | `!me` | Your spots and waitlist positions |
| `read` | Anyone | `!where [thu]` | Where the practice is, with a Google Maps link (no day: the next practice) |
| `read` | Anyone | `!help` | The commands (board ones only for the board) |
| always on | Anyone | `!forget` (or `!delete me`) | Deletes your data: asks first, then `!forget yes` deletes your member record (sign-up history goes with it), the bot's links to your WhatsApp and what Gemini remembers. Not while you're on an upcoming list (drop out first, so the waitlist moves up). A board member stays on the board |
| `post` | Board | `!post [thu]` | Posts the practice (no day: the open one). With `signup` on, it tells people to sign up right in the chat (`!in` for every list, `!in skills` / `!in games` for one; the day is added only when plain `!in` would mean an earlier practice) with no web link. Without it, it's the app's **Copy WhatsApp post** text with the signed link |
| `signup` | Member | `!in [thu] [list]` | Signs you up. No list named means every list, and the reply says so (`!in games` for just one). No day: the practice that's open. First time: `!in Firstname Lastname` (see Who is asking) |
| `board` | Board | `!out thu Firstname Lastname [list]` | Takes someone else off (every list they're on unless one is named), like the app's Remove button; the waitlist moves up and is tagged. Accents and case don't matter, and a partial name works if it matches one person |
| `signup` | Member | `!out [thu] [list]` | Drops you (no day: the next practice you're on; asks first if it would be a late drop). Whoever moves up is in the next list post (@mentioned if linked) |
| `board` | Board | `!open [thu]` | Opens sign-ups now (the app's **Open sign-ups** button). No day: the next practice that isn't open yet |
| `board` | Board | `!cancel thu [reason]` | Asks to confirm, then `!cancel thu yes` cancels and posts one notice in the group |
| `board` | Board | `!add thu Name [list] [waitlist]` | Adds a walk-in |
| `board` | Board | `!teams thu` | Shuffles teams and shows them. Send them from the app |
| `ai` | Anyone | `@bot <question>`, or a swipe-reply to one of the bot's messages | Gemini answers, or picks one of the commands above and the bot runs it with the same checks (sign-ups and drop-outs happen right away). `!` commands never use Gemini |

**Gemini remembers a little.** It gets the last 6 exchanges with the bot in that chat (from the last 30 minutes), so "and Friday?" works as a follow-up. Only messages to the bot are kept, in memory, never the rest of the group chat, and a command's output (the names on a list) is never part of it. On a swipe-reply Gemini may decide no answer is needed ("thanks 👍"); a direct @mention always gets one. `GEMINI_MODEL` is a list tried in order, because free-tier models are often overloaded.

**Weather.** Gemini gets the forecast for each practice's start time at the field (Neville Colman Field in Riverside Park) from [Open-Meteo](https://open-meteo.com): free, no key, up to 16 days ahead, °F first then °C. Only the field's coordinates are sent. Web search isn't on: the free Gemini tier refuses Google Search for this key (quota error), so it needs a paid tier first.

**The full list follows every change, batched.** `!in`, `!out` and `!add` (and the same through Gemini) are written to the database right away, in the order they arrive, but they don't each get a reply. The bot collects the changes per practice and posts one list message once nobody has changed that practice for 5 s, or 15 s after the first change at the latest. It says what changed, then the whole list with names:

```
✅ In: Ana Diaz (#12), Ben Ode (#13)
⏳ Waitlist: Eve Park (#1)
❌ Out: Cy Fox
⬆️ Moved up from the waitlist: @Dee (#40)
```

A single change outside a rush is quoted under the message that made it (about 5 s later); a rush isn't quoted under anyone. The bot then deletes its previous list message for that practice (also the one from `!list`), so only the newest list stays in the chat. Everything else (errors, "which list?", "you're already on it", the late-drop question, `!me`, `!list`, Gemini's answers) is answered right away.

**Club FAQ.** Gemini answers club questions (late drops, what to bring, fees, guests, who to contact, weather cancellations) only from [FAQ.md](FAQ.md), which the board fills in, and says "ask the board" when it isn't there. Lines still saying `(board: fill in)` are left out. It's read when the bot starts, so after editing it, upload and restart (see Day to day). Club info only: no members' personal details.

Writes are off by default: `BOT_FEATURES=read`. Switch phases on one at a time, e.g. `read,post`, then `read,post,signup`, and so on.

## How it behaves (ban safety)

The bot's number is a normal WhatsApp account driven by an unofficial library (Baileys), so WhatsApp can ban it. It behaves like a quiet person:

- Only reads the groups named in `ALLOWED_GROUPS`, and only answers messages that start with `!` and a command word, or @mention it.
- Replies quoted under the question, shows "typing…", works through one message at a time per chat, and keeps at least 2.5 s between its own messages (max 12 a minute). Sending has its own queue, so a slow send never holds up the next sign-up. It never @mentions everyone and never messages anyone first.
- **Sign-up rush:** when 30–40 people send `!in` within a minute or two, list changes are batched (above), so the chat gets a list post every 15 s or so instead of 40 replies, and "typing…" stays on instead of flickering.
- In DMs it only answers someone who sent `link` (or is in the middle of linking).
- Reconnects with backoff after a disconnect. If WhatsApp logs it out, it logs that loudly and stops (exit code 78, which the service doesn't restart).

## Who is asking

The bot knows who's asking when:

1. their WhatsApp ID is linked to an email (kept in the bot's local database), or
2. WhatsApp shows their phone number and it matches a member's phone: the website's record (with an email) if there is one, else a member known only by phone. WhatsApp has verified that number, so it's proof enough, or
3. **first time:** they send `!in Firstname Lastname` in the group (`!in thu Ana Diaz games` with a day and list). That signs them up by their WhatsApp phone, with no email, through the `sign_up_by_phone` database function (same rules as `sign_up`; added 2026-10-27, see `supabase/migrations/20261027000001_sign_up_by_phone.sql`). After that, plain `!in` works. The post and `!help` say so.
4. **Number hidden** (rare: every tester so far showed one): they link by DM instead. The bot replies with a `wa.me/<bot>?text=link` link, they send `link` in a DM, give their email, and type back the 6-digit code the bot emails them (10 minutes, at most 3 codes an hour). New members also give their name. Their phone is only ever the number WhatsApp shows, never a typed one.

Members known only by phone get no emails (WhatsApp only, as for everyone the bot signs up) and drop out with `!out`. Someone who signed up on the website with a different phone gets a second member record; their sign-ups work the same.

Board members are recognized by their email being in `board_members`, so a board member links by DM once (the bot says so if they try a board command).

## Develop and test (no secrets needed)

```bash
npm ci                 # at the repo root too: the tests use its PGlite + migrations
cd bot && npm ci
npm test               # vitest: parsing, practice picking, linking, rate limits, Gemini loop, and every
                       # database call against an in-memory Postgres with the real migrations
npm run typecheck
```

The tests run offline: WhatsApp is behind the `Chat` interface (`src/chat.ts`), Gemini behind `AiModel` (`src/ai.ts`), email behind `Mailer`, and the database behind `Data` (`src/data/`, with a supabase-js and a plain-SQL implementation of the same calls).

### Try commands in the terminal

```bash
cp .env.example .env   # SUPABASE_URL + SUPABASE_SECRET_KEY at least (a test project, not the club's!)
npm run cli -- --as someone@example.com "!list thu"
npm run cli -- --as someone@example.com          # interactive: type commands, Ctrl-D to quit
npm run cli -- --as new@example.com --name "New Person" --phone +12125550148 --features read,signup "!in thu"
```

`--as` is the member's email (board commands work if it's in `board_members`). Writes are real, so keep `BOT_FEATURES=read` against the live project.

## Configure

Copy `.env.example` to `.env` (gitignored; never commit it):

| Setting | What |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | Same project and secret key as the app (Supabase → Project Settings → API Keys) |
| `DROP_LINK_SECRET` | The app's value, so the links `!post` makes work |
| `SITE_URL` | The app's address |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | Club Gmail, only for the 6-digit linking codes and down alerts. Empty = print to the terminal |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Google AI Studio key (free tier). Models are tried in order, default `gemini-flash-lite-latest,gemini-flash-latest` |
| `BOT_PHONE` | The bot's own number, E.164 (`+1…`) |
| `ALLOWED_GROUPS` | Group IDs (`…@g.us`), comma-separated. The bot logs every group it is in with its ID when it connects ("In N group(s): …"). Exact names also work, but stop matching as soon as an admin renames the chat |
| `BOT_FEATURES` | Any of `read,post,signup,board,ai` |
| `DATA_DIR` | Where the WhatsApp login and the local database live (default `./data`, gitignored) |
| `ALERT_EMAILS` | Who gets an email when the bot is down (below). Comma-separated; empty = no alerts |

## Notifications: WhatsApp only

Members are expected to use the bot, not the website, so anything the bot does is announced in WhatsApp, not by email. The database functions still queue their usual emails in the same call as the change (`sign_up`, `drop_signups`, `add_signup`, `cancel_event`); right after each bot call, the bot deletes exactly those emails and says it in the group instead (`src/quiet.ts`):

- **The change shows up in the next list post** (see above): quoted under the message that made it when it's the only one, otherwise in a post for the whole rush.
- **Whoever moves up from the waitlist** is in that post: @mentioned if their WhatsApp is linked, otherwise by name (names are already public on the list).
- **A cancellation** is one group message, with no @mentions.
- Late-drop heads-ups to the board are deleted too.

Only the emails the bot's own call queued are deleted: same practice, kind and member, and the exact time of that call (every row a Postgres function writes in one call shares its `now()`). Emails from the website or the board's app are never touched. The only email the bot sends itself is the 6-digit linking code, which proves who someone is.

## Down alerts

If WhatsApp disconnects or logs the bot out, nobody notices until members complain. So the addresses in `ALERT_EMAILS` get an email (through the club Gmail):

- **Logged out:** right away, with what to do: open WhatsApp on the bot phone (it must have opened WhatsApp in the last 14 days), link again on the VM, restart. The bot stays stopped until then.
- **Offline for more than 10 minutes** without reconnecting: once, then a "back online" email when it reconnects. Shorter drops send nothing.
- **Crashed on start:** once, with the error.

At most one email per kind per hour, so a flapping connection or a crash loop doesn't flood the inbox. When each kind was last sent is kept in `bot.sqlite`, so it holds across restarts.

## Link WhatsApp

The bot is a **linked device** of its WhatsApp Business account (a Google Voice number), logged in with a pairing code, no QR:

```bash
npm run link
```

It prints an 8-character code. On the bot phone: **WhatsApp → Settings → Linked devices → Link a device → Link with phone number instead**, and type the code. The login is saved in `DATA_DIR/auth`. To re-link, delete that folder and run it again. `npm start` runs the bot.

## Deploy (Google Cloud e2-micro, free tier)

One time, with `gcloud` logged in to the club Google account:

```bash
gcloud compute instances create listbot --zone us-east1-b --machine-type e2-micro \
  --image-family ubuntu-2404-lts-amd64 --image-project ubuntu-os-cloud \
  --boot-disk-size 30GB --boot-disk-type pd-standard
gcloud compute scp bot/deploy/setup.sh listbot:/tmp/setup.sh --zone us-east1-b
gcloud compute ssh listbot --zone us-east1-b -- sudo bash /tmp/setup.sh
bot/deploy/upload.sh --env      # builds, copies dist/ and bot/.env, installs the service
```

### Link WhatsApp on the VM

```bash
gcloud compute ssh listbot --zone us-east1-b -- -t \
  "sudo -u listbot -H bash -c 'cd /opt/listbot && node --disable-warning=ExperimentalWarning dist/link.js'"
gcloud compute ssh listbot --zone us-east1-b -- sudo systemctl restart listbot
```

### First live test

- `!list` and `!me` from a member whose number shows and from one whose number is hidden (`@lid`).
- Linking by DM, start to finish.
- With `signup` on: a drop that moves someone up. Check the @mention shows as their name in WhatsApp (the bot mentions their hidden ID when it has one, else their phone).
- A small rush: 4–5 people send `!in` within a few seconds. Expect one list post about 5 s after the last one, listing all of them, and the previous list gone.
- `!where`, and a club question ("what should I bring?") before and after filling in that part of `FAQ.md`.
- Alerts, with `ALERT_EMAILS` set: run the bot on your computer (`npm start`), turn off Wi-Fi for 11 minutes, then back on: expect "offline" and then "back online" emails (stopping the service doesn't count: then nothing is running to notice). Logging the bot out from the phone (Linked devices) sends the "logged out" email right away, but then it has to be linked again.
- Check the `emails` table: nothing from the bot's actions should be left there.

### Day to day

- **Update the code or the FAQ:** `bot/deploy/upload.sh` (add `--env` after changing `bot/.env`). It restarts the bot, which reads `FAQ.md` again.
- **Logs:** `gcloud compute ssh listbot --zone us-east1-b -- sudo journalctl -u listbot -f`
- **Stop / start:** `sudo systemctl stop listbot` / `start` on the VM.
- The service restarts on a crash. It does **not** restart if WhatsApp logged it out: link again (above), then restart it.

Files on the VM: `/opt/listbot/dist` (code), `/opt/listbot/.env` (settings, secret), `/opt/listbot/data` (WhatsApp login + linked members: personal data, only on the VM, readable only by the `listbot` user).

## Handover: what the board needs to know

- **The bot is optional.** Everything it does can be done in the app. If it's down or banned, post the link from the app (**Copy WhatsApp post**) like before.
- **Keep the Google Voice number alive:** send a text from it every month or two, or Google reclaims the number (and the WhatsApp account goes with it).
- **Open WhatsApp on the bot phone at least every 14 days,** or WhatsApp logs out its linked devices, including the bot.
- **Bot stopped answering?** With `ALERT_EMAILS` set, you get an email saying why. Otherwise check the logs (above). "LOGGED OUT" means: link it again on the VM, then restart the service.
- **Club FAQ:** keep `bot/FAQ.md` up to date (fees, guests, contacts...); the bot answers club questions only from it.
- **Who's on the VM:** the club Google account owns the Google Cloud project. Pass it on with the rest of the club accounts at the yearly handover.
- **Secrets:** `bot/.env` lives on the maintainer's computer and the VM only. Changing `DROP_LINK_SECRET` in the app means changing it here too (and it breaks links already posted).
- **Gemini's free tier** may be used by Google to improve its models. The bot only sends it the question, practice times, places and counts, and the asker's own spots: never names, emails or phone numbers. Turn `ai` off in `BOT_FEATURES` to stop using it.

## How it's built

| | |
|---|---|
| `src/main.ts`, `link.ts`, `cli.ts` | Entry points: the bot, WhatsApp pairing, the terminal |
| `src/whatsapp.ts` | Baileys behind the `Chat` interface (`src/chat.ts`, which also has the pacer and per-chat queue) |
| `src/bot.ts` | The router: which messages get an answer; a work queue and a send queue per chat |
| `src/batch.ts` | Batching list changes into one list post per practice (rush handling) |
| `src/alerts.ts` | Down alerts to `ALERT_EMAILS` |
| `src/parse.ts`, `pick.ts` | Commands and loose practice names (New York dates) |
| `src/commands.ts` | Every command and every permission check |
| `src/identity.ts`, `linking.ts`, `state.ts` | Who is asking; the DM linking flow; local state in `node:sqlite` |
| `src/data/` | The database calls, for supabase-js (production) and plain SQL (tests) |
| `src/ai.ts`, `gemini.ts` | The Gemini step and the real model |
| `src/faq.ts`, `FAQ.md` | The club FAQ for Gemini, filled in by the board |
| `src/quiet.ts` | Writes without their emails: deletes what the bot's own call queued, returns who moved up |
| `src/mailer.ts` | The linking code and alert emails: Gmail or the terminal |
| `src/links.ts`, `share.ts` | The signed sign-up link and the WhatsApp post, re-implemented from `src/lib/` (tested to match) |
| `deploy/` | VM setup, systemd unit, upload script |

The bot imports the app's pure helpers directly (`src/lib/time.ts`, `stage.ts`, `types.ts`); `npm run build` bundles them into `dist/`.
