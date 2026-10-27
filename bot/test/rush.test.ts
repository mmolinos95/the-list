import { beforeEach, describe, expect, it, vi } from "vitest";
import { Bot } from "../src/bot";
import type { Chat, IncomingMessage } from "../src/chat";
import type { Data } from "../src/data/types";
import { commandsFor, dataFor, FakeChat, FakeClock, FakeMailer, freshDb, memoryState, msg, practice, type Db } from "./helpers";
import type { LocalState } from "../src/state";

// R1: when sign-ups open, 30–40 people send !in within a minute or two.

let db: Db;
let data: Data;
let state: LocalState;
let clock: FakeClock;

const lid = (i: number) => `${1000 + i}@lid`;
const name = (i: number) => `Player ${String(i).padStart(2, "0")}`;

beforeEach(async () => {
  db = await freshDb();
  data = dataFor(db);
  state = memoryState();
  clock = new FakeClock();
  // 40 people who linked their WhatsApp but haven't signed up before.
  for (let i = 1; i <= 40; i++) state.saveLink([lid(i)], { email: `p${i}@example.com`, name: name(i), phone: null });
});

function botWith(chat: Chat = new FakeChat()) {
  const commands = commandsFor(data, undefined, { mentionFor: (who) => state.mentionFor(who) });
  const bot = new Bot({ chat, data, state, mailer: new FakeMailer(), commands, allowedGroups: ["CBS FC"], now: Date.now, timers: clock });
  return bot;
}

const from = (i: number, text: string) => msg({ text, senderIds: [lid(i)] });
const summaryOf = (text: string) => text.split("\n\n")[0];

describe("rush handling (R1)", () => {
  it("40 sign-ups in 30 s make a handful of list posts, with everyone in order", async () => {
    await practice(db, { lists: [{ name: "Games", cap: 38 }] });
    const chat = new FakeChat();
    const bot = botWith(chat);

    for (let i = 1; i <= 40; i++) {
      await bot.handle(from(i, "!in"));
      if (i === 40) await bot.handle(from(1, "!out")); // a drop at the end of the rush moves Player 39 up
      await clock.advance(750);
    }
    await clock.advance(20_000);

    // Two posts (one per 15 s), not 41, and nothing else.
    expect(chat.out).toHaveLength(2);
    const [first, second] = chat.out.map((o) => summaryOf(o.text));
    const firstNames = Array.from({ length: 20 }, (_, k) => `${name(k + 1)} (#${k + 1})`);
    expect(first).toBe(`✅ In: ${firstNames.join(", ")}`);
    const ins = Array.from({ length: 18 }, (_, k) => `${name(k + 21)} (#${k + 21})`);
    expect(second).toBe(
      [`✅ In: ${ins.join(", ")}`, `⏳ Waitlist: ${name(39)} (#1), ${name(40)} (#2)`, `❌ Out: ${name(1)}`, `⬆️ Moved up from the waitlist: @${lid(39).split("@")[0]} (#38)`].join("\n"),
    );
    // The promotion still @mentions the linked player.
    expect(chat.out[1].mentions).toEqual([lid(39)]);
    // A rush isn't quoted under anyone's message.
    expect(chat.out.every((o) => !o.quotedId)).toBe(true);
    // Only the newest list stays.
    expect(chat.deleted).toEqual([chat.out[0].id]);
    // The final list has everyone, in order.
    const list = chat.out[1].text;
    for (let i = 2; i <= 39; i++) expect(list).toContain(`${i - 1}. ${name(i)}\n`);
    expect(list).toMatch(/_Waitlist_\n1\. Player 40/);
    // "typing…" stayed on through the rush instead of flickering 80 times.
    expect(chat.typingLog.length).toBeLessThanOrEqual(4);
    expect(chat.typingLog.at(-1)).toMatch(/:off$/);
  });

  it("posts a single change after 5 s of quiet, quoted under the message", async () => {
    await practice(db);
    const chat = new FakeChat();
    const bot = botWith(chat);
    const m = from(7, "!in");
    await bot.handle(m);
    expect(chat.out).toEqual([]);
    await clock.advance(4_999);
    expect(chat.out).toEqual([]);
    await clock.advance(1);
    expect(chat.out).toHaveLength(1);
    expect(chat.out[0]).toMatchObject({ quotedId: m.id, text: expect.stringMatching(/^✅ In: Player 07 \(#1\)\n\n\*Thursday practice[\s\S]*1\. Player 07/) });
    expect(chat.typingLog).toEqual([`${m.chatId}:on`, `${m.chatId}:off`]);
    expect(clock.pending).toBe(0);
  });

  it("keeps replies that aren't list changes immediate and quoted", async () => {
    await practice(db, { lists: [{ name: "Skills", cap: 40 }, { name: "Games", cap: 40 }] });
    const chat = new FakeChat();
    const bot = botWith(chat);
    const m = from(3, "!in");
    await bot.handle(m);
    expect(chat.out).toEqual([expect.objectContaining({ quotedId: m.id, text: expect.stringMatching(/^Which list\?/) })]);
    await bot.handle(from(3, "!in both"));
    await bot.handle(from(3, "!in both"));
    // "already on it" comes right away; the sign-up itself waits for the batch.
    expect(chat.out.map((o) => o.text)).toEqual([expect.stringMatching(/^Which list/), expect.stringMatching(/already on \*Skills\*[\s\S]*already on \*Games\*/)]);
    await clock.advance(5_000);
    expect(summaryOf(chat.out[2].text)).toBe("✅ In: Player 03 (Skills #1), Player 03 (Games #1)");
  });

  it("doesn't let slow sending hold up the next write", async () => {
    const ev = await practice(db);
    let unblock = () => {};
    const blocked = new Promise<void>((r) => (unblock = r));
    const slow = new FakeChat();
    const chat: Chat = {
      reply: async (to: IncomingMessage, text: string, mentions?: string[]) => (await blocked, slow.reply(to, text, mentions)),
      send: (chatId: string, text: string, mentions?: string[]) => slow.send(chatId, text, mentions),
      delete: (chatId: string, id: string) => slow.delete(chatId, id),
      typing: (chatId: string, on: boolean) => slow.typing(chatId, on),
    };
    const bot = botWith(chat);
    const first = bot.handle(from(1, "!me")); // its reply is stuck in "sending"
    void bot.handle(from(2, "!in"));
    // Player 02's sign-up reaches the database although Player 01's reply hasn't gone out.
    await vi.waitFor(async () => {
      const rows = await db.query(`select 1 from signups s join event_lists l on l.id = s.list_id where l.event_id = $1`, [ev.id]);
      expect(rows.rows).toHaveLength(1);
    });
    expect(slow.out).toEqual([]);
    unblock();
    await first;
    expect(slow.out).toHaveLength(1);
  });

  it("still says what changed if the list can't be read", async () => {
    await practice(db);
    const chat = new FakeChat();
    const bot = botWith(chat);
    await bot.handle(from(5, "!in"));
    data.practice = async () => Promise.reject(new Error("db down"));
    await clock.advance(5_000);
    expect(chat.out.map((o) => o.text)).toEqual(["✅ In: Player 05 (#1)"]);
  });
});
