import { beforeAll, describe, expect, it } from "vitest";
import { Bot, isAllowedGroup, MAX_AGE_S } from "../src/bot";
import type { Commands } from "../src/commands";
import { commandsFor, dataFor, FakeChat, FakeMailer, freshDb, member, memoryState, msg, practice, type Db } from "./helpers";

let db: Db;
beforeAll(async () => {
  db = await freshDb();
  await practice(db);
  await member(db, "ana@example.com", "Ana Diaz", "+12125550101");
});

function setup() {
  const chat = new FakeChat();
  const mailer = new FakeMailer();
  const state = memoryState();
  const data = dataFor(db);
  const bot = new Bot({ chat, data, state, mailer, commands: commandsFor(data, ["read"]), allowedGroups: ["CBS FC"], now: Date.now });
  return { chat, mailer, state, bot };
}

describe("the router", () => {
  it("answers ! commands in an allowed group, quoted, with typing shown", async () => {
    const { bot, chat } = setup();
    const m = msg({ text: "!week" });
    await bot.handle(m);
    expect(chat.out).toHaveLength(1);
    expect(chat.out[0]).toMatchObject({ chatId: m.chatId, quotedId: m.id });
    expect(chat.out[0].text).toMatch(/Upcoming practices/);
    expect(chat.typingLog).toEqual([`${m.chatId}:on`, `${m.chatId}:off`]);
  });

  it("answers @mentions too", async () => {
    const { bot, chat } = setup();
    await bot.handle(msg({ text: "help", mentionsBot: true }));
    expect(chat.out[0].text).toMatch(/The List bot/);
  });

  it("ignores other groups, other messages, and old backlog", async () => {
    const { bot, chat } = setup();
    await bot.handle(msg({ groupName: "Another group" }));
    await bot.handle(msg({ groupName: undefined }));
    await bot.handle(msg({ text: "anyone up for practice?" }));
    await bot.handle(msg({ timestamp: Math.floor(Date.now() / 1000) - MAX_AGE_S - 5 }));
    expect(chat.out).toHaveLength(0);
    expect(chat.typingLog).toHaveLength(0);
  });

  it("ignores DMs unless they're part of linking", async () => {
    const { bot, chat, mailer, state } = setup();
    const dm = (text: string) => msg({ chatId: "999@lid", isGroup: false, groupName: undefined, senderIds: ["999@lid"], text });
    await bot.handle(dm("!list"));
    await bot.handle(dm("hi"));
    expect(chat.out).toHaveLength(0);

    await bot.handle(dm("link"));
    await bot.handle(dm("ana@example.com"));
    await bot.handle(dm(mailer.lastCode()!));
    expect(chat.out.map((o) => o.text)).toEqual([
      expect.stringMatching(/What email/),
      expect.stringMatching(/emailed a 6-digit code/),
      expect.stringMatching(/You're set, Ana/),
    ]);
    expect(chat.out.every((o) => o.chatId === "999@lid" && !o.quotedId)).toBe(true);
    expect(state.link(["999@lid"])?.email).toBe("ana@example.com");
  });

  it("recognizes a linked sender in the group", async () => {
    const { bot, chat, state } = setup();
    state.saveLink(["777@lid"], { email: "ana@example.com", name: null, phone: null });
    await bot.handle(msg({ text: "!me", senderIds: ["777@lid"] }));
    expect(chat.out[0].text).toMatch(/not on any upcoming list/);
  });

  it("matches a visible phone number in the group", async () => {
    const { bot, chat, state } = setup();
    await bot.handle(msg({ text: "!me", senderIds: ["12125550101@s.whatsapp.net"], senderPhone: "+12125550101" }));
    expect(chat.out[0].text).toMatch(/not on any upcoming list/);
    expect(state.link(["12125550101@s.whatsapp.net"])?.email).toBe("ana@example.com");
  });

  it("answers one question at a time per chat, in order", async () => {
    const { bot, chat } = setup();
    await Promise.all([bot.handle(msg({ text: "!help" })), bot.handle(msg({ text: "!me" }))]);
    expect(chat.out[0].text).toMatch(/The List bot/);
    expect(chat.out[1].text).toMatch(/don't know your WhatsApp/);
    expect(chat.typingLog).toEqual(chat.typingLog.map((_, i) => (i % 2 ? expect.stringMatching(/off$/) : expect.stringMatching(/on$/))));
  });

  it("passes @mentions and quoting through to WhatsApp", async () => {
    const chat = new FakeChat();
    const data = dataFor(db);
    const commands = { run: async () => [{ text: "Done.\n⬆️ @98765 moves up", quote: true, mentions: ["98765@lid"] }, { text: "Notice", quote: false }] } as unknown as Commands;
    const bot = new Bot({ chat, data, state: memoryState(), mailer: new FakeMailer(), commands, allowedGroups: ["CBS FC"], now: Date.now });
    const m = msg({ text: "!out thu" });
    await bot.handle(m);
    expect(chat.out).toEqual([
      { id: "sent1", chatId: m.chatId, text: "Done.\n⬆️ @98765 moves up", quotedId: m.id, mentions: ["98765@lid"] },
      { id: "sent2", chatId: m.chatId, text: "Notice" },
    ]);
  });

  it("says sorry instead of crashing when something fails", async () => {
    const chat = new FakeChat();
    const data = { ...dataFor(db), upcoming: async () => Promise.reject(new Error("db down")) };
    const bot = new Bot({ chat, data, state: memoryState(), mailer: new FakeMailer(), commands: commandsFor(data, ["read"]), allowedGroups: ["CBS FC"], now: Date.now });
    await bot.handle(msg({ text: "!list" }));
    expect(chat.out[0].text).toMatch(/something went wrong/);
  });

  it("keeps only the newest list of a practice: each new one deletes the bot's previous one", async () => {
    const chat = new FakeChat();
    let n = 0;
    const commands = { run: async () => [{ text: `List ${++n}`, quote: true, listOf: n < 3 ? "ev1" : "ev2" }] } as unknown as Commands;
    const bot = new Bot({ chat, data: dataFor(db), state: memoryState(), mailer: new FakeMailer(), commands, allowedGroups: ["CBS FC"], now: Date.now });
    await bot.handle(msg({ text: "!in thu" }));
    expect(chat.deleted).toEqual([]);
    await bot.handle(msg({ text: "!in thu" }));
    expect(chat.deleted).toEqual(["sent1"]);
    await bot.handle(msg({ text: "!list fri" })); // another practice: nothing to replace
    expect(chat.deleted).toEqual(["sent1"]);
  });

  it("treats a reply to the bot like an @mention", async () => {
    const { bot, chat } = setup();
    await bot.handle(msg({ text: "help", repliesToBot: true }));
    expect(chat.out[0].text).toMatch(/The List bot/);
  });

  it("ignores ! messages that aren't commands", async () => {
    const { bot, chat } = setup();
    for (const text of ["!!!", "!nice", "!lol thu"]) await bot.handle(msg({ text }));
    expect(chat.out).toEqual([]);
  });

  it("matches allowed groups by ID (survives renames) or by exact name", () => {
    const g = { chatId: "120363000000000001@g.us", groupName: "CBS FC ⚽️ 2026" };
    expect(isAllowedGroup(g, ["120363000000000001@g.us"])).toBe(true);
    expect(isAllowedGroup({ ...g, groupName: "Renamed" }, ["120363000000000001@g.us"])).toBe(true);
    expect(isAllowedGroup(g, ["CBS FC ⚽️ 2026"])).toBe(true);
    expect(isAllowedGroup({ ...g, groupName: "Renamed" }, ["CBS FC ⚽️ 2026"])).toBe(false);
    expect(isAllowedGroup(g, ["999@g.us", "Other"])).toBe(false);
  });
});
