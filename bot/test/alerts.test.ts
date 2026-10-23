import { describe, expect, it } from "vitest";
import { Alerts, DOWN_AFTER_MS, memoryAlertLog, PER_KIND_MS } from "../src/alerts";
import { readConfig } from "../src/config";
import type { LocalState } from "../src/state";
import { FakeClock, FakeMailer, memoryState } from "./helpers";

// R2: email ALERT_EMAILS when the bot is down. Fake mailer, fake clock.

const START = Date.parse("2026-10-23T14:00:00Z");

function setup(opts: { to?: string[]; state?: LocalState; clock?: FakeClock } = {}) {
  const clock = opts.clock ?? new FakeClock();
  const mailer = new FakeMailer();
  const state = opts.state ?? memoryState();
  const errors: string[] = [];
  const alerts = new Alerts({
    to: opts.to ?? ["pres@example.com", "martin@example.com"],
    mailer,
    log: state,
    timers: clock,
    now: () => START + clock.t,
    onError: (m) => void errors.push(m),
  });
  const subjects = () => mailer.sent.map((m) => `${m.to}: ${m.subject}`);
  return { alerts, clock, mailer, state, errors, subjects };
}

describe("down alerts (R2)", () => {
  it("emails everyone right away when WhatsApp logs the bot out, with what to do", async () => {
    const { alerts, mailer, subjects } = setup();
    await alerts.loggedOut();
    expect(subjects()).toEqual(["pres@example.com: The List bot: WhatsApp logged it out", "martin@example.com: The List bot: WhatsApp logged it out"]);
    expect(mailer.sent[0].text).toContain("on Fri, Oct 23 at 10 AM New York time");
    expect(mailer.sent[0].text).toMatch(/14 days/);
    expect(mailer.sent[0].text).toMatch(/dist\/link\.js/);
    expect(mailer.sent[0].text).toMatch(/systemctl restart listbot/);
  });

  it("says nothing about a disconnect that's fixed within 10 minutes", async () => {
    const { alerts, clock, mailer } = setup();
    alerts.disconnected();
    await clock.advance(DOWN_AFTER_MS - 1);
    await alerts.connected();
    await clock.advance(DOWN_AFTER_MS * 3);
    expect(mailer.sent).toEqual([]);
  });

  it("emails once after 10 minutes offline, then 'back online' when it reconnects", async () => {
    const { alerts, clock, mailer, subjects } = setup({ to: ["pres@example.com"] });
    alerts.disconnected();
    await clock.advance(5 * 60_000);
    alerts.disconnected(); // another failed retry: still the same outage
    await clock.advance(5 * 60_000);
    expect(subjects()).toEqual(["pres@example.com: The List bot is offline"]);
    expect(mailer.sent[0].text).toMatch(/hasn't reconnected in 10m/);
    await clock.advance(30 * 60_000);
    expect(mailer.sent).toHaveLength(1);
    await alerts.connected();
    expect(subjects()).toEqual(["pres@example.com: The List bot is offline", "pres@example.com: The List bot is back online"]);
    expect(mailer.sent[1].text).toMatch(/after 40m offline/);
  });

  it("sends at most one email per kind per hour, so a flapping connection doesn't flood the inbox", async () => {
    const { alerts, clock, subjects } = setup({ to: ["pres@example.com"] });
    const outage = async (minutes: number) => {
      alerts.disconnected();
      await clock.advance(minutes * 60_000);
      await alerts.connected();
      await clock.advance(60_000);
    };
    await outage(11); // down + back
    await outage(11); // too soon: no down, so no back either
    await outage(11);
    expect(subjects()).toEqual(["pres@example.com: The List bot is offline", "pres@example.com: The List bot is back online"]);
    await clock.advance(PER_KIND_MS);
    await outage(11);
    expect(subjects()).toHaveLength(4);
  });

  it("emails a crash on start once an hour, even across restarts (it's kept in bot.sqlite)", async () => {
    const state = memoryState();
    const clock = new FakeClock();
    const first = setup({ state, clock, to: ["pres@example.com"] });
    await first.alerts.crashed(new Error("connect ECONNREFUSED"));
    expect(first.subjects()).toEqual(["pres@example.com: The List bot crashed on start"]);
    expect(first.mailer.sent[0].text).toMatch(/Error: connect ECONNREFUSED/);
    // systemd restarts it 15 s later and it crashes again: a new process, same database.
    await clock.advance(15_000);
    const second = setup({ state, clock, to: ["pres@example.com"] });
    await second.alerts.crashed(new Error("connect ECONNREFUSED"));
    expect(second.mailer.sent).toEqual([]);
    await clock.advance(PER_KIND_MS);
    const third = setup({ state, clock, to: ["pres@example.com"] });
    await third.alerts.crashed(new Error("connect ECONNREFUSED"));
    expect(third.mailer.sent).toHaveLength(1);
  });

  it("does nothing without ALERT_EMAILS", async () => {
    const { alerts, clock, mailer } = setup({ to: [] });
    await alerts.loggedOut();
    await alerts.crashed(new Error("x"));
    alerts.disconnected();
    await clock.advance(DOWN_AFTER_MS * 2);
    await alerts.connected();
    expect(mailer.sent).toEqual([]);
  });

  it("logs a failed send instead of throwing", async () => {
    const errors: string[] = [];
    const alerts = new Alerts({
      to: ["pres@example.com"],
      mailer: { send: async () => Promise.reject(new Error("smtp down")) },
      log: memoryAlertLog(),
      timers: new FakeClock(),
      now: () => START,
      onError: (m) => void errors.push(m),
    });
    await expect(alerts.loggedOut()).resolves.toBe(false);
    expect(errors).toEqual(['Couldn\'t send the "logged_out" alert']);
  });

  it("reads ALERT_EMAILS from the config", () => {
    const base = { SUPABASE_URL: "x", SUPABASE_SECRET_KEY: "y" };
    expect(readConfig({ ...base, ALERT_EMAILS: " Pres@Example.com, martin@example.com ," }).alertEmails).toEqual(["pres@example.com", "martin@example.com"]);
    expect(readConfig(base).alertEmails).toEqual([]);
    expect(() => readConfig({ ...base, ALERT_EMAILS: "pres@example.com, nope" })).toThrow(/ALERT_EMAILS has "nope"/);
  });
});
