import { beforeAll, describe, expect, it } from "vitest";
import { signUp as dbSignUp } from "../../tests/db/harness";
import { ask, contextFor, TOOLS, toolsFor, type AiAnswer, type AiModel, type ToolDecl } from "../src/ai";
import { FEATURES } from "../src/config";
import type { Data } from "../src/data/types";
import type { Asker } from "../src/identity";
import { parseCommand } from "../src/parse";
import { ChatMemory } from "../src/memory";
import { askerOf, board, commandsFor, dataFor, freshDb, member, practice, type Db } from "./helpers";

/** A fake Gemini: records what it was sent, answers with a script. */
class FakeModel implements AiModel {
  calls: { system: string; prompt: string; tools: ToolDecl[] }[] = [];
  constructor(private answer: (prompt: string) => AiAnswer | Promise<AiAnswer>) {}
  async generate(req: { system: string; prompt: string; tools: ToolDecl[]; signal: AbortSignal }) {
    this.calls.push(req);
    return this.answer(req.prompt);
  }
}

let db: Db;
let data: Data;
let ev: Awaited<ReturnType<typeof practice>>;

beforeAll(async () => {
  db = await freshDb();
  data = dataFor(db);
  ev = await practice(db, { startsIn: "2 days", lists: [{ name: "Skills", cap: 2 }, { name: "Games", cap: 40, teams: true }] });
  await member(db, "ana@example.com", "Ana Secretname", "+12125550101");
  await member(db, "pres@example.com", "Pat Boardname");
  await board(db, "pres@example.com");
  await dbSignUp(db, ev.id, [ev.lists.Skills], "Ana Secretname", "ana@example.com");
  await dbSignUp(db, ev.id, [ev.lists.Skills, ev.lists.Games], "Zed Othermember", "zed@example.com", "+12125550177");
  await dbSignUp(db, ev.id, [ev.lists.Skills], "Yu Waiting", "yu@example.com");
});

async function free(model: AiModel, question: string, email: string | null, features = [...FEATURES]) {
  const commands = commandsFor(data, features, { ai: model });
  const asker = email ? await askerOf(data, email) : null;
  return (await commands.run(parseCommand(question), { asker, chatKey: `chat|${email}` })).map((o) => o.text).join("\n");
}

describe("Gemini (phase 5)", () => {
  it("only ever sees practice facts, counts and the asker's own spots", async () => {
    const model = new FakeModel(() => ({ text: "Yes, Skills is full." }));
    expect(await free(model, "is skills full?", "ana@example.com")).toBe("Yes, Skills is full.");
    const sent = model.calls[0].system + model.calls[0].prompt;
    expect(sent).toContain(`slug ${ev.slug}`);
    expect(sent).toMatch(/list Skills: .*, 2 of 2 spots taken, 1 on the waitlist/);
    expect(sent).toContain(`Their spots: ${ev.slug} Skills: main list #1.`);
    for (const secret of ["Secretname", "Othermember", "Yu Waiting", "Zed", "@example.com", "+1212", "Boardname"]) expect(sent).not.toContain(secret);
  });

  it("runs the command Gemini picks, with the asker's own permissions", async () => {
    const model = new FakeModel(() => ({ call: { name: "my_spots", args: {} } }));
    expect(await free(model, "where am i on the list", "ana@example.com")).toMatch(/\*Your spots\*\n.*Skills: in \(#1 of 2\)/);
  });

  it("signs up through the same checks as !in", async () => {
    const games = new FakeModel(() => ({ call: { name: "sign_up", args: { practice: ev.slug, lists: "games" } } }));
    expect(await free(games, "I'll play games", "ana@example.com")).toMatch(/You're in: \*Games\*/);
    expect(await free(games, "I'll play games", null)).toMatch(/don't know your WhatsApp/);
    // No list named means every list.
    const any = new FakeModel(() => ({ call: { name: "sign_up", args: { practice: ev.slug } } }));
    expect(await free(any, "put me down for that one", "ana@example.com")).toMatch(/already on \*Skills\*[\s\S]*already on \*Games\*/);
  });

  it("doesn't offer board tools to members, and refuses them if asked anyway", async () => {
    const model = new FakeModel(() => ({ call: { name: "cancel_practice", args: { practice: ev.slug, reason: "rain" } } }));
    expect(await free(model, "cancel it", "ana@example.com")).toMatch(/can't do that/);
    expect(model.calls[0].tools.map((t) => t.name)).not.toContain("cancel_practice");
  });

  it("never confirms a cancel for the board: they have to send yes", async () => {
    const model = new FakeModel(() => ({ call: { name: "cancel_practice", args: { practice: ev.slug, reason: "rain yes" } } }));
    expect(await free(model, "cancel it, yes", "pres@example.com")).toMatch(/Cancel .*\? .*Reason: "rain"\.\nSend `!cancel \S+ yes`/);
    expect((await db.query(`select cancelled_at from events where id = $1`, [ev.id])).rows[0]).toEqual({ cancelled_at: null });
  });

  it("offers only the switched-on features", async () => {
    const asker = await askerOf(data, "pres@example.com");
    expect(toolsFor(asker, new Set(["read", "ai"])).map((t) => t.name)).toEqual(["upcoming_practices", "practice_details", "my_spots", "where", "help"]);
    expect(toolsFor(asker, new Set(FEATURES))).toHaveLength(TOOLS.length);
    expect(toolsFor(null, new Set(FEATURES)).some((t) => t.name === "add_walk_in")).toBe(false);
  });

  it("says so when Gemini is slow (over 20 s) or out of quota", async () => {
    const never: AiModel = { generate: () => new Promise(() => undefined) };
    const slow = await ask(never, "hi", [], null, new Set(FEATURES), new Date(), 30);
    expect(slow).toEqual({ kind: "text", text: expect.stringMatching(/too slowly.*`!help`/) });
    const quota: AiModel = { generate: async () => Promise.reject(Object.assign(new Error("RESOURCE_EXHAUSTED"), { status: 429 })) };
    expect((await ask(quota, "hi", [], null, new Set(FEATURES), new Date())) as { text: string }).toMatchObject({ text: expect.stringMatching(/out of AI questions/) });
    const down: AiModel = { generate: async () => Promise.reject(new Error("fetch failed")) };
    expect(await ask(down, "hi", [], null, new Set(FEATURES), new Date())).toMatchObject({ text: expect.stringMatching(/can't answer free questions/) });
  });

  it("is off unless the ai feature is on", async () => {
    const model = new FakeModel(() => ({ text: "hello" }));
    expect(await free(model, "hello bot", "ana@example.com", ["read"])).toMatch(/didn't get that/);
    expect(model.calls).toHaveLength(0);
  });

  it("describes an unknown asker without guessing", () => {
    const ctx = contextFor([], null, new Date());
    expect(ctx).toMatch(/Not linked yet/);
    const asker: Asker = { email: "x@example.com", name: "X Person", phone: "+12125550000", member: null, board: null };
    expect(contextFor([], asker, new Date())).not.toMatch(/X Person|x@example|\+1212/);
  });

  it("stays quiet when Gemini says no reply is needed, but only on a reply to the bot", async () => {
    const model = new FakeModel(() => ({ text: "-" }));
    const commands = commandsFor(data, [...FEATURES], { ai: model });
    expect(await commands.run(parseCommand("thanks!"), { asker: null, chatKey: "chat|x", replyToBot: true })).toEqual([]);
    expect(model.calls.at(-1)!.system).toMatch(/answer with exactly: -/);
    // A direct @mention always gets an answer.
    const direct = await commands.run(parseCommand("thanks!"), { asker: null, chatKey: "chat|x" });
    expect(direct[0].text).toMatch(/didn't get that/);
    expect(model.calls.at(-1)!.system).not.toMatch(/answer with exactly: -/);
  });

  it("remembers recent exchanges per chat for follow-ups, but never a command's output", async () => {
    let t = 1_000_000;
    const memory = new ChatMemory(() => t);
    const model = new FakeModel((prompt) => (prompt.includes("who") ? { call: { name: "practice_details", args: { practice: ev.slug } } } : { text: "Friday is open too." }));
    const commands = commandsFor(data, [...FEATURES], { ai: model, memory });
    const ana = { asker: await askerOf(data, "ana@example.com"), chatKey: "chat|ana" };
    const pat = { asker: await askerOf(data, "pres@example.com"), chatKey: "chat|pat" };

    const shown = await commands.run(parseCommand("who is coming?"), ana);
    expect(shown[0].text).toMatch(/Zed Othermember/); // the list itself goes to WhatsApp…
    await commands.run(parseCommand("me"), pat);
    await commands.run(parseCommand("and friday?"), ana);

    const system = model.calls.at(-1)!.system;
    expect(system).toContain(`The person asking now: "who is coming?" → bot: (ran !list ${ev.slug} and showed the result)`);
    expect(system).toContain(`Someone else: "!me" → bot: (ran it and showed the result)`);
    expect(system).not.toMatch(/Zed|Othermember|Secretname|Yu Waiting/); // …but never reaches Gemini
    // Another chat has its own memory; old exchanges are forgotten.
    expect(memory.forPrompt("other", "ana")).toBe("");
    t += 31 * 60_000;
    expect(memory.forPrompt("chat", "ana")).toBe("");
  });

  it("gives Gemini the forecast for each practice, and keeps working when the weather service is down", async () => {
    const model = new FakeModel(() => ({ text: "Sunny, 62°F (17°C)." }));
    const weather = { at: async () => "62°F (17°C), clear, 0% chance of rain, wind 5 mph" };
    await commandsFor(data, [...FEATURES], { ai: model, weather }).run(parseCommand("weather monday?"), { asker: null, chatKey: "chat|w" });
    expect(model.calls.at(-1)!.system).toContain("weather forecast at the start time: 62°F (17°C), clear, 0% chance of rain, wind 5 mph.");
    expect(model.calls.at(-1)!.system).toMatch(/°F first, then °C/);
    const down = { at: async () => Promise.reject(new Error("offline")) };
    const out = await commandsFor(data, [...FEATURES], { ai: model, weather: down }).run(parseCommand("weather monday?"), { asker: null, chatKey: "chat|w" });
    expect(out[0].text).toBe("Sunny, 62°F (17°C).");
    expect(model.calls.at(-1)!.system).toContain("weather forecast: not available yet");
  });
});
