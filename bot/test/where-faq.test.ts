import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ask, type AiModel, type ToolDecl } from "../src/ai";
import { FEATURES } from "../src/config";
import type { Data } from "../src/data/types";
import { FAQ_PATH, faqText, loadFaq } from "../src/faq";
import { parseCommand } from "../src/parse";
import { commandsFor, dataFor, freshDb, practice, type Db } from "./helpers";

// R3: !where, and the club FAQ for Gemini.

let db: Db;
let data: Data;

beforeAll(async () => {
  db = await freshDb();
  data = dataFor(db);
  await practice(db, { startsIn: "2 days" });
  await db.query(`update events set location = 'Riverside Park (107th) entrance at 103rd St & Riverside Dr'`);
  await practice(db, { startsIn: "4 days", title: "Saturday practice" });
});

const run = async (text: string, extra: Parameters<typeof commandsFor>[2] = {}) =>
  (await commandsFor(data, undefined, extra).run(parseCommand(text), { asker: null, chatKey: "chat|x" })).map((o) => o.text).join("\n");

describe("!where (R3)", () => {
  it("parses with or without a day", () => {
    expect(parseCommand("where")).toEqual({ kind: "where", practice: "" });
    expect(parseCommand("where sat")).toEqual({ kind: "where", practice: "sat" });
    expect(parseCommand("location next")).toEqual({ kind: "where", practice: "next" });
    expect(parseCommand("where is everyone?")).toEqual({ kind: "free", text: "where is everyone?" });
  });

  it("gives the next practice's place and a Google Maps link, for anyone", async () => {
    const text = await run("where");
    expect(text).toMatch(/^\*Thursday practice · .*\*\n.* · Riverside Park \(107th\) entrance at 103rd St & Riverside Dr\n/);
    expect(text.split("\n")[2]).toBe("https://www.google.com/maps/search/?api=1&query=Riverside%20Park%20(107th)%20entrance%20at%20103rd%20St%20%26%20Riverside%20Dr");
  });

  it("is in !help and works with the read feature alone", async () => {
    expect(await commandsFor(data, ["read"]).run(parseCommand("help"), { asker: null, chatKey: "c|x" })).toEqual([{ quote: true, text: expect.stringMatching(/`!where`/) }]);
    expect(await commandsFor(data, ["read"]).run(parseCommand("where"), { asker: null, chatKey: "c|x" })).toEqual([{ quote: true, text: expect.stringMatching(/google\.com\/maps/) }]);
  });

  it("is a Gemini tool", async () => {
    const model: AiModel = { generate: async () => ({ call: { name: "where", args: {} } }) };
    expect(await run("where do we play?", { ai: model })).toMatch(/google\.com\/maps/);
  });
});

describe("club FAQ (R3)", () => {
  it("passes on filled-in answers and the facts, but not the board's notes or blank questions", () => {
    const text = faqText(`# CBS FC club FAQ
<!-- notes for the board -->

## What to bring

Cleats and a black and a white shirt.

## Fees and dues

(board: fill in) Whether practices cost anything.

## Guests
(board: fill in)
`);
    expect(text).toBe("## What to bring\n\nCleats and a black and a white shirt.");
  });

  it("ships a template that only states what the app already does", () => {
    const text = loadFaq(FAQ_PATH);
    expect(text).toMatch(/^## How the list works/);
    expect(text).toMatch(/lock 2 hours before the first list/);
    expect(text).toMatch(/late drop/);
    // Nothing the board hasn't filled in yet.
    expect(text).not.toMatch(/fill in|Fees|Guests|What to bring/);
  });

  it("is fine without a file, or with an empty one", () => {
    const dir = mkdtempSync(join(tmpdir(), "faq-"));
    expect(loadFaq(join(dir, "missing.md"))).toBe("");
    writeFileSync(join(dir, "empty.md"), "");
    expect(loadFaq(join(dir, "empty.md"))).toBe("");
  });

  it("reaches Gemini's prompt, with the rule to answer club questions only from it", async () => {
    const sent: { system: string; tools: ToolDecl[] }[] = [];
    const model: AiModel = { generate: async (req) => (sent.push(req), { text: "Bring cleats." }) };
    const r = await ask(model, "what should I bring?", [], null, new Set(FEATURES), new Date(), undefined, "", false, new Map(), "## What to bring\n\nCleats.");
    expect(r).toEqual({ kind: "text", text: "Bring cleats." });
    expect(sent[0].system).toContain("Club FAQ (from the board):\n## What to bring\n\nCleats.");
    expect(sent[0].system).toMatch(/answer only from the club FAQ below; if it doesn't say, just say you don't know that one and to ask the board. Never mention the FAQ itself/);
  });

  it("tells Gemini there's no FAQ when there isn't one", async () => {
    const sent: string[] = [];
    const model: AiModel = { generate: async (req) => (sent.push(req.system), { text: "Ask the board." }) };
    expect(await run("what are the dues?", { ai: model, faq: "" })).toBe("Ask the board.");
    expect(sent[0]).toContain("Club FAQ: (none yet; for any club question, say to ask the board)");
  });
});
