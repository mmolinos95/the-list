import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let act: typeof import("@/lib/board-action");
beforeAll(async () => {
  process.env.DROP_LINK_SECRET = "test-secret";
  process.env.SITE_URL = "https://list.example";
  act = await import("@/lib/board-action");
});

const e = "11111111-1111-1111-1111-111111111111";
const now = Date.parse("2026-10-09T12:00:00Z");
const promote = { a: "promote" as const, e, l: "Games", to: "pres@example.com", x: now + 3_600_000 };

describe("board action links", () => {
  it("round-trips an action on the site URL", () => {
    expect(act.boardActionUrl(promote)).toMatch(/^https:\/\/list\.example\/admin\/act\/[\w-]+\.[\w-]{32}$/);
    expect(act.verifyBoardAction(act.boardActionToken(promote), now)).toEqual({ ok: true, action: promote });
  });

  it("rejects tampered payloads and signatures", () => {
    const [body, sig] = act.boardActionToken(promote).split(".");
    const forged = Buffer.from(JSON.stringify({ ...promote, a: "cancel" })).toString("base64url");
    expect(act.verifyBoardAction(`${forged}.${sig}`, now)).toEqual({ ok: false, reason: "invalid" });
    expect(act.verifyBoardAction(`${body}.${"x".repeat(32)}`, now)).toEqual({ ok: false, reason: "invalid" });
    expect(act.verifyBoardAction("nonsense", now)).toEqual({ ok: false, reason: "invalid" });
  });

  it("expires", () => {
    expect(act.verifyBoardAction(act.boardActionToken(promote), promote.x + 1)).toEqual({ ok: false, reason: "expired" });
  });

  it("isn't interchangeable with drop-out or sign-up signatures", async () => {
    const { dropToken } = await import("@/lib/drop-link");
    const [, , dropSig] = dropToken(e, e).split(".");
    const [body] = act.boardActionToken(promote).split(".");
    expect(act.verifyBoardAction(`${body}.${dropSig}`, now).ok).toBe(false);
  });
});
