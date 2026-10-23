import { beforeAll, describe, expect, it } from "vitest";
import { Bot } from "../src/bot";
import type { Data } from "../src/data/types";
import { parseCommand } from "../src/parse";
import { signupKey } from "../src/links";
import { askerOf, board, commandsFor, dataFor, FakeChat, FakeMailer, freshDb, member, memoryState, msg, practice, type Db } from "./helpers";
import { weekdayShort } from "../../src/lib/time";

let db: Db;
let data: Data;
let open: Awaited<ReturnType<typeof practice>>;
let openDay: string;
let waitingDay: string;

const dayOf = async (id: string) =>
  weekdayShort((await db.query<{ s: string }>(`select starts_at::text as s from events where id = $1`, [id])).rows[0].s).toLowerCase();

beforeAll(async () => {
  db = await freshDb();
  data = dataFor(db);
  open = await practice(db, { startsIn: "2 days", lists: [{ name: "Skills", cap: 40 }, { name: "Games", cap: 32 }] });
  const waiting = await practice(db, { startsIn: "4 days", opensIn: null });
  openDay = await dayOf(open.id);
  waitingDay = await dayOf(waiting.id);
  await member(db, "pres@example.com", "Pres");
  await board(db, "pres@example.com");
  await member(db, "ana@example.com", "Ana");
});

const run = async (text: string, email: string | null, features?: Parameters<typeof commandsFor>[1]) =>
  commandsFor(data, features).run(parseCommand(text), { asker: email ? await askerOf(data, email) : null, chatKey: "k" });

describe("!list post (phase 2)", () => {
  it("without sign-ups in WhatsApp, posts the app's WhatsApp text with the signed link, as a plain message", async () => {
    const out = await run(`post ${openDay}`, "pres@example.com", ["read", "post"]);
    expect(out).toHaveLength(1);
    expect(out[0].quote).toBe(false);
    expect(out[0].text).toMatch(/^List Sign Up: \d+\/\d+ \w+day Practice\nSkills: \d\d:\d\d - \d\d:\d\d \(40 players\)\nGames: \d\d:\d\d - \d\d:\d\d \(32 players\)\nLocation: Riverside Park\nSign up: https:\/\/list\.example\/p\/\d{4}-\d\d-\d\d-[a-z]{3}\?k=[\w-]{16}$/);
    expect(out[0].text).toContain(`?k=${signupKey("test-secret", open.slug)}`);
  });

  it("with sign-ups in WhatsApp on, posts the commands first and the link as a fallback", async () => {
    const out = await run(`post ${openDay}`, "pres@example.com", ["read", "post", "signup"]);
    expect(out[0].quote).toBe(false);
    const lines = out[0].text.split("\n");
    expect(lines[0]).toMatch(/^List Sign Up: \d+\/\d+ \w+day Practice$/);
    expect(lines).toContain(`*Sign up here:* send \`!list in ${openDay}\``);
    expect(lines).toContain(`One list only? \`!list in ${openDay} skills\` · Both: \`!list in ${openDay} both\``);
    expect(lines).toContain(`Drop out: \`!list out ${openDay}\` · Who's in: \`!list ${openDay}\``);
    expect(lines.at(-1)).toBe(`Or on the web: https://list.example/p/${open.slug}?k=${signupKey("test-secret", open.slug)}`);
  });

  it("still posts the commands without a link secret, and says when !list in will work", async () => {
    const cmds = commandsFor(data, ["read", "post", "signup"], { dropLinkSecret: null });
    const out = await cmds.run(parseCommand(`post ${waitingDay}`), { asker: await askerOf(data, "pres@example.com"), chatKey: "k" });
    expect(out[0].text).toMatch(/Sign up here/);
    expect(out[0].text).not.toMatch(/Or on the web/);
    expect(out[1].text).toMatch(/aren't open yet, so `!list in` won't work until they open/);
  });

  it("warns the board when sign-ups aren't open yet", async () => {
    const out = await run(`post ${waitingDay}`, "pres@example.com");
    expect(out[1]).toEqual({ quote: true, text: expect.stringMatching(/aren't open yet[\s\S]*!list open/) });
  });

  it("is for the board only, and needs the feature and the secret", async () => {
    expect((await run(`post ${openDay}`, "ana@example.com"))[0].text).toBe("Only the board can do that.");
    expect((await run(`post ${openDay}`, null))[0].text).toMatch(/don't know your WhatsApp/);
    expect((await run(`post ${openDay}`, "pres@example.com", ["read"]))[0].text).toMatch(/isn't switched on/);
    const noSecret = await commandsFor(data, ["read", "post"], { dropLinkSecret: null }).run(parseCommand(`post ${openDay}`), { asker: await askerOf(data, "pres@example.com"), chatKey: "k" });
    expect(noSecret[0].text).toMatch(/DROP_LINK_SECRET/);
  });

  it("goes out in the group as a new message, not a quote", async () => {
    const chat = new FakeChat();
    const state = memoryState();
    state.saveLink(["p@lid"], { email: "pres@example.com", name: null, phone: null });
    const bot = new Bot({ chat, data, state, mailer: new FakeMailer(), commands: commandsFor(data), allowedGroups: ["CBS FC"], now: Date.now });
    await bot.handle(msg({ text: `!list post ${openDay}`, senderIds: ["p@lid"] }));
    expect(chat.out).toEqual([{ chatId: msg().chatId, text: expect.stringMatching(/^List Sign Up/) }]);
  });
});
