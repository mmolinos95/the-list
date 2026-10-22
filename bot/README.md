# The List bot (WhatsApp)

A WhatsApp bot for [The List](../README.md). It sits in the club's WhatsApp group: members ask it about practices and sign up or drop out from the chat, and the board posts sign-up messages and runs practices from the chat. The web app is unchanged and stays the fallback if the bot is down or banned.

- Plan and rules it was built to: [BRIEF.md](BRIEF.md) (open questions are at the end, under **Needs a decision**).
- It talks to the same Supabase database as the app, only through the Postgres functions the app already uses, so every rule (caps, waitlist, lock, late drops) holds the same way.

## Commands

Practices can be named loosely: `thu`, `thursday`, `next`, `today`, `tomorrow`, `10/23`, `oct 23`. Times are New York time.

| Feature | Who | Command | Does |
|---|---|---|---|
| `read` | Anyone | `!list` / `!list help` | Upcoming practices with spots left; help |
| `read` | Anyone | `!list thu` | Time, place, each list's count / cap and waitlist |
| `read` | Member | `!list me` | Your spots and waitlist positions |
| `post` | Board | `!list post thu` | Posts the app's **Copy WhatsApp post** text with the signed sign-up link |
| `signup` | Member | `!list in thu [list]` | Signs you up (asks which list if there are several; `both` works) |
| `signup` | Member | `!list out thu [list]` | Drops you (asks first if it would be a late drop) |
| `board` | Board | `!list open thu` | Opens sign-ups now (the app's **Open sign-ups** button) |
| `board` | Board | `!list lock thu` | Says when the list locks (there's no early lock; see BRIEF.md) |
| `board` | Board | `!list cancel thu [reason]` | Asks to confirm, then `!list cancel thu yes` cancels and emails everyone |
| `board` | Board | `!list add thu Name [list] [waitlist]` | Adds a walk-in |
| `board` | Board | `!list teams thu` | Shuffles teams and shows them. Send them from the app |
| `ai` | Anyone | `@bot <question>` or `!list <anything else>` | Gemini answers, or picks one of the commands above and the bot runs it with the same checks |

Writes are off by default: `BOT_FEATURES=read`. Switch phases on one at a time, e.g. `read,post`, then `read,post,signup`, and so on.

## How it behaves (ban safety)

The bot's number is a normal WhatsApp account driven by an unofficial library (Baileys), so WhatsApp can ban it. It behaves like a quiet person:

- Only reads the groups named in `ALLOWED_GROUPS`, and only answers messages that start with `!list` or @mention it.
- Replies quoted under the question, shows "typing…", answers one question at a time per chat, and keeps at least 2.5 s between its own messages (max 12 a minute). It never @mentions everyone and never messages anyone first.
- In DMs it only answers someone who sent `link` (or is in the middle of linking).
- Reconnects with backoff after a disconnect. If WhatsApp logs it out, it logs that loudly and stops (exit code 78, which the service doesn't restart).

## Who is asking

Members are matched by email in the database. The bot knows who's asking when:

1. their WhatsApp ID is already linked (kept in the bot's local database), or
2. WhatsApp shows their phone number and it matches a member's phone (the most recently updated one wins), or
3. they link themselves: the bot replies with a `wa.me/<bot>?text=link` link, they send `link` in a DM, give their email, and type back the 6-digit code the bot emails them (10 minutes, at most 3 codes an hour). New members also give their name and phone; their database row is created by their first sign-up.

Board members are recognized by their email being in `board_members`.

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
npm run cli -- --as new@example.com --name "New Person" --phone +12125550148 --features read,signup "!list in thu"
```

`--as` is the member's email (board commands work if it's in `board_members`). Writes are real, so keep `BOT_FEATURES=read` against the live project.

## Configure

Copy `.env.example` to `.env` (gitignored; never commit it):

| Setting | What |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | Same project and secret key as the app (Supabase → Project Settings → API Keys) |
| `DROP_LINK_SECRET` | The app's value, so posted links and emailed drop-out links work |
| `SITE_URL` | The app's address |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | Club Gmail, for link codes and the emails the bot's actions queue. Empty = print to the terminal |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Google AI Studio key (free tier). The model defaults to `gemini-flash-latest` |
| `BOT_PHONE` | The bot's own number, E.164 (`+1…`) |
| `ALLOWED_GROUPS` | Exact group names, comma-separated |
| `BOT_FEATURES` | Any of `read,post,signup,board,ai` |
| `DATA_DIR` | Where the WhatsApp login and the local database live (default `./data`, gitignored) |

Emails: after any write (sign-up, drop, cancel, walk-in) the bot sends the emails the database queued, with the app's own templates, the same 450-a-day limit, and `claim_emails` so the bot and the app never send one twice. Without `DROP_LINK_SECRET` it leaves them for the app's daily job.

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

### Day to day

- **Update the code:** `bot/deploy/upload.sh` (add `--env` after changing `bot/.env`).
- **Logs:** `gcloud compute ssh listbot --zone us-east1-b -- sudo journalctl -u listbot -f`
- **Stop / start:** `sudo systemctl stop listbot` / `start` on the VM.
- The service restarts on a crash. It does **not** restart if WhatsApp logged it out: link again (above), then restart it.

Files on the VM: `/opt/listbot/dist` (code), `/opt/listbot/.env` (settings, secret), `/opt/listbot/data` (WhatsApp login + linked members: personal data, only on the VM, readable only by the `listbot` user).

## Handover: what the board needs to know

- **The bot is optional.** Everything it does can be done in the app. If it's down or banned, post the link from the app (**Copy WhatsApp post**) like before.
- **Keep the Google Voice number alive:** send a text from it every month or two, or Google reclaims the number (and the WhatsApp account goes with it).
- **Open WhatsApp on the bot phone at least every 14 days,** or WhatsApp logs out its linked devices, including the bot.
- **Bot stopped answering?** Check the logs (above). "LOGGED OUT" means: link it again on the VM, then restart the service.
- **Who's on the VM:** the club Google account owns the Google Cloud project. Pass it on with the rest of the club accounts at the yearly handover.
- **Secrets:** `bot/.env` lives on the maintainer's computer and the VM only. Changing `DROP_LINK_SECRET` in the app means changing it here too (and it breaks links already posted).
- **Gemini's free tier** may be used by Google to improve its models. The bot only sends it the question, practice times, places and counts, and the asker's own spots: never names, emails or phone numbers. Turn `ai` off in `BOT_FEATURES` to stop using it.

## How it's built

| | |
|---|---|
| `src/main.ts`, `link.ts`, `cli.ts` | Entry points: the bot, WhatsApp pairing, the terminal |
| `src/whatsapp.ts` | Baileys behind the `Chat` interface (`src/chat.ts`, which also has the pacer and per-chat queue) |
| `src/bot.ts` | The router: which messages get an answer |
| `src/parse.ts`, `pick.ts` | Commands and loose practice names (New York dates) |
| `src/commands.ts` | Every command and every permission check |
| `src/identity.ts`, `linking.ts`, `state.ts` | Who is asking; the DM linking flow; local state in `node:sqlite` |
| `src/data/` | The database calls, for supabase-js (production) and plain SQL (tests) |
| `src/ai.ts`, `gemini.ts` | The Gemini step and the real model |
| `src/outbox.ts`, `mailer.ts` | Sending the emails the database queued; Gmail or the terminal |
| `src/links.ts`, `share.ts` | Signed links and the WhatsApp post, re-implemented from `src/lib/` (tested to match) |
| `deploy/` | VM setup, systemd unit, upload script |

The bot imports the app's pure helpers directly (`src/lib/time.ts`, `stage.ts`, `types.ts`, `notify/templates.ts`); `npm run build` bundles them into `dist/`.
