import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let link: typeof import("@/lib/signup-link");
beforeAll(async () => {
  process.env.DROP_LINK_SECRET = "test-secret";
  process.env.SITE_URL = "https://list.example";
  link = await import("@/lib/signup-link");
});

const event = { slug: "2026-10-09-fri", ends_at: "2026-10-09T16:00:00Z" };
const before = new Date("2026-10-09T15:00:00Z");
const keyOf = (path: string) => new URL(path, "https://x").searchParams.get("k");

describe("sign-up links", () => {
  it("builds /p/<slug>?k=<key> on the site URL", () => {
    expect(link.signupUrl(event)).toMatch(/^https:\/\/list\.example\/p\/2026-10-09-fri\?k=[\w-]{16}$/);
  });

  it("lets the practice's own key in until the practice ends, then calls it expired", () => {
    const k = keyOf(link.signupPath(event));
    expect(link.hasSignupAccess(event, k, before)).toBe(true);
    expect(link.signupAccess(event, k, new Date(event.ends_at))).toBe("expired");
    expect(link.hasSignupAccess(event, k, new Date(event.ends_at))).toBe(false);
  });

  it("keeps working when the practice is rebuilt with a new id but the same slug", () => {
    const k = keyOf(link.signupPath({ ...event, id: "old" } as typeof event));
    expect(link.hasSignupAccess({ ...event, id: "new" } as typeof event, k, before)).toBe(true);
  });

  it("rejects missing, wrong and other practices' keys as invalid, not expired", () => {
    const other = keyOf(link.signupPath({ slug: "2026-10-12-mon" }));
    for (const k of [undefined, ["a"], "nope", other]) {
      expect(link.signupAccess(event, k, before)).toBe("invalid");
      expect(link.signupAccess(event, k, new Date(event.ends_at))).toBe("invalid");
    }
  });
});
