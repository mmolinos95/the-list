import { beforeAll, describe, expect, it } from "vitest";
import type { Commands } from "../src/commands";
import type { Data } from "../src/data/types";
import { whoIs } from "../src/identity";
import { parseCommand } from "../src/parse";
import { commandsFor, dataFor, freshDb, member, memoryState, practice, type Db } from "./helpers";

// First-timers sign up in the group with "!in First Last": WhatsApp's verified
// phone number identifies them, so no DM and no email.

let db: Db;
let data: Data;
let commands: Commands;
const state = memoryState();

/** A message from this WhatsApp sender, through identity like the real bot. */
async function from(sender: { ids: string[]; phone: string | null }, text: string) {
  const asker = await whoIs(sender.ids, sender.phone, data, state);
  const outs = await commands.run(parseCommand(text), { asker, chatKey: `chat|${sender.ids[0]}`, phone: sender.phone });
  return outs.map((o) => o.text).join("\n");
}
const andres = { ids: ["5551@lid"], phone: "+12125550161" };
const membersWith = async (phone: string) =>
  (await db.query<{ email: string | null; name: string }>(`select email, name from members where phone = $1`, [phone])).rows;
const emailsFor = async (eventId: string) => (await db.query(`select kind from emails where event_id = $1`, [eventId])).rows;

beforeAll(async () => {
  db = await freshDb();
  data = dataFor(db);
  commands = commandsFor(data, undefined, { mentionFor: (who) => state.mentionFor(who) });
});

describe("first-time sign-up by phone", () => {
  it("asks for a name once, then signs up with it and knows them by phone after", async () => {
    const ev = await practice(db, { startsIn: "1 day" });
    expect(await from(andres, "in")).toBe("First time? Add your name once: `!in Firstname Lastname`. After that, `!in` is enough.");
    const first = await from(andres, "in Andrés Yunge");
    expect(first).toMatch(/^You're in: \*Games\*, #1 of 40\.\nI'll know you from now on: next time, just `!in`\.\n\n[\s\S]*1\. Andrés Yunge/);
    expect(await membersWith(andres.phone)).toEqual([{ email: null, name: "Andrés Yunge" }]);
    expect(await emailsFor(ev.id)).toEqual([]);

    // Known now: plain commands work, and a stray name doesn't rename him or make a second member.
    expect(await from(andres, "in")).toBe("You're already on *Games* (#1 of 40).");
    expect(await from(andres, "in for real")).toBe("You're already on *Games* (#1 of 40).");
    expect(await from(andres, "me")).toMatch(/^\*Your spots\*\n/);
    expect(await membersWith(andres.phone)).toEqual([{ email: null, name: "Andrés Yunge" }]);
    expect(await from(andres, "out")).toMatch(/^Done: you're off \*Games\*/);
  });

  it("takes the name with a list, tidies lowercase names, and keeps the name in the 'which list' hint", async () => {
    const ev = await practice(db, { startsIn: "2 days", lists: [{ name: "Skills", cap: 40 }, { name: "Games", cap: 40 }] });
    const sender = { ids: ["5552@lid"], phone: "+12125550162" };
    expect(await from(sender, `in ${ev.slug} mary o'neil-diaz`)).toMatch(/Which list\? .*\nSend `!in \S+ Mary O'Neil-Diaz skills`, `!in \S+ Mary O'Neil-Diaz games` or `!in \S+ Mary O'Neil-Diaz both`/);
    expect(await from(sender, `in ${ev.slug} mary o'neil-diaz games`)).toMatch(/^You're in: \*Games\*/);
    expect(await from(sender, `in ${ev.slug} skills`)).toMatch(/^You're in: \*Skills\*/);
    expect(await membersWith(sender.phone)).toEqual([{ email: null, name: "Mary O'Neil-Diaz" }]);
  });

  it("uses the website's record when the phone matches one", async () => {
    const ev = await practice(db, { startsIn: "3 days" });
    const sender = { ids: ["5553@lid"], phone: "+12125550163" };
    await member(db, "web@example.com", "Web Person", sender.phone);
    expect(await from(sender, "in")).toMatch(/^You're in/);
    expect(await membersWith(sender.phone)).toEqual([{ email: "web@example.com", name: "Web Person" }]);
    expect(await emailsFor(ev.id)).toEqual([]); // the confirmation email is deleted, as before
  });

  it("@mentions them by phone when they move up from the waitlist", async () => {
    const ev = await practice(db, { startsIn: "4 days", lists: [{ name: "Games", cap: 1 }] });
    const ana = { ids: ["5554@lid"], phone: "+12125550164" };
    const ben = { ids: ["5555@lid"], phone: "+12125550165" };
    await from(ana, `in ${ev.slug} Ana Diaz`);
    expect(await from(ben, `in ${ev.slug} Ben Ode`)).toMatch(/is full\. You're #1 on the waitlist/);
    await from(ben, "me"); // seen once more, so the bot links his WhatsApp ID to his phone
    const outs = await commands.run(parseCommand(`out ${ev.slug}`), { asker: await whoIs(ana.ids, ana.phone, data, state), chatKey: "chat|ana", phone: ana.phone });
    expect(outs[0].text).toMatch(/\n⬆️ @5555 moves up from the waitlist: in for \*Games\* \(#1 of 1\)\./);
    expect(outs[0].mentions).toEqual(["5555@lid"]);
  });

  it("still sends people whose number WhatsApp hides to the DM link", async () => {
    await practice(db, { startsIn: "5 days" });
    expect(await from({ ids: ["5556@lid"], phone: null }, "in Hidden Person")).toMatch(/don't know your WhatsApp yet/);
  });

  it("points unknown senders to !in for !me, and unknown board members to the DM link", async () => {
    const sender = { ids: ["5557@lid"], phone: "+12125550167" };
    expect(await from(sender, "me")).toMatch(/First time\? Sign up with `!in Firstname Lastname`/);
    expect(await from(sender, "open")).toMatch(/^Only the board can do that\. On the board\? Connect your WhatsApp to your board email once: tap https:\/\/wa\.me\//);
  });

  it("makes one member per phone even when the same person signs up twice at once", async () => {
    const ev = await practice(db, { startsIn: "6 days" });
    const phone = "+12125550168";
    await Promise.all([data.signUpByPhone(ev.id, [ev.lists.Games], "Twice Fast", phone), data.signUpByPhone(ev.id, [ev.lists.Games], "Twice Fast", phone)]);
    expect(await membersWith(phone)).toHaveLength(1);
    await expect(data.signUpByPhone(ev.id, [ev.lists.Games], null, "+12125550169")).rejects.toThrow(/name_required/);
  });
});
