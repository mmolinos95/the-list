import { beforeAll, describe, expect, it } from "vitest";
import { signupUrl } from "../src/links";
import { sharePost } from "../src/share";

// The bot re-implements the app's sign-up link and WhatsApp post (the app's
// versions import server-only and env.ts). Same input, same output.

const SECRET = "test-secret";
const SITE = "https://list.example";

let app: {
  share: typeof import("../../src/lib/share");
  signup: typeof import("../../src/lib/signup-link");
};
beforeAll(async () => {
  process.env.DROP_LINK_SECRET = SECRET;
  process.env.SITE_URL = SITE;
  app = {
    share: await import("../../src/lib/share"),
    signup: await import("../../src/lib/signup-link"),
  };
});

const event = {
  id: "11111111-1111-4111-8111-111111111111",
  template_id: null,
  title: "Friday practice",
  location: "Riverside Park (107th) entrance at 103rd St",
  slug: "2026-10-09-fri",
  starts_at: "2026-10-09T14:00:00+00:00",
  ends_at: "2026-10-09T16:00:00+00:00",
  opens_at: null,
  locks_at: "2026-10-09T12:00:00+00:00",
  edited_at: null,
  cancelled_at: null,
  cancel_reason: null,
};
const lists = [
  { name: "Skills", cap: 40, starts_at: "2026-10-09T14:00:00+00:00", ends_at: "2026-10-09T15:00:00+00:00" },
  { name: "Games", cap: 32, starts_at: "2026-10-09T15:00:00+00:00", ends_at: "2026-10-09T16:00:00+00:00" },
];

describe("the bot's links and post match the app's", () => {
  it("sign-up link", () => {
    expect(signupUrl(SECRET, SITE, event)).toBe(app.signup.signupUrl(event));
    expect(app.signup.hasSignupAccess(event, new URL(signupUrl(SECRET, SITE, event)).searchParams.get("k"), new Date("2026-10-09T13:00:00Z"))).toBe(true);
  });

  it("WhatsApp post, including a winter (EST) date", () => {
    expect(sharePost(SECRET, SITE, event, lists)).toBe(app.share.shareFor(event, lists).post);
    const winter = { ...event, slug: "2026-12-04-fri", starts_at: "2026-12-04T15:00:00Z" };
    const winterLists = lists.map((l) => ({ ...l, starts_at: "2026-12-04T15:00:00Z", ends_at: "2026-12-04T16:30:00Z" }));
    expect(sharePost(SECRET, SITE, winter, winterLists)).toBe(app.share.shareFor(winter, winterLists).post);
    expect(sharePost(SECRET, SITE, event, lists)).toMatch(/^List Sign Up: 10\/9 Friday Practice\nSkills: 10:00 - 11:00 \(40 players\)\nGames: 11:00 - 12:00 \(32 players\)\n/);
  });
});
