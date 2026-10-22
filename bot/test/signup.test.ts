import { beforeAll, describe, expect, it } from "vitest";
import { signUp as dbSignUp } from "../../tests/db/harness";
import type { Commands } from "../src/commands";
import type { Data } from "../src/data/types";
import type { Asker } from "../src/identity";
import { dropUrl } from "../src/links";
import { processOutbox } from "../src/outbox";
import { parseCommand } from "../src/parse";
import { askerOf, board, commandsFor, dataFor, FakeMailer, freshDb, member, practice, type Db } from "./helpers";

let db: Db;
let data: Data;
let commands: Commands;
let writes = 0;

const spots = async (eventId: string) =>
  (
    await db.query<{ email: string; list: string; spot: string; status: string; dropped_late: boolean }>(
      `select m.email, l.name as list, s.spot, s.status, s.dropped_late from signups s join members m on m.id = s.member_id join event_lists l on l.id = s.list_id
        where l.event_id = $1 order by m.email, l.position`,
      [eventId],
    )
  ).rows;

beforeAll(async () => {
  db = await freshDb();
  data = dataFor(db);
  commands = commandsFor(data, undefined, { afterWrite: () => void writes++ });
  await member(db, "ana@example.com", "Ana Diaz", "+12125550101");
  await member(db, "ben@example.com", "Ben Ode", "+12125550102");
  await member(db, "cy@example.com", "Cy Fox", null);
  await board(db, "pres@example.com");
});

async function run(text: string, who: string | Asker | null, chatKey = "chat|x") {
  const asker = typeof who === "string" ? await askerOf(data, who) : who;
  const out = await commands.run(parseCommand(text), { asker, chatKey });
  return out.map((o) => o.text).join("\n");
}

describe("!list in (phase 3)", () => {
  it("signs a member up with their saved details, and says main or waitlist", async () => {
    const ev = await practice(db, { startsIn: "1 day", lists: [{ name: "Games", cap: 1 }] });
    const day = ev.slug;
    expect(await run(`in ${day}`, "ana@example.com")).toMatch(/You're in: \*Games\*, #1 of 1\.\n.*Confirmation \(with a drop-out link\) is in your email/);
    expect(await run(`in ${day}`, "ben@example.com")).toMatch(/\*Games\* is full\. You're #1 on the waitlist/);
    expect(await run(`in ${day}`, "ana@example.com")).toBe("You're already on *Games* (#1 of 1).");
    expect(await spots(ev.id)).toEqual([
      expect.objectContaining({ email: "ana@example.com", spot: "main" }),
      expect.objectContaining({ email: "ben@example.com", spot: "waitlist" }),
    ]);
    expect(writes).toBeGreaterThan(0);
  });

  it("asks which list when there are several, and takes names or both", async () => {
    const ev = await practice(db, { startsIn: "2 days", lists: [{ name: "Skills", cap: 40 }, { name: "Games", cap: 40 }] });
    const day = ev.slug;
    expect(await run(`in ${day}`, "ana@example.com")).toMatch(/Which list\? \*Skills\* \(.*\) or \*Games\* \(.*\)\.\nSend `!list in \S+ skills`, `!list in \S+ games` or `!list in \S+ both`/);
    expect(await run(`in ${day} goalie`, "ana@example.com")).toMatch(/no list called "goalie"/);
    expect(await run(`in ${day} games`, "ana@example.com")).toMatch(/You're in: \*Games\*/);
    expect(await run(`in ${day} both`, "ben@example.com")).toMatch(/You're in: \*Skills\*.*\nYou're in: \*Games\*/);
    expect((await spots(ev.id)).map((s) => `${s.email} ${s.list}`).sort()).toEqual(["ana@example.com Games", "ben@example.com Games", "ben@example.com Skills"]);
  });

  it("creates the database row for a new member on their first sign-up", async () => {
    const ev = await practice(db, { startsIn: "3 days" });
    const asker: Asker = { email: "newbie@example.com", name: "Sam Lee", phone: "+12125550199", member: null, board: null };
    expect(await run(`in ${ev.slug}`, asker)).toMatch(/You're in/);
    expect(await data.memberByEmail("newbie@example.com")).toMatchObject({ name: "Sam Lee", phone: "+12125550199" });
  });

  it("works for members without a phone", async () => {
    const ev = await practice(db, { startsIn: "4 days" });
    expect(await run(`in ${ev.slug}`, "cy@example.com")).toMatch(/You're in/);
  });

  it("explains closed practices instead of trying", async () => {
    const soon = await practice(db, { startsIn: "5 days", opensIn: "1 day" });
    expect(await run(`in ${soon.slug}`, "ana@example.com")).toMatch(/can't sign up for .* yet\. Sign-ups open/);
    const waiting = await practice(db, { startsIn: "6 days", opensIn: null });
    expect(await run(`in ${waiting.slug}`, "ana@example.com")).toMatch(/Sign-ups not open yet/);
    const locked = await practice(db, { startsIn: "1 hour" });
    expect(await run(`in ${locked.slug}`, "ana@example.com")).toMatch(/has locked/);
    expect(await spots(locked.id)).toEqual([]);
  });

  it("needs to know who's asking", async () => {
    expect(await run("in next", null)).toMatch(/wa\.me\/12125550100\?text=link/);
  });
});

describe("!list out (phase 3)", () => {
  it("drops all of a member's lists, and the waitlist moves up before the lock", async () => {
    const ev = await practice(db, { startsIn: "1 day", lists: [{ name: "Skills", cap: 1 }, { name: "Games", cap: 40 }] });
    const day = ev.slug;
    await dbSignUp(db, ev.id, [ev.lists.Skills, ev.lists.Games], "Ana Diaz", "ana@example.com");
    await dbSignUp(db, ev.id, [ev.lists.Skills], "Ben Ode", "ben@example.com");
    expect(await run(`out ${day} skills`, "ana@example.com")).toMatch(/Done: you're off \*Skills\*.*waitlist/);
    expect(await spots(ev.id)).toEqual([
      expect.objectContaining({ email: "ana@example.com", list: "Skills", status: "dropped" }),
      expect.objectContaining({ email: "ana@example.com", list: "Games", status: "active" }),
      expect.objectContaining({ email: "ben@example.com", list: "Skills", spot: "main", status: "active" }),
    ]);
    expect(await run(`out ${day}`, "ana@example.com")).toMatch(/Done: you're off \*Games\*/);
    expect(await run(`out ${day}`, "ana@example.com")).toMatch(/You're not on/);
    expect(await run(`out ${day} games`, "ben@example.com")).toMatch(/You're not on \*Games\*/);
  });

  it("asks before a late drop, then tells the board", async () => {
    const ev = await practice(db, { startsIn: "5 hours" });
    await dbSignUp(db, ev.id, [ev.lists.Games], "Ana Diaz", "ana@example.com");
    await db.query(`update events set starts_at = now() + interval '1 hour', ends_at = now() + interval '3 hours' where id = $1`, [ev.id]);
    const day = ev.slug;
    expect(await run(`out ${day}`, "ana@example.com", "chat|ana")).toMatch(/late drop.*Send `!list out \S+ yes`/);
    expect((await spots(ev.id))[0].status).toBe("active");
    // Someone else's "yes" doesn't count.
    expect(await run(`out ${day}`, "ben@example.com", "chat|ben")).toMatch(/You're not on/);
    expect(await run(`out ${day} yes`, "ana@example.com", "chat|ana")).toMatch(/The list had locked, so the board was told/);
    expect((await spots(ev.id))[0]).toMatchObject({ status: "dropped", dropped_late: true });
    const lateEmails = await db.query(`select to_address from emails where kind = 'late_drop' and event_id = $1`, [ev.id]);
    expect(lateEmails.rows).toEqual([{ to_address: "pres@example.com" }]);
  });

  it("refuses cancelled practices", async () => {
    const ev = await practice(db, { startsIn: "7 days" });
    await db.query(`update events set cancelled_at = now() where id = $1`, [ev.id]);
    expect(await run(`out ${ev.slug}`, "ana@example.com")).toMatch(/cancelled/);
  });
});

describe("outbox", () => {
  it("sends the queued emails with the app's templates and links, once", async () => {
    await db.query(`update emails set status = 'sent', sent_at = now()`);
    const ev = await practice(db, { startsIn: "8 days" });
    await run(`in ${ev.slug}`, "cy@example.com");
    const mailer = new FakeMailer();
    const deps = { data, mailer, secret: "test-secret", siteUrl: "https://list.example" };
    expect(await processOutbox(deps)).toEqual({ sent: 1, failed: 0 });
    expect(mailer.sent[0].to).toBe("cy@example.com");
    expect(mailer.sent[0].subject).toMatch(/You're in/);
    const cy = await data.memberByEmail("cy@example.com");
    expect(mailer.sent[0].text).toContain(dropUrl("test-secret", "https://list.example", ev.id, cy!.id));
    expect(await processOutbox(deps)).toEqual({ sent: 0, failed: 0 });
  });

  it("marks failures for a retry", async () => {
    const ev = await practice(db, { startsIn: "9 days" });
    await run(`in ${ev.slug}`, "cy@example.com");
    const broken = { send: async () => Promise.reject(new Error("smtp down")) };
    expect(await processOutbox({ data, mailer: broken, secret: "s", siteUrl: "https://x" })).toEqual({ sent: 0, failed: 1 });
    const row = (await db.query<{ status: string; last_error: string }>(`select status, last_error from emails where event_id = $1`, [ev.id])).rows[0];
    expect(row).toMatchObject({ status: "failed", last_error: expect.stringMatching(/smtp down/) });
  });
});
