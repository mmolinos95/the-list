import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let ll: typeof import("@/lib/login-link");
beforeAll(async () => {
  process.env.DROP_LINK_SECRET = "test-secret";
  process.env.SITE_URL = "https://list.example";
  ll = await import("@/lib/login-link");
});

const email = "pres@example.com";
const issuedAt = Date.parse("2026-10-08T20:00:00.123Z");
const stored = new Date(issuedAt).toISOString();

describe("board login links and codes", () => {
  it("round-trips the link on the site URL", () => {
    expect(ll.loginUrl(email, issuedAt)).toMatch(/^https:\/\/list\.example\/admin\/auth\/link\/[\w-]+\.[\w-]{32}$/);
    expect(ll.readLoginToken(ll.loginToken(email, issuedAt))).toEqual({ email, issuedAt });
  });

  it("rejects tampered links", () => {
    const [, sig] = ll.loginToken(email, issuedAt).split(".");
    const other = Buffer.from(JSON.stringify({ e: "attacker@example.com", i: issuedAt })).toString("base64url");
    expect(ll.readLoginToken(`${other}.${sig}`)).toBeNull();
    expect(ll.readLoginToken("nonsense")).toBeNull();
  });

  it("works for 15 minutes, and only for the latest email", () => {
    expect(ll.isCurrent(issuedAt, stored, issuedAt + 14 * 60_000)).toBe(true);
    expect(ll.isCurrent(issuedAt, stored, issuedAt + 15 * 60_000)).toBe(false);
    expect(ll.isCurrent(issuedAt, new Date(issuedAt + 90_000).toISOString(), issuedAt + 100_000)).toBe(false);
    expect(ll.isCurrent(issuedAt, null, issuedAt)).toBe(false);
  });

  it("gives an 8-digit code that changes with every email", () => {
    const code = ll.loginCode(email, issuedAt);
    expect(code).toMatch(/^\d{8}$/);
    expect(ll.loginCode(email, issuedAt)).toBe(code);
    expect(ll.loginCode(email, issuedAt + 1)).not.toBe(code);
    expect(ll.loginCode("other@example.com", issuedAt)).not.toBe(code);
    expect(ll.codeMatches(`${code.slice(0, 4)} ${code.slice(4)}`, code)).toBe(true);
    expect(ll.codeMatches("12345678", code === "12345678" ? "87654321" : code)).toBe(false);
  });
});
