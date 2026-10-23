import { clock, dayDate, duration } from "../../src/lib/time";
import type { Timers } from "./batch";
import type { Mailer } from "./mailer";

// Down alerts (BRIEF.md, R2): if WhatsApp logs the bot out or drops it, nobody
// notices until members complain. So the bot emails ALERT_EMAILS:
// - logged out: right away, with what to do;
// - disconnected for more than 10 minutes: once, then "back online" when it reconnects;
// - crashed on start: once.
// At most one email per kind per hour, so a flapping connection or a crash loop
// under systemd doesn't flood the inbox. When each kind was last sent is kept
// in bot.sqlite (state.ts), so it survives restarts.

export const DOWN_AFTER_MS = 10 * 60_000;
export const PER_KIND_MS = 60 * 60_000;

export type AlertKind = "logged_out" | "down" | "back" | "crash";

/** Where the last send of each kind is kept (LocalState in production). */
export interface AlertLog {
  lastAlert(kind: AlertKind): number | null;
  markAlert(kind: AlertKind, at: number): void;
}

/** A fallback when the local database can't be opened (e.g. the crash is about it). */
export function memoryAlertLog(): AlertLog {
  const sent = new Map<AlertKind, number>();
  return { lastAlert: (k) => sent.get(k) ?? null, markAlert: (k, at) => void sent.set(k, at) };
}

const LOGS = "gcloud compute ssh listbot --zone us-east1-b -- sudo journalctl -u listbot -n 100";
const LINK =
  "gcloud compute ssh listbot --zone us-east1-b -- -t \"sudo -u listbot -H bash -c 'cd /opt/listbot && node --disable-warning=ExperimentalWarning dist/link.js'\"";

export class Alerts {
  private downSince: number | null = null;
  private downTimer: unknown = null;
  /** This outage's "down" email, if it went out (or is going out): then it gets a "back online". */
  private downEmail: Promise<boolean> | null = null;

  constructor(
    private opts: {
      to: string[];
      mailer: Mailer;
      log: AlertLog;
      timers: Timers;
      now: () => number;
      onError?: (msg: string, err?: unknown) => void;
      downAfterMs?: number;
    },
  ) {}

  /** WhatsApp logged the bot out. Resolves once the email is sent (the bot exits right after). */
  loggedOut() {
    return this.send(
      "logged_out",
      "The List bot: WhatsApp logged it out",
      [
        `WhatsApp logged the bot out on ${this.when(this.opts.now())}. It has stopped and won't restart on its own.`,
        "",
        "To get it back:",
        "1. Open WhatsApp on the bot phone. WhatsApp logs out linked devices when the phone hasn't opened WhatsApp in 14 days.",
        `2. Link it again on the VM (it prints a code to type on the bot phone, under Linked devices):\n   ${LINK}`,
        "3. Start it: gcloud compute ssh listbot --zone us-east1-b -- sudo systemctl restart listbot",
        "",
        "Until then, members can sign up on the website. See bot/README.md, \"Link WhatsApp on the VM\".",
      ].join("\n"),
    );
  }

  /** The connection dropped. If it isn't back within 10 minutes, email once. */
  disconnected() {
    if (this.downSince !== null) return;
    this.downSince = this.opts.now();
    this.downEmail = null;
    this.downTimer = this.opts.timers.set(() => {
      this.downTimer = null;
      this.downEmail = this.send(
        "down",
        "The List bot is offline",
        [
          `The bot lost its WhatsApp connection on ${this.when(this.downSince!)} and hasn't reconnected in ${duration(this.opts.now() - this.downSince!)}. It keeps retrying on its own.`,
          "",
          "You'll get a \"back online\" email when it reconnects. If it doesn't, check the logs:",
          `   ${LOGS}`,
          "",
          "Until then, members can sign up on the website.",
        ].join("\n"),
      );
      return this.downEmail;
    }, this.opts.downAfterMs ?? DOWN_AFTER_MS);
  }

  /** The connection is open. Sends "back online" if this outage was reported. */
  async connected() {
    const since = this.downSince;
    if (since === null) return;
    this.downSince = null;
    if (this.downTimer !== null) this.opts.timers.clear(this.downTimer);
    this.downTimer = null;
    const reported = this.downEmail ? await this.downEmail : false;
    this.downEmail = null;
    if (!reported) return;
    await this.send("back", "The List bot is back online", `The bot reconnected to WhatsApp on ${this.when(this.opts.now())}, after ${duration(this.opts.now() - since)} offline.`);
  }

  /** The bot failed to start (anything but "not linked yet"). Resolves once the email is sent. */
  crashed(err: unknown) {
    const what = (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(0, 500);
    return this.send(
      "crash",
      "The List bot crashed on start",
      [`The bot failed to start on ${this.when(this.opts.now())}:`, "", `   ${what}`, "", "systemd restarts it on its own; this email goes out at most once an hour. Check the logs:", `   ${LOGS}`].join("\n"),
    );
  }

  /** Sends one alert to everyone, unless this kind went out in the last hour. True if it went out. */
  private async send(kind: AlertKind, subject: string, text: string): Promise<boolean> {
    const { to, mailer, log, now } = this.opts;
    if (to.length === 0) return false;
    const last = log.lastAlert(kind);
    if (last !== null && now() - last < PER_KIND_MS) return false;
    log.markAlert(kind, now());
    const results = await Promise.allSettled(to.map((addr) => mailer.send({ to: addr, subject, text })));
    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length) this.opts.onError?.(`Couldn't send the "${kind}" alert`, (failed[0] as PromiseRejectedResult).reason);
    return failed.length < results.length;
  }

  private when(at: number) {
    return `${dayDate(new Date(at))} at ${clock(new Date(at))} New York time`;
  }
}
