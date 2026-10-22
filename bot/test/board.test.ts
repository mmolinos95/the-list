import { beforeAll, describe, expect, it } from "vitest";
import { signUp as dbSignUp } from "../../tests/db/harness";
import type { Commands } from "../src/commands";
import type { Data } from "../src/data/types";
import { parseCommand } from "../src/parse";
import { askerOf, board, commandsFor, dataFor, freshDb, member, practice, type Db } from "./helpers";

let db: Db;
let data: Data;
let commands: Commands;
let presId: string;

beforeAll(async () => {
  db = await freshDb();
  data = dataFor(db);
  commands = commandsFor(data);
  await member(db, "pres@example.com", "Pat President");
  presId = await board(db, "pres@example.com", "Pat");
  await member(db, "ana@example.com", "Ana Diaz");
});

async function run(text: string, email = "pres@example.com", chatKey = "chat|pres") {
  const out = await commands.run(parseCommand(text), { asker: await askerOf(data, email), chatKey });
  return out.map((o) => o.text).join("\n");
}
const one = async <T>(sql: string, params: unknown[]) => (await db.query<T>(sql, params)).rows[0];

describe("board commands (phase 4)", () => {
  it("are for the board only", async () => {
    const ev = await practice(db);
    for (const cmd of ["open", "lock", "cancel", "teams"]) expect(await run(`${cmd} ${ev.slug}`, "ana@example.com")).toBe("Only the board can do that.");
    expect(await run(`add ${ev.slug} Joe Walkin`, "ana@example.com")).toBe("Only the board can do that.");
  });

  it("!list open opens sign-ups now, like the app's button", async () => {
    const ev = await practice(db, { startsIn: "3 days", opensIn: null });
    expect(await run(`open ${ev.slug}`)).toMatch(/Sign-ups for .* are open\. Post the link with `!list post/);
    expect(await one<{ open: boolean }>(`select opens_at <= now() as open from events where id = $1`, [ev.id])).toEqual({ open: true });
    expect(await run(`open ${ev.slug}`)).toMatch(/already open/);
  });

  it("!list lock explains that lists lock on their own", async () => {
    const ev = await practice(db, { startsIn: "4 days" });
    expect(await run(`lock ${ev.slug}`)).toMatch(/no early lock yet: .* locks on its own .*2 hours before/);
    const locked = await practice(db, { startsIn: "1 hour" });
    expect(await run(`lock ${locked.slug}`)).toMatch(/already locked/);
  });

  it("!list cancel asks first, then cancels with the reason and emails everyone", async () => {
    const ev = await practice(db, { startsIn: "5 days" });
    await dbSignUp(db, ev.id, [ev.lists.Games], "Ana Diaz", "ana@example.com");
    expect(await run(`cancel ${ev.slug} field is flooded`)).toMatch(/Cancel .*\? Everyone on it \(1 player\) gets an email\. Reason: "field is flooded"\.\nSend `!list cancel \S+ yes`/);
    expect(await one(`select cancelled_at from events where id = $1`, [ev.id])).toEqual({ cancelled_at: null });
    expect(await run(`cancel ${ev.slug} yes`)).toMatch(/is cancelled\. Emailing 1 player\./);
    expect(await one(`select cancel_reason, cancelled_by from events where id = $1`, [ev.id])).toEqual({ cancel_reason: "field is flooded", cancelled_by: presId });
    expect(await one(`select count(*)::int as n from emails where kind = 'cancelled' and event_id = $1`, [ev.id])).toEqual({ n: 1 });
    expect(await run(`cancel ${ev.slug} yes`)).toMatch(/already cancelled/);
  });

  it("!list cancel <day> <reason> yes works in one go", async () => {
    const ev = await practice(db, { startsIn: "6 days" });
    expect(await run(`cancel ${ev.slug} thunderstorms yes`)).toMatch(/Nobody was signed up/);
    expect(await one(`select cancel_reason from events where id = $1`, [ev.id])).toEqual({ cancel_reason: "thunderstorms" });
  });

  it("!list add asks which list when there are several", async () => {
    const ev = await practice(db, { startsIn: "7 days", lists: [{ name: "Skills", cap: 1 }, { name: "Games", cap: 40 }] });
    expect(await run(`add ${ev.slug} Joe Walkin`)).toMatch(/Which list\? .*Send `!list add \S+ Joe Walkin skills`/);
  });

  it("!list add: over the cap on main, multi-word list names, waitlist", async () => {
    const ev = await practice(db, { startsIn: "8 days", lists: [{ name: "Skills", cap: 1 }, { name: "Small Sided", cap: 40 }] });
    expect(await run(`add ${ev.slug} Joe Walkin skills`)).toMatch(/^Added \*Joe Walkin\* to the main list for \*Skills\*, .*\.$/);
    expect(await run(`add ${ev.slug} Kim Lee skills`)).toMatch(/to the main list for \*Skills\*.* That's 2 of 1\./);
    expect(await run(`add ${ev.slug} Mo Salah small sided`)).toMatch(/Added \*Mo Salah\* to the main list for \*Small Sided\*/);
    expect(await run(`add ${ev.slug} Lu Wait skills waitlist`)).toMatch(/Added \*Lu Wait\* to the waitlist for \*Skills\*/);
    // Before the lock a waitlisted walk-in moves straight up if there's room (the database does that).
    expect(await run(`add ${ev.slug} Al Room small sided waitlist`)).toMatch(/to the main list for \*Small Sided\*/);
    expect(await run(`add ${ev.slug}`)).toMatch(/Who should I add\?/);
    const rows = (await db.query(`select m.name, l.name as list, s.spot, s.added_by from signups s join members m on m.id = s.member_id join event_lists l on l.id = s.list_id where l.event_id = $1 order by s.created_at`, [ev.id])).rows;
    expect(rows).toEqual([
      { name: "Joe Walkin", list: "Skills", spot: "main", added_by: presId },
      { name: "Kim Lee", list: "Skills", spot: "main", added_by: presId },
      { name: "Mo Salah", list: "Small Sided", spot: "main", added_by: presId },
      { name: "Lu Wait", list: "Skills", spot: "waitlist", added_by: presId },
      { name: "Al Room", list: "Small Sided", spot: "main", added_by: presId },
    ]);
  });

  it("!list teams shuffles and shows the draft teams", async () => {
    const ev = await practice(db, { startsIn: "9 days", lists: [{ name: "Skills", cap: 40 }, { name: "Games", cap: 40, teams: true }] });
    expect(await run(`teams ${ev.slug}`)).toBe("Nobody's on the list yet.");
    for (const name of ["A One", "B Two", "C Three", "D Four", "E Five"]) await run(`add ${ev.slug} ${name} games`);
    const text = await run(`teams ${ev.slug}`);
    expect(text).toMatch(/^\*Games teams · .*\*\n\*Black\* \(2\): .*\n\*White\* \(1\): .*\n\*Red\* \(1\): .*\n\*Light Blue\* \(1\): .*\n\n_Shuffled, not sent yet\._ .*https:\/\/list\.example\/admin\/p\/\S+\/teams$/);
    expect(await one(`select count(*)::int as n from signups s join event_lists l on l.id = s.list_id where l.event_id = $1 and team is not null`, [ev.id])).toEqual({ n: 5 });
    const noTeams = await practice(db, { startsIn: "10 days" });
    expect(await run(`teams ${noTeams.slug}`)).toMatch(/no list that makes teams/);
  });
});
