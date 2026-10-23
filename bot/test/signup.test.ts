import { beforeAll, describe, expect, it } from "vitest";
import { signUp as dbSignUp } from "../../tests/db/harness";
import type { Commands, Out } from "../src/commands";
import type { Data } from "../src/data/types";
import type { Asker } from "../src/identity";
import { parseCommand } from "../src/parse";
import { askerOf, board, commandsFor, dataFor, freshDb, member, memoryState, practice, type Db } from "./helpers";

let db: Db;
let data: Data;
let commands: Commands;
const state = memoryState();

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
  commands = commandsFor(data, undefined, { mentionFor: (email) => state.mentionFor(email) });
  // Ben linked his WhatsApp (by phone and hidden ID); the others didn't.
  state.saveLink(["12125550102@s.whatsapp.net", "98765@lid"], { email: "ben@example.com", name: "Ben Ode", phone: "+12125550102" });
  await member(db, "ana@example.com", "Ana Diaz", "+12125550101");
  await member(db, "ben@example.com", "Ben Ode", "+12125550102");
  await member(db, "cy@example.com", "Cy Fox", null);
  await board(db, "pres@example.com");
});

async function outs(text: string, who: string | Asker | null, chatKey = "chat|x"): Promise<Out[]> {
  const asker = typeof who === "string" ? await askerOf(data, who) : who;
  return commands.run(parseCommand(text), { asker, chatKey });
}
async function run(text: string, who: string | Asker | null, chatKey = "chat|x") {
  return (await outs(text, who, chatKey)).map((o) => o.text).join("\n");
}
const emails = async (eventId: string) =>
  (await db.query<{ kind: string; to_address: string }>(`select kind::text, to_address from emails where event_id = $1 order by created_at, to_address`, [eventId])).rows;
/** Stands in for the website: the same database function, called outside the bot. */
async function websiteDrop(eventId: string, email: string, listIds: string[]) {
  await db.query(`select drop_signups($1, (select id from members where email = $2), $3::uuid[])`, [eventId, email, listIds]);
  await new Promise((r) => setTimeout(r, 2)); // PGlite's clock ticks per millisecond
}

describe("!in (phase 3)", () => {
  it("signs a member up with their saved details, and says main or waitlist", async () => {
    const ev = await practice(db, { startsIn: "1 day", lists: [{ name: "Games", cap: 1 }] });
    const day = ev.slug;
    expect(await run(`in ${day}`, "ana@example.com")).toMatch(/^You're in: \*Games\*, #1 of 1\.\n\n\*.* · .*\*\n[\s\S]*\*Games\* · 1\/1\n1\. Ana Diaz/);
    expect(await run(`in ${day}`, "ben@example.com")).toMatch(/\*Games\* is full\. You're #1 on the waitlist/);
    expect(await run(`in ${day}`, "ana@example.com")).toBe("You're already on *Games* (#1 of 1).");
    expect(await spots(ev.id)).toEqual([
      expect.objectContaining({ email: "ana@example.com", spot: "main" }),
      expect.objectContaining({ email: "ben@example.com", spot: "waitlist" }),
    ]);
  });

  it("asks which list when there are several, and takes names or both", async () => {
    const ev = await practice(db, { startsIn: "2 days", lists: [{ name: "Skills", cap: 40 }, { name: "Games", cap: 40 }] });
    const day = ev.slug;
    expect(await run(`in ${day}`, "ana@example.com")).toMatch(/Which list\? \*Skills\* \(.*\) or \*Games\* \(.*\)\.\nSend `!in \S+ skills`, `!in \S+ games` or `!in \S+ both`/);
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

describe("!out (phase 3)", () => {
  it("drops all of a member's lists, and the waitlist moves up before the lock", async () => {
    const ev = await practice(db, { startsIn: "1 day", lists: [{ name: "Skills", cap: 1 }, { name: "Games", cap: 40 }] });
    const day = ev.slug;
    await dbSignUp(db, ev.id, [ev.lists.Skills, ev.lists.Games], "Ana Diaz", "ana@example.com");
    await dbSignUp(db, ev.id, [ev.lists.Skills], "Ben Ode", "ben@example.com");
    expect(await run(`out ${day} skills`, "ana@example.com")).toMatch(/^Done: you're off \*Skills\* for .*\.\n⬆️ @98765 moves up from the waitlist: in for \*Skills\* \(#1 of 1\)\.\n\n/);
    expect(await spots(ev.id)).toEqual([
      expect.objectContaining({ email: "ana@example.com", list: "Skills", status: "dropped" }),
      expect.objectContaining({ email: "ana@example.com", list: "Games", status: "active" }),
      expect.objectContaining({ email: "ben@example.com", list: "Skills", spot: "main", status: "active" }),
    ]);
    expect(await run(`out ${day}`, "ana@example.com")).toMatch(/Done: you're off \*Games\*/);
    expect(await run(`out ${day}`, "ana@example.com")).toMatch(/You're not on/);
    expect(await run(`out ${day} games`, "ben@example.com")).toMatch(/You're not on \*Games\*/);
  });

  it("asks before a late drop, and doesn't email the board", async () => {
    const ev = await practice(db, { startsIn: "5 hours" });
    await dbSignUp(db, ev.id, [ev.lists.Games], "Ana Diaz", "ana@example.com");
    await db.query(`update events set starts_at = now() + interval '1 hour', ends_at = now() + interval '3 hours' where id = $1`, [ev.id]);
    const day = ev.slug;
    const ask = await run(`out ${day}`, "ana@example.com", "chat|ana");
    expect(ask).toMatch(/^The list has locked, so this counts as a late drop\. Still drop\? Send `!out \S+ yes`\.$/);
    expect(ask).not.toMatch(/board/);
    expect((await spots(ev.id))[0].status).toBe("active");
    // Someone else's "yes" doesn't count.
    expect(await run(`out ${day}`, "ben@example.com", "chat|ben")).toMatch(/You're not on/);
    expect(await run(`out ${day} yes`, "ana@example.com", "chat|ana")).toMatch(/^Done: you're off \*Games\* for .*\. It was a late drop, so nobody moves up on their own\.\n\n/);
    expect((await spots(ev.id))[0]).toMatchObject({ status: "dropped", dropped_late: true });
    // drop_signups queued a heads-up to the board; the bot deleted it.
    expect(await emails(ev.id)).toEqual([{ kind: "signup", to_address: "ana@example.com" }]);
  });

  it("refuses cancelled practices", async () => {
    const ev = await practice(db, { startsIn: "7 days" });
    await db.query(`update events set cancelled_at = now() where id = $1`, [ev.id]);
    expect(await run(`out ${ev.slug}`, "ana@example.com")).toMatch(/cancelled/);
  });
});

describe("notifications are WhatsApp only", () => {
  it("deletes the confirmation email of a bot sign-up, and leaves the website's alone", async () => {
    const ev = await practice(db, { startsIn: "8 days" });
    await dbSignUp(db, ev.id, [ev.lists.Games], "Ben Ode", "ben@example.com"); // on the website
    await run(`in ${ev.slug}`, "cy@example.com");
    expect(await emails(ev.id)).toEqual([{ kind: "signup", to_address: "ben@example.com" }]);
    // Already on the list: nothing queued, nothing deleted.
    await run(`in ${ev.slug}`, "cy@example.com");
    expect(await emails(ev.id)).toEqual([{ kind: "signup", to_address: "ben@example.com" }]);
  });

  it("tells whoever moved up in the group: an @mention if linked, the name if not, and no email", async () => {
    const ev = await practice(db, { startsIn: "9 days", lists: [{ name: "Games", cap: 1 }] });
    await dbSignUp(db, ev.id, [ev.lists.Games], "Ana Diaz", "ana@example.com");
    await dbSignUp(db, ev.id, [ev.lists.Games], "Ben Ode", "ben@example.com");
    await dbSignUp(db, ev.id, [ev.lists.Games], "Cy Fox", "cy@example.com");
    await db.query(`delete from emails where event_id = $1`, [ev.id]);

    const [out] = await outs(`out ${ev.slug}`, "ana@example.com");
    expect(out).toEqual({
      quote: true,
      text: expect.stringMatching(/^Done: you're off \*Games\* for .*\.\n⬆️ @98765 moves up from the waitlist: in for \*Games\* \(#1 of 1\)\.\n\n[\s\S]*1\. Ben Ode\n_Waitlist_\n1\. Cy Fox/),
      mentions: ["98765@lid"],
      listOf: ev.id,
    });
    expect(await emails(ev.id)).toEqual([]);

    // Ben drops on the website: Cy's promotion email is the website's, so it stays.
    await websiteDrop(ev.id, "ben@example.com", [ev.lists.Games]);
    expect(await emails(ev.id)).toEqual([{ kind: "promoted", to_address: "cy@example.com" }]);

    // Cy drops in WhatsApp; Ana never linked her WhatsApp, so she's named, not @mentioned.
    await run(`in ${ev.slug}`, "ana@example.com");
    const [again] = await outs(`out ${ev.slug}`, "cy@example.com");
    expect(again.text).toMatch(/\n⬆️ \*Ana Diaz\* moves up from the waitlist: in for \*Games\* \(#1 of 1\)\.\n\n/);
    expect(again.mentions).toBeUndefined();
    expect(await emails(ev.id)).toEqual([{ kind: "promoted", to_address: "cy@example.com" }]);
  });
});
