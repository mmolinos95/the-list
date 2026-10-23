import { beforeAll, describe, expect, it } from "vitest";
import type { Data } from "../src/data/types";
import { parseCommand } from "../src/parse";
import { askerOf, board, commandsFor, dataFor, freshDb, member, practice, type Db } from "./helpers";

// "!in", "!out", "!post" and "!open" without a day pick the practice themselves.

let db: Db;
let data: Data;
let open: Awaited<ReturnType<typeof practice>>;
let later: Awaited<ReturnType<typeof practice>>;

beforeAll(async () => {
  db = await freshDb();
  data = dataFor(db);
  open = await practice(db, { startsIn: "2 days", title: "Open practice" });
  later = await practice(db, { startsIn: "4 days", opensIn: null, title: "Later practice" });
  await member(db, "ana@example.com", "Ana Diaz");
  await member(db, "pres@example.com", "Pres");
  await board(db, "pres@example.com");
});

const run = async (text: string, email: string) =>
  (await commandsFor(data).run(parseCommand(text), { asker: await askerOf(data, email), chatKey: `k|${email}` })).map((o) => o.text).join("\n---\n");

describe("commands without a day", () => {
  it("!in signs up for the practice that's open", async () => {
    const text = await run("in", "ana@example.com");
    expect(text).toMatch(/^You're in: \*Games\*, #1 of 40\./);
    expect(text).toMatch(/\*Open practice · /);
  });

  it("!out drops the practice you're on", async () => {
    expect(await run("out", "ana@example.com")).toMatch(/^Done: you're off \*Games\*/);
    expect(await run("out", "ana@example.com")).toBe("You're not on any upcoming list.");
  });

  it("!open opens the next practice that isn't open yet, and !post posts the open one", async () => {
    expect(await run("open", "pres@example.com")).toMatch(/^Sign-ups for .* are open\. Post it with `!post \w+`\./);
    const states = await db.query<{ id: string; open: boolean }>(`select id, opens_at <= now() as open from events where id = any($1)`, [[open.id, later.id]]);
    expect(states.rows.every((r) => r.open)).toBe(true);
    expect(await run("open", "pres@example.com")).toBe("Every upcoming practice is already open.");
    expect(await run("post", "pres@example.com")).toMatch(/^List Sign Up: .*\n[\s\S]*Location/);
  });
});
