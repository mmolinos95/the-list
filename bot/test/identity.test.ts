import { beforeAll, describe, expect, it } from "vitest";
import { whoIs } from "../src/identity";
import { board, dataFor, freshDb, member, memoryState, type Db } from "./helpers";

let db: Db;
beforeAll(async () => {
  db = await freshDb();
  await member(db, "old@example.com", "Old Name", "+12125550111");
  await new Promise((r) => setTimeout(r, 5));
  await member(db, "new@example.com", "New Name", "+12125550111");
  await db.query(`insert into members (name, phone) values ('Walk In', '+12125550122')`);
  await member(db, "boss@example.com", "Boss", "+12125550133");
  await board(db, "boss@example.com");
});

describe("who is asking", () => {
  it("uses a saved link first", async () => {
    const state = memoryState();
    state.saveLink(["a@lid"], { email: "old@example.com", name: "Old Name", phone: null });
    const who = await whoIs(["a@lid"], "+12125550133", dataFor(db), state);
    expect(who?.email).toBe("old@example.com");
    expect(who?.member?.name).toBe("Old Name");
    expect(who?.board).toBeNull();
  });

  it("matches a visible phone to the most recently updated member, and saves the link", async () => {
    const state = memoryState();
    const who = await whoIs(["12125550111@s.whatsapp.net", "b@lid"], "+12125550111", dataFor(db), state);
    expect(who?.email).toBe("new@example.com");
    expect(state.link(["b@lid"])?.email).toBe("new@example.com");
  });

  it("ignores walk-ins without an email and unknown phones", async () => {
    const state = memoryState();
    expect(await whoIs(["c@lid"], "+12125550122", dataFor(db), state)).toBeNull();
    expect(await whoIs(["c@lid"], "+12125550999", dataFor(db), state)).toBeNull();
    expect(await whoIs(["c@lid"], null, dataFor(db), state)).toBeNull();
  });

  it("knows the board by email", async () => {
    const who = await whoIs(["d@lid"], "+12125550133", dataFor(db), memoryState());
    expect(who?.board?.email).toBe("boss@example.com");
  });

  it("keeps a linked new member who isn't in the database yet", async () => {
    const state = memoryState();
    state.saveLink(["e@lid"], { email: "fresh@example.com", name: "Fresh Face", phone: "+12125550144" });
    const who = await whoIs(["e@lid"], null, dataFor(db), state);
    expect(who).toMatchObject({ email: "fresh@example.com", name: "Fresh Face", phone: "+12125550144", member: null, board: null });
  });
});
