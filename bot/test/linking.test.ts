import { beforeAll, describe, expect, it } from "vitest";
import { handleLinking, isLinkingMessage, type LinkingDeps } from "../src/linking";
import { dataFor, FakeMailer, freshDb, member, memoryState, type Db } from "./helpers";

let db: Db;
beforeAll(async () => {
  db = await freshDb();
  await member(db, "ana@example.com", "Ana Diaz", "+12125550101");
});

function setup() {
  let t = 1_000_000;
  const mailer = new FakeMailer();
  const state = memoryState(() => t);
  const deps: LinkingDeps = { data: dataFor(db), state, mailer, now: () => t };
  const say = (text: string, waId = "dm1@lid") => handleLinking(waId, [waId, "15550001111@s.whatsapp.net"], text, deps);
  return { deps, mailer, state, say, advance: (ms: number) => (t += ms) };
}

describe("linking by DM", () => {
  it("links an existing member after the emailed code", async () => {
    const { say, mailer, state } = setup();
    expect(await say("link")).toMatch(/What email/);
    expect(await say("ANA@example.com")).toMatch(/emailed a 6-digit code to ana@example.com/);
    expect(mailer.sent[0].to).toBe("ana@example.com");
    expect(state.link(["dm1@lid"])).toBeNull();
    expect(await say(mailer.lastCode()!)).toMatch(/You're set, Ana/);
    expect(state.link(["dm1@lid"])).toEqual({ email: "ana@example.com", name: "Ana Diaz", phone: "+12125550101" });
    // Every ID WhatsApp gave is linked.
    expect(state.link(["15550001111@s.whatsapp.net"])?.email).toBe("ana@example.com");
    expect(state.flow("dm1@lid")).toBeNull();
  });

  it("never links without the right code", async () => {
    const { say, mailer, state } = setup();
    await say("link");
    await say("ana@example.com");
    const wrong = mailer.lastCode() === "000000" ? "111111" : "000000";
    expect(await say(wrong)).toMatch(/didn't match/);
    expect(await say("ana@example.com is me")).toMatch(/6-digit code/);
    expect(state.link(["dm1@lid"])).toBeNull();
  });

  it("expires codes after 10 minutes", async () => {
    const { say, mailer, state, advance } = setup();
    await say("link");
    await say("ana@example.com");
    advance(10 * 60_000 + 1);
    expect(await say(mailer.lastCode()!)).toMatch(/expired/);
    expect(state.link(["dm1@lid"])).toBeNull();
  });

  it("starts over after five wrong codes", async () => {
    const { say, mailer } = setup();
    await say("link");
    await say("ana@example.com");
    const wrong = mailer.lastCode() === "000000" ? "111111" : "000000";
    for (let i = 0; i < 4; i++) expect(await say(wrong)).toMatch(/didn't match\. Check/);
    expect(await say(wrong)).toMatch(/too many times/);
    expect(await say(mailer.lastCode()!)).toMatch(/doesn't look like an email/);
  });

  it("sends at most 3 codes per WhatsApp ID per hour", async () => {
    const { say, mailer, advance } = setup();
    await say("link");
    for (let i = 0; i < 3; i++) expect(await say("ana@example.com")).toMatch(/emailed/);
    expect(await say("ana@example.com")).toMatch(/3 codes in the last hour/);
    expect(mailer.sent).toHaveLength(3);
    advance(3_600_001);
    expect(await say("ana@example.com")).toMatch(/emailed/);
  });

  it("asks a new member for their name and phone, and keeps them pending locally", async () => {
    const { say, mailer, state } = setup();
    await say("link", "new@lid");
    await say("newbie@example.com", "new@lid");
    expect(await say(mailer.lastCode()!, "new@lid")).toMatch(/full name/);
    expect(await say("Sam Lee", "new@lid")).toMatch(/phone number/);
    expect(await say("not a phone", "new@lid")).toMatch(/doesn't look right/);
    expect(await say("(212) 555-0199", "new@lid")).toMatch(/You're set, Sam/);
    expect(state.link(["new@lid"])).toEqual({ email: "newbie@example.com", name: "Sam Lee", phone: "+12125550199" });
    // No database row until their first sign-up.
    expect((await db.query(`select 1 from members where email = 'newbie@example.com'`)).rows).toHaveLength(0);
  });

  it("answers only DMs that start or continue the flow", async () => {
    const { say, state } = setup();
    expect(isLinkingMessage("x@lid", "hello there", state)).toBe(false);
    expect(await say("hello there", "x@lid")).toBeNull();
    expect(isLinkingMessage("x@lid", "Link", state)).toBe(true);
    await say("link", "x@lid");
    expect(isLinkingMessage("x@lid", "anything", state)).toBe(true);
    expect(await say("stop", "x@lid")).toMatch(/stopped/);
    expect(isLinkingMessage("x@lid", "anything", state)).toBe(false);
  });
});
