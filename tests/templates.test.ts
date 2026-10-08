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
const ctx = { siteUrl: "https://list.example", dropUrl: "https://list.example/drop/abc" };

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

  it("renders the login email", () => {
    expect(loginEmail("https://x/confirm", "https://x").html).toContain("https://x/confirm");
  });
});
