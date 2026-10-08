import { describe, expect, it } from "vitest";
import { loginEmail, render } from "@/lib/notify/templates";

const event = {
  id: "e1",
  title: "Wednesday practice",
  location: "Riverside <Park>",
  slug: "2026-10-14-wed",
  starts_at: "2026-10-14T16:30:00Z",
  ends_at: "2026-10-14T18:00:00Z",
  locks_at: "2026-10-14T14:30:00Z",
};
const ctx = { siteUrl: "https://list.example", dropUrl: "https://list.example/drop/abc", practiceUrl: "https://list.example/p/2026-10-14-wed?k=key" };

const payloads: Record<string, Record<string, unknown>> = {
  signup: { name: "Ana Diaz", event, lists: [{ list: "Skills", spot: "main", position: 3, cap: 40 }, { list: "Games", spot: "waitlist", position: 2, cap: 40 }] },
  promoted: { name: "Ana Diaz", event, list: "Games", position: 40, cap: 40 },
  team: { name: "Ana Diaz", event, team: "light_blue", list: "Games", update: false },
  cancelled: { name: "Ana Diaz", event, reason: "Rain" },
  changed: { name: "Ana Diaz", event, old_event: event },
  board_message: { name: "Ana Diaz", event, subject: "Bring shirts", body: "Line one\n\nLine two", from_name: "Sam" },
  late_drop: { member_name: "Ana Diaz", event, list: "Games", minutes_before: 70 },
  board_invite: { name: "Sam", role: "president", invited_by: "Lee" },
};

describe("email templates", () => {
  for (const [kind, payload] of Object.entries(payloads)) {
    it(`renders ${kind}`, () => {
      const m = render(kind, payload, ctx);
      expect(m.subject.length).toBeGreaterThan(5);
      expect(m.html).toContain("YOUR SPOT, SORTED.");
      expect(m.html).not.toContain("<Park>");
      expect(m.text.length).toBeGreaterThan(10);
    });
  }

  it("leads with the status and uses New York time", () => {
    const m = render("signup", payloads.signup, ctx);
    expect(m.subject).toBe("You're in for Wednesday ✅");
    expect(m.text).toContain("12:30–2 PM");
    expect(m.html).toContain(ctx.dropUrl);
  });

  it("links the team email to the practice page with its sign-up key", () => {
    const m = render("team", payloads.team, ctx);
    expect(m.html).toContain("See all teams");
    expect(m.html).toContain("?k=key");
  });

  it("gives board emails a one-tap promote link when they can carry one", () => {
    const withAct = render("late_drop", payloads.late_drop, { ...ctx, act: (a) => `https://list.example/admin/act/${a.a}-${"l" in a ? a.l : ""}` });
    expect(withAct.html).toContain("https://list.example/admin/act/promote-Games");
    expect(withAct.html).toContain("Promote the next person");
    expect(render("late_drop", payloads.late_drop, ctx).html).not.toContain("/admin/act/");
  });

  it("names the team in the subject", () => {
    expect(render("team", payloads.team, ctx).subject).toBe("You're on LIGHT BLUE for Wednesday");
    expect(render("team", { ...payloads.team, update: true }, ctx).subject).toBe("Team change: you're on LIGHT BLUE for Wednesday");
  });

  it("supports dark mode", () => {
    const { html } = render("signup", payloads.signup, ctx);
    expect(html).toContain('name="color-scheme" content="light dark"');
    expect(html).toContain("prefers-color-scheme: dark");
    expect(html).toContain("/brand/lockup-email@2x.png");
  });

  it("renders the login email", () => {
    expect(loginEmail("https://x/confirm", "https://x").html).toContain("https://x/confirm");
  });
});
