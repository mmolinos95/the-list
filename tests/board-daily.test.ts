import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AdminPractice } from "@/lib/admin-data";

vi.mock("server-only", () => ({}));

let build: typeof import("@/lib/board-daily").buildBoardDaily;
let render: typeof import("@/lib/notify/templates").render;
beforeAll(async () => {
  process.env.DROP_LINK_SECRET = "test-secret";
  process.env.SITE_URL = "https://list.example";
  build = (await import("@/lib/board-daily")).buildBoardDaily;
  render = (await import("@/lib/notify/templates")).render;
});

// 6 AM New York on Thursday Oct 8: Friday's sign-ups open at 9 AM today.
const now = new Date("2026-10-08T10:00:00Z");

function practice(id: string, startsAt: string, stage: AdminPractice["stage"], opensAt: string | null = null): AdminPractice {
  const ends = new Date(Date.parse(startsAt) + 2 * 3_600_000).toISOString();
  const person = (n: number) => ({ id: `s${n}`, member: { id: `m${n}`, name: `P${n}`, email: `p${n}@x.com` } });
  const list = (name: string, main: number, waitlist: number) => ({
    id: `${id}-${name}`,
    event_id: id,
    name,
    cap: 40,
    makes_teams: name === "Games",
    position: name === "Games" ? 1 : 0,
    starts_at: startsAt,
    ends_at: ends,
    teams_sent_at: null,
    main: Array.from({ length: main }, (_, i) => person(i)),
    waitlist: Array.from({ length: waitlist }, (_, i) => person(100 + i)),
    gone: [],
  });
  return {
    event: {
      id,
      template_id: null,
      title: "Practice",
      location: "Riverside Park",
      slug: `slug-${id}`,
      starts_at: startsAt,
      ends_at: ends,
      opens_at: opensAt,
      locks_at: new Date(Date.parse(startsAt) - 2 * 3_600_000).toISOString(),
      edited_at: null,
      cancelled_at: null,
      cancel_reason: null,
    },
    lists: [list("Skills", 12, 0), list("Games", 40, 3)],
    stage,
    lateDrops: 0,
  } as unknown as AdminPractice;
}

const E = (n: number) => `${n}`.repeat(8) + "-1111-1111-1111-111111111111";

describe("board morning email", () => {
  it("picks today's practice and today's sign-up opening, nothing else", () => {
    const d = build(
      [
        practice(E(1), "2026-10-08T16:40:00Z", "locked"), // today 12:40 PM
        practice(E(2), "2026-10-09T14:00:00Z", "soon", "2026-10-08T13:00:00Z"), // Fri, opens today 9 AM
        practice(E(3), "2026-10-12T16:40:00Z", "soon", "2026-10-11T13:00:00Z"), // Mon, opens Sunday
        practice(E(4), "2026-10-08T22:00:00Z", "cancelled"), // today, but off
      ],
      now,
    );
    expect(d.today.map((t) => t.event.id)).toEqual([E(1)]);
    expect(d.today[0].lists).toEqual([
      expect.objectContaining({ name: "Skills", main: 12, waitlist: 0 }),
      expect.objectContaining({ name: "Games", main: 40, waitlist: 3 }),
    ]);
    expect(d.opening.map((o) => o.event.id)).toEqual([E(2)]);
    expect(d.opening[0].post).toContain("List Sign Up: 10/9 Friday Practice");
    expect(d.opening[0].whatsapp).toMatch(/^https:\/\/wa\.me\/\?text=List%20Sign%20Up/);
  });

  it("renders counts, a one-tap cancel, and the post with a WhatsApp button", () => {
    const d = build([practice(E(1), "2026-10-08T16:40:00Z", "locked"), practice(E(2), "2026-10-09T14:00:00Z", "soon", "2026-10-08T13:00:00Z")], now);
    const m = render("board_daily", d, { siteUrl: "https://list.example", act: (a) => `https://list.example/admin/act/${a.a}` });
    expect(m.subject).toBe("Today: Thursday practice · Friday sign-ups open at 9 AM");
    expect(m.html).toContain("40/40 + 3 waiting");
    expect(m.html).toContain("https://list.example/admin/act/cancel");
    expect(m.html).toContain("https://wa.me/?text=");
    expect(m.text).toContain("List Sign Up: 10/9 Friday Practice");
  });
});
