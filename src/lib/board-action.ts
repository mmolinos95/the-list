import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

// One-tap links in board emails, so routine actions don't need a login.
// A link is "<payload>.<signature>": what to do, for which practice, for which
// board member (by email), and until when. Opening it only shows a confirm
// page; the button does the work, because email scanners open links. On use
// the email must still be on the board, so removing someone kills their links.

export type BoardAction =
  /** Promote the next person on the waitlist of list `l` (by name). */
  | { a: "promote"; e: string; l: string; to: string; x: number }
  /** Cancel the practice, with a reason, emailing everyone on it. */
  | { a: "cancel"; e: string; to: string; x: number };

const sign = (body: string) => createHmac("sha256", env.dropLinkSecret).update(`board-action:${body}`).digest("base64url").slice(0, 32);

export function boardActionToken(action: BoardAction) {
  const body = Buffer.from(JSON.stringify(action)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function boardActionUrl(action: BoardAction) {
  return `${env.siteUrl}/admin/act/${boardActionToken(action)}`;
}

export type Verified = { ok: true; action: BoardAction } | { ok: false; reason: "invalid" | "expired" };

export function verifyBoardAction(token: string, now = Date.now()): Verified {
  const parts = decodeURIComponent(token).split(".");
  if (parts.length !== 2) return { ok: false, reason: "invalid" };
  const [body, sig] = parts;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "invalid" };

  let action: BoardAction;
  try {
    action = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "invalid" };
  }
  const uuid = /^[0-9a-f-]{36}$/i;
  const shapeOk =
    typeof action === "object" &&
    action !== null &&
    (action.a === "cancel" || (action.a === "promote" && typeof action.l === "string")) &&
    uuid.test(action.e) &&
    typeof action.to === "string" &&
    typeof action.x === "number";
  if (!shapeOk) return { ok: false, reason: "invalid" };
  if (action.x < now) return { ok: false, reason: "expired" };
  return { ok: true, action };
}
