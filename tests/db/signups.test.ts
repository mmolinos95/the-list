import { beforeEach, describe, expect, it } from "vitest";
import { addBoard, all, freshDb, makeEvent, one, signUp, type Db } from "./harness";

let db: Db;
beforeEach(async () => {
  db = await freshDb();
});

/** Move kickoff to 1 hour from now, which puts the practice past its lock. */
async function lock(eventId: string) {
  await db.query(`update events set starts_at = now() + interval '1 hour', ends_at = now() + interval '3 hours' where id = $1`, [eventId]);
}

async function spots(listId: string) {
  return all<{ name: string; spot: string; status: string }>(
    db,
    `select m.name, s.spot, s.status from signups s join members m on m.id = s.member_id
      where s.list_id = $1 order by s.created_at`,
    [listId],
  );
}

async function emails(kind?: string) {
  return all<{ kind: string; to_address: string; payload: Record<string, unknown> }>(
    db,
    `select kind, to_address, payload from emails ${kind ? "where kind = $1" : ""} order by created_at`,
    kind ? [kind] : [],
  );
}

describe("sign_up", () => {
  it("fills the main list up to the cap, then the waitlist", async () => {
    const ev = await makeEvent(db, { lists: [{ name: "Games", cap: 2 }] });
    const a = await signUp(db, ev.id, [ev.lists.Games], "Ana", "ana@x.com");
    const b = await signUp(db, ev.id, [ev.lists.Games], "Ben", "ben@x.com");
    const c = await signUp(db, ev.id, [ev.lists.Games], "Cy", "cy@x.com");
    expect(a.results[0]).toMatchObject({ spot: "main", position: 1 });
    expect(b.results[0]).toMatchObject({ spot: "main", position: 2 });
    expect(c.results[0]).toMatchObject({ spot: "waitlist", position: 1 });
  });

  it("allows one spot per email per list and treats email case-insensitively", async () => {
    const ev = await makeEvent(db);
    await signUp(db, ev.id, [ev.lists.Games], "Ana", "ana@x.com");
    const again = await signUp(db, ev.id, [ev.lists.Games], "Ana", "  ANA@x.com ");
    expect(again.created).toBe(false);
    expect(again.results[0]).toMatchObject({ already: true, position: 1 });
    expect(await spots(ev.lists.Games)).toHaveLength(1);
  });

  it("signs up for two lists with one email", async () => {
    const ev = await makeEvent(db, { lists: [{ name: "Skills", cap: 40 }, { name: "Games", cap: 1 }] });
    await signUp(db, ev.id, [ev.lists.Games], "Ana", "ana@x.com");
    const r = await signUp(db, ev.id, [ev.lists.Skills, ev.lists.Games], "Ben", "ben@x.com");
    const byList = Object.fromEntries(r.results.map((x) => [x.list, x.spot]));
    expect(byList).toEqual({ Skills: "main", Games: "waitlist" });
    const ben = (await emails("signup")).filter((e) => e.to_address === "ben@x.com");
    expect(ben).toHaveLength(1);
    expect(ben[0].payload.lists).toHaveLength(2);
  });

  it("updates name and phone with the latest details", async () => {
    const ev = await makeEvent(db, { lists: [{ name: "Skills", cap: 40 }, { name: "Games", cap: 40 }] });
    await signUp(db, ev.id, [ev.lists.Skills], "Martin", "m@x.com", "+12125550100");
    await signUp(db, ev.id, [ev.lists.Games], "Martín M.", "m@x.com", "+447700900123");
    const m = await one(db, `select name, phone from members where email = 'm@x.com'`);
    expect(m).toEqual({ name: "Martín M.", phone: "+447700900123" });
  });

  it("rejects practices that are not open, locked or cancelled", async () => {
    const notYet = await makeEvent(db, { opensIn: "1 hour" });
    await expect(signUp(db, notYet.id, [notYet.lists.Games], "A", "a@x.com")).rejects.toThrow("not_open");

    const manual = await makeEvent(db, { opensIn: null });
    await expect(signUp(db, manual.id, [manual.lists.Games], "A", "a@x.com")).rejects.toThrow("not_open");

    const locked = await makeEvent(db, { startsIn: "1 hour" });
    await expect(signUp(db, locked.id, [locked.lists.Games], "A", "a@x.com")).rejects.toThrow("locked");

    const cancelled = await makeEvent(db);
    await db.query(`update events set cancelled_at = now() where id = $1`, [cancelled.id]);
    await expect(signUp(db, cancelled.id, [cancelled.lists.Games], "A", "a@x.com")).rejects.toThrow("event_cancelled");
  });

  it("rejects lists from another practice", async () => {
    const a = await makeEvent(db);
    const b = await makeEvent(db);
    await expect(signUp(db, a.id, [b.lists.Games], "A", "a@x.com")).rejects.toThrow("bad_list");
  });

  it("rejects badly formatted phone numbers", async () => {
    const ev = await makeEvent(db);
    await expect(signUp(db, ev.id, [ev.lists.Games], "A", "a@x.com", "212-555-0100")).rejects.toThrow();
  });
});

describe("dropping out", () => {
  async function fullList() {
    const ev = await makeEvent(db, { lists: [{ name: "Games", cap: 2 }] });
    const ids: Record<string, string> = {};
    for (const n of ["ana", "ben", "cy", "dee"]) {
      ids[n] = (await signUp(db, ev.id, [ev.lists.Games], n, `${n}@x.com`)).member_id;
    }
    return { ev, ids };
  }

  it("before the lock, promotes the first waitlister and emails them", async () => {
    const { ev, ids } = await fullList();
    await db.query(`select drop_signups($1, $2, $3::uuid[])`, [ev.id, ids.ana, [ev.lists.Games]]);
    expect(await spots(ev.lists.Games)).toEqual([
      { name: "ana", spot: "main", status: "dropped" },
      { name: "ben", spot: "main", status: "active" },
      { name: "cy", spot: "main", status: "active" },
      { name: "dee", spot: "waitlist", status: "active" },
    ]);
    const promoted = await emails("promoted");
    expect(promoted.map((e) => e.to_address)).toEqual(["cy@x.com"]);
    expect(promoted[0].payload).toMatchObject({ position: 2, cap: 2, list: "Games" });
    const late = await one(db, `select dropped_late from signups where member_id = $1`, [ids.ana]);
    expect(late?.dropped_late).toBe(false);
  });

  it("after the lock, records a late drop, alerts the board and does not promote", async () => {
    await addBoard(db, "pres@x.com", "president");
    await addBoard(db, "board@x.com");
    const { ev, ids } = await fullList();
    await lock(ev.id);
    const r = await one<{ r: { locked: boolean } }>(db, `select drop_signups($1, $2, $3::uuid[]) as r`, [ev.id, ids.ben, [ev.lists.Games]]);
    expect(r.r.locked).toBe(true);
    expect((await spots(ev.lists.Games)).find((s) => s.name === "cy")?.spot).toBe("waitlist");
    expect(await emails("promoted")).toHaveLength(0);
    const alerts = await emails("late_drop");
    expect(alerts.map((e) => e.to_address).sort()).toEqual(["board@x.com", "pres@x.com"]);
    expect(alerts[0].payload).toMatchObject({ member_name: "ben", list: "Games" });
    const late = await one(db, `select dropped_late from signups where member_id = $1`, [ids.ben]);
    expect(late?.dropped_late).toBe(true);
  });

  it("does not count a waitlister leaving after the lock as a late drop", async () => {
    await addBoard(db, "pres@x.com", "president");
    const { ev, ids } = await fullList();
    await lock(ev.id);
    await db.query(`select drop_signups($1, $2, $3::uuid[])`, [ev.id, ids.dee, [ev.lists.Games]]);
    expect(await emails("late_drop")).toHaveLength(0);
  });

  it("lets someone who dropped sign up again at the end of the line", async () => {
    const { ev, ids } = await fullList();
    await db.query(`select drop_signups($1, $2, $3::uuid[])`, [ev.id, ids.ana, [ev.lists.Games]]);
    const again = await signUp(db, ev.id, [ev.lists.Games], "ana", "ana@x.com");
    expect(again.results[0]).toMatchObject({ spot: "waitlist", position: 2 });
  });
});

describe("board actions", () => {
  it("promotes anyone from the waitlist, but only after the lock", async () => {
    const pres = await addBoard(db, "pres@x.com", "president");
    const ev = await makeEvent(db, { lists: [{ name: "Games", cap: 1 }] });
    await signUp(db, ev.id, [ev.lists.Games], "ana", "ana@x.com");
    await signUp(db, ev.id, [ev.lists.Games], "ben", "ben@x.com");
    await signUp(db, ev.id, [ev.lists.Games], "cy", "cy@x.com");
    const cy = await one<{ id: string }>(db, `select s.id from signups s join members m on m.id = s.member_id where m.name = 'cy'`);

    await expect(db.query(`select promote_signup($1, $2)`, [cy.id, pres])).rejects.toThrow("auto_promotion_active");
    await lock(ev.id);
    await db.query(`select promote_signup($1, $2)`, [cy.id, pres]);
    const row = await one(db, `select spot, promoted_by from signups where id = $1`, [cy.id]);
    expect(row).toEqual({ spot: "main", promoted_by: pres });
    expect((await emails("promoted")).map((e) => e.to_address)).toEqual(["cy@x.com"]);
  });

  it("removing someone before the lock promotes the waitlist", async () => {
    const pres = await addBoard(db, "pres@x.com", "president");
    const ev = await makeEvent(db, { lists: [{ name: "Games", cap: 1 }] });
    await signUp(db, ev.id, [ev.lists.Games], "Messi", "fake@x.com");
    await signUp(db, ev.id, [ev.lists.Games], "ben", "ben@x.com");
    const fake = await one<{ id: string }>(db, `select s.id from signups s join members m on m.id = s.member_id where m.name = 'Messi'`);
    await db.query(`select remove_signup($1, $2)`, [fake.id, pres]);
    expect(await spots(ev.lists.Games)).toEqual([
      { name: "Messi", spot: "main", status: "removed" },
      { name: "ben", spot: "main", status: "active" },
    ]);
  });

  it("adds walk-ins to the main list over the cap, or to the waitlist", async () => {
    const pres = await addBoard(db, "pres@x.com", "president");
    const ev = await makeEvent(db, { lists: [{ name: "Games", cap: 1 }] });
    await signUp(db, ev.id, [ev.lists.Games], "ana", "ana@x.com");
    await db.query(`select add_signup($1, 'Walk In', null, null, 'main', $2)`, [ev.lists.Games, pres]);
    await db.query(`select add_signup($1, 'Wait Er', 'wait@x.com', null, 'waitlist', $2)`, [ev.lists.Games, pres]);
    expect(await spots(ev.lists.Games)).toEqual([
      { name: "ana", spot: "main", status: "active" },
      { name: "Walk In", spot: "main", status: "active" },
      { name: "Wait Er", spot: "waitlist", status: "active" },
    ]);
    // Only the walk-in with an email gets a confirmation.
    expect((await emails("signup")).map((e) => e.to_address)).toEqual(["ana@x.com", "wait@x.com"]);
  });

  it("raising a cap promotes from the waitlist; lowering removes nobody", async () => {
    const ev = await makeEvent(db, { lists: [{ name: "Games", cap: 1 }] });
    for (const n of ["ana", "ben", "cy"]) await signUp(db, ev.id, [ev.lists.Games], n, `${n}@x.com`);
    const up = await one<{ n: number }>(db, `select set_list_cap($1, 2) as n`, [ev.lists.Games]);
    expect(up.n).toBe(1);
    await db.query(`select set_list_cap($1, 1)`, [ev.lists.Games]);
    expect((await spots(ev.lists.Games)).map((s) => s.spot)).toEqual(["main", "main", "waitlist"]);
  });

  it("opens a manual practice", async () => {
    const ev = await makeEvent(db, { opensIn: null });
    await db.query(`select open_event($1)`, [ev.id]);
    const r = await signUp(db, ev.id, [ev.lists.Games], "ana", "ana@x.com");
    expect(r.results[0].spot).toBe("main");
  });

  it("cancelling emails everyone once, even if they are on two lists", async () => {
    const pres = await addBoard(db, "pres@x.com", "president");
    const ev = await makeEvent(db, { lists: [{ name: "Skills", cap: 40 }, { name: "Games", cap: 1 }] });
    await signUp(db, ev.id, [ev.lists.Skills, ev.lists.Games], "ana", "ana@x.com");
    await signUp(db, ev.id, [ev.lists.Games], "ben", "ben@x.com");
    const n = await one<{ n: number }>(db, `select cancel_event($1, 'Rain', $2) as n`, [ev.id, pres]);
    expect(n.n).toBe(2);
    expect((await emails("cancelled"))[0].payload).toMatchObject({ reason: "Rain" });
    await expect(db.query(`select cancel_event($1, '', $2)`, [ev.id, pres])).rejects.toThrow("already_cancelled");
  });

  it("messages the main list, and the waitlist only when asked", async () => {
    const pres = await addBoard(db, "pres@x.com", "president");
    const ev = await makeEvent(db, { lists: [{ name: "Games", cap: 1 }] });
    await signUp(db, ev.id, [ev.lists.Games], "ana", "ana@x.com");
    await signUp(db, ev.id, [ev.lists.Games], "ben", "ben@x.com");
    const a = await one<{ n: number }>(db, `select message_event($1, 'Hi', 'Field 3', false, $2) as n`, [ev.id, pres]);
    const b = await one<{ n: number }>(db, `select message_event($1, 'Hi', 'Field 3', true, $2) as n`, [ev.id, pres]);
    expect([a.n, b.n]).toEqual([1, 2]);
  });

  it("keeps at least one president", async () => {
    const pres = await addBoard(db, "pres@x.com", "president");
    const b = await addBoard(db, "b@x.com");
    await expect(db.query(`delete from board_members where id = $1`, [pres])).rejects.toThrow("last_president");
    await expect(db.query(`update board_members set role = 'board' where id = $1`, [pres])).rejects.toThrow("last_president");
    await db.query(`update board_members set role = 'president' where id = $1`, [b]);
    await db.query(`delete from board_members where id = $1`, [pres]);
    expect((await all(db, `select * from board_members`)).length).toBe(1);
  });
});

describe("teams", () => {
  it("shuffles evenly, sends once, then only sends updates to moved players", async () => {
    const ev = await makeEvent(db, { lists: [{ name: "Skills", cap: 40 }, { name: "Games", cap: 40, teams: true }] });
    for (let i = 0; i < 40; i++) await signUp(db, ev.id, [ev.lists.Games, ev.lists.Skills], `p${i}`, `p${i}@x.com`);
    await db.query(`select shuffle_teams($1)`, [ev.id]);

    const counts = await all<{ team: string; n: number }>(
      db,
      `select team::text, count(*)::int as n from signups where list_id = $1 group by team order by team`,
      [ev.lists.Games],
    );
    expect(counts.map((c) => c.n)).toEqual([10, 10, 10, 10]);
    const skillsTeams = await one<{ n: number }>(db, `select count(team)::int as n from signups where list_id = $1`, [ev.lists.Skills]);
    expect(skillsTeams.n).toBe(0);

    expect((await one<{ n: number }>(db, `select send_teams($1) as n`, [ev.id])).n).toBe(40);
    expect((await one<{ n: number }>(db, `select send_teams($1) as n`, [ev.id])).n).toBe(0);

    const someone = await one<{ id: string; team: string }>(db, `select id, team from signups where list_id = $1 limit 1`, [ev.lists.Games]);
    const other = someone.team === "red" ? "black" : "red";
    await db.query(`select set_team($1, $2)`, [someone.id, other]);
    expect((await one<{ n: number }>(db, `select send_teams($1) as n`, [ev.id])).n).toBe(1);
    const last = (await emails("team")).at(-1)!;
    expect(last.payload).toMatchObject({ team: other, update: true });
  });
});

describe("weekly schedule", () => {
  async function template(weekday: number, mode: "auto" | "manual" = "auto") {
    const t = await one<{ id: string }>(
      db,
      `insert into templates (title, weekday, start_time, end_time, location, open_mode)
       values ('Practice', $1, '12:30', '14:00', 'Riverside Park', $2) returning id`,
      [weekday, mode],
    );
    await db.query(`insert into template_lists (template_id, name, cap, makes_teams, position) values ($1, 'Skills', 40, false, 0), ($1, 'Games', 40, true, 1)`, [t.id]);
    return t.id;
  }

  it("creates practices in New York time, opening at 9 AM the day before, and is idempotent", async () => {
    const t = await template(3);
    const n = await one<{ n: number }>(db, `select create_upcoming_events(14) as n`);
    expect(n.n).toBeGreaterThanOrEqual(2);
    expect((await one<{ n: number }>(db, `select create_upcoming_events(14) as n`)).n).toBe(0);

    const rows = await all<{ local_start: string; local_open: string; local_lock: string; dow: number; slug: string; lists: number }>(
      db,
      `select to_char(starts_at at time zone 'America/New_York', 'HH24:MI') as local_start,
              to_char(opens_at at time zone 'America/New_York', 'HH24:MI') as local_open,
              to_char(locks_at at time zone 'America/New_York', 'HH24:MI') as local_lock,
              extract(dow from starts_at at time zone 'America/New_York')::int as dow,
              ((starts_at at time zone 'America/New_York')::date - (opens_at at time zone 'America/New_York')::date) as days_before,
              slug,
              (select count(*)::int from event_lists l where l.event_id = e.id) as lists
         from events e where template_id = $1`,
      [t],
    );
    for (const r of rows) {
      expect(r).toMatchObject({ local_start: "12:30", local_open: "09:00", local_lock: "10:30", dow: 3, lists: 2, days_before: 1 });
      expect(r.slug).toMatch(/^\d{4}-\d{2}-\d{2}-wed$/);
    }
  });

  it("leaves manual practices closed until a board member opens them", async () => {
    await template(1, "manual");
    await db.query(`select create_upcoming_events(14)`);
    const open = await all(db, `select * from events where opens_at is not null`);
    expect(open).toHaveLength(0);
  });

  it("does not create practices for paused templates", async () => {
    const t = await template(5);
    await db.query(`update templates set paused = true where id = $1`, [t]);
    expect((await one<{ n: number }>(db, `select create_upcoming_events(14) as n`)).n).toBe(0);
  });

  it("rebuilds untouched future practices when the template changes, and keeps edited ones", async () => {
    const t = await template(3);
    await db.query(`select create_upcoming_events(14)`);
    const [first] = await all<{ id: string }>(db, `select id from events where template_id = $1 order by starts_at`, [t]);
    await db.query(`update events set edited_at = now(), location = 'Field 3' where id = $1`, [first.id]);

    await db.query(`update templates set location = 'Pier 40' where id = $1`, [t]);
    await db.query(`select apply_template($1)`, [t]);
    const rows = await all<{ id: string; location: string }>(db, `select id, location from events where template_id = $1 order by starts_at`, [t]);
    expect(rows[0]).toEqual({ id: first.id, location: "Field 3" });
    expect(rows.slice(1).every((r) => r.location === "Pier 40")).toBe(true);
  });
});

describe("list times", () => {
  const local = (col: string) => `to_char(${col} at time zone 'America/New_York', 'HH24:MI')`;

  it("gives each practice its lists' own times, running from the first to the last", async () => {
    const t = await one<{ id: string }>(
      db,
      `insert into templates (title, weekday, start_time, end_time, location) values ('Friday practice', 5, '10:00', '12:00', 'Riverside Park') returning id`,
    );
    await db.query(
      `insert into template_lists (template_id, name, cap, makes_teams, position, start_time, end_time)
       values ($1, 'Skills', 40, false, 0, '10:00', '11:00'), ($1, 'Games', 40, true, 1, '11:00', '12:00')`,
      [t.id],
    );
    await db.query(`select create_upcoming_events(14)`);
    const ev = await one<{ id: string; start: string; end: string; lock: string }>(
      db,
      `select id, ${local("starts_at")} as start, ${local("ends_at")} as end, ${local("locks_at")} as lock from events order by starts_at limit 1`,
    );
    expect(ev).toMatchObject({ start: "10:00", end: "12:00", lock: "08:00" });
    const lists = await all(db, `select name, ${local("starts_at")} as start, ${local("ends_at")} as end from event_lists where event_id = $1 order by position`, [ev.id]);
    expect(lists).toEqual([
      { name: "Skills", start: "10:00", end: "11:00" },
      { name: "Games", start: "11:00", end: "12:00" },
    ]);
  });

  it("lists added without times take the practice's", async () => {
    const ev = await makeEvent(db);
    const row = await one<{ same: boolean }>(
      db,
      `select l.starts_at = e.starts_at and l.ends_at = e.ends_at as same from event_lists l join events e on e.id = l.event_id where e.id = $1`,
      [ev.id],
    );
    expect(row.same).toBe(true);
  });

  it("edit_event moves each list, and the practice and its lock follow", async () => {
    const ev = await makeEvent(db, { startsIn: "3 days", lists: [{ name: "Skills", cap: 40 }, { name: "Games", cap: 40 }] });
    await signUp(db, ev.id, [ev.lists.Games], "Ana", "ana@x.com");
    const base = (await one<{ s: string }>(db, `select starts_at::text as s from events where id = $1`, [ev.id])).s;
    const at = (h: number) => new Date(Date.parse(base) + h * 3_600_000).toISOString();
    const n = await one<{ n: number }>(db, `select edit_event($1, ' Pier 40 ', $2::jsonb, true) as n`, [
      ev.id,
      JSON.stringify([
        { id: ev.lists.Skills, starts_at: at(1), ends_at: at(2) },
        { id: ev.lists.Games, starts_at: at(2), ends_at: at(3) },
      ]),
    ]);
    expect(n.n).toBe(1);
    const e = await one<{ location: string; s: string; e: string; l: string; edited: boolean }>(
      db,
      `select location, starts_at = $2::timestamptz as s, ends_at = $3::timestamptz as e, locks_at = $4::timestamptz as l, edited_at is not null as edited
         from events where id = $1`,
      [ev.id, at(1), at(3), at(-1)],
    );
    expect(e).toEqual({ location: "Pier 40", s: true, e: true, l: true, edited: true });
    const changed = await emails("changed");
    expect(changed.map((m) => m.to_address)).toEqual(["ana@x.com"]);
  });

  it("rejects a list that ends before it starts", async () => {
    const ev = await makeEvent(db);
    const now = Date.now();
    await expect(
      db.query(`select edit_event($1, 'Riverside Park', $2::jsonb, false)`, [
        ev.id,
        JSON.stringify([{ id: ev.lists.Games, starts_at: new Date(now + 7_200_000).toISOString(), ends_at: new Date(now + 3_600_000).toISOString() }]),
      ]),
    ).rejects.toThrow("event_lists_ends_at");
  });
});

describe("housekeeping", () => {
  it("deletes members idle for 12 months, with their history", async () => {
    const ev = await makeEvent(db);
    const r = await signUp(db, ev.id, [ev.lists.Games], "old", "old@x.com");
    await db.query(`select drop_signups($1, $2, $3::uuid[])`, [ev.id, r.member_id, [ev.lists.Games]]);
    await db.query(`update members set last_signup_at = now() - interval '13 months'`);
    expect((await one<{ n: number }>(db, `select cleanup_inactive_members() as n`)).n).toBe(1);
    expect(await all(db, `select * from signups`)).toHaveLength(0);
  });

  it("claims each pending email once until its claim expires", async () => {
    const ev = await makeEvent(db);
    await signUp(db, ev.id, [ev.lists.Games], "ana", "ana@x.com");
    expect(await all(db, `select * from claim_emails(10)`)).toHaveLength(1);
    expect(await all(db, `select * from claim_emails(10)`)).toHaveLength(0);
    await db.query(`update emails set claimed_at = now() - interval '6 minutes'`);
    expect(await all(db, `select * from claim_emails(10)`)).toHaveLength(1);
  });
});
