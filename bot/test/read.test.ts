import { beforeAll, describe, expect, it } from "vitest";
import { signUp } from "../../tests/db/harness";
import { askerOf, commandsFor, dataFor, freshDb, member, practice, type Db } from "./helpers";
import { parseCommand } from "../src/parse";
import type { Data } from "../src/data/types";
import { weekdayShort } from "../../src/lib/time";

let db: Db;
let data: Data;
let ev: Awaited<ReturnType<typeof practice>>;
let day: string;

beforeAll(async () => {
  db = await freshDb();
  data = dataFor(db);
  ev = await practice(db, { startsIn: "26 hours", lists: [{ name: "Skills", cap: 2 }, { name: "Games", cap: 40 }] });
  await practice(db, { startsIn: "-3 hours" }); // already over
  await practice(db, { startsIn: "5 days", opensIn: null, title: "Later practice" });
  day = weekdayShort((await db.query<{ starts_at: string }>(`select starts_at::text from events where id = $1`, [ev.id])).rows[0].starts_at).toLowerCase();
  await member(db, "ana@example.com", "Ana Diaz");
  await signUp(db, ev.id, [ev.lists.Skills], "Ana Diaz", "ana@example.com");
  await signUp(db, ev.id, [ev.lists.Skills, ev.lists.Games], "Ben Ode", "ben@example.com");
  await signUp(db, ev.id, [ev.lists.Skills], "Cy Fox", "cy@example.com");
});

const run = async (text: string, email: string | null = null, features?: Parameters<typeof commandsFor>[1]) => {
  const out = await commandsFor(data, features).run(parseCommand(text), { asker: email ? await askerOf(data, email) : null, chatKey: "k" });
  return out.map((o) => o.text).join("\n---\n");
};

describe("reading (phase 1)", () => {
  it("!week shows upcoming practices with spots left, and a short help", async () => {
    const text = await run("week");
    expect(text).toMatch(/\*Upcoming practices\*/);
    expect(text).toMatch(/Skills full, 1 waiting · Games 39 left · Open · locks/);
    expect(text).toMatch(/Sign-ups not open yet/);
    expect(text).toMatch(/`!help`/);
    expect(text.match(/Riverside Park/g)).toHaveLength(2); // the finished practice isn't there
  });

  it("!list <day> shows the practice with everyone's names, in order, and the waitlist", async () => {
    const text = await run(`list ${day}`);
    expect(text).toMatch(/\*Thursday practice · /);
    expect(text).toMatch(/\*Skills\* · .* · 2\/2\n1\. Ana Diaz\n2\. Ben Ode\n_Waitlist_\n1\. Cy Fox/);
    expect(text).toMatch(/\*Games\* · .* · 1\/40\n1\. Ben Ode/);
    expect(text).toMatch(/Sign up: `!in \w{3}` · Drop out: `!out \w{3}`/);
  });

  it("plain !list is the next practice, and the reply replaces the previous list", async () => {
    const out = await commandsFor(data).run(parseCommand("list"), { asker: null, chatKey: "k" });
    expect(out).toEqual([{ text: expect.stringMatching(/Thursday practice[\s\S]*1\. Ana Diaz/), quote: true, listOf: ev.id }]);
    expect(await run("list", null)).toBe(await run(day, null));
  });

  it("says when it can't find a practice", async () => {
    expect(await run("12/25")).toMatch(/can't find a practice for "12\/25"/);
  });

  it("!me shows the asker's own spots and waitlist position", async () => {
    expect(await run("me", "cy@example.com")).toMatch(/Skills: waitlist #1/);
    expect(await run("me", "ben@example.com")).toMatch(/Skills: in \(#2 of 2\) · Games: in \(#1 of 40\)/);
  });

  it("!me tells unknown senders how to link", async () => {
    expect(await run("me")).toMatch(/https:\/\/wa\.me\/12125550100\?text=link/);
  });

  it("help shows board commands only to the board, and only switched-on features", async () => {
    await db.query(`insert into board_members (email, name, role) values ('ana@example.com', 'Ana', 'president')`);
    expect(await run("help", "ana@example.com")).toMatch(/\*Board\*[\s\S]*!cancel thu/);
    expect(await run("help", "cy@example.com")).not.toMatch(/Board/);
    const readOnly = await run("help", "ana@example.com", ["read"]);
    expect(readOnly).not.toMatch(/!in|Board/);
  });

  it("commands for features that are off say so", async () => {
    expect(await run(`in ${day}`, "cy@example.com", ["read"])).toMatch(/isn't switched on/);
    expect(await run("who's coming tonight?", "cy@example.com", ["read"])).toMatch(/didn't get that/);
  });
});
