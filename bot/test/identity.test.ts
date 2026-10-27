import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeAll, describe, expect, it } from "vitest";
import { whoIs } from "../src/identity";
import { LocalState } from "../src/state";
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

  it("knows members without an email by their phone (WhatsApp verified it), and saves the link", async () => {
    const state = memoryState();
    const who = await whoIs(["c@lid"], "+12125550122", dataFor(db), state);
    expect(who).toMatchObject({ email: null, name: "Walk In", phone: "+12125550122", board: null });
    expect(state.link(["c@lid"])).toEqual({ email: null, name: "Walk In", phone: "+12125550122" });
    expect(state.mentionFor({ email: null, phone: "+12125550122" })).toBe("c@lid");
  });

  it("doesn't know unknown or hidden phones", async () => {
    const state = memoryState();
    expect(await whoIs(["f@lid"], "+12125550999", dataFor(db), state)).toBeNull();
    expect(await whoIs(["f@lid"], null, dataFor(db), state)).toBeNull();
  });

  it("keeps the name of someone known by phone after the 12-month cleanup removed them", async () => {
    const state = memoryState();
    state.saveLink(["g@lid"], { email: null, name: "Gone Away", phone: "+12125550155" });
    expect(await whoIs(["g@lid"], "+12125550155", dataFor(db), state)).toEqual({ email: null, name: "Gone Away", phone: "+12125550155", member: null, board: null });
  });

  it("moves old local state, where links needed an email, to the new shape", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "listbot-")), "state.db");
    const old = new DatabaseSync(path);
    old.exec(`create table links (wa_id text primary key, email text not null, name text, phone text, linked_at integer not null);
              insert into links values ('h@lid', 'h@example.com', 'H', null, 1);`);
    old.close();
    const state = new LocalState(path);
    expect(state.link(["h@lid"])).toEqual({ email: "h@example.com", name: "H", phone: null });
    state.saveLink(["i@lid"], { email: null, name: "I", phone: "+12125550177" });
    expect(state.link(["i@lid"])?.email).toBeNull();
    state.close();
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
