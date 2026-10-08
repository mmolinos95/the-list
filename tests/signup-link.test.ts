import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let link: typeof import("@/lib/signup-link");
beforeAll(async () => {
  process.env.DROP_LINK_SECRET = "test-secret";
  process.env.SITE_URL = "https://list.example";
  link = await import("@/lib/signup-link");
});

const event = { id: "11111111-1111-1111-1111-111111111111", slug: "2026-10-09-fri", ends_at: "2026-10-09T16:00:00Z" };
const before = new Date("2026-10-09T15:00:00Z");
const keyOf = (path: string) => new URL(path, "https://x").searchParams.get("k");

describe("sign-up links", () => {
  it("builds /p/<slug>?k=<key> on the site URL", () => {
    expect(link.signupUrl(event)).toMatch(/^https:\/\/list\.example\/p\/2026-10-09-fri\?k=[\w-]{16}$/);
  });

  it("lets the practice's own key in until the practice ends", () => {
    const k = keyOf(link.signupPath(event));
    expect(link.hasSignupAccess(event, k, before)).toBe(true);
    expect(link.hasSignupAccess(event, k, new Date(event.ends_at))).toBe(false);
  });

  it("rejects missing, wrong and other practices' keys", () => {
    const other = keyOf(link.signupPath({ id: "22222222-2222-2222-2222-222222222222", slug: "x" }));
    expect(link.hasSignupAccess(event, undefined, before)).toBe(false);
    expect(link.hasSignupAccess(event, ["a"], before)).toBe(false);
    expect(link.hasSignupAccess(event, "nope", before)).toBe(false);
    expect(link.hasSignupAccess(event, other, before)).toBe(false);
  });
});
